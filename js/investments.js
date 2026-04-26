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

// ─── Filter & sort state ────────────────────────────────────────────────────
const _invFilter = { search: '', type: '', status: '' };
let _sortCol = null, _sortDir = 'asc';

function _sortInvestments(arr) {
  if (!_sortCol) return arr;
  return [...arr].sort((a, b) => {
    let va, vb;
    if (_sortCol === 'name')     { va = a.name.toLowerCase();              vb = b.name.toLowerCase(); }
    if (_sortCol === 'invested') { va = a.investedAmount;                  vb = b.investedAmount; }
    if (_sortCol === 'value')    { va = a.currentValue;                    vb = b.currentValue; }
    if (_sortCol === 'returns')  { va = a.currentValue - a.investedAmount; vb = b.currentValue - b.investedAmount; }
    if (va < vb) return _sortDir === 'asc' ? -1 : 1;
    if (va > vb) return _sortDir === 'asc' ? 1  : -1;
    return 0;
  });
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

function maturityChip(maturityDate) {
  if (!maturityDate) return '';
  const days = daysUntilMaturity(maturityDate);
  if (days < 0)   return `<span class="inv-maturity-chip" style="color:#64748b;background:#f1f5f9;border-color:#e2e8f0">Matured ${formatDate(maturityDate)}</span>`;
  if (days === 0) return `<span class="inv-maturity-chip" style="color:#dc2626;background:#fee2e2;border-color:#fca5a5">Matures Today!</span>`;
  if (days <= 30) return `<span class="inv-maturity-chip" style="color:#d97706;background:#fef3c7;border-color:#fcd34d">Matures in ${days}d</span>`;
  if (days <= 90) return `<span class="inv-maturity-chip" style="color:#0284c7;background:#e0f2fe;border-color:#bae6fd">Matures in ${days}d</span>`;
  return `<span class="inv-maturity-chip" style="color:#64748b;background:#f1f5f9;border-color:#e2e8f0">${formatDate(maturityDate)}</span>`;
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

function _renderRow(inv) {
  const icon    = TYPE_ICONS[inv.type] ?? 'bi-briefcase-fill';
  const color   = TYPE_COLORS[inv.type] ?? '#64748b';
  const returns = inv.currentValue - inv.investedAmount;
  const returnsPct = inv.investedAmount > 0
    ? ((returns / inv.investedAmount) * 100).toFixed(1)
    : '0.0';
  const returnsColor = returns >= 0 ? '#059669' : '#ef4444';
  const returnsSign  = returns >= 0 ? '+' : '';

  const statusStyle = inv.status === 'active'
    ? 'color:#059669;background:#dcfce7;border-color:#bbf7d0'
    : inv.status === 'matured'
    ? 'color:#3b82f6;background:#dbeafe;border-color:#bfdbfe'
    : 'color:#64748b;background:#f1f5f9;border-color:#e2e8f0';

  const matChip = maturityChip(inv.maturityDate);
  const rateChip = inv.interestRate > 0
    ? `<span class="inv-dot">·</span><span>${inv.interestRate}% p.a.</span>` : '';

  // Urgency left border for investments maturing within 30 days
  const days = inv.maturityDate ? daysUntilMaturity(inv.maturityDate) : null;
  const urgencyBorder = days !== null && days >= 0 && days <= 30
    ? `style="border-left:3px solid ${days === 0 ? '#dc2626' : '#d97706'}"`
    : '';

  return `
  <tr class="inv-tr" data-id="${inv.id}" ${urgencyBorder}>
    <td class="inv-td-name">
      <div class="d-flex align-items-center gap-2">
        <div class="inv-tbl-icon" style="background:${color}18;color:${color}"><i class="bi ${icon}"></i></div>
        <div>
          <div class="inv-tbl-name">${inv.name}</div>
          <div class="inv-tbl-sub">
            ${inv.institution ? `<span>${inv.institution}</span><span class="inv-dot">·</span>` : ''}
            <span>${formatDate(inv.startDate)}</span>
            ${rateChip}
            ${matChip ? `<span class="inv-dot">·</span>${matChip}` : ''}
          </div>
        </div>
      </div>
    </td>
    <td><span class="inv-status-chip" style="${statusStyle}">${inv.status}</span></td>
    <td><span class="inv-type-chip" style="color:${color};background:${color}15">${inv.type}</span></td>
    <td class="inv-td-num">${formatCurrency(inv.investedAmount)}</td>
    <td class="inv-td-num inv-td-cv" data-inv-cv-id="${inv.id}" data-inv-cv-raw="${inv.currentValue}" title="Click to update value" style="cursor:pointer">
      <span class="inv-cv-display">${formatCurrency(inv.currentValue)}</span>
      <i class="bi bi-pencil-square inv-cv-hint"></i>
    </td>
    <td class="inv-td-returns">
      <div style="color:${returnsColor};font-weight:700;font-size:.82rem">${returnsSign}${formatCurrency(returns)}</div>
      <div style="color:${returnsColor};font-size:.7rem;opacity:.85">${returnsSign}${returnsPct}%</div>
    </td>
    <td class="inv-td-actions">
      <button class="btn-ghost-sm" title="Edit" data-inv-id="${inv.id}" data-inv-action="edit"><i class="bi bi-pencil-fill"></i></button>
      <button class="btn-ghost-sm text-danger" title="Delete" data-inv-id="${inv.id}" data-inv-action="delete"><i class="bi bi-trash-fill"></i></button>
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

        const sortArrow = col => {
          if (_sortCol !== col) return `<i class="bi bi-arrow-down-up inv-sort-icon"></i>`;
          return `<i class="bi bi-arrow-${_sortDir === 'asc' ? 'up' : 'down'} inv-sort-icon inv-sort-active"></i>`;
        };

        list.innerHTML = `<div class="table-responsive">
          <table class="inv-table">
            <thead>
              <tr>
                <th class="inv-th-sort" data-sort-col="name">Name ${sortArrow('name')}</th>
                <th>Status</th>
                <th>Type</th>
                <th class="inv-td-num inv-th-sort" data-sort-col="invested">Invested ${sortArrow('invested')}</th>
                <th class="inv-td-num inv-th-sort" data-sort-col="value">Current Value ${sortArrow('value')}</th>
                <th class="inv-td-num inv-th-sort" data-sort-col="returns">Returns ${sortArrow('returns')}</th>
                <th class="inv-td-actions"></th>
              </tr>
            </thead>
            <tbody>${slice.map(inv => _renderRow(inv)).join('')}</tbody>
          </table>
        </div>`;

        // Sort header delegation
        list.querySelectorAll('.inv-th-sort').forEach(th => {
          th.addEventListener('click', () => {
            const col = th.dataset.sortCol;
            if (_sortCol === col) { _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'; }
            else { _sortCol = col; _sortDir = 'asc'; }
            render();
          });
        });

        // Tbody delegation: action buttons + CV inline edit
        const tbody = list.querySelector('tbody');
        if (tbody) {
          tbody.addEventListener('click', async e => {
            // Action buttons
            const btn = e.target.closest('[data-inv-action]');
            if (btn) {
              if (btn.dataset.invAction === 'edit')   _invEdit(btn.dataset.invId);
              if (btn.dataset.invAction === 'delete') _invDelete(btn.dataset.invId);
              return;
            }
            // CV inline edit
            const cvCell = e.target.closest('.inv-td-cv');
            if (cvCell && !cvCell.querySelector('input')) {
              const id  = cvCell.dataset.invCvId;
              const raw = parseFloat(cvCell.dataset.invCvRaw);
              cvCell.innerHTML = `<input class="inv-cv-input" type="number" value="${raw}" step="0.01" min="0" />`;
              const input = cvCell.querySelector('input');
              input.focus(); input.select();

              const save = async () => {
                const newVal = parseFloat(input.value);
                if (isNaN(newVal) || newVal === raw) { render(); return; }
                const all = store.get('investments') ?? [];
                const idx = all.findIndex(i => i.id === id);
                if (idx === -1) { render(); return; }
                const newAll = [...all];
                newAll[idx] = { ...all[idx], currentValue: newVal };
                try {
                  await writeAllRows(CONFIG.sheets.investments, newAll.map(serialize));
                  store.set('investments', newAll);
                } catch (err) {
                  alert('Failed to update: ' + err.message);
                  render();
                }
              };

              input.addEventListener('keydown', e => {
                if (e.key === 'Enter')  { input.blur(); }
                if (e.key === 'Escape') { render(); }
              });
              input.addEventListener('blur', save);
            }
          });
        }
      },
    });
  }
  return _paginator;
}

// ─── Portfolio breakdown ──────────────────────────────────────────────────────

function _renderBreakdown(all) {
  const el = document.getElementById('inv-breakdown');
  if (!el) return;
  const totalInvested = all.reduce((s, i) => s + i.investedAmount, 0);
  if (all.length === 0 || totalInvested === 0) { el.classList.add('d-none'); return; }
  const byType = {};
  all.forEach(i => { byType[i.type] = (byType[i.type] || 0) + i.investedAmount; });
  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  el.classList.remove('d-none');
  el.innerHTML = `<div class="inv-breakdown-inner">
    <div class="inv-breakdown-bar">
      ${sorted.map(([type, amt]) => {
        const pct   = (amt / totalInvested) * 100;
        const color = TYPE_COLORS[type] ?? '#64748b';
        return `<div class="inv-breakdown-seg" style="width:${pct.toFixed(1)}%;background:${color}" title="${type}: ${formatCurrency(amt)} (${pct.toFixed(1)}%)"></div>`;
      }).join('')}
    </div>
    <div class="inv-breakdown-legend">
      ${sorted.map(([type, amt]) => {
        const pct   = ((amt / totalInvested) * 100).toFixed(1);
        const color = TYPE_COLORS[type] ?? '#64748b';
        return `<span class="inv-breakdown-item"><span class="inv-breakdown-dot" style="background:${color}"></span>${type} <span style="opacity:.7">${pct}%</span></span>`;
      }).join('')}
    </div>
  </div>`;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const all      = store.get('investments') ?? [];
  const search   = _invFilter.search.toLowerCase();
  const typeF    = _invFilter.type;
  const statusF  = _invFilter.status;
  const isMaturingSoon = statusF === 'maturing';

  const filtered = all.filter(i =>
    (!search  || i.name.toLowerCase().includes(search) || (i.institution ?? '').toLowerCase().includes(search)) &&
    (!typeF   || i.type === typeF) &&
    (isMaturingSoon
      ? (i.maturityDate && daysUntilMaturity(i.maturityDate) >= 0 && daysUntilMaturity(i.maturityDate) <= 30)
      : (!statusF || i.status === statusF))
  );

  const active        = all.filter(i => i.status === 'active');
  const totalInvested = all.reduce((s, i) => s + i.investedAmount, 0);
  const totalValue    = all.reduce((s, i) => s + i.currentValue,   0);
  const returns       = totalValue - totalInvested;

  const el = id => document.getElementById(id);
  if (el('inv-stat-total-invested')) el('inv-stat-total-invested').textContent = formatCurrency(totalInvested);
  if (el('inv-stat-current-value'))  el('inv-stat-current-value').textContent  = formatCurrency(totalValue);
  if (el('inv-stat-returns')) {
    el('inv-stat-returns').textContent = (returns >= 0 ? '+' : '') + formatCurrency(returns);
    el('inv-stat-returns').style.color = returns >= 0 ? '#059669' : '#ef4444';
  }
  // Dynamic returns card colour + icon
  const returnsCard = el('inv-stat-returns-card');
  if (returnsCard) {
    returnsCard.className = returnsCard.className.replace(/sec-stat-card--tint-\w+/, returns >= 0 ? 'sec-stat-card--tint-green' : 'sec-stat-card--tint-red');
  }
  const returnsIcon = el('inv-stat-returns-icon');
  if (returnsIcon) {
    returnsIcon.style.background = returns >= 0
      ? 'linear-gradient(135deg,#059669,#34d399)'
      : 'linear-gradient(135deg,#dc2626,#f87171)';
  }
  const returnsIco = el('inv-stat-returns-ico');
  if (returnsIco) {
    returnsIco.className = returns >= 0 ? 'bi bi-arrow-up-right-circle-fill' : 'bi bi-arrow-down-right-circle-fill';
  }
  if (el('inv-stat-active')) el('inv-stat-active').textContent = active.length;
  if (el('inv-count'))       el('inv-count').textContent       = filtered.length || '';

  const heroSub = el('inv-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = all.length
      ? `<strong style="color:#bbf7d0;font-weight:700">${formatCurrency(Math.round(totalValue))}</strong> portfolio · ${returns >= 0 ? '+' : ''}${formatCurrency(Math.round(returns))} returns`
      : 'Track FDs, mutual funds, stocks and more';
  }

  _renderBreakdown(all);

  const list = document.getElementById('investment-list');
  if (!list) return;

  if (all.length === 0) {
    list.innerHTML = `<div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#047857,#10b981);box-shadow:0 8px 32px rgba(4,120,87,.3)">
        <i class="bi bi-graph-up-arrow"></i>
      </div>
      <div class="ep-es-title">No investments yet</div>
      <div class="ep-es-subtitle">Start tracking your FDs, mutual funds, stocks and more.</div>
      <button class="btn inv-btn-solid ep-es-cta" data-bs-toggle="modal" data-bs-target="#oc-investment">
        <i class="bi bi-plus-circle-fill me-2"></i>Add First Investment
      </button>
    </div>`;
    document.getElementById('investment-pagination').innerHTML = '';
    return;
  }

  _getPaginator().update(_sortInvestments(filtered));
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

let _editId = null;

function resetForm() {
  const form = document.getElementById('investment-form');
  if (form) form.reset();
  const err = document.getElementById('investment-form-error');
  if (err) { err.textContent = ''; err.classList.add('d-none'); }
  const submitBtn = document.getElementById('inv-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Add Investment'; }
  const cancelBtn = document.getElementById('inv-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('d-none');
  const label = document.getElementById('oc-investment-label');
  if (label) label.textContent = 'Add Investment';
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
  btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Saving…';

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
    btn.innerHTML = _editId ? '<i class="bi bi-check-circle-fill me-1"></i>Save Changes' : '<i class="bi bi-plus-circle-fill me-1"></i>Add Investment';
  }
}

function _invEdit(id) {
  const inv = (store.get('investments') ?? []).find(i => i.id === id);
  if (!inv) return;
  _editId = id;
  fillForm(inv);
  const submitBtn = document.getElementById('inv-submit-btn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Save Changes'; }
  const cancelBtn = document.getElementById('inv-cancel-edit');
  if (cancelBtn) cancelBtn.classList.remove('d-none');
  const label = document.getElementById('oc-investment-label');
  if (label) label.textContent = 'Edit Investment';
  const modal = document.getElementById('oc-investment');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

async function _invDelete(id) {
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
}

// ─── Filter binding ───────────────────────────────────────────────────────────

function _bindInvFilters() {
  const searchEl = document.getElementById('inv-search');
  if (searchEl) {
    let _t;
    searchEl.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => { _invFilter.search = searchEl.value; _paginator = null; render(); }, 220);
    });
  }

  function _buildDropdown(btnId, menuId, opts, filterKey, btnTemplate) {
    const btn  = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    menu.innerHTML = opts.map(o => `<button class="fdd-item" data-val="${o.val}">${o.label}</button>`).join('');
    btn.addEventListener('click', () => menu.classList.toggle('fdd-open'));
    document.addEventListener('click', e => {
      if (!btn.contains(e.target) && !menu.contains(e.target)) menu.classList.remove('fdd-open');
    });
    menu.querySelectorAll('.fdd-item').forEach(item => {
      item.addEventListener('click', () => {
        _invFilter[filterKey] = item.dataset.val;
        btn.innerHTML = btnTemplate(item.textContent);
        menu.classList.remove('fdd-open');
        document.querySelectorAll('[data-inv-preset]').forEach(b => b.classList.remove('active'));
        _paginator = null;
        render();
      });
    });
  }

  _buildDropdown('inv-type-btn', 'inv-type-menu', [
    { val: '', label: 'All Types' },
    { val: 'FD', label: 'Fixed Deposit' }, { val: 'MF', label: 'Mutual Fund' },
    { val: 'PPF', label: 'PPF' }, { val: 'Stocks', label: 'Stocks' },
    { val: 'Bonds', label: 'Bonds' }, { val: 'Gold', label: 'Gold' },
    { val: 'NPS', label: 'NPS' }, { val: 'Other', label: 'Other' },
  ], 'type', t => `<i class="bi bi-tag me-1"></i>${t} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`);

  _buildDropdown('inv-status-btn', 'inv-status-menu', [
    { val: '', label: 'All Status' },
    { val: 'active', label: '🟢 Active' },
    { val: 'matured', label: '🔵 Matured' },
    { val: 'withdrawn', label: '⚪ Withdrawn' },
  ], 'status', t => `<i class="bi bi-funnel me-1"></i>${t} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`);

  document.querySelectorAll('[data-inv-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _invFilter.status = btn.dataset.invPreset;
      _invFilter.type   = '';
      document.querySelectorAll('[data-inv-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const typeBtn   = document.getElementById('inv-type-btn');
      const statusBtn = document.getElementById('inv-status-btn');
      if (typeBtn)   typeBtn.innerHTML   = `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      if (statusBtn) statusBtn.innerHTML = `<i class="bi bi-funnel me-1"></i>Status <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      _paginator = null;
      render();
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function _bindModalPreview() {
  const invested = document.getElementById('inv-invested-amount');
  const current  = document.getElementById('inv-current-value');
  const preview  = document.getElementById('inv-returns-preview');
  if (!invested || !current || !preview) return;

  const update = () => {
    const inv = parseFloat(invested.value) || 0;
    const cur = parseFloat(current.value)  || 0;
    if (!inv && !cur) { preview.classList.add('d-none'); return; }
    const ret  = cur - inv;
    const pct  = inv > 0 ? ((ret / inv) * 100).toFixed(1) : '0.0';
    const sign  = ret >= 0 ? '+' : '';
    const color = ret >= 0 ? '#059669' : '#ef4444';
    preview.classList.remove('d-none');
    preview.innerHTML = `
      <span style="color:${color};font-weight:700;font-size:.88rem">${sign}${formatCurrency(ret)}</span>
      <span style="color:${color};font-size:.78rem;margin-left:.4rem">(${sign}${pct}%)</span>
      <span style="color:#94a3b8;font-size:.75rem;margin-left:.4rem">projected returns</span>`;
  };
  invested.addEventListener('input', update);
  current.addEventListener('input', update);
}

export function initInvestments() {
  store.on('investments', render);

  const form = document.getElementById('investment-form');
  if (form) form.addEventListener('submit', handleSubmit);

  const modal = document.getElementById('oc-investment');
  if (modal) modal.addEventListener('hidden.bs.modal', resetForm);

  _bindInvFilters();
  _bindModalPreview();
  render();
}

export function renderInvestments() {
  render();
}
