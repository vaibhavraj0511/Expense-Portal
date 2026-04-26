// js/expenses.js — Expense entry, listing, and filtering module
// Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 2.2, 2.3, 2.5, 2.6, 2.7,
//               3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.2, 5.3, 5.4

import { CONFIG } from './config.js';
import { appendRow, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber } from './validation.js';
import { formatDate, formatCurrency, bindDependentPaymentSelect, restorePaymentSelects } from './utils.js';
import { createPaginator } from './paginate.js';
import { showUndoToast } from './undo.js';

// ─── Serialization (Task 5.1) ────────────────────────────────────────────────
// Column order: A=date, B=category, C=subCategory, D=amount, E=description, F=paymentMethod

/**
 * Converts an ExpenseRecord object to a row array for Google Sheets.
 * @param {{ date: string, category: string, subCategory: string, amount: number, description: string, paymentMethod: string }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.date,
    record.category,
    record.subCategory ?? '',
    String(record.amount),
    record.description,
    record.paymentMethod,
  ];
}

/**
 * Converts a raw Sheets row array to an ExpenseRecord object.
 * @param {string[]} row
 * @returns {{ date: string, category: string, subCategory: string, amount: number, description: string, paymentMethod: string }}
 */
export function deserialize(row) {
  return {
    date: row[0] ?? '',
    category: row[1] ?? '',
    subCategory: row[2] ?? '',
    amount: parseFloat(row[3]) || 0,
    description: row[4] ?? '',
    paymentMethod: row[5] ?? '',
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Show a Bootstrap is-invalid error on a field. */
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

/** Clear all is-invalid states on the form. */
function clearFieldErrors(formEl) {
  formEl.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

/** Show the module-level error banner. */
function showError(message) {
  const banner = document.getElementById('expense-error-banner');
  if (!banner) return;
  const textEl = document.getElementById('expense-error-banner-text');
  if (textEl) textEl.textContent = message; else banner.textContent = message;
  banner.classList.remove('d-none');
}

/** Hide the module-level error banner. */
function hideError() {
  const banner = document.getElementById('expense-error-banner');
  if (banner) banner.classList.add('d-none');
}

// ─── Filter state ────────────────────────────────────────────────────────────

const filterState = {
  categories: [],     // string[] — empty means "all"
  paymentMethods: [], // string[] — empty means "all"
  dateFrom: '',
  dateTo: '',
  search: '',         // free-text search on description + category
};

/** Apply current filterState to records and return filtered array. */
function applyFilters(records) {
  const q = filterState.search.toLowerCase().trim();
  return records.filter(r => {
    if (filterState.categories.length > 0 && !filterState.categories.includes(r.category)) return false;
    if (filterState.paymentMethods.length > 0 && !filterState.paymentMethods.includes(r.paymentMethod)) return false;
    if (filterState.dateFrom && r.date < filterState.dateFrom) return false;
    if (filterState.dateTo && r.date > filterState.dateTo) return false;
    if (q && !String(r.description ?? '').toLowerCase().includes(q) && !String(r.category ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}

// ─── Edit state ──────────────────────────────────────────────────────────────
let _editingIndex = null; // index into store.get('expenses') of the record being edited
let _forceExpenseSave = false;

function _checkDuplicate(date, category, amount) {
  const existing = store.get('expenses') ?? [];
  return existing.some((e, i) => {
    if (_editingIndex !== null && i === _editingIndex) return false; // skip self when editing
    return e.date === date && e.category === category && Math.abs(e.amount - amount) < 0.01;
  });
}

function _showDuplicateWarning() {
  const banner = document.getElementById('expense-duplicate-warning');
  if (banner) banner.classList.remove('d-none');
}

function _hideDuplicateWarning() {
  const banner = document.getElementById('expense-duplicate-warning');
  if (banner) banner.classList.add('d-none');
}

// ─── Filtered summary (used by renderPage tfoot) ────────────────────────────
let _filteredTotal = 0;
let _filteredCount = 0;

// ─── Category colour — consistent hash-based neon pill ───────────────────────
const _CAT_PALETTE = [
  { color: '#f97316', bg: 'rgba(249,115,22,.13)',  border: 'rgba(249,115,22,.28)'  },
  { color: '#10b981', bg: 'rgba(16,185,129,.13)',  border: 'rgba(16,185,129,.28)'  },
  { color: '#3b82f6', bg: 'rgba(59,130,246,.13)',  border: 'rgba(59,130,246,.28)'  },
  { color: '#8b5cf6', bg: 'rgba(139,92,246,.13)',  border: 'rgba(139,92,246,.28)'  },
  { color: '#eab308', bg: 'rgba(234,179,8,.13)',   border: 'rgba(234,179,8,.28)'   },
  { color: '#ec4899', bg: 'rgba(236,72,153,.13)',  border: 'rgba(236,72,153,.28)'  },
  { color: '#14b8a6', bg: 'rgba(20,184,166,.13)',  border: 'rgba(20,184,166,.28)'  },
  { color: '#a855f7', bg: 'rgba(168,85,247,.13)',  border: 'rgba(168,85,247,.28)'  },
];
function _catColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return _CAT_PALETTE[h % _CAT_PALETTE.length];
}

// ─── Payment-type icon map ────────────────────────────────────────────────────
function _pmIcon(method) {
  const m = String(method ?? '').toLowerCase();
  if (m.includes('cash'))                          return 'bi-cash-coin';
  if (m.includes('wallet') || m.includes('paytm') || m.includes('gpay') || m.includes('phonepe')) return 'bi-wallet2';
  if (m.includes('card') || m.includes('credit') || m.includes('debit')) return 'bi-credit-card-2-front';
  return 'bi-bank2';
}

// ─── Sort state ───────────────────────────────────────────────────────────────
let _sortCol = 'date'; // 'date' | 'amount'
let _sortDir = 'desc'; // 'asc' | 'desc'

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'expense-cards',
      paginationId: 'expense-pagination',
      pageSize: 25,
      pageInfoId: 'expense-page-info',
      pageSizeSelectId: 'expense-page-size',
      renderPage(slice) {
        const container = document.getElementById('expense-cards');
        const emptyState = document.getElementById('expense-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const now = new Date();
        const curYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const budgets = store.get('budgets') ?? [];
        const allExpenses = store.get('expenses') ?? [];
        const dateSortIcon  = `<i class="bi ${ _sortCol==='date'   ? (_sortDir==='asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up'} cpt-sort-icon${ _sortCol==='date'   ? ' cpt-sort-icon--active' : ''}"></i>`;
        const amtSortIcon   = `<i class="bi ${ _sortCol==='amount' ? (_sortDir==='asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up'} cpt-sort-icon${ _sortCol==='amount' ? ' cpt-sort-icon--active' : ''}"></i>`;
        container.innerHTML = `<div class="cpt-wrap"><table class="cpt">
          <thead><tr>
            <th>Description</th><th>Category</th><th>Account</th>
            <th class="cpt-th-sort" id="cpt-sort-date">Date${dateSortIcon}</th>
            <th class="cpt-th-amt cpt-th-sort" id="cpt-sort-amt">Amount${amtSortIcon}</th><th></th>
          </tr></thead>
          <tbody>${slice.map(r => {
            const desc = escapeHtml(r.description.replace(/\s*\[ve:[^\]]+\]/, ''));
            const clr = _catColor(r.category);
            const budget = budgets.find(b => b.category === r.category && b.month === curYM);
            let budgetBadge = '';
            if (budget && budget.monthlyLimit > 0) {
              const spent = allExpenses.filter(e => e.category === r.category && String(e.date ?? '').startsWith(curYM)).reduce((s, e) => s + e.amount, 0);
              const pct = Math.round((spent / budget.monthlyLimit) * 100);
              if (spent > budget.monthlyLimit) {
                budgetBadge = `<span class="cpt-budget-badge cpt-budget-badge--over" title="Over budget: ${pct}% spent"><i class="bi bi-exclamation-triangle-fill"></i>${pct}%</span>`;
              } else if (pct >= 80) {
                budgetBadge = `<span class="cpt-budget-badge cpt-budget-badge--warn" title="Near limit: ${pct}% spent"><i class="bi bi-exclamation-circle"></i>${pct}%</span>`;
              } else {
                budgetBadge = `<span class="cpt-budget-badge cpt-budget-badge--ok" title="On track: ${pct}% spent"><i class="bi bi-check-circle"></i>${pct}%</span>`;
              }
            }
            const pmIcon = _pmIcon(r.paymentMethod);
            return `<tr>
              <td>
                <div class="cpt-desc-primary" title="${desc}">${desc}</div>
                ${r.subCategory ? `<div class="cpt-desc-secondary">${escapeHtml(r.subCategory)}</div>` : ''}
              </td>
              <td>
                <div class="cpt-cat-wrap">
                  <span class="cpt-cat" style="color:${clr.color};background:${clr.bg};border-color:${clr.border}">${escapeHtml(r.category)}</span>
                  ${budgetBadge}
                </div>
              </td>
              <td class="cpt-account">
                <span class="cpt-account-chip" style="--chip-c:${clr.color}">
                  <i class="bi ${pmIcon}"></i>${escapeHtml(r.paymentMethod)}
                </span>
              </td>
              <td class="cpt-date">${formatDate(r.date)}</td>
              <td class="cpt-amt cpt-amt--expense">${formatCurrency(r.amount)}</td>
              <td class="cpt-actions">
                <button class="cpt-action-btn cpt-action-btn--edit" data-edit-idx="${r._idx}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="cpt-action-btn cpt-action-btn--del" data-delete-idx="${r._idx}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr>
            <td colspan="4" class="cpt-tfoot-info">${_filteredCount} expense${_filteredCount !== 1 ? 's' : ''} &middot; filtered total</td>
            <td class="cpt-tfoot-total">${formatCurrency(_filteredTotal)}</td>
            <td></td>
          </tr></tfoot>
        </table></div>`;
        container.querySelectorAll('[data-edit-idx]').forEach(btn => {
          btn.addEventListener('click', () => _startEdit(parseInt(btn.dataset.editIdx)));
        });
        container.querySelectorAll('[data-delete-idx]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(parseInt(btn.dataset.deleteIdx)));
        });
        // Sort column headers
        container.querySelector('#cpt-sort-date')?.addEventListener('click', () => {
          if (_sortCol === 'date') _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
          else { _sortCol = 'date'; _sortDir = 'desc'; }
          render();
        });
        container.querySelector('#cpt-sort-amt')?.addEventListener('click', () => {
          if (_sortCol === 'amount') _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
          else { _sortCol = 'amount'; _sortDir = 'desc'; }
          render();
        });
      },
    });
  }
  return _paginator;
}

// ─── render() (Task 5.4) ─────────────────────────────────────────────────────

export function render() {
  const all = store.get('expenses') ?? [];
  const filtered = applyFilters(all);
  const sorted = filtered
    .map(r => ({ ...r, _idx: all.indexOf(r) }))
    .sort((a, b) => {
      if (_sortCol === 'amount') {
        return _sortDir === 'desc' ? b.amount - a.amount : a.amount - b.amount;
      }
      // default: date
      if (_sortDir === 'asc') return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      return (b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
    });
  _filteredCount = filtered.length;
  _filteredTotal = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  _getPaginator().update(sorted);

  // Live hero subtitle
  const heroSub = document.querySelector('.exp-page-hero-sub');
  if (heroSub) {
    const allExp = store.get('expenses') ?? [];
    const now2 = new Date();
    const curYM2 = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
    const mCount = allExp.filter(r => String(r.date ?? '').startsWith(curYM2)).length;
    const mTotal = allExp.filter(r => String(r.date ?? '').startsWith(curYM2)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    heroSub.innerHTML = mCount > 0
      ? `${mCount} expense${mCount !== 1 ? 's' : ''} this month &middot; <strong>${formatCurrency(mTotal)}</strong> total`
      : 'Track and manage your spending';
  }

  // Filter summary strip
  _updateFilterSummary();

  // Count badge on table header
  const countBadge = document.getElementById('expense-count');
  if (countBadge) countBadge.textContent = _filteredCount > 0 ? `${_filteredCount} records` : '';

  // Stat cards — use filtered data when any filter is active, otherwise default month view
  const el = id => document.getElementById(id);
  const deltaEl = el('exp-stat-delta');
  const hasFilter = filterState.categories.length > 0 || filterState.dateFrom || filterState.dateTo;
  if (hasFilter) {
    const total = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    const labelEl = document.querySelector('#exp-stat-this-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label2El = document.querySelector('#exp-stat-last-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label3El = document.querySelector('#exp-stat-total')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    if (labelEl) labelEl.textContent = 'Filtered Total';
    if (label2El) label2El.textContent = 'Avg per Record';
    if (label3El) label3El.textContent = 'Matching Records';
    if (el('exp-stat-this-month')) el('exp-stat-this-month').textContent = formatCurrency(total);
    if (el('exp-stat-last-month')) el('exp-stat-last-month').textContent = formatCurrency(avg);
    if (el('exp-stat-total')) el('exp-stat-total').textContent = filtered.length;
    if (deltaEl) deltaEl.innerHTML = '';
  } else {
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const labelEl = document.querySelector('#exp-stat-this-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label2El = document.querySelector('#exp-stat-last-month')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    const label3El = document.querySelector('#exp-stat-total')?.closest('.sec-stat-card')?.querySelector('.sec-stat-label');
    if (labelEl) labelEl.textContent = 'This Month';
    if (label2El) label2El.textContent = 'Last Month';
    if (label3El) label3El.textContent = 'Total Expenses';
    const thisMonth = all.filter(r => String(r.date ?? '').startsWith(curYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const lastMonth = all.filter(r => String(r.date ?? '').startsWith(prevYM)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (el('exp-stat-this-month')) el('exp-stat-this-month').textContent = formatCurrency(thisMonth);
    if (el('exp-stat-last-month')) el('exp-stat-last-month').textContent = formatCurrency(lastMonth);
    if (el('exp-stat-total')) el('exp-stat-total').textContent = all.length;
    // Delta badge
    if (deltaEl) {
      if (lastMonth === 0 || thisMonth === 0) {
        deltaEl.innerHTML = '';
      } else {
        const pctChange = ((thisMonth - lastMonth) / lastMonth) * 100;
        const up = pctChange > 0;
        const cls = up ? 'sec-stat-delta--up' : 'sec-stat-delta--down';
        const icon = up ? 'bi-arrow-up-short' : 'bi-arrow-down-short';
        const sign = up ? '↑' : '↓';
        deltaEl.className = `sec-stat-delta ${cls}`;
        deltaEl.innerHTML = `<i class="bi ${icon}"></i>${sign} ${Math.abs(pctChange).toFixed(1)}% vs last month`;
      }
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── init() (Task 5.3) ───────────────────────────────────────────────────────

/**
 * Binds the expense form submit handler and filter controls.
 * Must be called after DOMContentLoaded.
 */
export function init() {
  _bindForm();
  _bindFilters();
  // Re-render whenever the store changes
  store.on('expenses', render);
}

function _bindForm() {
  const form = document.getElementById('expense-form');
  if (!form) return;

  const categorySelect = form.querySelector('#expense-category');
  const subCategoryWrapper = document.getElementById('expense-subcategory-wrapper');
  const subCategorySelect = document.getElementById('expense-subcategory');
  const submitBtn = form.querySelector('[type="submit"]');
  const cancelBtn = document.getElementById('expense-cancel-edit');

  // Dependent payment method dropdowns
  const refreshPayment = bindDependentPaymentSelect('expense-payment-type', 'expense-payment-method', store);
  store.on('accounts',    refreshPayment);
  store.on('creditCards', refreshPayment);

  function refreshSubCategories() {
    const selectedCat = categorySelect?.value ?? '';
    const all = store.get('subCategories') ?? [];
    const subs = all.filter(r => r.category === selectedCat).map(r => r.subCategory);
    if (subs.length > 0) {
      if (subCategorySelect) {
        const cur = subCategorySelect.value;
        subCategorySelect.innerHTML = '<option value="">Select sub-category… (optional)</option>' +
          subs.map(s => `<option value="${escapeHtml(s)}"${s === cur ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
      }
      if (subCategoryWrapper) subCategoryWrapper.classList.remove('d-none');
    } else {
      if (subCategoryWrapper) subCategoryWrapper.classList.add('d-none');
      if (subCategorySelect) subCategorySelect.value = '';
    }
  }

  if (categorySelect) categorySelect.addEventListener('change', refreshSubCategories);
  store.on('subCategories', refreshSubCategories);

  // Cancel edit
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingIndex = null;
      form.reset();
      if (subCategoryWrapper) subCategoryWrapper.classList.add('d-none');
      if (submitBtn) submitBtn.textContent = 'Add Expense';
      cancelBtn.classList.add('d-none');
      hideError();
      _hideDuplicateWarning();
    });
  }

  // Duplicate warning buttons
  const saveAnywayBtn = document.getElementById('expense-save-anyway');
  const cancelDuplicateBtn = document.getElementById('expense-cancel-duplicate');
  if (saveAnywayBtn) {
    saveAnywayBtn.addEventListener('click', () => {
      _forceExpenseSave = true;
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

    const date = form.querySelector('#expense-date')?.value?.trim() ?? '';
    const category = form.querySelector('#expense-category')?.value?.trim() ?? '';
    const subCategory = form.querySelector('#expense-subcategory')?.value?.trim() ?? '';
    const amount = form.querySelector('#expense-amount')?.value?.trim() ?? '';
    const description = form.querySelector('#expense-description')?.value?.trim() ?? '';
    const paymentMethod = form.querySelector('#expense-payment-method')?.value?.trim() ?? '';

    const reqResult = requireFields({ date, category, amount, description, paymentMethod }, ['date', 'category', 'amount', 'description', 'paymentMethod']);
    let hasErrors = false;

    if (!reqResult.valid) {
      reqResult.errors.forEach(err => {
        const field = err.split(' ')[0];
        const idMap = { date: 'expense-date', category: 'expense-category', amount: 'expense-amount', description: 'expense-description', paymentMethod: 'expense-payment-method' };
        if (idMap[field]) showFieldError(idMap[field], err);
      });
      hasErrors = true;
    }

    const amtResult = requirePositiveNumber(amount);
    if (!amtResult.valid) { showFieldError('expense-amount', amtResult.errors[0]); hasErrors = true; }
    if (hasErrors) return;

    const record = { date, category, subCategory, amount: parseFloat(amount), description, paymentMethod };

    // Duplicate check (skip when force-saving)
    if (!_forceExpenseSave && _checkDuplicate(date, category, parseFloat(amount))) {
      _showDuplicateWarning();
      return;
    }
    _forceExpenseSave = false;

    try {
      if (_editingIndex !== null) {
        // Update existing record
        const records = [...(store.get('expenses') ?? [])];
        const oldRecord = records[_editingIndex];
        records[_editingIndex] = record;
        await writeAllRows(CONFIG.sheets.expenses, records.map(serialize));
        store.set('expenses', records);

        // Reverse sync: if this expense mirrors a vehicle expense, update it too
        const veId = _extractVeId(oldRecord?.description);
        if (veId) {
          const { serializeVehicleExpense } = await import('./vehicles.js');
          const veList = store.get('vehicleExpenses') ?? [];
          const veIdx = veList.findIndex(e => e.id === veId);
          if (veIdx !== -1) {
            const oldVe = veList[veIdx];
            // Strip the [ve:id] marker from description for the vehicle expense
            const cleanDesc = description.replace(/\s*\[ve:[^\]]+\]/, '').trim();
            const updatedVe = { ...oldVe, date, expenseType: category, amount: parseFloat(amount), paymentMethod, description: cleanDesc };
            const newVeList = veList.map((e, i) => i === veIdx ? updatedVe : e);
            await writeAllRows(CONFIG.sheets.vehicleExp, newVeList.map(serializeVehicleExpense));
            store.set('vehicleExpenses', newVeList);
          }
        }

        _editingIndex = null;
        if (submitBtn) submitBtn.textContent = 'Add Expense';
        if (cancelBtn) cancelBtn.classList.add('d-none');
      } else {
        await appendRow(CONFIG.sheets.expenses, serialize(record));
        store.set('expenses', [...(store.get('expenses') ?? []), record]);
      }
      form.reset();
      if (subCategoryWrapper) subCategoryWrapper.classList.add('d-none');
      _hideDuplicateWarning();
      const modal = document.getElementById('oc-expense');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showError(err.message ?? 'Failed to save expense. Please try again.');
    }
  });
}

function _startEdit(idx) {
  const records = store.get('expenses') ?? [];
  const r = records[idx];
  if (!r) return;

  _editingIndex = idx;

  const form = document.getElementById('expense-form');
  const submitBtn = form?.querySelector('[type="submit"]');
  const cancelBtn = document.getElementById('expense-cancel-edit');
  const subCategoryWrapper = document.getElementById('expense-subcategory-wrapper');
  const subCategorySelect = document.getElementById('expense-subcategory');

  if (form) {
    form.querySelector('#expense-date').value = r.date;
    form.querySelector('#expense-amount').value = r.amount;
    form.querySelector('#expense-description').value = r.description;

    // Set category then trigger change to populate sub-categories
    const catSelect = form.querySelector('#expense-category');
    if (catSelect) { catSelect.value = r.category; catSelect.dispatchEvent(new Event('change')); }

    // Set sub-category after a tick so the dropdown is populated
    setTimeout(() => {
      if (subCategorySelect) subCategorySelect.value = r.subCategory ?? '';
      if (r.subCategory && subCategoryWrapper) subCategoryWrapper.classList.remove('d-none');
    }, 0);

    // Restore dependent payment selects
    restorePaymentSelects('expense-payment-type', 'expense-payment-method', r.paymentMethod, store);
  }

  if (submitBtn) submitBtn.textContent = 'Update Expense';
  if (cancelBtn) cancelBtn.classList.remove('d-none');

  // Open the modal
  const modal = document.getElementById('oc-expense');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

import { epConfirm } from './confirm.js';

/** Extract vehicle expense id from a description containing [ve:id] marker. */
function _extractVeId(description) {
  const m = String(description ?? '').match(/\[ve:([^\]]+)\]/);
  return m ? m[1] : null;
}

async function _deleteRecord(idx) {
  if (!await epConfirm('Delete this expense?')) return;
  const records = [...(store.get('expenses') ?? [])];
  const deleted = records[idx];
  records.splice(idx, 1);
  try {
    await writeAllRows(CONFIG.sheets.expenses, records.map(serialize));
    store.set('expenses', records);

    // Show undo toast
    showUndoToast('Expense deleted', async () => {
      const current = [...(store.get('expenses') ?? [])];
      current.splice(idx, 0, deleted);
      await writeAllRows(CONFIG.sheets.expenses, current.map(serialize));
      store.set('expenses', current);
    });

    // Reverse sync: if this expense mirrors a vehicle expense, delete it too
    const veId = _extractVeId(deleted?.description);
    if (veId) {
      const { serializeVehicleExpense } = await import('./vehicles.js');
      const veList = (store.get('vehicleExpenses') ?? []).filter(e => e.id !== veId);
      await writeAllRows(CONFIG.sheets.vehicleExp, veList.map(serializeVehicleExpense));
      store.set('vehicleExpenses', veList);
    }
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── Filters (Task 5.5) ──────────────────────────────────────────────────────

function _buildPaymentMethodDropdown() {
  const btn = document.getElementById('expense-pm-btn');
  const menu = document.getElementById('expense-pm-menu');
  if (!btn || !menu) return;
  const accounts = (store.get('accounts') ?? []).map(a => a.name).filter(Boolean);
  const cards = (store.get('creditCards') ?? []).map(c => c.name).filter(Boolean);
  const all = [...accounts, ...cards].sort((a, b) => a.localeCompare(b));
  menu.innerHTML = all.length === 0
    ? '<div class="fdd-empty">No accounts yet</div>'
    : all.map(p => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(p)}" ${filterState.paymentMethods.includes(p) ? 'checked' : ''} />
        <span>${escapeHtml(p)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.paymentMethods = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updatePmBtnLabel(btn);
      render();
    });
  });
  _updatePmBtnLabel(btn);
}

function _updatePmBtnLabel(btn) {
  if (!btn) return;
  const n = filterState.paymentMethods.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-wallet2 me-1"></i>Account <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-wallet2 me-1"></i>Account <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _buildCategoryDropdown() {
  const btn = document.getElementById('expense-cat-btn');
  const menu = document.getElementById('expense-cat-menu');
  if (!btn || !menu) return;
  const cats = (store.get('expenseCategories') ?? []).map(c => c.name ?? c).filter(Boolean).sort((a, b) => a.localeCompare(b));
  menu.innerHTML = cats.length === 0
    ? '<div class="fdd-empty">No categories yet</div>'
    : cats.map(c => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(c)}" ${filterState.categories.includes(c) ? 'checked' : ''} />
        <span>${escapeHtml(c)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.categories = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateCatBtnLabel(btn);
      render();
    });
  });
  _updateCatBtnLabel(btn);
}

function _updateCatBtnLabel(btn) {
  const n = filterState.categories.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-funnel me-1"></i>Category <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-funnel-fill me-1"></i>Category <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _updateFilterSummary() {
  const strip = document.getElementById('expense-filter-summary');
  if (!strip) return;
  const parts = [];
  if (filterState.categories.length) parts.push(`Category: ${filterState.categories.join(', ')}`);
  if (filterState.paymentMethods.length) parts.push(`Account: ${filterState.paymentMethods.join(', ')}`);
  if (filterState.dateFrom || filterState.dateTo) parts.push(`Date: ${filterState.dateFrom || '…'} → ${filterState.dateTo || '…'}`);
  if (filterState.search) parts.push(`Search: “${filterState.search}”`);
  if (parts.length === 0) {
    strip.classList.add('d-none'); strip.innerHTML = '';
  } else {
    strip.classList.remove('d-none');
    strip.innerHTML = `<i class="bi bi-funnel-fill me-1"></i>Filtered by: ${parts.map(p => `<span class="exp-filter-chip">${escapeHtml(p)}</span>`).join('')}`;
  }
}

function _bindFilters() {
  const btn = document.getElementById('expense-cat-btn');
  const menu = document.getElementById('expense-cat-menu');
  const pmBtn = document.getElementById('expense-pm-btn');
  const pmMenu = document.getElementById('expense-pm-menu');
  const dateFrom = document.getElementById('expense-date-from');
  const dateTo = document.getElementById('expense-date-to');
  const clearBtn = document.getElementById('expense-clear-filters');
  const dateRangeError = document.getElementById('expense-date-range-error');
  const searchInput = document.getElementById('expense-search');
  const presetBtns = document.querySelectorAll('#tab-expenses .exp-preset-btn');

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

  // Toggle dropdown
  _wireDropdown(btn, menu);
  _wireDropdown(pmBtn, pmMenu);

  // Search (debounced)
  let _searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        filterState.search = searchInput.value.trim();
        render();
      }, 220);
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
        case 'this-month':  from = `${now.getFullYear()}-${_pad(now.getMonth()+1)}-01`;  to = _ymd(now); break;
        case 'last-month': { const lm = new Date(now.getFullYear(), now.getMonth()-1, 1); from = _ymd(lm); to = _ymd(new Date(now.getFullYear(), now.getMonth(), 0)); break; }
        case 'last-30':    { const d30 = new Date(now); d30.setDate(d30.getDate()-30);    from = _ymd(d30); to = _ymd(now); break; }
        case 'this-year':  from = `${now.getFullYear()}-01-01`; to = _ymd(now); break;
      }
      if (dateFrom) dateFrom.value = from;
      if (dateTo)   dateTo.value   = to;
      filterState.dateFrom = from; filterState.dateTo = to;
      presetBtns.forEach(b => b.classList.toggle('exp-preset-btn--active', b === btn2));
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
    // Deactivate preset highlights when dates are manually changed
    presetBtns.forEach(b => b.classList.remove('exp-preset-btn--active'));
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
      filterState.categories = [];
      filterState.paymentMethods = [];
      filterState.dateFrom = '';
      filterState.dateTo = '';
      filterState.search = '';
      if (menu) menu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (pmMenu) pmMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (btn) _updateCatBtnLabel(btn);
      if (pmBtn) _updatePmBtnLabel(pmBtn);
      presetBtns.forEach(b => b.classList.remove('exp-preset-btn--active'));
      render();
    });
  }

  _buildCategoryDropdown();
  _buildPaymentMethodDropdown();
  store.on('expenseCategories', _buildCategoryDropdown);
  store.on('accounts', _buildPaymentMethodDropdown);
  store.on('creditCards', _buildPaymentMethodDropdown);
}
