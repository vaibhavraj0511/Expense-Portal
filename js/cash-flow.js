// js/cash-flow.js — Cash Flow Forecast module
import * as store from './store.js';
import { formatCurrency } from './utils.js';

const FORECAST_DAYS = 90;

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ─── Build future events from recurring, bills, loans ─────────────────────────

function _buildForecastEvents(days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = _addDays(today, days);

  const events = [];

  // 1. Recurring transactions
  const recurring = store.get('recurring') ?? [];
  recurring.filter(r => !r.paused).forEach(r => {
    const startD = new Date(today);
    for (let offset = 0; offset <= days; offset++) {
      const d = _addDays(today, offset);
      let match = false;
      if (r.frequency === 'monthly' && d.getDate() === r.day) match = true;
      if (r.frequency === 'weekly'  && d.getDay()  === r.day % 7) match = true;
      if (match) {
        events.push({
          date: _localDateStr(d),
          label: r.description || r.category,
          amount: r.type === 'income' ? Number(r.amount) : -Number(r.amount),
          type: r.type,
          source: 'recurring',
          icon: r.type === 'income' ? 'bi-arrow-down-circle-fill' : 'bi-arrow-repeat',
          color: r.type === 'income' ? '#10b981' : '#6366f1',
        });
      }
    }
  });

  // 2. Bills (active, monthly/yearly)
  const bills = store.get('bills') ?? [];
  bills.filter(b => b.active).forEach(b => {
    for (let offset = 0; offset <= days; offset++) {
      const d = _addDays(today, offset);
      let match = false;
      if (b.frequency === 'monthly' && d.getDate() === b.dueDay) match = true;
      if (b.frequency === 'yearly'  && d.getDate() === b.dueDay && d.getMonth() === (b.dueMonth ? b.dueMonth - 1 : 0)) match = true;
      if (b.frequency === 'quarterly' && d.getDate() === b.dueDay && ((d.getMonth() - (b.dueMonth ? b.dueMonth - 1 : 0) + 12) % 3 === 0)) match = true;
      if (match) {
        events.push({
          date: _localDateStr(d),
          label: b.name,
          amount: -Number(b.amount),
          type: 'expense',
          source: 'bill',
          icon: 'bi-receipt',
          color: '#f59e0b',
        });
      }
    }
  });

  // 3. Loan EMIs — compute EMI from principal/rate/tenure
  const loans = store.get('loans') ?? [];
  loans.filter(l => l.status === 'active' || !l.status).forEach(l => {
    const p = Number(l.principal) || 0;
    const rAnnual = Number(l.interestRate) || 0;
    const n = Number(l.tenureMonths) || 0;
    if (p <= 0 || n <= 0) return;
    let emiAmt;
    if (rAnnual === 0) {
      emiAmt = p / n;
    } else {
      const r = rAnnual / 12 / 100;
      emiAmt = p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    }
    const emiDay = l.startDate ? new Date(l.startDate + 'T00:00:00').getDate() : 1;
    for (let offset = 0; offset <= days; offset++) {
      const d = _addDays(today, offset);
      if (d.getDate() === emiDay) {
        events.push({
          date: _localDateStr(d),
          label: (l.name || 'Loan') + ' EMI',
          amount: -Math.round(emiAmt),
          type: 'expense',
          source: 'loan',
          icon: 'bi-bank2',
          color: '#ef4444',
        });
      }
    }
  });

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Get current account balance ─────────────────────────────────────────────

function _currentBalance() {
  const accounts  = store.get('accounts')  ?? [];
  const expenses  = store.get('expenses')  ?? [];
  const income    = store.get('income')    ?? [];
  const transfers = store.get('transfers') ?? [];
  const ccPayments = store.get('ccPayments') ?? [];

  let bal = accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
  income.forEach(r => bal += Number(r.amount) || 0);
  expenses.forEach(r => bal -= Number(r.amount) || 0);
  transfers.forEach(r => bal -= 0); // transfers are internal
  ccPayments.forEach(r => bal -= Number(r.amount) || 0);
  return bal;
}

// ─── Render ───────────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('cashflow-container');
  if (!container) return;

  const events = _buildForecastEvents(FORECAST_DAYS);
  const startBal = _currentBalance();

  // Summary cards
  const totalIn  = events.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const totalOut = events.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
  const endBal   = startBal + totalIn - totalOut;
  const lowestBal = (() => {
    let running = startBal;
    let min = startBal;
    events.forEach(e => { running += e.amount; if (running < min) min = running; });
    return min;
  })();

  const statEl   = document.getElementById('cf-stat-current');
  const inEl     = document.getElementById('cf-stat-in');
  const outEl    = document.getElementById('cf-stat-out');
  const endEl    = document.getElementById('cf-stat-end');
  const lowestEl = document.getElementById('cf-stat-lowest');
  if (statEl)   statEl.textContent   = formatCurrency(startBal);
  if (inEl)     inEl.textContent     = formatCurrency(totalIn);
  if (outEl)    outEl.textContent    = formatCurrency(totalOut);
  if (endEl)    endEl.textContent    = formatCurrency(endBal);
  if (lowestEl) { lowestEl.textContent = formatCurrency(lowestBal); lowestEl.style.color = lowestBal < 0 ? '#ef4444' : '#10b981'; }

  if (events.length === 0) {
    container.innerHTML = `<div class="ep-empty-state"><i class="bi bi-calendar-x" style="font-size:2rem;color:#94a3b8"></i><p class="mt-2 text-muted">No scheduled transactions found.<br><small>Add recurring transactions, bills, or loans to see your forecast.</small></p></div>`;
    return;
  }

  // Build day-by-day timeline
  let running = startBal;
  const rows = [];
  let prevDate = '';

  events.forEach(e => {
    running += e.amount;
    const isNeg = running < 0;
    const dateLabel = e.date !== prevDate ? `<div class="cf-date-sep">${new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}</div>` : '';
    prevDate = e.date;

    rows.push(`
      ${dateLabel}
      <div class="cf-row">
        <div class="cf-icon" style="color:${e.color}"><i class="bi ${e.icon}"></i></div>
        <div class="cf-info">
          <div class="cf-label">${escapeHtml(e.label)}</div>
          <div class="cf-source">${escapeHtml(e.source)}</div>
        </div>
        <div class="cf-amount" style="color:${e.amount >= 0 ? '#10b981' : '#ef4444'}">${e.amount >= 0 ? '+' : ''}${formatCurrency(Math.abs(e.amount))}</div>
        <div class="cf-balance ${isNeg ? 'cf-balance--neg' : ''}">${formatCurrency(running)}</div>
      </div>
    `);
  });

  container.innerHTML = `<div class="cf-timeline">${rows.join('')}</div>`;

  // Warnings
  const warnEl = document.getElementById('cf-warnings');
  if (warnEl) {
    const warns = [];
    if (lowestBal < 0) warns.push(`<div class="alert alert-danger py-2 small mb-2"><i class="bi bi-exclamation-triangle-fill me-1"></i>Balance may go negative (${formatCurrency(lowestBal)}) within ${FORECAST_DAYS} days.</div>`);
    else if (lowestBal < startBal * 0.2) warns.push(`<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-exclamation-circle me-1"></i>Balance may drop to ${formatCurrency(lowestBal)} — consider reviewing upcoming expenses.</div>`);
    warnEl.innerHTML = warns.join('');
  }
}

export function init() {
  const keys = ['recurring', 'bills', 'loans', 'accounts', 'expenses', 'income', 'transfers', 'ccPayments'];
  keys.forEach(k => store.on(k, render));

  const rangeEl = document.getElementById('cf-range');
  if (rangeEl) {
    rangeEl.addEventListener('change', render);
  }
}
