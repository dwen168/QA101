#!/usr/bin/env python3
"""
Signal Calibration for Trade Recommendation
===========================================
Uses historical price data to fit XGBoost model for optimal signal weights.
Predicts 5-day forward returns and extracts feature importance as weights.

Usage:
    python signal-calibration.py --symbols AAPL,MSFT,GOOGL,NVDA --days 500 --output backend/lib/signal-weights.json
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False

# Try importing ML libraries - graceful fallback if not installed
try:
    import xgboost as xgb
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import TimeSeriesSplit
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, average_precision_score
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    print("[WARNING] XGBoost/sklearn not installed. Install with: pip install xgboost scikit-learn")


def fetch_alpha_vantage_data(symbol, api_key, days=500):
    """
    Fetch historical daily OHLCV from Alpha Vantage.
    Returns DataFrame with columns: [date, open, high, low, close, volume]
    """
    import requests
    
    url = f"https://www.alphavantage.co/query"
    params = {
        'function': 'TIME_SERIES_DAILY_ADJUSTED',
        'symbol': symbol,
        'outputsize': 'full',
        'apikey': api_key
    }
    
    print(f"  Fetching {symbol} from Alpha Vantage...", end=" ", flush=True)
    try:
        response = requests.get(url, params=params, timeout=15)
        data = response.json()
        
        if 'Error Message' in data:
            print(f"ERROR: {data['Error Message']}")
            return None
        if 'Note' in data:
            print(f"RATE LIMIT: {data['Note']}")
            return None
        
        time_series = data.get('Time Series (Daily)', {})
        if not time_series:
            print("ERROR: No time series data")
            return None
        
        records = []
        for date_str, vals in list(time_series.items())[:days]:
            records.append({
                'date': pd.to_datetime(date_str),
                'open': float(vals['1. open']),
                'high': float(vals['2. high']),
                'low': float(vals['3. low']),
                'close': float(vals['4. close']),
                'volume': int(vals['6. volume']),
            })
        
        df = pd.DataFrame(records).sort_values('date').reset_index(drop=True)
        print(f"✓ {len(df)} candles")
        return df
    
    except Exception as e:
        print(f"ERROR: {e}")
        return None


def fetch_yfinance_data(symbol, days=500):
    """
    Fetch historical daily OHLCV from Yahoo Finance.
    Returns DataFrame with columns: [date, open, high, low, close, volume]
    """
    if not YF_AVAILABLE:
        print(f"  Fetching {symbol} from Yahoo Finance... ERROR: yfinance not installed")
        return None

    print(f"  Fetching {symbol} from Yahoo Finance...", end=" ", flush=True)
    try:
        # Add margin for holidays/weekends and take last `days` trading candles after.
        start = (datetime.now() - timedelta(days=max(days * 2, 365))).strftime('%Y-%m-%d')
        end = datetime.now().strftime('%Y-%m-%d')
        data = yf.download(symbol, start=start, end=end, interval='1d', auto_adjust=False, progress=False)

        if data is None or data.empty:
            print("ERROR: No data")
            return None

        # yfinance can return MultiIndex columns depending on version/options.
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [
                col[0] if isinstance(col, tuple) and len(col) > 0 else str(col)
                for col in data.columns
            ]

        data = data.reset_index()
        normalized_columns = {str(col).lower(): col for col in data.columns}
        date_col = normalized_columns.get('date', data.columns[0])
        open_col = normalized_columns.get('open')
        high_col = normalized_columns.get('high')
        low_col = normalized_columns.get('low')
        close_col = normalized_columns.get('close')
        volume_col = normalized_columns.get('volume')

        if not all([open_col, high_col, low_col, close_col, volume_col]):
            print(f"ERROR: Missing OHLCV columns ({list(data.columns)})")
            return None

        df = pd.DataFrame({
            'date': pd.to_datetime(data[date_col]),
            'open': pd.to_numeric(data[open_col], errors='coerce'),
            'high': pd.to_numeric(data[high_col], errors='coerce'),
            'low': pd.to_numeric(data[low_col], errors='coerce'),
            'close': pd.to_numeric(data[close_col], errors='coerce'),
            'volume': pd.to_numeric(data[volume_col], errors='coerce').fillna(0),
        }).dropna(subset=['open', 'high', 'low', 'close'])

        df['volume'] = df['volume'].astype(int)
        df = df.sort_values('date').tail(days).reset_index(drop=True)
        if len(df) < 30:
            print(f"ERROR: Only {len(df)} candles")
            return None

        print(f"✓ {len(df)} candles")
        return df
    except Exception as e:
        print(f"ERROR: {e}")
        return None


def compute_technical_indicators(df):
    """
    Compute all 12 technical signals from OHLCV data.
    Returns DataFrame with additional columns for each signal.
    """
    df = df.copy()
    
    # Moving averages
    df['ma20'] = df['close'].rolling(20).mean()
    df['ma50'] = df['close'].rolling(50).mean()
    df['ma200'] = df['close'].rolling(200).mean()
    
    # RSI
    delta = df['close'].diff()
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    avg_gain = pd.Series(gain).rolling(14).mean()
    avg_loss = pd.Series(loss).rolling(14).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    df['rsi'] = 100 - (100 / (1 + rs))
    
    # MACD
    ema12 = df['close'].ewm(span=12, adjust=False).mean()
    ema26 = df['close'].ewm(span=26, adjust=False).mean()
    df['macd_line'] = ema12 - ema26
    df['macd_signal'] = df['macd_line'].ewm(span=9, adjust=False).mean()
    df['macd_histogram'] = df['macd_line'] - df['macd_signal']
    
    # Bollinger Bands
    df['bb_middle'] = df['close'].rolling(20).mean()
    df['bb_std'] = df['close'].rolling(20).std()
    df['bb_upper'] = df['bb_middle'] + (2 * df['bb_std'])
    df['bb_lower'] = df['bb_middle'] - (2 * df['bb_std'])
    df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'] + 1e-9)
    
    # KDJ (Stochastic)
    high = df['high'].rolling(9).max()
    low = df['low'].rolling(9).min()
    rsv = 100 * (df['close'] - low) / (high - low + 1e-9)
    df['kdj_k'] = rsv.ewm(span=3, adjust=False).mean()
    df['kdj_d'] = df['kdj_k'].ewm(span=3, adjust=False).mean()
    df['kdj_j'] = 3 * df['kdj_k'] - 2 * df['kdj_d']
    
    # OBV (On-Balance Volume)
    obv = (np.sign(df['close'].diff()) * df['volume']).fillna(0).cumsum()
    df['obv'] = obv
    df['obv_ma14'] = obv.rolling(14).mean()
    
    # VWAP
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    df['vwap'] = (typical_price * df['volume']).rolling(20).sum() / df['volume'].rolling(20).sum()
    
    return df


def create_signal_features(df):
    """
    Create 12 binary/continuous signal features:
    1. Price > MA50 (bullish)
    2. Price > MA200 (bullish)
    3. RSI zone (oversold/healthy/overbought)
    4. MACD bullish
    5. BB oversold
    6. KDJ oversold
    7. OBV bullish
    8. VWAP above
    9-12. Additional momentum signals
    """
    signals = pd.DataFrame(index=df.index)
    
    # 1. Price vs MA50
    signals['price_gt_ma50'] = (df['close'] > df['ma50']).astype(int)
    
    # 2. Price vs MA200
    signals['price_gt_ma200'] = (df['close'] > df['ma200']).astype(int)
    
    # 3. RSI zone
    signals['rsi_oversold'] = (df['rsi'] < 30).astype(int)
    signals['rsi_healthy'] = ((df['rsi'] >= 45) & (df['rsi'] <= 65)).astype(int)
    signals['rsi_overbought'] = (df['rsi'] > 70).astype(int)
    
    # 4. MACD bullish
    signals['macd_bullish'] = (df['macd_line'] > df['macd_signal']).astype(int)
    
    # 5. BB oversold
    signals['bb_oversold'] = (df['bb_position'] < 0.2).astype(int)
    signals['bb_overbought'] = (df['bb_position'] > 0.8).astype(int)
    
    # 6. KDJ oversold
    signals['kdj_oversold'] = (df['kdj_k'] < 20).astype(int)
    signals['kdj_overbought'] = (df['kdj_k'] > 80).astype(int)
    
    # 7. OBV bullish
    signals['obv_bullish'] = (df['obv'] > df['obv_ma14']).astype(int)
    
    # 8. VWAP above
    signals['price_gt_vwap'] = (df['close'] > df['vwap']).astype(int)
    
    # 9. Daily momentum
    signals['momentum_up'] = (df['close'].pct_change() > 0.015).astype(int)
    signals['momentum_down'] = (df['close'].pct_change() < -0.02).astype(int)
    
    # 10. Volatility
    signals['volatility_high'] = (df['close'].pct_change().rolling(5).std() > df['close'].pct_change().rolling(5).std().quantile(0.75)).astype(int)

    # Additional engineered features to improve model context.
    returns_1d = df['close'].pct_change()
    returns_5d = df['close'].pct_change(5)
    returns_20d = df['close'].pct_change(20)
    signals['ret_5d'] = returns_5d.fillna(0)
    signals['ret_20d'] = returns_20d.fillna(0)

    ma20_slope_5 = (df['ma20'] / df['ma20'].shift(5) - 1)
    ma50_slope_10 = (df['ma50'] / df['ma50'].shift(10) - 1)
    signals['ma20_slope_5'] = ma20_slope_5.replace([np.inf, -np.inf], np.nan).fillna(0)
    signals['ma50_slope_10'] = ma50_slope_10.replace([np.inf, -np.inf], np.nan).fillna(0)

    vol20 = returns_1d.rolling(20).std()
    vol20_mean = vol20.rolling(60).mean()
    vol20_std = vol20.rolling(60).std()
    vol_z = (vol20 - vol20_mean) / (vol20_std + 1e-9)
    signals['volatility_zscore'] = vol_z.replace([np.inf, -np.inf], np.nan).fillna(0)

    volume_ma20 = df['volume'].rolling(20).mean()
    volume_ratio = df['volume'] / (volume_ma20 + 1e-9)
    signals['volume_ratio_20'] = volume_ratio.replace([np.inf, -np.inf], np.nan).fillna(1)
    signals['volume_shock'] = (signals['volume_ratio_20'] > 1.6).astype(int)

    rolling_peak_60 = df['close'].rolling(60).max()
    drawdown_60 = df['close'] / (rolling_peak_60 + 1e-9) - 1
    signals['drawdown_60'] = drawdown_60.replace([np.inf, -np.inf], np.nan).fillna(0)

    trend_persistence_10 = (df['close'] > df['ma20']).astype(int).rolling(10).mean()
    signals['trend_persistence_10'] = trend_persistence_10.fillna(0)
    
    return signals


def create_target_variable(df, forward_days=5, threshold=0.02):
    """
    Create forward-looking binary target:
    1 = stock rises > threshold in next forward_days
    0 = stock falls <= threshold
    """
    future_return = df['close'].shift(-forward_days) / df['close'] - 1
    target = (future_return > threshold).astype(int)
    
    return target, future_return


def get_threshold_for_horizon(forward_days):
    """
    Horizon-aware target threshold:
    - SHORT (~5d): 2%
    - MEDIUM (~20d): 5%
    - LONG (~60d): 8%
    """
    if forward_days <= 7:
        return 0.02
    if forward_days <= 30:
        return 0.05
    return 0.08


def horizon_label(forward_days):
    if forward_days <= 7:
        return 'SHORT'
    if forward_days <= 30:
        return 'MEDIUM'
    return 'LONG'


def fit_xgboost_timeseries_cv(signals, target, n_splits=5, max_depth=5):
    """
    Fit XGBoost classifier with time-series cross-validation and return
    normalized feature importance plus fold-averaged metrics.
    """
    # Remove rows with NaN
    valid_idx = signals.notna().all(axis=1) & target.notna()
    X = signals[valid_idx].values
    y = target[valid_idx].values
    feature_names = signals.columns.tolist()

    if len(X) < 120:
        print(f"[WARNING] Only {len(X)} valid samples - model may be unreliable")

    if len(np.unique(y)) < 2:
        raise ValueError('Target has only one class after preprocessing; cannot train classifier')

    # Keep folds practical for smaller datasets
    dynamic_splits = max(2, min(n_splits, len(X) // 120))
    tscv = TimeSeriesSplit(n_splits=dynamic_splits)

    fold_metrics = []
    fold_importances = []

    print(f"  Training XGBoost with TimeSeriesSplit ({dynamic_splits} folds)...", flush=True)
    for fold_index, (train_idx, test_idx) in enumerate(tscv.split(X), start=1):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        # Skip folds that cannot train/evaluate binary classification.
        if len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
            print(f"    Fold {fold_index}: skipped (single-class split)")
            continue

        scaler = StandardScaler()
        X_train = scaler.fit_transform(X_train)
        X_test = scaler.transform(X_test)

        positive_count = int(np.sum(y_train == 1))
        negative_count = int(np.sum(y_train == 0))
        scale_pos_weight = (negative_count / max(positive_count, 1)) if positive_count > 0 else 1.0

        model = xgb.XGBClassifier(
            n_estimators=120,
            max_depth=max_depth,
            learning_rate=0.08,
            subsample=0.85,
            colsample_bytree=0.85,
            min_child_weight=2,
            random_state=42,
            use_label_encoder=False,
            eval_metric='logloss',
            verbosity=0,
            scale_pos_weight=scale_pos_weight,
        )
        model.fit(X_train, y_train, verbose=False)

        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)[:, 1]

        acc = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        try:
            auc = roc_auc_score(y_test, y_pred_proba)
        except Exception:
            auc = 0.5
        try:
            pr_auc = average_precision_score(y_test, y_pred_proba)
        except Exception:
            pr_auc = float(np.mean(y_test))

        fold_metrics.append((acc, f1, auc, pr_auc))
        fold_importances.append(model.feature_importances_)
        print(f"    Fold {fold_index}: Accuracy {acc:.3f} | F1 {f1:.3f} | AUC {auc:.3f} | PR-AUC {pr_auc:.3f}")

    if not fold_metrics:
        raise ValueError('No valid CV folds were produced; check data size/class distribution')

    avg_acc = float(np.mean([m[0] for m in fold_metrics]))
    avg_f1 = float(np.mean([m[1] for m in fold_metrics]))
    avg_auc = float(np.mean([m[2] for m in fold_metrics]))
    avg_pr_auc = float(np.mean([m[3] for m in fold_metrics]))
    print(f"  CV Avg: Accuracy {avg_acc:.3f} | F1 {avg_f1:.3f} | AUC {avg_auc:.3f} | PR-AUC {avg_pr_auc:.3f}")

    mean_importances = np.mean(np.vstack(fold_importances), axis=0)
    max_importance = float(np.max(mean_importances)) if np.max(mean_importances) > 0 else 1.0

    weights = {}
    for fname, importance in zip(feature_names, mean_importances):
        normalized_weight = (importance / max_importance) * 2
        weights[fname] = float(normalized_weight)

    metrics = {
        'accuracy': avg_acc,
        'f1_score': avg_f1,
        'auc': avg_auc,
        'pr_auc': avg_pr_auc,
        'folds': len(fold_metrics),
        'samples': int(len(X)),
    }
    return weights, metrics, fold_metrics


def blend_horizon_signal_weights(horizon_signal_weights, horizon_days):
    """
    Blend horizon-specific weights into one runtime set.
    Weighting preference: MEDIUM 0.4, SHORT 0.3, LONG 0.3
    """
    horizon_weighting = {'SHORT': 0.3, 'MEDIUM': 0.4, 'LONG': 0.3}

    all_keys = set()
    for weights in horizon_signal_weights.values():
        all_keys.update(weights.keys())

    blended = {}
    for key in all_keys:
        weighted_sum = 0.0
        weight_total = 0.0
        for days in horizon_days:
            label = horizon_label(days)
            h_key = str(days)
            if h_key not in horizon_signal_weights:
                continue
            w = float(horizon_weighting.get(label, 1.0 / max(1, len(horizon_days))))
            weighted_sum += horizon_signal_weights[h_key].get(key, 0.0) * w
            weight_total += w

        blended[key] = float(weighted_sum / weight_total) if weight_total > 0 else 0.0

    return blended


def extract_signal_weights(feature_weights):
    """
    Map feature importances to the 12 trade recommendation signals.
    Average multiple features that contribute to same signal.
    """
    signal_weights = {
        'trend_ma50_bullish': 2.0,
        'trend_ma50_bearish': -2.0,
        'trend_ma200_bullish': 1.0,
        'trend_ma200_bearish': -1.0,
        'rsi_oversold': 1.0,
        'rsi_healthy': 1.0,
        'rsi_overbought': -2.0,
        'sentiment_bullish': 2.0,
        'sentiment_bearish': -2.0,
        'analyst_buy_strong': 2.0,
        'analyst_buy_weak': -1.0,
        'analyst_upside': 1.0,
        'analyst_downside': -1.0,
        'momentum_strong_up': 1.0,
        'momentum_strong_down': -1.0,
        'macd_bullish': 1.0,
        'macd_bearish': -1.0,
        'bb_oversold': 1.0,
        'bb_overbought': -1.0,
        'kdj_oversold': 1.0,
        'kdj_overbought': -1.0,
        'obv_bullish': 1.0,
        'obv_bearish': -1.0,
        'vwap_above': 1.0,
        'vwap_below': -1.0,
        'macro_risk_bearish': -1.0,
        'macro_risk_bullish': 0.5,
        'macro_sentiment_bearish': -0.5,
        'macro_sentiment_bullish': 0.5,
        'macro_sector_headwind': -0.5,
        'eda_breakout_bullish': 0.5,
        'eda_breakout_bearish': -0.5,
        'eda_volume_bullish': 0.5,
        'eda_volatility_bearish': -0.5,
        'eda_trend_strength': 0.5,
        'eda_trend_weakness': -0.5,
    }
    
    # Use feature weights to calibrate defaults
    feature_to_signal = {
        'price_gt_ma50': 'trend_ma50_bullish',
        'price_gt_ma200': 'trend_ma200_bullish',
        'rsi_oversold': 'rsi_oversold',
        'rsi_healthy': 'rsi_healthy',
        'rsi_overbought': 'rsi_overbought',
        'macd_bullish': 'macd_bullish',
        'bb_oversold': 'bb_oversold',
        'bb_overbought': 'bb_overbought',
        'kdj_oversold': 'kdj_oversold',
        'kdj_overbought': 'kdj_overbought',
        'obv_bullish': 'obv_bullish',
        'price_gt_vwap': 'vwap_above',
        'momentum_up': 'momentum_strong_up',
        'momentum_down': 'momentum_strong_down',
    }
    
    for feature, signal in feature_to_signal.items():
        if feature in feature_weights:
            # Use model's magnitude while preserving predefined sign convention.
            default_sign = 1.0 if signal_weights[signal] >= 0 else -1.0
            signal_weights[signal] = abs(feature_weights[feature]) * default_sign
    
    return signal_weights


def main():
    parser = argparse.ArgumentParser(description='Calibrate signal weights using XGBoost')
    parser.add_argument('--symbols', default='AAPL,MSFT,GOOGL,NVDA,TSLA,AMD,NFLX', 
                       help='Comma-separated stock symbols')
    parser.add_argument('--days', type=int, default=500, help='Days of history to fetch')
    parser.add_argument('--output', default='backend/lib/signal-weights.json', 
                       help='Output weights file')
    parser.add_argument('--api-key', default=None, help='Alpha Vantage API key (env: ALPHA_VANTAGE_API_KEY)')
    parser.add_argument('--source', default='auto', choices=['auto', 'yahoo', 'alpha'],
                       help='Data source preference: auto (default), yahoo, or alpha')
    parser.add_argument('--horizons', default='5,20,60',
                       help='Comma-separated forward-day horizons for calibration (e.g., 5,20,60)')
    parser.add_argument('--cv-splits', type=int, default=5,
                       help='Number of TimeSeriesSplit folds (auto-capped for small datasets)')
    
    args = parser.parse_args()
    
    if not ML_AVAILABLE:
        print("[ERROR] XGBoost/sklearn required. Install with: pip install xgboost scikit-learn")
        return
    
    # Get API key (only needed when alpha path is used)
    api_key = args.api_key or os.getenv('ALPHA_VANTAGE_API_KEY')
    
    symbols = [s.strip() for s in args.symbols.split(',') if s.strip()]
    horizon_days = sorted({int(h.strip()) for h in args.horizons.split(',') if h.strip()})

    print(f"\n=== Signal Calibration (XGBoost) ===")
    print(f"Symbols: {', '.join(symbols)}")
    print(f"History: {args.days} days")
    print(f"Horizons: {horizon_days} (days)\n")
    
    # Collect all data
    all_signals_by_horizon = {str(h): [] for h in horizon_days}
    all_targets_by_horizon = {str(h): [] for h in horizon_days}
    
    for symbol in symbols:
        df = None
        if args.source == 'yahoo':
            df = fetch_yfinance_data(symbol, days=args.days)
        elif args.source == 'alpha':
            if not api_key:
                print(f"  Skipping {symbol} (alpha source selected but API key missing)")
                continue
            df = fetch_alpha_vantage_data(symbol, api_key, days=args.days)
        else:
            # auto mode: prefer Yahoo for better ASX coverage, fallback to Alpha when available.
            df = fetch_yfinance_data(symbol, days=args.days)
            if (df is None or len(df) < 100) and api_key:
                print(f"  Yahoo fallback to Alpha Vantage for {symbol}")
                df = fetch_alpha_vantage_data(symbol, api_key, days=args.days)

        if df is None or len(df) < 100:
            print(f"  Skipping {symbol} (insufficient data)")
            continue
        
        # Compute indicators
        df = compute_technical_indicators(df)
        
        # Create shared signal matrix once, then horizon-specific targets.
        signals = create_signal_features(df)
        for h in horizon_days:
            threshold = get_threshold_for_horizon(h)
            target, _ = create_target_variable(df, forward_days=h, threshold=threshold)
            all_signals_by_horizon[str(h)].append(signals)
            all_targets_by_horizon[str(h)].append(target)
    
    if not any(all_signals_by_horizon[str(h)] for h in horizon_days):
        print("[ERROR] No valid data collected")
        return

    horizon_feature_weights = {}
    horizon_signal_weights = {}
    horizon_metrics = {}
    horizon_samples = {}

    for h in horizon_days:
        h_key = str(h)
        if not all_signals_by_horizon[h_key]:
            print(f"\n[H={h}] skipped (no collected samples)")
            continue

        combined_signals = pd.concat(all_signals_by_horizon[h_key], ignore_index=True)
        combined_targets = pd.concat(all_targets_by_horizon[h_key], ignore_index=True)

        print(f"\n[H={h}d | {horizon_label(h)}]")
        print(f"  Total samples: {len(combined_signals)}")
        print(f"  Positive class: {combined_targets.sum()} ({100*combined_targets.mean():.1f}%)")

        feature_weights, metrics, _ = fit_xgboost_timeseries_cv(
            combined_signals,
            combined_targets,
            n_splits=args.cv_splits,
        )

        signal_weights = extract_signal_weights(feature_weights)
        horizon_feature_weights[h_key] = feature_weights
        horizon_signal_weights[h_key] = signal_weights
        horizon_metrics[h_key] = metrics
        horizon_samples[h_key] = int(len(combined_signals))

    if not horizon_signal_weights:
        print('[ERROR] No horizon model completed successfully')
        return

    # Build runtime weight set as blended short/medium/long profile.
    signal_weights = blend_horizon_signal_weights(horizon_signal_weights, horizon_days)

    avg_acc = float(np.mean([m['accuracy'] for m in horizon_metrics.values()]))
    avg_f1 = float(np.mean([m['f1_score'] for m in horizon_metrics.values()]))
    avg_auc = float(np.mean([m['auc'] for m in horizon_metrics.values()]))
    avg_pr_auc = float(np.mean([m.get('pr_auc', 0.0) for m in horizon_metrics.values()]))

    # Blended feature importances for diagnostics.
    blended_feature_importance = {}
    all_feature_names = set()
    for feature_map in horizon_feature_weights.values():
        all_feature_names.update(feature_map.keys())
    for feature_name in all_feature_names:
        vals = [horizon_feature_weights[h].get(feature_name, 0.0) for h in horizon_feature_weights]
        blended_feature_importance[feature_name] = float(np.mean(vals))
    
    # Output
    enriched_signal_weights = {
        key: {
            'points': float(round(value, 3)),
            'description': f'Calibrated weight for {key}'
        }
        for key, value in signal_weights.items()
    }

    output = {
        'timestamp': datetime.now().isoformat(),
        'version': '2.1-timeseries-horizon-calibrated',
        'note': 'Time-series CV calibration with blended SHORT/MEDIUM/LONG horizon profiles',
        'symbols': symbols,
        'samples': int(sum(horizon_samples.values())),
        'positive_ratio': None,
        'model_metrics': {
            'accuracy': avg_acc,
            'f1_score': avg_f1,
            'auc': avg_auc,
            'pr_auc': avg_pr_auc,
            'status': 'Time-series CV horizon calibration complete',
        },
        'signal_weights': enriched_signal_weights,
        'signal_weights_by_horizon': {
            h: {
                k: {
                    'points': float(round(v, 3)),
                    'description': f'H{h} calibrated weight for {k}'
                }
                for k, v in sw.items()
            }
            for h, sw in horizon_signal_weights.items()
        },
        'feature_importance': blended_feature_importance,
        'feature_importance_by_horizon': horizon_feature_weights,
        'horizon_metrics': horizon_metrics,
        'calibration_notes': {
            'data_sources': ['Yahoo Finance', 'Alpha Vantage fallback'],
            'target_variable': 'Forward return threshold varies by horizon (5d=2%, 20d=5%, 60d=8%)',
            'model_type': 'XGBoost classifier with StandardScaler + TimeSeriesSplit CV',
            'feature_count': len(next(iter(horizon_feature_weights.values()))) if horizon_feature_weights else 0,
            'historical_symbols': symbols,
            'horizons_days': horizon_days,
            'cv_splits': args.cv_splits,
            'blend_weights': {'SHORT': 0.3, 'MEDIUM': 0.4, 'LONG': 0.3},
            'class_imbalance_handling': 'Per-fold scale_pos_weight = negatives/positives',
        },
    }
    
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✓ Weights saved to: {args.output}")
    print(f"\nCalibrated Signal Weights:")
    for signal, weight in sorted(signal_weights.items()):
        print(f"  {signal}: {weight:.2f}")


if __name__ == '__main__':
    main()
