// js/split-expenses.js — Group / Split Expense tracker

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id | description | date | totalAmount | paidBy | participantsJSON | note | lendingIdsJSON

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
  ];
}

export function deserialize(row) {
  let participants = [];
  let lendingIds   = [];
  try { participants = JSON.parse(row[5] ?? '[]'); } catch { /* ignore */ }
  try { lendingIds   = JSON.parse(row[7] ?? '[]'); } catch { /* ignore */ }
  return {
    id:          row[0] ?? '',
    description: row[1] ?? '',
    date:        row[2] ?? '',
    totalAmount: parseFloat(row[3]) || 0,
    paidBy:      row[4] ?? 'me',
    participants,
    note:        row[6] ?? '',
    lendingIds,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) { return formatCurrency(Number(n) || 0); }

// ─── Rendering ────────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('split-groups-list');
  const empty     = document.getElementById('split-groups-empty');
  if (!container) return;

  const groups      = store.get('splitGroups') ?? [];
  const lendings    = store.get('lendings')    ?? [];
  const settlements = store.get('lendingSettlements') ?? [];

  // Stat cards
  const totalAmount = groups.reduce((s, g) => s + g.totalAmount, 0);
  const pending = groups.filter(g => {
    return g.lendingIds?.some(lid => {
      const entry = lendings.find(l => l.id === lid);
      if (!entry) return false;
      const settled = settlements.filter(s => s.entryId === lid).reduce((sum, s) => sum + s.amount, 0);
      return Math.max(entry.amount - settled, 0) > 0;
    });
  }).length;
  const _s = el => document.getElementById(el);
  if (_s('split-stat-count'))   _s('split-stat-count').textContent   = groups.length;
  if (_s('split-stat-total'))   _s('split-stat-total').textContent   = fmt(totalAmount);
  if (_s('split-stat-pending')) _s('split-stat-pending').textContent = pending;

  if (groups.length === 0) {
    container.innerHTML = '';
    empty?.classList.remove('d-none');
    return;
  }
  empty?.classList.add('d-none');

  container.innerHTML = groups
    .slice()
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .map(g => _renderGroupCard(g, lendings, settlements))
    .join('');

  container.querySelectorAll('[data-delete-split]').forEach(btn => {
    btn.addEventListener('click', () => _deleteGroup(btn.dataset.deleteSplit));
  });
}

function _renderGroupCard(g, lendings, settlements) {
  const youPaid = g.paidBy === 'me';
  const total   = g.totalAmount;

  // All participants includes "You" (isYou:true) plus friends
  const allParticipants = g.participants; // saved with isYou flag

  // Compute per-participant settlement status via linked lending entries
  const participantRows = allParticipants.map(p => {
    if (p.isYou) {
      // Your own settlement status depends on paidBy
      if (youPaid) return { ...p, status: 'you-paid' };
      // You owe the payer — check the borrowed entry
      const entry = lendings.find(l =>
        g.lendingIds.includes(l.id) && l.type === 'borrowed'
      );
      if (!entry) return { ...p, status: 'outstanding' };
      const settled = settlements
        .filter(s => s.entryId === entry.id)
        .reduce((sum, s) => sum + s.amount, 0);
      const outstanding = Math.max(entry.amount - settled, 0);
      return { ...p, outstanding, status: outstanding === 0 ? 'settled' : (settled > 0 ? 'partial' : 'outstanding') };
    }
    const entry = lendings.find(l =>
      g.lendingIds.includes(l.id) && l.counterparty === p.name
    );
    if (!entry) return { ...p, status: 'outstanding' };
    const settled = settlements
      .filter(s => s.entryId === entry.id)
      .reduce((sum, s) => sum + s.amount, 0);
    const outstanding = Math.max(entry.amount - settled, 0);
    return { ...p, outstanding, status: outstanding === 0 ? 'settled' : (settled > 0 ? 'partial' : 'outstanding') };
  });

  const allSettled = participantRows
    .filter(p => !p.isYou || !youPaid)
    .every(p => p.status === 'settled' || p.status === 'you-paid');

  const statusBadge = allSettled
    ? `<span class="badge bg-success-subtle text-success rounded-pill">Settled</span>`
    : `<span class="badge bg-warning-subtle text-warning rounded-pill">Pending</span>`;

  const participantHtml = participantRows.map(p => {
    let statusIcon;
    if (p.status === 'you-paid') {
      statusIcon = `<i class="bi bi-cash-coin text-success"></i>`;
    } else if (p.status === 'settled') {
      statusIcon = `<i class="bi bi-check-circle-fill text-success"></i>`;
    } else if (p.status === 'partial') {
      statusIcon = `<i class="bi bi-clock-fill text-warning"></i>`;
    } else {
      statusIcon = `<i class="bi bi-hourglass-split text-danger"></i>`;
    }
    const nameLabel = p.isYou ? `<span class="fw-semibold" style="font-size:.88rem">You</span><span class="badge bg-primary-subtle text-primary ms-1" style="font-size:.7rem">Me</span>` : `<span class="fw-semibold" style="font-size:.88rem">${esc(p.name)}</span>`;
    return `
      <div class="split-participant d-flex align-items-center justify-content-between py-1">
        <div class="d-flex align-items-center gap-2">${statusIcon}${nameLabel}</div>
        <span class="text-primary fw-bold" style="font-size:.88rem">${fmt(p.share)}</span>
      </div>`;
  }).join('');

  return `
  <div class="split-card mb-3">
    <div class="split-card-header d-flex align-items-start justify-content-between gap-2">
      <div>
        <div class="split-card-title"><i class="bi bi-receipt-cutoff me-2 text-primary"></i>${esc(g.description)}</div>
        <div class="split-card-meta text-muted">
          <i class="bi bi-calendar3 me-1"></i>${formatDate(g.date)}
          <span class="mx-2">·</span>
          <i class="bi bi-people-fill me-1"></i>${allParticipants.length} people
          <span class="mx-2">·</span>
          Total: <strong>${fmt(total)}</strong>
          <span class="mx-2">·</span>
          ${youPaid
            ? `<span class="text-success"><i class="bi bi-person-check-fill me-1"></i>You paid</span>`
            : `<span class="text-warning"><i class="bi bi-person-fill me-1"></i>${esc(g.paidBy)} paid</span>`
          }
        </div>
        ${g.note ? `<div class="text-muted" style="font-size:.78rem;margin-top:.25rem"><i class="bi bi-chat-left-text me-1"></i>${esc(g.note)}</div>` : ''}
      </div>
      <div class="d-flex align-items-center gap-2 flex-shrink-0">
        ${statusBadge}
        <button class="acc-action-btn acc-action-del" data-delete-split="${esc(g.id)}" title="Delete Split"><i class="bi bi-trash-fill"></i></button>
      </div>
    </div>
    <div class="split-card-body">
      <div class="split-participants-list">${participantHtml}</div>
    </div>
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
    // You paid — each friend owes you their share → create "lent" entries
    for (const p of friends) {
      const lendId = crypto.randomUUID();
      lendingIds.push(lendId);
      const entry = {
        id:           lendId,
        type:         'lent',
        counterparty: p.name,
        amount:       p.share,
        date,
        accountRef:   '',
        mirroredTxId: '',
        note:         `Split: ${description}`,
      };
      await appendRow(CONFIG.sheets.lendings, sLend(entry));
    }
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
  }

  // Reload lendings into store
  try {
    const rows = await fetchRows(CONFIG.sheets.lendings);
    store.set('lendings', rows.map(dLend));
  } catch { /* ignore */ }

  // Save the split group
  const group = { id, description, date, totalAmount, paidBy, participants, note, lendingIds };
  await appendRow(CONFIG.sheets.splitExpenses, serialize(group));
  const groups = [...(store.get('splitGroups') ?? []), group];
  store.set('splitGroups', groups);

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
  });

  // Bind confirm button
  document.getElementById('split-confirm-btn')?.addEventListener('click', _handleCreate);

  // Re-render when lendings settle
  store.on('lendingSettlements', () => render());
  store.on('lendings',           () => render());
}
