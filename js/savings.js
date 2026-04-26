// js/savings.js — Savings Goals module
// Requirements: 14.1–14.9

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber, requireFutureDate } from './validation.js';
import { formatCurrency, formatDate } from './utils.js';
import { createPaginator } from './paginate.js';

// ─── Serialization (Task 10.1) ───────────────────────────────────────────────
// Columns: A=id, B=name, C=targetAmount, D=targetDate, E=savedAmount

/**
 * Converts a SavingsGoal object to a row array for Google Sheets.
 * @param {{ id: string, name: string, targetAmount: number, targetDate: string, savedAmount: number }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.id,
    record.name,
    String(record.targetAmount),
    record.targetDate,
    String(record.savedAmount),
  ];
}

/**
 * Converts a raw Sheets row array to a SavingsGoal object.
 * @param {string[]} row
 * @returns {{ id: string, name: string, targetAmount: number, targetDate: string, savedAmount: number }}
 */
export function deserialize(row) {
  return {
    id: row[0] ?? '',
    name: row[1] ?? '',
    targetAmount: parseFloat(row[2]) || 0,
    targetDate: row[3] ?? '',
    savedAmount: parseFloat(row[4]) || 0,
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

let _editingId = null;
const _savFilter = { search: '', status: '' };

function showError(message) {
  const banner = document.getElementById('savings-error-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove('d-none');
}

function hideError() {
  const banner = document.getElementById('savings-error-banner');
  if (banner) banner.classList.add('d-none');
}

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'savings-list',
      paginationId: 'savings-pagination',
      pageSize: 6,
      renderPage(slice) {
        const list = document.getElementById('savings-list');
        if (!list) return;
        if (slice.length === 0) {
          list.innerHTML = '<div class="text-center text-muted py-4 small">No goals match the current filter.</div>';
          return;
        }
        const today = new Date(); today.setHours(0,0,0,0);
        list.innerHTML = `<div class="savings-grid">${slice.map(g => {
          const idx       = g._idx;
          const saved     = Number(g.savedAmount)  || 0;
          const target    = Number(g.targetAmount) || 0;
          const progress  = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
          const remaining = Math.max(0, target - saved);
          const completed = saved >= target && target > 0;
          const daysLeft  = g.targetDate ? Math.ceil((new Date(g.targetDate + 'T00:00:00') - today) / 86400000) : null;
          const isOverdue = !completed && daysLeft !== null && daysLeft < 0;
          const isDueSoon = !completed && !isOverdue && daysLeft !== null && daysLeft <= 7;
          const color       = completed ? '#059669' : progress >= 75 ? '#3b82f6' : progress >= 40 ? '#f59e0b' : '#6366f1';
          const borderColor = completed ? '#10b981' : isOverdue ? '#ef4444' : isDueSoon ? '#f59e0b' : '#6366f1';

          // Smaller ring (56x56, r=22)
          const r = 22, circ = 2 * Math.PI * r;
          const dash = (progress / 100) * circ;
          const ring = `<svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="5"/>
            <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="5"
              stroke-linecap="round"
              stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
              transform="rotate(-90 28 28)"/>
            <text x="28" y="32" text-anchor="middle" font-size="11" font-weight="700" fill="${color}">${Math.round(progress)}%</text>
          </svg>`;

          // Days meta chip
          const metaChip = completed
            ? `<span class="sgc2-urgency-chip" style="color:#059669;background:#dcfce7;border-color:#bbf7d0"><i class="bi bi-check-circle-fill me-1"></i>Completed</span>`
            : isOverdue
            ? `<span class="sgc2-urgency-chip" style="color:#dc2626;background:#fee2e2;border-color:#fca5a5"><i class="bi bi-exclamation-triangle-fill me-1"></i>Overdue by ${Math.abs(daysLeft)}d</span>`
            : isDueSoon
            ? `<span class="sgc2-urgency-chip" style="color:#d97706;background:#fef3c7;border-color:#fcd34d"><i class="bi bi-clock me-1"></i>${daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}</span>`
            : daysLeft !== null
            ? `<span class="sgc2-days">${daysLeft}d left</span>`
            : '';

          // Fixed remaining color: green=done, amber=in-progress, default=nothing saved yet
          const remStyle = completed
            ? 'color:#059669'
            : remaining > 0 && remaining < target ? 'color:#f59e0b' : '';

          return `
            <div class="sgc2${completed ? ' sgc2--done' : isOverdue ? ' sgc2--overdue' : ''}" style="--sgc-color:${color};border-left:3.5px solid ${borderColor}">
              <div class="sgc2-header">
                <div class="sgc2-ring">${ring}</div>
                <div class="sgc2-info">
                  <div class="sgc2-name">${escapeHtml(g.name)}</div>
                  <div class="sgc2-meta">${metaChip}</div>
                  <div class="sgc2-milestones">
                    ${[25,50,75,100].map(m => {
                      const hit = progress >= m;
                      return `<span class="sgc2-ms-pill${hit ? ' sgc2-ms-pill--hit' : ''}" style="${hit ? `background:${color};border-color:${color};color:#fff` : ''}">${m}%</span>`;
                    }).join('')}
                  </div>
                </div>
                <div class="sgc2-top-actions">
                  <button class="ecard-btn ecard-btn--edit" data-edit-id="${escapeHtml(g.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                  <button class="ecard-btn ecard-btn--del bud-del-btn" data-delete-idx="${idx}" title="Delete"><i class="bi bi-trash3-fill"></i></button>
                </div>
              </div>
              <div class="sgc2-stats">
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Target</span>
                  <span class="sgc2-stat-val">${formatCurrency(target)}</span>
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Saved</span>
                  <span class="sgc2-stat-val"${saved > 0 ? ' style="color:#10b981"' : ''}>${formatCurrency(saved)}</span>
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Remaining</span>
                  ${completed
                    ? `<span class="sgc2-stat-val" style="color:#059669;font-size:.7rem;font-weight:700">100% achieved</span>`
                    : `<span class="sgc2-stat-val"${remStyle ? ` style="${remStyle}"` : ''}>${formatCurrency(remaining)}</span>`}
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Target Date</span>
                  <span class="sgc2-stat-val">${g.targetDate ? formatDate(g.targetDate) : '—'}</span>
                </div>
              </div>
              ${!completed ? `
              <button class="sgc2-update-toggle" data-toggle-idx="${idx}" style="${isOverdue ? 'border-color:#fca5a5;color:#dc2626' : isDueSoon ? 'border-color:#fcd34d;color:#d97706' : progress >= 90 ? 'border-color:#86efac;color:#059669' : ''}">
                <i class="bi bi-chevron-down me-1 sgc2-toggle-icon"></i>${isOverdue ? 'Update — Overdue' : isDueSoon ? `Update — ${daysLeft === 0 ? 'Due today' : daysLeft + 'd left'}` : progress >= 90 ? 'Almost there! Update Progress' : 'Update Progress'}
              </button>
              <div class="sgc2-actions d-none" id="sgc2-actions-${idx}">
                <div class="sgc2-section-label" style="color:#059669"><i class="bi bi-plus-circle me-1"></i>Add to savings</div>
                <div class="sgc2-input-row">
                  <span class="sgc2-prefix">₹</span>
                  <input type="number" class="sgc2-input" min="0.01" step="0.01" id="savings-update-${idx}" placeholder="Amount…" />
                  <button class="sgc2-btn sgc2-btn--add" data-update-idx="${idx}"><i class="bi bi-plus-lg me-1"></i>Add</button>
                </div>
                <div class="sgc2-section-label mt-1" style="color:#dc2626"><i class="bi bi-dash-circle me-1"></i>Withdraw from savings</div>
                <div class="sgc2-input-row">
                  <span class="sgc2-prefix" style="color:#ef4444">₹</span>
                  <input type="number" class="sgc2-input" min="0.01" step="0.01" id="savings-withdraw-${idx}" placeholder="Amount…" />
                  <button class="sgc2-btn sgc2-btn--withdraw" data-withdraw-idx="${idx}"><i class="bi bi-dash-lg me-1"></i>Withdraw</button>
                </div>
              </div>` : ''}
            </div>`;
        }).join('')}</div>`;

        list.querySelectorAll('[data-toggle-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const panel = document.getElementById(`sgc2-actions-${btn.dataset.toggleIdx}`);
            if (!panel) return;
            const icon = btn.querySelector('.sgc2-toggle-icon');
            panel.classList.toggle('d-none');
            if (icon) icon.className = panel.classList.contains('d-none') ? 'bi bi-chevron-down me-1 sgc2-toggle-icon' : 'bi bi-chevron-up me-1 sgc2-toggle-icon';
          });
        });
        list.querySelectorAll('[data-update-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const input = document.getElementById(`savings-update-${btn.dataset.updateIdx}`);
            const v = parseFloat(input?.value ?? '');
            if (isNaN(v) || v <= 0) { input?.classList.add('is-invalid'); return; }
            input?.classList.remove('is-invalid');
            _updateSavedAmount(parseInt(btn.dataset.updateIdx), v);
          });
        });
        list.querySelectorAll('[data-withdraw-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const input = document.getElementById(`savings-withdraw-${btn.dataset.withdrawIdx}`);
            const v = parseFloat(input?.value ?? '');
            if (isNaN(v) || v <= 0) { input?.classList.add('is-invalid'); return; }
            input?.classList.remove('is-invalid');
            _withdrawSavedAmount(parseInt(btn.dataset.withdrawIdx), v);
          });
        });
        list.querySelectorAll('[data-delete-idx]').forEach(btn =>
          btn.addEventListener('click', () => _deleteGoal(parseInt(btn.dataset.deleteIdx))));
        list.querySelectorAll('[data-edit-id]').forEach(btn =>
          btn.addEventListener('click', () => _startEdit(btn.dataset.editId)));
      },
    });
  }
  return _paginator;
}

// ─── render() (Task 10.3) ────────────────────────────────────────────────────

/**
 * Reads savings goals from the store and renders into #savings-list as cards.
 * Requirements: 14.6, 14.7, 14.8
 */
export function render() {
  const all = (store.get('savings') ?? []).map((g, i) => ({ ...g, _idx: i }));

  // Stat cards
  const totalSaved  = all.reduce((s, g) => s + (Number(g.savedAmount)  || 0), 0);
  const totalTarget = all.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);
  const done        = all.filter(g => (Number(g.savedAmount) || 0) >= (Number(g.targetAmount) || 0) && g.targetAmount > 0).length;
  const overallPct  = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;
  const el = id => document.getElementById(id);
  if (el('sav-stat-saved'))    el('sav-stat-saved').textContent    = formatCurrency(totalSaved);
  if (el('sav-stat-target'))   el('sav-stat-target').textContent   = formatCurrency(totalTarget);
  if (el('sav-stat-done'))     el('sav-stat-done').textContent     = done;
  if (el('sav-stat-progress')) el('sav-stat-progress').textContent = `${overallPct}%`;

  // Hero subtitle
  const heroSub = el('sav-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = all.length
      ? `<strong style="color:#bbf7d0;font-weight:700">${formatCurrency(Math.round(totalSaved))}</strong> saved toward ${all.length} goal${all.length !== 1 ? 's' : ''}`
      : 'Track your savings targets';
  }

  // Filter
  const search = _savFilter.search.toLowerCase();
  const status = _savFilter.status;
  const today  = new Date(); today.setHours(0,0,0,0);
  const filtered = all.filter(g => {
    if (search && !g.name.toLowerCase().includes(search)) return false;
    if (!status || status === 'all') return true;
    const saved    = Number(g.savedAmount)  || 0;
    const target   = Number(g.targetAmount) || 0;
    const done_    = saved >= target && target > 0;
    const overdue  = !done_ && g.targetDate && new Date(g.targetDate + 'T00:00:00') < today;
    if (status === 'completed')   return done_;
    if (status === 'overdue')     return !!overdue;
    if (status === 'in-progress') return !done_ && !overdue;
    return true;
  });

  const countBadge = el('savings-count');
  if (countBadge) countBadge.textContent = filtered.length || '';

  const emptyEl = el('sav-empty-state');
  if (all.length === 0) {
    if (emptyEl) emptyEl.classList.remove('d-none');
  } else {
    if (emptyEl) emptyEl.classList.add('d-none');
  }

  _getPaginator().update(filtered);
}

async function _updateSavedAmount(idx, addAmount) {
  const goals = [...(store.get('savings') ?? [])];
  if (!goals[idx]) return;
  goals[idx] = { ...goals[idx], savedAmount: (goals[idx].savedAmount ?? 0) + addAmount };
  try {
    await writeAllRows(CONFIG.sheets.savings, goals.map(serialize));
    store.set('savings', goals);
  } catch (err) {
    alert(err.message ?? 'Failed to update saved amount.');
  }
}

async function _withdrawSavedAmount(idx, amount) {
  const goals = [...(store.get('savings') ?? [])];
  if (!goals[idx]) return;
  goals[idx] = { ...goals[idx], savedAmount: Math.max(0, (goals[idx].savedAmount ?? 0) - amount) };
  try {
    await writeAllRows(CONFIG.sheets.savings, goals.map(serialize));
    store.set('savings', goals);
  } catch (err) {
    alert(err.message ?? 'Failed to withdraw amount.');
  }
}

import { epConfirm } from './confirm.js';
import { showUndoToast } from './undo.js';

async function _deleteGoal(idx) {
  if (!await epConfirm('Delete this savings goal?')) return;
  const goals = [...(store.get('savings') ?? [])];
  const deleted = goals[idx];
  goals.splice(idx, 1);
  try {
    await writeAllRows(CONFIG.sheets.savings, goals.map(serialize));
    store.set('savings', goals);
    showUndoToast('Savings goal deleted', async () => {
      const current = [...(store.get('savings') ?? [])];
      current.splice(idx, 0, deleted);
      await writeAllRows(CONFIG.sheets.savings, current.map(serialize));
      store.set('savings', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete goal.');
  }
}

// ─── Edit helpers ─────────────────────────────────────────────────────────────

function _startEdit(id) {
  const goals = store.get('savings') ?? [];
  const g = goals.find(g => g.id === id);
  if (!g) return;
  _editingId = id;
  const f = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val ?? ''; };
  f('savings-name', g.name);
  f('savings-target-amount', g.targetAmount);
  f('savings-target-date', g.targetDate);
  f('savings-saved-amount', g.savedAmount);
  const label = document.getElementById('oc-savings-label');
  if (label) label.textContent = 'Edit Savings Goal';
  const submitBtn = document.getElementById('sav-submit-btn');
  if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Update Goal';
  const cancelBtn = document.getElementById('sav-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-savings')).show();
}

function _resetSavForm() {
  _editingId = null;
  const form = document.getElementById('savings-form');
  if (form) form.reset();
  const label = document.getElementById('oc-savings-label');
  if (label) label.textContent = 'Add Savings Goal';
  const submitBtn = document.getElementById('sav-submit-btn');
  if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Add Goal';
  const cancelBtn = document.getElementById('sav-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('d-none');
  hideError();
}

// ─── Filter binding ───────────────────────────────────────────────────────────

function _bindSavFilters() {
  const searchEl = document.getElementById('sav-search');
  if (searchEl) {
    let _t;
    searchEl.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _savFilter.search = searchEl.value; _paginator = null; render(); }, 220);
    });
  }
  const statusBtn  = document.getElementById('sav-status-btn');
  const statusMenu = document.getElementById('sav-status-menu');
  if (statusBtn && statusMenu) {
    const opts = [
      { val: '',            label: 'All' },
      { val: 'in-progress', label: '🔵 In Progress' },
      { val: 'completed',   label: '🟢 Completed' },
      { val: 'overdue',     label: '🔴 Overdue' },
    ];
    statusMenu.innerHTML = opts.map(o =>
      `<button class="fdd-item" data-val="${o.val}">${o.label}</button>`).join('');
    statusBtn.addEventListener('click', () => statusMenu.classList.toggle('fdd-open'));
    document.addEventListener('click', e => {
      if (!statusBtn.contains(e.target) && !statusMenu.contains(e.target))
        statusMenu.classList.remove('fdd-open');
    });
    statusMenu.querySelectorAll('.fdd-item').forEach(item => {
      item.addEventListener('click', () => {
        _savFilter.status = item.dataset.val;
        statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>${item.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
        statusMenu.classList.remove('fdd-open');
        document.querySelectorAll('[data-sav-preset]').forEach(b => b.classList.remove('active'));
        _paginator = null;
        render();
      });
    });
  }
  document.querySelectorAll('[data-sav-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _savFilter.status = btn.dataset.savPreset;
      document.querySelectorAll('[data-sav-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (statusBtn) statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      _paginator = null;
      render();
    });
  });
}

// ─── init() ──────────────────────────────────────────────────────────────────

export function init() {
  _bindForm();
  _bindSavFilters();
  store.on('savings', render);
}

function _bindForm() {
  const form = document.getElementById('savings-form');
  if (!form) return;

  const modal = document.getElementById('oc-savings');
  if (modal) modal.addEventListener('hidden.bs.modal', _resetSavForm);

  const cancelBtn = document.getElementById('sav-cancel-edit');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    _resetSavForm();
    bootstrap.Modal.getInstance(modal)?.hide();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const name           = document.getElementById('savings-name')?.value?.trim() ?? '';
    const targetAmountRaw = document.getElementById('savings-target-amount')?.value?.trim() ?? '';
    const targetDate     = document.getElementById('savings-target-date')?.value?.trim() ?? '';
    const savedAmountRaw = document.getElementById('savings-saved-amount')?.value?.trim() ?? '';
    const savedAmount    = savedAmountRaw === '' ? 0 : parseFloat(savedAmountRaw);

    const reqResult = requireFields({ name, targetAmount: targetAmountRaw }, ['name', 'targetAmount']);
    if (!reqResult.valid) { showError(reqResult.errors.join('. ')); return; }

    const amtResult = requirePositiveNumber(targetAmountRaw);
    if (!amtResult.valid) { showError(amtResult.errors[0]); return; }

    // Only validate future date for new goals
    if (!_editingId && targetDate) {
      const dateResult = requireFutureDate(targetDate);
      if (!dateResult.valid) { showError(dateResult.errors[0]); return; }
    }

    if (_editingId) {
      const goals = [...(store.get('savings') ?? [])];
      const idx = goals.findIndex(g => g.id === _editingId);
      if (idx === -1) return;
      goals[idx] = {
        ...goals[idx],
        name,
        targetAmount: parseFloat(targetAmountRaw),
        targetDate,
        savedAmount: isNaN(savedAmount) ? goals[idx].savedAmount : savedAmount,
      };
      try {
        await writeAllRows(CONFIG.sheets.savings, goals.map(serialize));
        store.set('savings', goals);
        _resetSavForm();
        bootstrap.Modal.getInstance(modal)?.hide();
      } catch (err) {
        showError(err.message ?? 'Failed to update goal.');
      }
    } else {
      const record = {
        id: crypto.randomUUID(),
        name,
        targetAmount: parseFloat(targetAmountRaw),
        targetDate,
        savedAmount: isNaN(savedAmount) ? 0 : savedAmount,
      };
      try {
        await appendRow(CONFIG.sheets.savings, serialize(record));
        const rows = await fetchRows(CONFIG.sheets.savings);
        store.set('savings', rows.map(deserialize));
        form.reset();
        hideError();
        bootstrap.Modal.getInstance(modal)?.hide();
      } catch (err) {
        showError(err.message ?? 'Failed to save goal. Please try again.');
      }
    }
  });
}
