// Frontend UI shell behavior: theme, device mode, and mobile tab switching.

function toggleTheme() {
  const body = document.body;
  const isLight = body.getAttribute('data-theme') === 'light';
  if (isLight) {
    body.removeAttribute('data-theme');
    localStorage.setItem('quantbot.theme', 'dark');
    document.getElementById('theme-icon-light').style.display = 'block';
    document.getElementById('theme-icon-dark').style.display = 'none';
  } else {
    body.setAttribute('data-theme', 'light');
    localStorage.setItem('quantbot.theme', 'light');
    document.getElementById('theme-icon-light').style.display = 'none';
    document.getElementById('theme-icon-dark').style.display = 'block';
  }
}

// Ensure theme is set immediately on load.
(function() {
  const saved = localStorage.getItem('quantbot.theme');
  if (saved === 'light') {
    document.body.setAttribute('data-theme', 'light');
  }
})();

function detectDevice() {
  const isMobile = window.innerWidth <= 900 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    document.body.classList.add('is-mobile');
    document.body.classList.remove('is-desktop');
    if (!document.body.classList.contains('show-chat') && !document.body.classList.contains('show-analysis')) {
      document.body.classList.add('show-chat');
    }
  } else {
    document.body.classList.add('is-desktop');
    document.body.classList.remove('is-mobile');
    document.body.classList.remove('show-chat', 'show-analysis');
  }
}

function setMobileTab(tab) {
  if (tab === 'chat') {
    document.body.classList.add('show-chat');
    document.body.classList.remove('show-analysis');
  } else {
    document.body.classList.add('show-analysis');
    document.body.classList.remove('show-chat');
  }
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  detectDevice();
  window.addEventListener('resize', detectDevice);

  const saved = localStorage.getItem('quantbot.theme');
  if (saved === 'light') {
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon) darkIcon.style.display = 'block';
  }
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHtmlFragment(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');

  doc.querySelectorAll('script, iframe, object, embed, link, meta, base').forEach((node) => node.remove());

  const nodes = doc.body.querySelectorAll('*');
  nodes.forEach((el) => {
    const attrs = Array.from(el.attributes || []);
    attrs.forEach((attr) => {
      const name = String(attr.name || '').toLowerCase();
      const value = String(attr.value || '').trim();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }

      if ((name === 'href' || name === 'src') && /^javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}

function sanitizeElementHtml(element) {
  if (!element) return;
  element.innerHTML = sanitizeHtmlFragment(element.innerHTML);
}

window.toggleTheme = toggleTheme;
window.setMobileTab = setMobileTab;
window.escapeHtml = escapeHtml;
window.sanitizeHtmlFragment = sanitizeHtmlFragment;
window.sanitizeElementHtml = sanitizeElementHtml;
