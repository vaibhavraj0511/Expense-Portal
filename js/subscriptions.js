// js/subscriptions.js — Subscription Tracker module
import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, bindDependentPaymentSelect, restorePaymentSelects } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, name, category, amount, billingCycle, nextBillingDate, paymentMethod, notes, active, lastCreated

export function serialize(s) {
  return [s.id, s.name, s.category ?? '', String(s.amount), s.billingCycle ?? 'monthly', s.nextBillingDate ?? '', s.paymentMethod ?? '', s.notes ?? '', s.active !== false ? 'true' : 'false', s.lastCreated ?? ''];
}

export function deserialize(row) {
  return {
    id:              row[0] ?? '',
    name:            row[1] ?? '',
    category:        row[2] ?? '',
    amount:          parseFloat(row[3]) || 0,
    billingCycle:    row[4] ?? 'monthly',
    nextBillingDate: row[5] ?? '',
    paymentMethod:   row[6] ?? '',
    notes:           row[7] ?? '',
    active:          row[8] !== 'false',
    lastCreated:     row[9] ?? '',
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _nextBillingLabel(dateStr) {
  if (!dateStr) return { label: '—', daysUntil: null };
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return { label: '—', daysUntil: null };
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return { label, daysUntil: days };
}

function _annualCost(sub) {
  switch (sub.billingCycle) {
    case 'weekly':    return sub.amount * 52;
    case 'monthly':   return sub.amount * 12;
    case 'quarterly': return sub.amount * 4;
    case 'half-yearly': return sub.amount * 2;
    case 'yearly':    return sub.amount;
    default:          return sub.amount * 12;
  }
}

function _monthlyCost(sub) {
  return _annualCost(sub) / 12;
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const all = store.get('subscriptions') ?? [];
  const active   = all.filter(s => s.active !== false);
  const inactive = all.filter(s => s.active === false);

  // Summary stats
  const monthlyTotal = active.reduce((s, sub) => s + _monthlyCost(sub), 0);
  const annualTotal  = active.reduce((s, sub) => s + _annualCost(sub),  0);
  const totalCount   = active.length;

  const elMonth = document.getElementById('sub-stat-monthly');
  const elAnnual = document.getElementById('sub-stat-annual');
  const elCount  = document.getElementById('sub-stat-count');
  if (elMonth)  elMonth.textContent  = formatCurrency(Math.round(monthlyTotal));
  if (elAnnual) elAnnual.textContent = formatCurrency(Math.round(annualTotal));
  if (elCount)  elCount.textContent  = totalCount;

  const container = document.getElementById('subscriptions-list');
  if (!container) return;

  if (all.length === 0) {
    container.innerHTML = `<div class="ep-empty-state"><i class="bi bi-collection-play" style="font-size:2rem;color:#94a3b8"></i><p class="mt-2 text-muted">No subscriptions added yet.<br><small>Track Netflix, Spotify, cloud storage and more.</small></p></div>`;
    return;
  }

  const CYCLE_LABELS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', 'half-yearly': 'Half-Yearly', yearly: 'Yearly' };

  function _renderGroup(subs, title) {
    if (subs.length === 0) return '';
    return `
      <div class="sub-group mb-3">
        <div class="sub-group-header">${title} <span class="badge bg-secondary ms-1">${subs.length}</span></div>
        <div class="data-cards-grid">
          ${subs.map(sub => {
            const { label: dueLabel, daysUntil } = _nextBillingLabel(sub.nextBillingDate);
            const dueBadge = daysUntil !== null && daysUntil <= 7
              ? `<span class="badge ${daysUntil <= 3 ? 'bg-danger' : 'bg-warning text-dark'} ms-1">${daysUntil === 0 ? 'Today' : daysUntil < 0 ? 'Overdue' : daysUntil + 'd'}</span>` : '';
            const cycleLabel = CYCLE_LABELS[sub.billingCycle] ?? sub.billingCycle;
            return `
              <div class="data-card${!sub.active ? ' opacity-50' : ''}">
                <div class="dc-header">
                  <div class="dc-icon sub-icon"><i class="bi bi-collection-play-fill"></i></div>
                  <div class="dc-meta">
                    <div class="dc-title">${escapeHtml(sub.name)}</div>
                    <div class="dc-subtitle">${sub.category ? escapeHtml(sub.category) + ' · ' : ''}${cycleLabel}</div>
                  </div>
                  <div class="dc-amount" style="color:#8b5cf6">${formatCurrency(sub.amount)}</div>
                </div>
                <div class="dc-footer">
                  <span class="dc-badge"><i class="bi bi-calendar3 me-1"></i>${dueLabel}${dueBadge}</span>
                  ${sub.paymentMethod ? `<span class="dc-badge"><i class="bi bi-credit-card me-1"></i>${escapeHtml(sub.paymentMethod)}</span>` : ''}
                  <span class="dc-badge text-muted">≈${formatCurrency(Math.round(_monthlyCost(sub)))}/mo</span>
                  <div class="dc-actions">
                    <button class="btn btn-sm btn-outline-primary sub-edit-btn" data-id="${escapeHtml(sub.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                    <button class="btn btn-sm btn-outline-danger sub-del-btn" data-id="${escapeHtml(sub.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = _renderGroup(active, 'Active Subscriptions') + _renderGroup(inactive, 'Inactive / Paused');

  container.querySelectorAll('.sub-del-btn').forEach(btn => {
    btn.addEventListener('click', () => _handleDelete(btn.dataset.id));
  });
  container.querySelectorAll('.sub-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => _openEdit(btn.dataset.id));
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _handleDelete(id) {
  const confirmed = await epConfirm('Delete this subscription?');
  if (!confirmed) return;
  const records = store.get('subscriptions') ?? [];
  const updated = records.filter(s => s.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.subscriptions, updated.map(serialize));
    store.set('subscriptions', updated);
  } catch (err) {
    alert(err.message ?? 'Failed to delete.');
  }
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function _openEdit(id) {
  const records = store.get('subscriptions') ?? [];
  const sub = records.find(s => s.id === id);
  if (!sub) return;
  _populateForm(sub);
  document.getElementById('sub-form-title').textContent = 'Edit Subscription';
  document.getElementById('sub-editing-id').value = id;
  document.getElementById('sub-cancel-edit').classList.remove('d-none');
  const modal = document.getElementById('oc-subscription');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

function _populateForm(sub) {
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  f('sub-name', sub.name);
  f('sub-category', sub.category);
  f('sub-amount', sub.amount);
  f('sub-cycle', sub.billingCycle);
  f('sub-next-date', sub.nextBillingDate);
  restorePaymentSelects('sub-payment-type', 'sub-payment-method', sub.paymentMethod, store);
  f('sub-notes', sub.notes);
  const activeEl = document.getElementById('sub-active');
  if (activeEl) activeEl.checked = sub.active !== false;
}

function _resetForm() {
  const form = document.getElementById('sub-form');
  if (form) form.reset();
  const titleEl = document.getElementById('sub-form-title');
  if (titleEl) titleEl.textContent = 'Add Subscription';
  const idEl = document.getElementById('sub-editing-id');
  if (idEl) idEl.value = '';
  const cancelBtn = document.getElementById('sub-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('d-none');
  const modal = document.getElementById('oc-subscription');
  if (modal) bootstrap.Modal.getInstance(modal)?.hide();
}

// ─── Advance nextBillingDate by one cycle ─────────────────────────────────────

function _advanceDate(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (cycle) {
    case 'weekly':      d.setDate(d.getDate() + 7);      break;
    case 'monthly':     d.setMonth(d.getMonth() + 1);    break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3);    break;
    case 'half-yearly': d.setMonth(d.getMonth() + 6);    break;
    case 'yearly':      d.setFullYear(d.getFullYear()+1); break;
    default:            d.setMonth(d.getMonth() + 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Auto-create due expenses ─────────────────────────────────────────────────

export async function processDueSubscriptions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let subs = store.get('subscriptions') ?? [];
  const due = subs.filter(s =>
    s.active !== false &&
    s.nextBillingDate &&
    s.nextBillingDate <= todayStr &&
    s.lastCreated !== todayStr
  );

  if (due.length === 0) return;

  const { serialize: serExp, deserialize: deExp } = await import('./expenses.js');
  const { appendRow: _append, fetchRows: _fetch } = await import('./api.js');

  for (const sub of due) {
    try {
      const record = {
        date:          sub.nextBillingDate <= todayStr ? todayStr : sub.nextBillingDate,
        category:      sub.category || 'Subscriptions',
        subCategory:   '',
        amount:        sub.amount,
        description:   sub.name,
        paymentMethod: sub.paymentMethod ?? '',
      };
      await _append(CONFIG.sheets.expenses, serExp(record));
      const rows = await _fetch(CONFIG.sheets.expenses);
      store.set('expenses', rows.map(deExp));

      // Advance nextBillingDate and mark lastCreated
      subs = subs.map(s => s.id === sub.id
        ? { ...s, nextBillingDate: _advanceDate(sub.nextBillingDate, sub.billingCycle), lastCreated: todayStr }
        : s
      );
      await writeAllRows(CONFIG.sheets.subscriptions, subs.map(serialize));
      store.set('subscriptions', subs);

      console.info(`[subscriptions] Auto-created expense: ${sub.name} ₹${sub.amount} on ${todayStr}`);
    } catch (err) {
      console.warn('[subscriptions] Failed to create expense:', err);
    }
  }
}

export function init() {
  store.on('subscriptions', render);

  const form = document.getElementById('sub-form');
  if (!form) return;

  const refreshPayment = bindDependentPaymentSelect('sub-payment-type', 'sub-payment-method', store);
  store.on('accounts',    refreshPayment);
  store.on('creditCards', refreshPayment);

  const cancelBtn = document.getElementById('sub-cancel-edit');
  if (cancelBtn) cancelBtn.addEventListener('click', _resetForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl = document.getElementById('sub-name');
    const amtEl  = document.getElementById('sub-amount');
    const name   = nameEl?.value?.trim() ?? '';
    const amount = parseFloat(amtEl?.value ?? '') || 0;

    if (!name) { nameEl?.classList.add('is-invalid'); return; }
    nameEl?.classList.remove('is-invalid');
    if (amount <= 0) { amtEl?.classList.add('is-invalid'); return; }
    amtEl?.classList.remove('is-invalid');

    const editingId = document.getElementById('sub-editing-id')?.value?.trim();
    const records   = store.get('subscriptions') ?? [];

    const sub = {
      id:              editingId || `sub_${Date.now()}`,
      name,
      category:        document.getElementById('sub-category')?.value?.trim() ?? '',
      amount,
      billingCycle:    document.getElementById('sub-cycle')?.value ?? 'monthly',
      nextBillingDate: document.getElementById('sub-next-date')?.value ?? '',
      paymentMethod:   document.getElementById('sub-payment-method')?.value?.trim() ?? '',
      notes:           document.getElementById('sub-notes')?.value?.trim() ?? '',
      active:          document.getElementById('sub-active')?.checked !== false,
    };

    const updated = editingId
      ? records.map(s => s.id === editingId ? sub : s)
      : [...records, sub];

    try {
      await writeAllRows(CONFIG.sheets.subscriptions, updated.map(serialize));
      store.set('subscriptions', updated);
      _resetForm();
      const modal = document.getElementById('oc-subscription');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      alert(err.message ?? 'Failed to save.');
    }
  });
}
