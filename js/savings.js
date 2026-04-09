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
          list.innerHTML = `
            <div class="savings-empty-state">
              <div class="ses-icon-wrap">
                <i class="bi bi-piggy-bank-fill"></i>
              </div>
              <div class="ses-title">No savings goals yet</div>
              <div class="ses-subtitle">Start building your financial future — set a goal and track your progress here.</div>
              <button class="btn btn-primary ses-cta" data-bs-toggle="modal" data-bs-target="#oc-savings">
                <i class="bi bi-plus-circle-fill me-2"></i>Create Your First Goal
              </button>
            </div>`;
          return;
        }
        list.innerHTML = `<div class="savings-grid">${slice.map(g => {
          const idx = g._idx;
          const progress = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
          const remaining = Math.max(0, g.targetAmount - g.savedAmount);
          const completed = g.savedAmount >= g.targetAmount;
          const daysLeft = g.targetDate ? Math.ceil((new Date(g.targetDate) - new Date()) / 86400000) : null;
          const daysLabel = completed ? 'Goal reached!' : daysLeft === null ? '' : daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`;
          const pct = progress.toFixed(1);

          // Color based on progress
          const color = completed ? '#10b981' : progress >= 75 ? '#3b82f6' : progress >= 40 ? '#f59e0b' : '#6366f1';

          // Circular SVG progress
          const r = 28, circ = 2 * Math.PI * r;
          const dash = (progress / 100) * circ;
          const ring = `<svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6"/>
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="6"
              stroke-linecap="round"
              stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
              transform="rotate(-90 36 36)"/>
            <text x="36" y="40" text-anchor="middle" font-size="13" font-weight="700" fill="${color}">${pct}%</text>
          </svg>`;

          return `
            <div class="sgc2${completed ? ' sgc2--done' : ''}" style="--sgc-color:${color}">
              <!-- Header -->
              <div class="sgc2-header">
                <div class="sgc2-ring">${ring}</div>
                <div class="sgc2-info">
                  <div class="sgc2-name">${escapeHtml(g.name)}</div>
                  <div class="sgc2-meta">
                    ${completed
                      ? `<span class="badge bg-success-subtle text-success-emphasis"><i class="bi bi-check-circle-fill me-1"></i>Completed</span>`
                      : `<span class="sgc2-days">${daysLabel}</span>`}
                  </div>
                  <!-- Milestones -->
                  <div class="sgc2-milestones">
                    ${[25,50,75,100].map(m => {
                      const hit = progress >= m;
                      return `<span class="sgc2-ms${hit ? ' sgc2-ms--hit' : ''}" title="${m}%">${hit ? '●' : '○'}</span>`;
                    }).join('')}
                  </div>
                </div>
                <button class="btn btn-sm btn-ghost-danger ms-auto align-self-start" data-delete-idx="${idx}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>

              <!-- Stats row -->
              <div class="sgc2-stats">
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Target</span>
                  <span class="sgc2-stat-val">${formatCurrency(g.targetAmount)}</span>
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Saved</span>
                  <span class="sgc2-stat-val"${g.savedAmount > 0 ? ' style="color:#10b981"' : ''}>${formatCurrency(g.savedAmount)}</span>
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Remaining</span>
                  <span class="sgc2-stat-val"${remaining > 0 && remaining < g.targetAmount ? ' style="color:#f59e0b"' : remaining === g.targetAmount ? '' : ' style="color:#ef4444"'}>${formatCurrency(remaining)}</span>
                </div>
                <div class="sgc2-stat">
                  <span class="sgc2-stat-label">Target Date</span>
                  <span class="sgc2-stat-val">${g.targetDate ? formatDate(g.targetDate) : '—'}</span>
                </div>
              </div>

              ${!completed ? `
              <!-- Add / Withdraw -->
              <div class="sgc2-actions">
                <div class="sgc2-input-row">
                  <span class="sgc2-prefix">₹</span>
                  <input type="number" class="sgc2-input" min="0.01" step="0.01" id="savings-update-${idx}" placeholder="Add amount…" />
                  <button class="sgc2-btn sgc2-btn--add" data-update-idx="${idx}"><i class="bi bi-plus-lg me-1"></i>Add</button>
                </div>
                <div class="sgc2-input-row">
                  <span class="sgc2-prefix" style="color:#ef4444">₹</span>
                  <input type="number" class="sgc2-input" min="0.01" step="0.01" id="savings-withdraw-${idx}" placeholder="Withdraw amount…" />
                  <button class="sgc2-btn sgc2-btn--withdraw" data-withdraw-idx="${idx}"><i class="bi bi-dash-lg me-1"></i>Withdraw</button>
                </div>
              </div>` : ''}
            </div>`;
        }).join('')}</div>`;
        list.querySelectorAll('[data-update-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.updateIdx);
            const input = document.getElementById(`savings-update-${idx}`);
            const newAmount = parseFloat(input?.value ?? '');
            if (isNaN(newAmount) || newAmount < 0) { input?.classList.add('is-invalid'); return; }
            input?.classList.remove('is-invalid');
            _updateSavedAmount(idx, newAmount);
          });
        });
        list.querySelectorAll('[data-withdraw-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.withdrawIdx);
            const input = document.getElementById(`savings-withdraw-${idx}`);
            const amount = parseFloat(input?.value ?? '');
            if (isNaN(amount) || amount <= 0) { input?.classList.add('is-invalid'); return; }
            input?.classList.remove('is-invalid');
            _withdrawSavedAmount(idx, amount);
          });
        });
        list.querySelectorAll('[data-delete-idx]').forEach(btn => {
          btn.addEventListener('click', () => _deleteGoal(parseInt(btn.dataset.deleteIdx)));
        });
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
  const goals = (store.get('savings') ?? []).map((g, i) => ({ ...g, _idx: i }));
  const countEl = document.getElementById('savings-count');
  if (countEl) countEl.textContent = goals.length || '';

  // Stat cards
  const totalSaved = goals.reduce((s, g) => s + (Number(g.savedAmount) || 0), 0);
  const totalTarget = goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);
  const done = goals.filter(g => (Number(g.savedAmount) || 0) >= (Number(g.targetAmount) || 0) && g.targetAmount > 0).length;
  const el = id => document.getElementById(id);
  if (el('sav-stat-saved')) el('sav-stat-saved').textContent = formatCurrency(totalSaved);
  if (el('sav-stat-target')) el('sav-stat-target').textContent = formatCurrency(totalTarget);
  if (el('sav-stat-done')) el('sav-stat-done').textContent = done;

  _getPaginator().update(goals);
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

// ─── init() (Task 10.3) ──────────────────────────────────────────────────────

/**
 * Binds the savings form submit handler and subscribes render to store changes.
 * Requirements: 14.1–14.5
 */
export function init() {
  _bindForm();
  store.on('savings', render);
}

function _bindForm() {
  const form = document.getElementById('savings-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const name = document.getElementById('savings-name')?.value?.trim() ?? '';
    const targetAmount = document.getElementById('savings-target-amount')?.value?.trim() ?? '';
    const targetDate = document.getElementById('savings-target-date')?.value?.trim() ?? '';
    const savedAmountRaw = document.getElementById('savings-saved-amount')?.value?.trim() ?? '';
    const savedAmount = savedAmountRaw === '' ? 0 : parseFloat(savedAmountRaw);

    // Validate required fields
    const reqResult = requireFields({ name, targetAmount, targetDate }, ['name', 'targetAmount', 'targetDate']);
    if (!reqResult.valid) {
      showError(reqResult.errors.join('. '));
      return;
    }

    // Validate positive number
    const amtResult = requirePositiveNumber(targetAmount);
    if (!amtResult.valid) {
      showError(amtResult.errors[0]);
      return;
    }

    // Validate future date
    const dateResult = requireFutureDate(targetDate);
    if (!dateResult.valid) {
      showError(dateResult.errors[0]);
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      name,
      targetAmount: parseFloat(targetAmount),
      targetDate,
      savedAmount: isNaN(savedAmount) ? 0 : savedAmount,
    };

    try {
      await appendRow(CONFIG.sheets.savings, serialize(record));
      const rows = await fetchRows(CONFIG.sheets.savings);
      store.set('savings', rows.map(deserialize));
      form.reset();
      hideError();
      const modal = document.getElementById('oc-savings');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showError(err.message ?? 'Failed to save goal. Please try again.');
    }
  });
}
