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
  const banner = document.getElementById('budget-error-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove('d-none');
}

function hideError() {
  const banner = document.getElementById('budget-error-banner');
  if (banner) banner.classList.add('d-none');
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
          const barCls = over ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-success';
          const remaining = Math.max(0, r.monthlyLimit - spent);
          return `
          <div class="data-card budget-card${over ? ' budget-over' : ''}">
            <div class="dc-header">
              <div class="dc-icon budget-icon"><i class="bi bi-bullseye"></i></div>
              <div class="dc-meta">
                <div class="dc-title">${escapeHtml(r.category)}</div>
                <div class="dc-subtitle">${escapeHtml(r.month)}</div>
              </div>
              <div class="dc-amount${over ? ' expense-amount' : ' income-amount'}">${formatCurrency(r.monthlyLimit)}</div>
            </div>
            <div class="dc-progress-wrap">
              <div class="progress dc-bar" role="progressbar" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar ${barCls} progress-bar-striped progress-bar-animated" style="width:${pct.toFixed(1)}%"></div>
              </div>
              <span class="dc-pct">${pct.toFixed(0)}%</span>
            </div>
            <div class="dc-budget-stats">
              <div class="dc-bstat"><span class="dc-bstat-label">Spent</span><span class="dc-bstat-value text-danger">${formatCurrency(spent)}</span></div>
              <div class="dc-bstat"><span class="dc-bstat-label">Remaining</span><span class="dc-bstat-value text-success">${formatCurrency(remaining)}</span></div>
              <div class="dc-bstat"><span class="dc-bstat-label">Limit</span><span class="dc-bstat-value">${formatCurrency(r.monthlyLimit)}</span></div>
            </div>
            ${over ? '<div class="dc-exceeded-badge"><i class="bi bi-exclamation-triangle-fill me-1"></i>Budget Exceeded</div>' : ''}
            <div class="dc-footer">
              <div class="dc-actions">
                <button class="btn btn-sm btn-outline-primary" data-edit-budget="${escapeHtml(r.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-sm btn-outline-danger" data-delete-budget="${escapeHtml(r.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')}</div>`;
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
    if (submitBtn) submitBtn.textContent = 'Update Budget';
  }

  const modal = document.getElementById('oc-budget');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
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
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const curMonthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Cards show current month only, sorted A→Z by category name
  const currentRecords = records
    .filter(r => r.month === curYM)
    .sort((a, b) => a.category.localeCompare(b.category));

  // Stat cards — based on current month only
  let onTrack = 0, overBudget = 0;
  currentRecords.forEach(r => {
    const spent = expenses.filter(e => e.category === r.category && String(e.date ?? '').startsWith(r.month)).reduce((s, e) => s + e.amount, 0);
    if (spent > r.monthlyLimit) overBudget++; else onTrack++;
  });
  const el = id => document.getElementById(id);
  if (el('bud-stat-total')) el('bud-stat-total').textContent = currentRecords.length;
  if (el('bud-stat-ok')) el('bud-stat-ok').textContent = onTrack;
  if (el('bud-stat-over')) el('bud-stat-over').textContent = overBudget;
  if (el('bud-current-month-label')) el('bud-current-month-label').textContent = curMonthLabel;

  _getPaginator().update(currentRecords);

  // Comparison table uses all records (for previous month data)
  const cmpContainer = document.getElementById('budget-comparison');
  if (cmpContainer) {
    cmpContainer.innerHTML = _renderComparison(records, expenses);
    // Wire toggle
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
  store.on('budgets', render);
  store.on('expenses', render);
  // Set current month in modal whenever it opens
  const modal = document.getElementById('oc-budget');
  if (modal) {
    modal.addEventListener('show.bs.modal', () => {
      const now = new Date();
      const curYM = now.toISOString().slice(0, 7);
      const label = now.toLocaleString('default', { month: 'long', year: 'numeric' });
      const hiddenInput = document.getElementById('budget-month');
      const display = document.getElementById('budget-month-display');
      if (hiddenInput) hiddenInput.value = curYM;
      if (display) display.textContent = label;
    });
  }
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
