// js/transfers.js — Account-to-account transfers module
// Requirements: 15.1–15.9

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber, requireDifferentValues } from './validation.js';
import { formatCurrency, formatDate } from './utils.js';
import { createPaginator } from './paginate.js';

// ─── Serialization (Task 11.1) ───────────────────────────────────────────────
// Columns: A=id, B=date, C=sourceAccount, D=destinationAccount, E=amount, F=description

/**
 * Converts a TransferRecord object to a row array for Google Sheets.
 * @param {{ id: string, date: string, sourceAccount: string, destinationAccount: string, amount: number, description: string }} record
 * @returns {string[]}
 */
export function serialize(record) {
  return [
    record.id,
    record.date,
    record.sourceAccount,
    record.destinationAccount,
    String(record.amount),
    record.description,
  ];
}

/**
 * Converts a raw Sheets row array to a TransferRecord object.
 * @param {string[]} row
 * @returns {{ id: string, date: string, sourceAccount: string, destinationAccount: string, amount: number, description: string }}
 */
export function deserialize(row) {
  return {
    id: row[0] ?? '',
    date: row[1] ?? '',
    sourceAccount: row[2] ?? '',
    destinationAccount: row[3] ?? '',
    amount: parseFloat(row[4]) || 0,
    description: row[5] ?? '',
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
  const banner = document.getElementById('transfer-error-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.remove('d-none');
}

function hideError() {
  const banner = document.getElementById('transfer-error-banner');
  if (banner) banner.classList.add('d-none');
}

function populateAccountDropdowns() {
  const accounts = store.get('accounts') ?? [];
  // Only non-credit-card accounts (accounts have a 'type' field; credit cards do not)
  const names = accounts.map(a => a.name);

  ['transfer-source', 'transfer-dest'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Select account…</option>' +
      names.map(n => `<option value="${escapeHtml(n)}"${n === current ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');
  });
}

// ─── Paginator ───────────────────────────────────────────────────────────────
let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'transfer-cards',
      paginationId: 'transfer-pagination',
      pageSize: 12,
      renderPage(slice) {
        const container = document.getElementById('transfer-cards');
        const emptyState = document.getElementById('transfer-empty-state');
        if (!container) return;
        if (slice.length === 0) {
          container.innerHTML = '';
          if (emptyState) emptyState.classList.remove('d-none');
          return;
        }
        if (emptyState) emptyState.classList.add('d-none');
        container.innerHTML = `<div class="data-cards-grid">${slice.map(t => `
          <div class="data-card transfer-card">
            <div class="dc-header">
              <div class="dc-icon transfer-icon"><i class="bi bi-arrow-left-right"></i></div>
              <div class="dc-meta">
                <div class="dc-title">${t.description ? escapeHtml(t.description) : 'Transfer'}</div>
                <div class="dc-subtitle dc-transfer-route">
                  <span>${escapeHtml(t.sourceAccount)}</span>
                  <i class="bi bi-arrow-right mx-1" style="font-size:.7rem;opacity:.5"></i>
                  <span>${escapeHtml(t.destinationAccount)}</span>
                </div>
              </div>
              <div class="dc-amount transfer-amount">${formatCurrency(t.amount)}</div>
            </div>
            <div class="dc-footer">
              <span class="dc-badge"><i class="bi bi-calendar3 me-1"></i>${formatDate(t.date)}</span>
              <div class="dc-actions">
                <button class="btn btn-sm btn-outline-danger" data-delete-transfer="${escapeHtml(t.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
          </div>
        `).join('')}</div>`;
        container.querySelectorAll('[data-delete-transfer]').forEach(btn => {
          btn.addEventListener('click', () => _deleteRecord(btn.dataset.deleteTransfer));
        });
      },
    });
  }
  return _paginator;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

import { epConfirm } from './confirm.js';
import { showUndoToast } from './undo.js';

async function _deleteRecord(id) {
  if (!await epConfirm('Delete this transfer?')) return;
  const allRecords = store.get('transfers') ?? [];
  const deleted = allRecords.find(t => t.id === id);
  const records = allRecords.filter(t => t.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.transfers, records.map(serialize));
    store.set('transfers', records);
    showUndoToast('Transfer deleted', async () => {
      const current = [...(store.get('transfers') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.transfers, current.map(serialize));
      store.set('transfers', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete. Please try again.');
  }
}

// ─── render() (Task 11.3) ────────────────────────────────────────────────────

/**
 * Reads transfers from the store, sorts by date descending, renders into #transfer-table-body.
 * Shows #transfer-empty-state when empty.
 * Requirements: 15.6, 15.8
 */
export function render() {
  const transfers = [...(store.get('transfers') ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  // Stat cards
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = transfers.filter(t => String(t.date ?? '').startsWith(curYM)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const volume = transfers.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const el = id => document.getElementById(id);
  if (el('tr-stat-total')) el('tr-stat-total').textContent = transfers.length;
  if (el('tr-stat-this-month')) el('tr-stat-this-month').textContent = formatCurrency(thisMonth);
  if (el('tr-stat-volume')) el('tr-stat-volume').textContent = formatCurrency(volume);

  _getPaginator().update(transfers);
}

// ─── init() (Task 11.3) ──────────────────────────────────────────────────────

/**
 * Binds the transfer form submit handler, populates dropdowns, and subscribes to store changes.
 * Requirements: 15.1–15.5
 */
export function init() {
  populateAccountDropdowns();
  _bindForm();
  store.on('transfers', render);
  store.on('accounts', populateAccountDropdowns);
}

function _bindForm() {
  const form = document.getElementById('transfer-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const date = document.getElementById('transfer-date')?.value?.trim() ?? '';
    const sourceAccount = document.getElementById('transfer-source')?.value?.trim() ?? '';
    const destinationAccount = document.getElementById('transfer-dest')?.value?.trim() ?? '';
    const amount = document.getElementById('transfer-amount')?.value?.trim() ?? '';
    const description = document.getElementById('transfer-description')?.value?.trim() ?? '';

    // Validate required fields
    const reqResult = requireFields(
      { date, sourceAccount, destinationAccount, amount },
      ['date', 'sourceAccount', 'destinationAccount', 'amount']
    );
    if (!reqResult.valid) {
      showError(reqResult.errors.join('. '));
      return;
    }

    // Validate positive amount
    const amtResult = requirePositiveNumber(amount);
    if (!amtResult.valid) {
      showError(amtResult.errors[0]);
      return;
    }

    // Validate different source and destination
    const diffResult = requireDifferentValues(sourceAccount, destinationAccount, 'Source and destination accounts');
    if (!diffResult.valid) {
      showError(diffResult.errors[0]);
      return;
    }

    const record = {
      id: crypto.randomUUID(),
      date,
      sourceAccount,
      destinationAccount,
      amount: parseFloat(amount),
      description,
    };

    try {
      await appendRow(CONFIG.sheets.transfers, serialize(record));
      const rows = await fetchRows(CONFIG.sheets.transfers);
      store.set('transfers', rows.map(deserialize));
      form.reset();
      hideError();
      const modal = document.getElementById('oc-transfer');
      if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      showError(err.message ?? 'Failed to save transfer. Please try again.');
    }
  });
}
