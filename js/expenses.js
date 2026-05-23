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
// Column order: A=date, B=category, C=subCategory, D=amount, E=description, F=paymentMethod, G=tags, H=time

/**
 * Converts an ExpenseRecord object to a row array for Google Sheets.
 * @param {{ date: string, category: string, subCategory: string, amount: number, description: string, paymentMethod: string, tags: string[] }} record
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
    (record.tags ?? []).join(','),
    record.time ?? '',
  ];
}

/**
 * Converts a raw Sheets row array to an ExpenseRecord object.
 * @param {string[]} row
 * @returns {{ date: string, category: string, subCategory: string, amount: number, description: string, paymentMethod: string, tags: string[] }}
 */
export function deserialize(row) {
  return {
    date: row[0] ?? '',
    category: row[1] ?? '',
    subCategory: row[2] ?? '',
    amount: parseFloat(row[3]) || 0,
    description: row[4] ?? '',
    paymentMethod: row[5] ?? '',
    tags: row[6] ? row[6].split(',').map(t => t.trim()).filter(Boolean) : [],
    time: row[7] ?? '',
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
  tags: [],           // string[] — empty means "all"
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
    if (filterState.tags.length > 0 && !filterState.tags.some(t => (r.tags ?? []).includes(t))) return false;
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

// ─── Time formatter ─────────────────────────────────────────────────────────
function _fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
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
            const tagsHtml = (r.tags ?? []).length > 0
              ? `<div class="cpt-tags-row">${r.tags.map(t => `<span class="cpt-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}</div>`
              : '';
            return `<tr>
              <td>
                <div class="cpt-desc-primary" title="${desc}">${desc}</div>
                ${r.subCategory ? `<div class="cpt-desc-secondary">${escapeHtml(r.subCategory)}</div>` : ''}
                ${tagsHtml}
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
              <td class="cpt-date">${formatDate(r.date)}${r.time ? `<div class="cpt-time">${_fmtTime(r.time)}</div>` : ''}</td>
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
        // Click tag pill to filter by that tag
        container.querySelectorAll('.cpt-tag[data-tag]').forEach(pill => {
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const tag = pill.dataset.tag;
            if (!filterState.tags.includes(tag)) {
              filterState.tags.push(tag);
              _updateTagBtnLabel(document.getElementById('expense-tag-btn'));
              render();
            }
          });
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
      // default: date then time
      if (_sortDir === 'asc') return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : 0;
      return b.date < a.date ? -1 : b.date > a.date ? 1 : (b.time ?? '') < (a.time ?? '') ? -1 : (b.time ?? '') > (a.time ?? '') ? 1 : 0;
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

// ─── Tag input helpers ────────────────────────────────────────────────────────

/** Suggested tags shown in the autocomplete dropdown */
const _SUGGESTED_TAGS = [
  'reimbursable', 'tax-deductible', 'avoidable', 'essential', 'one-time',
  'recurring', 'work', 'personal', 'family', 'emergency', 'discretionary',
  'investment', 'gift', 'travel', 'medical',
];

// ─── Smart auto-tag detection engine ─────────────────────────────────────────

/**
 * Category → tags that are almost always relevant for that category.
 * Keys are lowercase for case-insensitive matching.
 */
const _CAT_TAG_MAP = {
  // Food & dining
  'food':            ['essential', 'discretionary'],
  'groceries':       ['essential'],
  'restaurant':      ['discretionary', 'avoidable'],
  'dining':          ['discretionary', 'avoidable'],
  'cafe':            ['discretionary', 'avoidable'],
  'coffee':          ['discretionary', 'avoidable'],
  'swiggy':          ['discretionary', 'avoidable'],
  'zomato':          ['discretionary', 'avoidable'],

  // Transport
  'transport':       ['essential'],
  'travel':          ['travel'],
  'fuel':            ['essential', 'vehicle'],
  'petrol':          ['essential', 'vehicle'],
  'cab':             ['discretionary'],
  'uber':            ['discretionary'],
  'ola':             ['discretionary'],
  'auto':            ['essential'],
  'metro':           ['essential'],
  'bus':             ['essential'],
  'flight':          ['travel', 'one-time'],
  'train':           ['travel'],
  'hotel':           ['travel', 'one-time'],

  // Housing
  'rent':            ['essential', 'recurring'],
  'housing':         ['essential'],
  'maintenance':     ['essential'],
  'electricity':     ['essential', 'recurring'],
  'water':           ['essential', 'recurring'],
  'gas':             ['essential', 'recurring'],
  'internet':        ['essential', 'recurring'],
  'broadband':       ['essential', 'recurring'],

  // Health & medical
  'health':          ['essential', 'medical'],
  'medical':         ['essential', 'medical'],
  'medicine':        ['essential', 'medical'],
  'pharmacy':        ['essential', 'medical'],
  'doctor':          ['essential', 'medical'],
  'hospital':        ['essential', 'medical'],
  'gym':             ['discretionary', 'health'],
  'fitness':         ['discretionary', 'health'],

  // Education
  'education':       ['essential', 'investment'],
  'school':          ['essential'],
  'college':         ['essential'],
  'course':          ['investment', 'work'],
  'books':           ['essential', 'investment'],
  'tuition':         ['essential'],

  // Shopping & personal
  'shopping':        ['discretionary', 'avoidable'],
  'clothing':        ['discretionary'],
  'fashion':         ['discretionary', 'avoidable'],
  'electronics':     ['discretionary', 'one-time'],
  'gadgets':         ['discretionary', 'one-time'],
  'personal care':   ['essential'],
  'grooming':        ['discretionary'],
  'salon':           ['discretionary', 'avoidable'],

  // Entertainment
  'entertainment':   ['discretionary', 'avoidable'],
  'movies':          ['discretionary', 'avoidable'],
  'games':           ['discretionary', 'avoidable'],
  'sports':          ['discretionary'],
  'events':          ['discretionary', 'one-time'],

  // Subscriptions
  'subscriptions':   ['recurring', 'discretionary'],
  'netflix':         ['recurring', 'discretionary'],
  'spotify':         ['recurring', 'discretionary'],
  'amazon prime':    ['recurring', 'discretionary'],

  // Finance & investment
  'investment':      ['investment', 'essential'],
  'insurance':       ['essential', 'recurring'],
  'emi':             ['essential', 'recurring'],
  'loan':            ['essential', 'recurring'],
  'tax':             ['essential', 'tax-deductible'],
  'savings':         ['investment', 'essential'],
  'mutual fund':     ['investment'],
  'sip':             ['investment', 'recurring'],

  // Work & business
  'work':            ['work', 'reimbursable'],
  'office':          ['work'],
  'business':        ['work', 'reimbursable'],
  'client':          ['work', 'reimbursable'],
  'conference':      ['work', 'reimbursable', 'one-time'],
  'stationery':      ['work'],

  // Gifts & social
  'gift':            ['gift', 'one-time', 'discretionary'],
  'donation':        ['gift', 'tax-deductible'],
  'charity':         ['gift', 'tax-deductible'],
  'wedding':         ['gift', 'one-time'],
  'birthday':        ['gift', 'one-time'],

  // Household
  'household':       ['essential'],
  'cleaning':        ['essential'],
  'repair':          ['essential', 'one-time'],
  'appliance':       ['essential', 'one-time'],

  // Misc
  'emergency':       ['emergency', 'one-time'],
  'miscellaneous':   ['one-time'],
  'misc':            ['one-time'],
  'cc payment':      ['essential', 'recurring'],
};

/**
 * Description keyword → tags.
 * Checked as substring match (case-insensitive) against the description.
 */
const _DESC_TAG_MAP = [
  // Reimbursable signals
  { keywords: ['office', 'client', 'business trip', 'work trip', 'conference', 'team lunch', 'team dinner', 'company', 'reimburse', 'expense claim'], tags: ['reimbursable', 'work'] },
  // Tax-deductible signals
  { keywords: ['insurance', 'ppf', 'elss', 'nps', 'tax', '80c', '80d', 'donation', 'charity', 'school fee', 'tuition fee', 'medical bill', 'hospital bill'], tags: ['tax-deductible'] },
  // Travel signals
  { keywords: ['flight', 'hotel', 'airbnb', 'hostel', 'resort', 'trip', 'vacation', 'holiday', 'tour', 'visa', 'passport', 'airport', 'railway', 'bus ticket'], tags: ['travel', 'one-time'] },
  // Recurring signals
  { keywords: ['monthly', 'subscription', 'emi', 'rent', 'salary', 'premium', 'renewal', 'annual', 'yearly', 'quarterly', 'auto-debit', 'standing order'], tags: ['recurring'] },
  // Emergency signals
  { keywords: ['emergency', 'urgent', 'hospital', 'accident', 'repair', 'breakdown', 'ambulance'], tags: ['emergency'] },
  // Avoidable signals
  { keywords: ['impulse', 'unnecessary', 'luxury', 'splurge', 'treat', 'party', 'bar', 'pub', 'alcohol', 'cigarette', 'tobacco', 'gambling', 'casino'], tags: ['avoidable', 'discretionary'] },
  // Investment signals
  { keywords: ['mutual fund', 'sip', 'stock', 'share', 'equity', 'bond', 'fd', 'fixed deposit', 'ppf', 'nps', 'elss', 'gold', 'crypto'], tags: ['investment'] },
  // Medical signals
  { keywords: ['doctor', 'hospital', 'clinic', 'pharmacy', 'medicine', 'tablet', 'injection', 'surgery', 'dental', 'eye', 'lab test', 'blood test', 'scan', 'xray', 'x-ray'], tags: ['medical', 'essential'] },
  // Gift signals
  { keywords: ['gift', 'present', 'birthday', 'anniversary', 'wedding', 'baby shower', 'farewell', 'congratulations'], tags: ['gift', 'one-time'] },
  // Family signals
  { keywords: ['family', 'kids', 'child', 'school', 'parent', 'mom', 'dad', 'spouse', 'wife', 'husband'], tags: ['family'] },
  // Essential signals
  { keywords: ['grocery', 'vegetables', 'milk', 'bread', 'rice', 'dal', 'ration', 'water bill', 'electricity bill', 'gas bill'], tags: ['essential'] },
];

/**
 * Compute auto-detected tags from category + description.
 * Returns an array of { tag, reason } objects, sorted by confidence.
 * @param {string} category
 * @param {string} description
 * @returns {{ tag: string, reason: string, source: 'category'|'description'|'history' }[]}
 */
function _detectTags(category, description) {
  const catLower  = (category    ?? '').toLowerCase().trim();
  const descLower = (description ?? '').toLowerCase().trim();
  const found = new Map(); // tag → { reason, source, score }

  const _add = (tag, reason, source, score) => {
    if (!found.has(tag) || found.get(tag).score < score) {
      found.set(tag, { reason, source, score });
    }
  };

  // 1. Category-based detection
  for (const [key, tags] of Object.entries(_CAT_TAG_MAP)) {
    if (catLower.includes(key) || key.includes(catLower) && catLower.length > 2) {
      tags.forEach(t => _add(t, `Category: ${category}`, 'category', 10));
    }
  }

  // 2. Description keyword detection
  for (const { keywords, tags } of _DESC_TAG_MAP) {
    for (const kw of keywords) {
      if (descLower.includes(kw)) {
        tags.forEach(t => _add(t, `Keyword: "${kw}"`, 'description', 8));
        break;
      }
    }
  }

  // 3. History-based: tags most commonly used with this category
  const allExpenses = store.get('expenses') ?? [];
  const catHistory = allExpenses.filter(e =>
    e.category?.toLowerCase() === catLower && (e.tags ?? []).length > 0
  );
  if (catHistory.length > 0) {
    const tagFreq = {};
    catHistory.forEach(e => (e.tags ?? []).forEach(t => { tagFreq[t] = (tagFreq[t] ?? 0) + 1; }));
    const total = catHistory.length;
    Object.entries(tagFreq)
      .filter(([, count]) => count / total >= 0.2) // used in ≥20% of this category's expenses
      .forEach(([t, count]) => {
        const pct = Math.round((count / total) * 100);
        _add(t, `Used ${pct}% of the time in ${category}`, 'history', 6 + (count / total) * 4);
      });
  }

  // 4. Description similarity: tags used on expenses with similar descriptions
  if (descLower.length >= 3) {
    const words = descLower.split(/\s+/).filter(w => w.length >= 3);
    const similar = allExpenses.filter(e =>
      (e.tags ?? []).length > 0 &&
      words.some(w => (e.description ?? '').toLowerCase().includes(w))
    );
    const descTagFreq = {};
    similar.forEach(e => (e.tags ?? []).forEach(t => { descTagFreq[t] = (descTagFreq[t] ?? 0) + 1; }));
    Object.entries(descTagFreq)
      .filter(([, count]) => count >= 2)
      .forEach(([t, count]) => {
        _add(t, `Common with similar descriptions`, 'history', 4 + Math.min(count, 5));
      });
  }

  return [...found.entries()]
    .map(([tag, meta]) => ({ tag, ...meta }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Render the auto-tag suggestion chips below the tag input.
 * Only shows tags not already added.
 */
function _renderAutoTagSuggestions(category, description) {
  const panel = document.getElementById('expense-auto-tag-panel');
  if (!panel) return;

  const detected = _detectTags(category, description);
  const existing = _getFormTags();
  const toShow = detected.filter(d => !existing.includes(d.tag)).slice(0, 8);

  if (!toShow.length) {
    panel.innerHTML = '';
    panel.classList.add('d-none');
    return;
  }

  // Group by source for the label
  const hasCat  = toShow.some(d => d.source === 'category');
  const hasDesc = toShow.some(d => d.source === 'description');
  const hasHist = toShow.some(d => d.source === 'history');
  const sources = [hasCat && 'category', hasDesc && 'description', hasHist && 'history'].filter(Boolean);
  const sourceLabel = sources.length === 1
    ? { category: 'from category', description: 'from description', history: 'from your history' }[sources[0]]
    : 'auto-detected';

  panel.innerHTML = `
    <div class="auto-tag-label">
      <i class="bi bi-stars me-1"></i>Suggested <span class="auto-tag-source">${sourceLabel}</span>
      <span class="auto-tag-hint">— click to add</span>
    </div>
    <div class="auto-tag-chips">
      ${toShow.map(d => `
        <button type="button" class="auto-tag-chip" data-tag="${escapeHtml(d.tag)}" title="${escapeHtml(d.reason)}">
          <i class="bi bi-plus-sm"></i>#${escapeHtml(d.tag)}
          <span class="auto-tag-source-badge auto-tag-source-badge--${d.source}">${d.source === 'category' ? 'cat' : d.source === 'description' ? 'desc' : 'hist'}</span>
        </button>`).join('')}
    </div>`;
  panel.classList.remove('d-none');

  panel.querySelectorAll('.auto-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _addFormTag(chip.dataset.tag);
      chip.remove();
      // Hide panel if no chips left
      if (!panel.querySelector('.auto-tag-chip')) {
        panel.innerHTML = '';
        panel.classList.add('d-none');
      }
    });
  });
}


/** Normalise a raw tag string: lowercase, replace spaces with hyphens, strip special chars */
function _normaliseTag(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
}

/** Read current tags from the tag input widget */
function _getFormTags() {
  const container = document.getElementById('expense-tags-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.tag-pill[data-tag]')).map(p => p.dataset.tag);
}

/** Render the tag pills inside the tag input widget */
function _renderFormTags(tags) {
  const container = document.getElementById('expense-tags-container');
  if (!container) return;
  // Remove existing pills (keep the input)
  container.querySelectorAll('.tag-pill').forEach(p => p.remove());
  const input = container.querySelector('.tag-input-field');
  tags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.dataset.tag = tag;
    pill.innerHTML = `#${escapeHtml(tag)}<button type="button" class="tag-pill-remove" aria-label="Remove tag ${tag}">&times;</button>`;
    pill.querySelector('.tag-pill-remove').addEventListener('click', () => {
      pill.remove();
    });
    container.insertBefore(pill, input);
  });
}

/** Add a single tag to the form widget (deduplicates) */
function _addFormTag(raw) {
  const tag = _normaliseTag(raw);
  if (!tag) return;
  const existing = _getFormTags();
  if (existing.includes(tag)) return;
  _renderFormTags([...existing, tag]);
}

/** Bind the tag input widget interactions */
function _bindTagInput() {
  const container = document.getElementById('expense-tags-container');
  const input = document.getElementById('expense-tag-input');
  const dropdown = document.getElementById('expense-tag-suggestions');
  if (!container || !input || !dropdown) return;

  function _showSuggestions(query) {
    const existing = _getFormTags();
    const category = document.getElementById('expense-category')?.value ?? '';
    const description = document.getElementById('expense-description')?.value ?? '';

    // Smart pool: detected tags first, then all previously-used tags
    const detected = _detectTags(category, description).map(d => d.tag);
    const allExpenses = store.get('expenses') ?? [];
    const usedTags = [...new Set(allExpenses.flatMap(e => e.tags ?? []))];
    const pool = [...new Set([...detected, ...usedTags])].filter(t => !existing.includes(t));

    const q = query.toLowerCase().trim();
    const matches = q
      ? pool.filter(t => t.includes(q)).slice(0, 8)
      : pool.slice(0, 8);
    if (!matches.length) { dropdown.classList.add('d-none'); return; }

    // Label each match with its source
    const detectedSet = new Set(detected);
    dropdown.innerHTML = matches.map(t => {
      const badge = detectedSet.has(t)
        ? `<span class="tag-sugg-badge">auto</span>`
        : '';
      return `<div class="tag-suggestion-item" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}${badge}</div>`;
    }).join('');
    dropdown.classList.remove('d-none');
    dropdown.querySelectorAll('.tag-suggestion-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        _addFormTag(item.dataset.tag);
        input.value = '';
        dropdown.classList.add('d-none');
        // Refresh auto-tag panel after adding
        const cat  = document.getElementById('expense-category')?.value ?? '';
        const desc = document.getElementById('expense-description')?.value ?? '';
        _renderAutoTagSuggestions(cat, desc);
        input.focus();
      });
    });
  }

  input.addEventListener('input', () => _showSuggestions(input.value));
  input.addEventListener('focus', () => _showSuggestions(input.value));
  input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('d-none'), 150));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val) { _addFormTag(val); input.value = ''; }
      dropdown.classList.add('d-none');
    } else if (e.key === 'Backspace' && !input.value) {
      // Remove last tag on backspace when input is empty
      const pills = container.querySelectorAll('.tag-pill');
      if (pills.length) pills[pills.length - 1].remove();
    }
  });

  // Click on container focuses the input
  container.addEventListener('click', (e) => {
    if (e.target === container) input.focus();
  });
}

function _bindForm() {
  const form = document.getElementById('expense-form');
  if (!form) return;

  // Auto-fill current time when opening the modal for a new entry
  document.getElementById('oc-expense')?.addEventListener('show.bs.modal', () => {
    if (_editingIndex === null) {
      const ti = document.getElementById('expense-time');
      if (ti) {
        const n = new Date();
        ti.value = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
      }
    }
  });

  // Bind tag input widget
  _bindTagInput();

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

  // Auto-tag detection: trigger when category or description changes
  function _refreshAutoTags() {
    const cat  = categorySelect?.value ?? '';
    const desc = document.getElementById('expense-description')?.value ?? '';
    _renderAutoTagSuggestions(cat, desc);
  }
  if (categorySelect) categorySelect.addEventListener('change', _refreshAutoTags);
  const descInput = document.getElementById('expense-description');
  if (descInput) {
    let _descTimer;
    descInput.addEventListener('input', () => {
      clearTimeout(_descTimer);
      _descTimer = setTimeout(_refreshAutoTags, 350);
    });
  }

  // Cancel edit
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _editingIndex = null;
      form.reset();
      _renderFormTags([]);
      const panel = document.getElementById('expense-auto-tag-panel');
      if (panel) { panel.innerHTML = ''; panel.classList.add('d-none'); }
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
    const time = form.querySelector('#expense-time')?.value?.trim() ?? '';
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

    const record = { date, time, category, subCategory, amount: parseFloat(amount), description, paymentMethod, tags: _getFormTags() };

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
      _renderFormTags([]);
      const autoPanel = document.getElementById('expense-auto-tag-panel');
      if (autoPanel) { autoPanel.innerHTML = ''; autoPanel.classList.add('d-none'); }
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
    const timeInput = form.querySelector('#expense-time');
    if (timeInput) timeInput.value = r.time ?? '';
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

    // Restore tags
    _renderFormTags(r.tags ?? []);
    // Trigger auto-tag suggestions for the restored category/description
    setTimeout(() => _renderAutoTagSuggestions(r.category ?? '', r.description ?? ''), 50);

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

function _buildTagDropdown() {
  const btn = document.getElementById('expense-tag-btn');
  const menu = document.getElementById('expense-tag-menu');
  if (!btn || !menu) return;
  const allExpenses = store.get('expenses') ?? [];
  const allTags = [...new Set(allExpenses.flatMap(e => e.tags ?? []))].sort((a, b) => a.localeCompare(b));
  menu.innerHTML = allTags.length === 0
    ? '<div class="fdd-empty">No tags used yet</div>'
    : allTags.map(t => `
      <label class="fdd-item">
        <input type="checkbox" class="fdd-check" value="${escapeHtml(t)}" ${filterState.tags.includes(t) ? 'checked' : ''} />
        <span>#${escapeHtml(t)}</span>
      </label>`).join('');
  menu.querySelectorAll('.fdd-check').forEach(cb => {
    cb.addEventListener('change', () => {
      filterState.tags = Array.from(menu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
      _updateTagBtnLabel(btn);
      render();
    });
  });
  _updateTagBtnLabel(btn);
}

function _updateTagBtnLabel(btn) {
  if (!btn) return;
  const n = filterState.tags.length;
  btn.innerHTML = n === 0
    ? '<i class="bi bi-tag me-1"></i>Tags <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>'
    : `<i class="bi bi-tag-fill me-1"></i>Tags <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

function _bindFilters() {
  const btn = document.getElementById('expense-cat-btn');
  const menu = document.getElementById('expense-cat-menu');
  const pmBtn = document.getElementById('expense-pm-btn');
  const pmMenu = document.getElementById('expense-pm-menu');
  const tagBtn = document.getElementById('expense-tag-btn');
  const tagMenu = document.getElementById('expense-tag-menu');
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
  _wireDropdown(tagBtn, tagMenu);

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
      filterState.tags = [];
      filterState.dateFrom = '';
      filterState.dateTo = '';
      filterState.search = '';
      if (menu) menu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (pmMenu) pmMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (tagMenu) tagMenu.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      if (btn) _updateCatBtnLabel(btn);
      if (pmBtn) _updatePmBtnLabel(pmBtn);
      if (tagBtn) _updateTagBtnLabel(tagBtn);
      presetBtns.forEach(b => b.classList.remove('exp-preset-btn--active'));
      render();
    });
  }

  _buildCategoryDropdown();
  _buildPaymentMethodDropdown();
  _buildTagDropdown();
  store.on('expenseCategories', _buildCategoryDropdown);
  store.on('accounts', _buildPaymentMethodDropdown);
  store.on('creditCards', _buildPaymentMethodDropdown);
  store.on('expenses', _buildTagDropdown);
}
