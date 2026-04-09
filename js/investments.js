// js/investments.js — Investment & FD Tracker module

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate } from './utils.js';
import { epConfirm } from './confirm.js';
import { createPaginator } from './paginate.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id, name, type, status, investedAmount, currentValue, startDate, maturityDate, interestRate, institution, notes

export function serialize(r) {
  return [
    r.id,
    r.name,
    r.type ?? '',
    r.status ?? 'active',
    String(r.investedAmount),
    String(r.currentValue),
    r.startDate ?? '',
    r.maturityDate ?? '',
    String(r.interestRate ?? ''),
    r.institution ?? '',
    r.notes ?? '',
  ];
}

export function deserialize(row) {
  return {
    id:             row[0] ?? '',
    name:           row[1] ?? '',
    type:           row[2] ?? '',
    status:         row[3] ?? 'active',
    investedAmount: parseFloat(row[4]) || 0,
    currentValue:   parseFloat(row[5]) || 0,
    startDate:      row[6] ?? '',
    maturityDate:   row[7] ?? '',
    interestRate:   parseFloat(row[8]) || 0,
    institution:    row[9] ?? '',
    notes:          row[10] ?? '',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_ICONS = {
  FD:     'bi-bank2',
  MF:     'bi-bar-chart-fill',
  PPF:    'bi-shield-fill-check',
  Stocks: 'bi-graph-up-arrow',
  Bonds:  'bi-file-earmark-text-fill',
  Gold:   'bi-gem',
  NPS:    'bi-person-fill-check',
  Other:  'bi-briefcase-fill',
};

const TYPE_COLORS = {
  FD:     '#3b82f6',
  MF:     '#8b5cf6',
  PPF:    '#10b981',
  Stocks: '#f59e0b',
  Bonds:  '#6366f1',
  Gold:   '#f97316',
  NPS:    '#14b8a6',
  Other:  '#64748b',
};

const STATUS_BADGE = {
  active:    'bg-success',
  matured:   'bg-primary',
  withdrawn: 'bg-secondary',
};

function daysUntilMaturity(maturityDate) {
  if (!maturityDate) return null;
  const diff = new Date(maturityDate) - new Date();
  return Math.ceil(diff / 86400000);
}

function maturityTag(maturityDate) {
  if (!maturityDate) return '';
  const days = daysUntilMaturity(maturityDate);
  if (days < 0)   return `<span class="badge bg-secondary ms-1">Matured ${formatDate(maturityDate)}</span>`;
  if (days === 0) return `<span class="badge bg-danger ms-1">Matures Today!</span>`;
  if (days <= 30) return `<span class="badge bg-warning text-dark ms-1">Matures in ${days}d</span>`;
  if (days <= 90) return `<span class="badge bg-info text-dark ms-1">Matures in ${days}d</span>`;
  return `<span class="badge bg-light text-dark ms-1">${formatDate(maturityDate)}</span>`;
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

function _renderRow(inv) {
  const icon    = TYPE_ICONS[inv.type] ?? 'bi-briefcase-fill';
  const color   = TYPE_COLORS[inv.type] ?? '#64748b';
  const badge   = STATUS_BADGE[inv.status] ?? 'bg-secondary';
  const returns = inv.currentValue - inv.investedAmount;
  const returnsPct = inv.investedAmount > 0
    ? ((returns / inv.investedAmount) * 100).toFixed(1)
    : 0;
  const returnsColor = returns >= 0 ? '#10b981' : '#ef4444';
  const returnsSign  = returns >= 0 ? '+' : '';

  return `
  <tr class="inv-tr" data-id="${inv.id}">
    <td class="inv-td-name">
      <div class="d-flex align-items-center gap-2">
        <div class="inv-tbl-icon" style="background:${color}18;color:${color}"><i class="bi ${icon}"></i></div>
        <div>
          <div class="inv-tbl-name">${inv.name}</div>
          <div class="inv-tbl-sub">
            ${inv.institution ? `<span>${inv.institution}</span><span class="inv-dot">·</span>` : ''}
            <span>${formatDate(inv.startDate)}</span>
            ${maturityTag(inv.maturityDate)}
          </div>
        </div>
      </div>
    </td>
    <td><span class="badge ${badge}" style="font-size:.65rem">${inv.status}</span></td>
    <td><span class="inv-type-chip" style="color:${color};background:${color}15">${inv.type}</span></td>
    <td class="inv-td-num">${formatCurrency(inv.investedAmount)}</td>
    <td class="inv-td-num">${formatCurrency(inv.currentValue)}</td>
    <td class="inv-td-num" style="color:${returnsColor};font-weight:700">
      ${returnsSign}${formatCurrency(returns)}
    </td>
    <td class="inv-td-pct" style="color:${returnsColor}">${returnsSign}${returnsPct}%</td>
    <td class="inv-td-actions">
      <button class="btn btn-ghost-sm" title="Edit" onclick="window._invEdit('${inv.id}')"><i class="bi bi-pencil-fill"></i></button>
      <button class="btn btn-ghost-sm text-danger" title="Delete" onclick="window._invDelete('${inv.id}')"><i class="bi bi-trash-fill"></i></button>
    </td>
  </tr>`;
}

// ─── Paginator ───────────────────────────────────────────────────────────────

let _paginator = null;
function _getPaginator() {
  if (!_paginator) {
    _paginator = createPaginator({
      containerId: 'investment-list',
      paginationId: 'investment-pagination',
      pageSize: 10,
      renderPage(slice) {
        const list = document.getElementById('investment-list');
        if (!list) return;
        if (slice.length === 0) {
          list.innerHTML = `<div class="ep-empty-state">
            <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 8px 32px rgba(16,185,129,.3)">
              <i class="bi bi-graph-up-arrow"></i>
            </div>
            <div class="ep-es-title">No investments match your filters</div>
            <div class="ep-es-subtitle">Try clearing the filters to see all investments.</div>
          </div>`;
          return;
        }
        list.innerHTML = `<div class="table-responsive">
          <table class="inv-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Type</th>
                <th class="inv-td-num">Invested</th>
                <th class="inv-td-num">Current Value</th>
                <th class="inv-td-num">Returns</th>
                <th class="inv-td-pct">Return %</th>
                <th class="inv-td-actions"></th>
              </tr>
            </thead>
            <tbody>${slice.map(inv => _renderRow(inv)).join('')}</tbody>
          </table>
        </div>`;
      },
    });
  }
  return _paginator;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const all = store.get('investments') ?? [];
  const typeFilter   = document.getElementById('inv-filter-type')?.value ?? '';
  const statusFilter = document.getElementById('inv-filter-status')?.value ?? '';

  const filtered = all.filter(i =>
    (!typeFilter   || i.type   === typeFilter) &&
    (!statusFilter || i.status === statusFilter)
  );

  // Stats
  const active = all.filter(i => i.status === 'active');
  const totalInvested = all.reduce((s, i) => s + i.investedAmount, 0);
  const totalValue    = all.reduce((s, i) => s + i.currentValue,   0);
  const returns       = totalValue - totalInvested;

  const el = id => document.getElementById(id);
  if (el('inv-stat-total-invested')) el('inv-stat-total-invested').textContent = formatCurrency(totalInvested);
  if (el('inv-stat-current-value'))  el('inv-stat-current-value').textContent  = formatCurrency(totalValue);
  if (el('inv-stat-returns')) {
    el('inv-stat-returns').textContent = (returns >= 0 ? '+' : '') + formatCurrency(returns);
    el('inv-stat-returns').style.color = returns >= 0 ? '#10b981' : '#ef4444';
  }
  if (el('inv-stat-active')) el('inv-stat-active').textContent = active.length;
  if (el('inv-count')) el('inv-count').textContent = all.length || '';

  const list = document.getElementById('investment-list');
  if (!list) return;

  if (filtered.length === 0 && all.length === 0) {
    list.innerHTML = `<div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 8px 32px rgba(16,185,129,.3)">
        <i class="bi bi-graph-up-arrow"></i>
      </div>
      <div class="ep-es-title">No investments yet</div>
      <div class="ep-es-subtitle">Start tracking your FDs, mutual funds, stocks and more. Your portfolio summary will appear here.</div>
      <button class="btn ep-es-cta" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none" data-bs-toggle="modal" data-bs-target="#oc-investment">
        <i class="bi bi-plus-circle-fill me-2"></i>Add First Investment
      </button>
    </div>`;
    document.getElementById('investment-pagination').innerHTML = '';
    return;
  }

  _getPaginator().update(filtered);
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

let _editId = null;

function resetForm() {
  const form = document.getElementById('investment-form');
  if (form) form.reset();
  const err = document.getElementById('investment-form-error');
  if (err) { err.textContent = ''; err.classList.add('d-none'); }
  const submitBtn = document.getElementById('inv-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Investment'; }
  const cancelBtn = document.getElementById('inv-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('d-none');
  const label = document.getElementById('oc-investment-label');
  if (label) label.innerHTML = '<i class="bi bi-graph-up-arrow me-2 text-success"></i>Add Investment';
  _editId = null;
}

function showError(msg) {
  const err = document.getElementById('investment-form-error');
  if (err) { err.textContent = msg; err.classList.remove('d-none'); }
}

function getFormValues() {
  return {
    name:           document.getElementById('inv-name')?.value.trim() ?? '',
    type:           document.getElementById('inv-type')?.value ?? '',
    status:         document.getElementById('inv-status')?.value ?? 'active',
    investedAmount: parseFloat(document.getElementById('inv-invested-amount')?.value) || 0,
    currentValue:   parseFloat(document.getElementById('inv-current-value')?.value) || 0,
    startDate:      document.getElementById('inv-start-date')?.value ?? '',
    maturityDate:   document.getElementById('inv-maturity-date')?.value ?? '',
    interestRate:   parseFloat(document.getElementById('inv-interest-rate')?.value) || 0,
    institution:    document.getElementById('inv-institution')?.value.trim() ?? '',
    notes:          document.getElementById('inv-notes')?.value.trim() ?? '',
  };
}

function fillForm(inv) {
  document.getElementById('inv-name').value            = inv.name;
  document.getElementById('inv-type').value            = inv.type;
  document.getElementById('inv-status').value          = inv.status;
  document.getElementById('inv-invested-amount').value = inv.investedAmount;
  document.getElementById('inv-current-value').value   = inv.currentValue;
  document.getElementById('inv-start-date').value      = inv.startDate;
  document.getElementById('inv-maturity-date').value   = inv.maturityDate;
  document.getElementById('inv-interest-rate').value   = inv.interestRate || '';
  document.getElementById('inv-institution').value     = inv.institution;
  document.getElementById('inv-notes').value           = inv.notes;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  const vals = getFormValues();

  if (!vals.name)          return showError('Investment name is required.');
  if (!vals.type)          return showError('Please select an investment type.');
  if (!vals.startDate)     return showError('Start date is required.');
  if (vals.investedAmount <= 0) return showError('Invested amount must be greater than 0.');
  if (vals.currentValue < 0)   return showError('Current value cannot be negative.');

  const btn = document.getElementById('inv-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const all = store.get('investments') ?? [];

    if (_editId) {
      const idx = all.findIndex(i => i.id === _editId);
      if (idx === -1) throw new Error('Investment not found.');
      const updated = { ...all[idx], ...vals, id: _editId };
      const newAll  = [...all];
      newAll[idx]   = updated;
      await writeAllRows(CONFIG.sheets.investments, newAll.map(serialize));
      store.set('investments', newAll);
    } else {
      const id  = 'inv_' + Date.now();
      const rec = { id, ...vals };
      await appendRow(CONFIG.sheets.investments, serialize(rec));
      store.set('investments', [...all, rec]);
    }

    const modal = document.getElementById('oc-investment');
    if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    resetForm();
  } catch (err) {
    showError(err.message || 'Failed to save investment.');
    btn.disabled = false;
    btn.textContent = _editId ? 'Save Changes' : 'Add Investment';
  }
}

window._invEdit = function(id) {
  const inv = (store.get('investments') ?? []).find(i => i.id === id);
  if (!inv) return;
  _editId = id;
  fillForm(inv);
  const submitBtn = document.getElementById('inv-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Changes'; }
  const cancelBtn = document.getElementById('inv-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  const label = document.getElementById('oc-investment-label');
  if (label) label.innerHTML = '<i class="bi bi-pencil-fill me-2 text-warning"></i>Edit Investment';
  const modal = document.getElementById('oc-investment');
  if (modal) new bootstrap.Modal(modal).show();
};

window._invDelete = async function(id) {
  const inv = (store.get('investments') ?? []).find(i => i.id === id);
  if (!inv) return;
  const ok = await epConfirm(`Delete "${inv.name}"? This cannot be undone.`);
  if (!ok) return;
  try {
    const newAll = (store.get('investments') ?? []).filter(i => i.id !== id);
    await writeAllRows(CONFIG.sheets.investments, newAll.map(serialize));
    store.set('investments', newAll);
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
};

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initInvestments() {
  store.on('investments', render);

  const form = document.getElementById('investment-form');
  if (form) form.addEventListener('submit', handleSubmit);

  const modal = document.getElementById('oc-investment');
  if (modal) modal.addEventListener('hidden.bs.modal', resetForm);

  document.getElementById('inv-filter-type')?.addEventListener('change', render);
  document.getElementById('inv-filter-status')?.addEventListener('change', render);

  render();
}

export function renderInvestments() {
  render();
}
