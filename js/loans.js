// js/loans.js — EMI / Loan Tracker module

import { CONFIG } from './config.js';
import { appendRow, writeAllRows } from './api.js';
import * as store from './store.js';
import { formatCurrency, formatDate } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Serialization ────────────────────────────────────────────────────────────
// Columns: id | name | type | principal | interestRate | tenureMonths | startDate | accountRef | notes | status | disbursements | rateChanges | prepayments

export function serialize(r) {
  return [
    r.id,
    r.name,
    r.type ?? 'Personal',
    String(r.principal),
    String(r.interestRate),
    String(r.tenureMonths),
    r.startDate ?? '',
    r.accountRef ?? '',
    r.notes ?? '',
    r.status ?? 'active',
    JSON.stringify(r.disbursements ?? []),
    JSON.stringify(r.rateChanges   ?? []),
    JSON.stringify(r.prepayments   ?? []),
  ];
}

function _safeParse(v) {
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

export function deserialize(row) {
  return {
    id:            row[0]  ?? '',
    name:          row[1]  ?? '',
    type:          row[2]  ?? 'Personal',
    principal:     parseFloat(row[3]) || 0,
    interestRate:  parseFloat(row[4]) || 0,
    tenureMonths:  parseInt(row[5])   || 0,
    startDate:     row[6]  ?? '',
    accountRef:    row[7]  ?? '',
    notes:         row[8]  ?? '',
    status:        row[9]  ?? 'active',
    disbursements: _safeParse(row[10]),
    rateChanges:   _safeParse(row[11]),
    prepayments:   _safeParse(row[12]),
  };
}

// ─── Filter state ──────────────────────────────────────────────────────────────────────────────
const _loanFilter = { search: '', type: '', status: '' };

// ─── EMI Calculation ──────────────────────────────────────────────────────────

export function calcEmi(principal, annualRate, tenureMonths) {
  if (tenureMonths <= 0) return 0;
  if (annualRate <= 0) return principal / tenureMonths;
  const r = annualRate / 12 / 100;
  const n = tenureMonths;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// Simple amortization (kept for back-compat; internally calls the full version)
export function calcAmortization(principal, annualRate, tenureMonths, startDate) {
  return calcAmortizationFull({ principal, interestRate: annualRate, tenureMonths, startDate });
}

// Full amortization — handles staged disbursements, mid-loan rate changes and prepayments
export function calcAmortizationFull(loan) {
  const {
    principal, interestRate, tenureMonths, startDate,
    disbursements = [], rateChanges = [], prepayments = [],
  } = loan;

  const startD = startDate ? new Date(startDate + 'T00:00:00') : new Date();
  const mIdx = ds => {
    const d = new Date(ds + 'T00:00:00');
    return (d.getFullYear() - startD.getFullYear()) * 12 + (d.getMonth() - startD.getMonth());
  };

  const disbMap = {};
  disbursements.forEach(d => { const i = mIdx(d.date); disbMap[i] = (disbMap[i] || 0) + Number(d.amount); });

  const rateMap = {};
  [...rateChanges].sort((a, b) => a.date.localeCompare(b.date)).forEach(rc => { rateMap[mIdx(rc.date)] = Number(rc.rate); });

  const prepMap = {};
  prepayments.forEach(p => {
    const i = mIdx(p.date);
    if (!prepMap[i]) prepMap[i] = [];
    prepMap[i].push({ amount: Number(p.amount), adjustType: p.adjustType ?? 'tenure' });
  });

  let balance = principal;
  let currentRate = interestRate;
  let currentEmi  = calcEmi(principal, interestRate, tenureMonths);
  let remMonths   = tenureMonths;
  const schedule  = [];
  let monthNum    = 1;

  for (let i = 0; i < 600 && balance > 0.5 && remMonths > 0; i++) {
    let disbursed   = null;
    let rateChanged = null;
    let prepaid     = null;

    if (disbMap[i] !== undefined) {
      disbursed = disbMap[i];
      balance  += disbursed;
      currentEmi = calcEmi(balance, currentRate, remMonths);
    }
    if (rateMap[i] !== undefined) {
      rateChanged  = rateMap[i];
      currentRate  = rateChanged;
      currentEmi   = calcEmi(balance, currentRate, remMonths);
    }
    if (prepMap[i]) {
      prepaid = prepMap[i].reduce((s, p) => s + p.amount, 0);
      for (const pp of prepMap[i]) {
        balance = Math.max(0, balance - pp.amount);
        if (balance <= 0.5) break;
        if (pp.adjustType === 'tenure') {
          const r = currentRate / 100 / 12;
          remMonths = r > 0
            ? Math.ceil(Math.log(currentEmi / (currentEmi - r * balance)) / Math.log(1 + r))
            : Math.ceil(balance / currentEmi);
        } else {
          currentEmi = calcEmi(balance, currentRate, remMonths);
        }
      }
    }

    if (balance <= 0.5) break;

    const r           = currentRate / 100 / 12;
    const interest    = balance * r;
    const prinPart    = Math.min(currentEmi - interest, balance);
    balance           = Math.max(balance - prinPart, 0);
    const payDate     = new Date(startD);
    payDate.setMonth(payDate.getMonth() + i + 1);

    schedule.push({
      month:       monthNum++,
      date:        payDate.toISOString().slice(0, 10),
      emi:         Math.round((prinPart + interest) * 100) / 100,
      principal:   Math.round(prinPart   * 100) / 100,
      interest:    Math.round(interest   * 100) / 100,
      balance:     Math.round(balance    * 100) / 100,
      disbursed,
      rateChanged,
      prepaid,
    });
    remMonths--;
  }
  return schedule;
}

function _monthsElapsed(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now   = new Date();
  const diff  = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return Math.max(0, diff);
}

function _getLoanStats(loan) {
  const schedule      = calcAmortizationFull(loan);
  const elapsed       = _monthsElapsed(loan.startDate);
  const paidMonths    = Math.min(elapsed, schedule.length);
  const paid          = schedule.slice(0, paidMonths);
  const principalPaid = paid.reduce((s, r) => s + r.principal, 0);
  const interestPaid  = paid.reduce((s, r) => s + r.interest,  0);
  const emi           = schedule[paidMonths]?.emi ?? schedule[schedule.length - 1]?.emi ?? calcEmi(loan.principal, loan.interestRate, loan.tenureMonths);
  const outstanding   = schedule[paidMonths - 1]?.balance ?? (paidMonths === 0 ? loan.principal : 0);
  const remaining     = schedule.length - paidMonths;
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const progress      = schedule.length > 0 ? (paidMonths / schedule.length) * 100 : 0;
  const payoffDate    = schedule.length > 0 ? schedule[schedule.length - 1].date : '';
  return { emi, paidMonths, principalPaid, interestPaid, outstanding, remaining, totalInterest, progress, payoffDate };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _showError(msg) {
  const el = document.getElementById('loan-error-banner');
  if (el) { el.textContent = msg; el.classList.remove('d-none'); }
}

function _hideError() {
  const el = document.getElementById('loan-error-banner');
  if (el) el.classList.add('d-none');
}

const TYPE_ICONS = {
  Home: 'bi-house-fill', Car: 'bi-car-front-fill', Personal: 'bi-person-fill',
  Education: 'bi-mortarboard-fill', Gold: 'bi-gem', Business: 'bi-briefcase-fill', Other: 'bi-bank2',
};

const TYPE_COLORS = {
  Home: '#3b82f6', Car: '#f59e0b', Personal: '#8b5cf6',
  Education: '#10b981', Gold: '#f97316', Business: '#6366f1', Other: '#64748b',
};

// ─── render ──────────────────────────────────────────────────────────────────────────────

export function render() {
  const all    = store.get('loans') ?? [];
  const active = all.filter(l => l.status === 'active');
  const search  = _loanFilter.search.toLowerCase();
  const typeF   = _loanFilter.type;
  const statusF = _loanFilter.status;

  const filtered = all.filter(l =>
    (!search  || l.name.toLowerCase().includes(search) || (l.accountRef ?? '').toLowerCase().includes(search)) &&
    (!typeF   || l.type   === typeF) &&
    (!statusF || l.status === statusF)
  );

  const activeStats       = active.map(l => _getLoanStats(l));
  const totalOutstanding  = activeStats.reduce((s, st) => s + st.outstanding, 0);
  const totalMonthlyEmi   = activeStats.reduce((s, st) => s + st.emi, 0);
  const totalIntRemaining = activeStats.reduce((s, st) => s + (st.totalInterest - st.interestPaid), 0);

  const _el = id => document.getElementById(id);
  if (_el('loan-stat-outstanding')) _el('loan-stat-outstanding').textContent = formatCurrency(Math.round(totalOutstanding));
  if (_el('loan-stat-emi'))         _el('loan-stat-emi').textContent         = formatCurrency(Math.round(totalMonthlyEmi));
  if (_el('loan-stat-active'))      _el('loan-stat-active').textContent      = active.length;
  if (_el('loan-stat-interest'))    _el('loan-stat-interest').textContent    = formatCurrency(Math.round(totalIntRemaining));
  if (_el('loan-count'))            _el('loan-count').textContent            = filtered.length || '';

  const heroSub = _el('loan-hero-sub');
  if (heroSub) {
    if (all.length) {
      const latestPayoff = active.map(l => _getLoanStats(l).payoffDate).filter(Boolean).sort().pop();
      const payoffYear   = latestPayoff ? new Date(latestPayoff).getFullYear() : null;
      heroSub.innerHTML  = `<strong style="color:#fca5a5;font-weight:700">${active.length}</strong> active loan${active.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${formatCurrency(Math.round(totalMonthlyEmi))}/mo EMI${payoffYear ? ` &nbsp;·&nbsp; running until <strong style="color:#fca5a5">${payoffYear}</strong>` : ''}`;
    } else {
      heroSub.textContent = 'Track EMI schedule, outstanding balance & payoff date';
    }
  }

  const container = document.getElementById('loans-list');
  if (!container) return;

  if (all.length === 0) {
    container.innerHTML = `<div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 8px 32px rgba(239,68,68,.3)">
        <i class="bi bi-bank2"></i>
      </div>
      <div class="ep-es-title">No loans tracked yet</div>
      <div class="ep-es-subtitle">Add your home, car or personal loan to track EMI schedule, outstanding balance &amp; payoff date.</div>
      <button class="btn loan-add-btn ep-es-cta" data-bs-toggle="modal" data-bs-target="#oc-loan">
        <i class="bi bi-plus-circle-fill me-2"></i>Add First Loan
      </button>
    </div>`;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="ep-empty-state">
      <div class="ep-es-icon-wrap" style="background:linear-gradient(135deg,#ef4444,#b91c1c);box-shadow:0 8px 32px rgba(239,68,68,.3)">
        <i class="bi bi-bank2"></i>
      </div>
      <div class="ep-es-title">No loans match your filters</div>
      <div class="ep-es-subtitle">Try clearing the filters to see all loans.</div>
    </div>`;
    return;
  }

  const activeFiltered = filtered.filter(l => l.status !== 'closed');
  const closedFiltered = filtered.filter(l => l.status === 'closed');
  const sorted = [...activeFiltered, ...closedFiltered];

  let html = sorted.map((loan, idx) => {
    const isFirstClosed = loan.status === 'closed' && (idx === 0 || sorted[idx - 1].status !== 'closed');
    const divider = isFirstClosed && activeFiltered.length > 0
      ? `<div class="loan-section-divider"><span>Closed Loans</span><span class="loan-section-divider-count">${closedFiltered.length}</span></div>`
      : '';
    return divider + _renderCard(loan);
  }).join('');

  container.innerHTML = html;

  container.querySelectorAll('[data-loan-schedule]').forEach(btn =>
    btn.addEventListener('click', () => _showSchedule(btn.dataset.loanSchedule)));
  container.querySelectorAll('[data-loan-edit]').forEach(btn =>
    btn.addEventListener('click', () => _startEdit(btn.dataset.loanEdit)));
  container.querySelectorAll('[data-loan-delete]').forEach(btn =>
    btn.addEventListener('click', () => _deleteLoan(btn.dataset.loanDelete)));
  container.querySelectorAll('[data-loan-close]').forEach(btn =>
    btn.addEventListener('click', () => _closeLoan(btn.dataset.loanClose)));
}

function _renderCard(loan) {
  const stats  = _getLoanStats(loan);
  const icon   = TYPE_ICONS[loan.type] ?? 'bi-bank2';
  const color  = TYPE_COLORS[loan.type] ?? '#64748b';
  const closed = loan.status === 'closed';

  // Progress bar colour: red <20%, amber 20-60%, green >60%
  const pColor = stats.progress >= 60 ? '#10b981' : stats.progress >= 20 ? '#f59e0b' : '#ef4444';

  // Card left border
  const cardBorder = closed
    ? 'border-left:3px solid #10b981'
    : stats.remaining <= 3
    ? 'border-left:3px solid #10b981'
    : stats.remaining <= 6
    ? 'border-left:3px solid #f59e0b'
    : '';

  // Dynamic interest row modifier
  const intRatio = stats.totalInterest > 0 ? stats.interestPaid / stats.totalInterest : 0;
  const intRowMod = intRatio > 0.7 ? ' loan-interest-row--green'
    : intRatio > 0.3 ? ' loan-interest-row--amber'
    : '';

  // Prepayments — show real data, no fake savings estimate
  const prepayments  = loan.prepayments ?? [];
  const totalPrepaid = prepayments.reduce((s, p) => s + Number(p.amount), 0);
  const prepChip = totalPrepaid > 0
    ? `<div class="loan-savings-chip"><i class="bi bi-piggy-bank-fill me-1"></i>${prepayments.length} prepayment${prepayments.length > 1 ? 's' : ''} &nbsp;·&nbsp; ${formatCurrency(Math.round(totalPrepaid))} total prepaid</div>`
    : '';

  return `
  <div class="loan-card${closed ? ' loan-card--closed' : ''}"${cardBorder ? ` style="${cardBorder}"` : ''}>
    <div class="loan-card-top">
      <div class="loan-card-icon" style="background:${color}18;color:${color}"><i class="bi ${icon}"></i></div>
      <div class="loan-card-info">
        <div class="loan-card-name">${esc(loan.name)}</div>
        <div class="loan-card-meta">
          <span class="loan-type-chip" style="color:${color};background:${color}15">${esc(loan.type)}</span>
          ${closed ? `<span class="loan-closed-chip">Closed</span>` : ''}
          ${loan.accountRef ? `<span class="loan-account-ref"><i class="bi bi-bank2 me-1"></i>${esc(loan.accountRef)}</span>` : ''}
        </div>
      </div>
      <div class="loan-emi-chip" style="border-color:${color}30;color:${color};background:${color}08">
        <div class="loan-emi-chip-label">EMI / mo</div>
        <div class="loan-emi-chip-value">${closed ? '—' : formatCurrency(Math.round(stats.emi))}</div>
      </div>
    </div>

    <div class="loan-card-stats">
      <div class="loan-stat-item">
        <div class="loan-stat-label">Paid So Far</div>
        <div class="loan-stat-value" style="color:#10b981">${formatCurrency(Math.round(stats.principalPaid))}</div>
      </div>
      <div class="loan-stat-item">
        <div class="loan-stat-label">Outstanding</div>
        <div class="loan-stat-value" style="color:${closed ? '#10b981' : '#ef4444'}">${closed ? '₹0' : formatCurrency(Math.round(stats.outstanding))}</div>
      </div>
      <div class="loan-stat-item">
        <div class="loan-stat-label">Rate (p.a.)</div>
        <div class="loan-stat-value">${loan.interestRate}%</div>
      </div>
      <div class="loan-stat-item">
        <div class="loan-stat-label">${closed ? 'Tenure' : 'Remaining'}</div>
        <div class="loan-stat-value">${closed ? loan.tenureMonths + ' mo' : stats.remaining + ' mo'}</div>
      </div>
    </div>

    ${closed
      ? `<div class="loan-fully-paid"><i class="bi bi-check-circle-fill me-2"></i>Fully paid off &nbsp;·&nbsp; Total interest paid: <strong>${formatCurrency(Math.round(stats.totalInterest))}</strong></div>`
      : `<div class="loan-interest-row${intRowMod}">
          <span><i class="bi bi-cash-stack me-1"></i>Interest paid: <strong>${formatCurrency(Math.round(stats.interestPaid))}</strong></span>
          <span><i class="bi bi-clock me-1"></i>Remaining: <strong>${formatCurrency(Math.round(stats.totalInterest - stats.interestPaid))}</strong></span>
        </div>`
    }

    ${prepChip}

    ${!closed ? `
    <div class="loan-progress-wrap">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span style="font-size:.72rem;color:#64748b">${stats.paidMonths} of ${stats.paidMonths + stats.remaining} EMIs paid</span>
        <span style="font-size:.72rem;font-weight:600;color:${pColor}">${stats.progress.toFixed(0)}%</span>
      </div>
      <div class="loan-progress-bar-bg">
        <div class="loan-progress-bar-fill" style="width:${stats.progress.toFixed(1)}%;background:${pColor}"></div>
      </div>
      <div class="d-flex justify-content-between align-items-center mt-1">
        <span style="font-size:.7rem;color:#64748b">Started ${formatDate(loan.startDate)}</span>
        <span class="loan-payoff-chip"><i class="bi bi-flag-fill me-1"></i>Payoff ${formatDate(stats.payoffDate)}</span>
      </div>
    </div>` : ''}

    ${loan.notes ? `<div class="loan-notes"><i class="bi bi-chat-left-text me-1"></i>${esc(loan.notes)}</div>` : ''}

    <div class="loan-card-footer">
      <button class="loan-btn-ghost" data-loan-schedule="${esc(loan.id)}">
        <i class="bi bi-table me-1"></i>Schedule
      </button>
      <div class="loan-footer-right">
        ${!closed ? `<button class="loan-btn-ghost loan-btn-ghost--green" data-loan-close="${esc(loan.id)}">
          <i class="bi bi-check-circle me-1"></i>Close
        </button>` : ''}
        <button class="loan-btn-ghost" data-loan-edit="${esc(loan.id)}">
          <i class="bi bi-pencil-fill"></i>
        </button>
        <button class="loan-btn-ghost loan-btn-ghost--danger" data-loan-delete="${esc(loan.id)}">
          <i class="bi bi-trash-fill"></i>
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Schedule modal ───────────────────────────────────────────────────────────

function _showSchedule(id) {
  const loan = (store.get('loans') ?? []).find(l => l.id === id);
  if (!loan) return;
  const stats    = _getLoanStats(loan);
  const schedule = calcAmortizationFull(loan);
  const totalInt = schedule.reduce((s, r) => s + r.interest, 0);
  const totalPayable = schedule.reduce((s, r) => s + r.emi, 0)
    + (loan.prepayments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const body = document.getElementById('loan-schedule-body');
  if (body) {
    body.innerHTML = schedule.map(row => {
      const events = [];
      if (row.disbursed)    events.push(`<span class="badge bg-info-subtle text-info ms-1">+${formatCurrency(row.disbursed)} disbursed</span>`);
      if (row.rateChanged !== null) events.push(`<span class="badge bg-warning-subtle text-warning ms-1">${row.rateChanged}% rate</span>`);
      if (row.prepaid)      events.push(`<span class="badge bg-success-subtle text-success ms-1">${formatCurrency(row.prepaid)} prepaid</span>`);
      return `
      <tr${row.month <= stats.paidMonths ? ' class="loan-row-paid"' : ''}>
        <td>${row.month}</td>
        <td>${formatDate(row.date)}${events.join('')}</td>
        <td>${formatCurrency(row.emi)}</td>
        <td>${formatCurrency(row.principal)}</td>
        <td>${formatCurrency(row.interest)}</td>
        <td>${formatCurrency(row.balance)}</td>
      </tr>`;
    }).join('');
  }

  const title = document.getElementById('loan-schedule-title');
  if (title) title.textContent = `${loan.name} — Amortization Schedule`;

  const summary = document.getElementById('loan-schedule-summary');
  if (summary) {
    summary.innerHTML = `
      <span><i class="bi bi-calendar3 me-1"></i>EMI: <strong>${formatCurrency(Math.round(stats.emi))}/mo</strong></span>
      <span><i class="bi bi-bank2 me-1"></i>Total Interest: <strong>${formatCurrency(Math.round(totalInt))}</strong></span>
      <span><i class="bi bi-cash-stack me-1"></i>Total Payable: <strong>${formatCurrency(Math.round(totalPayable))}</strong></span>
      <span><i class="bi bi-check-circle me-1 text-success"></i>Paid EMIs: <strong>${stats.paidMonths} / ${schedule.length}</strong></span>`;
  }

  const modal = document.getElementById('oc-loan-schedule');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

// ─── Edit ──────────────────────────────────────────────────────────────────────

let _editId = null;

function _startEdit(id) {
  const loan = (store.get('loans') ?? []).find(l => l.id === id);
  if (!loan) return;
  _editId = id;
  _fillForm(loan);
  const label = document.getElementById('oc-loan-label');
  if (label) label.innerHTML = '<i class="bi bi-pencil-fill me-2 text-warning"></i>Edit Loan';
  const btn = document.getElementById('loan-submit-btn');
  if (btn) btn.textContent = 'Save Changes';
  const modal = document.getElementById('oc-loan');
  if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

function _fillForm(loan) {
  const _f = id => document.getElementById(id);
  if (_f('loan-name'))          _f('loan-name').value          = loan.name;
  if (_f('loan-type'))          _f('loan-type').value          = loan.type;
  if (_f('loan-principal'))     _f('loan-principal').value     = loan.principal;
  if (_f('loan-interest-rate')) _f('loan-interest-rate').value = loan.interestRate;
  if (_f('loan-tenure'))        _f('loan-tenure').value        = loan.tenureMonths;
  if (_f('loan-start-date'))    _f('loan-start-date').value    = loan.startDate;
  if (_f('loan-account-ref'))   _f('loan-account-ref').value   = loan.accountRef ?? '';
  if (_f('loan-notes'))         _f('loan-notes').value         = loan.notes ?? '';
  _renderDisbList(loan.disbursements ?? []);
  _renderRateList(loan.rateChanges   ?? []);
  _renderPrepList(loan.prepayments   ?? []);
  _updateEmiPreview();
}

function _resetForm() {
  _editId = null;
  const form = document.getElementById('loan-form');
  if (form) form.reset();
  _hideError();
  const label = document.getElementById('oc-loan-label');
  if (label) label.innerHTML = '<i class="bi bi-bank2 me-2 text-primary"></i>Add Loan';
  const btn = document.getElementById('loan-submit-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Add Loan'; }
  document.getElementById('loan-emi-preview')?.classList.add('d-none');
  _renderDisbList([]);
  _renderRateList([]);
  _renderPrepList([]);
}

function _updateEmiPreview() {
  const principal = parseFloat(document.getElementById('loan-principal')?.value) || 0;
  const rate      = parseFloat(document.getElementById('loan-interest-rate')?.value) || 0;
  const tenure    = parseInt(document.getElementById('loan-tenure')?.value)  || 0;
  const preview   = document.getElementById('loan-emi-preview');
  if (!preview) return;
  if (principal > 0 && tenure > 0) {
    const emi  = calcEmi(principal, rate, tenure);
    const totalInterest = emi * tenure - principal;
    preview.innerHTML = `<i class="bi bi-info-circle me-1"></i>EMI: <strong>${formatCurrency(Math.round(emi))}/mo</strong> &nbsp;·&nbsp; Total Interest: <strong>${formatCurrency(Math.round(totalInterest))}</strong> &nbsp;·&nbsp; Total Payable: <strong>${formatCurrency(Math.round(emi * tenure))}</strong>`;
    preview.classList.remove('d-none');
  } else {
    preview.classList.add('d-none');
  }
}

// ─── Dynamic list helpers (disbursements / rate changes / prepayments) ────────

function _renderDisbList(items) {
  const el = document.getElementById('loan-disb-list');
  if (!el) return;
  el.innerHTML = items.map((d, i) => `
    <div class="d-flex gap-2 align-items-center mb-1" data-disb="${i}">
      <input type="date" class="form-control form-control-sm" value="${esc(d.date)}" placeholder="Date" />
      <input type="number" class="form-control form-control-sm" value="${esc(d.amount)}" placeholder="Amount (₹)" min="1" step="1" />
      <button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-disb]').remove()"><i class="bi bi-trash"></i></button>
    </div>`).join('');
}

function _renderRateList(items) {
  const el = document.getElementById('loan-rate-list');
  if (!el) return;
  el.innerHTML = items.map((r, i) => `
    <div class="d-flex gap-2 align-items-center mb-1" data-rate="${i}">
      <input type="date" class="form-control form-control-sm" value="${esc(r.date)}" placeholder="Effective Date" />
      <input type="number" class="form-control form-control-sm" value="${esc(r.rate)}" placeholder="New Rate (%)" min="0" step="0.01" />
      <button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-rate]').remove()"><i class="bi bi-trash"></i></button>
    </div>`).join('');
}

function _renderPrepList(items) {
  const el = document.getElementById('loan-prep-list');
  if (!el) return;
  el.innerHTML = items.map((p, i) => `
    <div class="d-flex gap-2 align-items-center mb-1" data-prep="${i}">
      <input type="date" class="form-control form-control-sm" value="${esc(p.date)}" placeholder="Date" />
      <input type="number" class="form-control form-control-sm" value="${esc(p.amount)}" placeholder="Amount (₹)" min="1" step="1" />
      <select class="form-select form-select-sm" style="max-width:130px">
        <option value="tenure"${(p.adjustType ?? 'tenure') === 'tenure' ? ' selected' : ''}>Reduce Tenure</option>
        <option value="emi"${p.adjustType === 'emi' ? ' selected' : ''}>Reduce EMI</option>
      </select>
      <button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-prep]').remove()"><i class="bi bi-trash"></i></button>
    </div>`).join('');
}

function _readDisbList() {
  return [...(document.querySelectorAll('#loan-disb-list [data-disb]') ?? [])].map(row => ({
    date:   row.querySelectorAll('input')[0]?.value ?? '',
    amount: parseFloat(row.querySelectorAll('input')[1]?.value) || 0,
  })).filter(d => d.date && d.amount > 0);
}

function _readRateList() {
  return [...(document.querySelectorAll('#loan-rate-list [data-rate]') ?? [])].map(row => ({
    date: row.querySelectorAll('input')[0]?.value ?? '',
    rate: parseFloat(row.querySelectorAll('input')[1]?.value) || 0,
  })).filter(r => r.date && r.rate > 0);
}

function _readPrepList() {
  return [...(document.querySelectorAll('#loan-prep-list [data-prep]') ?? [])].map(row => ({
    date:       row.querySelectorAll('input')[0]?.value ?? '',
    amount:     parseFloat(row.querySelectorAll('input')[1]?.value) || 0,
    adjustType: row.querySelector('select')?.value ?? 'tenure',
  })).filter(p => p.date && p.amount > 0);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function _deleteLoan(id) {
  if (!await epConfirm('Delete this loan record?')) return;
  const all = (store.get('loans') ?? []).filter(l => l.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.loans, all.map(serialize));
    store.set('loans', all);
  } catch (err) {
    _showError(err.message || 'Failed to delete loan.');
  }
}

async function _closeLoan(id) {
  if (!await epConfirm('Mark this loan as fully paid off?', 'Close Loan', 'Close')) return;
  const all     = store.get('loans') ?? [];
  const updated = all.map(l => l.id === id ? { ...l, status: 'closed' } : l);
  try {
    await writeAllRows(CONFIG.sheets.loans, updated.map(serialize));
    store.set('loans', updated);
  } catch (err) {
    _showError(err.message || 'Failed to update loan.');
  }
}

// ─── Form binding ─────────────────────────────────────────────────────────────

function _bindForm() {
  const form = document.getElementById('loan-form');
  if (!form) return;

  ['loan-principal', 'loan-interest-rate', 'loan-tenure'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', _updateEmiPreview));

  document.getElementById('loan-add-disb')?.addEventListener('click', () => {
    const el = document.getElementById('loan-disb-list');
    if (!el) return;
    const idx = el.children.length;
    const div = document.createElement('div');
    div.dataset.disb = idx;
    div.className = 'd-flex gap-2 align-items-center mb-1';
    div.innerHTML = `<input type="date" class="form-control form-control-sm" /><input type="number" class="form-control form-control-sm" placeholder="Amount (₹)" min="1" step="1" /><button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-disb]').remove()"><i class="bi bi-trash"></i></button>`;
    el.appendChild(div);
  });

  document.getElementById('loan-add-rate')?.addEventListener('click', () => {
    const el = document.getElementById('loan-rate-list');
    if (!el) return;
    const idx = el.children.length;
    const div = document.createElement('div');
    div.dataset.rate = idx;
    div.className = 'd-flex gap-2 align-items-center mb-1';
    div.innerHTML = `<input type="date" class="form-control form-control-sm" /><input type="number" class="form-control form-control-sm" placeholder="New Rate (%)" min="0" step="0.01" /><button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-rate]').remove()"><i class="bi bi-trash"></i></button>`;
    el.appendChild(div);
  });

  document.getElementById('loan-add-prep')?.addEventListener('click', () => {
    const el = document.getElementById('loan-prep-list');
    if (!el) return;
    const idx = el.children.length;
    const div = document.createElement('div');
    div.dataset.prep = idx;
    div.className = 'd-flex gap-2 align-items-center mb-1';
    div.innerHTML = `<input type="date" class="form-control form-control-sm" /><input type="number" class="form-control form-control-sm" placeholder="Amount (₹)" min="1" step="1" /><select class="form-select form-select-sm" style="max-width:130px"><option value="tenure">Reduce Tenure</option><option value="emi">Reduce EMI</option></select><button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('[data-prep]').remove()"><i class="bi bi-trash"></i></button>`;
    el.appendChild(div);
  });

  const modal = document.getElementById('oc-loan');
  if (modal) modal.addEventListener('hidden.bs.modal', _resetForm);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    _hideError();

    const name         = document.getElementById('loan-name')?.value.trim()         ?? '';
    const type         = document.getElementById('loan-type')?.value                ?? 'Personal';
    const principal    = parseFloat(document.getElementById('loan-principal')?.value)     || 0;
    const rate         = parseFloat(document.getElementById('loan-interest-rate')?.value) ?? 0;
    const tenure       = parseInt(document.getElementById('loan-tenure')?.value)          || 0;
    const startDate    = document.getElementById('loan-start-date')?.value          ?? '';
    const accountRef   = document.getElementById('loan-account-ref')?.value.trim()  ?? '';
    const notes        = document.getElementById('loan-notes')?.value.trim()        ?? '';
    const disbursements = _readDisbList();
    const rateChanges   = _readRateList();
    const prepayments   = _readPrepList();

    if (!name)          return _showError('Loan name is required.');
    if (principal <= 0) return _showError('Principal must be greater than 0.');
    if (tenure <= 0)    return _showError('Tenure (months) must be greater than 0.');
    if (!startDate)     return _showError('Start date is required.');
    if (rate < 0)       return _showError('Interest rate cannot be negative.');

    const btn = document.getElementById('loan-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const all = store.get('loans') ?? [];
      if (_editId) {
        const updated = all.map(l => l.id === _editId
          ? { ...l, name, type, principal, interestRate: rate, tenureMonths: tenure, startDate, accountRef, notes, disbursements, rateChanges, prepayments }
          : l);
        await writeAllRows(CONFIG.sheets.loans, updated.map(serialize));
        store.set('loans', updated);
      } else {
        const id  = 'loan_' + Date.now();
        const rec = { id, name, type, principal, interestRate: rate, tenureMonths: tenure, startDate, accountRef, notes, status: 'active', disbursements, rateChanges, prepayments };
        await appendRow(CONFIG.sheets.loans, serialize(rec));
        store.set('loans', [...all, rec]);
      }
      bootstrap.Modal.getInstance(document.getElementById('oc-loan'))?.hide();
      _resetForm();
    } catch (err) {
      _showError(err.message || 'Failed to save loan.');
      if (btn) { btn.disabled = false; btn.textContent = _editId ? 'Save Changes' : 'Add Loan'; }
    }
  });
}

// ─── Filter binding ───────────────────────────────────────────────────────────

function _buildTypeMenu() {
  const all   = store.get('loans') ?? [];
  const types = [...new Set(all.map(l => l.type).filter(Boolean))];
  const menu  = document.getElementById('loan-type-menu');
  const btn   = document.getElementById('loan-type-btn');
  if (!menu) return;

  // Only show types that exist in actual loan data
  const list = types.length > 0 ? types : ['Home','Car','Personal','Education','Gold','Business','Other'];

  menu.innerHTML = `<div class="fdd-item${!_loanFilter.type ? ' fdd-item--active' : ''}" data-loan-type="">All Types</div>` +
    list.map(t => `<div class="fdd-item${_loanFilter.type === t ? ' fdd-item--active' : ''}" data-loan-type="${t}">${t}</div>`).join('');

  menu.querySelectorAll('[data-loan-type]').forEach(item => {
    item.addEventListener('click', () => {
      _loanFilter.type = item.dataset.loanType;
      btn.innerHTML = _loanFilter.type
        ? `<i class="bi bi-tag me-1"></i>${_loanFilter.type} <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`
        : `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      menu.classList.add('d-none');
      render();
    });
  });
}

function _bindLoanFilters() {
  const searchEl = document.getElementById('loan-search');

  const typeBtn  = document.getElementById('loan-type-btn');
  const typeMenu = document.getElementById('loan-type-menu');
  if (typeBtn && typeMenu) {
    typeBtn.addEventListener('click', e => {
      e.stopPropagation();
      _buildTypeMenu();
      typeMenu.classList.toggle('fdd-open');
    });
    document.addEventListener('click', () => typeMenu.classList.remove('fdd-open'));
  }

  document.querySelectorAll('[data-loan-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _loanFilter.status = btn.dataset.loanPreset;
      document.querySelectorAll('[data-loan-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (typeBtn) typeBtn.innerHTML = `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      _loanFilter.type = '';
      _updateResetBtn();
      render();
    });
  });

  const resetBtn = document.getElementById('loan-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _loanFilter.search = ''; _loanFilter.type = ''; _loanFilter.status = '';
      const searchEl = document.getElementById('loan-search');
      if (searchEl) searchEl.value = '';
      if (typeBtn) typeBtn.innerHTML = `<i class="bi bi-tag me-1"></i>Type <i class="bi bi-chevron-down ms-1 fdd-chevron"></i>`;
      document.querySelectorAll('[data-loan-preset]').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-loan-preset=""]')?.classList.add('active');
      _updateResetBtn();
      render();
    });
  }

  if (searchEl) searchEl.addEventListener('input', () => { _loanFilter.search = searchEl.value; _updateResetBtn(); render(); });
}

function _updateResetBtn() {
  const btn = document.getElementById('loan-reset-filters');
  if (!btn) return;
  const active = _loanFilter.search || _loanFilter.type || _loanFilter.status;
  btn.classList.toggle('d-none', !active);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function initLoans() {
  _bindForm();
  _bindLoanFilters();
  store.on('loans', render);
}

export function renderLoans() {
  render();
}
