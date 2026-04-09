// js/accounts.js — Account & credit card management module
// Requirements: 11.1–11.8, 1.2

import { CONFIG } from './config.js';
import { appendRow, fetchRows, writeAllRows } from './api.js';
import * as store from './store.js';
import { requireFields, requirePositiveNumber } from './validation.js';
import { formatCurrency, formatDate } from './utils.js';
import { epConfirm } from './confirm.js';

// ─── Balance History Chart ────────────────────────────────────────────────────
let _balanceChart = null;

export function renderBalanceHistoryChart() {
  const canvas = document.getElementById('balance-history-chart');
  const emptyEl = document.getElementById('balance-history-empty');
  if (!canvas) return;

  // Always destroy existing chart first to prevent "canvas already in use" error
  if (_balanceChart) { _balanceChart.destroy(); _balanceChart = null; }

  const accounts   = store.get('accounts')   ?? [];
  const expenses    = store.get('expenses')   ?? [];
  const income      = store.get('income')     ?? [];
  const transfers   = store.get('transfers')  ?? [];
  const ccPayments  = store.get('ccPayments') ?? [];

  if (accounts.length === 0) {
    if (emptyEl) emptyEl.classList.remove('d-none');
    canvas.style.display = 'none';
    return;
  }

  // Collect all dated events per account
  const COLORS = ['#6366f1','#10b981','#ef4444','#f59e0b','#f97316','#ec4899','#06b6d4','#14b8a6'];
  const datasets = [];

  accounts.forEach((a, ai) => {
    // Build list of {date, delta} events
    const events = [];
    income.filter(r => r.receivedIn === a.name && r.date).forEach(r => events.push({ date: r.date, delta: r.amount }));
    expenses.filter(r => r.paymentMethod === a.name && r.date).forEach(r => events.push({ date: r.date, delta: -r.amount }));
    transfers.filter(r => r.destinationAccount === a.name && r.date).forEach(r => events.push({ date: r.date, delta: r.amount }));
    transfers.filter(r => r.sourceAccount === a.name && r.date).forEach(r => events.push({ date: r.date, delta: -r.amount }));
    // CC bill payments deduct from the bank account — include them so the chart matches computeBalance()
    ccPayments.filter(r => r.paidFromAccount === a.name && r.date).forEach(r => events.push({ date: r.date, delta: -r.amount }));

    if (events.length === 0 && !(a.initialBalance > 0)) return; // skip accounts with no data at all

    // If no events but has initial balance, show a flat line
    if (events.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const color = COLORS[ai % COLORS.length];
      datasets.push({
        label: a.name,
        data: [a.initialBalance, a.initialBalance],
        labels: [today, today],
        borderColor: color,
        backgroundColor: color + '22',
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0,
        spanGaps: true,
      });
      return;
    }

    events.sort((a, b) => a.date.localeCompare(b.date));

    // Build running balance: start with initialBalance, then apply events day by day
    const pointMap = {};
    let running = a.initialBalance ?? 0;
    // Place initial balance one day before the first event so it is never overwritten
    const firstDate = events[0].date;
    const dayBefore = new Date(firstDate + 'T00:00:00');
    dayBefore.setDate(dayBefore.getDate() - 1);
    pointMap[dayBefore.toISOString().slice(0, 10)] = running;
    events.forEach(ev => {
      running += ev.delta;
      pointMap[ev.date] = running;
    });

    const points = Object.entries(pointMap).sort((a, b) => a[0].localeCompare(b[0]));
    if (points.length === 0) return;

    const color = COLORS[ai % COLORS.length];
    datasets.push({
      label: a.name,
      data: points.map(([, y]) => Math.round(y * 100) / 100),
      labels: points.map(([x]) => x),
      borderColor: color,
      backgroundColor: color + '22',
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.3,
    });
  });

  if (datasets.length === 0) {
    if (emptyEl) emptyEl.classList.remove('d-none');
    canvas.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.classList.add('d-none');
  canvas.style.display = '';

  // Collect all unique dates across all datasets for x-axis labels
  const allDates = [...new Set(datasets.flatMap(d => d.labels ?? []))].sort();
  // Align each dataset's data to the common date axis
  const alignedDatasets = datasets.map(d => {
    const map = {};
    (d.labels ?? []).forEach((date, i) => { map[date] = d.data[i]; });
    return { ...d, data: allDates.map(date => map[date] ?? null), labels: undefined, spanGaps: true };
  });

  if (_balanceChart) { _balanceChart.destroy(); _balanceChart = null; }

  _balanceChart = new Chart(canvas, {
    type: 'line',
    data: { labels: allDates, datasets: alignedDatasets },
    options: {
      responsive: true,
      spanGaps: true,
      scales: {
        x: { title: { display: true, text: 'Date' }, ticks: { maxTicksLimit: 8, maxRotation: 45 } },
        y: { ticks: { callback: v => '₹' + new Intl.NumberFormat('en-IN').format(v) } },
      },
      plugins: { legend: { position: 'top' } },
    },
  });
}

// ─── Serialization — Task 7.1 ────────────────────────────────────────────────
// Account columns: A=id, B=name, C=type, D=initialBalance

export function serializeAccount(record) {
  return [record.id, record.name, record.type, String(record.initialBalance ?? 0)];
}

export function deserializeAccount(row) {
  return {
    id: row[0] ?? '',
    name: row[1] ?? '',
    type: row[2] ?? '',
    initialBalance: parseFloat(row[3]) || 0,
  };
}

// CreditCard columns: A=id, B=name, C=creditLimit, D=billingCycleStart, E=dueDay

export function serializeCreditCard(record) {
  return [
    record.id,
    record.name,
    String(record.creditLimit),
    String(record.billingCycleStart ?? ''),
    String(record.dueDay ?? ''),
    record.lastPaid ?? '',
  ];
}

export function deserializeCreditCard(row) {
  return {
    id: row[0] ?? '',
    name: row[1] ?? '',
    creditLimit: parseFloat(row[2]) || 0,
    billingCycleStart: parseInt(row[3]) || null,
    dueDay: parseInt(row[4]) || null,
    lastPaid: row[5] ?? '',
  };
}

// CreditCardPayment columns: A=id, B=cardName, C=date, D=amount, E=paidFromAccount, F=type, G=source

export function serializeCcPayment(record) {
  return [record.id, record.cardName, record.date, String(record.amount), record.paidFromAccount ?? '', record.type ?? 'payment', record.source ?? ''];
}

export function deserializeCcPayment(row) {
  return {
    id:               row[0] ?? '',
    cardName:         row[1] ?? '',
    date:             row[2] ?? '',
    amount:           parseFloat(row[3]) || 0,
    paidFromAccount:  row[4] ?? '',
    type:             row[5] ?? 'payment',
    source:           row[6] ?? '',
  };
}

// ─── Balance calculation ──────────────────────────────────────────────────────

/**
 * Computes the current balance for an account:
 *   initialBalance + income received in account - expenses paid from account
 */
function computeBalance(accountName) {
  const initial = (store.get('accounts') ?? []).find(a => a.name === accountName)?.initialBalance ?? 0;
  const expenses = store.get('expenses') ?? [];
  const income = store.get('income') ?? [];
  const transfers = store.get('transfers') ?? [];
  const ccPayments = store.get('ccPayments') ?? [];

  const totalExpenses = expenses
    .filter(e => e.paymentMethod === accountName)
    .reduce((sum, e) => sum + e.amount, 0);

  const totalIncome = income
    .filter(i => i.receivedIn === accountName)
    .reduce((sum, i) => sum + i.amount, 0);

  const totalTransferOut = transfers
    .filter(t => t.sourceAccount === accountName)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalTransferIn = transfers
    .filter(t => t.destinationAccount === accountName)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalCcPaid = ccPayments
    .filter(p => p.paidFromAccount === accountName)
    .reduce((sum, p) => sum + p.amount, 0);

  return initial + totalIncome + totalTransferIn - totalExpenses - totalTransferOut - totalCcPaid;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _renderAccountRow(a) {
  const balance = computeBalance(a.name);
  const balanceClass = balance >= 0 ? 'text-success' : 'text-danger';
  const typeConfig = {
    'Savings':  { icon: 'bi-piggy-bank-fill', bg: '#0ea5e9' },
    'Current':  { icon: 'bi-briefcase-fill',  bg: '#6366f1' },
    'Wallet':   { icon: 'bi-wallet2',          bg: '#10b981' },
    'Cash':     { icon: 'bi-cash-stack',       bg: '#f59e0b' },
  };
  const tc = typeConfig[a.type] ?? { icon: 'bi-bank2', bg: '#64748b' };
  return `
    <div class="list-group-item acc-row d-flex align-items-center gap-3 py-2 px-3">
      <div class="acc-row-icon" style="background:${tc.bg}18;color:${tc.bg}">
        <i class="bi ${tc.icon}"></i>
      </div>
      <div class="flex-grow-1 min-width-0">
        <div class="fw-semibold text-truncate" style="font-size:.9rem">${escapeHtml(a.name)}</div>
        <div class="text-muted" style="font-size:.73rem;text-transform:capitalize">${escapeHtml(a.type)}</div>
      </div>
      <span class="fw-bold ${balanceClass}" style="font-size:.9rem;white-space:nowrap">${formatCurrency(balance)}</span>
      <div class="acc-row-actions d-flex align-items-center gap-1">
        <button class="acc-action-btn acc-action-add" data-add-money="${escapeHtml(a.name)}" title="Add Money"><i class="bi bi-plus-lg"></i></button>
        <button class="acc-action-btn acc-action-edit" data-edit-account="${escapeHtml(a.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
        <button class="acc-action-btn acc-action-del" data-delete-account="${escapeHtml(a.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
      </div>
    </div>`;
}

function _bindAccountListEvents(container) {
  container.querySelectorAll('[data-add-money]').forEach(btn =>
    btn.addEventListener('click', () => _openAddMoneyModal(btn.dataset.addMoney)));
  container.querySelectorAll('[data-edit-account]').forEach(btn =>
    btn.addEventListener('click', () => _startEditAccount(btn.dataset.editAccount)));
  container.querySelectorAll('[data-delete-account]').forEach(btn =>
    btn.addEventListener('click', () => _deleteAccount(btn.dataset.deleteAccount)));
}

function showBanner(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('d-none');
}

function hideBanner(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('d-none');
}

// ─── Billing cycle helpers ────────────────────────────────────────────────────

function _ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function _daysUntilNext(dayOfMonth) {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const effectiveDay = Math.min(dayOfMonth, daysInMonth);
  
  if (effectiveDay >= today) {
    return effectiveDay - today;
  } else {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const daysInNext = new Date(nextYear, nextMonth + 1, 0).getDate();
    return daysInMonth - today + Math.min(dayOfMonth, daysInNext);
  }
}

function _isBillPaymentExpense(e) {
  const cat  = String(e.category    ?? '').trim().toLowerCase();
  const desc = String(e.description ?? '').trim().toLowerCase();
  const billKeywords = ['cc payment', 'credit card payment', 'bill payment', 'card payment', 'cc bill'];
  return billKeywords.some(k => cat === k || desc.includes(k));
}

function _getCurrentCycleDates(cycleStartDay) {
  if (!cycleStartDay) return null;
  
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  let cycleStart, cycleEnd;
  
  if (today >= cycleStartDay) {
    // We're in the current month's cycle
    cycleStart = new Date(year, month, cycleStartDay);
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const endDay = cycleStartDay - 1;
    cycleEnd = new Date(nextYear, nextMonth, endDay === 0 ? new Date(nextYear, nextMonth + 1, 0).getDate() : endDay);
  } else {
    // We're in the previous month's cycle
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    cycleStart = new Date(prevYear, prevMonth, cycleStartDay);
    const endDay = cycleStartDay - 1;
    cycleEnd = new Date(year, month, endDay === 0 ? new Date(year, month + 1, 0).getDate() : endDay);
  }
  
  return { cycleStart, cycleEnd };
}

function _getCycleSpend(cardName, cycleStart, cycleEnd) {
  const expenses = store.get('expenses') ?? [];
  const ccPayments = store.get('ccPayments') ?? [];
  const startStr = cycleStart.toISOString().split('T')[0];
  const endStr = cycleEnd.toISOString().split('T')[0];

  const grossSpend = expenses
    // Exclude bill-payment entries: they are not card spend.
    .filter(e =>
      e.paymentMethod === cardName &&
      !_isBillPaymentExpense(e) &&
      e.date >= startStr &&
      e.date <= endStr
    )
    .reduce((sum, e) => sum + e.amount, 0);

  return grossSpend;
}

function _getDaysUntilCycleEnd(cycleEnd) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(cycleEnd);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end - now) / 86400000));
}

// ─── render() — Task 7.4 ─────────────────────────────────────────────────────

export function render() {
  renderBalanceHistoryChart();
  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];

  // Split accounts by type
  const bankAccounts = accounts.filter(a => !['Wallet', 'Cash'].includes(a.type));
  const wallets      = accounts.filter(a => a.type === 'Wallet');
  const cashAccounts = accounts.filter(a => a.type === 'Cash');

  // Stat cards — total balance across all account types
  const totalBalance = accounts.reduce((s, a) => s + computeBalance(a.name), 0);
  const expenses = store.get('expenses') ?? [];
  const ccPayments = store.get('ccPayments') ?? [];
  const totalCreditUsed = creditCards.reduce((s, c) => {
    const spent = expenses
      .filter(e => e.paymentMethod === c.name && String(e.category ?? '').trim().toLowerCase() !== 'cc payment')
      .reduce((x, e) => x + e.amount, 0);
    const paid = ccPayments.filter(p => p.cardName === c.name).reduce((x, p) => x + p.amount, 0);
    return s + Math.max(spent - paid, 0);
  }, 0);
  const el = id => document.getElementById(id);
  if (el('acc-stat-balance')) el('acc-stat-balance').textContent = formatCurrency(totalBalance);
  if (el('acc-stat-cards')) el('acc-stat-cards').textContent = creditCards.length;
  if (el('acc-stat-credit-used')) el('acc-stat-credit-used').textContent = formatCurrency(totalCreditUsed);

  const accountsList = document.getElementById('accounts-list');
  const accountsEmpty = document.getElementById('accounts-empty-state');
  if (accountsList) {
    if (bankAccounts.length === 0) {
      accountsList.innerHTML = '';
      if (accountsEmpty) accountsEmpty.classList.remove('d-none');
    } else {
      if (accountsEmpty) accountsEmpty.classList.add('d-none');
      accountsList.innerHTML = bankAccounts.map(a => _renderAccountRow(a)).join('');
      _bindAccountListEvents(accountsList);
    }
  }

  // Wallets
  const walletsList = document.getElementById('wallets-list');
  const walletsEmpty = document.getElementById('wallets-empty-state');
  if (walletsList) {
    if (wallets.length === 0) {
      walletsList.innerHTML = '';
      if (walletsEmpty) walletsEmpty.classList.remove('d-none');
    } else {
      if (walletsEmpty) walletsEmpty.classList.add('d-none');
      walletsList.innerHTML = wallets.map(a => _renderAccountRow(a)).join('');
      _bindAccountListEvents(walletsList);
    }
  }

  // Cash
  const cashList = document.getElementById('cash-list');
  const cashEmpty = document.getElementById('cash-empty-state');
  if (cashList) {
    if (cashAccounts.length === 0) {
      cashList.innerHTML = '';
      if (cashEmpty) cashEmpty.classList.remove('d-none');
    } else {
      if (cashEmpty) cashEmpty.classList.add('d-none');
      cashList.innerHTML = cashAccounts.map(a => _renderAccountRow(a)).join('');
      _bindAccountListEvents(cashList);
    }
  }

  const cardsList = document.getElementById('credit-cards-list');
  const cardsEmpty = document.getElementById('credit-cards-empty-state');
  if (cardsList) {
    if (creditCards.length === 0) {
      cardsList.innerHTML = '';
      if (cardsEmpty) cardsEmpty.classList.remove('d-none');
    } else {
      if (cardsEmpty) cardsEmpty.classList.add('d-none');
      const expenses = store.get('expenses') ?? [];
      const ccPayments = store.get('ccPayments') ?? [];
      cardsList.innerHTML = creditCards.map(c => {
        // Only count actual purchases — exclude bill-payment entries
        const spent = expenses
          .filter(e => e.paymentMethod === c.name && !_isBillPaymentExpense(e))
          .reduce((s, e) => s + e.amount, 0);
        const paid = ccPayments
          .filter(p => p.cardName === c.name)
          .reduce((s, p) => s + p.amount, 0);
        const outstanding = Math.max(spent - paid, 0);
        const available = Math.max(c.creditLimit - outstanding, 0);
        const pct = c.creditLimit > 0 ? Math.min((outstanding / c.creditLimit) * 100, 100) : 0;
        const barCls = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-info';
        const overLimit = outstanding > c.creditLimit;
        
        // Bill payment history for this card (display only, not included in any totals)
        const cardPayments = ccPayments
          .filter(p => p.cardName === c.name)
          .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
        const collapseId  = `cc-pay-hist-${escapeHtml(c.id)}`;
        const showMoreId  = `cc-pay-more-${escapeHtml(c.id)}`;
        const HIST_LIMIT  = 5;
        const _payRow = p => {
          const isCb = p.type === 'cashback';
          return `
            <div class="list-group-item px-0 py-1 d-flex justify-content-between align-items-center" style="border-color:#f0f0f0">
              <span class="text-muted" style="min-width:72px">${formatDate(p.date)}</span>
              <span class="fw-semibold ${isCb ? 'text-success' : 'text-primary'}">${isCb ? '+' : ''}${formatCurrency(p.amount)}</span>
              <span class="text-muted">
                ${isCb
                  ? `<span class="badge bg-success-subtle text-success me-1"><i class="bi bi-gift-fill"></i> Cashback</span>${p.source ? escapeHtml(p.source) : ''}`
                  : `<i class="bi bi-bank me-1"></i>${escapeHtml(p.paidFromAccount)}`}
              </span>
            </div>`;
        };
        const visRows    = cardPayments.slice(0, HIST_LIMIT);
        const hidRows    = cardPayments.slice(HIST_LIMIT);
        const payHistHtml = `
          <div class="mt-2 pt-2" style="border-top:1px solid #dee2e6">
            <button class="btn btn-link btn-sm p-0 text-decoration-none text-secondary"
                    type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}"
                    aria-expanded="false">
              <i class="bi bi-clock-history me-1"></i>Payment History
              ${cardPayments.length > 0 ? `<span class="badge bg-secondary ms-1">${cardPayments.length}</span>` : ''}
            </button>
            <div class="collapse mt-2" id="${collapseId}">
              ${cardPayments.length === 0
                ? `<p class="text-muted small mb-0"><i class="bi bi-info-circle me-1"></i>No payments recorded yet. Use <strong>Pay Bill</strong> or <strong>+ Cashback</strong> to track history here.</p>`
                : `<div class="list-group list-group-flush" style="font-size:0.8rem">
                    ${visRows.map(_payRow).join('')}
                    ${hidRows.length > 0 ? `
                      <div id="${showMoreId}" class="d-none">${hidRows.map(_payRow).join('')}</div>
                      <div class="py-1 text-center">
                        <button class="btn btn-link btn-sm p-0 text-decoration-none small text-secondary"
                          onclick="(function(b,id){var el=document.getElementById(id);var hidden=el.classList.toggle('d-none');b.textContent=hidden?'Show ${hidRows.length} more…':'Show less';})(this,'${showMoreId}')">
                          Show ${hidRows.length} more…
                        </button>
                      </div>` : ''}
                  </div>`
              }
            </div>
          </div>`;

        // Calculate current billing cycle spend
        let cycleSpendHtml = '';
        if (c.billingCycleStart) {
          const cycleDates = _getCurrentCycleDates(c.billingCycleStart);
          if (cycleDates) {
            const cycleSpend = _getCycleSpend(c.name, cycleDates.cycleStart, cycleDates.cycleEnd);
            const cyclePct = c.creditLimit > 0 ? Math.min((cycleSpend / c.creditLimit) * 100, 100) : 0;
            const cycleBarCls = cyclePct >= 90 ? 'bg-danger' : cyclePct >= 70 ? 'bg-warning' : 'bg-success';
            const daysLeft = _getDaysUntilCycleEnd(cycleDates.cycleEnd);
            const cycleOverLimit = cycleSpend > c.creditLimit;
            
            cycleSpendHtml = `
              <div class="mt-2 pt-2" style="border-top:1px solid #dee2e6">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="small fw-semibold text-primary"><i class="bi bi-calendar3 me-1"></i>Current Cycle Spend</span>
                  <span class="small text-muted">${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span>
                </div>
                <div class="progress mb-1" style="height:6px">
                  <div class="progress-bar ${cycleBarCls}" role="progressbar" style="width:${cyclePct.toFixed(1)}%"
                       aria-valuenow="${cyclePct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
                <div class="d-flex justify-content-between small">
                  <span class="${cycleOverLimit ? 'text-danger fw-semibold' : 'text-primary'}">${formatCurrency(cycleSpend)} spent</span>
                  <span class="${cyclePct >= 90 ? 'text-danger' : cyclePct >= 70 ? 'text-warning' : 'text-success'}">
                    ${cyclePct.toFixed(0)}% of limit
                  </span>
                </div>
              </div>`;
          }
        }
        
        return `
          <div class="list-group-item">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-semibold">${escapeHtml(c.name)}</span>
              <div class="d-flex align-items-center gap-2">
                <span class="small text-muted">Limit: ${formatCurrency(c.creditLimit)}</span>
                <button class="btn btn-sm btn-outline-primary" data-edit-cc="${escapeHtml(c.id)}" title="Edit"><i class="bi bi-pencil-fill"></i></button>
                <button class="btn btn-sm btn-outline-primary" data-pay-cc="${escapeHtml(c.name)}" data-cc-outstanding="${outstanding}">Pay Bill</button>
                <button class="btn btn-sm btn-outline-success" data-cashback-cc="${escapeHtml(c.name)}" title="Record cashback / adjustment"><i class="bi bi-gift-fill me-1"></i>Cashback</button>
                <button class="btn btn-sm btn-outline-danger" data-delete-cc="${escapeHtml(c.id)}" title="Delete"><i class="bi bi-trash-fill"></i></button>
              </div>
            </div>
            <div class="progress mb-1" style="height:8px">
              <div class="progress-bar ${barCls}" role="progressbar" style="width:${pct.toFixed(1)}%"
                   aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
            <div class="d-flex justify-content-between small">
              <span class="text-danger">Outstanding: ${formatCurrency(outstanding)}</span>
              <span class="${overLimit ? 'text-danger fw-semibold' : 'text-success'}">
                ${overLimit ? 'Over limit by ' + formatCurrency(outstanding - c.creditLimit) : 'Available: ' + formatCurrency(available)}
              </span>
            </div>
            ${cycleSpendHtml}
            ${payHistHtml}
            ${(() => {
              const lines = [];
              if (c.billingCycleStart) {
                const endDay = c.billingCycleStart === 1 ? 31 : c.billingCycleStart - 1;
                lines.push(`<span class="text-muted"><i class="bi bi-arrow-repeat me-1"></i>Cycle: ${_ordinal(c.billingCycleStart)} – ${_ordinal(endDay)}</span>`);
              }
              if (c.dueDay) {
                const daysUntil = _daysUntilNext(c.dueDay);
                const dueBadge = daysUntil <= 7
                  ? `<span class="badge bg-warning text-dark ms-2">Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}</span>`
                  : '';
                lines.push(`<span class="text-muted"><i class="bi bi-calendar-check me-1"></i>Due: ${_ordinal(c.dueDay)} of each month${dueBadge}</span>`);
              }
              return lines.length ? `<div class="d-flex flex-wrap gap-3 small mt-1">${lines.join('')}</div>` : '';
            })()}
          </div>
        `;
      }).join('');

      cardsList.querySelectorAll('[data-pay-cc]').forEach(btn => {
        btn.addEventListener('click', () => _openPayCcModal(btn.dataset.payCc, parseFloat(btn.dataset.ccOutstanding)));
      });
      cardsList.querySelectorAll('[data-cashback-cc]').forEach(btn => {
        btn.addEventListener('click', () => _openCashbackModal(btn.dataset.cashbackCc));
      });
      cardsList.querySelectorAll('[data-edit-cc]').forEach(btn => {
        btn.addEventListener('click', () => _startEditCreditCard(btn.dataset.editCc));
      });
      cardsList.querySelectorAll('[data-delete-cc]').forEach(btn => {
        btn.addEventListener('click', () => _deleteCreditCard(btn.dataset.deleteCc));
      });
    }
  }
}

// ─── Edit helpers ─────────────────────────────────────────────────────────────

let _editingAccountId = null;
let _editingCcId = null;

function _startEditAccount(id) {
  const account = (store.get('accounts') ?? []).find(a => a.id === id);
  if (!account) return;
  _editingAccountId = id;

  // Pick the right modal based on type
  let modalId, nameInputId, balanceInputId, submitBtnText;
  if (account.type === 'Wallet') {
    modalId = 'oc-wallet'; nameInputId = 'wallet-name'; balanceInputId = 'wallet-initial-balance'; submitBtnText = 'Update Wallet';
  } else if (account.type === 'Cash') {
    modalId = 'oc-cash'; nameInputId = 'cash-name'; balanceInputId = 'cash-initial-balance'; submitBtnText = 'Update Cash';
  } else {
    modalId = 'oc-account'; nameInputId = 'account-name'; balanceInputId = 'account-initial-balance'; submitBtnText = 'Update Account';
    const typeEl = document.getElementById('account-type');
    if (typeEl) typeEl.value = account.type;
  }

  const nameEl = document.getElementById(nameInputId);
  const balEl = document.getElementById(balanceInputId);
  if (nameEl) nameEl.value = account.name;
  if (balEl) balEl.value = account.initialBalance ?? 0;

  const modal = document.getElementById(modalId);
  if (modal) {
    const btn = modal.querySelector('[type="submit"]');
    if (btn) btn.textContent = submitBtnText;
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }
}

function _startEditCreditCard(id) {
  const card = (store.get('creditCards') ?? []).find(c => c.id === id);
  if (!card) return;
  _editingCcId = id;

  document.getElementById('cc-name').value = card.name;
  document.getElementById('cc-limit').value = card.creditLimit;
  document.getElementById('cc-cycle-start').value = card.billingCycleStart ?? '';
  document.getElementById('cc-due-day').value = card.dueDay ?? '';

  const modal = document.getElementById('oc-credit-card');
  if (modal) {
    const btn = modal.querySelector('[type="submit"]');
    if (btn) btn.textContent = 'Update Credit Card';
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }
}

// ─── Delete helpers ───────────────────────────────────────────────────────────

async function _deleteAccount(id) {
  if (!await epConfirm('Delete this account? This will not remove associated transactions.', 'Delete Account', 'Delete')) return;
  const allAccounts = store.get('accounts') ?? [];
  const deleted = allAccounts.find(a => a.id === id);
  const accounts = allAccounts.filter(a => a.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.accounts, accounts.map(serializeAccount));
    store.set('accounts', accounts);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Account deleted', async () => {
      const current = [...(store.get('accounts') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.accounts, current.map(serializeAccount));
      store.set('accounts', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete account.');
  }
}

async function _deleteCreditCard(id) {
  if (!await epConfirm('Delete this credit card? This will not remove associated transactions.', 'Delete Credit Card', 'Delete')) return;
  const allCards = store.get('creditCards') ?? [];
  const deleted = allCards.find(c => c.id === id);
  const cards = allCards.filter(c => c.id !== id);
  try {
    await writeAllRows(CONFIG.sheets.creditCards, cards.map(serializeCreditCard));
    store.set('creditCards', cards);
    const { showUndoToast } = await import('./undo.js');
    showUndoToast('Credit card deleted', async () => {
      const current = [...(store.get('creditCards') ?? []), deleted];
      await writeAllRows(CONFIG.sheets.creditCards, current.map(serializeCreditCard));
      store.set('creditCards', current);
    });
  } catch (err) {
    alert(err.message ?? 'Failed to delete credit card.');
  }
}

// ─── Add Money modal ──────────────────────────────────────────────────────────

function _openAddMoneyModal(accountName) {
  const nameEl = document.getElementById('add-money-account-name');
  const input = document.getElementById('add-money-amount');
  const error = document.getElementById('add-money-error');
  if (nameEl) nameEl.textContent = accountName;
  if (input) input.value = '';
  if (error) error.classList.add('d-none');

  // Store which account we're topping up
  const modal = document.getElementById('add-money-modal');
  if (modal) modal.dataset.accountName = accountName;

  const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
  bsModal.show();
}

function _bindAddMoneyModal() {
  const confirmBtn = document.getElementById('add-money-confirm');
  if (!confirmBtn) return;

  confirmBtn.addEventListener('click', async () => {
    const modal = document.getElementById('add-money-modal');
    const accountName = modal?.dataset.accountName ?? '';
    const input = document.getElementById('add-money-amount');
    const error = document.getElementById('add-money-error');
    const amount = parseFloat(input?.value ?? '');

    if (!amount || amount <= 0) {
      if (error) { error.textContent = 'Enter a valid positive amount.'; error.classList.remove('d-none'); }
      return;
    }
    if (error) error.classList.add('d-none');

    const accounts = store.get('accounts') ?? [];
    const idx = accounts.findIndex(a => a.name === accountName);
    if (idx === -1) return;

    const updated = accounts.map((a, i) =>
      i === idx ? { ...a, initialBalance: (a.initialBalance ?? 0) + amount } : a
    );

    try {
      await writeAllRows(CONFIG.sheets.accounts, updated.map(serializeAccount));
      store.set('accounts', updated);
      bootstrap.Modal.getInstance(modal)?.hide();
    } catch (err) {
      if (error) { error.textContent = err.message ?? 'Failed to update balance.'; error.classList.remove('d-none'); }
    }
  });
}

// ─── Pay Credit Card Bill ─────────────────────────────────────────────────────

function _openPayCcModal(cardName, outstanding) {
  const nameEl = document.getElementById('pay-cc-card-name');
  const outstandingEl = document.getElementById('pay-cc-outstanding');
  const input = document.getElementById('pay-cc-amount');
  const accountSel = document.getElementById('pay-cc-from-account');
  const error = document.getElementById('pay-cc-error');
  const dateInput = document.getElementById('pay-cc-date');

  if (nameEl) nameEl.textContent = cardName;
  if (outstandingEl) outstandingEl.textContent = formatCurrency(outstanding);
  if (input) input.value = outstanding > 0 ? outstanding.toFixed(2) : '';
  if (error) error.classList.add('d-none');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // Populate account dropdown
  if (accountSel) {
    const accounts = store.get('accounts') ?? [];
    accountSel.innerHTML = '<option value="">Select account…</option>' +
      accounts.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  }

  const modal = document.getElementById('pay-cc-modal');
  if (modal) modal.dataset.cardName = cardName;
  bootstrap.Modal.getOrCreateInstance(modal).show();
}

function _openCashbackModal(cardName) {
  const nameEl  = document.getElementById('cashback-cc-card-name');
  const dateEl  = document.getElementById('cashback-cc-date');
  const amtEl   = document.getElementById('cashback-cc-amount');
  const srcEl   = document.getElementById('cashback-cc-source');
  const errEl   = document.getElementById('cashback-cc-error');
  if (nameEl) nameEl.textContent = cardName;
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (amtEl)  amtEl.value  = '';
  if (srcEl)  srcEl.value  = '';
  if (errEl)  errEl.classList.add('d-none');
  const modal = document.getElementById('cashback-cc-modal');
  if (modal) modal.dataset.cardName = cardName;
  bootstrap.Modal.getOrCreateInstance(modal).show();
}

function _bindCashbackModal() {
  const modalEl = document.getElementById('cashback-cc-modal');
  if (!modalEl) return;
  let _bound = false;
  modalEl.addEventListener('shown.bs.modal', () => {
    if (_bound) return;
    _bound = true;
    const confirmBtn = document.getElementById('cashback-cc-confirm');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', async () => {
      const modal    = document.getElementById('cashback-cc-modal');
      const cardName = modal?.dataset.cardName ?? '';
      const amount   = parseFloat(document.getElementById('cashback-cc-amount')?.value ?? '');
      const date     = document.getElementById('cashback-cc-date')?.value ?? '';
      const source   = document.getElementById('cashback-cc-source')?.value.trim() ?? '';
      const errEl    = document.getElementById('cashback-cc-error');
      if (!amount || amount <= 0) {
        if (errEl) { errEl.textContent = 'Enter a valid positive amount.'; errEl.classList.remove('d-none'); }
        return;
      }
      if (!date) {
        if (errEl) { errEl.textContent = 'Select a date.'; errEl.classList.remove('d-none'); }
        return;
      }
      if (errEl) errEl.classList.add('d-none');
      try {
        const payment = { id: crypto.randomUUID(), cardName, date, amount, paidFromAccount: '__cashback__', type: 'cashback', source };
        await appendRow(CONFIG.sheets.ccPayments, serializeCcPayment(payment));
        const payRows = await fetchRows(CONFIG.sheets.ccPayments);
        store.set('ccPayments', payRows.map(deserializeCcPayment).filter(p => p.id));
        bootstrap.Modal.getInstance(modal)?.hide();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message ?? 'Failed to record cashback.'; errEl.classList.remove('d-none'); }
      }
    });
  });
}

function _bindPayCcModal() {
  const modalEl = document.getElementById('pay-cc-modal');
  if (!modalEl) return;

  // Bind once when modal is shown (ensures element exists and avoids duplicate listeners)
  let _bound = false;
  modalEl.addEventListener('shown.bs.modal', () => {
    if (_bound) return;
    _bound = true;

    const confirmBtn = document.getElementById('pay-cc-confirm');
    if (!confirmBtn) return;

    confirmBtn.addEventListener('click', async () => {
      const modal = document.getElementById('pay-cc-modal');
      const cardName = modal?.dataset.cardName ?? '';
      const amount = parseFloat(document.getElementById('pay-cc-amount')?.value ?? '');
      const paidFromAccount = document.getElementById('pay-cc-from-account')?.value ?? '';
      const date = document.getElementById('pay-cc-date')?.value ?? '';
      const error = document.getElementById('pay-cc-error');

      if (!amount || amount <= 0) {
        if (error) { error.textContent = 'Enter a valid positive amount.'; error.classList.remove('d-none'); }
        return;
      }
      if (!paidFromAccount) {
        if (error) { error.textContent = 'Select the account to pay from.'; error.classList.remove('d-none'); }
        return;
      }
      if (!date) {
        if (error) { error.textContent = 'Select a date.'; error.classList.remove('d-none'); }
        return;
      }
      if (error) error.classList.add('d-none');

      try {
        // 1. Record CC payment (reduces utilization and deducts bank balance)
        const payment = { id: crypto.randomUUID(), cardName, date, amount, paidFromAccount };
        await appendRow(CONFIG.sheets.ccPayments, serializeCcPayment(payment));
        const payRows = await fetchRows(CONFIG.sheets.ccPayments);
        store.set('ccPayments', payRows.map(deserializeCcPayment).filter(p => p.id));

        // 2. Update lastPaid date on the credit card
        let cards = store.get('creditCards') ?? [];
        cards = cards.map(c => c.name === cardName ? { ...c, lastPaid: date } : c);
        await writeAllRows(CONFIG.sheets.creditCards, cards.map(serializeCreditCard));
        store.set('creditCards', cards);

        // NOTE: We do NOT add an expense entry here — the individual CC purchases
        // are already recorded as expenses when they were made. Adding a CC bill
        // payment as an expense would double-count the spend.

        bootstrap.Modal.getInstance(modal)?.hide();
      } catch (err) {
        if (error) { error.textContent = err.message ?? 'Failed to record payment.'; error.classList.remove('d-none'); }
      }
    });
  });
}

// ─── getPaymentMethodOptions() — Task 7.5 ────────────────────────────────────

export function getPaymentMethodOptions() {
  const accounts = store.get('accounts') ?? [];
  const creditCards = store.get('creditCards') ?? [];
  return [
    ...accounts.map(a => a.name),
    ...creditCards.map(c => c.name),
  ];
}

// ─── init() — Task 7.3 ───────────────────────────────────────────────────────

export function init() {
  _bindAccountForm();
  _bindWalletForm();
  _bindCashForm();
  _bindCreditCardForm();
  _bindAddMoneyModal();
  _bindPayCcModal();
  _bindCashbackModal();

  // Reset editing state when modals are closed without saving
  ['oc-account','oc-wallet','oc-cash'].forEach(id => {
    document.getElementById(id)?.addEventListener('hidden.bs.modal', () => {
      _editingAccountId = null;
      const modal = document.getElementById(id);
      const btn = modal?.querySelector('[type="submit"]');
      if (btn) btn.textContent = id === 'oc-account' ? 'Add Account' : id === 'oc-wallet' ? 'Add Wallet' : 'Add Cash';
    });
  });
  document.getElementById('oc-credit-card')?.addEventListener('hidden.bs.modal', () => {
    _editingCcId = null;
    const btn = document.querySelector('#oc-credit-card [type="submit"]');
    if (btn) btn.textContent = 'Add Credit Card';
  });

  store.on('accounts', render);
  store.on('creditCards', render);
  store.on('ccPayments', render);
  store.on('expenses', render);
  store.on('income', render);
  store.on('transfers', render);
  store.on('expenses',   renderBalanceHistoryChart);
  store.on('income',     renderBalanceHistoryChart);
  store.on('transfers',  renderBalanceHistoryChart);
  store.on('ccPayments', renderBalanceHistoryChart);
}

function _bindAccountForm() {
  const form = document.getElementById('account-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner('account-error-banner');

    const name = document.getElementById('account-name')?.value?.trim() ?? '';
    const type = document.getElementById('account-type')?.value?.trim() ?? '';
    const initialBalance = parseFloat(document.getElementById('account-initial-balance')?.value ?? '0') || 0;

    const result = requireFields({ name, type }, ['name', 'type']);
    if (!result.valid) {
      showBanner('account-error-banner');
      return;
    }

    try {
      let accounts = store.get('accounts') ?? [];
      if (_editingAccountId) {
        accounts = accounts.map(a => a.id === _editingAccountId ? { ...a, name, type, initialBalance } : a);
        await writeAllRows(CONFIG.sheets.accounts, accounts.map(serializeAccount));
        store.set('accounts', accounts);
        _editingAccountId = null;
      } else {
        const record = { id: crypto.randomUUID(), name, type, initialBalance };
        await appendRow(CONFIG.sheets.accounts, serializeAccount(record));
        const rows = await fetchRows(CONFIG.sheets.accounts);
        store.set('accounts', rows.map(deserializeAccount));
      }
      form.reset();
      const acctModal = document.getElementById('oc-account');
      if (acctModal) {
        const btn = acctModal.querySelector('[type="submit"]');
        if (btn) btn.textContent = 'Add Account';
        bootstrap.Modal.getInstance(acctModal)?.hide();
      }
    } catch (err) {
      const banner = document.getElementById('account-error-banner');
      if (banner) {
        banner.textContent = err.message ?? 'Failed to save account. Please try again.';
        banner.classList.remove('d-none');
      }
    }
  });
}

function _bindCreditCardForm() {
  const form = document.getElementById('credit-card-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideBanner('cc-error-banner');

    const name = document.getElementById('cc-name')?.value?.trim() ?? '';
    const creditLimit = document.getElementById('cc-limit')?.value?.trim() ?? '';

    const reqResult = requireFields({ name, creditLimit }, ['name', 'creditLimit']);
    if (!reqResult.valid) { showBanner('cc-error-banner'); return; }

    const numResult = requirePositiveNumber(creditLimit);
    if (!numResult.valid) { showBanner('cc-error-banner'); return; }

    try {
      const billingCycleStart = parseInt(document.getElementById('cc-cycle-start')?.value ?? '') || null;
      const dueDay = parseInt(document.getElementById('cc-due-day')?.value ?? '') || null;
      let cards = store.get('creditCards') ?? [];
      if (_editingCcId) {
        cards = cards.map(c => c.id === _editingCcId ? { ...c, name, creditLimit: parseFloat(creditLimit), billingCycleStart, dueDay } : c);
        await writeAllRows(CONFIG.sheets.creditCards, cards.map(serializeCreditCard));
        store.set('creditCards', cards);
        _editingCcId = null;
      } else {
        const record = { id: crypto.randomUUID(), name, creditLimit: parseFloat(creditLimit), billingCycleStart, dueDay };
        await appendRow(CONFIG.sheets.creditCards, serializeCreditCard(record));
        const rows = await fetchRows(CONFIG.sheets.creditCards);
        store.set('creditCards', rows.map(deserializeCreditCard));
      }
      form.reset();
      const ccModal = document.getElementById('oc-credit-card');
      if (ccModal) {
        const btn = ccModal.querySelector('[type="submit"]');
        if (btn) btn.textContent = 'Add Credit Card';
        bootstrap.Modal.getInstance(ccModal)?.hide();
      }
    } catch (err) {
      const banner = document.getElementById('cc-error-banner');
      if (banner) {
        banner.textContent = err.message ?? 'Failed to save credit card. Please try again.';
        banner.classList.remove('d-none');
      }
    }
  });
}

function _bindWalletForm() {
  const form = document.getElementById('wallet-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('wallet-name')?.value?.trim() ?? '';
    const initialBalance = parseFloat(document.getElementById('wallet-initial-balance')?.value ?? '0') || 0;
    if (!name) {
      const banner = document.getElementById('wallet-error-banner');
      if (banner) { banner.textContent = 'Name is required.'; banner.classList.remove('d-none'); }
      return;
    }
    try {
      let accounts = store.get('accounts') ?? [];
      if (_editingAccountId) {
        accounts = accounts.map(a => a.id === _editingAccountId ? { ...a, name, initialBalance } : a);
        await writeAllRows(CONFIG.sheets.accounts, accounts.map(serializeAccount));
        store.set('accounts', accounts);
        _editingAccountId = null;
      } else {
        const record = { id: crypto.randomUUID(), name, type: 'Wallet', initialBalance };
        await appendRow(CONFIG.sheets.accounts, serializeAccount(record));
        const rows = await fetchRows(CONFIG.sheets.accounts);
        store.set('accounts', rows.map(deserializeAccount));
      }
      form.reset();
      const modal = document.getElementById('oc-wallet');
      if (modal) {
        const btn = modal.querySelector('[type="submit"]');
        if (btn) btn.textContent = 'Add Wallet';
        bootstrap.Modal.getInstance(modal)?.hide();
      }
    } catch (err) {
      const banner = document.getElementById('wallet-error-banner');
      if (banner) { banner.textContent = err.message ?? 'Failed to save wallet.'; banner.classList.remove('d-none'); }
    }
  });
}

function _bindCashForm() {
  const form = document.getElementById('cash-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cash-name')?.value?.trim() ?? '';
    const initialBalance = parseFloat(document.getElementById('cash-initial-balance')?.value ?? '0') || 0;
    if (!name) {
      const banner = document.getElementById('cash-error-banner');
      if (banner) { banner.textContent = 'Name is required.'; banner.classList.remove('d-none'); }
      return;
    }
    try {
      let accounts = store.get('accounts') ?? [];
      if (_editingAccountId) {
        accounts = accounts.map(a => a.id === _editingAccountId ? { ...a, name, initialBalance } : a);
        await writeAllRows(CONFIG.sheets.accounts, accounts.map(serializeAccount));
        store.set('accounts', accounts);
        _editingAccountId = null;
      } else {
        const record = { id: crypto.randomUUID(), name, type: 'Cash', initialBalance };
        await appendRow(CONFIG.sheets.accounts, serializeAccount(record));
        const rows = await fetchRows(CONFIG.sheets.accounts);
        store.set('accounts', rows.map(deserializeAccount));
      }
      form.reset();
      const modal = document.getElementById('oc-cash');
      if (modal) {
        const btn = modal.querySelector('[type="submit"]');
        if (btn) btn.textContent = 'Add Cash';
        bootstrap.Modal.getInstance(modal)?.hide();
      }
    } catch (err) {
      const banner = document.getElementById('cash-error-banner');
      if (banner) { banner.textContent = err.message ?? 'Failed to save cash.'; banner.classList.remove('d-none'); }
    }
  });
}
