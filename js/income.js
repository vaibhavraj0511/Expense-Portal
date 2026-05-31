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
// Column order: A=date, B=source, C=amount, D=description, E=receivedIn, F=time

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
    record.time ?? '',
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
    time: row[5] ?? '',
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

// ─── Time formatter ───────────────────────────────────────────────────────────────
function _fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Payment method icon ────────────────────────────────────────────────────────────────
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
              <td class="cpt-date">${formatDate(r.date)}${r.time ? `<div class="cpt-time">${_fmtTime(r.time)}</div>` : ''}</td>
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
      return _sortDir === 'asc'
        ? (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : 0)
        : (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.time ?? '') < (a.time ?? '') ? -1 : (b.time ?? '') > (a.time ?? '') ? 1 : 0);
    });
  _filteredCount = filtered.length;
  _filteredTotal = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  _getPaginator().update(sorted);

  // Income source breakdown chart (uses current filtered set)
  _renderIncomeSourceBreakdown(filtered);

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
    // Hero MoM badge
    const heroMom = el('inc-hero-mom');
    if (heroMom) {
      if (lastMonth > 0) {
        const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
        const up  = pct >= 0;
        heroMom.className = `inc-hero-mom-badge inc-hero-mom-badge--${up ? 'up' : 'down'}`;
        heroMom.innerHTML = `<i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${up ? '+' : ''}${pct}% vs last month`;
      } else {
        heroMom.className = 'inc-hero-mom-badge d-none';
      }
    }
  }
}

function _renderIncomeSourceBreakdown(records) {
  const chipsEl = document.getElementById('income-source-chips');
  const emptyEl = document.getElementById('income-source-empty');
  if (!chipsEl || !emptyEl) return;

  const positive = records.filter(r => Number(r.amount) > 0);
  const bySource = positive.reduce((map, r) => {
    const key = (r.source && r.source.trim()) || 'Other';
    map[key] = (map[key] ?? 0) + (Number(r.amount) || 0);
    return map;
  }, {});

  const entries = Object.entries(bySource).filter(([, amt]) => amt > 0).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((s, [, v]) => s + v, 0);

  if (!entries.length || total <= 0) {
    chipsEl.innerHTML = '';
    emptyEl.classList.remove('d-none');
    return;
  }

  emptyEl.classList.add('d-none');

  const MAX_VISIBLE_CHIPS = 6; // roughly fits one long row or two shorter rows on desktop
  let visibleEntries = entries;
  let hiddenEntries  = [];

  if (entries.length > MAX_VISIBLE_CHIPS) {
    visibleEntries = entries.slice(0, MAX_VISIBLE_CHIPS);
    hiddenEntries  = entries.slice(MAX_VISIBLE_CHIPS);
  }

  const chipsHtml = visibleEntries.map(([src, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    const clr = _srcColor(src);
    return `<div class="inc-source-chip">
      <span class="inc-source-chip-dot" style="background:${clr.color}"></span>
      <span class="inc-source-chip-name">${escapeHtml(src)}</span>
      <span class="inc-source-chip-amt">${formatCurrency(amt)}</span>
      <span class="inc-source-chip-pct">${pct}%</span>
    </div>`;
  }).join('');

  const hiddenHtml = hiddenEntries.map(([src, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    const clr = _srcColor(src);
    return `<div class="inc-source-chip inc-source-chip--hidden d-none">
      <span class="inc-source-chip-dot" style="background:${clr.color}"></span>
      <span class="inc-source-chip-name">${escapeHtml(src)}</span>
      <span class="inc-source-chip-amt">${formatCurrency(amt)}</span>
      <span class="inc-source-chip-pct">${pct}%</span>
    </div>`;
  }).join('');

  const moreBtnHtml = hiddenEntries.length
    ? `<button type="button" class="inc-source-more-btn" id="inc-source-more-btn">
         <i class="bi bi-chevron-down"></i>Show ${hiddenEntries.length} more
       </button>`
    : '';

  chipsEl.innerHTML = chipsHtml + hiddenHtml + moreBtnHtml;

  const moreBtn = document.getElementById('inc-source-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      chipsEl.querySelectorAll('.inc-source-chip--hidden').forEach(el => el.classList.remove('d-none'));
      moreBtn.remove();
    });
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
  _bindSalaryHikeForm();
  renderSalaryHikeLog();
  store.on('income', render);
  store.on('income', renderSalaryHikeLog);
}

// ── Salary Hike Log & Source Breakdown ───────────────────────────────────────

const _SH_KEY = 'ep_salary_hikes';
let _shChart = null;

function _getHikes() {
  try { return JSON.parse(localStorage.getItem(_SH_KEY) ?? '[]'); } catch { return []; }
}

function _saveHikes(arr) {
  localStorage.setItem(_SH_KEY, JSON.stringify(arr));
}

// Keywords used to detect salary-type income sources
const _SALARY_KEYWORDS = ['salary', 'wages', 'wage', 'paycheck', 'payroll', 'stipend', 'ctc', 'basic pay', 'pay slip'];

function _isSalarySource(source) {
  const s = (source ?? '').toLowerCase();
  return _SALARY_KEYWORDS.some(kw => s.includes(kw));
}

function _autoDetectSalary() {
  const income = store.get('income') ?? [];
  const salaryEntries = income.filter(r => _isSalarySource(r.source));
  if (!salaryEntries.length) return null;

  // Group by YYYY-MM, sum amounts
  const byMonth = {};
  salaryEntries.forEach(r => {
    const ym = String(r.date ?? '').slice(0, 7);
    if (ym.length !== 7) return;
    byMonth[ym] = (byMonth[ym] || 0) + (Number(r.amount) || 0);
  });

  const months = Object.keys(byMonth).sort();
  if (!months.length) return null;

  // Build chart data (every month)
  const chartLabels = months.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
  });
  const chartData = months.map(ym => byMonth[ym]);

  // Extend to today's label if last month is not current
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (months[months.length - 1] < curYM) {
    chartLabels.push('Now');
    chartData.push(byMonth[months[months.length - 1]]);
  }

  // Detect change points (where amount changed vs prior month)
  const changePoints = [];
  months.forEach((ym, i) => {
    const amt  = byMonth[ym];
    const prev = i > 0 ? byMonth[months[i - 1]] : null;
    if (prev === null || Math.abs(amt - prev) > 0.5) {
      changePoints.push({ ym, amount: amt, prevAmount: prev });
    }
  });

  return { months, byMonth, chartLabels, chartData, changePoints };
}

function _drawSalaryChart(labels, data, pointCount) {
  const canvas = document.getElementById('salary-hike-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_shChart) { _shChart.destroy(); _shChart = null; }
  _shChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Monthly Salary',
        data,
        borderColor: '#10b981',
        backgroundColor: '#10b98118',
        borderWidth: 2.5,
        pointRadius: ctx => ctx.dataIndex < pointCount ? 4 : 0,
        pointHoverRadius: 6,
        pointBackgroundColor: '#10b981',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        stepped: 'before',
        fill: true,
        tension: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${formatCurrency(ctx.raw)}/month` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: {
          beginAtZero: false,
          grid: { color: '#f1f5f9' },
          ticks: {
            color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 5,
            callback: v => v >= 1e5 ? '₹' + (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? '₹' + (v / 1e3).toFixed(0) + 'K' : '₹' + v,
          },
        },
      },
    },
  });
}

export function renderSalaryHikeLog() {
  const container = document.getElementById('salary-hike-container');
  if (!container) return;

  const auto        = _autoDetectSalary();
  const manualHikes = _getHikes().sort((a, b) => a.date.localeCompare(b.date));

  // ── AUTO MODE: salary income entries found ──────────────────────────────
  if (auto) {
    const { chartLabels, chartData, changePoints, byMonth } = auto;
    const first    = chartData[0];
    const last     = chartData[chartData.length - (chartLabels[chartLabels.length - 1] === 'Now' ? 2 : 1)];
    const totalPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;

    // Annual total: sum all salary months in current year
    const curYear  = String(new Date().getFullYear());
    const annualTotal = Object.entries(byMonth)
      .filter(([ym]) => ym.startsWith(curYear))
      .reduce((s, [, v]) => s + v, 0);

    const VISIBLE_LIMIT = 5;
    const reversed = [...changePoints].reverse();
    const visible  = reversed.slice(0, VISIBLE_LIMIT);
    const hidden   = reversed.slice(VISIBLE_LIMIT);

    const _buildCpHtml = (cp, ri) => {
      const diff = cp.prevAmount !== null ? cp.amount - cp.prevAmount : null;
      const pct  = (diff !== null && cp.prevAmount > 0) ? Math.round((diff / cp.prevAmount) * 100) : null;
      const [y, m] = cp.ym.split('-');
      const label  = new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      return `<div class="sh-item">
        <div class="sh-dot ${ri === 0 ? 'sh-dot--cur' : ''}"></div>
        <div class="sh-item-body">
          <div class="sh-item-top">
            <span class="sh-item-date">${label}</span>
            <span class="sh-item-note sh-item-note--auto">auto</span>
          </div>
          <div class="sh-item-bottom">
            <span class="sh-item-amt">${formatCurrency(cp.amount)}/mo</span>
            ${diff !== null
              ? `<span class="sh-item-delta ${diff >= 0 ? 'sh-delta--up' : 'sh-delta--down'}">
                  <i class="bi bi-arrow-${diff >= 0 ? 'up' : 'down'}-short"></i>${pct !== null ? Math.abs(pct) + '% ' : ''}(${diff >= 0 ? '+' : ''}${formatCurrency(Math.abs(diff))})
                </span>`
              : '<span class="sh-item-first">First recorded salary</span>'}
          </div>
        </div>
      </div>`;
    };

    container.innerHTML = `
      <div class="sh-auto-badge"><i class="bi bi-magic me-1"></i>Auto-detected from your&nbsp;<strong>Salary</strong>&nbsp;income entries</div>
      <div class="sh-summary">
        <div class="sh-stat"><div class="sh-stat-lbl">Starting</div><div class="sh-stat-val">${formatCurrency(first)}/mo</div></div>
        <div class="sh-stat"><div class="sh-stat-lbl">Current</div><div class="sh-stat-val" style="color:#10b981">${formatCurrency(last)}/mo</div></div>
        <div class="sh-stat"><div class="sh-stat-lbl">Total Growth</div><div class="sh-stat-val" style="color:${totalPct >= 0 ? '#10b981' : '#ef4444'}">${totalPct >= 0 ? '+' : ''}${totalPct}%</div></div>
        <div class="sh-stat sh-stat--annual"><div class="sh-stat-lbl">${curYear} Total</div><div class="sh-stat-val" style="color:#6366f1">${formatCurrency(annualTotal)}</div></div>
      </div>
      <div class="sh-chart-wrap"><canvas id="salary-hike-chart"></canvas></div>
      <div class="sh-timeline" id="sh-timeline-wrap">
        ${visible.map((cp, ri) => _buildCpHtml(cp, ri)).join('')}
        ${hidden.length > 0 ? `
          <div id="sh-hidden-rows" class="d-none">
            ${hidden.map((cp, ri) => _buildCpHtml(cp, VISIBLE_LIMIT + ri)).join('')}
          </div>
          <button class="sh-show-more-btn" id="sh-show-more">
            <i class="bi bi-chevron-down me-1"></i>Show ${hidden.length} older entr${hidden.length === 1 ? 'y' : 'ies'}
          </button>` : ''}
        ${manualHikes.length > 0 ? `
          <div class="sh-manual-divider"><span>Manual overrides</span></div>
          ${[...manualHikes].reverse().map((h, ri) => {
            const idx  = manualHikes.length - 1 - ri;
            const prev = idx > 0 ? manualHikes[idx - 1].amount : null;
            const diff = prev !== null ? h.amount - prev : null;
            const pct  = (diff !== null && prev > 0) ? Math.round((diff / prev) * 100) : null;
            return `<div class="sh-item">
              <div class="sh-dot"></div>
              <div class="sh-item-body">
                <div class="sh-item-top">
                  <span class="sh-item-date">${formatDate(h.date)}</span>
                  ${h.note ? `<span class="sh-item-note">${escapeHtml(h.note)}</span>` : ''}
                  <button class="sh-del-btn ms-auto" data-id="${h.id}" title="Delete"><i class="bi bi-trash3"></i></button>
                </div>
                <div class="sh-item-bottom">
                  <span class="sh-item-amt">${formatCurrency(h.amount)}/mo</span>
                  ${diff !== null
                    ? `<span class="sh-item-delta ${diff >= 0 ? 'sh-delta--up' : 'sh-delta--down'}"><i class="bi bi-arrow-${diff >= 0 ? 'up' : 'down'}-short"></i>${pct !== null ? Math.abs(pct) + '% ' : ''}(${diff >= 0 ? '+' : ''}${formatCurrency(Math.abs(diff))})</span>`
                    : '<span class="sh-item-first">Starting salary</span>'}
                </div>
              </div>
            </div>`;
          }).join('')}` : ''}
      </div>`;

    container.querySelectorAll('.sh-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _saveHikes(_getHikes().filter(h => h.id !== btn.dataset.id));
        renderSalaryHikeLog();
      });
    });

    document.getElementById('sh-show-more')?.addEventListener('click', (e) => {
      document.getElementById('sh-hidden-rows')?.classList.remove('d-none');
      e.target.remove();
    });

    _drawSalaryChart(chartLabels, chartData, auto.months.length);
    return;
  }

  // ── MANUAL MODE: no salary income entries found ────────────────────────
  if (manualHikes.length === 0) {
    if (_shChart) { _shChart.destroy(); _shChart = null; }
    container.innerHTML = `
      <div class="sh-auto-hint">
        <i class="bi bi-magic me-2" style="color:#10b981"></i>
        <span>Add income entries with source <strong>Salary</strong> and this chart auto-fills — no manual logging needed.</span>
      </div>`;
    return;
  }

  // Render manual hikes only
  const first    = manualHikes[0].amount;
  const last     = manualHikes[manualHikes.length - 1].amount;
  const totalPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const todayStr = new Date().toISOString().split('T')[0];
  const labels   = manualHikes.map(h => formatDate(h.date));
  const data     = manualHikes.map(h => h.amount);
  if (manualHikes[manualHikes.length - 1].date < todayStr) { labels.push('Today'); data.push(last); }

  container.innerHTML = `
    <div class="sh-summary">
      <div class="sh-stat"><div class="sh-stat-lbl">Starting</div><div class="sh-stat-val">${formatCurrency(first)}/mo</div></div>
      <div class="sh-stat"><div class="sh-stat-lbl">Current</div><div class="sh-stat-val" style="color:#10b981">${formatCurrency(last)}/mo</div></div>
      <div class="sh-stat"><div class="sh-stat-lbl">Total Growth</div><div class="sh-stat-val" style="color:${totalPct >= 0 ? '#10b981' : '#ef4444'}">${totalPct >= 0 ? '+' : ''}${totalPct}%</div></div>
      <div class="sh-stat"><div class="sh-stat-lbl">Hikes Logged</div><div class="sh-stat-val">${manualHikes.length}</div></div>
    </div>
    <div class="sh-chart-wrap"><canvas id="salary-hike-chart"></canvas></div>
    <div class="sh-timeline">
      ${[...manualHikes].reverse().map((h, ri) => {
        const idx  = manualHikes.length - 1 - ri;
        const prev = idx > 0 ? manualHikes[idx - 1].amount : null;
        const diff = prev !== null ? h.amount - prev : null;
        const pct  = (diff !== null && prev > 0) ? Math.round(((h.amount - prev) / prev) * 100) : null;
        return `<div class="sh-item">
          <div class="sh-dot ${idx === manualHikes.length - 1 ? 'sh-dot--cur' : ''}"></div>
          <div class="sh-item-body">
            <div class="sh-item-top">
              <span class="sh-item-date">${formatDate(h.date)}</span>
              ${h.note ? `<span class="sh-item-note">${escapeHtml(h.note)}</span>` : ''}
              <button class="sh-del-btn ms-auto" data-id="${h.id}" title="Delete"><i class="bi bi-trash3"></i></button>
            </div>
            <div class="sh-item-bottom">
              <span class="sh-item-amt">${formatCurrency(h.amount)}/mo</span>
              ${diff !== null
                ? `<span class="sh-item-delta ${diff >= 0 ? 'sh-delta--up' : 'sh-delta--down'}"><i class="bi bi-arrow-${diff >= 0 ? 'up' : 'down'}-short"></i>${pct !== null ? Math.abs(pct) + '%' : ''} (${diff >= 0 ? '+' : ''}${formatCurrency(Math.abs(diff))})</span>`
                : '<span class="sh-item-first">Starting salary</span>'}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  container.querySelectorAll('.sh-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _saveHikes(_getHikes().filter(h => h.id !== btn.dataset.id));
      renderSalaryHikeLog();
    });
  });

  _drawSalaryChart(labels, data, manualHikes.length);
}

function _bindSalaryHikeForm() {
  const form = document.getElementById('salary-hike-form');
  if (!form) return;

  document.getElementById('oc-salary-hike')?.addEventListener('show.bs.modal', () => {
    const d = document.getElementById('sh-date');
    if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const date   = document.getElementById('sh-date')?.value?.trim() ?? '';
    const amount = parseFloat(document.getElementById('sh-amount')?.value ?? '');
    const note   = document.getElementById('sh-note')?.value?.trim() ?? '';
    if (!date || !amount || amount <= 0) return;
    const hikes = _getHikes();
    hikes.push({ id: Date.now().toString(), date, amount, note });
    _saveHikes(hikes);
    form.reset();
    bootstrap.Modal.getInstance(document.getElementById('oc-salary-hike'))?.hide();
    renderSalaryHikeLog();
  });
}

function _bindForm() {
  const form = document.getElementById('income-form');
  if (!form) return;

  // Auto-fill current time when opening the modal for a new entry
  document.getElementById('oc-income')?.addEventListener('show.bs.modal', () => {
    if (_editingIndex === null) {
      const ti = document.getElementById('income-time');
      if (ti) {
        const n = new Date();
        ti.value = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
      }
    }
  });

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
    const time = form.querySelector('#income-time')?.value?.trim() ?? '';
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

    const record = { date, time, source, amount: parseFloat(amount), description, receivedIn };

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
    const timeInput = form.querySelector('#income-time');
    if (timeInput) timeInput.value = r.time ?? '';
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

