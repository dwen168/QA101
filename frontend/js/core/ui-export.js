// Frontend UI export and menu handlers (no backend inference logic).
function toggleExportMenu(event) {
  event.stopPropagation();
  closeInfoMenu();
  closeReportsMenu();
  const dropdown = document.getElementById('export-dropdown');
  dropdown.classList.toggle('open');
}

function closeExportMenu() {
  document.getElementById('export-dropdown')?.classList.remove('open');
}

function toggleInfoMenu(event) {
  event.stopPropagation();
  closeExportMenu();
  closeReportsMenu();
  const dropdown = document.getElementById('info-dropdown');
  dropdown.classList.toggle('open');
}

function closeInfoMenu() {
  document.getElementById('info-dropdown')?.classList.remove('open');
}

function toggleReportsMenu(event) {
  event.stopPropagation();
  closeExportMenu();
  closeInfoMenu();
  const dropdown = document.getElementById('reports-menu-dropdown');
  dropdown?.classList.toggle('open');
  if (dropdown?.classList.contains('open')) {
    loadReportsList();
  }
}

function closeReportsMenu() {
  document.getElementById('reports-menu-dropdown')?.classList.remove('open');
}

function hasExportableContent() {
  const panel = document.getElementById('analysis-panel');
  return !!panel && !panel.querySelector('#welcome-state') && panel.children.length > 0;
}

function buildExportFilename(extension) {
  const panel = document.getElementById('analysis-panel');
  const ticker = panel?.querySelector('.ticker-symbol')?.textContent?.trim();
  const section = panel?.querySelector('.section-divider-text')?.textContent?.trim();
  const label = (ticker || section || 'analysis')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stamp = new Date().toISOString().slice(0, 10);
  return `quantbot-${label || 'analysis'}-${stamp}.${extension}`;
}

function clonePanelForExport() {
  const panel = document.getElementById('analysis-panel');
  const clone = panel.cloneNode(true);
  const sourceCanvases = Array.from(panel.querySelectorAll('canvas'));
  const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));

  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.alt = 'Exported chart';

    try {
      img.src = sourceCanvas.toDataURL('image/png');
      canvas.replaceWith(img);
    } catch {
      const fallback = document.createElement('div');
      fallback.className = 'card';
      fallback.style.padding = '14px';
      fallback.style.fontSize = '12px';
      fallback.style.color = 'var(--text2)';
      fallback.textContent = 'Chart preview unavailable in export.';
      canvas.replaceWith(fallback);
    }
  });

  const tvContainerClone = clone.querySelector('#tv-price-container');
  const liveTvChart = currentCharts['tv-price'];
  if (tvContainerClone && liveTvChart && typeof liveTvChart.takeScreenshot === 'function') {
    try {
      const screenshot = liveTvChart.takeScreenshot();
      const img = document.createElement('img');
      img.src = screenshot.toDataURL('image/png');
      img.alt = 'Candlestick chart snapshot';
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
      tvContainerClone.innerHTML = '';
      tvContainerClone.appendChild(img);
      tvContainerClone.style.height = 'auto';
      tvContainerClone.style.minHeight = '180px';
      tvContainerClone.style.overflow = 'hidden';
    } catch {
      // Keep cloned chart DOM if screenshot capture is unavailable.
    }
  }

  clone.id = 'export-analysis-panel';
  clone.querySelector('#reports-fab')?.remove();
  clone.querySelector('#reports-drawer')?.remove();
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  clone.style.padding = '0';
  clone.style.overflow = 'visible';
  return clone;
}

function buildSavableReportHtml() {
  const exportedPanel = clonePanelForExport();
  return exportedPanel.innerHTML;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function collectExportStyles() {
  const styleChunks = [];

  for (const sheet of Array.from(document.styleSheets || [])) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      if (rules.length) {
        styleChunks.push(rules.map((rule) => rule.cssText).join('\n'));
      }
    } catch {
      // Ignore stylesheets that cannot be read due to browser restrictions.
    }
  }

  return styleChunks.join('\n');
}

function buildBodyExportAttributes() {
  const attrs = [];
  const theme = document.body.getAttribute('data-theme');
  const bodyClass = (document.body.className || '').trim();

  if (theme) attrs.push(`data-theme="${escapeHtml(theme)}"`);
  if (bodyClass) attrs.push(`class="${escapeHtml(bodyClass)}"`);

  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

async function buildExportDocument() {
  const styles = collectExportStyles();
  const exportedPanel = clonePanelForExport();
  const title = buildExportFilename('html').replace(/\.html$/, '');
  const bodyAttrs = buildBodyExportAttributes();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
${styles}
* { box-sizing: border-box; }
body { height: auto; overflow: visible; padding: 24px; background: var(--bg); }
.export-shell { max-width: 1280px; margin: 0 auto; }
.analysis-panel { padding: 0; overflow: visible; max-width: 100%; }
.chart-full, .chart-wrap, .card { max-width: 100%; overflow: hidden; }
.chart-title-group, .chart-legend, .chart-legend-values { min-width: 0; flex-wrap: wrap; }
.chart-canvas-wrap, .chart-full .chart-canvas-wrap { height: auto; min-height: 180px; }
canvas, img { max-width: 100%; width: 100%; height: auto; }
@media print {
  body { padding: 0; }
  .export-shell { max-width: none; }
  .card, .chart-wrap, .chart-full, .risk-flag { break-inside: avoid; page-break-inside: avoid; }
}
</style>
</head>
<body${bodyAttrs}>
  <div class="export-shell">
    ${exportedPanel.outerHTML}
  </div>
</body>
</html>`;
}

async function exportCurrentView(format) {
  closeExportMenu();

  if (!hasExportableContent()) {
    alert('Run an analysis, portfolio optimization, or backtest first.');
    return;
  }

  const exportHtml = await buildExportDocument();

  if (format === 'html') {
    const blob = new Blob([exportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildExportFilename('html');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  if (format === 'pdf') {
    const existingFrame = document.getElementById('print-export-frame');
    if (existingFrame) existingFrame.remove();

    const frame = document.createElement('iframe');
    frame.id = 'print-export-frame';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);

    const frameDoc = frame.contentWindow?.document;
    if (!frameDoc || !frame.contentWindow) {
      frame.remove();
      alert('PDF export is unavailable in this browser context.');
      return;
    }

    frameDoc.open();
    frameDoc.write(exportHtml);
    frameDoc.close();

    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }, 300);

      const cleanup = () => setTimeout(() => frame.remove(), 1000);
      frame.contentWindow.onafterprint = cleanup;
      setTimeout(cleanup, 60000);
    };
  }
}

window.toggleExportMenu = toggleExportMenu;
window.closeExportMenu = closeExportMenu;
window.toggleInfoMenu = toggleInfoMenu;
window.closeInfoMenu = closeInfoMenu;
window.toggleReportsMenu = toggleReportsMenu;
window.closeReportsMenu = closeReportsMenu;
window.exportCurrentView = exportCurrentView;

