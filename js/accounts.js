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

  // Apply account filter
  const filterSel = document.getElementById('acc-chart-filter');
  const filterVal = filterSel?.value ?? 'all';
  const filteredAccounts = filterVal === 'all' ? accounts : accounts.filter(a => a.name === filterVal);

  // Apply range tab cutoff
  const activeRange = document.querySelector('.acc-range-tab--active')?.dataset?.range ?? '1y';
  let cutoffDate = null;
  if (activeRange !== 'all') {
    const months = activeRange === '1m' ? 1 : activeRange === '3m' ? 3 : activeRange === '6m' ? 6 : 12;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    cutoffDate = d.toISOString().slice(0, 10);
  }

  // Collect all dated events per account
  const COLORS = ['#a78bfa','#34d399','#f87171','#fbbf24','#fb923c','#f472b6','#22d3ee','#4ade80'];
  const datasets = [];

  filteredAccounts.forEach((a, ai) => {
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
  let allDates = [...new Set(datasets.flatMap(d => d.labels ?? []))].sort();
  // Apply range cutoff — trim dates before cutoff, but carry forward the last known balance before cutoff
  if (cutoffDate) {
    const datesInRange = allDates.filter(d => d >= cutoffDate);
    allDates = datesInRange.length ? datesInRange : allDates.slice(-1);
  }
  // Align each dataset's data to the common date axis
  const alignedDatasets = datasets.map(d => {
    const map = {};
    (d.labels ?? []).forEach((date, i) => { map[date] = d.data[i]; });
    return { ...d, data: allDates.map(date => map[date] ?? null), labels: undefined, spanGaps: true };
  });

  // Determine per-account mode
  const perAccount = document.getElementById('acc-chart-per-account')?.checked ?? false;

  // Build final datasets
  let finalDatasets;
  if (perAccount) {
    // Individual account lines with gradient fill
    finalDatasets = alignedDatasets.map((d, i) => {
      const ctx2 = canvas.getContext('2d');
      const grad = ctx2.createLinearGradient(0, 0, 0, 320);
      const hex = d.borderColor ?? '#a78bfa';
      grad.addColorStop(0,   hex + '60');
      grad.addColorStop(0.5, hex + '22');
      grad.addColorStop(1,   hex + '00');
      return { ...d, fill: true, backgroundColor: grad, tension: 0.45, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: hex, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 };
    });
  } else {
    // Single total balance line — sum across all filtered accounts per date
    const totalByDate = {};
    alignedDatasets.forEach(d => {
      allDates.forEach((date, i) => {
        if (d.data[i] !== null) totalByDate[date] = (totalByDate[date] ?? 0) + d.data[i];
      });
    });
    const totalData = allDates.map(d => totalByDate[d] ?? null);
    const ctx2 = canvas.getContext('2d');
    const grad = ctx2.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0,   'rgba(99,102,241,0.52)');
    grad.addColorStop(0.4, 'rgba(99,102,241,0.18)');
    grad.addColorStop(1,   'rgba(99,102,241,0.00)');
    finalDatasets = [{
      label: filterVal === 'all' ? 'Total Balance' : (filteredAccounts[0]?.name ?? 'Balance'),
      data: totalData,
      borderColor: '#6366f1',
      backgroundColor: grad,
      fill: true,
      tension: 0.45,
      pointRadius: 0,
      pointHoverRadius: 7,
      pointHoverBackgroundColor: '#6366f1',
      pointHoverBorderColor: '#ffffff',
      pointHoverBorderWidth: 2,
      borderWidth: 3,
      spanGaps: true,
    }];
    const subEl = document.getElementById('acc-chart-subtitle');
    if (subEl) subEl.textContent = '';
  }

  // ── Stats strip ───────────────────────────────────────────────────────────────
  // Always computed from the unfiltered `datasets` (pre-alignment, pre-range-clip)
  // so they work correctly for both the per-account toggle AND every time filter.
  //
  // Fix for Issue 1: Current Balance sums each account's LATEST balance regardless
  //   of the selected time range — accounts with no recent transactions are included.
  // Fix for Issue 2: Period Peak/Low include the carry-forward balance at the period
  //   start boundary so they change meaningfully on every range tab click.

  // Balance of dataset ds strictly BEFORE date (carry-forward, exclusive).
  // Returns null if no data point exists before `date` (account created after cutoff).
  const _accBalBefore = (ds, date) => {
    const dates = ds.labels ?? [], vals = ds.data ?? [];
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < date) return vals[i] ?? 0;
    }
    return null;
  };
  // Balance of dataset ds on or before date (carry-forward, inclusive)
  const _accBalAt = (ds, date) => {
    const dates = ds.labels ?? [], vals = ds.data ?? [];
    let bal = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= date) { bal = vals[i] ?? 0; break; }
    }
    return bal;
  };

  // 1. Current Balance = latest balance per account summed (all-time, not range-clipped)
  const _currentBal = datasets.length
    ? datasets.reduce((s, ds) => s + (ds.data?.[ds.data.length - 1] ?? 0), 0)
    : null;

  // 2. Period start = carry-forward per account to just BEFORE the cutoff.
  //    For "All" range (cutoffDate = null) use each account's very first stored balance.
  //    If an account was created WITHIN the period (no data before cutoff), fall back to
  //    its first recorded balance so Period Change doesn't incorrectly equal Current Balance.
  const _periodStart = cutoffDate
    ? datasets.reduce((s, ds) => {
        const b = _accBalBefore(ds, cutoffDate);
        return s + (b !== null ? b : (ds.data?.[0] ?? 0));
      }, 0)
    : datasets.reduce((s, ds) => s + (ds.data?.[0] ?? 0), 0);

  // 3. All distinct transaction dates within the selected period
  const _periodDates = [...new Set(
    datasets.flatMap(ds => (ds.labels ?? []).filter(d => !cutoffDate || d >= cutoffDate))
  )].sort();

  // 4. Total balance (all accounts) at each period transaction date using carry-forward
  const _periodTotals = _periodDates.map(d =>
    datasets.reduce((s, ds) => s + _accBalAt(ds, d), 0)
  );

  // 5. Combined value series: period-start carry-forward + each transaction point in period
  const _periodVals = [_periodStart, ..._periodTotals];
  const _peakStat   = datasets.length ? Math.max(..._periodVals) : null;
  const _lowStat    = datasets.length ? Math.min(..._periodVals) : null;
  const _periodEnd  = _periodVals[_periodVals.length - 1] ?? null;
  const _chgAmt     = datasets.length && _periodEnd !== null ? _periodEnd - _periodStart : null;
  const _chgPct     = _periodStart && Math.abs(_periodStart) > 0
    ? (_chgAmt / Math.abs(_periodStart)) * 100 : null;

  const _sfmt = v => v !== null ? '\u20b9' + new Intl.NumberFormat('en-IN').format(Math.round(v)) : '\u2014';
  const _sqs  = id => document.getElementById(id);
  if (_sqs('acc-stat-latest')) _sqs('acc-stat-latest').textContent = _sfmt(_currentBal);
  if (_sqs('acc-stat-peak'))   _sqs('acc-stat-peak').textContent   = _sfmt(_peakStat);
  if (_sqs('acc-stat-low'))    _sqs('acc-stat-low').textContent    = _sfmt(_lowStat);
  if (_sqs('acc-stat-chg')) {
    const chgEl = _sqs('acc-stat-chg');
    if (_chgAmt !== null) {
      const sign   = _chgAmt >= 0 ? '+' : '';
      const pctStr = _chgPct !== null ? ` (${sign}${_chgPct.toFixed(1)}%)` : '';
      chgEl.textContent = `${sign}${_sfmt(_chgAmt)}${pctStr}`;
      chgEl.className   = 'acc-chart-stat-val ' + (_chgAmt >= 0 ? 'acc-chart-stat-val--up' : 'acc-chart-stat-val--down');
    } else {
      chgEl.textContent = '\u2014'; chgEl.className = 'acc-chart-stat-val';
    }
  }

  if (_balanceChart) { _balanceChart.destroy(); _balanceChart = null; }

  const _crosshairPlugin = {
    id: 'accCrosshair',
    afterDraw(chart) {
      const active = chart.tooltip._active;
      if (!active?.length) return;
      const { ctx: c3, scales: { x: xS, y: yS } } = chart;
      const xPos = active[0].element.x;
      c3.save();
      c3.beginPath();
      c3.moveTo(xPos, yS.top);
      c3.lineTo(xPos, yS.bottom);
      c3.lineWidth = 1.5;
      c3.strokeStyle = 'rgba(99,102,241,0.4)';
      c3.setLineDash([5, 4]);
      c3.stroke();
      c3.restore();
    },
  };

  _balanceChart = new Chart(canvas, {
    type: 'line',
    data: { labels: allDates, datasets: finalDatasets },
    plugins: [_crosshairPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      spanGaps: true,
      animation: { duration: 900, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: perAccount,
          position: 'top',
          labels: { color: '#64748b', boxWidth: 10, padding: 12, usePointStyle: true, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.93)',
          titleColor: '#f1f5f9',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(99,102,241,0.45)',
          borderWidth: 1,
          padding: 13,
          cornerRadius: 12,
          displayColors: perAccount,
          callbacks: {
            title: items => {
              const raw = items[0]?.label ?? '';
              const dt  = new Date(raw + 'T00:00:00');
              return isNaN(dt) ? raw : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            },
            label: ctx => ` ${ctx.dataset.label}: \u20b9${new Intl.NumberFormat('en-IN').format(Math.round(ctx.parsed.y))}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 7, maxRotation: 0, color: '#94a3b8', font: { size: 11 } },
          grid: { color: 'rgba(226,232,240,0.35)', drawBorder: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => '\u20b9' + new Intl.NumberFormat('en-IN').format(v) },
          grid: { color: 'rgba(226,232,240,0.35)', drawBorder: false },
          border: { display: false },
        },
      },
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
    'Savings':  { icon: 'bi-piggy-bank-fill', bg: '#0ea5e9',  cls: 'acc-row--bank' },
    'Current':  { icon: 'bi-briefcase-fill',  bg: '#6366f1',  cls: 'acc-row--bank' },
    'Wallet':   { icon: 'bi-wallet2',          bg: '#10b981',  cls: 'acc-row--wallet' },
    'Cash':     { icon: 'bi-cash-stack',       bg: '#f59e0b',  cls: 'acc-row--cash' },
  };
  const tc = typeConfig[a.type] ?? { icon: 'bi-bank2', bg: '#64748b', cls: 'acc-row--bank' };

  // Month-over-month trend
  const now = new Date();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  const allExpenses  = store.get('expenses')  ?? [];
  const allIncome    = store.get('income')    ?? [];
  const allTransfers = store.get('transfers') ?? [];
  const allCcPay     = store.get('ccPayments') ?? [];

  function _balanceAt(dateStr) {
    const init = a.initialBalance ?? 0;
    const filterTo = r => r.date && r.date <= dateStr;
    const inc  = allIncome.filter(r => r.receivedIn === a.name && filterTo(r)).reduce((s, r) => s + r.amount, 0);
    const exp  = allExpenses.filter(r => r.paymentMethod === a.name && filterTo(r)).reduce((s, r) => s + r.amount, 0);
    const tIn  = allTransfers.filter(r => r.destinationAccount === a.name && filterTo(r)).reduce((s, r) => s + r.amount, 0);
    const tOut = allTransfers.filter(r => r.sourceAccount === a.name && filterTo(r)).reduce((s, r) => s + r.amount, 0);
    const ccP  = allCcPay.filter(r => r.paidFromAccount === a.name && filterTo(r)).reduce((s, r) => s + r.amount, 0);
    return init + inc + tIn - exp - tOut - ccP;
  }

  const balLastMonth = _balanceAt(lastMonthEnd);
  const diff = balance - balLastMonth;
  let trendHtml = '';
  if (balLastMonth !== 0 || diff !== 0) {
    const trendIcon  = diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short';
    const trendColor = diff >= 0 ? '#10b981' : '#ef4444';
    trendHtml = `<span class="acc-row-trend" style="color:${trendColor}"><i class="bi ${trendIcon}"></i>${formatCurrency(Math.abs(diff))}</span>`;
  }

  return `
    <div class="list-group-item acc-row ${tc.cls} d-flex align-items-center gap-3 py-2 px-3">
      <div class="acc-row-icon" style="background:${tc.bg}18;color:${tc.bg}">
        <i class="bi ${tc.icon}"></i>
      </div>
      <div class="flex-grow-1 min-width-0">
        <div class="fw-semibold text-truncate" style="font-size:.9rem">${escapeHtml(a.name)}</div>
        <div class="text-muted" style="font-size:.73rem;text-transform:capitalize">${escapeHtml(a.type)}</div>
      </div>
      <div class="d-flex flex-column align-items-end" style="flex-shrink:0">
        <span class="fw-bold ${balanceClass}" style="font-size:.95rem;white-space:nowrap">${formatCurrency(balance)}</span>
        ${trendHtml}
      </div>
      <div class="d-flex align-items-center gap-1">
        <button class="acc-action-btn acc-action-transfer" data-transfer-from="${escapeHtml(a.name)}" title="Transfer"><i class="bi bi-arrow-left-right"></i></button>
        <div class="dropdown">
          <button class="acc-row-menu-btn" data-bs-toggle="dropdown" aria-expanded="false" title="More actions"><i class="bi bi-three-dots-vertical"></i></button>
          <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="min-width:140px;font-size:.82rem">
            <li><a class="dropdown-item" href="#" data-add-money="${escapeHtml(a.name)}"><i class="bi bi-plus-circle me-2 text-success"></i>Add Money</a></li>
            <li><a class="dropdown-item" href="#" data-edit-account="${escapeHtml(a.id)}"><i class="bi bi-pencil me-2 text-primary"></i>Edit</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" data-delete-account="${escapeHtml(a.id)}"><i class="bi bi-trash me-2"></i>Delete</a></li>
          </ul>
        </div>
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
  container.querySelectorAll('[data-transfer-from]').forEach(btn =>
    btn.addEventListener('click', () => _openTransferFrom(btn.dataset.transferFrom)));
}

function _openTransferFrom(accountName) {
  const modal = document.getElementById('oc-transfer');
  if (!modal) return;
  // Pre-fill source and set today's date
  const src = document.getElementById('transfer-source');
  const dateEl = document.getElementById('transfer-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
  // Open modal first so dropdowns are populated
  const bsModal = bootstrap.Modal.getOrCreate(modal);
  bsModal.show();
  // After modal is shown, set the source value
  modal.addEventListener('shown.bs.modal', function onShown() {
    modal.removeEventListener('shown.bs.modal', onShown);
    if (src) {
      src.value = accountName;
      src.dispatchEvent(new Event('change'));
    }
  });
}

let _utilDonutChart = null;
function _renderUtilDonut(pct) {
  const canvas = document.getElementById('cc-util-donut');
  const hintEl = document.getElementById('cc-util-hint');
  const fillEl = document.getElementById('cc-util-bar-fill');
  const pctEl  = document.getElementById('cc-util-donut-pct');
  if (!canvas) return;
  const color = pct >= 70 ? '#ef4444' : pct >= 30 ? '#f59e0b' : '#10b981';
  if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  if (pctEl) pctEl.style.color = color;
  if (fillEl) { fillEl.style.width = pct.toFixed(1) + '%'; fillEl.style.background = color; }
  const label = pct >= 70 ? `High utilization — consider paying down balances.`
               : pct >= 30 ? `Fair utilization — try to stay below 30%.`
               : `Good utilization — you're in great shape!`;
  if (hintEl) { hintEl.textContent = label; hintEl.style.color = color; }
  if (_utilDonutChart) { _utilDonutChart.destroy(); _utilDonutChart = null; }
  _utilDonutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{ data: [pct, Math.max(100 - pct, 0)], backgroundColor: [color, '#f1f5f9'],
        borderWidth: 0, borderRadius: 4 }]
    },
    options: {
      cutout: '72%', responsive: false, animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

const _CC_CHIP_PALETTES = 6;
function _renderCcRow(c, expenses, ccPayments, idx) {
  const spent = expenses
    .filter(e => e.paymentMethod === c.name && !_isBillPaymentExpense(e))
    .reduce((s, e) => s + e.amount, 0);
  const paid        = ccPayments.filter(p => p.cardName === c.name).reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(spent - paid, 0);
  const available   = Math.max(c.creditLimit - outstanding, 0);
  const pct         = c.creditLimit > 0 ? Math.min((outstanding / c.creditLimit) * 100, 100) : 0;
  const overLimit   = outstanding > c.creditLimit;

  const severityCls = pct >= 70 ? 'cc-card-row--red'   : pct >= 30 ? 'cc-card-row--amber' : 'cc-card-row--green';
  const fillColor   = pct >= 70 ? '#ef4444' : pct >= 30 ? '#f59e0b' : '#10b981';
  const pctBadgeCls = pct >= 70 ? 'cc-card-pct--red'   : pct >= 30 ? 'cc-card-pct--amber' : 'cc-card-pct--green';
  const chipCls     = `cc-chip--${(idx ?? 0) % _CC_CHIP_PALETTES}`;

  // Due date badge (in header)
  let dueBadgeHtml = '';
  if (c.dueDay) {
    const daysUntil = _daysUntilNext(c.dueDay);
    const badgeCls  = daysUntil <= 7 ? 'cc-due-badge--urgent' : daysUntil <= 14 ? 'cc-due-badge--normal' : 'cc-due-badge--default';
    const label     = daysUntil === 0 ? 'Due Today' : `Due in ${daysUntil}d`;
    dueBadgeHtml    = `<span class="cc-due-badge ${badgeCls}"><i class="bi bi-calendar-check me-1"></i>${label}</span>`;
  }

  // Cycle / statement countdown for info grid
  let cycleCell = '';
  if (c.billingCycleStart) {
    const cycleDates = _getCurrentCycleDates(c.billingCycleStart);
    if (cycleDates) {
      const cycleSpend = _getCycleSpend(c.name, cycleDates.cycleStart, cycleDates.cycleEnd);
      const daysLeft   = _getDaysUntilCycleEnd(cycleDates.cycleEnd);
      const cpColor    = cycleSpend / c.creditLimit >= .9 ? '#ef4444' : cycleSpend / c.creditLimit >= .7 ? '#f59e0b' : '#10b981';
      const label      = daysLeft === 0 ? 'Billing today' : `Billing date in ${daysLeft} days`;
      cycleCell = `<div class="cc-info-cell"><i class="bi bi-calendar3" style="color:${cpColor}"></i>
        <span>${label} &middot; <strong style="color:${cpColor}">${formatCurrency(outstanding)}</strong> outstanding</span></div>`;
    }
  }
  if (!cycleCell && c.billingCycleStart) {
    const endDay = c.billingCycleStart === 1 ? 31 : c.billingCycleStart - 1;
    cycleCell = `<div class="cc-info-cell"><i class="bi bi-arrow-repeat"></i><span>Cycle: ${_ordinal(c.billingCycleStart)}–${_ordinal(endDay)}</span></div>`;
  }

  // Last payment for info grid
  const cardPayments = ccPayments.filter(p => p.cardName === c.name)
    .sort((a, b) => (b.date > a.date ? 1 : -1));
  let lastPayCell = '';
  if (cardPayments.length > 0) {
    const lp   = cardPayments[0];
    const isCb = lp.type === 'cashback';
    const lpColor = isCb ? '#10b981' : '#3b82f6';
    lastPayCell = `<div class="cc-info-cell"><i class="bi ${isCb ? 'bi-gift-fill' : 'bi-check-circle-fill'}" style="color:${lpColor}"></i>
      <span>${isCb ? 'Cashback' : 'Last paid'}: <strong>${formatCurrency(lp.amount)}</strong> · ${formatDate(lp.date)}</span></div>`;
  }

  // Compact payment history
  const collapseId = `cc-pay-hist-${escapeHtml(c.id)}`;
  const showMoreId = `cc-pay-more-${escapeHtml(c.id)}`;
  const HIST_LIMIT = 5;
  const _payRow = p => {
    const isCb = p.type === 'cashback';
    return `<div class="cc-pay-hist-row">
      <span class="cc-pay-hist-date">${formatDate(p.date)}</span>
      <span class="cc-pay-hist-amt ${isCb ? 'text-success' : 'text-primary'}">${isCb ? '+' : ''}${formatCurrency(p.amount)}</span>
      <span class="cc-pay-hist-src">${isCb
        ? `<span class="badge bg-success-subtle text-success"><i class="bi bi-gift-fill me-1"></i>Cashback</span>`
        : `<i class="bi bi-bank me-1"></i>${escapeHtml(p.paidFromAccount)}`}</span>
    </div>`;
  };
  const visRows = cardPayments.slice(0, HIST_LIMIT);
  const hidRows = cardPayments.slice(HIST_LIMIT);
  const payHistHtml = `
    <div class="mt-2 pt-1" style="border-top:1px solid #f1f5f9">
      <button class="btn btn-link btn-sm p-0 text-decoration-none text-secondary"
              type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false">
        <i class="bi bi-clock-history me-1"></i>Payment History
        ${cardPayments.length > 0 ? `<span class="badge bg-secondary ms-1">${cardPayments.length}</span>` : ''}
      </button>
      <div class="collapse mt-2" id="${collapseId}">
        ${cardPayments.length === 0
          ? `<p class="text-muted small mb-0"><i class="bi bi-info-circle me-1"></i>No payments recorded yet.</p>`
          : `<div class="px-1">
              ${visRows.map(_payRow).join('')}
              ${hidRows.length > 0 ? `
                <div id="${showMoreId}" class="d-none">${hidRows.map(_payRow).join('')}</div>
                <div class="py-1 text-center">
                  <button class="btn btn-link btn-sm p-0 text-decoration-none small text-secondary"
                    onclick="(function(b,id){var el=document.getElementById(id);var h=el.classList.toggle('d-none');b.textContent=h?'Show ${hidRows.length} more\u2026':'Show less';})(this,'${showMoreId}')">
                    Show ${hidRows.length} more&hellip;</button></div>` : ''}
            </div>`
        }
      </div>
    </div>`;

  const availColor = overLimit ? '#ef4444' : '#10b981';
  const availLabel = overLimit ? 'Over limit' : 'Available';

  return `
    <div class="cc-card-row ${severityCls}">
      <div class="cc-card-header">
        <div class="cc-chip-tile ${chipCls}">
          <span class="cc-chip-initials">${c.name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')}</span>
          <i class="bi bi-credit-card-fill cc-chip-icon"></i>
        </div>
        <div class="cc-card-header-info">
          <div class="cc-card-name">${escapeHtml(c.name)}</div>
          <div class="cc-card-name-sub">Limit: ${formatCurrency(c.creditLimit)}</div>
        </div>
        <div class="cc-card-header-right">
          ${dueBadgeHtml}
          <button class="cc-pay-btn" data-pay-cc="${escapeHtml(c.name)}" data-cc-outstanding="${outstanding}"><i class="bi bi-send-fill me-1"></i>Pay</button>
          <div class="dropdown">
            <button class="cc-menu-btn" data-bs-toggle="dropdown" aria-expanded="false" title="More"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="min-width:150px;font-size:.82rem">
              <li><a class="dropdown-item py-2" href="#" data-cashback-cc="${escapeHtml(c.name)}"><i class="bi bi-gift-fill me-2 text-success"></i>Cashback</a></li>
              <li><a class="dropdown-item py-2" href="#" data-edit-cc="${escapeHtml(c.id)}"><i class="bi bi-pencil me-2 text-primary"></i>Edit</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item py-2 text-danger" href="#" data-delete-cc="${escapeHtml(c.id)}"><i class="bi bi-trash me-2"></i>Delete</a></li>
            </ul>
          </div>
        </div>
      </div>

      <div class="cc-avail-hero">
        <div class="cc-avail-hero-val" style="color:${availColor}">${formatCurrency(available)}</div>
        <div class="cc-avail-hero-sub">${availLabel} &nbsp;·&nbsp; <strong>${formatCurrency(outstanding)}</strong> used of ${formatCurrency(c.creditLimit)}</div>
      </div>

      <div class="cc-card-progress-row">
        <div class="cc-card-progress-bar-wrap">
          <div class="cc-card-progress-bar">
            <div class="cc-card-progress-fill" style="width:${pct.toFixed(1)}%;background:${fillColor}"></div>
          </div>
        </div>
        <span class="cc-card-pct-badge ${pctBadgeCls}">${pct.toFixed(0)}%</span>
      </div>

      <div class="cc-info-grid">
        ${cycleCell}
        ${lastPayCell}
      </div>

      ${payHistHtml}
    </div>`;
}

function _populateChartFilter(accounts) {
  const sel = document.getElementById('acc-chart-filter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="all">All Accounts</option>' +
    accounts.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
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
  const totalCreditLimit = creditCards.reduce((s, c) => s + (Number(c.creditLimit) || 0), 0);
  const bankBalance   = bankAccounts.reduce((s, a) => s + computeBalance(a.name), 0);
  const walletBalance = wallets.reduce((s, a) => s + computeBalance(a.name), 0);
  const cashBalance   = cashAccounts.reduce((s, a) => s + computeBalance(a.name), 0);
  const el = id => document.getElementById(id);

  // Breakdown banner
  if (el('acc-stat-balance')) el('acc-stat-balance').textContent = formatCurrency(bankBalance);
  if (el('acc-stat-wallets')) el('acc-stat-wallets').textContent = formatCurrency(walletBalance);
  if (el('acc-stat-cash'))    el('acc-stat-cash').textContent    = formatCurrency(cashBalance);
  if (el('acc-stat-total'))   el('acc-stat-total').textContent   = formatCurrency(totalBalance);
  if (el('acc-stat-cards'))   el('acc-stat-cards').textContent   = creditCards.length;
  if (el('acc-stat-credit-used')) el('acc-stat-credit-used').textContent = formatCurrency(totalCreditUsed);
  if (el('cc-stat-limit'))    el('cc-stat-limit').textContent    = formatCurrency(totalCreditLimit);
  const totalAvailable = Math.max(totalCreditLimit - totalCreditUsed, 0);
  const overallUtil    = totalCreditLimit > 0 ? Math.min((totalCreditUsed / totalCreditLimit) * 100, 100) : 0;
  if (el('cc-stat-available'))   el('cc-stat-available').textContent   = formatCurrency(totalAvailable);
  if (el('cc-stat-utilization')) el('cc-stat-utilization').textContent = overallUtil.toFixed(1) + '%';
  _renderUtilDonut(overallUtil);
  const dueSoonCount = creditCards.filter(c => c.dueDay && _daysUntilNext(c.dueDay) <= 7).length;
  if (el('cc-stat-due-soon')) {
    el('cc-stat-due-soon').textContent = dueSoonCount;
    el('cc-stat-due-soon').style.color = dueSoonCount > 0 ? '#ef4444' : '';
  }

  // Breakdown proportion bar
  const posTotal = Math.max(bankBalance, 0) + Math.max(walletBalance, 0) + Math.max(cashBalance, 0);
  if (posTotal > 0) {
    const pBank   = (Math.max(bankBalance, 0)   / posTotal * 100).toFixed(1);
    const pWallet = (Math.max(walletBalance, 0) / posTotal * 100).toFixed(1);
    const pCash   = (Math.max(cashBalance, 0)   / posTotal * 100).toFixed(1);
    if (el('acc-bar-bank'))   el('acc-bar-bank').style.width   = pBank   + '%';
    if (el('acc-bar-wallet')) el('acc-bar-wallet').style.width = pWallet + '%';
    if (el('acc-bar-cash'))   el('acc-bar-cash').style.width   = pCash   + '%';
  }

  // Combined empty state & list visibility
  const allEmpty = accounts.length === 0;
  const allEmptyEl = document.getElementById('acc-all-empty');
  const listsContainer = document.getElementById('acc-lists-container');
  const breakdownBanner = document.getElementById('acc-breakdown-banner');
  if (allEmptyEl)      allEmptyEl.classList.toggle('d-none', !allEmpty);
  if (listsContainer)  listsContainer.classList.toggle('d-none', allEmpty);
  if (breakdownBanner) breakdownBanner.classList.toggle('d-none', allEmpty);

  // Populate chart filter dropdown
  _populateChartFilter(accounts);

  // Update account count badge
  const countEl = document.getElementById('acc-list-count');
  if (countEl) countEl.textContent = accounts.length ? `${accounts.length} account${accounts.length > 1 ? 's' : ''}` : '';

  // Unified list with section headers
  const unifiedList = document.getElementById('acc-unified-list');
  if (unifiedList) {
    let html = '';
    const _sectionHdr = (label, color, icon, modal, items) => {
      const sectionTotal = items.reduce((s, a) => s + computeBalance(a.name), 0);
      const countBadge = items.length ? `<span class="acc-section-hdr-count">${items.length}</span>` : '';
      const totalStr = items.length ? `<span class="acc-section-hdr-total" style="color:${color}">${formatCurrency(sectionTotal)}</span>` : '';
      return `<div class="acc-section-hdr">
        <div class="acc-section-hdr-left">
          <span class="acc-section-hdr-label" style="color:${color}"><i class="bi ${icon} me-1"></i>${label}</span>
          ${countBadge}
        </div>
        <div class="acc-section-hdr-right">
          ${totalStr}
          <button class="acc-section-hdr-add" data-bs-toggle="modal" data-bs-target="${modal}" title="Add"><i class="bi bi-plus-lg"></i></button>
        </div>
      </div>`;
    };
    const _emptyRow = (msg) =>
      `<div class="px-3 py-2 text-muted" style="font-size:.8rem">${msg}</div>`;

    html += _sectionHdr('Bank Accounts', '#3b82f6', 'bi-bank2', '#oc-account', bankAccounts);
    html += bankAccounts.length
      ? bankAccounts.map(a => _renderAccountRow(a)).join('')
      : _emptyRow('No bank accounts yet');

    html += _sectionHdr('Wallets', '#10b981', 'bi-wallet2', '#oc-wallet', wallets);
    html += wallets.length
      ? wallets.map(a => _renderAccountRow(a)).join('')
      : _emptyRow('No wallets yet');

    html += _sectionHdr('Cash', '#f59e0b', 'bi-cash-stack', '#oc-cash', cashAccounts);
    html += cashAccounts.length
      ? cashAccounts.map(a => _renderAccountRow(a)).join('')
      : _emptyRow('No cash yet');

    unifiedList.innerHTML = html;
    _bindAccountListEvents(unifiedList);
  }

  const cardsList = document.getElementById('credit-cards-list');
  const cardsEmpty = document.getElementById('credit-cards-empty-state');
  if (cardsList) {
    if (creditCards.length === 0) {
      cardsList.innerHTML = '';
      if (cardsEmpty) cardsEmpty.classList.remove('d-none');
    } else {
      if (cardsEmpty) cardsEmpty.classList.add('d-none');
      const expenses   = store.get('expenses')   ?? [];
      const ccPayments = store.get('ccPayments') ?? [];
      cardsList.innerHTML = creditCards.map((c, i) => _renderCcRow(c, expenses, ccPayments, i)).join('');
      cardsList.querySelectorAll('[data-pay-cc]').forEach(btn =>
        btn.addEventListener('click', () => _openPayCcModal(btn.dataset.payCc, parseFloat(btn.dataset.ccOutstanding))));
      cardsList.querySelectorAll('[data-cashback-cc]').forEach(btn =>
        btn.addEventListener('click', () => _openCashbackModal(btn.dataset.cashbackCc)));
      cardsList.querySelectorAll('[data-edit-cc]').forEach(btn =>
        btn.addEventListener('click', () => _startEditCreditCard(btn.dataset.editCc)));
      cardsList.querySelectorAll('[data-delete-cc]').forEach(btn =>
        btn.addEventListener('click', () => _deleteCreditCard(btn.dataset.deleteCc)));
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

  // Chart filter
  document.getElementById('acc-chart-filter')?.addEventListener('change', renderBalanceHistoryChart);

  // Per-account toggle
  document.getElementById('acc-chart-per-account')?.addEventListener('change', () => {
    const subEl = document.getElementById('acc-chart-subtitle');
    if (subEl) subEl.textContent = '';
    renderBalanceHistoryChart();
  });

  // Chart range tabs
  document.getElementById('acc-range-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    document.querySelectorAll('.acc-range-tab').forEach(t => t.classList.remove('acc-range-tab--active'));
    btn.classList.add('acc-range-tab--active');
    renderBalanceHistoryChart();
  });
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
