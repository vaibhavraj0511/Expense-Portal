// js/bills.js — Bills & Due Date Reminders module

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate, bindDependentPaymentSelect } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, name, category, amount, dueDay, frequency, paymentMethod, lastPaid, active, dueMonth

export function serialize(b) {
  return [
    b.id,
    b.name,
    b.category ?? '',
    String(b.amount),
    String(b.dueDay),
    b.frequency ?? 'monthly',
    b.paymentMethod ?? '',
    b.lastPaid ?? '',
    b.active ? 'true' : 'false',
    b.dueMonth ? String(b.dueMonth) : '',
  ];
}

export function deserialize(row) {
  return {
    id:            row[0] ?? '',
    name:          row[1] ?? '',
    category:      row[2] ?? '',
    amount:        parseFloat(row[3]) || 0,
    dueDay:        parseInt(row[4]) || 1,
    frequency:     row[5] ?? 'monthly',
    paymentMethod: row[6] ?? '',
    lastPaid:      row[7] ?? '',
    active:        row[8] !== 'false',
    dueMonth:      parseInt(row[9]) || null,
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Next due date calculation ────────────────────────────────────────────────

function _nextDueDate(bill) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (bill.frequency === 'yearly') {
    const month = bill.dueMonth ? bill.dueMonth - 1 : 0;
    const d = new Date(today.getFullYear(), month, bill.dueDay);
    if (d < today) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  if (bill.frequency === 'quarterly') {
    const startMonth = bill.dueMonth ? bill.dueMonth - 1 : 0;
    const offset = (today.getMonth() - startMonth + 12) % 3;
    const monthsToAdd = offset === 0 ? 0 : 3 - offset;
    const d = new Date(today.getFullYear(), today.getMonth() + monthsToAdd, bill.dueDay);
    if (d < today) return new Date(today.getFullYear(), today.getMonth() + monthsToAdd + 3, bill.dueDay);
    return d;
  }

  // monthly (default)
  const d = new Date(today.getFullYear(), today.getMonth(), bill.dueDay);
  if (d < today) d.setMonth(d.getMonth() + 1);
  return d;
}

function _getDaysUntilDue(bill) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = _nextDueDate(bill);
  return Math.round((next - today) / 86400000);
}

// ─── Get upcoming bills (due in next 7 days) ──────────────────────────────────

export function getUpcomingBills() {
  const bills = store.get('bills') ?? [];
  return bills
    .filter(b => b.active)
    .map(b => ({ ...b, daysUntil: _getDaysUntilDue(b) }))
    .filter(b => b.daysUntil >= 0 && b.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const bills = store.get('bills') ?? [];
  const countEl = document.getElementById('bills-count');
  if (countEl) countEl.textContent = bills.length || '';

  // Stat cards
  const activeBills  = bills.filter(b => b.active);
  const dueThisWeek  = activeBills.filter(b => { const d = _getDaysUntilDue(b); return d >= 0 && d <= 7; }).length;
  const monthlyTotal = activeBills.filter(b => b.frequency === 'monthly').reduce((s, b) => s + b.amount, 0);
  const _s = el => document.getElementById(el);
  if (_s('bill-stat-active'))    _s('bill-stat-active').textContent    = activeBills.length;
  if (_s('bill-stat-due-week'))  _s('bill-stat-due-week').textContent  = dueThisWeek;
  if (_s('bill-stat-monthly'))   _s('bill-stat-monthly').textContent   = formatCurrency(monthlyTotal);

  const list = document.getElementById('bills-list');
  const empty = document.getElementById('bills-empty-state');
  if (!list) return;

  if (bills.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');

  const FREQ_LABEL = { monthly: 'Monthly', yearly: 'Yearly' };

  list.innerHTML = `<div class="data-cards-grid">${bills.map(b => {
    const next = _nextDueDate(b);
    const nextStr = next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const daysUntil = _getDaysUntilDue(b);
    const urgency = daysUntil === 0 ? 'text-danger fw-semibold' : daysUntil <= 3 ? 'text-warning' : daysUntil <= 7 ? 'text-info' : 'text-muted';
    const statusBadge = !b.active ? '<span class="badge bg-secondary ms-2">Inactive</span>' : '';

    return `
      <div class="data-card${!b.active ? ' opacity-50' : ''}">
        <div class="dc-header">
          <div class="dc-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706)">
            <i class="bi bi-receipt"></i>
          </div>
          <div class="dc-meta">
            <div class="dc-title">${escapeHtml(b.name)}${statusBadge}</div>
            <div class="dc-subtitle">${escapeHtml(b.category)} · <span class="badge bg-primary-subtle text-primary-emphasis">${FREQ_LABEL[b.frequency] ?? b.frequency}</span></div>
          </div>
          <div class="dc-amount" style="color:#f59e0b">${formatCurrency(b.amount)}</div>
        </div>
        <div class="dc-footer">
          <span class="dc-badge ${urgency}"><i class="bi bi-calendar-event me-1"></i>Due: ${nextStr}${daysUntil === 0 ? ' (today)' : daysUntil === 1 ? ' (tomorrow)' : daysUntil <= 7 ? ` (${daysUntil} days)` : ''}</span>
          ${b.paymentMethod ? `<span class="dc-badge"><i class="bi bi-credit-card me-1"></i>${escapeHtml(b.paymentMethod)}</span>` : ''}
          <div class="dc-actions">
            <button class="btn btn-sm btn-outline-success" data-mark-paid-bill="${escapeHtml(b.id)}" title="Mark as Paid"><i class="bi bi-check-circle-fill"></i></button>
            <button class="btn btn-sm ${b.active ? 'btn-outline-warning' : 'btn-outline-success'}" data-toggle-active-bill="${escapeHtml(b.id)}" title="${b.active ? 'Deactivate' : 'Activate'}"><i class="bi ${b.active ? 'bi-pause-fill' : 'bi-play-fill'}"></i></button>
            <button class="btn btn-sm btn-outline-primary" data-edit-bill="${escapeHtml(b.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="btn btn-sm btn-outline-danger" data-delete-bill="${escapeHtml(b.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;

  list.querySelectorAll('[data-mark-paid-bill]').forEach(btn =>
    btn.addEventListener('click', () => _markPaid(btn.dataset.markPaidBill)));
  list.querySelectorAll('[data-toggle-active-bill]').forEach(btn =>
    btn.addEventListener('click', () => _toggleActive(btn.dataset.toggleActiveBill)));
  list.querySelectorAll('[data-edit-bill]').forEach(btn =>
    btn.addEventListener('click', () => _startEdit(btn.dataset.editBill)));
  list.querySelectorAll('[data-delete-bill]').forEach(btn =>
    btn.addEventListener('click', () => _deleteBill(btn.dataset.deleteBill)));
}

// ─── Form binding ─────────────────────────────────────────────────────────────

let _editingId = null;

function _toggleDueMonthRow(frequency) {
  const row = document.getElementById('bill-due-month-row');
  if (row) row.classList.toggle('d-none', !['yearly','quarterly'].includes(frequency));
}

function _startEdit(id) {
  const bill = (store.get('bills') ?? []).find(b => b.id === id);
  if (!bill) return;
  _editingId = id;

  document.getElementById('bill-name').value = bill.name;
  document.getElementById('bill-category').value = bill.category;
  document.getElementById('bill-amount').value = bill.amount;
  document.getElementById('bill-due-day').value = bill.dueDay;
  document.getElementById('bill-frequency').value = bill.frequency;
  const dueMonthEl = document.getElementById('bill-due-month');
  if (dueMonthEl) dueMonthEl.value = bill.dueMonth ?? '';
  _toggleDueMonthRow(bill.frequency);

  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const typeSel = document.getElementById('bill-payment-type');
  const valSel = document.getElementById('bill-payment-method');
  if (typeSel && valSel && bill.paymentMethod) {
    const isWallet = accounts.some(a => a.name === bill.paymentMethod && a.type === 'Wallet');
    const isCash   = accounts.some(a => a.name === bill.paymentMethod && a.type === 'Cash');
    const isAcc    = accounts.some(a => a.name === bill.paymentMethod && !['Wallet','Cash'].includes(a.type));
    typeSel.value = isWallet ? 'wallet' : isCash ? 'cash' : isAcc ? 'account' : 'card';
    typeSel.dispatchEvent(new Event('change'));
    setTimeout(() => { valSel.value = bill.paymentMethod; }, 0);
  }

  const cancelBtn = document.getElementById('bill-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  const submitBtn = document.querySelector('#bills-form [type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Update Bill';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-bill')).show();
}

async function _markPaid(id) {
  const bills = store.get('bills') ?? [];
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  
  const today = new Date().toISOString().split('T')[0];
  const updated = bills.map(b => b.id === id ? { ...b, lastPaid: today } : b);
  
  try {
    await writeAllRows(CONFIG.sheets.bills, updated.map(serialize));
    store.set('bills', updated);
    alert(`✓ ${bill.name} marked as paid on ${new Date().toLocaleDateString('en-IN')}`);
  } catch (err) {
    alert(err.message ?? 'Failed to mark bill as paid.');
  }
}

async function _toggleActive(id) {
  const bills = store.get('bills') ?? [];
  const updated = bills.map(b => b.id === id ? { ...b, active: !b.active } : b);
  try {
    await writeAllRows(CONFIG.sheets.bills, updated.map(serialize));
    store.set('bills', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to toggle bill status.');
  }
}

async function _deleteBill(id) {
  if (!await epConfirm('Delete this bill reminder?', 'Delete Bill', 'Delete')) return;
  const allBills = store.get('bills') ?? [];
  const deleted = allBills.find(b => b.id === id);
  const bills = allBills.filter(b => b.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.bills, bills.map(serialize));
    store.set('bills', bills);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Bill deleted', async () => {
      const current = [...(store.get('bills') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.bills, current.map(serialize));
      store.set('bills', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete.');
  }
}

export function init() {
  const form = document.getElementById('bills-form');
  if (!form) return;

  // Payment method dependent dropdowns
  const refreshPayment = bindDependentPaymentSelect('bill-payment-type', 'bill-payment-method', store);
  store.on('accounts', refreshPayment);
  store.on('creditCards', refreshPayment);

  // Show/hide month selector based on frequency
  document.getElementById('bill-frequency')?.addEventListener('change', e => _toggleDueMonthRow(e.target.value));

  // Cancel edit
  document.getElementById('bill-cancel-edit')?.addEventListener('click', () => {
    _editingId = null;
    form.reset();
    document.getElementById('bill-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Add Bill';
  });

  // Reset on modal close
  document.getElementById('oc-bill')?.addEventListener('hidden.bs.modal', () => {
    _editingId = null;
    form.reset();
    document.getElementById('bill-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Add Bill';
    document.getElementById('bills-form-error')?.classList.add('d-none');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('bills-form-error');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.classList.remove('d-none'); } };
    if (errEl) errEl.classList.add('d-none');

    const name          = document.getElementById('bill-name')?.value?.trim() ?? '';
    const category      = document.getElementById('bill-category')?.value?.trim() ?? '';
    const amount        = parseFloat(document.getElementById('bill-amount')?.value) || 0;
    const dueDay        = parseInt(document.getElementById('bill-due-day')?.value) || 1;
    const frequency     = document.getElementById('bill-frequency')?.value ?? 'monthly';
    const dueMonth      = parseInt(document.getElementById('bill-due-month')?.value || '0') || null;
    const paymentMethod = document.getElementById('bill-payment-method')?.value ?? '';

    if (!name) { showErr('Bill name is required.'); return; }
    if (!category) { showErr('Category is required.'); return; }
    if (!amount || amount <= 0) { showErr('Amount must be positive.'); return; }
    if (dueDay < 1 || dueDay > 31) { showErr('Due day must be between 1 and 31.'); return; }

    const record = { 
      id: _editingId ?? crypto.randomUUID(), 
      name, 
      category, 
      amount, 
      dueDay, 
      frequency, 
      dueMonth: ['yearly','quarterly'].includes(frequency) ? dueMonth : null,
      paymentMethod, 
      lastPaid: '', 
      active: true 
    };

    try {
      let bills = store.get('bills') ?? [];
      if (_editingId) {
        const existing = bills.find(b => b.id === _editingId);
        record.lastPaid = existing?.lastPaid ?? '';
        record.active = existing?.active ?? true;
        bills = bills.map(b => b.id === _editingId ? record : b);
      } else {
        bills = [...bills, record];
      }
      await writeAllRows(CONFIG.sheets.bills, bills.map(serialize));
      store.set('bills', bills);
      _editingId = null;
      form.reset();
      bootstrap.Modal.getInstance(document.getElementById('oc-bill'))?.hide();
    } catch (err) {
      showErr(err.message ?? 'Failed to save.');
    }
  });

  store.on('bills', render);
}
