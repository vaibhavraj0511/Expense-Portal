// js/lendings.js — Lending & Borrowing ledger module

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatDate, formatCurrency } from './utils.js';
import { createPaginator } from './paginate.js';
import { epConfirm } from './confirm.js';
import { serialize as serializeExpense, deserialize as deserializeExpense } from './expenses.js';
import { serialize as serializeIncome, deserialize as deserializeIncome } from './income.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// LedgerEntry columns: A=id, B=type, C=counterparty, D=amount, E=date, F=accountRef, G=mirroredTxId, H=note

export function serialize(r) {
  return [r.id, r.type, r.counterparty, String(r.amount), r.date, r.accountRef ?? '', r.mirroredTxId ?? '', r.note ?? ''];
}

export function deserialize(row) {
  return {
    id:           row[0] ?? '',
    type:         row[1] ?? '',
    counterparty: row[2] ?? '',
    amount:       parseFloat(row[3]) || 0,
    date:         row[4] ?? '',
    accountRef:   row[5] ?? '',
    mirroredTxId: row[6] ?? '',
    note:         row[7] ?? '',
  };
}

// Settlement columns: A=id, B=entryId, C=amount, D=date, E=accountRef, F=mirroredTxId, G=note
export function serializeSettlement(r) {
  return [r.id, r.entryId, String(r.amount), r.date, r.accountRef ?? '', r.mirroredTxId ?? '', r.note ?? ''];
}

export function deserializeSettlement(row) {
  return {
    id:           row[0] ?? '',
    entryId:      row[1] ?? '',
    amount:       parseFloat(row[2]) || 0,
    date:         row[3] ?? '',
    accountRef:   row[4] ?? '',
    mirroredTxId: row[5] ?? '',
    note:         row[6] ?? '',
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function computeOutstanding(entry, settlements) {
  const settled = settlements
    .filter(s => s.entryId === entry.id)
    .reduce((sum, s) => sum + s.amount, 0);
  return Math.max(entry.amount - settled, 0);
}

export function computeStatus(entry, settlements) {
  const outstanding = computeOutstanding(entry, settlements);
  if (outstanding === 0) return 'settled';
  if (outstanding < entry.amount) return 'partial';
  return 'outstanding';
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateEntry(entry) {
  const errors = [];
  if (!entry.counterparty?.trim()) errors.push({ field: 'lending-counterparty', msg: 'Counterparty name is required.' });
  if (!entry.date) errors.push({ field: 'lending-date', msg: 'Date is required.' });
  const amt = parseFloat(entry.amount);
  if (!entry.amount || isNaN(amt) || amt <= 0) errors.push({ field: 'lending-amount', msg: 'Amount must be a positive number.' });
  return { valid: errors.length === 0, errors };
}

export function validateSettlement(settlement, entry, existingSettlements) {
  const errors = [];
  if (!settlement.date) errors.push({ field: 'settlement-date', msg: 'Date is required.' });
  const amt = parseFloat(settlement.amount);
  if (!settlement.amount || isNaN(amt) || amt <= 0) {
    errors.push({ field: 'settlement-amount', msg: 'Amount must be a positive number.' });
  } else {
    const outstanding = computeOutstanding(entry, existingSettlements);
    if (amt > outstanding) errors.push({ field: 'settlement-amount', msg: `Amount cannot exceed outstanding balance (${formatCurrency(outstanding)}).` });
  }
  return { valid: errors.length === 0, errors };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('is-invalid');
  let fb = field.nextElementSibling;
  if (!fb || !fb.classList.contains('invalid-feedback')) {
    fb = document.createElement('div');
    fb.className = 'invalid-feedback';
    field.insertAdjacentElement('afterend', fb);
  }
  fb.textContent = message;
}

function clearFieldErrors(formEl) {
  formEl.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

function showModalError(bannerId, message) {
  const el = document.getElementById(bannerId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('d-none');
}

function hideModalError(bannerId) {
  const el = document.getElementById(bannerId);
  if (el) el.classList.add('d-none');
}

function _populateAccountSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const accounts    = store.get('accounts')    ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const allOptions  = [
    ...accounts.map(a => ({ name: a.name, group: 'Accounts' })),
    ...creditCards.map(c => ({ name: c.name, group: 'Credit Cards' })),
  ];
  if (allOptions.length === 0) {
    sel.closest('.mb-3')?.classList.add('d-none');
    return;
  }
  sel.closest('.mb-3')?.classList.remove('d-none');
  const cur = sel.value;
  const accOpts = accounts.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  const ccOpts  = creditCards.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  sel.innerHTML = '<option value="">No account (no balance change)</option>' +
    (accOpts ? `<optgroup label="Accounts">${accOpts}</optgroup>` : '') +
    (ccOpts  ? `<optgroup label="Credit Cards">${ccOpts}</optgroup>`  : '');
  if (cur) sel.value = cur;
}

// ─── Mirrored transactions ────────────────────────────────────────────────────

async function _writeMirroredTx({ entryType, isSettlement, amount, date, accountRef, counterparty }) {
  if (!accountRef) return '';
  // Determine direction:
  // lent entry → expense (money left account)
  // borrowed entry → income (money entered account)
  // settlement on lent → income (money returned)
  // settlement on borrowed → expense (money paid back)
  let id;
  if ((!isSettlement && entryType === 'lent') || (isSettlement && entryType === 'borrowed')) {
    // Write to expenses
    id = crypto.randomUUID();
    const cat = isSettlement ? 'Borrowing' : 'Lending';
    const desc = isSettlement ? `Repaid to ${counterparty}` : `Lent to ${counterparty}`;
    const row = serializeExpense({ date, category: cat, subCategory: '', amount, description: desc, paymentMethod: accountRef });
    // Prepend id as first column — expenses schema doesn't have id, so we store it in description prefix
    // Actually expenses.js serialize doesn't include id. We need to track by appending a special row.
    // We'll use a workaround: store the mirrored record in expenses with a unique description marker.
    // But expenses.js deserialize doesn't have id. We'll use writeAllRows approach instead.
    // Simpler: append the row and then re-fetch to find the last matching record.
    await appendRow(CONFIG.sheets.expenses, row);
    const rows = await fetchRows(CONFIG.sheets.expenses);
    const records = rows.map(deserializeExpense);
    store.set('expenses', records);
    // Find the last record matching our description (most recently appended)
    const matches = records.map((r, i) => ({ ...r, _idx: i }))
      .filter(r => r.description === desc && r.amount === amount && r.date === date && r.paymentMethod === accountRef);
    id = matches.length > 0 ? String(matches[matches.length - 1]._idx) : '';
  } else {
    // Write to income
    id = crypto.randomUUID();
    const src = isSettlement ? 'Lending' : 'Borrowing';
    const desc = isSettlement ? `Repayment from ${counterparty}` : `Borrowed from ${counterparty}`;
    const row = serializeIncome({ date, source: src, amount, description: desc, receivedIn: accountRef });
    await appendRow(CONFIG.sheets.income, row);
    const rows = await fetchRows(CONFIG.sheets.income);
    const records = rows.map(deserializeIncome);
    store.set('income', records);
    const matches = records.map((r, i) => ({ ...r, _idx: i }))
      .filter(r => r.description === desc && r.amount === amount && r.date === date && r.receivedIn === accountRef);
    id = matches.length > 0 ? String(matches[matches.length - 1]._idx) : '';
  }
  return id;
}

async function _deleteMirroredTx(mirroredTxId, entryType, isSettlement) {
  if (!mirroredTxId) return;
  const idx = parseInt(mirroredTxId);
  if (isNaN(idx)) { console.warn('[lendings] mirroredTxId not found:', mirroredTxId); return; }

  const usesExpenses = (!isSettlement && entryType === 'lent') || (isSettlement && entryType === 'borrowed');
  if (usesExpenses) {
    const records = [...(store.get('expenses') ?? [])];
    if (idx < 0 || idx >= records.length) { console.warn('[lendings] mirroredTxId out of range:', idx); return; }
    records.splice(idx, 1);
    try {
      await writeAllRows(CONFIG.sheets.expenses, records.map(serializeExpense));
      store.set('expenses', records);
    } catch (err) { console.warn('[lendings] failed to delete mirrored expense:', err); }
  } else {
    const records = [...(store.get('income') ?? [])];
    if (idx < 0 || idx >= records.length) { console.warn('[lendings] mirroredTxId out of range:', idx); return; }
    records.splice(idx, 1);
    try {
      await writeAllRows(CONFIG.sheets.income, records.map(serializeIncome));
      store.set('income', records);
    } catch (err) { console.warn('[lendings] failed to delete mirrored income:', err); }
  }
}

// ─── Filter state ─────────────────────────────────────────────────────────────

const filterState = { status: '', type: '', search: '', sort: 'amount-desc' };

function applyFilters(entries) {
  const settlements = store.get('lendingSettlements') ?? [];
  return entries.filter(e => {
    const status = computeStatus(e, settlements);
    if (filterState.status && status !== filterState.status) return false;
    if (filterState.type   && e.type  !== filterState.type)   return false;
    if (filterState.search && !e.counterparty.toLowerCase().includes(filterState.search.toLowerCase())) return false;
    return true;
  });
}

// ─── Paginator ────────────────────────────────────────────────────────────────

let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'lending-cards',
      paginationId: 'lending-pagination',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('lending-cards');
        const emptyState = document.getElementById('lending-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        const settlements = store.get('lendingSettlements') ?? [];

        const unsettledSlice = slice.filter(p => p.overallStatus !== 'settled');
        const settledSlice   = slice.filter(p => p.overallStatus === 'settled');

        function renderLendCard(person) {
          const { name, entries, net, hasUnsettled, lastDate, overallStatus, pendingDays } = person;
          const isSettled = overallStatus === 'settled';
          const isOwed    = net > 0;

          const iconStyle = isSettled
            ? 'background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 4px 12px rgba(16,185,129,.3)'
            : isOwed
            ? 'background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 4px 12px rgba(239,68,68,.3)'
            : 'background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 4px 12px rgba(245,158,11,.3)';

          const initials = (name || '?').slice(0, 2).toUpperCase();

          const statusBadge = isSettled
            ? `<span class="ecard-badge" style="background:rgba(16,185,129,.1);color:#059669"><i class="bi bi-check-circle-fill me-1"></i>Settled</span>`
            : overallStatus === 'partial'
            ? `<span class="ecard-badge" style="background:rgba(245,158,11,.1);color:#d97706">Partial</span>`
            : `<span class="ecard-badge ecard-badge--expense">Outstanding</span>`;

          const dirBadge = entries.some(e => e.type === 'lent') && entries.some(e => e.type === 'borrowed')
            ? `<span class="ecard-badge ecard-badge--sub">Both</span>`
            : entries[0].type === 'lent'
            ? `<span class="ecard-badge ecard-badge--sub">I Lent</span>`
            : `<span class="ecard-badge ecard-badge--sub">I Borrowed</span>`;

          const entryCount = `<span class="ecard-badge ecard-badge--sub">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>`;

          const netLabel = isSettled ? 'All settled' : isOwed
            ? `They owe ${formatCurrency(Math.abs(net))}`
            : `I owe ${formatCurrency(Math.abs(net))}`;
          const netColor = isSettled ? '#10b981' : isOwed ? '#dc2626' : '#d97706';

          const daysBadge = !isSettled && pendingDays > 0
            ? `<span class="ecard-chip" style="color:${pendingDays > 30 ? '#dc2626' : pendingDays > 7 ? '#d97706' : '#94a3b8'}"><i class="bi bi-hourglass-split"></i>${pendingDays}d pending</span>`
            : '';

          const unsettledEntries = entries.filter(e => computeStatus(e, settlements) !== 'settled');
          const unsettledCount   = unsettledEntries.length;

          return `
          <div class="ecard lend-people-card${isSettled ? ' lend-card--settled' : ''}">
            <div class="ecard-top" style="cursor:pointer" data-open-ledger="${escapeHtml(name)}">
              <div class="ecard-icon" style="${iconStyle}">${initials}</div>
              <div class="ecard-body">
                <div class="ecard-desc">${escapeHtml(name)}</div>
                <div class="ecard-badges">${statusBadge}${dirBadge}${entryCount}</div>
              </div>
              <div class="ecard-amount ${isSettled ? '' : isOwed ? 'ecard-amount--expense' : 'ecard-amount--bill'}">
                ${isSettled ? '<i class="bi bi-check-circle-fill" style="color:#10b981"></i>' : formatCurrency(Math.abs(net))}
              </div>
            </div>
            <div class="ecard-footer">
              <span class="ecard-chip"><i class="bi bi-calendar3"></i>${formatDate(lastDate)}</span>
              ${daysBadge}
              <div class="ecard-actions" style="opacity:1;pointer-events:auto">
                <button class="ecard-btn" data-open-ledger="${escapeHtml(name)}" title="View Full Ledger" style="color:#6366f1"><i class="bi bi-eye-fill"></i></button>
                ${hasUnsettled && unsettledEntries[0] ? `
                  <span class="lend-unsettled-chip">${unsettledCount}</span>
                  <button class="ecard-btn" data-settle-id="${escapeHtml(unsettledEntries[0].id)}" title="Record Settlement" style="color:#10b981"><i class="bi bi-check2-circle"></i></button>` : ''}
              </div>
            </div>
          </div>`;
        }

        const unsettledHtml = unsettledSlice.length
          ? `<div class="data-cards-grid">${unsettledSlice.map(renderLendCard).join('')}</div>` : '';
        const dividerHtml = settledSlice.length && unsettledSlice.length
          ? `<div class="lend-settled-divider"><span><i class="bi bi-check-circle-fill me-1"></i>Settled &mdash; ${settledSlice.length} ${settledSlice.length === 1 ? 'person' : 'people'}</span></div>` : '';
        const settledHtml = settledSlice.length
          ? `<div class="data-cards-grid">${settledSlice.map(renderLendCard).join('')}</div>` : '';

        container.innerHTML = unsettledHtml + dividerHtml + settledHtml;
        container.querySelectorAll('[data-open-ledger]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            if (e.target.closest('[data-settle-id]')) return;
            _openCounterpartyLedger(btn.dataset.openLedger);
          });
        });
        container.querySelectorAll('[data-settle-id]').forEach(btn => {
          btn.addEventListener('click', (e) => { e.stopPropagation(); _openSettlementModal(btn.dataset.settleId); });
        });
      },
    });
  }
  return _paginator;
}

// ─── Counterparty Ledger ──────────────────────────────────────────────────────

function _openCounterpartyLedger(counterparty) {
  const allEntries = store.get('lendings') ?? [];
  const allSettlements = store.get('lendingSettlements') ?? [];

  // Filter entries for this counterparty
  const entries = allEntries.filter(e => e.counterparty === counterparty);
  const entryIds = new Set(entries.map(e => e.id));
  const settlements = allSettlements.filter(s => entryIds.has(s.entryId));

  // Build chronological transaction list with running balance
  // lent = positive (they owe us), borrowed = negative (we owe them)
  const rows = [];
  entries.forEach(e => {
    rows.push({ date: e.date, type: e.type === 'lent' ? 'lent' : 'borrowed', amount: e.amount, note: e.note ?? '', entryId: e.id });
  });
  settlements.forEach(s => {
    const entry = entries.find(e => e.id === s.entryId);
    rows.push({ date: s.date, type: 'settlement', amount: s.amount, note: s.note ?? '', entryId: s.entryId, entryType: entry?.type });
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));

  // Compute running balance: lent +, borrowed -, settlement reverses the direction
  let balance = 0;
  const rowsWithBalance = rows.map(r => {
    if (r.type === 'lent') balance += r.amount;
    else if (r.type === 'borrowed') balance -= r.amount;
    else {
      // settlement: if original entry was lent, money comes back (balance decreases); if borrowed, we paid back (balance increases)
      if (r.entryType === 'lent') balance -= r.amount;
      else balance += r.amount;
    }
    return { ...r, runningBalance: balance };
  });

  // Net balance badge
  const netAbs = Math.abs(balance);
  let netLabel, netClass;
  if (balance > 0) { netLabel = `Owed ${formatCurrency(netAbs)}`; netClass = 'bg-success-subtle text-success-emphasis'; }
  else if (balance < 0) { netLabel = `Owes ${formatCurrency(netAbs)}`; netClass = 'bg-danger-subtle text-danger-emphasis'; }
  else { netLabel = 'Settled'; netClass = 'bg-secondary-subtle text-secondary-emphasis'; }

  // Avatar gradient: green = they owe me, amber = I owe them, indigo = settled
  const avatarGrad = balance > 0
    ? 'linear-gradient(135deg,#10b981,#059669)'
    : balance < 0
    ? 'linear-gradient(135deg,#f59e0b,#d97706)'
    : 'linear-gradient(135deg,#6366f1,#818cf8)';
  const avatarInitials = (counterparty || '?').slice(0, 2).toUpperCase();

  // Populate modal
  const nameEl   = document.getElementById('cl-name');
  const badgeEl  = document.getElementById('cl-net-badge');
  const bodyEl   = document.getElementById('cl-body');
  const avatarEl = document.getElementById('cl-modal-avatar');
  if (nameEl)   nameEl.textContent = counterparty;
  if (badgeEl)  { badgeEl.textContent = netLabel; badgeEl.className = `badge ${netClass} ms-2`; }
  if (avatarEl) { avatarEl.textContent = avatarInitials; avatarEl.style.background = avatarGrad; }

  if (bodyEl) {
    if (rowsWithBalance.length === 0) {
      bodyEl.innerHTML = '<p class="text-muted text-center py-3">No transactions found.</p>';
    } else {
      bodyEl.innerHTML = `<div class="lend-ledger-list">${rowsWithBalance.map(r => {
      let typeLabel, typeColor, typeBg, icon;
      if (r.type === 'lent')       { typeLabel='Lent';       typeColor='#059669'; typeBg='#dcfce7'; icon='bi-arrow-up-right'; }
      else if (r.type === 'borrowed') { typeLabel='Borrowed'; typeColor='#dc2626'; typeBg='#fee2e2'; icon='bi-arrow-down-left'; }
      else                          { typeLabel='Settlement'; typeColor='#6366f1'; typeBg='#ede9fe'; icon='bi-arrow-left-right'; }
      const balColor = r.runningBalance > 0 ? '#059669' : r.runningBalance < 0 ? '#dc2626' : '#94a3b8';
      const balLabel = r.runningBalance === 0 ? 'Settled' : formatCurrency(Math.abs(r.runningBalance));
      return `
      <div class="lend-tx-row">
        <div class="lend-tx-icon" style="background:${typeBg};color:${typeColor}"><i class="bi ${icon}"></i></div>
        <div class="lend-tx-body">
          <div class="lend-tx-top">
            <span class="lend-tx-chip" style="background:${typeBg};color:${typeColor}">${typeLabel}</span>
            ${r.note ? `<span class="lend-tx-note">${escapeHtml(r.note)}</span>` : ''}
          </div>
          <div class="lend-tx-date">${escapeHtml(formatDate(r.date))}</div>
        </div>
        <div class="lend-tx-amounts">
          <div class="lend-tx-amount" style="color:${typeColor}">${formatCurrency(r.amount)}</div>
          <div class="lend-tx-balance" style="color:${balColor}">${balLabel}</div>
        </div>
      </div>`;
    }).join('')}</div>`;
    }
  }

  const modal = document.getElementById('counterparty-ledger-modal');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

// ─── Type Ledger (stat card click) ────────────────────────────────────────────

function _openTypeLedger(type) {
  const allEntries    = store.get('lendings')            ?? [];
  const allSettlements = store.get('lendingSettlements') ?? [];

  let entries, title, badgeCls;
  if (type === 'lent') {
    entries  = allEntries.filter(e => e.type === 'lent');
    title    = "I'm Owed";
    badgeCls = 'bg-success-subtle text-success-emphasis';
  } else if (type === 'borrowed') {
    entries  = allEntries.filter(e => e.type === 'borrowed');
    title    = 'I Owe';
    badgeCls = 'bg-danger-subtle text-danger-emphasis';
  } else if (type === 'net') {
    entries  = allEntries;
    title    = 'Net Position';
    badgeCls = 'bg-primary-subtle text-primary-emphasis';
  } else {
    entries  = allEntries.filter(e => computeOutstanding(e, allSettlements) > 0);
    title    = 'Pending Entries';
    badgeCls = 'bg-warning-subtle text-warning-emphasis';
  }

  const total = entries.reduce((sum, e) => sum + computeOutstanding(e, allSettlements), 0);

  const nameEl  = document.getElementById('cl-name');
  const badgeEl = document.getElementById('cl-net-badge');
  const bodyEl  = document.getElementById('cl-body');
  if (nameEl)  nameEl.textContent = title;
  if (badgeEl) { badgeEl.textContent = formatCurrency(total); badgeEl.className = `badge ${badgeCls} ms-2`; }

  if (bodyEl) {
    if (entries.length === 0) {
      bodyEl.innerHTML = '<p class="text-muted text-center py-3">No entries found.</p>';
    } else {
      // Net outstanding per person, sorted highest first
      const personMap = {};
      entries.forEach(e => {
        const out = computeOutstanding(e, allSettlements);
        if (!personMap[e.counterparty]) personMap[e.counterparty] = 0;
        personMap[e.counterparty] += e.type === 'lent' ? out : -out;
      });
      const amtCls  = type === 'borrowed' ? 'text-danger' : 'text-success';
      const people  = Object.entries(personMap).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const listHtml = people.map(([name, net]) => `
        <div class="d-flex align-items-center justify-content-between px-3 py-2" style="border-bottom:1px solid #f1f5f9">
          <span class="fw-semibold">${escapeHtml(name)}</span>
          <span class="fw-bold ${amtCls}">${formatCurrency(Math.abs(net))}</span>
        </div>`).join('');
      const noteColor = type === 'borrowed' ? '#ef4444' : '#10b981';
      const noteText  = type === 'borrowed'
        ? 'This is the total amount you still owe till date, after deducting your repayments.'
        : 'This is the total amount still owed to you till date, after deducting repayments received.';
      bodyEl.innerHTML = `
        <div class="px-3 py-2 mb-1" style="background:${noteColor}10;border-left:3px solid ${noteColor};border-radius:0 6px 6px 0;font-size:.75rem;color:#64748b">
          <i class="bi bi-info-circle me-1" style="color:${noteColor}"></i>${noteText}
        </div>
        <div class="py-1">${listHtml}</div>`;
    }
  }

  const modal = document.getElementById('counterparty-ledger-modal');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

// ─── render() ────────────────────────────────────────────────────────────────

export function render() {
  const all = store.get('lendings') ?? [];
  const settlements = store.get('lendingSettlements') ?? [];
  const filtered = applyFilters(all);

  // Group filtered entries by counterparty → people-first view
  const peopleMap = {};
  filtered.forEach(e => {
    if (!peopleMap[e.counterparty]) peopleMap[e.counterparty] = [];
    peopleMap[e.counterparty].push(e);
  });

  const people = Object.entries(peopleMap).map(([name, entries]) => {
    const netLent     = entries.filter(e => e.type === 'lent').reduce((s, e) => s + computeOutstanding(e, settlements), 0);
    const netBorrowed = entries.filter(e => e.type === 'borrowed').reduce((s, e) => s + computeOutstanding(e, settlements), 0);
    const net         = netLent - netBorrowed;
    const hasUnsettled = entries.some(e => computeStatus(e, settlements) !== 'settled');
    const lastDate    = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0].date;
    const allSettled  = entries.every(e => computeStatus(e, settlements) === 'settled');
    const anyPartial  = entries.some(e => computeStatus(e, settlements) === 'partial');
    const overallStatus = allSettled ? 'settled' : anyPartial ? 'partial' : 'outstanding';
    const pendingDays = hasUnsettled
      ? Math.floor((Date.now() - new Date(entries.filter(e => computeStatus(e, settlements) !== 'settled')[0]?.date ?? lastDate).getTime()) / 86400000)
      : 0;
    return { name, entries, net, hasUnsettled, lastDate, overallStatus, pendingDays };
  }).sort((a, b) => {
    switch (filterState.sort) {
      case 'name':       return a.name.localeCompare(b.name);
      case 'overdue':    return b.pendingDays - a.pendingDays;
      case 'amount-asc': return Math.abs(a.net) - Math.abs(b.net);
      default:
        if (a.overallStatus !== 'settled' && b.overallStatus === 'settled') return -1;
        if (a.overallStatus === 'settled' && b.overallStatus !== 'settled') return 1;
        return Math.abs(b.net) - Math.abs(a.net);
    }
  });

  const countEl = document.getElementById('lending-count');
  if (countEl) countEl.textContent = people.length + (people.length === 1 ? ' person' : ' people');

  _getPaginator().update(people);
  _renderNetSummary(all, settlements);
  _renderCounterpartyNetBalance(all, settlements);

  // Stat cards — net per person (same logic as People Summary grid)
  const netMap = {};
  let pending = 0;
  all.forEach(e => {
    const outstanding = computeOutstanding(e, settlements);
    if (outstanding > 0) pending++;
    if (!netMap[e.counterparty]) netMap[e.counterparty] = 0;
    netMap[e.counterparty] += e.type === 'lent' ? outstanding : -outstanding;
  });
  let iAmOwed = 0, iOwe = 0;
  Object.values(netMap).forEach(net => {
    if (net > 0) iAmOwed += net;
    else if (net < 0) iOwe += Math.abs(net);
  });
  const el = id => document.getElementById(id);
  if (el('lend-stat-lent'))     el('lend-stat-lent').textContent     = formatCurrency(iAmOwed);
  if (el('lend-stat-borrowed')) el('lend-stat-borrowed').textContent = formatCurrency(iOwe);
  if (el('lend-stat-pending'))  el('lend-stat-pending').textContent  = pending;

  // Net position card
  const netPos = iAmOwed - iOwe;
  if (el('lend-stat-net'))     el('lend-stat-net').textContent  = formatCurrency(Math.abs(netPos));
  if (el('lend-stat-net-sub')) el('lend-stat-net-sub').textContent = netPos > 0 ? 'Net creditor' : netPos < 0 ? 'Net debtor' : 'Balanced';
  const netCard = el('lend-stat-net-card');
  if (netCard) {
    const tint = netPos > 0 ? 'green' : netPos < 0 ? 'red' : 'purple';
    netCard.className = `sec-stat-card sec-stat-card--tint-${tint}`;
    netCard.style.cursor = 'pointer';
  }
  const netIcon = el('lend-stat-net-icon');
  if (netIcon) {
    const [c1, c2] = netPos > 0 ? ['#10b981','#34d399'] : netPos < 0 ? ['#ef4444','#f87171'] : ['#6366f1','#818cf8'];
    netIcon.style.background = `linear-gradient(135deg,${c1},${c2})`;
  }

  // Hero subtitle
  const heroSub = el('lend-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = all.length
      ? `<strong style="color:rgba(255,255,255,.95)">${pending}</strong> pending ${pending === 1 ? 'entry' : 'entries'} &nbsp;&middot;&nbsp; <strong style="color:rgba(255,255,255,.95)">${formatCurrency(iAmOwed)}</strong> owed to you`
      : 'Track money you lent or borrowed';
  }
}

function _renderCounterpartyNetBalance(entries, settlements) {
  const container = document.getElementById('lend-counterparty-summary');
  if (!container) return;

  // Aggregate net position + outstanding entry count per counterparty
  const netMap   = {};
  const countMap = {};
  entries.forEach(e => {
    const outstanding = computeOutstanding(e, settlements);
    if (outstanding <= 0) return;
    if (!netMap[e.counterparty])   netMap[e.counterparty]   = 0;
    if (!countMap[e.counterparty]) countMap[e.counterparty] = 0;
    netMap[e.counterparty]   += e.type === 'lent' ? outstanding : -outstanding;
    countMap[e.counterparty] += 1;
  });

  const people = Object.entries(netMap).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  if (people.length === 0) {
    container.innerHTML = '<p class="text-muted small mb-0">No outstanding balances.</p>';
    return;
  }

  container.innerHTML = `<div class="lend-cp-grid">${people.map(([name, net]) => {
    const positive  = net > 0;
    const color     = positive ? '#10b981' : '#ef4444';
    const bgColor   = positive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
    const icon      = positive ? 'bi-arrow-down-left-circle-fill' : 'bi-arrow-up-right-circle-fill';
    const label     = positive ? 'owes you' : 'you owe';
    const cnt       = countMap[name] ?? 0;
    return `
      <div class="lend-cp-chip" data-counterparty="${escapeHtml(name)}" style="border-color:${color}20;background:${bgColor};cursor:pointer">
        <div class="lend-cp-avatar" style="background:${color}20;color:${color}">
          ${escapeHtml(name.slice(0, 2).toUpperCase())}
        </div>
        <div class="lend-cp-body">
          <div class="lend-cp-name">${escapeHtml(name)}</div>
          <div class="lend-cp-row">
            <span class="lend-cp-label" style="color:${color}"><i class="bi ${icon} me-1"></i>${label}</span>
            <span class="lend-cp-amount" style="color:${color}">${formatCurrency(Math.abs(Math.round(net)))}</span>
          </div>
          <div class="lend-cp-count">${cnt} ${cnt === 1 ? 'entry' : 'entries'}</div>
        </div>
      </div>`;
  }).join('')}</div>`;

  container.querySelectorAll('[data-counterparty]').forEach(chip => {
    chip.addEventListener('click', () => _openCounterpartyLedger(chip.dataset.counterparty));
  });
}

function _renderNetSummary(entries, settlements) {
  let totalOwed = 0, totalOwe = 0;
  entries.forEach(e => {
    const outstanding = computeOutstanding(e, settlements);
    if (e.type === 'lent') totalOwed += outstanding;
    else totalOwe += outstanding;
  });
  const owedEl = document.getElementById('lend-total-owed');
  const oweEl  = document.getElementById('lend-total-owe');
  if (owedEl) owedEl.textContent = formatCurrency(totalOwed);
  if (oweEl)  oweEl.textContent  = formatCurrency(totalOwe);
}

// ─── Settlement modal opener ──────────────────────────────────────────────────

function _openSettlementModal(entryId) {
  const hiddenField = document.getElementById('settlement-entry-id');
  if (hiddenField) hiddenField.value = entryId;
  const form = document.getElementById('settlement-form');
  if (form) form.reset();
  if (hiddenField) hiddenField.value = entryId; // reset clears it
  hideModalError('settlement-error-banner');
  _populateAccountSelect('settlement-account');
  const modal = document.getElementById('oc-settlement');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

// ─── Form binding ─────────────────────────────────────────────────────────────

function _bindLedgerForm() {
  const form = document.getElementById('lending-form');
  if (!form) return;

  store.on('accounts', () => _populateAccountSelect('lending-account'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideModalError('lending-error-banner');
    clearFieldErrors(form);

    const type         = form.querySelector('#lending-type')?.value ?? '';
    const counterparty = form.querySelector('#lending-counterparty')?.value?.trim() ?? '';
    const amount       = form.querySelector('#lending-amount')?.value?.trim() ?? '';
    const date         = form.querySelector('#lending-date')?.value ?? '';
    const accountRef   = form.querySelector('#lending-account')?.value ?? '';
    const note         = form.querySelector('#lending-note')?.value?.trim() ?? '';

    const result = validateEntry({ counterparty, amount, date });
    if (!result.valid) {
      result.errors.forEach(err => showFieldError(err.field, err.msg));
      return;
    }

    const id = crypto.randomUUID();
    let mirroredTxId = '';
    try {
      if (accountRef) {
        mirroredTxId = await _writeMirroredTx({
          entryType: type, isSettlement: false,
          amount: parseFloat(amount), date, accountRef, counterparty,
        });
      }
      const record = { id, type, counterparty, amount: parseFloat(amount), date, accountRef, mirroredTxId, note };
      await appendRow(CONFIG.sheets.lendings, serialize(record));
      const rows = await fetchRows(CONFIG.sheets.lendings);
      store.set('lendings', rows.map(deserialize).filter(r => r.id));
      form.reset();
      const modal = document.getElementById('oc-lending');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showModalError('lending-error-banner', err.message ?? 'Failed to save. Please try again.');
    }
  });
}

function _bindSettlementForm() {
  const form = document.getElementById('settlement-form');
  if (!form) return;

  store.on('accounts', () => _populateAccountSelect('settlement-account'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideModalError('settlement-error-banner');
    clearFieldErrors(form);

    const entryId    = form.querySelector('#settlement-entry-id')?.value ?? '';
    const amount     = form.querySelector('#settlement-amount')?.value?.trim() ?? '';
    const date       = form.querySelector('#settlement-date')?.value ?? '';
    const accountRef = form.querySelector('#settlement-account')?.value ?? '';
    const note       = form.querySelector('#settlement-note')?.value?.trim() ?? '';

    const entries = store.get('lendings') ?? [];
    const entry = entries.find(e => e.id === entryId);
    if (!entry) { showModalError('settlement-error-banner', 'Entry not found.'); return; }

    const existingSettlements = store.get('lendingSettlements') ?? [];
    const result = validateSettlement({ amount, date }, entry, existingSettlements);
    if (!result.valid) {
      result.errors.forEach(err => showFieldError(err.field, err.msg));
      return;
    }

    const id = crypto.randomUUID();
    let mirroredTxId = '';
    try {
      if (accountRef) {
        mirroredTxId = await _writeMirroredTx({
          entryType: entry.type, isSettlement: true,
          amount: parseFloat(amount), date, accountRef, counterparty: entry.counterparty,
        });
      }
      const record = { id, entryId, amount: parseFloat(amount), date, accountRef, mirroredTxId, note };
      await appendRow(CONFIG.sheets.lendingSettlements, serializeSettlement(record));
      const rows = await fetchRows(CONFIG.sheets.lendingSettlements);
      store.set('lendingSettlements', rows.map(deserializeSettlement).filter(r => r.id));
      form.reset();
      const modal = document.getElementById('oc-settlement');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showModalError('settlement-error-banner', err.message ?? 'Failed to save settlement. Please try again.');
    }
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function _deleteEntry(id) {
  if (!await epConfirm('Delete this entry and all its settlements?', 'Delete Entry', 'Delete')) return;

  const entries = store.get('lendings') ?? [];
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  const allSettlements = store.get('lendingSettlements') ?? [];
  const entrySettlements = allSettlements.filter(s => s.entryId === id);
  const remainingSettlements = allSettlements.filter(s => s.entryId !== id);

  try {
    // Store deleted mirrored transaction IDs for undo
    const deletedMirroredTxIds = [];
    
    // Delete mirrored transactions for settlements
    for (const s of entrySettlements) {
      if (s.mirroredTxId) {
        deletedMirroredTxIds.push({ id: s.mirroredTxId, type: entry.type, isSettlement: true });
        await _deleteMirroredTx(s.mirroredTxId, entry.type, true);
      }
    }
    // Delete mirrored transaction for entry
    if (entry.mirroredTxId) {
      deletedMirroredTxIds.push({ id: entry.mirroredTxId, type: entry.type, isSettlement: false });
      await _deleteMirroredTx(entry.mirroredTxId, entry.type, false);
    }

    // Remove settlements from sheet
    await writeAllRows(CONFIG.sheets.lendingSettlements, remainingSettlements.map(serializeSettlement));
    store.set('lendingSettlements', remainingSettlements);

    // Remove entry from sheet
    const remainingEntries = entries.filter(e => e.id !== id);
    await writeAllRows(CONFIG.sheets.lendings, remainingEntries.map(serialize));
    store.set('lendings', remainingEntries);
    
    // Show undo toast (Note: Undo for lendings is complex due to mirrored transactions, so we show a simpler message)
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Lending entry deleted', async () => {
      const currentEntries = [...(store.get('lendings') ?? []), entry];
      const currentSettlements = [...(store.get('lendingSettlements') ?? []), ...entrySettlements];
      await writeAllRows(CONFIG.sheets.lendings, currentEntries.map(serialize));
      await writeAllRows(CONFIG.sheets.lendingSettlements, currentSettlements.map(serializeSettlement));
      store.set('lendings', currentEntries);
      store.set('lendingSettlements', currentSettlements);
      // Note: Mirrored transactions are not restored on undo to avoid complexity
    });
  } catch (err) {
    const banner = document.getElementById('lend-page-error');
    if (banner) { banner.textContent = err.message ?? 'Failed to delete.'; banner.classList.remove('d-none'); }
  }
}

// ─── Filter binding ─────────────────────────────────────────────────────────────

function _updateLendResetBtn() {
  const btn = document.getElementById('lend-clear-filters');
  if (!btn) return;
  btn.classList.toggle('d-none', !(filterState.search || filterState.status || filterState.type || filterState.sort !== 'amount-desc'));
}

function _bindFilters() {
  // Search
  const searchEl = document.getElementById('lend-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      filterState.search = searchEl.value.trim();
      _updateLendResetBtn();
      render();
    });
  }

  // Status preset buttons
  document.querySelectorAll('[data-lend-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterState.status = btn.dataset.lendStatus;
      document.querySelectorAll('[data-lend-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _updateLendResetBtn();
      render();
    });
  });

  // Type preset buttons
  document.querySelectorAll('[data-lend-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      filterState.type = btn.dataset.lendType;
      document.querySelectorAll('[data-lend-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _updateLendResetBtn();
      render();
    });
  });

  // Sort
  const sortEl = document.getElementById('lend-sort');
  if (sortEl) {
    sortEl.addEventListener('change', () => {
      filterState.sort = sortEl.value;
      _updateLendResetBtn();
      render();
    });
  }

  // Clear
  const clearBtn = document.getElementById('lend-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterState.status = ''; filterState.type = ''; filterState.search = ''; filterState.sort = 'amount-desc';
      const si = document.getElementById('lend-search'); if (si) si.value = '';
      const so = document.getElementById('lend-sort');   if (so) so.value = 'amount-desc';
      document.querySelectorAll('[data-lend-status]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-lend-status=""]')?.classList.add('active');
      document.querySelectorAll('[data-lend-type]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-lend-type=""]')?.classList.add('active');
      _updateLendResetBtn();
      render();
    });
  }
}

// ─── init() ───────────────────────────────────────────────────────────────────

export async function init() {
  _bindLedgerForm();
  _bindSettlementForm();
  _bindFilters();
  _populateAccountSelect('lending-account');
  _populateAccountSelect('settlement-account');

  // People Summary collapsible toggle
  const summaryToggle = document.getElementById('lend-summary-toggle');
  const summaryBody   = document.getElementById('lend-counterparty-summary');
  if (summaryToggle && summaryBody) {
    summaryToggle.addEventListener('click', () => {
      const isCollapsed = summaryBody.classList.toggle('d-none');
      summaryToggle.classList.toggle('collapsed', isCollapsed);
      summaryToggle.title = isCollapsed ? 'Expand' : 'Collapse';
    });
  }

  // Stat cards — click to view full history
  [
    ['lend-stat-lent-card',      'lent'],
    ['lend-stat-borrowed-card',  'borrowed'],
    ['lend-stat-pending-card',   'pending'],
    ['lend-stat-net-card',       'net'],
  ].forEach(([id, type]) => {
    const card = document.getElementById(id);
    if (card) card.addEventListener('click', () => _openTypeLedger(type));
  });

  store.on('accounts',    () => { _populateAccountSelect('lending-account'); _populateAccountSelect('settlement-account'); });
  store.on('creditCards', () => { _populateAccountSelect('lending-account'); _populateAccountSelect('settlement-account'); });
  store.on('lendings', render);
  store.on('lendingSettlements', render);

  try {
    const [lendRows, settlRows] = await Promise.all([
      fetchRows(CONFIG.sheets.lendings),
      fetchRows(CONFIG.sheets.lendingSettlements),
    ]);
    const allLendings     = lendRows.map(deserialize).filter(r => r.id);
    const allSettlements  = settlRows.map(deserializeSettlement).filter(r => r.id);
    const twoYearsAgo     = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const filteredLendings = allLendings.filter(l => {
      const totalSettled = allSettlements
        .filter(s => s.entryId === l.id)
        .reduce((sum, s) => sum + s.amount, 0);
      const completed = totalSettled >= l.amount;
      const isOld     = l.date ? new Date(l.date) < twoYearsAgo : false;
      return !(completed && isOld);
    });
    store.set('lendings', filteredLendings);
    store.set('lendingSettlements', allSettlements);
  } catch (err) {
    console.error('[lendings] init fetch failed:', err);
    store.set('lendings', []);
    store.set('lendingSettlements', []);
    render();
  }
}
