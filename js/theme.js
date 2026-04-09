// js/theme.js — Theme Manager
// Handles dark/light mode persistence and toggling.

const STORAGE_KEY = 'theme';

function getPreferred() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
  } else {
    document.body.removeAttribute('data-theme');
  }
  updateToggleIcon(theme);
}

function updateToggleIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (!icon) return;
  if (theme === 'dark') {
    icon.className = 'bi bi-sun-fill';
    btn.setAttribute('aria-label', 'Switch to light mode');
  } else {
    icon.className = 'bi bi-moon-stars-fill';
    btn.setAttribute('aria-label', 'Switch to dark mode');
  }
}

export function initTheme() {
  const theme = getPreferred();
  applyTheme(theme);
}

export function toggleTheme() {
  const current = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
}
