// js/budgets.js — Budget management module
// Requirements: 13.1, 13.2, 13.3, 13.4, 13.9

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber } from './validation.js';
import { formatCurrency } from './utils.js';
import { createPaginator } from './paginate.js';

// ─── Serialization (Task 9.1) ────────────────────────────────────────────────
// Column order: A=id, B=category, C=monthlyLimit, D=month (YYYY-MM)

/**
 * Converts a BudgetRecord object to a row array for Google Sheets.
 * @param {{ id: string, category: string, monthlyLimit: number, month: string }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.id,
    record.category,
    String(record.monthlyLimit),
    record.month,
  ];
}

/**
 * Converts a raw Sheets row array to a BudgetRecord object.
 * @param {string[]} row
 * @returns {{ id: string, category: string, monthlyLimit: number, month: string }}
 */
export function deserialize(row) {
  return {
    id: row[0] ?? '',
    category: row[1] ?? '',
    monthlyLimit: parseFloat(row[2]) || 0,
    month: row[3] ?? '',
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
  const el = document.getElementById('budget-form-error') ?? document.getElementById('budget-error-banner');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('d-none');
}

function hideError() {
  const el = document.getElementById('budget-form-error') ?? document.getElementById('budget-error-banner');
  if (el) el.classList.add('d-none');
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

// ─── Category icon map ──────────────────────────────────────────────────────
const _CAT_ICONS = {
  food: 'bi-basket2-fill', groceries: 'bi-cart-fill', restaurant: 'bi-cup-hot-fill',
  transport: 'bi-car-front-fill', travel: 'bi-airplane-fill', fuel: 'bi-fuel-pump-fill',
  housing: 'bi-house-fill', rent: 'bi-house-door-fill', utilities: 'bi-lightning-fill',
  electricity: 'bi-plug-fill', water: 'bi-droplet-fill', internet: 'bi-wifi',
  health: 'bi-heart-pulse-fill', medical: 'bi-capsule-pill', gym: 'bi-activity',
  education: 'bi-book-fill', shopping: 'bi-bag-fill', clothing: 'bi-bag-heart-fill',
  entertainment: 'bi-film', subscriptions: 'bi-credit-card-2-front-fill',
  savings: 'bi-piggy-bank-fill', investment: 'bi-graph-up-arrow',
  salary: 'bi-cash-coin', income: 'bi-arrow-down-left-circle-fill',
  insurance: 'bi-shield-fill-check', phone: 'bi-phone-fill', misc: 'bi-grid-fill',
};

function _getCatIcon(category) {
  if (!category) return 'bi-bullseye';
  const key = category.toLowerCase().replace(/\s+/g, '');
  for (const [k, icon] of Object.entries(_CAT_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return 'bi-bullseye';
}

// ─── View state & filter ─────────────────────────────────────────────────────
let _viewMonth = (() => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
})();
const _budFilter = { search: '', status: '' };

function _monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function _isCurrentMonth(ym) {
  const n = new Date();
  return ym === `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Paginator ───────────────────────────────────────────────────────────────
let _editingId = null;
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'budget-cards',
      paginationId: 'budget-pagination',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('budget-cards');
        const emptyState = document.getElementById('budget-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const expenses = store.get('expenses') ?? [];
        container.innerHTML = `<div class="data-cards-grid">${slice.map(r => {
          const spent = expenses
            .filter(e => e.category === r.category && e.date && e.date.startsWith(r.month))
            .reduce((s, e) => s + e.amount, 0);
          const pct    = r.monthlyLimit > 0 ? Math.min((spent / r.monthlyLimit) * 100, 100) : 0;
          const over   = spent > r.monthlyLimit;
          const warning = !over && pct >= 80;
          const barCls = over ? 'bud-bar--over' : pct >= 80 ? 'bud-bar--warn' : 'bud-bar--ok';
          const pctCls = over ? 'bud-pct--over' : warning ? 'bud-pct--warn' : 'bud-pct--ok';
          const remaining = Math.max(0, r.monthlyLimit - spent);
          const catIcon = _getCatIcon(r.category);
          const iconBg = over
            ? 'linear-gradient(135deg,#ef4444,#f87171)'
            : warning
              ? 'linear-gradient(135deg,#f59e0b,#fbbf24)'
              : 'linear-gradient(135deg,#f59e0b,#d97706)';
          const statusBadge = over
            ? '<span class="ecard-badge bud-badge--over"><i class="bi bi-exclamation-triangle-fill me-1"></i>Over Budget</span>'
            : warning
              ? '<span class="ecard-badge bud-badge--warn"><i class="bi bi-exclamation-circle-fill me-1"></i>Warning</span>'
              : '<span class="ecard-badge bud-badge--ok"><i class="bi bi-check-circle-fill me-1"></i>On Track</span>';
          return `
          <div class="ecard ecard--budget${over ? ' ecard--budget-over' : warning ? ' ecard--budget-warn' : ''}">
            <div class="ecard-top">
              <div class="ecard-icon" style="background:${iconBg};box-shadow:0 4px 12px rgba(245,158,11,.25)"><i class="bi ${catIcon}"></i></div>
              <div class="ecard-body">
                <div class="ecard-desc">${escapeHtml(r.category)}</div>
                <div class="ecard-badges">${statusBadge}</div>
              </div>
              <div class="ecard-amount ${over ? 'ecard-amount--expense' : 'ecard-amount--budget'}">${formatCurrency(r.monthlyLimit)}</div>
            </div>
            <div class="ecard-budget-body">
              <div class="bud-progress-wrap">
                <div class="bud-progress-track">
                  <div class="bud-progress-fill ${barCls}" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <span class="bud-pct ${pctCls}">${pct.toFixed(0)}%</span>
              </div>
              <div class="bud-bar-amounts">
                <span class="bud-bar-spent ${pctCls}">${formatCurrency(spent)}</span>
                <span class="bud-bar-limit">of ${formatCurrency(r.monthlyLimit)}</span>
              </div>
              <div class="bud-chip-row">
                <span class="bud-chip bud-chip--spent"><i class="bi bi-arrow-up-right me-1"></i>Spent ${formatCurrency(spent)}</span>
                <span class="bud-chip bud-chip--remaining"><i class="bi bi-arrow-down-left me-1"></i>Left ${formatCurrency(remaining)}</span>
              </div>
            </div>
            <div class="ecard-footer">
              <div class="ecard-actions" style="opacity:1;pointer-events:auto">
                <button class="ecard-btn bud-copy-btn" data-copy-budget="${escapeHtml(r.id)}" title="Copy to Next Month"><i class="bi bi-calendar-plus-fill"></i></button>
                <button class="ecard-btn ecard-btn--edit" data-edit-budget="${escapeHtml(r.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="ecard-btn ecard-btn--del bud-del-btn" data-delete-budget="${escapeHtml(r.id)}" title="Delete"><i class="bi bi-trash3-fill"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')}</div>`;
        container.querySelectorAll('[data-copy-budget]').forEach(btn => {
          btn.addEventListener('click', () => _copyToNextMonth(btn.dataset.copyBudget));
        });
        container.querySelectorAll('[data-edit-budget]').forEach(btn => {
          btn.addEventListener('click', () => _startEdit(btn.dataset.editBudget));
        });
        container.querySelectorAll('[data-delete-budget]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(btn.dataset.deleteBudget));
        });
      },
    });
  }
  return _paginator;
}

// ─── Edit / Delete ────────────────────────────────────────────────────────────

function _startEdit(id) {
  const records = store.get('budgets') ?? [];
  const r = records.find(b => b.id === id);
  if (!r) return;
  _editingId = id;

  const form = document.getElementById('budget-form');
  if (form) {
    const catSel = form.querySelector('#budget-category');
    if (catSel) catSel.value = r.category;
    const limitInput = form.querySelector('#budget-limit');
    if (limitInput) limitInput.value = r.monthlyLimit;
    const monthInput = form.querySelector('#budget-month');
    if (monthInput) monthInput.value = r.month;
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Update Budget';
    const cancelBtn = document.getElementById('bud-cancel-edit');
    if (cancelBtn) cancelBtn.classList.remove('d-none');
    const titleEl = document.getElementById('oc-budget-label');
    if (titleEl) titleEl.textContent = 'Edit Budget';
  }

  const modal = document.getElementById('oc-budget');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function _copyToNextMonth(id) {
  const records = store.get('budgets') ?? [];
  const r = records.find(b => b.id === id);
  if (!r) return;
  const [y, m] = r.month.split('-').map(Number);
  const next = new Date(y, m, 1);
  const nextYM = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  const exists = records.some(b => b.month === nextYM && b.category === r.category);
  if (exists) {
    alert(`A budget for "${r.category}" in ${_monthLabel(nextYM)} already exists.`);
    return;
  }
  const newRecord = { id: crypto.randomUUID(), category: r.category, monthlyLimit: r.monthlyLimit, month: nextYM };
  try {
    await appendRow(CONFIG.sheets.budgets, serialize(newRecord));
    const rows = await fetchRows(CONFIG.sheets.budgets);
    store.set('budgets', rows.map(deserialize));
    showUndoToast(`Copied to ${_monthLabel(nextYM)}`, async () => {
      const current = (store.get('budgets') ?? []).filter(b => b.id !== newRecord.id);
      await writeAllRows(CONFIG.sheets.budgets, current.map(serialize));
      store.set('budgets', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to copy budget.');
  }
}

import { epConfirm } from './confirm.js';
import { showUndoToast } from './undo.js';

async function _deleteRecord(id) {
  if (!await epConfirm('Delete this budget?')) return;
  const allRecords = store.get('budgets') ?? [];
  const deleted = allRecords.find(b => b.id === id);
  const records = allRecords.filter(b => b.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.budgets, records.map(serialize));
    store.set('budgets', records);
    showUndoToast('Budget deleted', async () => {
      const current = [...(store.get('budgets') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.budgets, current.map(serialize));
      store.set('budgets', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── Auto-roll budgets ────────────────────────────────────────────────────────

/**
 * On page load:
 * 1. If no budgets exist for the current month, copy last month's budgets.
 * 2. Delete any budgets older than 3 months from Sheets.
 */
export async function autoRollBudgets() {
  const now    = new Date();
  const curYM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Build the 3-month window: current + 2 previous
  const keepMonths = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keepMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  let records = store.get('budgets') ?? [];

  // ── Step 1: auto-copy last month if current month has no budgets ──
  const hasCurrent = records.some(r => r.month === curYM);
  if (!hasCurrent) {
    // Find the most recent month that has budgets
    const months = [...new Set(records.map(r => r.month))].sort().reverse();
    const lastMonth = months[0];
    if (lastMonth) {
      const lastMonthBudgets = records.filter(r => r.month === lastMonth);
      const newBudgets = lastMonthBudgets.map(r => ({
        id: crypto.randomUUID(),
        category: r.category,
        monthlyLimit: r.monthlyLimit,
        month: curYM,
      }));
      try {
        for (const b of newBudgets) {
          await appendRow(CONFIG.sheets.budgets, serialize(b));
        }
        const rows = await fetchRows(CONFIG.sheets.budgets);
        records = rows.map(deserialize);
        store.set('budgets', records);
      } catch (err) {
        console.warn('Budget auto-roll failed:', err);
      }
    }
  }

  // ── Step 2: purge budgets older than 3 months ──
  const filtered = records.filter(r => keepMonths.includes(r.month));
  if (filtered.length < records.length) {
    try {
      await writeAllRows(CONFIG.sheets.budgets, filtered.map(serialize));
      store.set('budgets', filtered);
    } catch (err) {
      console.warn('Budget purge failed:', err);
    }
  }
}

// ─── Comparison table ─────────────────────────────────────────────────────────

function _renderComparison(records, expenses) {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Build last 2 months only (for comparison): current month + 1 previous
  // Newest first: [current, previous]
  const months = [];
  for (let i = 0; i <= 1; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Only include months that actually have budget data
  const activeMonths = months.filter(m => records.some(r => r.month === m));
  if (activeMonths.length === 0) return '';

  // Collect all unique categories across those months
  const categories = [...new Set(
    records.filter(r => activeMonths.includes(r.month)).map(r => r.category)
  )].sort();

  if (categories.length === 0) return '';

  // Month label helper
  const monthLabel = ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' });
  };

  // Build lookup: month → category → { limit, spent }
  const lookup = {};
  for (const m of activeMonths) {
    lookup[m] = {};
    for (const cat of categories) {
      const budget = records.find(r => r.month === m && r.category === cat);
      const spent  = expenses
        .filter(e => e.category === cat && String(e.date ?? '').startsWith(m))
        .reduce((s, e) => s + e.amount, 0);
      lookup[m][cat] = budget ? { limit: budget.monthlyLimit, spent } : null;
    }
  }

  const headerCols = activeMonths.map(m => {
    const isCur = m === curYM;
    return `<th class="bud-cmp-th${isCur ? ' bud-cmp-th--cur' : ''}">${monthLabel(m)}${isCur ? ' <span class="bud-cmp-cur-badge">Current</span>' : ''}</th>`;
  }).join('');

  const rows = categories.map(cat => {
    const cells = activeMonths.map(m => {
      const d = lookup[m][cat];
      if (!d) return `<td class="bud-cmp-td bud-cmp-td--empty">—</td>`;
      const pct  = d.limit > 0 ? Math.min((d.spent / d.limit) * 100, 100) : 0;
      const over = d.spent > d.limit;
      const isCur = m === curYM;
      return `
        <td class="bud-cmp-td${isCur ? ' bud-cmp-td--cur' : ''}${over ? ' bud-cmp-td--over' : ''}">
          <div class="bud-cmp-limit">${formatCurrency(d.limit)}</div>
          <div class="bud-cmp-spent${over ? ' bud-cmp-spent--over' : ''}">${formatCurrency(d.spent)} spent</div>
          <div class="bud-cmp-bar-wrap">
            <div class="bud-cmp-bar${over ? ' bud-cmp-bar--over' : ''}" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </td>`;
    }).join('');
    return `<tr><td class="bud-cmp-cat">${escapeHtml(cat)}</td>${cells}</tr>`;
  }).join('');

  return `
  <div class="bud-comparison" id="bud-comparison-wrap">
    <div class="bud-cmp-hd" id="bud-cmp-toggle" style="cursor:pointer" role="button" aria-expanded="false">
      <div>
        <div class="bud-cmp-title"><i class="bi bi-bar-chart-steps me-2"></i>Budget Comparison</div>
        <div class="bud-cmp-sub">Current vs previous month — click to expand</div>
      </div>
      <button class="bud-cmp-toggle-btn" tabindex="-1" aria-hidden="true">
        <i class="bi bi-chevron-down bud-cmp-chevron"></i>
      </button>
    </div>
    <div class="bud-cmp-body" id="bud-cmp-body" style="display:none">
      <div class="bud-cmp-table-wrap">
        <table class="bud-cmp-table">
          <thead>
            <tr>
              <th class="bud-cmp-th bud-cmp-th--cat">Category</th>
              ${headerCols}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ─── render() (Task 9.3) ─────────────────────────────────────────────────────

/**
 * Reads budgets from the store and renders into #budget-list.
 * Shows #budget-empty-state when empty.
 */
export function render() {
  const records = store.get('budgets') ?? [];
  const expenses = store.get('expenses') ?? [];

  // Records for the viewed month, sorted A→Z
  let monthRecords = records
    .filter(r => r.month === _viewMonth)
    .sort((a, b) => a.category.localeCompare(b.category));

  // Compute per-record stats for filtering
  const withStats = monthRecords.map(r => {
    const spent = expenses.filter(e => e.category === r.category && String(e.date ?? '').startsWith(r.month)).reduce((s, e) => s + e.amount, 0);
    const pct = r.monthlyLimit > 0 ? (spent / r.monthlyLimit) * 100 : 0;
    const over = spent > r.monthlyLimit;
    const warning = !over && pct >= 80;
    return { ...r, spent, pct, over, warning };
  });

  // Stat cards (always from all viewed-month records before text filter)
  let onTrack = 0, overBudget = 0, totalLimit = 0, totalSpent = 0;
  withStats.forEach(r => {
    totalLimit += r.monthlyLimit;
    totalSpent += r.spent;
    if (r.over) overBudget++; else onTrack++;
  });
  const el = id => document.getElementById(id);
  if (el('bud-stat-spent')) el('bud-stat-spent').textContent = formatCurrency(totalSpent);
  if (el('bud-stat-budgeted')) el('bud-stat-budgeted').textContent = formatCurrency(totalLimit);
  if (el('bud-stat-ok')) el('bud-stat-ok').textContent = onTrack;
  if (el('bud-stat-over')) el('bud-stat-over').textContent = overBudget;

  // Hero subtitle
  const heroSub = el('bud-hero-sub');
  if (heroSub) {
    const parts = [];
    if (overBudget > 0) parts.push(`<strong style="color:#ef4444">${overBudget} over budget</strong>`);
    if (onTrack > 0) parts.push(`${onTrack} on track`);
    heroSub.innerHTML = parts.length > 0 ? parts.join(' · ') + ` · ${_monthLabel(_viewMonth)}` : `Set and monitor spending limits · ${_monthLabel(_viewMonth)}`;
  }

  // Month nav label
  const monthLabelEl = el('bud-current-month-label');
  if (monthLabelEl) {
    monthLabelEl.textContent = _monthLabel(_viewMonth);
    monthLabelEl.classList.toggle('bud-month-label--current', _isCurrentMonth(_viewMonth));
  }

  // Apply search + status filters
  const q = _budFilter.search.toLowerCase().trim();
  let visible = withStats.filter(r => {
    if (q && !r.category.toLowerCase().includes(q)) return false;
    if (_budFilter.status === 'on-track' && (r.over || r.warning)) return false;
    if (_budFilter.status === 'warning' && !r.warning) return false;
    if (_budFilter.status === 'over' && !r.over) return false;
    return true;
  });

  // Count badge
  if (el('budget-count')) el('budget-count').textContent = visible.length > 0 ? String(visible.length) : '';

  _getPaginator().update(visible);

  // Comparison table
  const cmpContainer = el('budget-comparison');
  if (cmpContainer) {
    cmpContainer.innerHTML = _renderComparison(records, expenses);
    const toggle = document.getElementById('bud-cmp-toggle');
    const body   = document.getElementById('bud-cmp-body');
    const chevron = cmpContainer.querySelector('.bud-cmp-chevron');
    if (toggle && body) {
      toggle.addEventListener('click', () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        toggle.setAttribute('aria-expanded', String(!isOpen));
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        const sub = toggle.querySelector('.bud-cmp-sub');
        if (sub) sub.textContent = isOpen ? 'Current vs previous month — click to expand' : 'Current vs previous month';
      });
    }
  }
}

// ─── init() (Task 9.3) ───────────────────────────────────────────────────────

/**
 * Binds the budget form submit handler and subscribes render to store changes.
 * Must be called after DOMContentLoaded.
 */
export function init() {
  _bindForm();
  _bindFilters();
  store.on('budgets', render);
  store.on('expenses', render);

  // Set current month in modal whenever it opens (if not editing)
  const modal = document.getElementById('oc-budget');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      if (_editingId) return;
      const monthInput = document.getElementById('budget-month');
      if (monthInput) monthInput.value = new Date().toISOString().slice(0, 7);
    });
    modal.addEventListener('hidden.bs.modal', () => {
      _editingId = null;
      const form = document.getElementById('budget-form');
      if (form) form.reset();
      const submitBtn = form?.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Save Budget';
      const cancelBtn = document.getElementById('bud-cancel-edit');
      if (cancelBtn) cancelBtn.classList.add('d-none');
      const titleEl = document.getElementById('oc-budget-label');
      if (titleEl) titleEl.textContent = 'Add Budget';
      const errorEl = document.getElementById('budget-form-error');
      if (errorEl) errorEl.classList.add('d-none');
    });
  }
}

function _bindFilters() {
  // Search
  let _st;
  document.getElementById('bud-search')?.addEventListener('input', e => {
    clearTimeout(_st);
    _st = setTimeout(() => { _budFilter.search = e.target.value.trim(); render(); }, 220);
  });

  // Status dropdown
  const statusBtn = document.getElementById('bud-status-btn');
  const statusMenu = document.getElementById('bud-status-menu');
  statusBtn?.addEventListener('click', () => {
    const isOpen = statusMenu.classList.contains('fdd-open');
    statusMenu.classList.toggle('fdd-open');
    statusBtn.classList.toggle('fdd-btn--active', !isOpen);
    if (!isOpen) {
      const opts = [['', 'All'], ['on-track', 'On Track'], ['warning', 'Warning (>80%)'], ['over', 'Over Budget']];
      statusMenu.innerHTML = opts.map(([v, l]) =>
        `<button class="fdd-item ${_budFilter.status === v ? 'fdd-item--active' : ''}" data-value="${v}">${l}</button>`
      ).join('');
      statusMenu.querySelectorAll('.fdd-item').forEach(item =>
        item.addEventListener('click', () => {
          _budFilter.status = item.dataset.value;
          statusMenu.classList.remove('fdd-open');
          statusBtn.classList.remove('fdd-btn--active');
          statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>${item.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          if (!_budFilter.status) statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
          render();
        })
      );
    }
  });

  // Month navigator
  document.getElementById('bud-month-prev')?.addEventListener('click', () => {
    const [y, m] = _viewMonth.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    _viewMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    render();
  });
  document.getElementById('bud-month-next')?.addEventListener('click', () => {
    const [y, m] = _viewMonth.split('-').map(Number);
    const next = new Date(y, m, 1);
    _viewMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    render();
  });
  document.getElementById('bud-month-today')?.addEventListener('click', () => {
    const n = new Date();
    _viewMonth = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    render();
  });

  // Quick presets
  document.querySelectorAll('[data-bud-preset]').forEach(btn =>
    btn.addEventListener('click', () => {
      const preset = btn.dataset.budPreset;
      _budFilter.status = preset === 'all' ? '' : preset;
      const statusBtn2 = document.getElementById('bud-status-btn');
      if (statusBtn2) statusBtn2.innerHTML = `<i class="bi bi-funnel me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      render();
    })
  );

  // Cancel edit
  document.getElementById('bud-cancel-edit')?.addEventListener('click', () => {
    _editingId = null;
  });
}

function _bindForm() {
  const form = document.getElementById('budget-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    clearFieldErrors(form);

    const category = form.querySelector('#budget-category')?.value?.trim() ?? '';
    const monthlyLimit = form.querySelector('#budget-limit')?.value?.trim() ?? '';
    const month = form.querySelector('#budget-month')?.value?.trim()
      || new Date().toISOString().slice(0, 7);

    const formData = { category, monthlyLimit, month };

    // Validate required fields (month is auto-set, no need to validate)
    const reqResult = requireFields(formData, ['category', 'monthlyLimit']);
    let hasErrors = false;

    if (!reqResult.valid) {
      reqResult.errors.forEach(err => {
        const field = err.split(' ')[0];
        const idMap = {
          category: 'budget-category',
          monthlyLimit: 'budget-limit',
          month: 'budget-month',
        };
        if (idMap[field]) showFieldError(idMap[field], err);
      });
      hasErrors = true;
    }

    // Validate positive number
    const amtResult = requirePositiveNumber(monthlyLimit);
    if (!amtResult.valid) {
      showFieldError('budget-limit', amtResult.errors[0]);
      hasErrors = true;
    }

    if (hasErrors) {
      showError('Please fill in all required fields correctly.');
      return;
    }

    try {
      if (_editingId !== null) {
        const all = [...(store.get('budgets') ?? [])];
        const idx = all.findIndex(b => b.id === _editingId);
        if (idx !== -1) {
          all[idx] = { id: _editingId, category, monthlyLimit: parseFloat(monthlyLimit), month };
          await writeAllRows(CONFIG.sheets.budgets, all.map(serialize));
          store.set('budgets', all);
        }
        _editingId = null;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Add Budget';
        const modal = document.getElementById('oc-budget');
        if (modal) bootstrap.Modal.getInstance(modal)?.hide();
      } else {
        const record = { id: crypto.randomUUID(), category, monthlyLimit: parseFloat(monthlyLimit), month };
        await appendRow(CONFIG.sheets.budgets, serialize(record));
        const rows = await fetchRows(CONFIG.sheets.budgets);
        store.set('budgets', rows.map(deserialize));
        const modal = document.getElementById('oc-budget');
        if (modal) bootstrap.Modal.getInstance(modal)?.hide();
      }
      form.reset();
      hideError();
    } catch (err) {
      showError(err.message ?? 'Failed to save budget. Please try again.');
    }
  });
}
