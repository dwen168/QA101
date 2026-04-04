// Frontend UI report persistence (browser localStorage only).
const REPORTS_STORAGE_KEY = 'quantbot.reports.v1';

function readLocalReports() {
  try {
    const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalReports(reports) {
  localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
}

function updateReportsBadge(count) {
  const badge = document.getElementById('reports-count');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

function formatReportTimestamp(createdAt) {
  return new Date(createdAt).toLocaleString('en-AU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function renderReportsMenu(reports) {
  const container = document.getElementById('reports-menu-list');
  if (!container) return;

  if (!reports.length) {
    container.innerHTML = '<div class="reports-menu-empty">No saved reports yet.<br>Use Save to Reports Library after generating an analysis.</div>';
    return;
  }

  container.innerHTML = reports.map((report) => `
    <div class="report-menu-item">
      <div class="report-menu-meta">
        <div class="report-menu-ticker">${report.ticker}</div>
        <div class="report-menu-label" title="${report.label}">${report.label}</div>
        <div class="report-menu-date">${formatReportTimestamp(report.created_at)}</div>
      </div>
      <div class="report-menu-actions">
        <button class="report-menu-action load" onclick="event.stopPropagation();restoreReport(${report.id})">Load</button>
        <button class="report-menu-action delete" onclick="event.stopPropagation();deleteReport(${report.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function loadReportsList() {
  const menuContainer = document.getElementById('reports-menu-list');
  if (menuContainer) {
    menuContainer.innerHTML = '<div class="reports-menu-empty">Loading...</div>';
  }
  try {
    const reports = readLocalReports().sort((a, b) => Number(b.id) - Number(a.id));

    updateReportsBadge(reports.length);
    renderReportsMenu(reports);
  } catch (err) {
    if (menuContainer) {
      menuContainer.innerHTML = `<div class="reports-menu-empty" style="color:var(--red)">Error loading reports: ${err.message}</div>`;
    }
  }
}

async function saveCurrentReport() {
  if (!hasExportableContent()) {
    showToast('❌ Run an analysis before saving a report', 'error');
    return;
  }

  const panel = document.getElementById('analysis-panel');
  const html = buildSavableReportHtml();
  const payloadBytes = new Blob([html]).size;

  if (payloadBytes > 9 * 1024 * 1024) {
    showToast('❌ Report is too large to save', 'error');
    return;
  }

  // Try to extract ticker from the panel
  const tickerEl = panel.querySelector('.ticker-symbol');
  const ticker = tickerEl ? tickerEl.textContent.trim() : 'UNKNOWN';

  const label = prompt(`Save report label for ${ticker}:`, `${ticker} — ${new Date().toLocaleDateString('en-AU')}`);
  if (!label) return; // user cancelled

  try {
    const reports = readLocalReports();
    const nextId = reports.length ? Math.max(...reports.map((item) => Number(item.id) || 0)) + 1 : 1;
    const data = {
      id: nextId,
      ticker,
      label,
      html,
      created_at: new Date().toISOString(),
    };

    reports.push(data);
    writeLocalReports(reports);

    if (data.id) {
      showToast(`✅ Report saved (ID: ${data.id})`);
      closeExportMenu();
      await loadReportsList();

      const reportsDropdown = document.getElementById('reports-menu-dropdown');
      if (reportsDropdown && !reportsDropdown.classList.contains('open')) {
        reportsDropdown.classList.add('open');
      }
    } else {
      showToast(`❌ Save failed: ${data.error || 'unknown'}`, 'error');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function restoreReport(id) {
  try {
    const report = readLocalReports().find((item) => Number(item.id) === Number(id));
    if (!report) throw new Error('Report not found');

    const panel = document.getElementById('analysis-panel');
    const welcome = document.getElementById('welcome-state');
    if (welcome) welcome.style.display = 'none';

    panel.innerHTML = report.html;
    closeReportsMenu();
    showToast(`📂 Loaded: ${report.label}`);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

async function deleteReport(id) {
  if (!confirm('Delete this saved report?')) return;
  try {
    const reports = readLocalReports();
    const nextReports = reports.filter((item) => Number(item.id) !== Number(id));

    if (nextReports.length !== reports.length) {
      writeLocalReports(nextReports);
      showToast('🗑 Report deleted');
      loadReportsList();
    } else {
      showToast('❌ Report could not be deleted', 'error');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

function showToast(message, type = 'success') {
  const existing = document.getElementById('qb-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'qb-toast';
  const bg = type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)';
  const border = type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)';
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:10px;font-size:13px;font-family:var(--mono);background:${bg};border:1px solid ${border};color:var(--text);backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,0.3);animation:fadeIn 0.3s ease;pointer-events:none`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Inject "Save Report" button into the export dropdown on startup
document.addEventListener('DOMContentLoaded', () => {
  const dropdown = document.getElementById('export-dropdown');
  if (dropdown) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'export-option';
    saveBtn.onclick = saveCurrentReport;
    saveBtn.innerHTML = `Save to Reports Library <span>Browser</span>`;
    dropdown.insertBefore(saveBtn, dropdown.firstChild);
  }

  loadReportsList().catch(() => {});
});
