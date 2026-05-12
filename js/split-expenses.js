// js/split-expenses.js — Group / Split Expense tracker

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate, populatePaymentSelect } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id | description | date | totalAmount | paidBy | participantsJSON | note | lendingIdsJSON | paymentMethod | expenseId

export function serialize(g) {
  return [
    g.id,
    g.description,
    g.date,
    String(g.totalAmount),
    g.paidBy,
    JSON.stringify(g.participants ?? []),
    g.note ?? '',
    JSON.stringify(g.lendingIds ?? []),
    g.paymentMethod ?? '',
    g.expenseId ?? '',
  ];
}

export function deserialize(row) {
  let participants = [];
  let lendingIds   = [];
  try { participants = JSON.parse(row[5] ?? '[]'); } catch { /* ignore */ }
  try { lendingIds   = JSON.parse(row[7] ?? '[]'); } catch { /* ignore */ }
  return {
    id:            row[0] ?? '',
    description:   row[1] ?? '',
    date:          row[2] ?? '',
    totalAmount:   parseFloat(row[3]) || 0,
    paidBy:        row[4] ?? 'me',
    participants,
    note:          row[6] ?? '',
    lendingIds,
    paymentMethod: row[8] ?? '',
    expenseId:     row[9] ?? '',
  };
}

// ─── Filter state ─────────────────────────────────────────────────────────────

const _splitFilter = { search: '', status: '', sort: 'newest' };

// ─── Description → icon map ───────────────────────────────────────────────────

const _DESC_ICONS = [
  [/dinner|lunch|breakfast|food|eat|meal|restaurant|cafe|pizza|burger|snack/i, 'bi-cup-hot-fill',      '#f59e0b'],
  [/hotel|stay|room|accommodation|hostel|airbnb|resort/i,                      'bi-house-fill',        '#8b5cf6'],
  [/cab|taxi|uber|ola|auto|bus|train|metro|flight|travel|transport|petrol/i,   'bi-car-front-fill',    '#3b82f6'],
  [/grocery|groceries|supermarket|market|vegetables/i,                         'bi-basket-fill',       '#10b981'],
  [/movie|cinema|entertainment|game|ticket|event|concert/i,                    'bi-film',              '#6366f1'],
  [/fuel|petrol|diesel|gas/i,                                                  'bi-fuel-pump-fill',    '#f97316'],
  [/shop|shopping|clothes|mall|amazon|flipkart/i,                              'bi-bag-fill',          '#ec4899'],
  [/medical|medicine|doctor|hospital|pharmacy/i,                               'bi-heart-pulse-fill',  '#ef4444'],
];

function _descIcon(description) {
  for (const [re, icon, color] of _DESC_ICONS) {
    if (re.test(description)) return { icon, color };
  }
  return { icon: 'bi-receipt-cutoff', color: '#6366f1' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) { return formatCurrency(Number(n) || 0); }

function _quickSettle(lendingEntryId) {
  const hiddenField = document.getElementById('settlement-entry-id');
  const form        = document.getElementById('settlement-form');
  if (form) form.reset();
  if (hiddenField) hiddenField.value = lendingEntryId;
  const modal = document.getElementById('oc-settlement');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

// ─── Split-specific settle state ─────────────────────────────────────────────
let _pendingSettleLendingId = null;

function _openSplitSettle(lendingEntryId) {
  const lendings    = store.get('lendings')            ?? [];
  const settlements = store.get('lendingSettlements')  ?? [];
  const entry = lendings.find(l => l.id === lendingEntryId);
  if (!entry) return;

  const paid        = settlements.filter(s => s.entryId === lendingEntryId).reduce((s, x) => s + x.amount, 0);
  const outstanding = Math.max(entry.amount - paid, 0);

  _pendingSettleLendingId = lendingEntryId;

  const personEl    = document.getElementById('split-settle-person');
  const amountEl    = document.getElementById('split-settle-amount');
  const hintEl      = document.querySelector('.split-settle-outstanding-hint');
  const dateEl      = document.getElementById('split-settle-date');
  const noteEl      = document.getElementById('split-settle-note');
  const errEl       = document.getElementById('split-settle-error');
  const accountSel  = document.getElementById('split-settle-account');

  if (personEl)  personEl.value  = entry.counterparty;
  if (amountEl)  amountEl.value  = outstanding.toFixed(2);
  if (hintEl)    hintEl.textContent = `Outstanding: ${formatCurrency(outstanding)}`;
  if (dateEl)    dateEl.value    = new Date().toISOString().slice(0, 10);
  if (noteEl)    noteEl.value    = '';
  if (errEl)     errEl.classList.add('d-none');

  // Populate account dropdown
  if (accountSel) {
    populatePaymentSelect(
      accountSel,
      store.get('accounts')    ?? [],
      store.get('creditCards') ?? [],
      'Select account to receive into…'
    );
  }

  bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-split-settle')).show();
}

async function _markSettledCash(lendingEntryId) {
  const lendings    = store.get('lendings')           ?? [];
  const settlements = store.get('lendingSettlements') ?? [];
  const entry = lendings.find(l => l.id === lendingEntryId);
  if (!entry) return;

  const paid        = settlements.filter(s => s.entryId === lendingEntryId).reduce((s, x) => s + x.amount, 0);
  const outstanding = Math.max(entry.amount - paid, 0);
  if (outstanding <= 0) return;

  const confirmed = await epConfirm(
    `Mark ${entry.counterparty}'s share as settled?`,
    `This records ${formatCurrency(outstanding)} as settled without updating any account balance (cash/external payment).`
  );
  if (!confirmed) return;

  const { serializeSettlement, deserializeSettlement } = await import('./lendings.js');
  const settlement = {
    id:           crypto.randomUUID(),
    entryId:      lendingEntryId,
    amount:       outstanding,
    date:         new Date().toISOString().slice(0, 10),
    accountRef:   '',
    mirroredTxId: '',
    note:         'Settled (cash/external)',
  };
  await appendRow(CONFIG.sheets.lendingSettlements, serializeSettlement(settlement));
  const rows = await fetchRows(CONFIG.sheets.lendingSettlements);
  store.set('lendingSettlements', rows.map(deserializeSettlement));
  render();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('split-groups-list');
  const empty     = document.getElementById('split-groups-empty');
  if (!container) return;

  const groups      = store.get('splitGroups') ?? [];
  const lendings    = store.get('lendings')    ?? [];
  const settlements = store.get('lendingSettlements') ?? [];

  // ── Stats
  const totalAmount  = groups.reduce((s, g) => s + g.totalAmount, 0);
  const uniquePeople = new Set(groups.flatMap(g => g.participants.filter(p => !p.isYou).map(p => p.name))).size;
  const _isGroupPending = g => g.lendingIds?.some(lid => {
    const entry = lendings.find(l => l.id === lid);
    if (!entry) return false;
    const settled = settlements.filter(s => s.entryId === lid).reduce((sum, s) => sum + s.amount, 0);
    return Math.max(entry.amount - settled, 0) > 0;
  });
  const pending = groups.filter(_isGroupPending).length;

  const _s = el => document.getElementById(el);
  if (_s('split-stat-count'))   _s('split-stat-count').textContent   = groups.length;
  if (_s('split-stat-total'))   _s('split-stat-total').textContent   = fmt(totalAmount);
  if (_s('split-stat-pending')) _s('split-stat-pending').textContent = pending;
  if (_s('split-stat-people'))  _s('split-stat-people').textContent  = uniquePeople;

  // ── Hero subtitle
  const heroSub = _s('split-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = groups.length
      ? `<strong style="color:rgba(255,255,255,.95)">${pending}</strong> pending &nbsp;·&nbsp; <strong style="color:rgba(255,255,255,.95)">${fmt(totalAmount)}</strong> total split`
      : 'Split bills with friends &amp; track who owes what';
  }

  if (groups.length === 0) {
    container.innerHTML = '';
    empty?.classList.remove('d-none');
    return;
  }
  empty?.classList.add('d-none');

  // ── Filter + sort
  const search  = _splitFilter.search.toLowerCase();
  const statusF = _splitFilter.status;

  let filtered = groups.filter(g => {
    if (search && !g.description.toLowerCase().includes(search) &&
        !g.participants.some(p => p.name.toLowerCase().includes(search))) return false;
    if (statusF === 'pending' && !_isGroupPending(g)) return false;
    if (statusF === 'settled' &&  _isGroupPending(g)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (_splitFilter.sort === 'oldest')  return a.date.localeCompare(b.date);
    if (_splitFilter.sort === 'highest') return b.totalAmount - a.totalAmount;
    return b.date.localeCompare(a.date);
  });

  // ── Count badge
  const badge = _s('split-count-badge');
  if (badge) badge.textContent = filtered.length || '';

  // ── Reset button
  const resetBtn = _s('split-reset-filters');
  if (resetBtn) resetBtn.classList.toggle('d-none', !search && !statusF);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="ep-empty-state" style="padding:1.5rem">
      <div class="ep-es-title">No splits match your filters</div>
      <div class="ep-es-subtitle">Try clearing the filters.</div>
    </div>`;
    return;
  }

  // ── Group pending / settled
  const pendingGroups = filtered.filter(g =>  _isGroupPending(g));
  const settledGroups = filtered.filter(g => !_isGroupPending(g));

  const pendingHtml = pendingGroups.map(g => _renderGroupCard(g, lendings, settlements)).join('');
  const dividerHtml = pendingGroups.length && settledGroups.length
    ? `<div class="split-settled-divider"><span><i class="bi bi-check-circle-fill me-1"></i>Settled &mdash; ${settledGroups.length} ${settledGroups.length === 1 ? 'split' : 'splits'}</span></div>`
    : '';
  const settledHtml = settledGroups.map(g => _renderGroupCard(g, lendings, settlements)).join('');

  container.innerHTML = pendingHtml + dividerHtml + settledHtml;

  container.querySelectorAll('.split-card-del[data-delete-split]').forEach(btn =>
    btn.addEventListener('click', () => _deleteGroup(btn.dataset.deleteSplit)));
  container.querySelectorAll('.split-ppill-settle--account[data-settle-lid]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); _openSplitSettle(btn.dataset.settleLid); }));
  container.querySelectorAll('.split-ppill-settle--cash[data-settle-cash]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); _markSettledCash(btn.dataset.settleCash); }));
}

function _renderGroupCard(g, lendings, settlements) {
  const youPaid = g.paidBy === 'me';
  const total   = g.totalAmount;
  const allParticipants = g.participants;

  // ── Participant rows with entryId + outstanding
  const participantRows = allParticipants.map(p => {
    if (p.isYou) {
      if (youPaid) return { ...p, status: 'you-paid', entryId: null };
      const entry = lendings.find(l => g.lendingIds.includes(l.id) && l.type === 'borrowed');
      if (!entry) return { ...p, status: 'outstanding', entryId: null };
      const paid = settlements.filter(s => s.entryId === entry.id).reduce((sum, s) => sum + s.amount, 0);
      const outstanding = Math.max(entry.amount - paid, 0);
      return { ...p, outstanding, entryId: entry.id, status: outstanding === 0 ? 'settled' : (paid > 0 ? 'partial' : 'outstanding') };
    }
    const entry = lendings.find(l => g.lendingIds.includes(l.id) && l.counterparty === p.name);
    if (!entry) return { ...p, status: 'outstanding', entryId: null };
    const paid = settlements.filter(s => s.entryId === entry.id).reduce((sum, s) => sum + s.amount, 0);
    const outstanding = Math.max(entry.amount - paid, 0);
    return { ...p, outstanding, entryId: entry.id, status: outstanding === 0 ? 'settled' : (paid > 0 ? 'partial' : 'outstanding') };
  });

  // ── Settled state
  const settleable = participantRows.filter(p => !(p.isYou && youPaid));
  const allSettled  = settleable.every(p => p.status === 'settled');
  const settledCnt  = settleable.filter(p => p.status === 'settled').length;
  const progressPct = settleable.length > 0 ? Math.round((settledCnt / settleable.length) * 100) : 0;
  const barColor    = progressPct === 100 ? '#10b981' : progressPct >= 50 ? '#f59e0b' : '#ef4444';

  // ── Dynamic icon
  const { icon: descIcon, color: iconColor } = _descIcon(g.description);
  const iconGrad = allSettled
    ? 'linear-gradient(135deg,#10b981,#34d399)'
    : `linear-gradient(135deg,${iconColor},${iconColor}cc)`;

  // ── Status badge
  const statusBadge = allSettled
    ? `<span class="badge bg-success-subtle text-success rounded-pill" style="font-size:.68rem;font-weight:700"><i class="bi bi-check-circle-fill me-1"></i>Settled</span>`
    : `<span class="badge bg-warning-subtle text-warning-emphasis rounded-pill" style="font-size:.68rem;font-weight:700"><i class="bi bi-clock me-1"></i>Pending</span>`;

  // ── Who-paid badge
  const whoPaidBadge = youPaid
    ? `<span class="split-card-whopaid split-card-whopaid--you"><i class="bi bi-person-check-fill me-1"></i>You paid</span>`
    : `<span class="split-card-whopaid split-card-whopaid--other"><i class="bi bi-person-fill me-1"></i>${esc(g.paidBy)} paid</span>`;

  // ── Person pill grid
  const persons = participantRows.map(p => {
    const status  = p.status ?? 'outstanding';
    const label   = p.isYou ? 'You' : esc(p.name);
    const initials = (p.isYou ? 'ME' : (p.name || '?').slice(0, 2).toUpperCase());
    const showRemaining = status === 'partial' && p.outstanding != null;
    const amountLine = showRemaining
      ? `${fmt(p.outstanding)} left`
      : status === 'you-paid'
      ? 'Paid'
      : status === 'settled'
      ? 'Settled'
      : fmt(p.share);
    const canSettle = p.entryId && (status === 'outstanding' || status === 'partial');
    const settleBtn = canSettle
      ? `<div class="split-ppill-settle-row">
           <button class="split-ppill-settle split-ppill-settle--account" data-settle-lid="${esc(p.entryId)}" title="Settle via account"><i class="bi bi-bank2 me-1"></i>Settle</button>
           <button class="split-ppill-settle split-ppill-settle--cash" data-settle-cash="${esc(p.entryId)}" title="Mark settled (cash/external)"><i class="bi bi-cash-coin me-1"></i>Cash</button>
         </div>`
      : '';
    return `<div class="split-ppill split-ppill--${status}">
      <div class="split-ppill-avatar">${initials}</div>
      <div class="split-ppill-body">
        <div class="split-ppill-name">${label}</div>
        <div class="split-ppill-amount">${amountLine}</div>
      </div>
      ${settleBtn}
    </div>`;
  }).join('');

  // ── Meta row
  const metaNote = g.note ? ` <i class="bi bi-chat-left-text"></i> ${esc(g.note)}` : '';
  const metaHtml = `<span class="split-card-meta-left">
    <i class="bi bi-calendar3"></i>${formatDate(g.date)}
    &nbsp;&middot;&nbsp;
    <i class="bi bi-people-fill"></i>${allParticipants.length} people${metaNote}
  </span>${whoPaidBadge}`;

  // ── Progress row (badge + bar + text) — only when not fully settled
  const progressHtml = !allSettled
    ? `<div class="split-progress-row">
        ${statusBadge}
        <div class="split-progress-bar"><div class="split-progress-fill" style="width:${progressPct}%;background:${barColor}"></div></div>
        <span class="split-progress-text">${settledCnt}/${settleable.length} settled</span>
      </div>`
    : `<div class="split-settled-row">${statusBadge}</div>`;

  return `
  <div class="split-card${allSettled ? ' split-card--settled' : ''}">
    <div class="split-card-header">
      <div class="split-card-icon" style="background:${iconGrad};box-shadow:0 3px 8px ${iconColor}44"><i class="bi ${descIcon}"></i></div>
      <div class="split-card-desc" title="${esc(g.description)}">${esc(g.description)}</div>
      <div class="split-card-amount">${fmt(total)}</div>
      <button class="split-card-del" data-delete-split="${esc(g.id)}" title="Delete"><i class="bi bi-trash3"></i></button>
    </div>
    <div class="split-card-meta">${metaHtml}</div>
    ${progressHtml}
    <div class="split-person-grid">${persons}</div>
  </div>`;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _deleteGroup(id) {
  const confirmed = await epConfirm(
    'Delete this split?',
    'This will also delete all linked lending entries created by this split.'
  );
  if (!confirmed) return;

  const groups    = store.get('splitGroups') ?? [];
  const group     = groups.find(g => g.id === id);
  if (!group) return;

  // Remove linked lending entries
  if (group.lendingIds?.length) {
    const lendings = (store.get('lendings') ?? []).filter(l => !group.lendingIds.includes(l.id));
    try {
      const { serialize: sLend } = await import('./lendings.js');
      await writeAllRows(CONFIG.sheets.lendings, lendings.map(sLend));
      store.set('lendings', lendings);
    } catch (e) { console.warn('[split] could not remove linked lendings', e); }
  }

  // Remove the group itself
  const updated = groups.filter(g => g.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.splitExpenses, updated.map(serialize));
    store.set('splitGroups', updated);
  } catch (e) { console.warn('[split] could not delete group', e); }

  render();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let _participantCount = 0;

function _openModal() {
  _participantCount = 0;
  const form = document.getElementById('split-form');
  if (form) form.reset();
  const wrap = document.getElementById('split-participants-wrap');
  wrap.innerHTML = '';
  document.getElementById('split-error').classList.add('d-none');
  document.getElementById('split-date').value = new Date().toISOString().split('T')[0];
  // Always add locked "You" row first
  _addYouRow();
  // Add 2 default friend rows
  _addParticipantRow();
  _addParticipantRow();
  _updatePaidByOptions();
  _updateEqualSplit();
  // Populate payment method dropdown
  _refreshPaymentMethodDropdown();
  _togglePaymentMethodVisibility();
}

function _addYouRow(share = '') {
  const wrap = document.getElementById('split-participants-wrap');
  const row  = document.createElement('div');
  row.className = 'split-p-row d-flex gap-2 align-items-center mb-2';
  row.dataset.isYou = 'true';
  row.innerHTML = `
    <div class="form-control form-control-sm d-flex align-items-center gap-2" style="background:#f0f4ff;border-color:#c7d2fe;cursor:default">
      <i class="bi bi-person-fill text-primary" style="font-size:.85rem"></i>
      <span class="fw-semibold text-primary" style="font-size:.85rem">You</span>
      <span class="badge bg-primary-subtle text-primary ms-1" style="font-size:.7rem">Me</span>
    </div>
    <input type="number" class="form-control form-control-sm split-p-share" placeholder="₹ Your share" value="${share}" min="0" step="1" />
    <button type="button" class="acc-action-btn acc-action-del split-p-remove" title="Remove yourself from this split"><i class="bi bi-x-lg"></i></button>`;
  row.querySelector('.split-p-share').addEventListener('input', () => {
    document.getElementById('split-equal').checked = false;
  });
  row.querySelector('.split-p-remove').addEventListener('click', () => {
    row.remove();
    _updatePaidByOptions();
    _updateEqualSplit();
  });
  wrap.appendChild(row);
}

function _addParticipantRow(name = '', share = '') {
  _participantCount++;
  const wrap = document.getElementById('split-participants-wrap');
  const row  = document.createElement('div');
  row.className = 'split-p-row d-flex gap-2 align-items-center mb-2';
  row.innerHTML = `
    <input type="text"   class="form-control form-control-sm split-p-name"  placeholder="Friend's name" value="${esc(name)}" />
    <input type="number" class="form-control form-control-sm split-p-share" placeholder="₹ Share" value="${share}" min="0" step="1" />
    <button type="button" class="acc-action-btn acc-action-del split-p-remove" title="Remove"><i class="bi bi-x-lg"></i></button>`;
  row.querySelector('.split-p-remove').addEventListener('click', () => {
    row.remove();
    _updatePaidByOptions();
    _updateEqualSplit();
  });
  row.querySelector('.split-p-name').addEventListener('input', () => {
    _updatePaidByOptions();
  });
  row.querySelector('.split-p-share').addEventListener('input', () => {
    document.getElementById('split-equal').checked = false;
  });
  wrap.appendChild(row);
  _updatePaidByOptions();
}

function _refreshPaymentMethodDropdown() {
  const sel = document.getElementById('split-payment-method');
  if (!sel) return;
  populatePaymentSelect(
    sel,
    store.get('accounts')    ?? [],
    store.get('creditCards') ?? [],
    'Select account / card…'
  );
}

function _togglePaymentMethodVisibility() {
  const paidBy = document.getElementById('split-paid-by')?.value;
  const wrap   = document.getElementById('split-payment-method-wrap');
  if (wrap) wrap.style.display = paidBy === 'me' ? '' : 'none';
}

function _updatePaidByOptions() {
  const sel   = document.getElementById('split-paid-by');
  const friendNames = [...document.querySelectorAll('#split-participants-wrap .split-p-name')]
    .map(i => i.value.trim()).filter(Boolean);
  const cur   = sel.value;
  sel.innerHTML = `<option value="me">Me (You)</option>` +
    friendNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function _updateEqualSplit() {
  const totalInput = document.getElementById('split-total-amount');
  const total      = parseFloat(totalInput?.value) || 0;
  // All rows including the locked "You" row
  const allRows = [...document.querySelectorAll('#split-participants-wrap .split-p-row')];
  if (total <= 0 || allRows.length === 0) return;
  const perPerson = +(total / allRows.length).toFixed(2);
  allRows.forEach(row => {
    row.querySelector('.split-p-share').value = perPerson;
  });
}

async function _handleCreate() {
  const errEl = document.getElementById('split-error');
  errEl.classList.add('d-none');

  const description = document.getElementById('split-description').value.trim();
  const date        = document.getElementById('split-date').value;
  const totalAmount = parseFloat(document.getElementById('split-total-amount').value) || 0;
  const paidBy      = document.getElementById('split-paid-by').value;
  const note        = document.getElementById('split-note').value.trim();

  const pRows = [...document.querySelectorAll('#split-participants-wrap .split-p-row')];
  const participants = pRows.map(row => {
    const isYou = row.dataset.isYou === 'true';
    return {
      name:  isYou ? 'You' : row.querySelector('.split-p-name').value.trim(),
      share: parseFloat(row.querySelector('.split-p-share').value) || 0,
      isYou,
    };
  }).filter(p => p.name);

  // Validation
  const errors = [];
  const friends  = participants.filter(p => !p.isYou);
  const youEntry = participants.find(p => p.isYou);
  if (!description)            errors.push('Description is required.');
  if (!date)                   errors.push('Date is required.');
  if (totalAmount <= 0)        errors.push('Total amount must be greater than zero.');
  if (friends.length === 0)    errors.push('Add at least one friend to split with.');
  if (friends.some(p => !p.name))   errors.push('All friend names are required.');
  if (participants.some(p => p.share <= 0)) errors.push('All shares must be greater than zero.');
  const shareSum = participants.reduce((s, p) => s + p.share, 0);
  if (Math.abs(shareSum - totalAmount) > 0.10) errors.push(`Shares total ${fmt(shareSum)} but bill is ${fmt(totalAmount)}. Make sure all shares add up to the total.`);

  if (errors.length) {
    errEl.textContent = errors[0];
    errEl.classList.remove('d-none');
    return;
  }

  const id  = crypto.randomUUID();
  const lendingIds = [];

  // Import lendings serializer dynamically
  const { serialize: sLend, deserialize: dLend } = await import('./lendings.js');

  if (paidBy === 'me') {
    // ── Create expense entry for the full bill amount ──────────────────────
    const paymentMethod = document.getElementById('split-payment-method')?.value?.trim() ?? '';
    if (!paymentMethod) {
      errEl.textContent = 'Please select the account / card you paid from.';
      errEl.classList.remove('d-none');
      return;
    }

    const { serialize: sExp, deserialize: dExp } = await import('./expenses.js');
    const expRecord = {
      date,
      category:      'Split Expense',
      subCategory:   '',
      amount:        totalAmount,
      description:   description,
      paymentMethod,
      tags:          ['split'],
    };
    await appendRow(CONFIG.sheets.expenses, sExp(expRecord));
    const expRows = await fetchRows(CONFIG.sheets.expenses);
    const expRecords = expRows.map(dExp);
    store.set('expenses', expRecords);

    // Store the expense index as expenseId (last matching record)
    const matches = expRecords.map((r, i) => ({ ...r, _idx: i }))
      .filter(r => r.description === description && r.amount === totalAmount && r.date === date && r.paymentMethod === paymentMethod);
    const expenseId = matches.length > 0 ? String(matches[matches.length - 1]._idx) : '';

    // ── Create lending entries for each friend's share ─────────────────────
    for (const p of friends) {
      const lendId = crypto.randomUUID();
      lendingIds.push(lendId);
      const entry = {
        id:           lendId,
        type:         'lent',
        counterparty: p.name,
        amount:       p.share,
        date,
        accountRef:   paymentMethod,
        mirroredTxId: '',
        note:         `Split: ${description}`,
      };
      await appendRow(CONFIG.sheets.lendings, sLend(entry));
    }

    // Reload lendings into store
    try {
      const rows = await fetchRows(CONFIG.sheets.lendings);
      store.set('lendings', rows.map(dLend));
    } catch { /* ignore */ }

    // Save the split group
    const group = { id, description, date, totalAmount, paidBy, participants, note, lendingIds, paymentMethod, expenseId };
    await appendRow(CONFIG.sheets.splitExpenses, serialize(group));
    const groups = [...(store.get('splitGroups') ?? []), group];
    store.set('splitGroups', groups);

  } else {
    // A friend paid — you owe them your share → create "borrowed" entry
    const myShare = youEntry?.share ?? 0;
    if (myShare > 0) {
      const lendId = crypto.randomUUID();
      lendingIds.push(lendId);
      const entry = {
        id:           lendId,
        type:         'borrowed',
        counterparty: paidBy,
        amount:       myShare,
        date,
        accountRef:   '',
        mirroredTxId: '',
        note:         `Split: ${description}`,
      };
      await appendRow(CONFIG.sheets.lendings, sLend(entry));
    }

    // Reload lendings into store
    try {
      const rows = await fetchRows(CONFIG.sheets.lendings);
      store.set('lendings', rows.map(dLend));
    } catch { /* ignore */ }

    // Save the split group
    const group = { id, description, date, totalAmount, paidBy, participants, note, lendingIds, paymentMethod: '', expenseId: '' };
    await appendRow(CONFIG.sheets.splitExpenses, serialize(group));
    const groups = [...(store.get('splitGroups') ?? []), group];
    store.set('splitGroups', groups);
  }

  // Close modal
  const modal = bootstrap.Modal.getInstance(document.getElementById('oc-split-expense'));
  modal?.hide();

  render();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function init() {
  // Load split groups from sheet
  try {
    const rows = await fetchRows(CONFIG.sheets.splitExpenses);
    store.set('splitGroups', rows.map(deserialize));
  } catch { /* sheet may not exist yet — starts empty */ }

  render();

  // Bind modal open
  const modalEl = document.getElementById('oc-split-expense');
  if (modalEl) {
    modalEl.addEventListener('show.bs.modal', _openModal);
  }

  // Bind add participant
  document.getElementById('split-add-participant')?.addEventListener('click', () => {
    _addParticipantRow();
  });

  // Bind equal split toggle
  document.getElementById('split-equal')?.addEventListener('change', e => {
    if (e.target.checked) _updateEqualSplit();
  });
  document.getElementById('split-total-amount')?.addEventListener('input', () => {
    if (document.getElementById('split-equal')?.checked) _updateEqualSplit();
  });
  document.getElementById('split-paid-by')?.addEventListener('change', () => {
    if (document.getElementById('split-equal')?.checked) _updateEqualSplit();
    _togglePaymentMethodVisibility();
  });

  // Bind confirm button
  document.getElementById('split-confirm-btn')?.addEventListener('click', _handleCreate);

  // ── Settle via Account confirm ──────────────────────────────────────────────
  document.getElementById('split-settle-confirm')?.addEventListener('click', async () => {
    const errEl     = document.getElementById('split-settle-error');
    const amountEl  = document.getElementById('split-settle-amount');
    const accountEl = document.getElementById('split-settle-account');
    const dateEl    = document.getElementById('split-settle-date');
    const noteEl    = document.getElementById('split-settle-note');

    errEl?.classList.add('d-none');

    const amount  = parseFloat(amountEl?.value) || 0;
    const account = accountEl?.value?.trim() ?? '';
    const date    = dateEl?.value ?? new Date().toISOString().slice(0, 10);
    const note    = noteEl?.value?.trim() ?? '';

    if (amount <= 0)  { if (errEl) { errEl.textContent = 'Amount must be greater than zero.'; errEl.classList.remove('d-none'); } return; }
    if (!account)     { if (errEl) { errEl.textContent = 'Please select an account to receive into.'; errEl.classList.remove('d-none'); } return; }
    if (!_pendingSettleLendingId) return;

    const { serializeSettlement, deserializeSettlement } = await import('./lendings.js');

    // Create settlement record
    const settlement = {
      id:           crypto.randomUUID(),
      entryId:      _pendingSettleLendingId,
      amount,
      date,
      accountRef:   account,
      mirroredTxId: '',
      note:         note || 'Split settlement',
    };
    await appendRow(CONFIG.sheets.lendingSettlements, serializeSettlement(settlement));

    // Create income entry (money received back into account)
    const { serialize: sInc, deserialize: dInc } = await import('./income.js');
    const lendings = store.get('lendings') ?? [];
    const entry    = lendings.find(l => l.id === _pendingSettleLendingId);
    const incRecord = {
      date,
      source:      'Lending',
      amount,
      description: `Split repayment from ${entry?.counterparty ?? 'friend'}`,
      receivedIn:  account,
    };
    await appendRow(CONFIG.sheets.income, sInc(incRecord));
    const incRows = await fetchRows(CONFIG.sheets.income);
    store.set('income', incRows.map(dInc));

    // Reload settlements
    const settleRows = await fetchRows(CONFIG.sheets.lendingSettlements);
    store.set('lendingSettlements', settleRows.map(deserializeSettlement));

    _pendingSettleLendingId = null;
    bootstrap.Modal.getInstance(document.getElementById('oc-split-settle'))?.hide();
    render();
  });

  // Bind search
  document.getElementById('split-search')?.addEventListener('input', e => {
    _splitFilter.search = e.target.value.trim();
    render();
  });

  // Bind preset filter buttons
  document.querySelectorAll('[data-split-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _splitFilter.status = btn.dataset.splitPreset;
      document.querySelectorAll('[data-split-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  // Bind sort
  document.getElementById('split-sort')?.addEventListener('change', e => {
    _splitFilter.sort = e.target.value;
    render();
  });

  // Bind reset
  document.getElementById('split-reset-filters')?.addEventListener('click', () => {
    _splitFilter.search = '';
    _splitFilter.status = '';
    const searchEl = document.getElementById('split-search');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('[data-split-preset]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-split-preset=""]')?.classList.add('active');
    render();
  });

  // Re-render when lendings settle
  store.on('lendingSettlements', () => render());
  store.on('lendings',           () => render());
}
