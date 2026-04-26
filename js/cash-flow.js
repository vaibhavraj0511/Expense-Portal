// js/cash-flow.js — Cash Flow Forecast module
import * as store from './store.js';
import { formatCurrency } from './utils.js';

let _days   = 60;    // current forecast window
let _filter = 'all'; // active source filter
let _cfChart = null; // Chart.js instance

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

// ─── Build forecast events (recurring + bills + loans + subscriptions) ────────

function _buildForecastEvents(days) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const events = [];

  // 1. Recurring transactions
  (store.get('recurring') ?? []).filter(r => !r.paused).forEach(r => {
    for (let i = 0; i <= days; i++) {
      const d = _addDays(today, i);
      const match = (r.frequency === 'monthly' && d.getDate() === r.day) ||
                    (r.frequency === 'weekly'  && d.getDay()  === r.day % 7);
      if (match) events.push({
        date: _localDateStr(d), label: r.description || r.category,
        amount: r.type === 'income' ? Number(r.amount) : -Number(r.amount),
        type: r.type, source: 'recurring',
        icon: r.type === 'income' ? 'bi-arrow-down-circle-fill' : 'bi-arrow-repeat',
        color: r.type === 'income' ? '#10b981' : '#6366f1',
      });
    }
  });

  // 2. Bills (active)
  (store.get('bills') ?? []).filter(b => b.active).forEach(b => {
    for (let i = 0; i <= days; i++) {
      const d = _addDays(today, i);
      const match = (b.frequency === 'monthly' && d.getDate() === b.dueDay) ||
                    (b.frequency === 'yearly'   && d.getDate() === b.dueDay && d.getMonth() === (b.dueMonth ? b.dueMonth - 1 : 0)) ||
                    (b.frequency === 'quarterly' && d.getDate() === b.dueDay && ((d.getMonth() - (b.dueMonth ? b.dueMonth - 1 : 0) + 12) % 3 === 0));
      if (match) events.push({
        date: _localDateStr(d), label: b.name, amount: -Number(b.amount),
        type: 'expense', source: 'bill', icon: 'bi-receipt', color: '#f59e0b',
      });
    }
  });

  // 3. Loan EMIs
  (store.get('loans') ?? []).filter(l => l.status === 'active' || !l.status).forEach(l => {
    const p = Number(l.principal) || 0, rAnn = Number(l.interestRate) || 0, n = Number(l.tenureMonths) || 0;
    if (p <= 0 || n <= 0) return;
    const r = rAnn / 12 / 100;
    const emi = rAnn === 0 ? p / n : p * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);
    const emiDay = l.startDate ? new Date(l.startDate + 'T00:00:00').getDate() : 1;
    for (let i = 0; i <= days; i++) {
      const d = _addDays(today, i);
      if (d.getDate() === emiDay) events.push({
        date: _localDateStr(d), label: (l.name || 'Loan') + ' EMI',
        amount: -Math.round(emi), type: 'expense', source: 'loan', icon: 'bi-bank2', color: '#ef4444',
      });
    }
  });

  // 4. Subscriptions (active) — use nextBillingDate + billingCycle to project forward
  const cycleInterval = { weekly: 7, monthly: 30, quarterly: 91, 'half-yearly': 182, yearly: 365 };
  const endDateStr = _localDateStr(_addDays(today, days));
  (store.get('subscriptions') ?? []).filter(s => s.active !== false && Number(s.amount) > 0).forEach(s => {
    const interval = cycleInterval[s.billingCycle] ?? 30;
    let next = s.nextBillingDate ? new Date(s.nextBillingDate + 'T00:00:00') : new Date(today.getFullYear(), today.getMonth(), 1);
    while (next < today) next = _addDays(next, interval);
    while (_localDateStr(next) <= endDateStr) {
      events.push({
        date: _localDateStr(next), label: s.name, amount: -Number(s.amount),
        type: 'expense', source: 'subscription', icon: 'bi-collection-fill', color: '#ec4899',
      });
      next = _addDays(next, interval);
    }
  });

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Current balance from accounts ────────────────────────────────────────────

function _currentBalance() {
  let bal = (store.get('accounts') ?? []).reduce((s, a) => s + (Number(a.initialBalance) || 0), 0);
  (store.get('income')     ?? []).forEach(r => bal += Number(r.amount) || 0);
  (store.get('expenses')   ?? []).forEach(r => bal -= Number(r.amount) || 0);
  (store.get('ccPayments') ?? []).forEach(r => bal -= Number(r.amount) || 0);
  return bal;
}

// ─── Projected balance line chart ────────────────────────────────────────────

function _renderBalanceChart(events, startBal) {
  const canvas = document.getElementById('cf-balance-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dateNetMap = {};
  events.forEach(e => { dateNetMap[e.date] = (dateNetMap[e.date] || 0) + e.amount; });

  const labels = [], data = [], pointBg = [];
  let running = startBal;
  const step = Math.max(1, Math.ceil(_days / 30));
  for (let i = 0; i <= _days; i++) {
    const d = _addDays(today, i);
    const ds = _localDateStr(d);
    running += (dateNetMap[ds] || 0);
    if (i % step === 0 || i === _days || dateNetMap[ds]) {
      labels.push(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
      data.push(Math.round(running));
      pointBg.push(running < 0 ? '#ef4444' : running < startBal * 0.2 ? '#f59e0b' : '#10b981');
    }
  }

  if (_cfChart) { _cfChart.destroy(); _cfChart = null; }
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(99,102,241,.18)'); grad.addColorStop(1, 'rgba(99,102,241,0)');
  const hasNeg = data.some(v => v < 0);

  _cfChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Balance', data, borderColor: '#6366f1', backgroundColor: grad,
      borderWidth: 2.5, pointRadius: data.map((v, i) => (i === 0 || i === data.length-1 || v < 0) ? 4 : 0),
      pointBackgroundColor: pointBg, fill: true, tension: 0.4 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f1f5f9',
          padding: 10, cornerRadius: 10, callbacks: { label: c => ` Balance: ${formatCurrency(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, border: { display: false } },
        y: {
          grid: { color: ctx2 => ctx2.tick.value === 0 && hasNeg ? 'rgba(239,68,68,.4)' : 'rgba(226,232,240,.5)' },
          border: { display: false, dash: [4, 4] },
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '₹' + (Math.abs(v) >= 1000 ? Math.round(v/1000) + 'k' : v) },
        },
      },
    },
  });
}

// ─── Source breakdown card ────────────────────────────────────────────────────

function _renderSourceBreakdown(events) {
  const el = document.getElementById('cf-source-breakdown');
  if (!el) return;
  const SRCS = [
    { key: 'recurring',    label: 'Recurring',    icon: 'bi-arrow-repeat',     color: '#6366f1' },
    { key: 'bill',         label: 'Bills',         icon: 'bi-receipt',          color: '#f59e0b' },
    { key: 'loan',         label: 'Loans (EMI)',   icon: 'bi-bank2',            color: '#ef4444' },
    { key: 'subscription', label: 'Subscriptions', icon: 'bi-collection-fill',  color: '#ec4899' },
  ];
  const allOut = events.filter(e => e.amount < 0).reduce((t, e) => t + Math.abs(e.amount), 0);
  const rows = SRCS.map(s => {
    const grp = events.filter(e => e.source === s.key);
    if (!grp.length) return '';
    const inAmt  = grp.filter(e => e.amount > 0).reduce((t, e) => t + e.amount, 0);
    const outAmt = grp.filter(e => e.amount < 0).reduce((t, e) => t + Math.abs(e.amount), 0);
    const pct    = allOut > 0 ? Math.round((outAmt / allOut) * 100) : 0;
    return `<div class="cf-breakdown-row">
      <span class="cf-breakdown-icon" style="background:${s.color}18;color:${s.color}"><i class="bi ${s.icon}"></i></span>
      <div class="cf-breakdown-right">
        <div class="cf-breakdown-top">
          <span class="cf-breakdown-label">${s.label}</span>
          <span class="cf-breakdown-vals">
            ${inAmt  ? `<span class="cf-bval cf-bval--in">+${formatCurrency(inAmt)}</span>`   : ''}
            ${outAmt ? `<span class="cf-bval cf-bval--out">-${formatCurrency(outAmt)}</span>` : ''}
          </span>
        </div>
        ${outAmt && pct > 0 ? `<div class="cf-prop-bar-wrap"><div class="cf-prop-bar" style="width:${pct}%;background:${s.color}"></div></div>` : ''}
      </div>
    </div>`;
  }).filter(Boolean);
  el.innerHTML = rows.length ? rows.join('') : '<p class="text-muted small p-3 mb-0">No forecast data.</p>';
}

// ─── Source hints ─────────────────────────────────────────────────────────────

function _renderSourceHints() {
  const el = document.getElementById('cf-source-hints');
  if (!el) return;
  const CHECKS = [
    { key: 'recurring',     label: 'recurring transactions', icon: 'bi-arrow-repeat',    test: d => d.filter(r => !r.paused).length },
    { key: 'bills',         label: 'active bills',           icon: 'bi-receipt',          test: d => d.filter(b => b.active).length },
    { key: 'loans',         label: 'active loans',           icon: 'bi-bank2',            test: d => d.filter(l => l.status === 'active' || !l.status).length },
    { key: 'subscriptions', label: 'subscriptions',          icon: 'bi-collection-fill',  test: d => d.filter(s => s.active !== false).length },
  ];
  const missing = CHECKS.filter(c => !c.test(store.get(c.key) ?? []));
  if (!missing.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card"><div class="card-body p-3">
    <div class="fw-semibold small mb-2 text-muted"><i class="bi bi-info-circle me-1"></i>Improve accuracy by adding:</div>
    ${missing.map(m => `<div class="cf-hint-row"><i class="bi ${m.icon} me-2" style="color:#94a3b8"></i><span class="small text-muted">No ${m.label} found</span></div>`).join('')}
  </div></div>`;
}

// ─── Timeline with TODAY marker + color bands ─────────────────────────────────

function _renderTimeline(events, startBal) {
  const container = document.getElementById('cashflow-container');
  if (!container) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = _localDateStr(today);

  let runCur = startBal, prevDate = '', prevWeek = '', todayInserted = false;
  const rows = [];

  events.forEach(e => {
    runCur += e.amount;
    const visible = _filter === 'all' || e.source === _filter;
    if (!visible) return;

    const isNeg  = runCur < 0;
    const isWarn = !isNeg && startBal > 0 && runCur < startBal * 0.2;
    const balClass = isNeg ? 'cf-balance--neg' : isWarn ? 'cf-balance--warn' : '';

    if (!todayInserted && e.date > todayStr) {
      todayInserted = true;
      rows.push(`<div class="cf-today-marker"><span><i class="bi bi-clock-fill me-1"></i>TODAY · ${formatCurrency(startBal)}</span></div>`);
    }

    // Week group separator
    const eDate = new Date(e.date + 'T00:00:00');
    const weekStart = _localDateStr(_addDays(eDate, -eDate.getDay()));
    if (weekStart !== prevWeek) {
      prevWeek = weekStart;
      const wEnd = _addDays(new Date(weekStart + 'T00:00:00'), 6);
      const wLbl = `${new Date(weekStart + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${wEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
      rows.push(`<div class="cf-week-sep"><span>${wLbl}</span></div>`);
    }

    if (e.date !== prevDate) {
      const isToday = e.date === todayStr;
      const lbl = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
      rows.push(`<div class="cf-date-sep${isToday ? ' cf-date-sep--today' : ''}">${lbl}</div>`);
      prevDate = e.date;
    }

    const isIncome = e.amount > 0;
    const isLarge  = Math.abs(e.amount) >= 5000;
    const rowClass = isIncome ? ' cf-row--income' : isLarge ? ' cf-row--large' : '';
    const amtStyle = `font-size:${isLarge ? '.9rem' : '.82rem'};font-weight:${isLarge ? '800' : '700'}`;

    rows.push(`<div class="cf-row${rowClass}" style="border-left:3px solid ${isIncome ? '#10b981' : isLarge ? e.color : 'transparent'}">
      <div class="cf-icon" style="color:${e.color}"><i class="bi ${e.icon}"></i></div>
      <div class="cf-info">
        <div class="cf-label">${escapeHtml(e.label)}</div>
        <div class="cf-source">${escapeHtml(e.source)}</div>
      </div>
      <div class="cf-amount" style="color:${isIncome ? '#10b981' : '#ef4444'};${amtStyle}">${isIncome ? '+' : ''}${formatCurrency(Math.abs(e.amount))}</div>
      <div class="cf-balance ${balClass}">${formatCurrency(runCur)}</div>
    </div>`);
  });

  if (!rows.length) {
    container.innerHTML = `<div class="cf-empty"><i class="bi bi-funnel"></i><span>No ${_filter === 'all' ? '' : _filter + ' '}events in this period</span></div>`;
    return;
  }
  container.innerHTML = `<div class="cf-timeline">${rows.join('')}</div>`;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function render() {
  const container = document.getElementById('cashflow-container');
  if (!container) return;

  const events   = _buildForecastEvents(_days);
  const startBal = _currentBalance();

  const totalIn  = events.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const totalOut = events.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
  const endBal   = startBal + totalIn - totalOut;
  const lowestBal = (() => {
    let run = startBal, min = startBal;
    events.forEach(e => { run += e.amount; if (run < min) min = run; });
    return min;
  })();

  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _set('cf-stat-current', formatCurrency(startBal));
  _set('cf-stat-in',      formatCurrency(totalIn));
  _set('cf-stat-out',     formatCurrency(totalOut));
  _set('cf-stat-end',     formatCurrency(endBal));
  const loEl = document.getElementById('cf-stat-lowest');
  if (loEl) { loEl.textContent = formatCurrency(lowestBal); loEl.style.color = lowestBal < 0 ? '#ef4444' : '#10b981'; }

  // Net Change card
  const netChange = totalIn - totalOut;
  _set('cf-stat-net', formatCurrency(netChange));
  const netCard = document.getElementById('cf-net-card');
  const netIcon = document.getElementById('cf-net-icon');
  if (netCard) netCard.style.borderTop = `3px solid ${netChange >= 0 ? '#10b981' : '#ef4444'}`;
  if (netIcon) netIcon.style.background = netChange >= 0 ? 'linear-gradient(135deg,#10b981,#34d399)' : 'linear-gradient(135deg,#ef4444,#f87171)';
  const netValEl = document.getElementById('cf-stat-net');
  if (netValEl) netValEl.style.color = netChange >= 0 ? '#059669' : '#dc2626';

  // Period label update
  ['cf-chart-subtitle', 'cf-timeline-subtitle'].forEach(id => _set(id, `next ${_days} days`));
  _set('cf-end-period-label', `estimated in ${_days} days`);

  // Hero subtitle — live key numbers
  const heroSub = document.getElementById('cf-hero-sub');
  if (heroSub) {
    const sign = netChange >= 0 ? '+' : '';
    heroSub.innerHTML = `<strong style="color:rgba(255,255,255,.95)">${formatCurrency(startBal)}</strong> current &nbsp;&middot;&nbsp; <strong style="color:${netChange >= 0 ? 'rgba(167,243,208,.95)' : 'rgba(252,165,165,.95)'}">${sign}${formatCurrency(netChange)}</strong> net &nbsp;&middot;&nbsp; <span style="color:rgba(255,255,255,.75)">Lowest: ${formatCurrency(lowestBal)}</span>`;
  }

  const deltaEl = document.getElementById('cf-stat-delta');
  if (deltaEl) {
    const d = endBal - startBal;
    deltaEl.innerHTML = `<span style="color:${d >= 0 ? '#10b981' : '#ef4444'};font-size:.82rem;font-weight:700">${d >= 0 ? '+' : ''}${formatCurrency(d)} vs today</span>`;
  }

  const warnEl = document.getElementById('cf-warnings');
  if (warnEl) {
    const w = [];
    if (lowestBal < 0) w.push(`<div class="alert alert-danger py-2 small mb-2"><i class="bi bi-exclamation-triangle-fill me-1"></i>Balance may go negative (${formatCurrency(lowestBal)}) within ${_days} days.</div>`);
    else if (lowestBal < startBal * 0.2) w.push(`<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-exclamation-circle me-1"></i>Balance may drop to ${formatCurrency(lowestBal)} — consider reviewing upcoming expenses.</div>`);
    warnEl.innerHTML = w.join('');
  }

  // Confidence note
  const confEl = document.getElementById('cf-confidence-note');
  if (confEl) {
    const srcCounts = { recurring: 0, bill: 0, loan: 0, subscription: 0 };
    events.forEach(e => { if (srcCounts[e.source] !== undefined) srcCounts[e.source]++; });
    const parts = [];
    if (srcCounts.recurring)    parts.push(`${srcCounts.recurring} recurring`);
    if (srcCounts.bill)         parts.push(`${srcCounts.bill} bill${srcCounts.bill > 1 ? 's' : ''}`);
    if (srcCounts.loan)         parts.push(`${srcCounts.loan} EMI${srcCounts.loan > 1 ? 's' : ''}`);
    if (srcCounts.subscription) parts.push(`${srcCounts.subscription} sub${srcCounts.subscription > 1 ? 's' : ''}`);
    confEl.textContent = parts.length ? `Based on ${parts.join(', ')}` : '';
  }

  if (events.length === 0) {
    container.innerHTML = `<div class="cf-empty"><i class="bi bi-calendar-x"></i><span>No scheduled transactions found</span><span class="cf-empty-sub">Add recurring transactions, bills, loans or subscriptions to see your forecast.</span></div>`;
    _renderSourceBreakdown(events);
    _renderSourceHints();
    return;
  }

  // Critical date callout — find date of lowest balance
  const calloutEl = document.getElementById('cf-critical-callout');
  if (calloutEl) {
    let run = startBal, minBal = startBal, minDate = null, minEvents = [];
    const dayMap = {};
    events.forEach(e => { dayMap[e.date] = dayMap[e.date] || []; dayMap[e.date].push(e); });
    Object.keys(dayMap).sort().forEach(dt => {
      dayMap[dt].forEach(e => { run += e.amount; });
      if (run < minBal) { minBal = run; minDate = dt; minEvents = dayMap[dt]; }
    });
    if (minDate && minBal < startBal * 0.3) {
      const fmtDate = new Date(minDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const isNeg = minBal < 0;
      const topLabels = minEvents.slice(0, 3).map(e => escapeHtml(e.label)).join(', ');
      calloutEl.innerHTML = `<div class="cf-critical-card ${isNeg ? 'cf-critical-card--neg' : 'cf-critical-card--warn'}">
        <i class="bi bi-${isNeg ? 'exclamation-triangle-fill' : 'exclamation-circle-fill'} cf-critical-icon"></i>
        <div class="cf-critical-body">
          <div class="cf-critical-title">Balance dips to ${formatCurrency(minBal)} on ${fmtDate}</div>
          <div class="cf-critical-sub">${topLabels}${minEvents.length > 3 ? ` +${minEvents.length - 3} more` : ''}</div>
        </div>
      </div>`;
    } else {
      calloutEl.innerHTML = '';
    }
  }

  _renderBalanceChart(events, startBal);
  _renderSourceBreakdown(events);
  _renderTimeline(events, startBal);
  _renderSourceHints();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init() {
  document.querySelectorAll('#cf-period-group .rpt-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cf-period-group .rpt-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _days = parseInt(btn.dataset.days, 10);
      render();
    });
  });

  document.querySelectorAll('.cf-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.cf-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _filter = chip.dataset.cfSrc;
      render();
    });
  });

  ['recurring', 'bills', 'loans', 'accounts', 'expenses', 'income', 'ccPayments', 'subscriptions'].forEach(k => store.on(k, render));
}
