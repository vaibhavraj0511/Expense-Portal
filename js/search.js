// js/search.js — Global transaction search module

import * as store from './store.js';
import { formatCurrency, formatDate } from './utils.js';

let _debounceTimer = null;
let _modalEl = null;
let _inputEl = null;
let _resultsEl = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalise(str) {
  return String(str ?? '').toLowerCase();
}

function matchesQuery(fields, query) {
  const q = normalise(query);
  return fields.some(f => normalise(f).includes(q));
}

function searchExpenses(query) {
  return (store.get('expenses') ?? [])
    .map((r, i) => ({ ...r, _idx: i }))
    .filter(r => matchesQuery([
      r.description, r.category, r.subCategory, r.paymentMethod, String(r.amount)
    ], query))
    .map(r => ({
      type: 'expense',
      date: r.date,
      primary: r.description.replace(/\s*\[ve:[^\]]+\]/, ''),
      secondary: r.category + (r.subCategory ? ` · ${r.subCategory}` : ''),
      amount: r.amount,
      tab: 'tab-expenses',
    }));
}

function searchIncome(query) {
  return (store.get('income') ?? [])
    .map((r, i) => ({ ...r, _idx: i }))
    .filter(r => matchesQuery([
      r.description, r.source, r.receivedIn, String(r.amount)
    ], query))
    .map(r => ({
      type: 'income',
      date: r.date,
      primary: r.description,
      secondary: r.source + (r.receivedIn ? ` · ${r.receivedIn}` : ''),
      amount: r.amount,
      tab: 'tab-income',
    }));
}

function searchTransfers(query) {
  return (store.get('transfers') ?? [])
    .filter(r => matchesQuery([
      r.description, r.sourceAccount, r.destinationAccount, String(r.amount)
    ], query))
    .map(r => ({
      type: 'transfer',
      date: r.date,
      primary: r.description || 'Transfer',
      secondary: `${r.sourceAccount} → ${r.destinationAccount}`,
      amount: r.amount,
      tab: 'tab-transfers',
    }));
}

const TYPE_CONFIG = {
  expense:  { label: 'Expense',  badgeClass: 'gs-badge-expense',  icon: 'bi-arrow-up-circle-fill',    amountClass: 'gs-amount-expense' },
  income:   { label: 'Income',   badgeClass: 'gs-badge-income',   icon: 'bi-arrow-down-circle-fill',  amountClass: 'gs-amount-income'  },
  transfer: { label: 'Transfer', badgeClass: 'gs-badge-transfer', icon: 'bi-arrow-left-right',        amountClass: 'gs-amount-transfer' },
};

function renderResults(groups) {
  if (!_resultsEl) return;

  const total = groups.reduce((s, g) => s + g.items.length, 0);
  if (total === 0) {
    _resultsEl.innerHTML = '<div class="gs-empty"><i class="bi bi-search"></i><p>No results found</p></div>';
    return;
  }

  _resultsEl.innerHTML = groups.map(({ type, items }) => {
    if (items.length === 0) return '';
    const cfg = TYPE_CONFIG[type];
    const rows = items.slice(0, 20).map(item => `
      <button class="gs-result-item" data-tab="${escapeHtml(item.tab)}" type="button">
        <div class="gs-result-icon ${type}-icon"><i class="bi ${cfg.icon}"></i></div>
        <div class="gs-result-body">
          <div class="gs-result-primary">${escapeHtml(item.primary)}</div>
          <div class="gs-result-secondary">${escapeHtml(item.secondary)}</div>
        </div>
        <div class="gs-result-right">
          <div class="gs-result-amount ${cfg.amountClass}">${formatCurrency(item.amount)}</div>
          <div class="gs-result-date">${formatDate(item.date)}</div>
        </div>
      </button>
    `).join('');

    return `
      <div class="gs-group">
        <div class="gs-group-header">
          <span class="gs-badge ${cfg.badgeClass}">${cfg.label}</span>
          <span class="gs-group-count">${items.length} result${items.length !== 1 ? 's' : ''}</span>
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  // Bind click handlers
  _resultsEl.querySelectorAll('.gs-result-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      _closeModal();
      // Navigate to the tab
      const navBtn = document.querySelector(`.ep-nav-item[data-tab="${tabId}"]`);
      if (navBtn) navBtn.click();
    });
  });
}

function runSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    if (_resultsEl) _resultsEl.innerHTML = '<div class="gs-empty"><i class="bi bi-search"></i><p>Type at least 2 characters to search</p></div>';
    return;
  }

  const expenses  = searchExpenses(q);
  const income    = searchIncome(q);
  const transfers = searchTransfers(q);

  renderResults([
    { type: 'expense',  items: expenses },
    { type: 'income',   items: income },
    { type: 'transfer', items: transfers },
  ]);
}

function _openModal() {
  if (!_modalEl) return;
  bootstrap.Modal.getOrCreateInstance(_modalEl).show();
  setTimeout(() => _inputEl?.focus(), 150);
}

function _closeModal() {
  if (!_modalEl) return;
  bootstrap.Modal.getInstance(_modalEl)?.hide();
}

export function initSearch() {
  _modalEl   = document.getElementById('global-search-modal');
  _inputEl   = document.getElementById('global-search-input');
  _resultsEl = document.getElementById('global-search-results');

  if (!_modalEl) return;

  // Open button
  document.getElementById('global-search-btn')?.addEventListener('click', _openModal);

  // Input handler with debounce
  _inputEl?.addEventListener('input', () => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => runSearch(_inputEl.value), 300);
  });

  // Clear results when modal closes
  _modalEl.addEventListener('hidden.bs.modal', () => {
    if (_inputEl) _inputEl.value = '';
    if (_resultsEl) _resultsEl.innerHTML = '<div class="gs-empty"><i class="bi bi-search"></i><p>Type at least 2 characters to search</p></div>';
  });

  // Keyboard shortcut: '/' opens search (when not in an input)
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    _openModal();
  });
}
