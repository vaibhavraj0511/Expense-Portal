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

// ─── Category icon map ────────────────────────────────────────────────────────
const _BILL_ICONS = {
  electricity: 'bi-lightning-fill', electric: 'bi-lightning-fill',
  water: 'bi-droplet-fill', gas: 'bi-fire',
  internet: 'bi-wifi', broadband: 'bi-wifi', wifi: 'bi-wifi',
  phone: 'bi-phone-fill', mobile: 'bi-phone-fill', telephone: 'bi-telephone-fill',
  rent: 'bi-house-door-fill', housing: 'bi-house-fill',
  insurance: 'bi-shield-fill-check', loan: 'bi-bank2',
  subscription: 'bi-credit-card-2-front-fill', ott: 'bi-tv-fill',
  gym: 'bi-activity', fitness: 'bi-activity',
  school: 'bi-book-fill', education: 'bi-book-fill',
  maintenance: 'bi-tools', repair: 'bi-tools',
  tax: 'bi-file-earmark-text-fill', utility: 'bi-lightning-fill',
};

function _billIcon(category) {
  if (!category) return 'bi-receipt-cutoff';
  const key = category.toLowerCase().replace(/\s+/g, '');
  for (const [k, icon] of Object.entries(_BILL_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return 'bi-receipt-cutoff';
}

// ─── Filter state ─────────────────────────────────────────────────────────────
const _billFilter = { search: '', status: '' };

// ─── Next due date calculation ────────────────────────────────────────────────

function _nextDueDate(bill) {
  const isPaid = bill.lastPaid && bill.lastPaid !== '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (bill.frequency === 'yearly') {
    const month = bill.dueMonth ? bill.dueMonth - 1 : 0;
    let d = new Date(today.getFullYear(), month, bill.dueDay);
    if (isPaid) {
      d.setFullYear(d.getFullYear() + 1);
    }
    while (d <= today) {
      d.setFullYear(d.getFullYear() + 1);
    }
    return d;
  }

  if (bill.frequency === 'quarterly') {
    const startMonth = bill.dueMonth ? bill.dueMonth - 1 : 0;
    let d = new Date(today.getFullYear(), startMonth, bill.dueDay);
    if (isPaid) {
      d.setMonth(d.getMonth() + 3);
    }
    while (d <= today) {
      d.setMonth(d.getMonth() + 3);
    }
    return d;
  }

  // monthly (default)
  let d = new Date(today.getFullYear(), today.getMonth(), bill.dueDay);
  if (isPaid) {
    d.setMonth(d.getMonth() + 1);
  }
  while (d <= today) {
    d.setMonth(d.getMonth() + 1);
  }
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

  // Stat cards
  const activeBills  = bills.filter(b => b.active);
  const dueThisWeek  = activeBills.filter(b => { const d = _getDaysUntilDue(b); return d >= 0 && d <= 7; }).length;
  const overdue      = activeBills.filter(b => _getDaysUntilDue(b) < 0).length;
  const monthlyTotal = activeBills.filter(b => b.frequency === 'monthly').reduce((s, b) => s + b.amount, 0);
  const _s = el => document.getElementById(el);
  if (_s('bill-stat-active'))   _s('bill-stat-active').textContent   = activeBills.length;
  if (_s('bill-stat-due-week')) _s('bill-stat-due-week').textContent = dueThisWeek;
  if (_s('bill-stat-monthly'))  _s('bill-stat-monthly').textContent  = formatCurrency(monthlyTotal);
  if (_s('bill-stat-overdue'))  _s('bill-stat-overdue').textContent  = overdue;

  // Hero subtitle
  const heroSub = _s('bill-hero-sub');
  if (heroSub) {
    const parts = [];
    if (overdue > 0) parts.push(`<strong style="color:#fde68a">${overdue} overdue</strong>`);
    if (dueThisWeek > 0) parts.push(`${dueThisWeek} due this week`);
    heroSub.innerHTML = parts.length ? parts.join(' · ') : 'Track recurring bills and never miss a due date';
  }

  // Count badge
  const countEl = _s('bills-count');

  const list  = document.getElementById('bills-list');
  const empty = document.getElementById('bills-empty-state');
  if (!list) return;

  // Apply filters
  const search = _billFilter.search.toLowerCase();
  const status = _billFilter.status;
  const filtered = bills.filter(b => {
    if (search && !b.name.toLowerCase().includes(search) && !b.category.toLowerCase().includes(search)) return false;
    if (!status || status === 'all') return true;
    const days = _getDaysUntilDue(b);
    const isPaid = b.lastPaid && b.lastPaid !== '';
    if (status === 'overdue')   return b.active && days < 0;
    if (status === 'due-today') return b.active && days === 0;
    if (status === 'due-week')  return b.active && days >= 0 && days <= 7;
    if (status === 'paid')      return isPaid;
    if (status === 'inactive')  return !b.active;
    return true;
  });

  if (countEl) countEl.textContent = filtered.length || '';

  if (bills.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');

  if (filtered.length === 0) {
    list.innerHTML = '<div class="text-center text-muted py-4 small">No bills match the current filter.</div>';
    return;
  }

  const FREQ_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

  list.innerHTML = `<div class="data-cards-grid">${filtered.map(b => {
    const next       = _nextDueDate(b);
    const nextStr    = next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const daysUntil  = _getDaysUntilDue(b);
    const isPaid     = b.lastPaid && b.lastPaid !== '';
    const isOverdue  = b.active && daysUntil < 0;
    const paidDateStr = isPaid ? new Date(b.lastPaid).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const canPay     = b.active && (!isPaid || daysUntil <= 7);

    // Urgency
    const urgencyBorder = isOverdue ? '#ef4444'
      : daysUntil === 0 ? '#f97316'
      : daysUntil <= 3  ? '#f59e0b'
      : daysUntil <= 7  ? '#0ea5e9'
      : '#e2e8f0';
    const urgencyChipColor = isOverdue ? '#dc2626'
      : daysUntil === 0 ? '#ea580c'
      : daysUntil <= 3  ? '#d97706'
      : daysUntil <= 7  ? '#0284c7'
      : '#64748b';
    const dueLabel = isOverdue
      ? `Overdue by ${Math.abs(daysUntil)}d`
      : daysUntil === 0 ? 'Due today'
      : daysUntil === 1 ? 'Due tomorrow'
      : daysUntil <= 7  ? `Due in ${daysUntil}d`
      : `Due ${nextStr}`;

    // Icon & bg
    const catIcon = _billIcon(b.category);
    const iconBg  = isPaid ? 'linear-gradient(135deg,#10b981,#059669)'
      : isOverdue ? 'linear-gradient(135deg,#ef4444,#f87171)'
      : 'linear-gradient(135deg,#f59e0b,#d97706)';

    // Urgency bar (0–30 day window → 0–100%)
    const urgencyBarPct = isOverdue ? 100
      : Math.max(0, Math.round((1 - daysUntil / 30) * 100));
    const urgencyBarColor = isOverdue ? '#ef4444'
      : daysUntil <= 3 ? '#f97316'
      : daysUntil <= 7 ? '#f59e0b'
      : '#34d399';

    // Frequency label short
    const freqShort = { monthly: '/ mo', quarterly: '/ qtr', yearly: '/ yr' }[b.frequency] ?? '';

    // Pause/resume button — gray for active (pause), green for inactive (resume)
    const toggleIcon  = b.active ? 'bi-pause-fill' : 'bi-play-fill';
    const toggleClass = b.active ? 'bill-toggle-btn--pause' : 'bill-toggle-btn--resume';

    return `
      <div class="ecard ecard--bill${!b.active ? ' ecard--bill-inactive' : isOverdue ? ' ecard--bill-overdue' : daysUntil <= 3 ? ' ecard--bill-urgent' : ''}" style="border-left-color:${urgencyBorder}">
        <div class="ecard-top">
          <div class="ecard-icon" style="background:${iconBg};box-shadow:0 4px 12px rgba(0,0,0,.15)"><i class="bi ${catIcon}"></i></div>
          <div class="ecard-body">
            <div class="ecard-desc">${escapeHtml(b.name)}</div>
            <div class="ecard-badges">
              <span class="ecard-badge ecard-badge--sub">${escapeHtml(b.category)}</span>
              ${!b.active ? '<span class="ecard-badge bill-badge--inactive">Inactive</span>' : ''}
            </div>
          </div>
          <div class="ecard-amount-block">
            <div class="ecard-amount ecard-amount--bill">${formatCurrency(b.amount)}</div>
            <div class="bill-freq-label">${freqShort}</div>
          </div>
        </div>
        <div class="bill-urgency-bar-wrap">
          <div class="bill-urgency-bar" style="width:${urgencyBarPct}%;background:${urgencyBarColor}"></div>
        </div>
        <div class="ecard-footer bill-footer">
          <div class="bill-footer-info">
            <span class="ecard-chip bill-due-chip" style="color:${urgencyChipColor};border-color:${urgencyBorder}25;background:${urgencyBorder}10">
              <i class="bi ${isPaid ? 'bi-check-circle-fill' : isOverdue ? 'bi-exclamation-triangle-fill' : 'bi-calendar-event'} me-1"></i>
              ${isPaid ? `Paid ${paidDateStr}` : dueLabel}
            </span>
            ${b.paymentMethod ? `<span class="ecard-chip"><i class="bi bi-credit-card me-1"></i>${escapeHtml(b.paymentMethod)}</span>` : ''}
          </div>
          <div class="bill-footer-actions">
            ${!isPaid ? `<button class="ecard-btn bill-pay-btn${canPay ? '' : ' disabled'}" data-mark-paid-bill="${escapeHtml(b.id)}" title="Mark as Paid" ${canPay ? '' : 'disabled'}><i class="bi bi-check-circle-fill me-1"></i>Paid</button>` : ''}
            <button class="ecard-btn bill-toggle-btn ${toggleClass}" data-toggle-active-bill="${escapeHtml(b.id)}" title="${b.active ? 'Pause' : 'Resume'}"><i class="bi ${toggleIcon}"></i></button>
            <button class="ecard-btn ecard-btn--edit" data-edit-bill="${escapeHtml(b.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
            <button class="ecard-btn ecard-btn--del bud-del-btn" data-delete-bill="${escapeHtml(b.id)}" title="Delete"><i class="bi bi-trash3-fill"></i></button>
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
  if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Update Bill';
  const titleEl = document.getElementById('oc-bill-label');
  if (titleEl) titleEl.textContent = 'Edit Bill';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-bill')).show();
}

async function _markPaid(id) {
  const bills = store.get('bills') ?? [];
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  const prevLastPaid = bill.lastPaid;
  const today = new Date().toISOString().split('T')[0];
  const updated = bills.map(b => b.id === id ? { ...b, lastPaid: today } : b);
  try {
    await writeAllRows(CONFIG.sheets.bills, updated.map(serialize));
    store.set('bills', updated);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast(`${bill.name} marked as paid`, async () => {
      const current = store.get('bills') ?? [];
      const reverted = current.map(b => b.id === id ? { ...b, lastPaid: prevLastPaid } : b);
      await writeAllRows(CONFIG.sheets.bills, reverted.map(serialize));
      store.set('bills', reverted);
    });
  } catch (err) {
    const errEl = document.getElementById('bills-error-text');
    const banner = document.getElementById('bills-error-banner');
    if (errEl) errEl.textContent = err.message ?? 'Failed to mark as paid.';
    if (banner) banner.classList.remove('d-none');
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

// ─── Filter binding ───────────────────────────────────────────────────────────
function _bindBillFilters() {
  // Search
  const searchEl = document.getElementById('bill-search');
  if (searchEl) {
    let _t;
    searchEl.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _billFilter.search = searchEl.value; render(); }, 220);
    });
  }

  // Status dropdown
  const statusBtn  = document.getElementById('bill-status-btn');
  const statusMenu = document.getElementById('bill-status-menu');
  if (statusBtn && statusMenu) {
    const opts = [
      { val: '',         label: 'All Statuses' },
      { val: 'overdue',  label: '🔴 Overdue' },
      { val: 'due-today',label: '🟠 Due Today' },
      { val: 'due-week', label: '🟡 Due This Week' },
      { val: 'paid',     label: '🟢 Paid' },
      { val: 'inactive', label: '⚫ Inactive' },
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
        _billFilter.status = item.dataset.val;
        statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>${item.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
        statusMenu.classList.remove('fdd-open');
        render();
      });
    });
  }

  // Quick presets
  document.querySelectorAll('[data-bill-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _billFilter.status = btn.dataset.billPreset;
      _billFilter.search = '';
      const searchEl = document.getElementById('bill-search');
      if (searchEl) searchEl.value = '';
      const statusBtn = document.getElementById('bill-status-btn');
      if (statusBtn) statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>${btn.textContent} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      render();
    });
  });
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

  // Bind filters
  _bindBillFilters();

  // Cancel edit
  document.getElementById('bill-cancel-edit')?.addEventListener('click', () => {
    _editingId = null;
    form.reset();
    document.getElementById('bill-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Add Bill';
    const titleEl = document.getElementById('oc-bill-label');
    if (titleEl) titleEl.textContent = 'Add Bill';
  });

  // Reset on modal close
  document.getElementById('oc-bill')?.addEventListener('hidden.bs.modal', () => {
    _editingId = null;
    form.reset();
    document.getElementById('bill-cancel-edit')?.classList.add('d-none');
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Add Bill';
    const titleEl = document.getElementById('oc-bill-label');
    if (titleEl) titleEl.textContent = 'Add Bill';
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
