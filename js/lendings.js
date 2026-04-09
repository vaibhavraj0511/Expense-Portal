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

const filterState = { status: [], type: [] };

function applyFilters(entries) {
  return entries.filter(e => {
    const settlements = store.get('lendingSettlements') ?? [];
    const status = computeStatus(e, settlements);
    if (filterState.status.length > 0 && !filterState.status.includes(status)) return false;
    if (filterState.type.length > 0 && !filterState.type.includes(e.type)) return false;
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
        container.innerHTML = `<div class="lend-list">${slice.map(e => {
          const outstanding = computeOutstanding(e, settlements);
          const status      = computeStatus(e, settlements);
          const isLent      = e.type === 'lent';
          const isSettled   = status === 'settled';

          const statusBadge = isSettled
            ? `<span class="lec-status-badge lec-badge-settled"><i class="bi bi-check-circle-fill me-1"></i>Settled</span>`
            : status === 'partial'
            ? `<span class="lec-status-badge lec-badge-partial"><i class="bi bi-clock-fill me-1"></i>Partial</span>`
            : `<span class="lec-status-badge lec-badge-outstanding"><i class="bi bi-hourglass-split me-1"></i>Outstanding</span>`;

          const typeBadge = isLent
            ? `<span class="lec-type-badge lec-type-lent">I Lent</span>`
            : `<span class="lec-type-badge lec-type-borrowed">I Borrowed</span>`;

          const daysBadge = (() => {
            if (isSettled) return '';
            const days = Math.floor((Date.now() - new Date(e.date).getTime()) / 86400000);
            if (days <= 0) return '';
            const cls = days > 30 ? 'lend-days-overdue' : days > 7 ? 'lend-days-warn' : 'lend-days-ok';
            return `<span class="lend-days-badge ${cls}"><i class="bi bi-hourglass-split me-1"></i>${days}d pending</span>`;
          })();

          return `
          <div class="lec-row ${isSettled ? 'lec-row-settled' : ''}">
            <div class="lec-icon-col">
              <div class="lec-icon ${isLent ? 'lec-icon-lent' : 'lec-icon-borrowed'}">
                <i class="bi ${isLent ? 'bi-arrow-up-right-circle-fill' : 'bi-arrow-down-left-circle-fill'}"></i>
              </div>
            </div>
            <div class="lec-body">
              <div class="lec-top">
                <button class="lec-name btn-link-style" data-counterparty="${escapeHtml(e.counterparty)}">${escapeHtml(e.counterparty)}</button>
                <div class="lec-badges">${typeBadge} ${statusBadge}</div>
                <div class="lec-amount-wrap">
                  <span class="lec-amount ${isLent ? 'lec-amt-lent' : 'lec-amt-borrowed'}">${formatCurrency(outstanding)}</span>
                  ${outstanding < e.amount ? `<span class="lec-amount-original">of ${formatCurrency(e.amount)}</span>` : ''}
                </div>
              </div>
              <div class="lec-chips">
                <span class="lec-chip"><i class="bi bi-calendar3"></i>${formatDate(e.date)}</span>
                ${daysBadge}
                ${e.accountRef ? `<span class="lec-chip"><i class="bi bi-bank2"></i>${escapeHtml(e.accountRef)}</span>` : ''}
                ${e.note ? `<span class="lec-chip lec-chip-note" title="${escapeHtml(e.note)}"><i class="bi bi-chat-left-text"></i>${escapeHtml(e.note.length > 30 ? e.note.slice(0,30)+'…' : e.note)}</span>` : ''}
              </div>
            </div>
            <div class="lec-actions">
              ${!isSettled ? `<button class="btn btn-sm btn-outline-success" data-settle-id="${escapeHtml(e.id)}" title="Record Settlement"><i class="bi bi-check2-circle me-1"></i>Settle</button>` : ''}
              <button class="btn btn-sm btn-outline-danger" data-delete-id="${escapeHtml(e.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
            </div>
          </div>`;
        }).join('')}</div>`;
        container.querySelectorAll('[data-settle-id]').forEach(btn => {
          btn.addEventListener('click', () => _openSettlementModal(btn.dataset.settleId));
        });
        container.querySelectorAll('[data-delete-id]').forEach(btn => {
          btn.addEventListener('click', () => _deleteEntry(btn.dataset.deleteId));
        });
        container.querySelectorAll('[data-counterparty]').forEach(btn => {
          btn.addEventListener('click', () => _openCounterpartyLedger(btn.dataset.counterparty));
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
  rows.sort((a, b) => a.date.localeCompare(b.date));

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

  // Populate modal
  const nameEl = document.getElementById('cl-name');
  const badgeEl = document.getElementById('cl-net-badge');
  const bodyEl = document.getElementById('cl-body');
  if (nameEl) nameEl.textContent = counterparty;
  if (badgeEl) { badgeEl.textContent = netLabel; badgeEl.className = `badge ${netClass} ms-2`; }

  if (bodyEl) {
    if (rowsWithBalance.length === 0) {
      bodyEl.innerHTML = '<p class="text-muted text-center py-3">No transactions found.</p>';
    } else {
      bodyEl.innerHTML = `
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th class="text-end">Amount</th>
                <th class="text-end">Balance</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${rowsWithBalance.map(r => {
                let typeLabel, typeCls, amtCls;
                if (r.type === 'lent') { typeLabel = 'Lent'; typeCls = 'cl-type-lent'; amtCls = 'text-success'; }
                else if (r.type === 'borrowed') { typeLabel = 'Borrowed'; typeCls = 'cl-type-borrowed'; amtCls = 'text-danger'; }
                else { typeLabel = 'Settlement'; typeCls = 'cl-type-settlement'; amtCls = 'text-primary'; }
                const balCls = r.runningBalance > 0 ? 'text-success' : r.runningBalance < 0 ? 'text-danger' : 'text-muted';
                return `<tr>
                  <td class="text-nowrap">${escapeHtml(formatDate(r.date))}</td>
                  <td><span class="cl-type-badge ${typeCls}">${typeLabel}</span></td>
                  <td class="text-end ${amtCls} fw-semibold">${formatCurrency(r.amount)}</td>
                  <td class="text-end ${balCls} fw-semibold">${formatCurrency(Math.abs(r.runningBalance))}</td>
                  <td class="text-muted small">${escapeHtml(r.note)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
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
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  _getPaginator().update(sorted);
  _renderNetSummary(all, settlements);
  _renderCounterpartyNetBalance(all, settlements);

  // Stat cards — show outstanding (unsettled) amounts
  let outstandingLent = 0, outstandingBorrowed = 0, pending = 0;
  all.forEach(e => {
    const outstanding = computeOutstanding(e, settlements);
    if (e.type === 'lent') outstandingLent += outstanding;
    else outstandingBorrowed += outstanding;
    if (outstanding > 0) pending++;
  });
  const el = id => document.getElementById(id);
  if (el('lend-stat-lent'))     el('lend-stat-lent').textContent     = formatCurrency(outstandingLent);
  if (el('lend-stat-borrowed')) el('lend-stat-borrowed').textContent = formatCurrency(outstandingBorrowed);
  if (el('lend-stat-pending'))  el('lend-stat-pending').textContent  = pending;
}

function _renderCounterpartyNetBalance(entries, settlements) {
  const container = document.getElementById('lend-counterparty-summary');
  if (!container) return;

  // Aggregate net position per counterparty
  const netMap = {};
  entries.forEach(e => {
    const outstanding = computeOutstanding(e, settlements);
    if (outstanding <= 0) return;
    if (!netMap[e.counterparty]) netMap[e.counterparty] = 0;
    // lent = they owe me (+), borrowed = I owe them (-)
    netMap[e.counterparty] += e.type === 'lent' ? outstanding : -outstanding;
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
    return `
      <div class="lend-cp-chip" data-counterparty="${escapeHtml(name)}" style="border-color:${color}20;background:${bgColor};cursor:pointer">
        <div class="lend-cp-avatar" style="background:${color}20;color:${color}">
          ${escapeHtml(name.slice(0, 2).toUpperCase())}
        </div>
        <div class="lend-cp-body">
          <div class="lend-cp-name">${escapeHtml(name)}</div>
          <div class="lend-cp-label" style="color:${color}">
            <i class="bi ${icon} me-1"></i>${label}
          </div>
        </div>
        <div class="lend-cp-amount" style="color:${color}">${formatCurrency(Math.abs(Math.round(net)))}</div>
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

// ─── Filter binding ───────────────────────────────────────────────────────────

function _bindFilters() {
  // Status filter dropdown
  const statusBtn  = document.getElementById('lend-status-btn');
  const statusMenu = document.getElementById('lend-status-menu');
  const typeBtn    = document.getElementById('lend-type-btn');
  const typeMenu   = document.getElementById('lend-type-menu');
  const clearBtn   = document.getElementById('lend-clear-filters');

  function toggleDropdown(btn, menu) {
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('fdd-open');
      btn.querySelector('.fdd-chevron')?.classList.toggle('fdd-chevron-up', open);
    });
    document.addEventListener('click', () => {
      menu.classList.remove('fdd-open');
      btn.querySelector('.fdd-chevron')?.classList.remove('fdd-chevron-up');
    });
    menu.addEventListener('click', e => e.stopPropagation());
  }

  toggleDropdown(statusBtn, statusMenu);
  toggleDropdown(typeBtn, typeMenu);

  if (statusMenu) {
    statusMenu.querySelectorAll('.fdd-check').forEach(cb => {
      cb.addEventListener('change', () => {
        filterState.status = Array.from(statusMenu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
        _updateFilterBtnLabel(statusBtn, filterState.status, 'Status');
        render();
      });
    });
  }

  if (typeMenu) {
    typeMenu.querySelectorAll('.fdd-check').forEach(cb => {
      cb.addEventListener('change', () => {
        filterState.type = Array.from(typeMenu.querySelectorAll('.fdd-check:checked')).map(c => c.value);
        _updateFilterBtnLabel(typeBtn, filterState.type, 'Type');
        render();
      });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterState.status = [];
      filterState.type = [];
      statusMenu?.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      typeMenu?.querySelectorAll('.fdd-check').forEach(c => (c.checked = false));
      _updateFilterBtnLabel(statusBtn, [], 'Status');
      _updateFilterBtnLabel(typeBtn, [], 'Type');
      render();
    });
  }
}

function _updateFilterBtnLabel(btn, selected, label) {
  if (!btn) return;
  const n = selected.length;
  btn.innerHTML = n === 0
    ? `<i class="bi bi-funnel me-1"></i>${label} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`
    : `<i class="bi bi-funnel-fill me-1"></i>${label} <span class="fdd-count">${n}</span> <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
  btn.classList.toggle('fdd-active', n > 0);
}

// ─── init() ───────────────────────────────────────────────────────────────────

export async function init() {
  _bindLedgerForm();
  _bindSettlementForm();
  _bindFilters();
  _populateAccountSelect('lending-account');
  _populateAccountSelect('settlement-account');

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
