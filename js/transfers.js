// js/transfers.js — Account-to-account transfers module
// Requirements: 15.1–15.9

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber, requireDifferentValues } from './validation.js';
import { formatCurrency, formatDate } from './utils.js';
import { createPaginator } from './paginate.js';

// ─── Serialization (Task 11.1) ───────────────────────────────────────────────
// Columns: A=id, B=date, C=sourceAccount, D=destinationAccount, E=amount, F=description

/**
 * Converts a TransferRecord object to a row array for Google Sheets.
 * @param {{ id: string, date: string, sourceAccount: string, destinationAccount: string, amount: number, description: string }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.id,
    record.date,
    record.sourceAccount,
    record.destinationAccount,
    String(record.amount),
    record.description,
  ];
}

/**
 * Converts a raw Sheets row array to a TransferRecord object.
 * @param {string[]} row
 * @returns {{ id: string, date: string, sourceAccount: string, destinationAccount: string, amount: number, description: string }}
 */
export function deserialize(row) {
  return {
    id: row[0] ?? '',
    date: row[1] ?? '',
    sourceAccount: row[2] ?? '',
    destinationAccount: row[3] ?? '',
    amount: parseFloat(row[4]) || 0,
    description: row[5] ?? '',
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(message) {
  const banner = document.getElementById('transfer-error-banner');
  if (!banner) return;
  const textEl = document.getElementById('transfer-error-banner-text');
  if (textEl) textEl.textContent = message; else banner.textContent = message;
  banner.classList.remove('d-none');
}

function hideError() {
  const banner = document.getElementById('transfer-error-banner');
  if (banner) banner.classList.add('d-none');
}

function populateAccountDropdowns() {
  const accounts = store.get('accounts') ?? [];
  // Only non-credit-card accounts (accounts have a 'type' field; credit cards do not)
  const names = accounts.map(a => a.name);

  ['transfer-source', 'transfer-dest'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Select account…</option>' +
      names.map(n => `<option value="${escapeHtml(n)}"${n === current ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');
  });
}

// ─── Filter state ────────────────────────────────────────────────────────────

const filterState = {
  sourceAccounts: [],
  destAccounts: [],
  dateFrom: '',
  dateTo: '',
  search: '',
};

function applyFilters(records) {
  const q = filterState.search.toLowerCase().trim();
  return records.filter(r => {
    if (filterState.sourceAccounts.length > 0 && !filterState.sourceAccounts.includes(r.sourceAccount)) return false;
    if (filterState.destAccounts.length > 0 && !filterState.destAccounts.includes(r.destinationAccount)) return false;
    if (filterState.dateFrom && r.date < filterState.dateFrom) return false;
    if (filterState.dateTo && r.date > filterState.dateTo) return false;
    if (q && !String(r.description ?? '').toLowerCase().includes(q)
          && !String(r.sourceAccount ?? '').toLowerCase().includes(q)
          && !String(r.destinationAccount ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

// ─── Account icon helper ─────────────────────────────────────────────────────
function _pmIcon(name) {
  if (!name) return 'bi-bank2';
  const n = name.toLowerCase();
  if (n.includes('cash')) return 'bi-cash-coin';
  if (n.includes('wallet') || n.includes('gpay') || n.includes('paytm') || n.includes('phonepe') || n.includes('upi')) return 'bi-wallet2';
  if (n.includes('card') || n.includes('credit') || n.includes('visa') || n.includes('mastercard') || n.includes('amex')) return 'bi-credit-card-2-front';
  return 'bi-bank2';
}

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'transfer-cards',
      paginationId: 'transfer-pagination',
      pageInfoId: 'transfer-page-info',
      pageSizeSelectId: 'transfer-page-size',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('transfer-cards');
        const emptyState = document.getElementById('transfer-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const _dayDate = d => { try { return new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); } catch(e) { return formatDate(d); } };
        container.innerHTML = `<div class="data-cards-grid">${slice.map(t => {
          const fallbackDesc = `${escapeHtml(t.sourceAccount)} \u2192 ${escapeHtml(t.destinationAccount)}`;
          return `
          <div class="ecard ecard--transfer">
            <div class="ecard-top">
              <div class="ecard-icon" style="background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 4px 12px rgba(59,130,246,.3)"><i class="bi ${_pmIcon(t.sourceAccount)}"></i></div>
              <div class="ecard-body">
                <div class="ecard-flow">
                  <span class="ecard-flow-acct">${escapeHtml(t.sourceAccount)}</span>
                  <i class="bi bi-arrow-right ecard-flow-sep"></i>
                  <span class="ecard-flow-acct">${escapeHtml(t.destinationAccount)}</span>
                </div>
                <div class="ecard-amount ecard-amount--transfer tr-card-amount"><span class="tr-amt-prefix">&#8644;</span>${formatCurrency(t.amount)}</div>
                ${t.description ? `<div class="ecard-desc ecard-desc--sub">${escapeHtml(t.description)}</div>` : ''}
              </div>
            </div>
            <div class="ecard-footer">
              <span class="ecard-chip"><i class="bi bi-calendar3 me-1"></i>${_dayDate(t.date)}</span>
              <div class="ecard-actions">
                <button class="ecard-btn ecard-btn--del" data-delete-transfer="${escapeHtml(t.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')}</div>`;
        container.querySelectorAll('[data-delete-transfer]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(btn.dataset.deleteTransfer));
        });
      },
    });
  }
  return _paginator;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

import { epConfirm } from './confirm.js';
import { showUndoToast } from './undo.js';

async function _deleteRecord(id) {
  if (!await epConfirm('Delete this transfer?')) return;
  const allRecords = store.get('transfers') ?? [];
  const deleted = allRecords.find(t => t.id === id);
  const records = allRecords.filter(t => t.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.transfers, records.map(serialize));
    store.set('transfers', records);
    showUndoToast('Transfer deleted', async () => {
      const current = [...(store.get('transfers') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.transfers, current.map(serialize));
      store.set('transfers', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── render() (Task 11.3) ────────────────────────────────────────────────────

/**
 * Reads transfers from the store, sorts by date descending, renders into #transfer-table-body.
 * Shows #transfer-empty-state when empty.
 * Requirements: 15.6, 15.8
 */
export function render() {
  const all = [...(store.get('transfers') ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const transfers = applyFilters(all);

  // Stat cards
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = all.filter(t => String(t.date ?? '').startsWith(curYM)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const lastMonth = all.filter(t => String(t.date ?? '').startsWith(prevYM)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const ytdStart = `${now.getFullYear()}-01-01`;
  const ytdVolume = all.filter(t => String(t.date ?? '') >= ytdStart).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const el = id => document.getElementById(id);
  if (el('tr-stat-last-month')) el('tr-stat-last-month').textContent = formatCurrency(lastMonth);
  if (el('tr-stat-this-month')) el('tr-stat-this-month').textContent = formatCurrency(thisMonth);
  if (el('tr-stat-volume')) el('tr-stat-volume').textContent = formatCurrency(ytdVolume);

  // Delta on This Month card
  const deltaEl = el('tr-stat-delta');
  if (deltaEl) {
    if (lastMonth > 0) {
      const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
      const up = pct >= 0;
      deltaEl.className = `sec-stat-delta ${up ? 'tr-delta--up' : 'tr-delta--down'}`;
      deltaEl.innerHTML = `<i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${Math.abs(pct)}% vs last month`;
    } else { deltaEl.textContent = ''; }
  }

  // Count badge
  const countBadge = el('transfer-count');
  if (countBadge) countBadge.textContent = transfers.length > 0 ? `${transfers.length} transfer${transfers.length !== 1 ? 's' : ''}` : '';

  // Live hero subtitle
  const heroSub = el('tr-hero-sub');
  if (heroSub) {
    const mCount = all.filter(t => String(t.date ?? '').startsWith(curYM)).length;
    heroSub.innerHTML = mCount > 0
      ? `<strong>${formatCurrency(thisMonth)}</strong> moved &middot; ${mCount} transfer${mCount !== 1 ? 's' : ''} this month`
      : 'Move money between accounts';
  }

  // Filter summary
  _updateFilterSummary();

  _getPaginator().update(transfers);
}

// ─── init() (Task 11.3) ──────────────────────────────────────────────────────

/**
 * Binds the transfer form submit handler, populates dropdowns, and subscribes to store changes.
 * Requirements: 15.1–15.5
 */
export function init() {
  populateAccountDropdowns();
  _bindForm();
  _bindModalPreview();
  _bindFilters();
  store.on('transfers', render);
  store.on('accounts', () => { populateAccountDropdowns(); _buildSourceDropdown(); _buildDestDropdown(); });
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function _getAccountNames() {
  const transfers = store.get('transfers') ?? [];
  const sources = [...new Set(transfers.map(t => t.sourceAccount).filter(Boolean))].sort();
  const dests   = [...new Set(transfers.map(t => t.destinationAccount).filter(Boolean))].sort();
  return { sources, dests };
}

function _buildSourceDropdown() {
  const btn  = document.getElementById('transfer-src-btn');
  const menu = document.getElementById('transfer-src-menu');
  if (!btn || !menu) return;
  const { sources } = _getAccountNames();
  menu.innerHTML = sources.length === 0
    ? '<div class="fdd-empty">No transfers yet</div>'
    : sources.map(s => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(s)}" ${filterState.sourceAccounts.includes(s) ? 'checked' : ''} />
        <span>${escapeHtml(s)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.sourceAccounts = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateSrcBtnLabel(btn);
      render();
    });
  });
  _updateSrcBtnLabel(btn);
}

function _updateSrcBtnLabel(btn) {
  const n = filterState.sourceAccounts.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-box-arrow-right me-1"></i>From <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-box-arrow-right me-1"></i>From <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _buildDestDropdown() {
  const btn  = document.getElementById('transfer-dst-btn');
  const menu = document.getElementById('transfer-dst-menu');
  if (!btn || !menu) return;
  const { dests } = _getAccountNames();
  menu.innerHTML = dests.length === 0
    ? '<div class="fdd-empty">No transfers yet</div>'
    : dests.map(d => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(d)}" ${filterState.destAccounts.includes(d) ? 'checked' : ''} />
        <span>${escapeHtml(d)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.destAccounts = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateDstBtnLabel(btn);
      render();
    });
  });
  _updateDstBtnLabel(btn);
}

function _updateDstBtnLabel(btn) {
  const n = filterState.destAccounts.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-box-arrow-in-right me-1"></i>To <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-box-arrow-in-right me-1"></i>To <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _wireDropdown(btn, menu) {
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.toggle('fdd-open');
    btn.querySelector('.fdd-chevron')?.classList.toggle('fdd-chevron-up', open);
  });
  document.addEventListener('click', () => {
    menu.classList.remove('fdd-open');
    btn.querySelector('.fdd-chevron')?.classList.remove('fdd-chevron-up');
  });
  menu.addEventListener('click', e => e.stopPropagation());
}

function _updateFilterSummary() {
  const strip = document.getElementById('transfer-filter-summary');
  if (!strip) return;
  const parts = [];
  if (filterState.sourceAccounts.length) parts.push(`From: ${filterState.sourceAccounts.join(', ')}`);
  if (filterState.destAccounts.length) parts.push(`To: ${filterState.destAccounts.join(', ')}`);
  if (filterState.dateFrom || filterState.dateTo) parts.push(`Date: ${filterState.dateFrom || '\u2026'} \u2192 ${filterState.dateTo || '\u2026'}`);
  if (filterState.search) parts.push(`Search: \u201c${filterState.search}\u201d`);
  if (parts.length === 0) {
    strip.classList.add('d-none'); strip.innerHTML = '';
  } else {
    strip.classList.remove('d-none');
    strip.innerHTML = `<i class="bi bi-funnel-fill me-1"></i>Filtered by: ${parts.map(p => `<span class="tr-filter-chip">${escapeHtml(p)}</span>`).join('')}`;
  }
}

function _bindFilters() {
  const srcBtn  = document.getElementById('transfer-src-btn');
  const srcMenu = document.getElementById('transfer-src-menu');
  const dstBtn  = document.getElementById('transfer-dst-btn');
  const dstMenu = document.getElementById('transfer-dst-menu');
  const dateFrom = document.getElementById('transfer-date-from');
  const dateTo   = document.getElementById('transfer-date-to');
  const clearBtn = document.getElementById('transfer-clear-filters');
  const dateErr  = document.getElementById('transfer-date-range-error');
  const searchInput = document.getElementById('transfer-search');
  const presetBtns = document.querySelectorAll('#tab-transfers .tr-preset-btn');

  _wireDropdown(srcBtn, srcMenu);
  _wireDropdown(dstBtn, dstMenu);

  // Debounced search
  let _searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => { filterState.search = searchInput.value.trim(); render(); }, 220);
    });
  }

  // Quick date presets
  const _pad = n => String(n).padStart(2, '0');
  const _ymd = d => `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const now = new Date();
      let from = '', to = '';
      switch (btn.dataset.preset) {
        case 'this-month':  from = `${now.getFullYear()}-${_pad(now.getMonth()+1)}-01`; to = _ymd(now); break;
        case 'last-month': { const lm = new Date(now.getFullYear(), now.getMonth()-1, 1); from = _ymd(lm); to = _ymd(new Date(now.getFullYear(), now.getMonth(), 0)); break; }
        case 'last-30':    { const d30 = new Date(now); d30.setDate(d30.getDate()-30); from = _ymd(d30); to = _ymd(now); break; }
        case 'this-year':  from = `${now.getFullYear()}-01-01`; to = _ymd(now); break;
      }
      if (dateFrom) dateFrom.value = from;
      if (dateTo)   dateTo.value   = to;
      filterState.dateFrom = from; filterState.dateTo = to;
      presetBtns.forEach(b => b.classList.toggle('tr-preset-btn--active', b === btn));
      render();
    });
  });

  function applyAndRender() {
    if (dateFrom?.value && dateTo?.value && dateTo.value < dateFrom.value) {
      if (dateErr) { dateErr.textContent = 'End date must be on or after start date.'; dateErr.classList.remove('d-none'); }
      dateTo?.classList.add('is-invalid');
      return;
    }
    if (dateErr) dateErr.classList.add('d-none');
    dateTo?.classList.remove('is-invalid');
    filterState.dateFrom = dateFrom?.value ?? '';
    filterState.dateTo   = dateTo?.value ?? '';
    presetBtns.forEach(b => b.classList.remove('tr-preset-btn--active'));
    render();
  }

  if (dateFrom) dateFrom.addEventListener('change', applyAndRender);
  if (dateTo)   dateTo.addEventListener('change', applyAndRender);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (dateFrom) dateFrom.value = '';
      if (dateTo)   dateTo.value   = '';
      if (searchInput) searchInput.value = '';
      if (dateErr)  dateErr.classList.add('d-none');
      dateTo?.classList.remove('is-invalid');
      filterState.sourceAccounts = [];
      filterState.destAccounts   = [];
      filterState.dateFrom = '';
      filterState.dateTo   = '';
      filterState.search   = '';
      if (srcMenu) srcMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (dstMenu) dstMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (srcBtn) _updateSrcBtnLabel(srcBtn);
      if (dstBtn) _updateDstBtnLabel(dstBtn);
      presetBtns.forEach(b => b.classList.remove('tr-preset-btn--active'));
      render();
    });
  }

  _buildSourceDropdown();
  _buildDestDropdown();
  store.on('transfers', () => { _buildSourceDropdown(); _buildDestDropdown(); });
}

function _bindModalPreview() {
  const srcSel = document.getElementById('transfer-source');
  const dstSel = document.getElementById('transfer-dest');
  const preview = document.getElementById('tr-modal-preview');
  if (!srcSel || !dstSel || !preview) return;
  function _refresh() {
    const s = srcSel.value; const d = dstSel.value;
    if (s && d) {
      preview.innerHTML = `<i class="bi ${_pmIcon(s)} me-1"></i><strong>${escapeHtml(s)}</strong><i class="bi bi-arrow-right mx-2" style="color:#3b82f6;font-size:.65rem"></i><i class="bi ${_pmIcon(d)} me-1"></i><strong>${escapeHtml(d)}</strong>`;
      preview.classList.remove('d-none');
    } else {
      preview.classList.add('d-none'); preview.innerHTML = '';
    }
  }
  srcSel.addEventListener('change', _refresh);
  dstSel.addEventListener('change', _refresh);
  const modalEl = document.getElementById('oc-transfer');
  if (modalEl) modalEl.addEventListener('hidden.bs.modal', () => { preview.classList.add('d-none'); preview.innerHTML = ''; });
}

function _bindForm() {
  const form = document.getElementById('transfer-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const date = document.getElementById('transfer-date')?.value?.trim() ?? '';
    const sourceAccount = document.getElementById('transfer-source')?.value?.trim() ?? '';
    const destinationAccount = document.getElementById('transfer-dest')?.value?.trim() ?? '';
    const amount = document.getElementById('transfer-amount')?.value?.trim() ?? '';
    const description = document.getElementById('transfer-description')?.value?.trim() ?? '';

    // Validate required fields
    const reqResult = requireFields(
      { date, sourceAccount, destinationAccount, amount },
      ['date', 'sourceAccount', 'destinationAccount', 'amount']
    );
    if (!reqResult.valid) {
      showError(reqResult.errors.join('. '));
      return;
    }

    // Validate positive amount
    const amtResult = requirePositiveNumber(amount);
    if (!amtResult.valid) {
      showError(amtResult.errors[0]);
      return;
    }

    // Validate different source and destination
    const diffResult = requireDifferentValues(sourceAccount, destinationAccount, 'Source and destination accounts');
    if (!diffResult.valid) {
      showError(diffResult.errors[0]);
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      date,
      sourceAccount,
      destinationAccount,
      amount: parseFloat(amount),
      description,
    };

    try {
      await appendRow(CONFIG.sheets.transfers, serialize(record));
      const rows = await fetchRows(CONFIG.sheets.transfers);
      store.set('transfers', rows.map(deserialize));
      form.reset();
      hideError();
      const modal = document.getElementById('oc-transfer');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showError(err.message ?? 'Failed to save transfer. Please try again.');
    }
  });
}
