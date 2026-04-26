// js/dashboard.js - Dashboard module
import * as store from './store.js';
import { formatCurrency, isInCurrentMonth, isInMonth, getLast6Months } from './utils.js';
import { computeMoM, computeSpendingDayTiers } from './insights.js';
import { CONFIG } from './config.js';
import { fetchRows, writeAllRows } from './api.js';
import { calcAmortizationFull } from './loans.js';

function _getLoanOutstanding(loan) {
  if (!loan || loan.status !== 'active') return 0;
  const schedule = calcAmortizationFull(loan);
  if (!schedule.length) return loan.principal;
  const start = new Date((loan.startDate || '') + 'T00:00:00');
  const now = new Date();
  const elapsed = Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
  const paidMonths = Math.min(elapsed, schedule.length);
  return paidMonths === 0 ? loan.principal : (schedule[paidMonths - 1]?.balance ?? 0);
}

let _categoryChart      = null;
let _trendChart         = null;
let _netChart           = null;
let _yearChart          = null;
let _netWorthHistChart  = null;
let _savingsRateChart   = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function el(id) { return document.getElementById(id); }

const INR = (v) => '\u20B9' + new Intl.NumberFormat('en-IN').format(v);

export function render() {
  _renderSummary();
  _renderNetWorth();
  _renderSpendRate();
  _renderSavingsRate();
  _renderOverallSavingsRate();
  _renderBudgetSummary();
  _renderHeatmap();
  _renderCategoryBreakdown();
  _renderTop5Categories();
  _renderAccountBalances();
  _renderCreditUtilization();
  _renderTrendChart();
  _renderNetSavingsChart();
  _renderYearComparison();
  _renderSavingsProgress();
  _renderSpendingInsights();
  _renderMaintenanceReminders();
  _renderPaymentReminders();
  _renderSubcatBreakdown();
  _renderNetWorthHistoryChart();
  _renderSavingsRateTrend();
  _renderTopMerchants();
  _renderRecentTxns();
  _renderNetWorthGoal();
  _renderSpendingTiers();
}

function _renderSummary() {
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const totalIncome  = income.filter(r => isInCurrentMonth(r.date)).reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.filter(r => isInCurrentMonth(r.date)).reduce((s, r) => s + r.amount, 0);
  const net = totalIncome - totalExpense;

  const incomeEl  = el('dash-income');
  const expenseEl = el('dash-expense');
  const netEl     = el('dash-net');
  if (incomeEl)  incomeEl.textContent  = formatCurrency(totalIncome);
  if (expenseEl) expenseEl.textContent = formatCurrency(totalExpense);
  if (netEl) {
    netEl.textContent = formatCurrency(net);
    netEl.className = 'metric-value';
  }

  // Update metric progress bars with real data
  const base = totalIncome > 0 ? totalIncome : (totalExpense > 0 ? totalExpense : 1);
  const incomePct  = Math.min(100, Math.round((totalIncome / base) * 100));
  const expensePct = Math.min(100, Math.round((totalExpense / base) * 100));
  const netPct     = Math.min(100, Math.max(0, Math.round(((net + base) / (base * 2)) * 100)));

  const incomeBar  = document.querySelector('.metric-income .metric-bar-fill');
  const expenseBar = document.querySelector('.metric-expense .metric-bar-fill');
  const netBar     = document.querySelector('.metric-net .metric-bar-fill');
  if (incomeBar)  incomeBar.style.width  = incomePct  + '%';
  if (expenseBar) expenseBar.style.width = expensePct + '%';
  if (netBar)     netBar.style.width     = netPct     + '%';

  const allIncome  = income.reduce((s, r) => s + r.amount, 0);
  const allExpense = expenses.reduce((s, r) => s + r.amount, 0);
  const allNet     = allIncome - allExpense;
  const totalIncomeEl  = el('dash-total-income');
  const totalExpenseEl = el('dash-total-expense');
  const totalNetEl     = el('dash-total-net');
  if (totalIncomeEl)  totalIncomeEl.textContent  = formatCurrency(allIncome);
  if (totalExpenseEl) totalExpenseEl.textContent = formatCurrency(allExpense);
  if (totalNetEl)     totalNetEl.textContent     = formatCurrency(allNet);
}

function _renderNetWorth() {
  const accounts     = store.get('accounts')     ?? [];
  const creditCards  = store.get('creditCards')  ?? [];
  const lendings     = store.get('lendings')     ?? [];
  const expenses     = store.get('expenses')     ?? [];
  const income       = store.get('income')       ?? [];
  const transfers    = store.get('transfers')    ?? [];
  const ccPayments   = store.get('ccPayments')   ?? [];
  const investments  = store.get('investments')  ?? [];
  const loans        = store.get('loans')        ?? [];

  const computeBalance = (accountName) => {
    const initial    = Number(accounts.find(a => a.name === accountName)?.initialBalance) || 0;
    const totalExpenses   = expenses.filter(e => e.paymentMethod === accountName).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const totalIncome     = income.filter(i => i.receivedIn === accountName).reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalTransferOut = transfers.filter(t => t.sourceAccount === accountName).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalTransferIn  = transfers.filter(t => t.destinationAccount === accountName).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalCcPaid = ccPayments.filter(p => p.paidFromAccount === accountName).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return initial + totalIncome + totalTransferIn - totalExpenses - totalTransferOut - totalCcPaid;
  };

  const accountBalances   = accounts.reduce((sum, acc) => sum + computeBalance(acc.name), 0);
  const investmentValue   = investments.filter(i => i.status === 'active').reduce((s, i) => s + (Number(i.currentValue) || 0), 0);
  const totalAssets       = accountBalances + investmentValue;

  const creditCardDebt = creditCards.reduce((sum, card) => {
    const spent = expenses
      .filter(e => e.paymentMethod === card.name && String(e.category ?? '').trim().toLowerCase() !== 'cc payment')
      .reduce((s, e) => s + e.amount, 0);
    const paid  = ccPayments.filter(p => p.cardName === card.name).reduce((s, p) => s + p.amount, 0);
    return sum + Math.max(0, spent - paid);
  }, 0);
  const settlements = store.get('lendingSettlements') ?? [];
  const borrowedAmounts = lendings
    .filter(l => l.type === 'borrowed')
    .reduce((sum, l) => {
      const settled = settlements.filter(s => s.entryId === l.id).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return sum + Math.max(0, (Number(l.amount) || 0) - settled);
    }, 0);
  const loanOutstanding = loans.reduce((sum, l) => sum + _getLoanOutstanding(l), 0);
  const totalLiabilities = creditCardDebt + borrowedAmounts + loanOutstanding;

  const netWorth = totalAssets - totalLiabilities;

  const valueEl       = el('dash-networth-value');
  const assetsEl      = el('dash-networth-assets');
  const liabilitiesEl = el('dash-networth-liabilities');
  const accountsEl    = el('dash-networth-accounts');
  const investEl      = el('dash-networth-investments');
  const ccEl          = el('dash-networth-cc');
  const loansEl       = el('dash-networth-loans');
  const borrowedEl    = el('dash-networth-borrowed');

  if (valueEl) {
    valueEl.textContent = formatCurrency(netWorth);
    valueEl.style.color = netWorth >= 0 ? '#34d399' : '#f87171';
  }
  if (assetsEl)      assetsEl.textContent      = formatCurrency(totalAssets);
  if (liabilitiesEl) liabilitiesEl.textContent = formatCurrency(totalLiabilities);
  if (accountsEl)    accountsEl.textContent    = formatCurrency(accountBalances);
  if (investEl)      investEl.textContent      = formatCurrency(investmentValue);
  if (ccEl)          ccEl.textContent          = formatCurrency(creditCardDebt);
  if (loansEl)       loansEl.textContent       = formatCurrency(loanOutstanding);
  if (borrowedEl)    borrowedEl.textContent    = formatCurrency(borrowedAmounts);

  const accountsBar = el('dash-networth-accounts-bar');
  if (accountsBar && totalAssets > 0) {
    accountsBar.style.width = Math.round((accountBalances / totalAssets) * 100) + '%';
  }
  const ccBar = el('dash-networth-cc-bar');
  if (ccBar && totalLiabilities > 0) {
    ccBar.style.width = Math.round((creditCardDebt / totalLiabilities) * 100) + '%';
  }
}

function _renderSpendRate() {
  const expenses = store.get('expenses') ?? [];
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;

  const spent = expenses.filter(r => isInCurrentMonth(r.date)).reduce((s, r) => s + r.amount, 0);
  const dailyAvg = dayOfMonth > 0 ? spent / dayOfMonth : 0;
  const projected = Math.round(dailyAvg * daysInMonth);

  const valueEl   = el('dash-spend-rate-value');
  const subEl     = el('dash-spend-rate-sub');
  const dailyEl   = el('dash-daily-avg');
  const daysLeftEl = el('dash-days-left');
  const dotsEl    = el('dash-burn-days');

  if (valueEl)    valueEl.textContent   = formatCurrency(projected);
  if (dailyEl)    dailyEl.textContent   = formatCurrency(Math.round(dailyAvg));
  if (daysLeftEl) daysLeftEl.textContent = daysLeft;
  if (subEl)      subEl.textContent     = `Spent ${formatCurrency(Math.round(spent))} in ${dayOfMonth} days`;

  // Day-progress dots
  if (dotsEl) {
    dotsEl.innerHTML = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const cls = day < dayOfMonth ? 'burn-dot past' : day === dayOfMonth ? 'burn-dot today' : 'burn-dot future';
      return `<span class="${cls}" title="Day ${day}"></span>`;
    }).join('');
  }

  // Most active day & peak spending day (current month)
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayTotals = {};
  const dayOfWeekTotals = {};
  for (const r of expenses.filter(e => isInCurrentMonth(e.date))) {
    const d = new Date(r.date);
    if (isNaN(d)) continue;
    const dateKey = r.date.slice(0, 10);
    dayTotals[dateKey] = (dayTotals[dateKey] ?? 0) + r.amount;
    const dow = DAY_NAMES[d.getDay()];
    dayOfWeekTotals[dow] = (dayOfWeekTotals[dow] ?? 0) + r.amount;
  }

  const mostActiveEl   = el('dash-most-active-day');
  const peakSpendingEl = el('dash-peak-spending-day');

  if (mostActiveEl) {
    const entries = Object.entries(dayOfWeekTotals);
    if (entries.length) {
      const best = entries.reduce((a, b) => b[1] > a[1] ? b : a);
      mostActiveEl.textContent = best[0];
    } else {
      mostActiveEl.textContent = '—';
    }
  }

  if (peakSpendingEl) {
    const entries = Object.entries(dayTotals);
    if (entries.length) {
      const best = entries.reduce((a, b) => b[1] > a[1] ? b : a);
      peakSpendingEl.textContent = formatCurrency(Math.round(best[1]));
    } else {
      peakSpendingEl.textContent = '—';
    }
  }

  // Same-period vs last month comparison
  const vsLastEl = el('dash-vs-last');
  const vsDiffEl = el('dash-vs-diff');
  const vsDayEl  = el('dash-vs-day');
  if (vsLastEl && vsDiffEl) {
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastY  = lastMonthDate.getFullYear();
    const lastM  = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
    const lastMonthSpent = expenses.filter(r => {
      if (!r.date) return false;
      const d = parseInt(r.date.slice(8, 10), 10);
      return r.date.startsWith(`${lastY}-${lastM}`) && d <= dayOfMonth;
    }).reduce((s, r) => s + r.amount, 0);

    const diff  = spent - lastMonthSpent;
    const pct   = lastMonthSpent > 0 ? Math.abs(Math.round((diff / lastMonthSpent) * 100)) : 0;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    const color = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : '#64748b';

    if (vsDayEl)  vsDayEl.textContent  = dayOfMonth;
    vsLastEl.textContent = formatCurrency(Math.round(lastMonthSpent));
    vsDiffEl.innerHTML   = `<span style="color:${color}">${arrow} ${pct}%</span>`;

    const insightEl = el('dash-vs-insight');
    if (insightEl) {
      let msg = '';
      if (lastMonthSpent === 0) {
        msg = `<i class="bi bi-info-circle me-1"></i>No last month data`;
      } else if (diff > 0) {
        msg = `<i class="bi bi-arrow-up me-1"></i>${pct}% more than last month`;
      } else if (diff < 0) {
        msg = `<i class="bi bi-arrow-down me-1"></i>${pct}% less than last month`;
      } else {
        msg = `<i class="bi bi-dash me-1"></i>On par with last month`;
      }
      insightEl.style.color = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : '#64748b';
      insightEl.innerHTML = msg;
    }
  }
}

function _renderSavingsRate() {
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const totalIncome  = income.filter(r => isInCurrentMonth(r.date)).reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.filter(r => isInCurrentMonth(r.date)).reduce((s, r) => s + r.amount, 0);
  const net = totalIncome - totalExpense;
  const rate = totalIncome > 0 ? Math.round((net / totalIncome) * 100) : 0;

  const valueEl      = el('dash-savings-rate-value');
  const labelEl      = el('dash-savings-rate-label');
  const barEl        = el('dash-savings-rate-bar');
  const usedPctEl    = el('dash-savings-used-pct');
  const goalGapEl    = el('dash-savings-goal-gap');
  const bufferEl     = el('dash-savings-buffer');
  const statusEl     = el('dash-savings-status');

  // Derived stats
  const TARGET_SAVE_PCT = 20;
  const incomeUsedPct = totalIncome > 0 ? Math.round((totalExpense / totalIncome) * 100) : 0;
  const targetSavings = totalIncome * (TARGET_SAVE_PCT / 100);
  const gapAmt = net - targetSavings; // positive = ahead, negative = need to save more
  const safeSpendLimit = totalIncome * 0.8;
  const buffer = Math.max(0, safeSpendLimit - totalExpense);

  // Status logic
  let status = '—';
  let statusColor = '#94a3b8';
  if (totalIncome === 0) {
    status = 'No income';
    statusColor = '#94a3b8';
  } else if (rate >= TARGET_SAVE_PCT) {
    status = 'On Track';
    statusColor = '#10b981';
  } else if (rate >= 10) {
    status = 'Getting there';
    statusColor = '#f59e0b';
  } else if (net >= 0) {
    status = 'Low savings';
    statusColor = '#d97706';
  } else {
    status = 'At risk';
    statusColor = '#ef4444';
  }

  if (valueEl) {
    valueEl.textContent = rate + '%';
    valueEl.style.color = rate >= 20 ? '#10b981' : rate >= 0 ? '#f59e0b' : '#ef4444';
  }
  if (labelEl) {
    labelEl.textContent = rate >= 20 ? 'Great savings pace' : rate >= 0 ? 'of income saved' : 'Spending exceeds income';
  }
  if (barEl) {
    const pct = Math.min(100, Math.max(0, rate));
    barEl.style.width = pct + '%';
    barEl.style.background = rate >= 20
      ? 'linear-gradient(90deg,#10b981,#34d399)'
      : rate >= 0
      ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
      : 'linear-gradient(90deg,#ef4444,#f87171)';
  }
  if (usedPctEl) {
    usedPctEl.textContent = incomeUsedPct + '%';
    usedPctEl.style.color = incomeUsedPct > 90 ? '#ef4444' : incomeUsedPct > 80 ? '#f59e0b' : '#1e293b';
  }
  if (goalGapEl) {
    if (totalIncome === 0) {
      goalGapEl.textContent = '—';
      goalGapEl.style.color = '#94a3b8';
    } else {
      const ptGap = rate - TARGET_SAVE_PCT;
      goalGapEl.textContent = (ptGap >= 0 ? '+' : '') + ptGap + '% pts';
      goalGapEl.style.color = ptGap >= 0 ? '#10b981' : '#ef4444';
    }
  }
  if (bufferEl) {
    bufferEl.textContent = formatCurrency(buffer);
    bufferEl.style.color = buffer > 0 ? '#10b981' : '#ef4444';
  }
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.style.color = statusColor;
  }
}

function _renderOverallSavingsRate() {
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const allIncome  = income.reduce((s, r) => s + r.amount, 0);
  const allExpense = expenses.reduce((s, r) => s + r.amount, 0);
  const allNet  = allIncome - allExpense;
  const rate = allIncome > 0 ? Math.round((allNet / allIncome) * 100) : 0;

  const valueEl      = el('dash-overall-rate-value');
  const labelEl      = el('dash-overall-rate-label');
  const barEl        = el('dash-overall-rate-bar');
  const amountEl     = el('dash-overall-amount');
  const monthsEl     = el('dash-overall-months');
  const avgMonthEl   = el('dash-overall-avg');
  const bestMonthEl  = el('dash-overall-best');
  const posMonthsEl  = el('dash-overall-positive');
  const trendEl      = el('dash-overall-trend');

  const allMonths = new Set([
    ...income.map(r => r.date ? r.date.slice(0, 7) : null),
    ...expenses.map(r => r.date ? r.date.slice(0, 7) : null)
  ]);
  allMonths.delete(null);
  const monthCount = allMonths.size;
  const avgNet = monthCount > 0 ? allNet / monthCount : 0;

  // Per-month net to find best month and positive count
  const monthNetMap = {};
  income.forEach(r => {
    if (!r.date) return;
    const m = r.date.slice(0, 7);
    monthNetMap[m] = (monthNetMap[m] ?? 0) + r.amount;
  });
  expenses.forEach(r => {
    if (!r.date) return;
    const m = r.date.slice(0, 7);
    monthNetMap[m] = (monthNetMap[m] ?? 0) - r.amount;
  });
  const monthEntries = Object.entries(monthNetMap);
  const positiveCount = monthEntries.filter(([, v]) => v > 0).length;
  const bestEntry = monthEntries.length
    ? monthEntries.reduce((a, b) => b[1] > a[1] ? b : a)
    : null;

  if (valueEl) {
    valueEl.textContent = rate + '%';
    valueEl.style.color = rate >= 20 ? '#10b981' : rate >= 0 ? '#f59e0b' : '#ef4444';
  }
  if (labelEl) {
    labelEl.textContent = rate >= 20 ? 'Healthy overall savings' : rate >= 0 ? 'of all-time income saved' : 'Overall spending exceeds income';
  }
  if (barEl) {
    barEl.style.width = Math.min(100, Math.max(0, rate)) + '%';
    barEl.style.background = rate >= 20
      ? 'linear-gradient(90deg,#10b981,#34d399)'
      : rate >= 0
      ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
      : 'linear-gradient(90deg,#ef4444,#f87171)';
  }
  if (monthsEl) {
    monthsEl.textContent = monthCount;
    monthsEl.style.color = '#1e293b';
  }
  if (avgMonthEl) {
    avgMonthEl.textContent = formatCurrency(Math.abs(avgNet));
    avgMonthEl.style.color = avgNet >= 0 ? '#10b981' : '#ef4444';
  }
  if (bestMonthEl) {
    if (bestEntry) {
      const [ym, val] = bestEntry;
      const [y, m] = ym.split('-');
      const label = new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
      bestMonthEl.textContent = `${label} · ${formatCurrency(Math.round(val))}`;
      bestMonthEl.style.color = val >= 0 ? '#d97706' : '#ef4444';
    } else {
      bestMonthEl.textContent = '—';
    }
  }
  if (posMonthsEl) {
    posMonthsEl.textContent = monthCount > 0 ? `${positiveCount} / ${monthCount}` : '0';
    posMonthsEl.style.color = positiveCount > 0 ? '#7c3aed' : '#94a3b8';
  }
  if (amountEl) {
    amountEl.textContent = formatCurrency(Math.abs(allNet));
    amountEl.style.color = allNet >= 0 ? '#10b981' : '#ef4444';
  }
  if (trendEl) {
    if (allNet > 0) {
      trendEl.innerHTML = '<i class="bi bi-arrow-up-right me-1"></i>Surplus';
      trendEl.style.color = '#10b981';
    } else if (allNet < 0) {
      trendEl.innerHTML = '<i class="bi bi-arrow-down-right me-1"></i>Deficit';
      trendEl.style.color = '#ef4444';
    } else {
      trendEl.textContent = 'Break Even';
      trendEl.style.color = '#94a3b8';
    }
  }
}

function _renderHeatmap() {
  const container = el('dash-heatmap');
  const monthRow  = el('dash-heatmap-months');
  if (!container) return;

  const expenses = store.get('expenses') ?? [];

  // Build date → total spend map
  const spendMap = {};
  expenses.forEach(r => {
    if (r.date) spendMap[r.date] = (spendMap[r.date] ?? 0) + r.amount;
  });

  // Use local date parts directly — never rely on Date object comparison
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const toLocalDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // Start 52 weeks back, aligned to Sunday of that week
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  startDay.setDate(startDay.getDate() - startDay.getDay() - 51 * 7);

  // End = Saturday of current week
  const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));

  const maxSpend = Math.max(...Object.values(spendMap), 1);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const cols = [];
  const monthLabels = [];
  const cur = new Date(startDay);
  let colIndex = 0;
  let lastMonth = -1;

  while (cur <= endDay) {
    const weekCells = [];

    for (let d = 0; d < 7; d++) {
      // Track month label position
      if (cur.getDate() <= 7 && cur.getMonth() !== lastMonth) {
        monthLabels.push({ colIndex, label: MONTHS[cur.getMonth()] });
        lastMonth = cur.getMonth();
      }

      const dateStr = toLocalDate(cur);
      const spend = spendMap[dateStr] ?? 0;
      const isFuture = dateStr > todayStr;
      const isToday = dateStr === todayStr;

      let bg = '#ebedf0';
      if (!isFuture && spend > 0) {
        const intensity = spend / maxSpend;
        if (intensity < 0.15)      bg = '#9be9a8';
        else if (intensity < 0.35) bg = '#40c463';
        else if (intensity < 0.6)  bg = '#30a14e';
        else                       bg = '#216e39';
      }
      if (isFuture) bg = '#f6f8fa';

      const border = isToday ? 'box-shadow:inset 0 0 0 2px #6366f1;' : '';
      const title  = isFuture ? '' : spend > 0
        ? `${dateStr}: ${formatCurrency(spend)}`
        : `${dateStr}: No spend`;

      weekCells.push(`<span class="hm-cell" style="background:${bg};${border}" title="${title}"></span>`);
      cur.setDate(cur.getDate() + 1);
    }

    cols.push(`<div class="hm-col">${weekCells.join('')}</div>`);
    colIndex++;
  }

  container.innerHTML = cols.join('');

  // Render month labels
  if (monthRow) {
    const totalCols = colIndex;
    monthRow.innerHTML = monthLabels.map(m =>
      `<span style="position:absolute;left:${((m.colIndex / totalCols) * 100).toFixed(2)}%;font-size:.62rem;color:#64748b;white-space:nowrap">${m.label}</span>`
    ).join('');
  }
}

// Category breakdown (pie) with period filter
function _getCategoryFilteredExpenses() {
  const sel = el('dash-category-filter');
  const period = sel ? sel.value : 'current';
  const expenses = store.get('expenses') ?? [];
  if (period === 'current') return expenses.filter(r => isInCurrentMonth(r.date));
  if (period === 'last6') {
    const months = getLast6Months();
    return expenses.filter(r => months.some(m => isInMonth(r.date, m)));
  }
  return expenses;
}

export function renderCategoryBreakdown() { _renderCategoryBreakdown(); }

function _renderCategoryBreakdown() {
  const filtered = _getCategoryFilteredExpenses();
  const byCategory = {};
  filtered.forEach(r => { byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount; });

  // Sort by amount descending, group tail into "Others" if > 8 categories
  let entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const MAX_SLICES = 11;
  if (entries.length > MAX_SLICES) {
    const top = entries.slice(0, MAX_SLICES - 1);
    const othersTotal = entries.slice(MAX_SLICES - 1).reduce((s, [, v]) => s + v, 0);
    entries = [...top, ['Others', othersTotal]];
  }
  const labels = entries.map(([k]) => k);
  const data   = entries.map(([, v]) => v);

  const canvas = el('dash-category-chart');
  if (!canvas) return;
  const emptyEl = el('dash-category-empty');
  if (labels.length === 0) {
    canvas.classList.add('d-none');
    if (emptyEl) emptyEl.classList.remove('d-none');
    if (_categoryChart) { _categoryChart.destroy(); _categoryChart = null; }
    return;
  }
  if (emptyEl) emptyEl.classList.add('d-none');
  canvas.classList.remove('d-none');

  const COLORS = [
    '#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6',
    '#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16',
    '#06b6d4','#a855f7','#e11d48','#0ea5e9','#22c55e',
    '#d97706','#7c3aed','#059669','#dc2626','#2563eb',
  ];
  const total = data.reduce((s, v) => s + v, 0);
  const bgColors = labels.map((_, i) => COLORS[i % COLORS.length]);

  const chartConfig = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors,
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverOffset: 10,
        hoverBorderWidth: 3,
      }],
    },
    options: {
      cutout: '65%',
      animation: { animateRotate: true, duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `  ${INR(ctx.parsed)}  (${pct}%)`;
            },
          },
          backgroundColor: 'rgba(15,23,42,0.85)',
          titleFont: { size: 13, weight: 'bold' },
          bodyFont: { size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
    },
  };

  if (_categoryChart) {
    _categoryChart.data.labels = labels;
    _categoryChart.data.datasets[0].data = data;
    _categoryChart.data.datasets[0].backgroundColor = bgColors;
    _categoryChart.update();
  } else {
    _categoryChart = new Chart(canvas, chartConfig);
  }

  // Custom legend below chart
  const legendEl = el('dash-category-legend');
  if (legendEl) {
    legendEl.innerHTML = labels.map((lbl, i) => `
      <div class="dcat-leg-item">
        <span class="dcat-leg-dot" style="background:${bgColors[i]}"></span>
        <span class="dcat-leg-name" title="${escapeHtml(lbl)}">${escapeHtml(lbl)}</span>
        <span class="dcat-leg-pct">${total > 0 ? ((data[i] / total) * 100).toFixed(0) : 0}%</span>
      </div>`).join('');
  }
}

// Top 5 Spending Categories (current month)
function _renderTop5Categories() {
  const container = el('dash-top5');
  if (!container) return;
  const expenses = store.get('expenses') ?? [];
  const thisMonth = expenses.filter(r => isInCurrentMonth(r.date));
  const byCategory = {};
  thisMonth.forEach(r => { byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount; });
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sorted.length === 0) {
    container.innerHTML = '<p class="text-muted small">No expenses this month.</p>';
    return;
  }
  const max = sorted[0][1];
  const BAR_COLORS = ['#ef4444','#f59e0b','#3b82f6','#6366f1','#64748b'];
  container.innerHTML = sorted.map(([cat, amt], i) => {
    const pct = max > 0 ? (amt / max) * 100 : 0;
    const color = BAR_COLORS[i];
    return `
      <div class="mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="small fw-semibold d-flex align-items-center gap-2">
            <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
            ${escapeHtml(cat)}
          </span>
          <span class="small text-muted">${formatCurrency(amt)}</span>
        </div>
        <div class="progress" style="height:8px">
          <div class="progress-bar" role="progressbar"
            style="width:${pct.toFixed(1)}%;background:${color}"
            aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
      </div>`;
  }).join('');
}

function _renderAccountBalances() {
  const container = el('dash-account-balances');
  if (!container) return;
  const accounts    = store.get('accounts')    ?? [];
  const expenses    = store.get('expenses')    ?? [];
  const income      = store.get('income')      ?? [];
  const transfers   = store.get('transfers')   ?? [];
  const ccPayments  = store.get('ccPayments')  ?? [];

  if (accounts.length === 0) {
    container.innerHTML = `<div class="text-center py-3"><i class="bi bi-bank2 text-muted" style="font-size:1.8rem"></i><p class="text-muted small mt-2 mb-0">No accounts yet. <a href="#" onclick="document.querySelector('[data-tab=tab-accounts]').click();return false">Add an account</a> to track balances.</p></div>`;
    return;
  }

  const rows = [];

  accounts.forEach(a => {
    const opening   = Number(a.initialBalance) || 0;
    const credited  = income.filter(r => r.receivedIn === a.name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const debited   = expenses.filter(r => r.paymentMethod === a.name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const txIn      = transfers.filter(r => r.destinationAccount === a.name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const txOut     = transfers.filter(r => r.sourceAccount === a.name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const ccPaid    = ccPayments.filter(p => p.paidFromAccount === a.name).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const balance   = opening + credited - debited + txIn - txOut - ccPaid;
    const cls       = balance < 0 ? 'text-danger' : 'text-success';
    rows.push(`
      <div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
        <div>
          <div class="small fw-semibold">${escapeHtml(a.name)}</div>
          <div class="text-muted" style="font-size:0.75rem">${escapeHtml(a.type)}</div>
        </div>
        <div class="small fw-semibold ${cls}">${formatCurrency(balance)}</div>
      </div>`);
  });

  container.innerHTML = rows.join('');
}

function _renderCreditUtilization() {
  const container  = el('dash-credit-util');
  if (!container) return;
  const cards      = store.get('creditCards') ?? [];
  const expenses   = store.get('expenses')    ?? [];
  const ccPayments = store.get('ccPayments')  ?? [];
  if (cards.length === 0) {
    container.innerHTML = `<div class="text-center py-3"><i class="bi bi-credit-card text-muted" style="font-size:1.8rem"></i><p class="text-muted small mt-2 mb-0">No credit cards added yet. <a href="#" onclick="document.querySelector('[data-tab=tab-accounts]').click();return false">Add a card</a> to start tracking.</p></div>`;
    return;
  }
  const now = new Date();
  container.innerHTML = cards.map(c => {
    // Determine billing cycle start date
    let cycleStart;
    if (c.billingCycleStart) {
      const sd = parseInt(c.billingCycleStart, 10);
      cycleStart = now.getDate() >= sd
        ? new Date(now.getFullYear(), now.getMonth(), sd)
        : new Date(now.getFullYear(), now.getMonth() - 1, sd);
    } else {
      cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const cycleStartStr = `${cycleStart.getFullYear()}-${String(cycleStart.getMonth()+1).padStart(2,'0')}-${String(cycleStart.getDate()).padStart(2,'0')}`;
    // Exclude "CC Payment" entries; filter to current billing cycle only
    const spent = expenses
      .filter(e => e.paymentMethod === c.name
        && String(e.category ?? '').trim().toLowerCase() !== 'cc payment'
        && (e.date ?? '') >= cycleStartStr)
      .reduce((s, e) => s + e.amount, 0);
    const paid  = ccPayments
      .filter(p => p.cardName === c.name && (p.date ?? '') >= cycleStartStr)
      .reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(spent - paid, 0);
    const pct    = c.creditLimit > 0 ? Math.min((outstanding / c.creditLimit) * 100, 100) : 0;
    const barCls = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-info';
    return `<div class="mb-3"><div class="d-flex justify-content-between align-items-center mb-1"><span class="small fw-semibold">${escapeHtml(c.name)}</span><span class="small text-muted">${formatCurrency(outstanding)} / ${formatCurrency(c.creditLimit)}</span></div><div class="progress" style="height:10px"><div class="progress-bar ${barCls}" role="progressbar" style="width:${pct.toFixed(1)}%" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div></div><div class="text-muted" style="font-size:.65rem;margin-top:2px">Current cycle from ${cycleStartStr}</div></div>`;
  }).join('');
}

// 6-Month Income vs Expenses â€” LINE chart
function _renderTrendChart() {
  const canvas = el('dash-trend-chart');
  if (!canvas) return;
  const months      = getLast6Months();
  const expenses    = store.get('expenses') ?? [];
  const income      = store.get('income')   ?? [];
  const incomeData  = months.map(m => income.filter(r => isInMonth(r.date, m)).reduce((s, r) => s + r.amount, 0));
  const expenseData = months.map(m => expenses.filter(r => isInMonth(r.date, m)).reduce((s, r) => s + r.amount, 0));
  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });
  if (_trendChart) {
    _trendChart.data.labels = labels;
    _trendChart.data.datasets[0].data = incomeData;
    _trendChart.data.datasets[1].data = expenseData;
    _trendChart.update();
  } else {
    _trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: incomeData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.12)',
            pointBackgroundColor: '#10b981',
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Expenses',
            data: expenseData,
            borderColor: '#f87171',
            backgroundColor: 'rgba(248,113,113,0.12)',
            pointBackgroundColor: '#f87171',
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: { y: { ticks: { callback: (v) => INR(v) } } },
      },
    });
  }
}

function _renderNetSavingsChart() {
  const canvas = el('dash-net-chart');
  if (!canvas) return;
  const months   = getLast6Months();
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const netData  = months.map(m => {
    const inc = income.filter(r => isInMonth(r.date, m)).reduce((s, r) => s + r.amount, 0);
    const exp = expenses.filter(r => isInMonth(r.date, m)).reduce((s, r) => s + r.amount, 0);
    return inc - exp;
  });
  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });
  const pointColors = netData.map(v => v >= 0 ? '#10b981' : '#f87171');
  if (_netChart) {
    _netChart.data.labels = labels;
    _netChart.data.datasets[0].data = netData;
    _netChart.data.datasets[0].pointBackgroundColor = pointColors;
    _netChart.update();
  } else {
    _netChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Net Savings',
          data: netData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.12)',
          pointBackgroundColor: pointColors,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.3,
          segment: {
            borderColor: (ctx) => ctx.p1.parsed.y >= 0 ? '#10b981' : '#f87171',
            backgroundColor: (ctx) => ctx.p1.parsed.y >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(248,113,113,0.12)',
          },
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: {
            ticks: { callback: (v) => INR(v) },
            grid: { color: (ctx) => ctx.tick.value === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)' },
          },
        },
      },
    });
  }
}

function _renderSubcatBreakdown() {
  const container = el('dash-subcat-breakdown');
  if (!container) return;

  const sel = el('dash-subcat-filter');
  const period = sel ? sel.value : 'current';
  const expenses = store.get('expenses') ?? [];

  let filtered;
  if (period === 'current') {
    filtered = expenses.filter(r => isInCurrentMonth(r.date));
  } else if (period === 'last6') {
    const months = getLast6Months();
    filtered = expenses.filter(r => months.some(m => isInMonth(r.date, m)));
  } else {
    filtered = expenses;
  }

  // Only expenses that have a subcategory
  const withSub = filtered.filter(r => r.subCategory);
  if (withSub.length === 0) {
    container.innerHTML = '<p class="text-muted small">No subcategory data for this period.</p>';
    return;
  }

  // Group: category → subCategory → total
  const grouped = {};
  withSub.forEach(r => {
    if (!grouped[r.category]) grouped[r.category] = {};
    grouped[r.category][r.subCategory] = (grouped[r.category][r.subCategory] ?? 0) + r.amount;
  });

  // Sort categories by their total spend desc
  const catEntries = Object.entries(grouped)
    .map(([cat, subs]) => ({ cat, total: Object.values(subs).reduce((s, v) => s + v, 0), subs }))
    .sort((a, b) => b.total - a.total);

  const grandTotal = catEntries.reduce((s, c) => s + c.total, 0);
  const CAT_COLORS = ['#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#f97316','#06b6d4','#ec4899','#64748b'];

  container.innerHTML = `<div class="subcat-bd-grid">${catEntries.map(({ cat, total, subs }, ci) => {
    const color = CAT_COLORS[ci % CAT_COLORS.length];
    const catPct = grandTotal > 0 ? (total / grandTotal * 100).toFixed(1) : 0;
    const subEntries = Object.entries(subs).sort((a, b) => b[1] - a[1]);

    return `
      <div class="subcat-bd-group">
        <div class="subcat-bd-cat-header">
          <span class="subcat-bd-dot" style="background:${color}"></span>
          <span class="subcat-bd-cat-name">${escapeHtml(cat)}</span>
          <span class="subcat-bd-cat-pct">${catPct}%</span>
          <span class="subcat-bd-cat-amt">${formatCurrency(total)}</span>
        </div>
        <div class="subcat-bd-items">
          ${subEntries.map(([sub, amt]) => {
            const pct = total > 0 ? (amt / total * 100) : 0;
            return `
              <div class="subcat-bd-row">
                <span class="subcat-bd-name" title="${escapeHtml(sub)}">${escapeHtml(sub)}</span>
                <div class="subcat-bd-bar-wrap">
                  <div class="subcat-bd-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div>
                </div>
                <span class="subcat-bd-pct">${pct.toFixed(0)}%</span>
                <span class="subcat-bd-amt">${formatCurrency(amt)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('')}</div>`;
}

function _renderMaintenanceReminders() {
  const container = el('dash-maintenance-reminders');
  if (!container) return;

  const records = store.get('maintenance') ?? [];
  if (records.length === 0) {
    container.innerHTML = '<p class="text-muted small">No maintenance records yet.</p>';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const manualOdo = store.get('manualOdo') ?? {};
  const tripOdo = {};
  (store.get('tripLogs') ?? []).forEach(l => {
    if (!tripOdo[l.vehicleName] || l.odoReading > tripOdo[l.vehicleName])
      tripOdo[l.vehicleName] = l.odoReading;
  });
  const maintOdo = {};
  records.forEach(r => {
    if (!maintOdo[r.vehicleName] || r.odoReading > maintOdo[r.vehicleName])
      maintOdo[r.vehicleName] = r.odoReading;
  });
  const getCurrentOdo = (vName) => manualOdo[vName] ?? (Math.max(tripOdo[vName] ?? 0, maintOdo[vName] ?? 0) || null);

  // Deduplicate: keep only the latest entry per vehicle+type (last in array = most recently added)
  const latestMap = {};
  records.forEach(r => { latestMap[`${r.vehicleName}__${r.type}`] = r; });
  const deduped = Object.values(latestMap);

  // Compute status for each record
  const withStatus = deduped.map(r => {
    const curOdo = getCurrentOdo(r.vehicleName) ?? r.odoReading;
    const doneDate = new Date(r.date);
    const nextKm   = r.intervalKm   > 0 ? r.odoReading + r.intervalKm   : null;
    const nextDate = r.intervalDays > 0 ? new Date(doneDate.getTime() + r.intervalDays * 86400000) : null;
    const kmLeft   = nextKm   ? nextKm - curOdo : null;
    const daysLeft = nextDate ? Math.round((nextDate - today) / 86400000) : null;

    let status = 'ok';
    if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) {
      status = 'overdue';
    } else if (nextKm && nextDate) {
      if (kmLeft <= 300 && daysLeft <= 14) status = 'due-soon';
    } else if (kmLeft !== null && kmLeft <= 300) {
      status = 'due-soon';
    } else if (daysLeft !== null && daysLeft <= 14) {
      status = 'due-soon';
    }
    return { ...r, status, kmLeft, daysLeft, nextKm, nextDate };
  });

  // Sort: overdue first, then due-soon, then ok — always show all
  const order = { overdue: 0, 'due-soon': 1, ok: 2 };
  withStatus.sort((a, b) => order[a.status] - order[b.status] || a.vehicleName.localeCompare(b.vehicleName));

  const urgent = withStatus.filter(r => r.status !== 'ok');
  const toShow = withStatus;

  container.innerHTML = `<div class="dash-maint-grid">${toShow.map(r => {
    const badge = r.status === 'overdue'
      ? `<span class="badge bg-danger">Overdue</span>`
      : r.status === 'due-soon'
      ? `<span class="badge bg-warning text-dark">Due Soon</span>`
      : `<span class="badge bg-success">OK</span>`;

    const kmHtml = r.kmLeft !== null
      ? `<span class="dash-maint-stat ${r.kmLeft <= 0 ? 'text-danger' : r.kmLeft <= 300 ? 'text-warning' : 'text-success'}">
           <i class="bi bi-speedometer2 me-1"></i>${r.kmLeft > 0 ? '+' + r.kmLeft.toLocaleString('en-IN') + ' km' : 'Overdue'}
         </span>`
      : '';
    const daysHtml = r.daysLeft !== null
      ? `<span class="dash-maint-stat ${r.daysLeft <= 0 ? 'text-danger' : r.daysLeft <= 14 ? 'text-warning' : 'text-success'}">
           <i class="bi bi-calendar3 me-1"></i>${r.daysLeft > 0 ? '+' + r.daysLeft + 'd' : 'Overdue'}
         </span>`
      : '';

    return `
      <div class="dash-maint-card status-${r.status}">
        <div class="dash-maint-top">
          <div class="dash-maint-icon"><i class="bi bi-tools"></i></div>
          <div class="dash-maint-info">
            <div class="dash-maint-type">${escapeHtml(r.type)}</div>
            <div class="dash-maint-vehicle"><i class="bi bi-car-front-fill me-1"></i>${escapeHtml(r.vehicleName)}</div>
          </div>
          ${badge}
        </div>
        <div class="dash-maint-stats">${kmHtml}${daysHtml}</div>
      </div>`;
  }).join('')}</div>
  ${urgent.length === 0 && withStatus.length > 0 ? '<p class="text-success small mt-2 mb-0"><i class="bi bi-check-circle me-1"></i>All maintenance up to date.</p>' : ''}`;

  // Append insurance policy reminders (expiring within 30 days)
  const insurancePolicies = store.get('vehicleInsurance') ?? [];
  const insuranceAlerts = [];
  insurancePolicies.forEach(p => {
    if (!p.expiryDate) return;
    const dt = new Date(p.expiryDate);
    if (isNaN(dt)) return;
    const daysLeft = Math.round((dt - today) / 86400000);
    if (daysLeft <= 30) {
      const status = daysLeft < 0 ? 'overdue' : 'due-soon';
      const badge = daysLeft < 0
        ? `<span class="badge bg-danger">Expired</span>`
        : `<span class="badge bg-warning text-dark">Expiring Soon</span>`;
      const daysHtml = `<span class="dash-maint-stat ${daysLeft < 0 ? 'text-danger' : 'text-warning'}">
        <i class="bi bi-calendar3 me-1"></i>${daysLeft >= 0 ? '+' + daysLeft + 'd' : 'Expired'}
      </span>`;
      insuranceAlerts.push(`
        <div class="dash-maint-card status-${status}">
          <div class="dash-maint-top">
            <div class="dash-maint-icon"><i class="bi bi-shield-check text-success"></i></div>
            <div class="dash-maint-info">
              <div class="dash-maint-type">${escapeHtml(p.policyType)} Insurance</div>
              <div class="dash-maint-vehicle"><i class="bi bi-car-front-fill me-1"></i>${escapeHtml(p.vehicleName)}${p.provider ? ' · ' + escapeHtml(p.provider) : ''}</div>
            </div>
            ${badge}
          </div>
          <div class="dash-maint-stats">${daysHtml}</div>
        </div>`);
    }
  });
  if (insuranceAlerts.length > 0) {
    container.insertAdjacentHTML('beforeend',
      `<div class="dash-maint-grid mt-2">${insuranceAlerts.join('')}</div>`);
  }

  // Append RC document reminders (expiring within 30 days)
  const docs = store.get('vehicleDocuments') ?? [];
  const rcAlerts = [];
  docs.forEach(d => {
    if (!d.rcExpiry) return;
    const dt = new Date(d.rcExpiry);
    if (isNaN(dt)) return;
    const daysLeft = Math.round((dt - today) / 86400000);
    if (daysLeft <= 30) {
      const status = daysLeft < 0 ? 'overdue' : 'due-soon';
      const badge = daysLeft < 0
        ? `<span class="badge bg-danger">Expired</span>`
        : `<span class="badge bg-warning text-dark">Due Soon</span>`;
      const daysHtml = `<span class="dash-maint-stat ${daysLeft < 0 ? 'text-danger' : 'text-warning'}">
        <i class="bi bi-calendar3 me-1"></i>${daysLeft >= 0 ? '+' + daysLeft + 'd' : 'Expired'}
      </span>`;
      rcAlerts.push(`
        <div class="dash-maint-card status-${status}">
          <div class="dash-maint-top">
            <div class="dash-maint-icon"><i class="bi bi-file-earmark-text text-info"></i></div>
            <div class="dash-maint-info">
              <div class="dash-maint-type">RC Registration</div>
              <div class="dash-maint-vehicle"><i class="bi bi-car-front-fill me-1"></i>${escapeHtml(d.vehicleName)}</div>
            </div>
            ${badge}
          </div>
          <div class="dash-maint-stats">${daysHtml}</div>
        </div>`);
    }
  });
  if (rcAlerts.length > 0) {
    container.insertAdjacentHTML('beforeend',
      `<div class="dash-maint-grid mt-2">${rcAlerts.join('')}</div>`);
  }
}

function _renderPaymentReminders() {
  const container = el('dash-payment-reminders');
  if (!container) return;

  const windowDays = parseInt(el('dash-reminder-window')?.value || '7', 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reminders = [];

  // 1. Bills due in next N days
  const bills = store.get('bills') ?? [];
  bills.filter(b => b.active).forEach(b => {
    let next;
    if (b.frequency === 'yearly') {
      const yearlyMonth = b.dueMonth ? b.dueMonth - 1 : 0;
      next = new Date(today.getFullYear(), yearlyMonth, b.dueDay);
      if (next < today) next.setFullYear(next.getFullYear() + 1);
    } else if (b.frequency === 'quarterly') {
      const startMonth = b.dueMonth ? b.dueMonth - 1 : 0;
      const offset = (today.getMonth() - startMonth + 12) % 3;
      const monthsToAdd = offset === 0 ? 0 : 3 - offset;
      next = new Date(today.getFullYear(), today.getMonth() + monthsToAdd, b.dueDay);
      if (next < today) next = new Date(today.getFullYear(), today.getMonth() + monthsToAdd + 3, b.dueDay);
    } else {
      next = new Date(today.getFullYear(), today.getMonth(), b.dueDay);
      if (next < today) next.setMonth(next.getMonth() + 1);
    }
    
    // Skip if already paid this cycle
    if (b.lastPaid) {
      const lastPaidDate = new Date(b.lastPaid);
      if (b.frequency === 'monthly') {
        // For monthly bills, check if paid in the same month as the next due date
        if (lastPaidDate.getFullYear() === next.getFullYear() && 
            lastPaidDate.getMonth() === next.getMonth()) {
          return; // Skip this bill
        }
      } else if (b.frequency === 'yearly') {
        // For yearly bills, check if paid in the same year as the next due date
        if (lastPaidDate.getFullYear() === next.getFullYear()) {
          return; // Skip this bill
        }
      }
    }
    
    const daysUntil = Math.round((next - today) / 86400000);
    if (daysUntil >= 0 && daysUntil <= windowDays) {
      reminders.push({ type: 'bill', data: b, next, daysUntil });
    }
  });

  // 2. Credit card due dates — upcoming (≤N days) and overdue (past due, unpaid)
  const creditCards  = store.get('creditCards') ?? [];
  const ccPayments   = store.get('ccPayments')  ?? [];
  creditCards.filter(c => c.dueDay).forEach(c => {
    const todayDay = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const effectiveDue = Math.min(c.dueDay, daysInMonth);
    // Negative = overdue, 0 = due today, positive = days until due
    const daysUntil = effectiveDue - todayDay;

    // Payment window: billing cycle end → today (covers early and late payments)
    let paymentWindowStart;
    if (c.billingCycleStart) {
      const sd = c.billingCycleStart;
      const endDay = sd === 1 ? new Date(year, month, 0).getDate() : sd - 1;
      const endMonth = month === 0 ? 11 : month - 1;
      const endYear  = month === 0 ? year - 1 : year;
      paymentWindowStart = new Date(endYear, endMonth, endDay);
    } else {
      paymentWindowStart = new Date(year, month, effectiveDue);
      paymentWindowStart.setDate(paymentWindowStart.getDate() - 35);
    }
    const paidThisCycle = ccPayments.some(p => {
      if (p.cardName !== c.name || !p.date) return false;
      const pd = new Date(p.date + 'T00:00:00');
      return pd >= paymentWindowStart && pd <= today;
    });
    if (paidThisCycle) return;

    // Show if upcoming within N days OR already overdue
    if (daysUntil <= windowDays) {
      reminders.push({ type: 'creditcard', data: c, daysUntil });
    }
  });

  // 3. Recurring transactions due in next N days
  const recurring = store.get('recurring') ?? [];
  recurring.filter(r => !r.paused).forEach(r => {
    const next = new Date(today);
    if (r.frequency === 'monthly') {
      next.setDate(r.day);
      if (next < today) next.setMonth(next.getMonth() + 1);
    } else if (r.frequency === 'weekly') {
      const dayOfWeek = next.getDay();
      const daysToAdd = (r.day - dayOfWeek + 7) % 7;
      next.setDate(next.getDate() + daysToAdd);
      if (next < today) next.setDate(next.getDate() + 7);
    }
    const daysUntil = Math.round((next - today) / 86400000);
    if (daysUntil >= 0 && daysUntil <= windowDays) {
      reminders.push({ type: 'recurring', data: r, next, daysUntil });
    }
  });

  // Sort by days until due
  reminders.sort((a, b) => a.daysUntil - b.daysUntil);

  if (reminders.length === 0) {
    container.innerHTML = `<p class="text-muted small">No payments due in the next ${windowDays} days.</p>`;
    return;
  }

  const html = reminders.map(r => {
    const badge = r.daysUntil === 0
      ? `<span class="badge bg-danger">Due Today</span>`
      : `<span class="badge bg-warning text-dark">Due in ${r.daysUntil}d</span>`;

    if (r.type === 'bill') {
      const nextStr = r.next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      return `
        <div class="dash-maint-card status-${r.daysUntil === 0 ? 'overdue' : 'due-soon'}">
          <div class="dash-maint-top">
            <div class="dash-maint-icon"><i class="bi bi-receipt text-warning"></i></div>
            <div class="dash-maint-info">
              <div class="dash-maint-type">${escapeHtml(r.data.name)}</div>
              <div class="dash-maint-vehicle"><i class="bi bi-tag me-1"></i>${escapeHtml(r.data.category)} · ${formatCurrency(r.data.amount)}</div>
            </div>
            ${badge}
          </div>
          <div class="dash-maint-stats">
            <span class="dash-maint-stat ${r.daysUntil === 0 ? 'text-danger' : r.daysUntil <= 3 ? 'text-warning' : 'text-info'}">
              <i class="bi bi-calendar-event me-1"></i>${nextStr}${r.daysUntil === 0 ? ' (today)' : r.daysUntil === 1 ? ' (tomorrow)' : ''}
            </span>
          </div>
        </div>`;
    } else if (r.type === 'creditcard') {
      const ccBadge = r.daysUntil < 0
        ? `<span class="badge bg-danger">Overdue ${-r.daysUntil}d</span>`
        : r.daysUntil === 0
        ? `<span class="badge bg-danger">Due Today</span>`
        : `<span class="badge bg-warning text-dark">Due in ${r.daysUntil}d</span>`;
      const ccText = r.daysUntil < 0
        ? `Overdue by ${-r.daysUntil} day${-r.daysUntil === 1 ? '' : 's'}`
        : r.daysUntil === 0 ? 'Due today'
        : `${r.daysUntil} day${r.daysUntil === 1 ? '' : 's'} left`;
      const ord = n => n + (['th','st','nd','rd'][((n%100)-20)%10] || ['th','st','nd','rd'][n%100] || 'th');
      return `
        <div class="dash-maint-card status-${r.daysUntil <= 0 ? 'overdue' : 'due-soon'}">
          <div class="dash-maint-top">
            <div class="dash-maint-icon"><i class="bi bi-credit-card-fill text-primary"></i></div>
            <div class="dash-maint-info">
              <div class="dash-maint-type">${escapeHtml(r.data.name)}</div>
              <div class="dash-maint-vehicle"><i class="bi bi-calendar-check me-1"></i>Payment due on ${ord(r.data.dueDay)}</div>
            </div>
            ${ccBadge}
          </div>
          <div class="dash-maint-stats">
            <span class="dash-maint-stat text-${r.daysUntil < 0 ? 'danger' : r.daysUntil <= 3 ? 'danger' : 'warning'}">
              <i class="bi bi-clock me-1"></i>${ccText}
            </span>
          </div>
        </div>`;
    } else if (r.type === 'recurring') {
      const nextStr = r.next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const isExpense = r.data.type === 'expense';
      return `
        <div class="dash-maint-card status-${r.daysUntil === 0 ? 'overdue' : 'due-soon'}">
          <div class="dash-maint-top">
            <div class="dash-maint-icon"><i class="bi bi-arrow-repeat ${isExpense ? 'text-danger' : 'text-success'}"></i></div>
            <div class="dash-maint-info">
              <div class="dash-maint-type">${escapeHtml(r.data.description)}</div>
              <div class="dash-maint-vehicle"><i class="bi bi-tag me-1"></i>${escapeHtml(r.data.category)} · ${formatCurrency(r.data.amount)} · ${isExpense ? 'Expense' : 'Income'}</div>
            </div>
            ${badge}
          </div>
          <div class="dash-maint-stats">
            <span class="dash-maint-stat ${r.daysUntil === 0 ? 'text-danger' : r.daysUntil <= 3 ? 'text-warning' : 'text-info'}">
              <i class="bi bi-calendar-event me-1"></i>${nextStr}${r.daysUntil === 0 ? ' (today)' : r.daysUntil === 1 ? ' (tomorrow)' : ''}
            </span>
          </div>
        </div>`;
    }
  }).join('');

  container.innerHTML = `<div class="dash-maint-grid">${html}</div>`;
}

function _renderBudgetSummary() {
  const spentEl  = document.getElementById('dash-budget-spent');
  const totalEl  = document.getElementById('dash-budget-total');
  const remainingEl = document.getElementById('dash-budget-remaining');
  const barEl    = document.getElementById('dash-budget-bar');
  const okEl     = document.getElementById('dash-budget-ok');
  const overEl   = document.getElementById('dash-budget-over');
  const subEl    = document.getElementById('dash-budget-sub');
  if (!spentEl) return;

  const budgets  = store.get('budgets')  ?? [];
  const expenses = store.get('expenses') ?? [];

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const thisMonthBudgets = budgets.filter(b => b.month === monthKey);
  if (thisMonthBudgets.length === 0) {
    if (subEl) subEl.textContent = 'No budgets set for this month';
    if (spentEl) spentEl.textContent = '—';
    if (totalEl) totalEl.textContent = '—';
    if (barEl) barEl.style.width = '0%';
    if (okEl) okEl.textContent = '0 on track';
    if (overEl) overEl.textContent = '0 over budget';
    return;
  }

  const thisMonthExpenses = expenses.filter(r => {
    if (!r.date) return false;
    return r.date.slice(0, 7) === monthKey;
  });

  const spentByCategory = {};
  thisMonthExpenses.forEach(r => {
    spentByCategory[r.category] = (spentByCategory[r.category] ?? 0) + r.amount;
  });

  let totalBudgeted = 0;
  let totalSpent    = 0;
  let overCount     = 0;
  let okCount       = 0;

  thisMonthBudgets.forEach(b => {
    const spent = spentByCategory[b.category] ?? 0;
    totalBudgeted += b.monthlyLimit;
    totalSpent    += spent;
    if (spent > b.monthlyLimit) overCount++;
    else okCount++;
  });

  const pct = totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0;
  const isOver = totalSpent > totalBudgeted;
  const remaining = Math.max(totalBudgeted - totalSpent, 0);

  if (spentEl) spentEl.textContent = formatCurrency(totalSpent);
  if (totalEl) totalEl.textContent = formatCurrency(totalBudgeted);
  if (subEl)   subEl.textContent   = 'This month\'s spend vs budget';
  if (remainingEl) remainingEl.textContent = formatCurrency(remaining);
  
  if (barEl) {
    barEl.style.width = pct.toFixed(1) + '%';
    barEl.style.background = isOver
      ? 'linear-gradient(90deg,#ef4444,#f87171)'
      : pct >= 80
      ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
      : 'linear-gradient(90deg,#10b981,#34d399)';
  }
  if (okEl)   okEl.textContent   = okCount   + ' on track';
  if (overEl) overEl.textContent = overCount + ' over budget';

  // 3-month budget adherence trend
  const trendEl = document.getElementById('dash-budget-trend');
  if (trendEl) {
    const lines = [];
    for (let i = 2; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const mBudgets = budgets.filter(b => b.month === mKey);
      if (mBudgets.length === 0) continue;
      const mExp = expenses.filter(r => r.date && r.date.slice(0, 7) === mKey);
      const mSpent = {};
      mExp.forEach(r => { mSpent[r.category] = (mSpent[r.category] ?? 0) + r.amount; });
      const mOver = mBudgets.filter(b => (mSpent[b.category] ?? 0) > b.monthlyLimit).length;
      const mOk   = mBudgets.length - mOver;
      const label  = d.toLocaleDateString('en-IN', { month: 'short' });
      const color  = mOver === 0 ? '#10b981' : mOver <= 1 ? '#f59e0b' : '#ef4444';
      lines.push(`<span style="color:${color};font-size:.75rem;font-weight:600">${label}: ${mOk}/${mBudgets.length} ok</span>`);
    }
    trendEl.innerHTML = lines.length ? lines.join('<span class="mx-1 text-muted">·</span>') : '';
  }
}

function _renderSavingsProgress() {
  const container = el('dash-savings');
  if (!container) return;
  const goals = store.get('savings') ?? [];
  if (goals.length === 0) {
    container.innerHTML = `<div class="text-center py-3"><i class="bi bi-piggy-bank text-muted" style="font-size:1.8rem"></i><p class="text-muted small mt-2 mb-0">No savings goals yet. <a href="#" onclick="document.querySelector('[data-tab=tab-savings]').click();return false">Create a goal</a> to start saving.</p></div>`;
    return;
  }
  container.innerHTML = goals.map(g => {
    const pct    = g.targetAmount > 0 ? Math.min((g.savedAmount / g.targetAmount) * 100, 100) : 0;
    const barCls = pct >= 100 ? 'bg-success' : 'bg-primary';
    return `<div class="mb-3"><div class="d-flex justify-content-between align-items-center mb-1"><span class="small fw-semibold">${escapeHtml(g.name)}</span><span class="small text-muted">${formatCurrency(g.savedAmount)} / ${formatCurrency(g.targetAmount)}</span></div><div class="progress" style="height:10px"><div class="progress-bar ${barCls}" role="progressbar" style="width:${pct.toFixed(1)}%" aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"></div></div></div>`;
  }).join('');
}

function _renderYearComparison() {
  const canvas = document.getElementById('dash-year-chart');
  if (!canvas) return;
  const expenses = store.get('expenses') ?? [];
  const now = new Date();
  const curYear = now.getFullYear();
  const lastYear = curYear - 1;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const curData = Array(12).fill(0);
  const lastData = Array(12).fill(0);

  expenses.forEach(e => {
    if (!e.date) return;
    const y = parseInt(e.date.slice(0, 4));
    const m = parseInt(e.date.slice(5, 7)) - 1;
    if (y === curYear) curData[m] += e.amount;
    else if (y === lastYear) lastData[m] += e.amount;
  });

  if (_yearChart) { _yearChart.destroy(); _yearChart = null; }

  _yearChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: String(curYear),
          data: curData,
          backgroundColor: 'rgba(139,92,246,0.75)',
          borderColor: '#a78bfa',
          borderWidth: 1,
        },
        {
          label: String(lastYear),
          data: lastData,
          backgroundColor: 'rgba(255,255,255,0.15)',
          borderColor: 'rgba(255,255,255,0.3)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: { y: { ticks: { callback: v => '₹' + new Intl.NumberFormat('en-IN').format(v) } } },
    },
  });
}

function _renderNetWorthHistoryChart() {
  const canvas = document.getElementById('dash-networth-hist-chart');
  if (!canvas) return;

  const expenses  = store.get('expenses')  ?? [];
  const income    = store.get('income')    ?? [];
  const accounts  = store.get('accounts')  ?? [];

  // Collect all months that appear in any transaction
  const monthSet = new Set();
  [...expenses, ...income].forEach(r => {
    if (r.date && r.date.length >= 7) monthSet.add(r.date.slice(0, 7));
  });
  if (monthSet.size === 0) {
    if (_netWorthHistChart) { _netWorthHistChart.destroy(); _netWorthHistChart = null; }
    return;
  }

  const initialBalance = accounts.reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);

  const months = [...monthSet].sort();
  // Extend to current month if not already present
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!monthSet.has(curYM)) months.push(curYM);

  const investments   = store.get('investments') ?? [];
  const loans          = store.get('loans')       ?? [];
  const investOffset   = investments.filter(i => i.status === 'active').reduce((s, i) => s + (Number(i.currentValue) || 0), 0);
  const loanOffset     = loans.reduce((s, l) => s + _getLoanOutstanding(l), 0);

  const data = months.map(ym => {
    const cumIncome  = income.filter(r  => r.date && r.date.slice(0, 7) <= ym).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const cumExpense = expenses.filter(r => r.date && r.date.slice(0, 7) <= ym).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return Math.round(initialBalance + cumIncome - cumExpense + investOffset - loanOffset);
  });

  const labels = months.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  if (_netWorthHistChart) { _netWorthHistChart.destroy(); _netWorthHistChart = null; }

  _netWorthHistChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net Worth',
        data,
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(139,92,246,0.12)',
        borderWidth: 2.5,
        pointRadius: months.length <= 12 ? 4 : 2,
        pointBackgroundColor: data.map(v => v >= 0 ? '#a78bfa' : '#f87171'),
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + formatCurrency(ctx.parsed.y) } },
      },
      scales: {
        y: { ticks: { callback: v => '₹' + new Intl.NumberFormat('en-IN').format(v) } },
        x: { ticks: { maxTicksLimit: 12 } },
      },
    },
  });
}

function _renderRecentTxns() {
  const container = document.getElementById('dash-recent-txns');
  if (!container) return;
  const expenses = (store.get('expenses') ?? []).filter(r => r.date).map(r => ({ ...r, _txnType: 'expense' }));
  const incomes  = (store.get('income')   ?? []).filter(r => r.date).map(r => ({ ...r, _txnType: 'income' }));
  const recent = [...expenses, ...incomes]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
  if (recent.length === 0) {
    container.innerHTML = `<div class="text-center py-3"><i class="bi bi-clock-history text-muted" style="font-size:1.8rem"></i><p class="text-muted small mt-2 mb-0">No transactions yet. <a href="#" onclick="document.querySelector('[data-tab=tab-expenses]').click();return false">Add your first expense</a> to get started.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="recent-txn-list">${recent.map(e => {
    const isInc  = e._txnType === 'income';
    const color  = isInc ? '#34d399' : '#f87171';
    const bgClr  = isInc ? 'rgba(52,211,153,.12)' : 'rgba(248,113,113,.12)';
    const icon   = isInc ? 'bi-arrow-down-circle-fill' : 'bi-arrow-up-circle-fill';
    const rawLabel = isInc ? (e.source || e.description || '—') : (e.description || e.category || '—');
    const label  = rawLabel.replace(/\s*\[ve:[^\]]+\]/g, '').trim() || rawLabel;
    const sub    = isInc ? 'Income' : (e.category || 'Expense');
    const dateStr = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return `<div class="recent-txn-item">
      <div class="recent-txn-icon" style="background:${bgClr}"><i class="bi ${icon}" style="color:${color}"></i></div>
      <div class="recent-txn-body">
        <div class="recent-txn-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="recent-txn-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="recent-txn-right">
        <div class="recent-txn-amount" style="color:${color}">${formatCurrency(e.amount)}</div>
        <div class="recent-txn-date">${dateStr}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _renderSpendingInsights() {
  const container  = el('dash-spending-insights');
  const monthLabel = el('dash-insights-month');
  if (!container) return;
  const expenses = store.get('expenses') ?? [];
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (monthLabel) monthLabel.textContent = new Date(curYM + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const mom = computeMoM(expenses);
  const { byCategory, currentTotal, previousTotal, absoluteDiff, percentChange } = mom;
  const insights = [];
  if (previousTotal > 0) {
    const sign  = absoluteDiff >= 0 ? '+' : '';
    const arrow = absoluteDiff > 0 ? '\u2197' : '\u2198';
    const cls   = absoluteDiff > 0 ? 'text-danger' : 'text-success';
    insights.push({ icon: 'bi-graph-up-arrow', cls, text: `Total spending ${arrow} ${sign}${Math.round(percentChange)}% vs last month (${formatCurrency(Math.abs(Math.round(absoluteDiff)))} ${absoluteDiff > 0 ? 'more' : 'less'})` });
  } else if (currentTotal > 0) {
    insights.push({ icon: 'bi-graph-up-arrow', cls: 'text-muted', text: `First month tracked \u2014 ${formatCurrency(Math.round(currentTotal))} spent so far.` });
  }
  const increases = [...byCategory.entries()].filter(([, v]) => v.previous > 0 && v.diff > 0).sort((a, b) => Math.abs(b[1].diff) - Math.abs(a[1].diff)).slice(0, 3);
  for (const [cat, v] of increases) {
    insights.push({ icon: 'bi-arrow-up-circle-fill', cls: 'text-danger', text: `${cat} spending up ${Math.round(v.pct)}% vs last month (${formatCurrency(Math.round(v.current))} vs ${formatCurrency(Math.round(v.previous))})` });
  }
  const decreases = [...byCategory.entries()].filter(([, v]) => v.previous > 0 && v.diff < 0).sort((a, b) => a[1].diff - b[1].diff).slice(0, 2);
  for (const [cat, v] of decreases) {
    insights.push({ icon: 'bi-arrow-down-circle-fill', cls: 'text-success', text: `${cat} spending down ${Math.round(Math.abs(v.pct))}% vs last month \u2014 well done!` });
  }
  const newCats = [...byCategory.entries()].filter(([, v]) => v.previous === 0 && v.current > 0);
  if (newCats.length) {
    insights.push({ icon: 'bi-tag-fill', cls: 'text-primary', text: `New categor${newCats.length > 1 ? 'ies' : 'y'} this month: ${newCats.map(([c]) => c).join(', ')}` });
  }
  if (insights.length === 0) {
    container.innerHTML = '<p class="text-muted small mb-0">Add more expenses across multiple months to see insights.</p>';
    return;
  }
  container.innerHTML = `<div class="insights-list">${insights.map(i => `<div class="insight-item"><span class="insight-icon ${i.cls}"><i class="bi ${i.icon}"></i></span><span class="insight-text">${escapeHtml(i.text)}</span></div>`).join('')}</div>`;
}

function _renderSavingsRateTrend() {
  const canvas = document.getElementById('dash-savings-rate-chart');
  if (!canvas) return;
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const rates = months.map(ym => {
    const inc = income.filter(r => r.date && r.date.slice(0, 7) === ym).reduce((s, r) => s + r.amount, 0);
    const exp = expenses.filter(r => r.date && r.date.slice(0, 7) === ym).reduce((s, r) => s + r.amount, 0);
    if (inc === 0) return null;
    return Math.round(((inc - exp) / inc) * 1000) / 10;
  });
  const labels = months.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });
  if (_savingsRateChart) { _savingsRateChart.destroy(); _savingsRateChart = null; }
  const _srColor = v => v === null ? 'transparent' : v >= 20 ? '#10b981' : v >= 0 ? '#f59e0b' : '#ef4444';
  const _srBg    = v => v === null ? 'transparent' : v >= 20 ? 'rgba(16,185,129,0.08)' : v >= 0 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
  _savingsRateChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Savings Rate %',
        data: rates,
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: rates.map(_srColor),
        pointBorderColor:     rates.map(_srColor),
        segment: {
          borderColor: ctx => _srColor(ctx.p1.parsed.y ?? 0),
          backgroundColor: ctx => _srBg(ctx.p1.parsed.y ?? 0),
        },
        fill: true,
        tension: 0.35,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y === null ? ' No income' : ` ${ctx.parsed.y}%` } },
      },
      scales: { y: { ticks: { callback: v => v + '%' } } },
    },
  });
}

function _renderTopMerchants() {
  const container = document.getElementById('dash-top-merchants');
  if (!container) return;
  const expenses = store.get('expenses') ?? [];
  const now = new Date();
  const period = document.getElementById('dash-merchant-filter')?.value || 'last3';
  let recent;
  if (period === 'current') {
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    recent = expenses.filter(r => r.date && r.date.startsWith(curYM));
  } else if (period === 'last3') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    recent = expenses.filter(r => r.date && r.date.slice(0, 7) >= cutoffStr);
  } else if (period === 'last6') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    recent = expenses.filter(r => r.date && r.date.slice(0, 7) >= cutoffStr);
  } else {
    recent = expenses;
  }
  if (recent.length === 0) { container.innerHTML = '<p class="text-muted small mb-0">No expense data for this period.</p>'; return; }
  const map = {};
  recent.forEach(e => {
    const desc = (e.description || '').trim();
    if (!desc) return;
    const key = desc.toLowerCase();
    if (!map[key]) map[key] = { display: desc, count: 0, total: 0 };
    map[key].count++;
    map[key].total += Number(e.amount) || 0;
  });
  const sorted = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 8);
  if (sorted.length === 0) { container.innerHTML = '<p class="text-muted small mb-0">Add descriptions to your expenses to see top merchants.</p>'; return; }
  const maxTotal = sorted[0].total;
  const fmt = v => '\u20B9' + new Intl.NumberFormat('en-IN').format(Math.round(v));
  container.innerHTML = sorted.map((m, i) => `<div class="merchant-row"><div class="merchant-rank">${i + 1}</div><div class="merchant-info"><div class="merchant-name">${escapeHtml(m.display)}</div><div class="merchant-bar-wrap"><div class="merchant-bar" style="width:${Math.round((m.total / maxTotal) * 100)}%"></div></div></div><div class="merchant-stats"><div class="merchant-amount">${fmt(m.total)}</div><div class="merchant-txn">${m.count} txn${m.count > 1 ? 's' : ''}</div></div></div>`).join('');
}

// ─── Net Worth Goal ───────────────────────────────────────────────────────────

const NW_GOAL_SETTING = 'netWorthGoal';

function _getGoalFromStore() {
  const settings = store.get('settings') ?? [];
  const row = settings.find(s => s.key === NW_GOAL_SETTING);
  if (row) return parseFloat(row.value) || 0;
  return parseFloat(localStorage.getItem('ep_networth_goal') || '0');
}

async function _saveGoalToStore(val) {
  const settings = store.get('settings') ?? [];
  const existing = settings.find(s => s.key === NW_GOAL_SETTING);
  const updated = existing
    ? settings.map(s => s.key === NW_GOAL_SETTING ? { ...s, value: String(val) } : s)
    : [...settings, { key: NW_GOAL_SETTING, value: String(val) }];
  try {
    await writeAllRows(CONFIG.sheets.settings, updated.map(s => [s.key, s.value]));
    store.set('settings', updated);
    localStorage.removeItem('ep_networth_goal');
  } catch (_) {
    localStorage.setItem('ep_networth_goal', String(val));
  }
}

async function _clearGoalFromStore() {
  const settings = (store.get('settings') ?? []).filter(s => s.key !== NW_GOAL_SETTING);
  try {
    await writeAllRows(CONFIG.sheets.settings, settings.map(s => [s.key, s.value]));
    store.set('settings', settings);
  } catch (_) {}
  localStorage.removeItem('ep_networth_goal');
}

function _computeCurrentNetWorth() {
  const accounts    = store.get('accounts')    ?? [];
  const creditCards = store.get('creditCards') ?? [];
  const expenses    = store.get('expenses')    ?? [];
  const income      = store.get('income')      ?? [];
  const transfers   = store.get('transfers')   ?? [];
  const ccPayments  = store.get('ccPayments')  ?? [];
  const lendings    = store.get('lendings')    ?? [];
  const settlements = store.get('lendingSettlements') ?? [];
  const investments = store.get('investments') ?? [];
  const loans       = store.get('loans')       ?? [];
  const computeBalance = (name) => {
    const initial = Number(accounts.find(a => a.name === name)?.initialBalance) || 0;
    const inc  = income.filter(i => i.receivedIn === name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const exp  = expenses.filter(e => e.paymentMethod === name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const tOut = transfers.filter(t => t.sourceAccount === name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const tIn  = transfers.filter(t => t.destinationAccount === name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const ccP  = ccPayments.filter(p => p.paidFromAccount === name).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return initial + inc + tIn - exp - tOut - ccP;
  };
  const accountBalances = accounts.reduce((s, a) => s + computeBalance(a.name), 0);
  const investmentValue = investments.filter(i => i.status === 'active').reduce((s, i) => s + (Number(i.currentValue) || 0), 0);
  const totalAssets = accountBalances + investmentValue;
  const creditCardDebt = creditCards.reduce((s, card) => {
    const spent = expenses.filter(e => e.paymentMethod === card.name && String(e.category ?? '').trim().toLowerCase() !== 'cc payment').reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const paid  = ccPayments.filter(p => p.cardName === card.name).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    return s + Math.max(0, spent - paid);
  }, 0);
  const borrowedAmounts = lendings.filter(l => l.type === 'borrowed').reduce((s, l) => {
    const settled = settlements.filter(x => x.entryId === l.id).reduce((acc, x) => acc + (Number(x.amount) || 0), 0);
    return s + Math.max(0, (Number(l.amount) || 0) - settled);
  }, 0);
  const loanOutstanding = loans.reduce((sum, l) => sum + _getLoanOutstanding(l), 0);
  return totalAssets - creditCardDebt - borrowedAmounts - loanOutstanding;
}

function _renderNetWorthGoal() {
  const body = document.getElementById('dash-networth-goal-body');
  if (!body) return;
  const target  = _getGoalFromStore();
  const current = _computeCurrentNetWorth();
  if (!target) {
    body.innerHTML = `<p class="text-muted small mb-0">No goal set. Click <i class="bi bi-pencil-fill"></i> to set your net worth target.<br><small class="text-muted">Your goal syncs across devices via Google Sheets.</small></p>`;
    return;
  }
  const pct      = Math.min(100, Math.max(0, target > 0 ? (current / target) * 100 : 0));
  const gap      = target - current;
  const barColor = pct >= 100 ? '#10b981' : pct >= 60 ? '#6366f1' : pct >= 30 ? '#f59e0b' : '#ef4444';
  let projectedDate = '', projectedMonths = null;
  if (gap > 0) {
    const expenses = store.get('expenses') ?? [];
    const income   = store.get('income')   ?? [];
    const now = new Date();
    const monthlyNets = [];
    for (let i = 1; i <= 6; i++) {
      const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const inc = income.filter(r => r.date?.startsWith(ym)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const exp = expenses.filter(r => r.date?.startsWith(ym)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      if (inc > 0 || exp > 0) monthlyNets.push(inc - exp);
    }
    if (monthlyNets.length > 0) {
      const avgMonthly = monthlyNets.reduce((s, v) => s + v, 0) / monthlyNets.length;
      if (avgMonthly > 0) {
        projectedMonths = Math.ceil(gap / avgMonthly);
        const projDate = new Date(new Date().getFullYear(), new Date().getMonth() + projectedMonths, 1);
        projectedDate = projDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      }
    }
  }
  const achieved = current >= target;
  body.innerHTML = `<div class="nwg-body">
    <div class="nwg-stats">
      <div class="nwg-stat"><div class="nwg-stat-label">Current Net Worth</div><div class="nwg-stat-value" style="color:#6366f1">${formatCurrency(Math.round(current))}</div></div>
      <div class="nwg-stat"><div class="nwg-stat-label">Target</div><div class="nwg-stat-value" style="color:#f3f4f6">${formatCurrency(Math.round(target))}</div></div>
      <div class="nwg-stat"><div class="nwg-stat-label">${achieved ? 'Surplus' : 'Remaining'}</div><div class="nwg-stat-value" style="color:${achieved ? '#10b981' : '#ef4444'}">${formatCurrency(Math.abs(Math.round(gap)))}</div></div>
      <div class="nwg-stat"><div class="nwg-stat-label">Progress</div><div class="nwg-stat-value" style="color:${barColor}">${pct.toFixed(1)}%</div></div>
    </div>
    <div class="nwg-bar-wrap"><div class="nwg-bar" style="width:${pct}%;background:${barColor}"></div></div>
    ${achieved
      ? `<div class="nwg-projection text-success"><i class="bi bi-trophy-fill me-1"></i>\uD83C\uDFC6 Goal achieved! Your net worth has reached the target.</div>`
      : projectedDate
        ? `<div class="nwg-projection"><i class="bi bi-calendar2-check me-1 text-primary"></i>At your current savings rate, you'll reach this goal by <strong>${projectedDate}</strong> (~${projectedMonths} month${projectedMonths !== 1 ? 's' : ''}).</div>`
        : `<div class="nwg-projection text-muted"><i class="bi bi-info-circle me-1"></i>Add 6+ months of income data to see projected achievement date.</div>`
    }
  </div>`;
}

function _initNetWorthGoal() {
  document.getElementById('btn-nwg-edit')?.addEventListener('click', () => {
    const body = document.getElementById('dash-networth-goal-body');
    if (!body) return;
    const current = _getGoalFromStore();
    body.innerHTML = `<div class="d-flex align-items-center gap-3 flex-wrap">
      <label class="fw-semibold small mb-0">Net Worth Target (\u20B9)</label>
      <div class="input-group" style="max-width:280px">
        <span class="input-group-text">\u20B9</span>
        <input type="number" id="nwg-input" class="form-control" placeholder="e.g. 5000000" value="${current || ''}" min="0" step="1000" />
      </div>
      <button class="btn btn-primary btn-sm" id="nwg-save-btn"><i class="bi bi-check2 me-1"></i>Save</button>
      <button class="btn btn-outline-secondary btn-sm" id="nwg-cancel-btn">Cancel</button>
      ${current ? `<button class="btn btn-outline-danger btn-sm" id="nwg-clear-btn"><i class="bi bi-x-lg me-1"></i>Clear Goal</button>` : ''}
    </div>`;
    document.getElementById('nwg-save-btn')?.addEventListener('click', async () => {
      const val = parseFloat(document.getElementById('nwg-input')?.value || '0');
      if (val > 0) await _saveGoalToStore(val);
      _renderNetWorthGoal();
    });
    document.getElementById('nwg-cancel-btn')?.addEventListener('click', _renderNetWorthGoal);
    document.getElementById('nwg-clear-btn')?.addEventListener('click', async () => {
      await _clearGoalFromStore();
      _renderNetWorthGoal();
    });
  });
}

// ─── Daily Spending Tier Widget ──────────────────────────────────────────────

function _populateTiersMonthSelector() {
  const sel = el('dash-tiers-month');
  if (!sel) return;
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const months = [...new Set([
    ...expenses.map(e => String(e.date ?? '').slice(0, 7)),
    ...income.map(i => String(i.date ?? '').slice(0, 7)),
  ].filter(Boolean))].sort().reverse();
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!months.includes(curYM)) months.unshift(curYM);
  const prev = sel.value;
  sel.innerHTML = months.map(m => {
    const label = new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return `<option value="${m}"${m === (prev || curYM) ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

function _renderSpendingTiers() {
  const container = el('dash-spending-tiers');
  if (!container) return;
  _populateTiersMonthSelector();
  const selectedYM = el('dash-tiers-month')?.value || '';
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const { tiers, totalDays, longestZeroStreak } = computeSpendingDayTiers(expenses, income, selectedYM || undefined);

  container.innerHTML = `
    <div class="sdt-row">
      ${tiers.map(t => `
        <div class="sdt-badge" style="--sdt-color:${t.color}">
          <div class="sdt-emoji">${t.emoji}</div>
          <div class="sdt-count" style="color:${t.color}">${t.total}</div>
          <div class="sdt-label">${t.label}</div>
          <div class="sdt-range">${t.range}</div>
          <div class="sdt-sub">${t.weekdays} weekdays · ${t.weekends} weekends</div>
        </div>`).join('')}
    </div>
    <div class="sdt-footer">
      <span class="sdt-note"><i class="bi bi-info-circle me-1"></i>${totalDays} days counted</span>
      ${longestZeroStreak >= 3 ? `<span class="sdt-streak"><i class="bi bi-fire me-1"></i>${longestZeroStreak}-day zero-spend streak!</span>` : ''}
    </div>`;
}

// ─── Monthly Summary Report ───────────────────────────────────────────────────

function _populateMonthSelector() {
  const sel = document.getElementById('monthly-report-month-sel');
  if (!sel) return;
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const months = [...new Set([
    ...expenses.map(e => String(e.date ?? '').slice(0, 7)),
    ...income.map(i => String(i.date ?? '').slice(0, 7)),
  ].filter(Boolean))].sort().reverse();
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!months.includes(curYM)) months.unshift(curYM);
  sel.innerHTML = months.map(m => {
    const label = new Date(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return `<option value="${m}">${label}</option>`;
  }).join('');
}

function _generateReport(month) {
  const expenses = (store.get('expenses') ?? []).filter(e => String(e.date ?? '').startsWith(month));
  const income   = (store.get('income')   ?? []).filter(i => String(i.date ?? '').startsWith(month));
  const totalIncome   = income.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const net           = totalIncome - totalExpenses;
  const savingsRate   = totalIncome > 0 ? Math.max(0, (net / totalIncome) * 100) : 0;
  const byCat = {};
  for (const e of expenses) { const c = e.category || 'Uncategorised'; byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0); }
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const bySource = {};
  for (const i of income) { const s = i.source || 'Other'; bySource[s] = (bySource[s] || 0) + (Number(i.amount) || 0); }
  const incRows = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const label = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const netCls    = net >= 0 ? 'text-success' : 'text-danger';
  const rateColor = savingsRate >= 30 ? '#10b981' : savingsRate >= 15 ? '#f59e0b' : '#ef4444';
  return `<div id="monthly-report-printable">
    <div class="report-header"><h4 class="mb-0">Monthly Financial Report</h4><div class="text-muted">${escapeHtml(label)}</div></div>
    <div class="report-summary-grid">
      <div class="report-stat income"><div class="report-stat-label">Total Income</div><div class="report-stat-value">${formatCurrency(Math.round(totalIncome))}</div></div>
      <div class="report-stat expense"><div class="report-stat-label">Total Expenses</div><div class="report-stat-value">${formatCurrency(Math.round(totalExpenses))}</div></div>
      <div class="report-stat net"><div class="report-stat-label">Net Savings</div><div class="report-stat-value ${netCls}">${formatCurrency(Math.round(net))}</div></div>
      <div class="report-stat savings-rate"><div class="report-stat-label">Savings Rate</div><div class="report-stat-value" style="color:${rateColor}">${savingsRate.toFixed(1)}%</div></div>
    </div>
    ${incRows.length ? `<div class="report-section"><div class="report-section-title"><i class="bi bi-arrow-down-circle-fill text-success me-2"></i>Income Breakdown</div><table class="report-table"><thead><tr><th>Source</th><th class="text-end">Amount</th><th class="text-end">% of Income</th></tr></thead><tbody>${incRows.map(([s, a]) => `<tr><td>${escapeHtml(s)}</td><td class="text-end">${formatCurrency(Math.round(a))}</td><td class="text-end">${totalIncome > 0 ? ((a / totalIncome) * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${catRows.length ? `<div class="report-section mt-3"><div class="report-section-title"><i class="bi bi-arrow-up-circle-fill text-danger me-2"></i>Expenses by Category</div><table class="report-table"><thead><tr><th>Category</th><th class="text-end">Amount</th><th class="text-end">% of Expenses</th></tr></thead><tbody>${catRows.map(([c, a]) => `<tr><td>${escapeHtml(c)}</td><td class="text-end">${formatCurrency(Math.round(a))}</td><td class="text-end">${totalExpenses > 0 ? ((a / totalExpenses) * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-muted small mt-3">No expenses recorded this month.</p>'}
  </div>`;
}

function _initMonthlyReport() {
  const btn = document.getElementById('btn-monthly-report');
  if (btn) btn.addEventListener('click', () => {
    _populateMonthSelector();
    const sel   = document.getElementById('monthly-report-month-sel');
    const month = sel?.value ?? '';
    const body  = document.getElementById('monthly-report-body');
    if (body && month) body.innerHTML = _generateReport(month);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('oc-monthly-report')).show();
  });
  document.getElementById('monthly-report-month-sel')?.addEventListener('change', e => {
    const body = document.getElementById('monthly-report-body');
    if (body) body.innerHTML = _generateReport(e.target.value);
  });
  document.getElementById('monthly-report-print')?.addEventListener('click', () => window.print());
}

export function init() {
  const keys = ['expenses', 'income', 'budgets', 'creditCards', 'savings', 'ccPayments', 'accounts', 'transfers', 'bills', 'lendings', 'lendingSettlements', 'settings', 'investments', 'loans'];
  keys.forEach(k => store.on(k, render));
  store.on('expenses', _renderSpendingInsights);
  store.on('income',   _renderSpendingInsights);
  store.on('budgets',  _renderBudgetSummary);
  store.on('expenses', _renderBudgetSummary);
  store.on('maintenance',      _renderMaintenanceReminders);
  store.on('manualOdo',        _renderMaintenanceReminders);
  store.on('tripLogs',         _renderMaintenanceReminders);
  store.on('vehicleDocuments', _renderMaintenanceReminders);
  store.on('vehicleInsurance', _renderMaintenanceReminders);
  store.on('bills',        _renderPaymentReminders);
  store.on('creditCards',  _renderPaymentReminders);
  store.on('recurring',    _renderPaymentReminders);
  store.on('subscriptions',_renderPaymentReminders);
  store.on('expenses', _renderYearComparison);
  store.on('expenses', _renderNetWorthHistoryChart);
  store.on('income',   _renderNetWorthHistoryChart);
  store.on('accounts', _renderNetWorthHistoryChart);
  store.on('investments', _renderNetWorthHistoryChart);
  store.on('loans',       _renderNetWorthHistoryChart);
  store.on('expenses', _renderRecentTxns);
  store.on('income',   _renderRecentTxns);
  store.on('savings',  _renderSavingsProgress);
  store.on('expenses', _renderNetWorthGoal);
  store.on('expenses', _renderSpendingTiers);
  store.on('income',   _renderSpendingTiers);
  store.on('income',   _renderNetWorthGoal);
  store.on('accounts', _renderNetWorthGoal);
  store.on('settings', _renderNetWorthGoal);
  store.on('investments', _renderNetWorthGoal);
  store.on('loans',       _renderNetWorthGoal);

  const filterSel = document.getElementById('dash-category-filter');
  if (filterSel) filterSel.addEventListener('change', _renderCategoryBreakdown);
  const subcatFilterSel = document.getElementById('dash-subcat-filter');
  if (subcatFilterSel) subcatFilterSel.addEventListener('change', _renderSubcatBreakdown);

  const reminderWin = document.getElementById('dash-reminder-window');
  if (reminderWin) reminderWin.addEventListener('change', _renderPaymentReminders);

  const merchantFilter = document.getElementById('dash-merchant-filter');
  if (merchantFilter) merchantFilter.addEventListener('change', _renderTopMerchants);

  const tiersMonth = document.getElementById('dash-tiers-month');
  if (tiersMonth) tiersMonth.addEventListener('change', _renderSpendingTiers);

  // Quick-Add FAB
  const fabBtn  = document.getElementById('dash-fab-btn');
  const fabMenu = document.getElementById('dash-fab-menu');
  if (fabBtn && fabMenu) {
    fabBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !fabMenu.classList.contains('d-none');
      fabMenu.classList.toggle('d-none', open);
      fabBtn.style.transform = open ? '' : 'rotate(45deg)';
    });
    document.addEventListener('click', () => {
      fabMenu.classList.add('d-none');
      fabBtn.style.transform = '';
    });
    // Close menu when a modal opens from the FAB
    ['dash-fab-expense', 'dash-fab-income'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        fabMenu.classList.add('d-none');
        fabBtn.style.transform = '';
      });
    });
  }

  _initMonthlyReport();
  _initNetWorthGoal();
}