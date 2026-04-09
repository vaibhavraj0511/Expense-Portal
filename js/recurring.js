// js/recurring.js — Recurring Transactions module

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate, bindDependentPaymentSelect } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, type, category, amount, description, paymentMethod, frequency, day, startDate, lastCreated, paused

export function serialize(r) {
  return [r.id, r.type, r.category, String(r.amount), r.description, r.paymentMethod ?? '', r.frequency, String(r.day), r.startDate, r.lastCreated ?? '', r.paused ? 'true' : 'false'];
}

export function deserialize(row) {
  return {
    id:          row[0] ?? '',
    type:        row[1] ?? 'expense',
    category:    row[2] ?? '',
    amount:      parseFloat(row[3]) || 0,
    description: row[4] ?? '',
    paymentMethod: row[5] ?? '',
    frequency:   row[6] ?? 'monthly',
    day:         parseInt(row[7]) || 1,
    startDate:   row[8] ?? '',
    lastCreated: row[9] ?? '',
    paused:      row[10] === 'true',
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Next due date calculation ────────────────────────────────────────────────

function _nextDueDate(rec) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(rec.startDate);

  if (rec.frequency === 'weekly') {
    // Next occurrence of the weekday matching startDate
    const dayOfWeek = start.getDay();
    const d = new Date(today);
    const diff = (dayOfWeek - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
    return d;
  }

  if (rec.frequency === 'yearly') {
    const d = new Date(today.getFullYear(), start.getMonth(), rec.day);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // monthly
  const d = new Date(today.getFullYear(), today.getMonth(), rec.day);
  if (d < today) d.setMonth(d.getMonth() + 1);
  return d;
}

// Returns the date string the entry should be created with, or null if nothing to do.
function _getCreateDate(rec) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  if (rec.startDate > todayStr) return null;

  let lastDue;

  if (rec.frequency === 'weekly') {
    const start = new Date(rec.startDate);
    const targetDay = start.getDay();
    const d = new Date(today);
    const diff = (d.getDay() - targetDay + 7) % 7;
    d.setDate(d.getDate() - diff);
    lastDue = d;
  } else if (rec.frequency === 'yearly') {
    const start = new Date(rec.startDate);
    const d = new Date(today.getFullYear(), start.getMonth(), rec.day);
    if (d > today) d.setFullYear(d.getFullYear() - 1);
    lastDue = d;
  } else {
    // monthly
    const yr = today.getFullYear(), mo = today.getMonth();
    if (today.getDate() >= rec.day) {
      lastDue = new Date(yr, mo, Math.min(rec.day, new Date(yr, mo + 1, 0).getDate()));
    } else {
      const pm = mo === 0 ? 11 : mo - 1;
      const py = mo === 0 ? yr - 1 : yr;
      lastDue = new Date(py, pm, Math.min(rec.day, new Date(py, pm + 1, 0).getDate()));
    }
  }

  const lastDueStr = lastDue.toISOString().slice(0, 10);
  if (rec.startDate > lastDueStr) return null;
  if (rec.lastCreated >= lastDueStr) return null;
  return lastDueStr;
}

// ─── Auto-create due entries ──────────────────────────────────────────────────

export async function processDueRecurring() {
  const todayStr = new Date().toISOString().slice(0, 10);
  let current = store.get('recurring') ?? [];

  for (const rec of current.filter(t => !t.paused)) {
    const createDate = _getCreateDate(rec);
    if (!createDate) continue;

    try {
      if (rec.type === 'expense') {
        const { serialize: serExp, deserialize: deExp } = await import('./expenses.js');
        const record = { date: createDate, category: rec.category, subCategory: '', amount: rec.amount, description: rec.description, paymentMethod: rec.paymentMethod };
        await appendRow(CONFIG.sheets.expenses, serExp(record));
        const rows = await fetchRows(CONFIG.sheets.expenses);
        store.set('expenses', rows.map(deExp));
      } else {
        const { serialize: serInc, deserialize: deInc } = await import('./income.js');
        const record = { date: createDate, source: rec.category, amount: rec.amount, description: rec.description, receivedIn: rec.paymentMethod };
        await appendRow(CONFIG.sheets.income, serInc(record));
        const rows = await fetchRows(CONFIG.sheets.income);
        store.set('income', rows.map(deInc));
      }

      current = current.map(t => t.id === rec.id ? { ...t, lastCreated: todayStr } : t);
      await writeAllRows(CONFIG.sheets.recurring, current.map(serialize));
      store.set('recurring', current);

      const label = createDate === todayStr ? 'today' : `backdated to ${createDate}`;
      console.info(`[recurring] Created ${rec.type}: ${rec.description} ${label} (${formatCurrency(rec.amount)})`);
    } catch (err) {
      console.warn('[recurring] Failed to create entry:', err);
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const templates = store.get('recurring') ?? [];
  const countEl = document.getElementById('recurring-count');
  if (countEl) countEl.textContent = templates.length || '';

  // Stat cards
  const active   = templates.filter(r => !r.paused);
  const monthlyExp = active.filter(r => r.type === 'expense' && r.frequency === 'monthly').reduce((s, r) => s + r.amount, 0);
  const monthlyInc = active.filter(r => r.type === 'income'  && r.frequency === 'monthly').reduce((s, r) => s + r.amount, 0);
  const _s = el => { const e = document.getElementById(el); return e; };
  if (_s('rec-stat-active'))   _s('rec-stat-active').textContent   = active.length;
  if (_s('rec-stat-expenses')) _s('rec-stat-expenses').textContent = formatCurrency(monthlyExp);
  if (_s('rec-stat-income'))   _s('rec-stat-income').textContent   = formatCurrency(monthlyInc);

  const list = document.getElementById('recurring-list');
  const empty = document.getElementById('recurring-empty-state');
  if (!list) return;

  if (templates.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');

  const FREQ_LABEL = { monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly' };

  list.innerHTML = `<div class="data-cards-grid">${templates.map(r => {
    const isExpense = r.type === 'expense';
    const next = _nextDueDate(r);
    const nextStr = next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const daysUntil = Math.round((next - new Date().setHours(0,0,0,0)) / 86400000);
    const urgency = daysUntil === 0 ? 'text-success fw-semibold' : daysUntil <= 3 ? 'text-warning' : 'text-muted';

    return `
      <div class="data-card${r.paused ? ' opacity-75' : ''}">
        <div class="dc-header">
          <div class="dc-icon ${isExpense ? 'expense-icon' : 'income-icon'}">
            <i class="bi ${isExpense ? 'bi-arrow-up-circle-fill' : 'bi-arrow-down-circle-fill'}"></i>
          </div>
          <div class="dc-meta">
            <div class="dc-title">${escapeHtml(r.description)}${r.paused ? ' <span class="badge bg-warning-subtle text-warning-emphasis"><i class="bi bi-pause-fill"></i> Paused</span>' : ''}</div>
            <div class="dc-subtitle">${escapeHtml(r.category)} · <span class="badge bg-primary-subtle text-primary-emphasis">${FREQ_LABEL[r.frequency] ?? r.frequency}</span></div>
          </div>
          <div class="dc-amount ${isExpense ? 'expense-amount' : 'income-amount'}">${formatCurrency(r.amount)}</div>
        </div>
        <div class="dc-footer">
          <span class="dc-badge ${r.paused ? 'text-muted' : urgency}"><i class="bi bi-calendar3 me-1"></i>${r.paused ? 'Paused' : `Next: ${nextStr}${daysUntil === 0 ? ' (today)' : daysUntil === 1 ? ' (tomorrow)' : ''}`}</span>
          ${r.paymentMethod ? `<span class="dc-badge"><i class="bi bi-credit-card me-1"></i>${escapeHtml(r.paymentMethod)}</span>` : ''}
          <div class="dc-actions">
            <button class="btn btn-sm ${r.paused ? 'btn-outline-success' : 'btn-outline-warning'}" data-toggle-pause-rec="${escapeHtml(r.id)}" title="${r.paused ? 'Resume' : 'Pause'}"><i class="bi ${r.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i></button>
            <button class="btn btn-sm btn-outline-primary" data-edit-rec="${escapeHtml(r.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-delete-rec="${escapeHtml(r.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;

  list.querySelectorAll('[data-toggle-pause-rec]').forEach(btn =>
    btn.addEventListener('click', () => _togglePause(btn.dataset.togglePauseRec)));
  list.querySelectorAll('[data-edit-rec]').forEach(btn =>
    btn.addEventListener('click', () => _startEdit(btn.dataset.editRec)));
  list.querySelectorAll('[data-delete-rec]').forEach(btn =>
    btn.addEventListener('click', () => _deleteTemplate(btn.dataset.deleteRec)));
}

// ─── Form binding ─────────────────────────────────────────────────────────────

let _editingId = null;

function _startEdit(id) {
  const rec = (store.get('recurring') ?? []).find(r => r.id === id);
  if (!rec) return;
  _editingId = id;

  document.getElementById('rec-type').value = rec.type;
  _refreshCategoryDropdown();
  setTimeout(() => { document.getElementById('rec-category').value = rec.category; }, 0);
  document.getElementById('rec-amount').value = rec.amount;
  document.getElementById('rec-description').value = rec.description;
  document.getElementById('rec-frequency').value = rec.frequency;
  document.getElementById('rec-day').value = rec.day;
  document.getElementById('rec-start-date').value = rec.startDate;

  // Restore payment method
  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const typeSel = document.getElementById('rec-payment-type');
  const valSel = document.getElementById('rec-payment-method');
  if (typeSel && valSel && rec.paymentMethod) {
    const isWallet = accounts.some(a => a.name === rec.paymentMethod && a.type === 'Wallet');
    const isCash   = accounts.some(a => a.name === rec.paymentMethod && a.type === 'Cash');
    const isAcc    = accounts.some(a => a.name === rec.paymentMethod && !['Wallet','Cash'].includes(a.type));
    typeSel.value = isWallet ? 'wallet' : isCash ? 'cash' : isAcc ? 'account' : 'card';
    typeSel.dispatchEvent(new Event('change'));
    setTimeout(() => { valSel.value = rec.paymentMethod; }, 0);
  }

  const cancelBtn = document.getElementById('rec-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  const submitBtn = document.querySelector('#recurring-form [type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Update Recurring';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-recurring')).show();
}

async function _togglePause(id) {
  const templates = store.get('recurring') ?? [];
  const updated = templates.map(r => r.id === id ? { ...r, paused: !r.paused } : r);
  try {
    await writeAllRows(CONFIG.sheets.recurring, updated.map(serialize));
    store.set('recurring', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to toggle pause.');
  }
}

async function _deleteTemplate(id) {
  if (!await epConfirm('Delete this recurring template?', 'Delete Recurring', 'Delete')) return;
  const allTemplates = store.get('recurring') ?? [];
  const deleted = allTemplates.find(r => r.id === id);
  const templates = allTemplates.filter(r => r.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.recurring, templates.map(serialize));
    store.set('recurring', templates);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Recurring template deleted', async () => {
      const current = [...(store.get('recurring') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.recurring, current.map(serialize));
      store.set('recurring', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete.');
  }
}

function _refreshCategoryDropdown() {
  const type = document.getElementById('rec-type')?.value ?? 'expense';
  const sel = document.getElementById('rec-category');
  if (!sel) return;
  const cur = sel.value;
  let items = [];
  if (type === 'expense') {
    items = (store.get('expenseCategories') ?? []).map(c => c.name ?? c).sort((a, b) => a.localeCompare(b));
  } else {
    items = (store.get('incomeSources') ?? []).map(s => s.name ?? s).sort((a, b) => a.localeCompare(b));
  }
  sel.innerHTML = '<option value="">Select…</option>' +
    items.map(i => `<option value="${escapeHtml(i)}">${escapeHtml(i)}</option>`).join('');
  if (cur) sel.value = cur;
}

export function init() {
  const form = document.getElementById('recurring-form');
  if (!form) return;

  // Type change → refresh category dropdown
  document.getElementById('rec-type')?.addEventListener('change', _refreshCategoryDropdown);
  _refreshCategoryDropdown();
  store.on('expenseCategories', _refreshCategoryDropdown);
  store.on('incomeSources', _refreshCategoryDropdown);

  // Payment method dependent dropdowns
  const refreshPayment = bindDependentPaymentSelect('rec-payment-type', 'rec-payment-method', store);
  store.on('accounts', refreshPayment);
  store.on('creditCards', refreshPayment);

  // Cancel edit
  document.getElementById('rec-cancel-edit')?.addEventListener('click', () => {
    _editingId = null;
    form.reset();
    _refreshCategoryDropdown();
    document.getElementById('rec-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Save Recurring';
  });

  // Reset on modal close
  document.getElementById('oc-recurring')?.addEventListener('hidden.bs.modal', () => {
    _editingId = null;
    form.reset();
    _refreshCategoryDropdown();
    document.getElementById('rec-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Save Recurring';
    document.getElementById('recurring-form-error')?.classList.add('d-none');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('recurring-form-error');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.classList.remove('d-none'); } };
    if (errEl) errEl.classList.add('d-none');

    const type          = document.getElementById('rec-type')?.value ?? 'expense';
    const category      = document.getElementById('rec-category')?.value ?? '';
    const amount        = parseFloat(document.getElementById('rec-amount')?.value) || 0;
    const description   = document.getElementById('rec-description')?.value?.trim() ?? '';
    const paymentMethod = document.getElementById('rec-payment-method')?.value ?? '';
    const frequency     = document.getElementById('rec-frequency')?.value ?? 'monthly';
    const day           = parseInt(document.getElementById('rec-day')?.value) || 1;
    const startDate     = document.getElementById('rec-start-date')?.value ?? '';

    if (!category) { showErr('Category / Source is required.'); return; }
    if (!amount || amount <= 0) { showErr('Amount must be positive.'); return; }
    if (!description) { showErr('Description is required.'); return; }
    if (!startDate) { showErr('Start date is required.'); return; }

    const record = { id: _editingId ?? crypto.randomUUID(), type, category, amount, description, paymentMethod, frequency, day, startDate, lastCreated: '', paused: false };

    try {
      let templates = store.get('recurring') ?? [];
      if (_editingId) {
        const existing = templates.find(r => r.id === _editingId);
        record.lastCreated = existing?.lastCreated ?? '';
        record.paused = existing?.paused ?? false;
        templates = templates.map(r => r.id === _editingId ? record : r);
      } else {
        templates = [...templates, record];
      }
      await writeAllRows(CONFIG.sheets.recurring, templates.map(serialize));
      store.set('recurring', templates);
      _editingId = null;
      form.reset();
      _refreshCategoryDropdown();
      bootstrap.Modal.getInstance(document.getElementById('oc-recurring'))?.hide();
    } catch (err) {
      showErr(err.message ?? 'Failed to save.');
    }
  });

  store.on('recurring', render);
}
