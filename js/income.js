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
  banner.textContent = message;
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
};

function applyFilters(records) {
  return records.filter(r => {
    if (filterState.sources.length > 0 && !filterState.sources.includes(r.source)) return false;
    if (filterState.receivedIn.length > 0 && !filterState.receivedIn.includes(r.receivedIn)) return false;
    if (filterState.dateFrom && r.date < filterState.dateFrom) return false;
    if (filterState.dateTo && r.date > filterState.dateTo) return false;
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

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'income-cards',
      paginationId: 'income-pagination',
      pageSize: 12,
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
        container.innerHTML = `<div class="data-cards-grid">${slice.map(r => `
          <div class="data-card income-card">
            <div class="ec-top">
              <div class="dc-icon income-icon"><i class="bi bi-arrow-down-circle-fill"></i></div>
              <div class="ec-body">
                <div class="ec-desc">${escapeHtml(r.description)}</div>
                <div class="ec-sub">${escapeHtml(r.source)}</div>
              </div>
              <div class="ec-amount income-amount">${formatCurrency(r.amount)}</div>
            </div>
            <div class="dc-footer">
              <span class="dc-badge"><i class="bi bi-calendar3 me-1"></i>${formatDate(r.date)}</span>
              <span class="dc-badge"><i class="bi bi-bank2 me-1"></i>${escapeHtml(r.receivedIn)}</span>
              <div class="dc-actions">
                <button class="btn btn-sm btn-outline-primary" data-edit-idx="${r._idx}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" data-delete-idx="${r._idx}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>
        `).join('')}</div>`;
        container.querySelectorAll('[data-edit-idx]').forEach(btn => {
          btn.addEventListener('click', () => _startEdit(parseInt(btn.dataset.editIdx)));
        });
        container.querySelectorAll('[data-delete-idx]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(parseInt(btn.dataset.deleteIdx)));
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
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
  _getPaginator().update(sorted);

  // Stat cards — use filtered data when any filter is active, otherwise default month view
  const el = id => document.getElementById(id);
  const hasFilter = filterState.sources.length > 0 || filterState.dateFrom || filterState.dateTo;
  if (hasFilter) {
    const total = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    const labelEl = document.querySelector('#inc-stat-this-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label2El = document.querySelector('#inc-stat-last-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label3El = document.querySelector('#inc-stat-total')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    if (labelEl) labelEl.textContent = 'Filtered Total';
    if (label2El) label2El.textContent = 'Avg per Record';
    if (label3El) label3El.textContent = 'Matching Records';
    if (el('inc-stat-this-month')) el('inc-stat-this-month').textContent = formatCurrency(total);
    if (el('inc-stat-last-month')) el('inc-stat-last-month').textContent = formatCurrency(avg);
    if (el('inc-stat-total')) el('inc-stat-total').textContent = filtered.length;
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
    if (label3El) label3El.textContent = 'Total Records';
    const thisMonth = all.filter(r => String(r.date ?? '').startsWith(curYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const lastMonth = all.filter(r => String(r.date ?? '').startsWith(prevYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (el('inc-stat-this-month')) el('inc-stat-this-month').textContent = formatCurrency(thisMonth);
    if (el('inc-stat-last-month')) el('inc-stat-last-month').textContent = formatCurrency(lastMonth);
    if (el('inc-stat-total')) el('inc-stat-total').textContent = all.length;
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

function _bindFilters() {
  const btn = document.getElementById('income-src-btn');
  const menu = document.getElementById('income-src-menu');
  const riBtn = document.getElementById('income-ri-btn');
  const riMenu = document.getElementById('income-ri-menu');
  const dateFrom = document.getElementById('income-date-from');
  const dateTo = document.getElementById('income-date-to');
  const clearBtn = document.getElementById('income-clear-filters');
  const dateRangeError = document.getElementById('income-date-range-error');

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
    render();
  }

  if (dateFrom) dateFrom.addEventListener('change', applyAndRender);
  if (dateTo) dateTo.addEventListener('change', applyAndRender);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
      if (dateRangeError) dateRangeError.classList.add('d-none');
      dateTo?.classList.remove('is-invalid');
      filterState.sources = [];
      filterState.receivedIn = [];
      filterState.dateFrom = '';
      filterState.dateTo = '';
      if (menu) menu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (riMenu) riMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (btn) _updateSrcBtnLabel(btn);
      if (riBtn) _updateRiBtnLabel(riBtn);
      render();
    });
  }

  _buildSourceDropdown();
  _buildReceivedInDropdown();
  store.on('incomeSources', _buildSourceDropdown);
  store.on('accounts', _buildReceivedInDropdown);
  store.on('creditCards', _buildReceivedInDropdown);
}

