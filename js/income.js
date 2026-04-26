// js/income.js — Income entry, listing, and filtering module
// Requirements: 6.1–6.7, 7.1–7.6, 8.1–8.6, 10.1–10.4

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber } from './validation.js';
import { formatDate, formatCurrency, bindDependentPaymentSelect, restorePaymentSelects } from './utils.js';
import { createPaginator } from './paginate.js';
import { showUndoToast } from './undo.js';

// ─── Serialization (Task 6.1) ────────────────────────────────────────────────
// Column order: A=date, B=source, C=amount, D=description, E=receivedIn

/**
 * Converts an IncomeRecord object to a row array for Google Sheets.
 * @param {{ date: string, source: string, amount: number, description: string, receivedIn: string }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.date,
    record.source,
    String(record.amount),
    record.description,
    record.receivedIn ?? '',
  ];
}

/**
 * Converts a raw Sheets row array to an IncomeRecord object.
 * @param {string[]} row
 * @returns {{ date: string, source: string, amount: number, description: string, receivedIn: string }}
 */
export function deserialize(row) {
  return {
    date: row[0] ?? '',
    source: row[1] ?? '',
    amount: parseFloat(row[2]) || 0,
    description: row[3] ?? '',
    receivedIn: row[4] ?? '',
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function refreshReceivedInDropdown() {
  // Handled by bindDependentPaymentSelect in _bindForm
}

function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('is-invalid');
  let feedback = field.nextElementSibling;
  if (!feedback || !feedback.classList.contains('invalid-feedback')) {
    feedback = document.createElement('div');
    feedback.className = 'invalid-feedback';
    field.insertAdjacentElement('afterend', feedback);
  }
  feedback.textContent = message;
}

function clearFieldErrors(formEl) {
  formEl.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

function showError(message) {
  const banner = document.getElementById('income-error-banner');
  if (!banner) return;
  const textEl = document.getElementById('income-error-banner-text');
  if (textEl) textEl.textContent = message; else banner.textContent = message;
  banner.classList.remove('d-none');
}

function hideError() {
  const banner = document.getElementById('income-error-banner');
  if (banner) banner.classList.add('d-none');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Filter state ────────────────────────────────────────────────────────────

const filterState = {
  sources: [],     // string[] — empty means "all"
  receivedIn: [],  // string[] — empty means "all"
  dateFrom: '',
  dateTo: '',
  search: '',      // free-text search on description + source
};

function applyFilters(records) {
  const q = filterState.search.toLowerCase().trim();
  return records.filter(r => {
    if (filterState.sources.length > 0 && !filterState.sources.includes(r.source)) return false;
    if (filterState.receivedIn.length > 0 && !filterState.receivedIn.includes(r.receivedIn)) return false;
    if (filterState.dateFrom && r.date < filterState.dateFrom) return false;
    if (filterState.dateTo && r.date > filterState.dateTo) return false;
    if (q && !String(r.description ?? '').toLowerCase().includes(q) && !String(r.source ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

// ─── Edit state ──────────────────────────────────────────────────────────────
let _editingIndex = null;
let _forceIncomeSave = false;

function _checkDuplicate(date, source, amount) {
  const existing = store.get('income') ?? [];
  return existing.some((e, i) => {
    if (_editingIndex !== null && i === _editingIndex) return false;
    return e.date === date && e.source === source && Math.abs(e.amount - amount) < 0.01;
  });
}

function _showDuplicateWarning() {
  const banner = document.getElementById('income-duplicate-warning');
  if (banner) banner.classList.remove('d-none');
}

function _hideDuplicateWarning() {
  const banner = document.getElementById('income-duplicate-warning');
  if (banner) banner.classList.add('d-none');
}

// ─── Filtered summary (used by renderPage tfoot) ────────────────────────────
let _filteredTotal = 0;
let _filteredCount = 0;

// ─── Payment method icon ──────────────────────────────────────────────────────────
function _pmIcon(name) {
  if (!name) return 'bi-bank2';
  const n = name.toLowerCase();
  if (n.includes('cash')) return 'bi-cash-coin';
  if (n.includes('wallet') || n.includes('gpay') || n.includes('paytm') || n.includes('phonepe') || n.includes('upi')) return 'bi-wallet2';
  if (n.includes('card') || n.includes('credit') || n.includes('visa') || n.includes('mastercard') || n.includes('amex')) return 'bi-credit-card-2-front';
  return 'bi-bank2';
}

// ─── Sort state ─────────────────────────────────────────────────────────────────
let _sortCol = 'date';   // 'date' | 'amount'
let _sortDir = 'desc';   // 'asc'  | 'desc'

// ─── Source colour — consistent hash-based neon pill ────────────────────────
const _SRC_PALETTE = [
  { color: '#10b981', bg: 'rgba(16,185,129,.13)',  border: 'rgba(16,185,129,.28)'  },
  { color: '#3b82f6', bg: 'rgba(59,130,246,.13)',  border: 'rgba(59,130,246,.28)'  },
  { color: '#8b5cf6', bg: 'rgba(139,92,246,.13)',  border: 'rgba(139,92,246,.28)'  },
  { color: '#14b8a6', bg: 'rgba(20,184,166,.13)',  border: 'rgba(20,184,166,.28)'  },
  { color: '#f97316', bg: 'rgba(249,115,22,.13)',  border: 'rgba(249,115,22,.28)'  },
  { color: '#eab308', bg: 'rgba(234,179,8,.13)',   border: 'rgba(234,179,8,.28)'   },
  { color: '#a855f7', bg: 'rgba(168,85,247,.13)',  border: 'rgba(168,85,247,.28)'  },
  { color: '#ec4899', bg: 'rgba(236,72,153,.13)',  border: 'rgba(236,72,153,.28)'  },
];
function _srcColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return _SRC_PALETTE[h % _SRC_PALETTE.length];
}

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'income-cards',
      paginationId: 'income-pagination',
      pageSize: 25,
      pageInfoId: 'income-page-info',
      pageSizeSelectId: 'income-page-size',
        renderPage(slice) {
        const container = document.getElementById('income-cards');
        const emptyState = document.getElementById('income-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const dateSortIcon = `<i class="bi ${_sortCol==='date'   ? (_sortDir==='asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up'} cpt-sort-icon${_sortCol==='date'   ? ' cpt-sort-icon--active' : ''}"></i>`;
        const amtSortIcon  = `<i class="bi ${_sortCol==='amount' ? (_sortDir==='asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up'} cpt-sort-icon${_sortCol==='amount' ? ' cpt-sort-icon--active' : ''}"></i>`;
        container.innerHTML = `<div class="cpt-wrap"><table class="cpt">
          <thead><tr>
            <th>Description</th><th>Source</th><th>Account</th>
            <th class="cpt-th-sort" id="inc-sort-date">Date${dateSortIcon}</th>
            <th class="cpt-th-amt cpt-th-sort" id="inc-sort-amt">Amount${amtSortIcon}</th><th></th>
          </tr></thead>
          <tbody>${slice.map(r => {
            const clr = _srcColor(r.source);
            const pmIcon = _pmIcon(r.receivedIn);
            return `<tr>
              <td>
                <div class="cpt-desc-primary" title="${escapeHtml(r.description)}">${escapeHtml(r.description)}</div>
              </td>
              <td>
                <div class="cpt-cat-wrap">
                  <span class="cpt-cat" style="color:${clr.color};background:${clr.bg};border-color:${clr.border}">${escapeHtml(r.source)}</span>
                </div>
              </td>
              <td class="cpt-account">
                <span class="cpt-account-chip">
                  <i class="bi ${pmIcon}"></i>${escapeHtml(r.receivedIn)}
                </span>
              </td>
              <td class="cpt-date">${formatDate(r.date)}</td>
              <td class="cpt-amt cpt-amt--income"><span class="inc-amt-pos">+${formatCurrency(r.amount)}</span></td>
              <td class="cpt-actions">
                <button class="cpt-action-btn cpt-action-btn--edit" data-edit-idx="${r._idx}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="cpt-action-btn cpt-action-btn--del" data-delete-idx="${r._idx}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr>
            <td colspan="4" class="cpt-tfoot-info">${_filteredCount} record${_filteredCount !== 1 ? 's' : ''} · filtered total</td>
            <td class="cpt-tfoot-total cpt-amt--income">${formatCurrency(_filteredTotal)}</td>
            <td></td>
          </tr></tfoot>
        </table></div>`;
        container.querySelectorAll('[data-edit-idx]').forEach(btn => {
          btn.addEventListener('click', () => _startEdit(parseInt(btn.dataset.editIdx)));
        });
        container.querySelectorAll('[data-delete-idx]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(parseInt(btn.dataset.deleteIdx)));
        });
        // Sort headers
        const sortDateBtn = container.querySelector('#inc-sort-date');
        const sortAmtBtn  = container.querySelector('#inc-sort-amt');
        if (sortDateBtn) sortDateBtn.addEventListener('click', () => {
          if (_sortCol === 'date') _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
          else { _sortCol = 'date'; _sortDir = 'desc'; }
          render();
        });
        if (sortAmtBtn) sortAmtBtn.addEventListener('click', () => {
          if (_sortCol === 'amount') _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
          else { _sortCol = 'amount'; _sortDir = 'desc'; }
          render();
        });
      },
    });
  }
  return _paginator;
}

// ─── render() (Task 6.3) ─────────────────────────────────────────────────────

export function render() {
  const all = store.get('income') ?? [];
  const filtered = applyFilters(all);
  const sorted = filtered
    .map(r => ({ ...r, _idx: all.indexOf(r) }))
    .sort((a, b) => {
      if (_sortCol === 'amount') return _sortDir === 'desc' ? b.amount - a.amount : a.amount - b.amount;
      return _sortDir === 'asc' ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : (b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
    });
  _filteredCount = filtered.length;
  _filteredTotal = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  _getPaginator().update(sorted);

  // Live hero subtitle
  const heroSub = document.getElementById('inc-hero-sub');
  if (heroSub) {
    const now2 = new Date();
    const curYM2 = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
    const mCount = all.filter(r => String(r.date ?? '').startsWith(curYM2)).length;
    const mTotal = all.filter(r => String(r.date ?? '').startsWith(curYM2)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    heroSub.innerHTML = mCount > 0
      ? `<strong>${formatCurrency(mTotal)}</strong> earned &middot; ${mCount} entr${mCount !== 1 ? 'ies' : 'y'} this month`
      : 'Track your earnings';
  }

  // Filter summary
  _updateFilterSummary();

  // Count badge on table header
  const countBadge = document.getElementById('income-count');
  if (countBadge) countBadge.textContent = _filteredCount > 0 ? `${_filteredCount} records` : '';

  // Delta badge on "This Month" card
  const el = id => document.getElementById(id);
  const deltaEl = el('inc-stat-delta');
  const hasFilter = filterState.sources.length > 0 || filterState.dateFrom || filterState.dateTo || filterState.search;
  if (hasFilter) {
    const total = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    const labelEl = document.querySelector('#inc-stat-this-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label2El = document.querySelector('#inc-stat-last-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label3El = document.querySelector('#inc-stat-total')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    if (labelEl) labelEl.textContent = 'Filtered Total';
    if (label2El) label2El.textContent = 'Avg per Record';
    if (label3El) label3El.textContent = 'Matching Total';
    if (el('inc-stat-this-month')) el('inc-stat-this-month').textContent = formatCurrency(total);
    if (el('inc-stat-last-month')) el('inc-stat-last-month').textContent = formatCurrency(avg);
    if (el('inc-stat-total')) el('inc-stat-total').textContent = formatCurrency(total);
  } else {
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const labelEl = document.querySelector('#inc-stat-this-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label2El = document.querySelector('#inc-stat-last-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label3El = document.querySelector('#inc-stat-total')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    if (labelEl) labelEl.textContent = 'This Month';
    if (label2El) label2El.textContent = 'Last Month';
    if (label3El) label3El.textContent = 'YTD Total';
    const thisMonth = all.filter(r => String(r.date ?? '').startsWith(curYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const lastMonth = all.filter(r => String(r.date ?? '').startsWith(prevYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (el('inc-stat-this-month')) el('inc-stat-this-month').textContent = formatCurrency(thisMonth);
    if (el('inc-stat-last-month')) el('inc-stat-last-month').textContent = formatCurrency(lastMonth);
    const ytdStart = `${now.getFullYear()}-01-01`;
    const ytdTotal = all.filter(r => String(r.date ?? '') >= ytdStart).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (el('inc-stat-total')) el('inc-stat-total').textContent = formatCurrency(ytdTotal);
    // Delta on Last Month card (vs month before last)
    const lastDeltaEl = el('inc-stat-last-delta');
    if (lastDeltaEl) {
      const ppDate = new Date(now.getFullYear(), now.getMonth()-2, 1);
      const ppYM = `${ppDate.getFullYear()}-${String(ppDate.getMonth()+1).padStart(2,'0')}`;
      const ppMonth = all.filter(r => String(r.date ?? '').startsWith(ppYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      if (ppMonth > 0) {
        const pct2 = Math.round(((lastMonth - ppMonth) / ppMonth) * 100);
        const up2 = pct2 >= 0;
        lastDeltaEl.className = `sec-stat-delta ${up2 ? 'inc-delta--up' : 'inc-delta--down'}`;
        lastDeltaEl.innerHTML = `<i class="bi bi-arrow-${up2 ? 'up' : 'down'}-short"></i>${Math.abs(pct2)}% vs prior month`;
      } else { lastDeltaEl.textContent = ''; }
    }
    // Delta (income up = good = green)
    if (deltaEl) {
      if (lastMonth > 0) {
        const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
        const up = pct >= 0;
        deltaEl.className = `sec-stat-delta inc-delta${up ? '--up' : '--down'}`;
        deltaEl.innerHTML = `<i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${Math.abs(pct)}% vs last month`;
      } else { deltaEl.textContent = ''; }
    }
  }
}

// ─── init() (Task 6.3) ───────────────────────────────────────────────────────

/**
 * Binds the income form submit handler and filter controls.
 * Must be called after DOMContentLoaded.
 */
export function init() {
  _bindForm();
  _bindFilters();
  store.on('income', render);
}

function _bindForm() {
  const form = document.getElementById('income-form');
  if (!form) return;

  const submitBtn = form.querySelector('[type="submit"]');
  const cancelBtn = document.getElementById('income-cancel-edit');

  // Dependent received-in dropdowns
  const refreshReceived = bindDependentPaymentSelect('income-received-type', 'income-received-in', store);
  store.on('accounts',    refreshReceived);
  store.on('creditCards', refreshReceived);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingIndex = null;
      form.reset();
      if (submitBtn) submitBtn.textContent = 'Add Income';
      cancelBtn.classList.add('d-none');
      hideError();
      _hideDuplicateWarning();
    });
  }

  // Duplicate warning buttons
  const saveAnywayBtn = document.getElementById('income-save-anyway');
  const cancelDuplicateBtn = document.getElementById('income-cancel-duplicate');
  if (saveAnywayBtn) {
    saveAnywayBtn.addEventListener('click', () => {
      _forceIncomeSave = true;
      _hideDuplicateWarning();
      form.requestSubmit();
    });
  }
  if (cancelDuplicateBtn) {
    cancelDuplicateBtn.addEventListener('click', () => {
      _hideDuplicateWarning();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    clearFieldErrors(form);

    const date = form.querySelector('#income-date')?.value?.trim() ?? '';
    const source = form.querySelector('#income-source')?.value?.trim() ?? '';
    const amount = form.querySelector('#income-amount')?.value?.trim() ?? '';
    const description = form.querySelector('#income-description')?.value?.trim() ?? '';
    const receivedIn = form.querySelector('#income-received-in')?.value?.trim() ?? '';

    const reqResult = requireFields({ date, source, amount, description, receivedIn }, ['date', 'source', 'amount', 'description', 'receivedIn']);
    let hasErrors = false;

    if (!reqResult.valid) {
      reqResult.errors.forEach(err => {
        const field = err.split(' ')[0];
        const idMap = { date: 'income-date', source: 'income-source', amount: 'income-amount', description: 'income-description', receivedIn: 'income-received-in' };
        if (idMap[field]) showFieldError(idMap[field], err);
      });
      hasErrors = true;
    }

    const amtResult = requirePositiveNumber(amount);
    if (!amtResult.valid) { showFieldError('income-amount', amtResult.errors[0]); hasErrors = true; }
    if (hasErrors) return;

    const record = { date, source, amount: parseFloat(amount), description, receivedIn };

    // Duplicate check (skip when force-saving)
    if (!_forceIncomeSave && _checkDuplicate(date, source, parseFloat(amount))) {
      _showDuplicateWarning();
      return;
    }
    _forceIncomeSave = false;

    try {
      if (_editingIndex !== null) {
        const records = [...(store.get('income') ?? [])];
        records[_editingIndex] = record;
        await writeAllRows(CONFIG.sheets.income, records.map(serialize));
        store.set('income', records);
        _editingIndex = null;
        if (submitBtn) submitBtn.textContent = 'Add Income';
        if (cancelBtn) cancelBtn.classList.add('d-none');
      } else {
        await appendRow(CONFIG.sheets.income, serialize(record));
        const rows = await fetchRows(CONFIG.sheets.income);
        store.set('income', rows.map(deserialize));
      }
      form.reset();
      _hideDuplicateWarning();
      const incomeModal = document.getElementById('oc-income');
      if (incomeModal) bootstrap.Modal.getInstance(incomeModal)?.hide();
    } catch (err) {
      showError(err.message ?? 'Failed to save income. Please try again.');
    }
  });
}

function _startEdit(idx) {
  const records = store.get('income') ?? [];
  const r = records[idx];
  if (!r) return;

  _editingIndex = idx;

  const form = document.getElementById('income-form');
  const submitBtn = form?.querySelector('[type="submit"]');
  const cancelBtn = document.getElementById('income-cancel-edit');

  if (form) {
    form.querySelector('#income-date').value = r.date;
    form.querySelector('#income-source').value = r.source;
    form.querySelector('#income-amount').value = r.amount;
    form.querySelector('#income-description').value = r.description;
    restorePaymentSelects('income-received-type', 'income-received-in', r.receivedIn, store);
  }

  if (submitBtn) submitBtn.textContent = 'Update Income';
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  // Open the modal
  const modal = document.getElementById('oc-income');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

import { epConfirm } from './confirm.js';

async function _deleteRecord(idx) {
  if (!await epConfirm('Delete this income record?')) return;
  const records = [...(store.get('income') ?? [])];
  const deleted = records[idx];
  records.splice(idx, 1);
  try {
    await writeAllRows(CONFIG.sheets.income, records.map(serialize));
    store.set('income', records);
    showUndoToast('Income deleted', async () => {
      const current = [...(store.get('income') ?? [])];
      current.splice(idx, 0, deleted);
      await writeAllRows(CONFIG.sheets.income, current.map(serialize));
      store.set('income', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function _buildReceivedInDropdown() {
  const btn = document.getElementById('income-ri-btn');
  const menu = document.getElementById('income-ri-menu');
  if (!btn || !menu) return;
  const accounts = (store.get('accounts') ?? []).map(a => a.name).filter(Boolean);
  const cards = (store.get('creditCards') ?? []).map(c => c.name).filter(Boolean);
  const all = [...accounts, ...cards].sort((a, b) => a.localeCompare(b));
  menu.innerHTML = all.length === 0
    ? '<div class="fdd-empty">No accounts yet</div>'
    : all.map(p => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(p)}" ${filterState.receivedIn.includes(p) ? 'checked' : ''} />
        <span>${escapeHtml(p)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.receivedIn = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateRiBtnLabel(btn);
      render();
    });
  });
  _updateRiBtnLabel(btn);
}

function _updateRiBtnLabel(btn) {
  if (!btn) return;
  const n = filterState.receivedIn.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-wallet2 me-1"></i>Account <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-wallet2 me-1"></i>Account <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _buildSourceDropdown() {
  const btn = document.getElementById('income-src-btn');
  const menu = document.getElementById('income-src-menu');
  if (!btn || !menu) return;
  const sources = (store.get('incomeSources') ?? []).map(s => s.name ?? s).filter(Boolean).sort((a, b) => a.localeCompare(b));
  menu.innerHTML = sources.length === 0
    ? '<div class="fdd-empty">No sources yet</div>'
    : sources.map(s => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(s)}" ${filterState.sources.includes(s) ? 'checked' : ''} />
        <span>${escapeHtml(s)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.sources = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateSrcBtnLabel(btn);
      render();
    });
  });
  _updateSrcBtnLabel(btn);
}

function _updateSrcBtnLabel(btn) {
  const n = filterState.sources.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-funnel me-1"></i>Source <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-funnel-fill me-1"></i>Source <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _updateFilterSummary() {
  const strip = document.getElementById('income-filter-summary');
  if (!strip) return;
  const parts = [];
  if (filterState.sources.length) parts.push(`Source: ${filterState.sources.join(', ')}`);
  if (filterState.receivedIn.length) parts.push(`Account: ${filterState.receivedIn.join(', ')}`);
  if (filterState.dateFrom || filterState.dateTo) parts.push(`Date: ${filterState.dateFrom || '…'} → ${filterState.dateTo || '…'}`);
  if (filterState.search) parts.push(`Search: “${filterState.search}”`);
  if (parts.length === 0) {
    strip.classList.add('d-none'); strip.innerHTML = '';
  } else {
    strip.classList.remove('d-none');
    strip.innerHTML = `<i class="bi bi-funnel-fill me-1"></i>Filtered by: ${parts.map(p => `<span class="inc-filter-chip">${escapeHtml(p)}</span>`).join('')}`;
  }
}

function _bindFilters() {
  const btn = document.getElementById('income-src-btn');
  const menu = document.getElementById('income-src-menu');
  const riBtn = document.getElementById('income-ri-btn');
  const riMenu = document.getElementById('income-ri-menu');
  const dateFrom = document.getElementById('income-date-from');
  const dateTo = document.getElementById('income-date-to');
  const clearBtn = document.getElementById('income-clear-filters');
  const dateRangeError = document.getElementById('income-date-range-error');
  const searchInput = document.getElementById('income-search');
  const presetBtns = document.querySelectorAll('#tab-income .inc-preset-btn');

  function _wireDropdown(b, m) {
    if (!b || !m) return;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = m.classList.toggle('fdd-open');
      b.querySelector('.fdd-chevron')?.classList.toggle('fdd-chevron-up', open);
    });
    document.addEventListener('click', () => {
      m.classList.remove('fdd-open');
      b.querySelector('.fdd-chevron')?.classList.remove('fdd-chevron-up');
    });
    m.addEventListener('click', e => e.stopPropagation());
  }

  _wireDropdown(btn, menu);
  _wireDropdown(riBtn, riMenu);

  // Search (debounced)
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
  presetBtns.forEach(btn2 => {
    btn2.addEventListener('click', () => {
      const now = new Date();
      let from = '', to = '';
      switch (btn2.dataset.preset) {
        case 'this-month':  from = `${now.getFullYear()}-${_pad(now.getMonth()+1)}-01`; to = _ymd(now); break;
        case 'last-month': { const lm = new Date(now.getFullYear(), now.getMonth()-1, 1); from = _ymd(lm); to = _ymd(new Date(now.getFullYear(), now.getMonth(), 0)); break; }
        case 'last-30':    { const d30 = new Date(now); d30.setDate(d30.getDate()-30); from = _ymd(d30); to = _ymd(now); break; }
        case 'this-year':  from = `${now.getFullYear()}-01-01`; to = _ymd(now); break;
      }
      if (dateFrom) dateFrom.value = from;
      if (dateTo)   dateTo.value   = to;
      filterState.dateFrom = from; filterState.dateTo = to;
      presetBtns.forEach(b => b.classList.toggle('inc-preset-btn--active', b === btn2));
      render();
    });
  });

  function applyAndRender() {
    if (dateFrom?.value && dateTo?.value && dateTo.value < dateFrom.value) {
      if (dateRangeError) { dateRangeError.textContent = 'End date must be on or after start date.'; dateRangeError.classList.remove('d-none'); }
      dateTo?.classList.add('is-invalid');
      return;
    }
    if (dateRangeError) dateRangeError.classList.add('d-none');
    dateTo?.classList.remove('is-invalid');
    filterState.dateFrom = dateFrom?.value ?? '';
    filterState.dateTo = dateTo?.value ?? '';
    presetBtns.forEach(b => b.classList.remove('inc-preset-btn--active'));
    render();
  }

  if (dateFrom) dateFrom.addEventListener('change', applyAndRender);
  if (dateTo) dateTo.addEventListener('change', applyAndRender);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
      if (searchInput) searchInput.value = '';
      if (dateRangeError) dateRangeError.classList.add('d-none');
      dateTo?.classList.remove('is-invalid');
      filterState.sources = [];
      filterState.receivedIn = [];
      filterState.dateFrom = '';
      filterState.dateTo = '';
      filterState.search = '';
      if (menu) menu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (riMenu) riMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (btn) _updateSrcBtnLabel(btn);
      if (riBtn) _updateRiBtnLabel(riBtn);
      presetBtns.forEach(b => b.classList.remove('inc-preset-btn--active'));
      render();
    });
  }

  _buildSourceDropdown();
  _buildReceivedInDropdown();
  store.on('incomeSources', _buildSourceDropdown);
  store.on('accounts', _buildReceivedInDropdown);
  store.on('creditCards', _buildReceivedInDropdown);
}

