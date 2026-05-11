// js/reports.js — Analytics & Reports charts (v3)

import * as store from './store.js';
import { formatCurrency } from './utils.js';
import { computeSpendingDayTiers } from './insights.js';

const _ch = {};
let _period = 6; // months to show (3, 6, or 12)

function _kill(key) {
  if (_ch[key]) { try { _ch[key].destroy(); } catch { /* ignore */ } delete _ch[key]; }
}
function _el(id) { return document.getElementById(id); }

function _lastNMonths(n = _period) {
  const out = [], now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function _ymLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
}

function _prevNMonths(n = _period) {
  const out = [], now = new Date();
  for (let i = n * 2 - 1; i >= n; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function _trendChip(cur, prev, lowerIsBetter = false) {
  if (!prev || prev === 0) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(pct) < 2) return `<span class="rpt-kpi-trend rpt-kpi-trend--neutral">&#x2248; flat</span>`;
  const up = pct > 0;
  const good = lowerIsBetter ? !up : up;
  return `<span class="rpt-kpi-trend ${good ? 'rpt-kpi-trend--good' : 'rpt-kpi-trend--bad'}">${up ? '&#x2191;' : '&#x2193;'} ${Math.abs(pct)}%</span>`;
}

const P = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316','#a78bfa','#34d399','#fb7185','#38bdf8'];

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 500, easing: 'easeOutQuart' },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(226,232,240,0.8)',
      borderWidth: 1,
      padding: 10,
      cornerRadius: 10,
      boxPadding: 4,
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } }, border: { display: false } },
    y: { grid: { color: 'rgba(226,232,240,0.7)' }, ticks: { color: '#94a3b8', font: { size: 11 } }, border: { display: false } },
  },
};

const _EMPTY_CTA = {
  'rpt-monthly-spend':  'Add expenses to see spending trends',
  'rpt-cat-trend':      'Add categorised expenses to see category trends',
  'rpt-top-subcat':     'Add sub-categories to your expenses',
  'rpt-pay-method':     'Log payment methods on expenses',
  'rpt-budget-util':    'Set budgets for this month to track health',
  'rpt-lending-bal':    'Record a lending or borrowing first',
  'rpt-sub-donut':      'Add active subscriptions to see a breakdown',
  'rpt-mileage':        'Log fuel fills with odometer readings',
  'rpt-veh-cost':       'Log vehicle trips or maintenance expenses',
  'rpt-veh-donut':      'Log vehicle expenses to see the cost split',
  'rpt-forecast-bar':   'Add expenses for the past few months to generate a forecast',
};

function _noData(canvasId, msg = 'No data yet') {
  const wrap = _el(canvasId + '-wrap');
  const canvas = _el(canvasId);
  if (canvas) canvas.style.display = 'none';
  if (wrap) {
    const existing = wrap.querySelector('.rpt-empty-state');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'rpt-empty-state';
    const cta = _EMPTY_CTA[canvasId];
    div.innerHTML = `<i class="bi bi-bar-chart-line"></i><span>${msg}</span>${cta ? `<span class="rpt-empty-cta">${cta}</span>` : ''}`;
    wrap.appendChild(div);
  }
}

function _showCanvas(canvasId) {
  const wrap = _el(canvasId + '-wrap');
  const canvas = _el(canvasId);
  if (canvas) canvas.style.display = '';
  if (wrap) {
    const existing = wrap.querySelector('.rpt-empty-state');
    if (existing) existing.remove();
  }
}

// ─── Budget Summary (stat pills above chart) ─────────────────────────────────

function _renderBudgetSummary() {
  const el = _el('rpt-budget-summary');
  if (!el) return;
  const budgets  = store.get('budgets')  ?? [];
  const expenses = store.get('expenses') ?? [];
  const now   = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const cur   = budgets.filter(b => b.month === curYM);
  if (!cur.length) { el.innerHTML = ''; return; }
  let onTrack = 0, warning = 0, over = 0;
  cur.forEach(b => {
    const spent = expenses.filter(e => e.category === b.category && (e.date ?? '').startsWith(curYM))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const pct = b.monthlyLimit > 0 ? (spent / b.monthlyLimit) * 100 : 0;
    if (pct >= 90) over++;
    else if (pct >= 70) warning++;
    else onTrack++;
  });
  el.innerHTML = `<div class="rpt-budget-stat-row">
    ${onTrack ? `<span class="rpt-budget-stat rpt-budget-stat--green"><i class="bi bi-check-circle-fill me-1"></i>${onTrack} on track</span>` : ''}
    ${warning  ? `<span class="rpt-budget-stat rpt-budget-stat--amber"><i class="bi bi-exclamation-triangle-fill me-1"></i>${warning} warning</span>` : ''}
    ${over     ? `<span class="rpt-budget-stat rpt-budget-stat--red"><i class="bi bi-x-circle-fill me-1"></i>${over} over budget</span>` : ''}
    <span class="rpt-budget-stat rpt-budget-stat--muted">${cur.length} total</span>
  </div>`;
}

// ─── KPI Summary ──────────────────────────────────────────────────────────────

function _renderKpi() {
  const months   = _lastNMonths();
  const prev     = _prevNMonths();
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const budgets  = store.get('budgets')  ?? [];

  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const totalSpent  = expenses.filter(e => months.some(m => (e.date ?? '').startsWith(m))).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalIncome = income.filter(i => months.some(m => (i.date ?? '').startsWith(m))).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const net         = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? Math.round((net / totalIncome) * 100) : 0;

  const prevSpent  = expenses.filter(e => prev.some(m => (e.date ?? '').startsWith(m))).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const prevIncome = income.filter(i => prev.some(m => (i.date ?? '').startsWith(m))).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const prevNet    = prevIncome - prevSpent;
  const prevRate   = prevIncome > 0 ? Math.round(((prevIncome - prevSpent) / prevIncome) * 100) : 0;

  const curBudgets = budgets.filter(b => b.month === curYM);
  const overBudget = curBudgets.filter(b => {
    const spent = expenses.filter(e => e.category === b.category && (e.date ?? '').startsWith(curYM)).reduce((s, e) => s + e.amount, 0);
    return spent > b.monthlyLimit;
  }).length;

  // Update hero subtitle
  const heroSub = _el('rpt-hero-sub');
  if (heroSub && totalSpent > 0) {
    const netSign = net >= 0 ? '+' : '-';
    heroSub.innerHTML = `<strong style="color:rgba(255,255,255,.95)">${formatCurrency(totalSpent)}</strong> spent &nbsp;&middot;&nbsp; <strong style="color:rgba(255,255,255,.95)">${netSign}${formatCurrency(Math.abs(net))}</strong> net &nbsp;&middot;&nbsp; <span style="color:rgba(255,255,255,.75)">${_period}M view</span>`;
  }

  const kpiEl = _el('rpt-kpi-row');
  if (!kpiEl) return;
  kpiEl.innerHTML = `
    <div class="rpt-kpi-card rpt-kpi--red">
      <div class="rpt-kpi-icon"><i class="bi bi-arrow-up-circle-fill"></i></div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-label">Total Spent <span class="rpt-kpi-period">(${_period}M)</span></div>
        <div class="rpt-kpi-value">${formatCurrency(totalSpent)}</div>
        ${_trendChip(totalSpent, prevSpent, true)}
      </div>
    </div>
    <div class="rpt-kpi-card rpt-kpi--green">
      <div class="rpt-kpi-icon"><i class="bi bi-arrow-down-circle-fill"></i></div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-label">Total Income <span class="rpt-kpi-period">(${_period}M)</span></div>
        <div class="rpt-kpi-value">${formatCurrency(totalIncome)}</div>
        ${_trendChip(totalIncome, prevIncome)}
      </div>
    </div>
    <div class="rpt-kpi-card ${net >= 0 ? 'rpt-kpi--blue' : 'rpt-kpi--red'}">
      <div class="rpt-kpi-icon"><i class="bi bi-wallet2"></i></div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-label">Net Savings <span class="rpt-kpi-period">(${_period}M)</span></div>
        <div class="rpt-kpi-value">${formatCurrency(net)}</div>
        ${_trendChip(net, prevNet)}
      </div>
    </div>
    <div class="rpt-kpi-card rpt-kpi--purple">
      <div class="rpt-kpi-icon"><i class="bi bi-piggy-bank-fill"></i></div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-label">Savings Rate</div>
        <div class="rpt-kpi-value">${savingsRate}%</div>
        ${_trendChip(savingsRate, prevRate)}
      </div>
    </div>
    ${curBudgets.length ? `
    <div class="rpt-kpi-card ${overBudget ? 'rpt-kpi--amber' : 'rpt-kpi--green'}">
      <div class="rpt-kpi-icon"><i class="bi bi-bullseye"></i></div>
      <div class="rpt-kpi-body">
        <div class="rpt-kpi-label">Budget Health</div>
        <div class="rpt-kpi-value">${overBudget ? overBudget + ' over' : 'On Track'}</div>
      </div>
    </div>` : ''}`;
}

// ─── Category Trend (Stacked Lines) — NEW ────────────────────────────────────

function _categoryTrend(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const months   = _lastNMonths();
  const expenses = store.get('expenses') ?? [];
  const filtered = expenses.filter(e => months.some(m => (e.date ?? '').startsWith(m)));

  const catTotals = {};
  filtered.forEach(e => { if (e.category) catTotals[e.category] = (catTotals[e.category] ?? 0) + (Number(e.amount) || 0); });
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);

  if (!topCats.length) { _noData(canvasId, 'No expense data for selected period'); return; }
  _showCanvas(canvasId);

  const datasets = topCats.map((cat, i) => ({
    label: cat,
    data: months.map(ym => expenses.filter(e => e.category === cat && (e.date ?? '').startsWith(ym)).reduce((s, e) => s + (Number(e.amount) || 0), 0)),
    borderColor: P[i % P.length],
    backgroundColor: P[i % P.length] + '18',
    borderWidth: 2.5,
    pointRadius: 4,
    pointHoverRadius: 6,
    tension: 0.4,
    fill: false,
  }));

  _ch[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels: months.map(_ymLabel), datasets },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, color: '#9ca3af', boxWidth: 10, padding: 14, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x },
        y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } },
      },
    },
  });
}

// ─── Monthly Spending Bar ─────────────────────────────────────────────────────

function _monthlySpend(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const months      = _lastNMonths();
  const expenses    = store.get('expenses') ?? [];
  const incomeStore = store.get('income')   ?? [];
  const data        = months.map(ym => expenses.filter(e => (e.date ?? '').startsWith(ym)).reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const incomeData  = months.map(ym => incomeStore.filter(i => (i.date ?? '').startsWith(ym)).reduce((s, i) => s + (Number(i.amount) || 0), 0));

  if (!data.some(Boolean)) { _noData(canvasId, 'No expense data found'); return; }
  _showCanvas(canvasId);

  const avg    = data.filter(Boolean).reduce((s, v) => s + v, 0) / (data.filter(Boolean).length || 1);
  const colors = data.map(v => v === 0 ? 'rgba(148,163,184,.3)' : v > avg * 1.15 ? 'rgba(239,68,68,.8)' : v < avg * 0.85 ? 'rgba(16,185,129,.8)' : 'rgba(99,102,241,.8)');
  const borders = colors.map(c => c.replace(',.8)', ',1)').replace(',.3)', ',.5)'));

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels: months.map(_ymLabel), datasets: [
      {
        label: 'Spent', data, backgroundColor: colors,
        borderColor: borders, borderWidth: 1,
        borderRadius: 8, borderSkipped: false, order: 1,
      },
      {
        label: 'Income', data: incomeData, type: 'line',
        borderColor: 'rgba(16,185,129,.85)',
        backgroundColor: 'rgba(16,185,129,.06)',
        borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
        tension: 0.35, fill: false, order: 0,
      },
    ] },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, color: '#9ca3af', boxWidth: 10, padding: 12, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, mode: 'index', intersect: false, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x },
        y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => '\u20b9' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } },
      },
    },
  });
}

// ─── Payment Method Distribution — NEW ───────────────────────────────────────

function _paymentMethodDonut(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const months   = _lastNMonths();
  const expenses = store.get('expenses') ?? [];
  const filtered = expenses.filter(e => months.some(m => (e.date ?? '').startsWith(m)));

  const map = {};
  filtered.forEach(e => {
    const pm = (e.paymentMethod ?? '').trim() || 'Unknown';
    map[pm] = (map[pm] ?? 0) + (Number(e.amount) || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) { _noData(canvasId, 'No payment method data'); return; }
  _showCanvas(canvasId);

  _ch[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: P.slice(0, sorted.length), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      animation: { duration: 600 },
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, padding: 8, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}` } },
      },
    },
  });
}

// ─── Top Subcategories — NEW ──────────────────────────────────────────────────

function _topSubcategories(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const months   = _lastNMonths();
  const expenses = store.get('expenses') ?? [];
  const filtered = expenses.filter(e => months.some(m => (e.date ?? '').startsWith(m)));

  const map = {};
  filtered.forEach(e => {
    const sub = (e.subCategory ?? '').trim();
    if (!sub) return;
    map[sub] = (map[sub] ?? 0) + (Number(e.amount) || 0);
  });
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!sorted.length) { _noData(canvasId, 'No subcategory data — add sub-categories to expenses'); return; }
  _showCanvas(canvasId);

  const wrap = _el(canvasId + '-wrap');
  const h = Math.max(sorted.length * 44 + 40, 200);
  if (wrap) wrap.style.minHeight = `${h}px`;
  canvas.style.minHeight = `${h}px`;

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ label: 'Spent', data: sorted.map(([, v]) => v), backgroundColor: sorted.map((_, i) => P[i % P.length] + 'CC'), borderRadius: 6, borderSkipped: false }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.x)}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, ticks: { ...BASE_OPTS.scales.x.ticks, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } },
        y: { grid: { display: false }, ticks: { color: '#475569', font: { size: 11, weight: '500' } }, border: { display: false } },
      },
    },
  });
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

function _mileageTrend(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const vehicles = store.get('vehicles') ?? [];
  const tripLogs = store.get('tripLogs') ?? [];

  // FIX: match by vehicleName (not vehicleId), compute distance from consecutive odometer readings, use fuelLitres (not fuelUsed)
  const datasets = vehicles.map((v, i) => {
    const sorted = tripLogs
      .filter(t => t.vehicleName === v.name)
      .sort((a, b) => (a.odoReading ?? 0) - (b.odoReading ?? 0));

    const points = [];
    for (let j = 1; j < sorted.length; j++) {
      const distance = (sorted[j].odoReading ?? 0) - (sorted[j - 1].odoReading ?? 0);
      const litres   = Number(sorted[j].fuelLitres) || 0;
      if (litres > 0 && distance > 0) {
        points.push({
          y: +(distance / litres).toFixed(2),
          label: sorted[j].date ? new Date(sorted[j].date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
        });
      }
    }
    if (!points.length) return null;
    const last = points.slice(-12);
    return {
      label: v.name || `Vehicle ${i + 1}`,
      data: last.map(p => p.y),
      _labels: last.map(p => p.label),
      borderColor: P[i % P.length],
      backgroundColor: P[i % P.length] + '22',
      borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, tension: 0.4, fill: false,
    };
  }).filter(Boolean);

  if (!datasets.length) { _noData(canvasId, 'No fuel fill data — log trips with fuelLitres to see mileage'); return; }
  _showCanvas(canvasId);

  const maxLen = Math.max(...datasets.map(d => d.data.length));
  const labels = datasets.find(d => d.data.length === maxLen)?._labels ?? [];

  _ch[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: datasets.map(({ _labels, ...d }) => d) },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: { display: datasets.length > 1, position: 'top', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} km/L` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x },
        y: { ...BASE_OPTS.scales.y, title: { display: true, text: 'km / L', color: '#94a3b8', font: { size: 11 } }, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => v + ' km/L' } },
      },
    },
  });
}

const _FUEL_KEYWORDS = ['petrol', 'fuel', 'diesel', 'cng', 'lpg', 'ev charge', 'charging', 'petrol/fuel'];
function _isFuelExpense(e) {
  const t = (e.expenseType ?? '').toLowerCase();
  return _FUEL_KEYWORDS.some(k => t.includes(k));
}

function _vehicleCostBar(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const months    = _lastNMonths();
  const veExps    = store.get('vehicleExpenses') ?? [];
  const fuelExps  = veExps.filter(e => _isFuelExpense(e));
  const maintExps = veExps.filter(e => !_isFuelExpense(e));
  const fuel  = months.map(ym =>
    fuelExps.filter(e => (e.date ?? '').startsWith(ym)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  );
  const maint = months.map(ym => maintExps.filter(e => (e.date ?? '').startsWith(ym)).reduce((s, e) => s + (Number(e.amount) || 0), 0));

  if (!fuel.some(Boolean) && !maint.some(Boolean)) { _noData(canvasId, 'No vehicle cost data'); return; }
  _showCanvas(canvasId);

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months.map(_ymLabel),
      datasets: [
        { label: 'Fuel', data: fuel, backgroundColor: 'rgba(239,68,68,.75)', borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 }, stack: 'v' },
        { label: 'Maintenance', data: maint, backgroundColor: 'rgba(99,102,241,.75)', borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 }, stack: 'v' },
      ],
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, stacked: true },
        y: { ...BASE_OPTS.scales.y, stacked: true, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } },
      },
    },
  });
}

function _vehicleDonut(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const veExps   = store.get('vehicleExpenses') ?? [];
  const fuel  = veExps.filter(e => _isFuelExpense(e)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const maint = veExps.filter(e => !_isFuelExpense(e)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  if (!fuel && !maint) { _noData(canvasId, 'No data'); return; }
  _showCanvas(canvasId);

  _ch[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: ['Fuel', 'Maintenance'], datasets: [{ data: [fuel, maint], backgroundColor: ['rgba(239,68,68,.85)', 'rgba(99,102,241,.85)'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      animation: { duration: 500 },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, padding: 10, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}` } },
      },
    },
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

function _budgetUtil(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const budgets  = store.get('budgets')  ?? [];
  const expenses = store.get('expenses') ?? [];
  if (!budgets.length) { _noData(canvasId, 'No budgets set for this month'); return; }

  const now   = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const cur   = budgets.filter(b => b.month === curYM);
  if (!cur.length) { _noData(canvasId, 'No budgets set for this month'); return; }

  const items = cur.map(b => {
    const spent = expenses.filter(e => e.category === b.category && (e.date ?? '').startsWith(curYM)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const limit = Number(b.monthlyLimit) || 0;
    const pct   = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 150) : 0;
    return { name: b.category, spent, limit, pct };
  }).sort((a, b) => b.pct - a.pct);

  _showCanvas(canvasId);
  const wrap = _el(canvasId + '-wrap');
  if (wrap) wrap.style.minHeight = `${Math.max(items.length * 52 + 40, 180)}px`;
  canvas.style.minHeight = `${Math.max(items.length * 52 + 40, 180)}px`;

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: items.map(i => i.name),
      datasets: [
        { label: 'Spent', data: items.map(i => i.spent), backgroundColor: items.map(i => i.pct >= 90 ? 'rgba(239,68,68,.8)' : i.pct >= 70 ? 'rgba(245,158,11,.8)' : 'rgba(16,185,129,.8)'), borderRadius: 5, borderSkipped: false },
        { label: 'Limit', data: items.map(i => i.limit), backgroundColor: 'rgba(148,163,184,.15)', borderRadius: 5, borderSkipped: false },
      ],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.x)}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, ticks: { ...BASE_OPTS.scales.x.ticks, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) } },
        y: { grid: { display: false }, ticks: { color: '#475569', font: { size: 12, weight: '500' } }, border: { display: false } },
      },
    },
  });
}

// ─── Lending ──────────────────────────────────────────────────────────────────

function _lendingBalance(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const entries     = store.get('lendings') ?? [];
  const settlements = store.get('lendingSettlements') ?? [];
  if (!entries.length) { _noData(canvasId, 'No lending entries'); return; }

  const netMap = {};
  entries.forEach(e => {
    const paid = settlements.filter(s => s.entryId === e.id).reduce((s, x) => s + Number(x.amount), 0);
    const out  = Math.max(Number(e.amount) - paid, 0);
    if (!netMap[e.counterparty]) netMap[e.counterparty] = 0;
    netMap[e.counterparty] += e.type === 'lent' ? out : -out;
  });

  const people = Object.entries(netMap).filter(([, v]) => Math.abs(v) > 0.01).sort((a, b) => b[1] - a[1]);
  if (!people.length) { _noData(canvasId, 'All lendings are fully settled! 🎉'); return; }
  _showCanvas(canvasId);

  const wrap = _el(canvasId + '-wrap');
  const h = Math.max(people.length * 52 + 40, 150);
  if (wrap) wrap.style.minHeight = `${h}px`;
  canvas.style.minHeight = `${h}px`;

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: people.map(([n]) => n),
      datasets: [{
        label: 'Net Balance', data: people.map(([, v]) => v),
        backgroundColor: people.map(([, v]) => v > 0 ? 'rgba(16,185,129,.8)' : 'rgba(239,68,68,.75)'),
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ctx.parsed.x > 0 ? ` They owe you ${formatCurrency(ctx.parsed.x)}` : ` You owe them ${formatCurrency(Math.abs(ctx.parsed.x))}` } },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, ticks: { ...BASE_OPTS.scales.x.ticks, callback: v => '₹' + (Math.abs(v) >= 1000 ? Math.round(Math.abs(v) / 1000) + 'k' : Math.abs(v)) } },
        y: { grid: { display: false }, ticks: { color: '#475569', font: { size: 12, weight: '500' } }, border: { display: false } },
      },
    },
  });
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

function _toMonthlyAmount(s) {
  // FIX: subscriptions have amount + billingCycle, not monthlyAmount
  const amt = Number(s.amount) || 0;
  switch (s.billingCycle) {
    case 'weekly':      return +(amt * 4.33).toFixed(2);
    case 'monthly':     return amt;
    case 'quarterly':   return +(amt / 3).toFixed(2);
    case 'half-yearly': return +(amt / 6).toFixed(2);
    case 'yearly':      return +(amt / 12).toFixed(2);
    default:            return amt;
  }
}

function _subDonut(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const subs = store.get('subscriptions') ?? [];
  const active = subs
    .filter(s => s.active !== false)
    .map(s => ({ ...s, monthly: _toMonthlyAmount(s) }))
    .filter(s => s.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

  if (!active.length) { _noData(canvasId, 'No active subscriptions'); return; }
  _showCanvas(canvasId);

  const total = active.reduce((s, a) => s + a.monthly, 0);

  _ch[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: active.map(s => s.name),
      datasets: [{ data: active.map(s => s.monthly), backgroundColor: P.slice(0, active.length), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      animation: { duration: 600 },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, color: '#64748b', boxWidth: 10, padding: 10, usePointStyle: true } },
        tooltip: { ...BASE_OPTS.plugins.tooltip, callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}/mo` } },
      },
    },
  });

  // Subscription table
  const tableEl = _el('rpt-sub-table');
  if (tableEl) {
    const cycleLabel = { weekly: '/wk', monthly: '/mo', quarterly: '/qtr', 'half-yearly': '/6mo', yearly: '/yr' };
    tableEl.innerHTML = `
      <div class="rpt-sub-table-head"><span>Service</span><span>Monthly</span><span>% of total</span></div>
      ${active.map((s, i) => `
      <div class="rpt-sub-table-row">
        <span class="rpt-sub-name">
          <i class="rpt-sub-dot" style="background:${P[i % P.length]}"></i>
          ${s.name}
          <span class="rpt-hint">${formatCurrency(s.amount)}${cycleLabel[s.billingCycle] ?? ''}</span>
        </span>
        <span class="rpt-sub-amt">${formatCurrency(s.monthly)}</span>
        <span class="rpt-sub-pct">
          <span class="rpt-sub-pct-bar-wrap"><span class="rpt-sub-pct-bar" style="width:${Math.round((s.monthly / total) * 100)}%;background:${P[i % P.length]}"></span></span>
          ${Math.round((s.monthly / total) * 100)}%
        </span>
      </div>`).join('')}
      <div class="rpt-sub-table-total"><span>Total / month</span><span>${formatCurrency(total)}</span><span></span></div>`;
  }
}

// ─── Daily Spending Profile ──────────────────────────────────────────────────

function _renderSpendingDayTiers() {
  const container = _el('rpt-spending-tiers');
  if (!container) return;

  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const months   = _lastNMonths();

  const current = computeSpendingDayTiers(expenses, income);
  const { tiers, totalDays, longestZeroStreak } = current;

  const history = months.map(ym => ({
    ym,
    label: _ymLabel(ym),
    result: computeSpendingDayTiers(expenses, income, ym),
  }));

  const dominant = tiers.filter(t => t.key !== 'zero' && t.total > 0).sort((a, b) => b.total - a.total)[0];
  const zeroCount = tiers.find(t => t.key === 'zero')?.total ?? 0;

  const badgesHtml = `
    <div class="sdt-at-cur-header">
      <span class="sdt-at-cur-title">This Month — ${totalDays} days counted</span>
      ${longestZeroStreak >= 3 ? `<span class="sdt-at-streak"><i class="bi bi-fire"></i>${longestZeroStreak}-day zero-spend streak</span>` : ''}
      ${dominant ? `<span class="sdt-at-dominant" style="color:${dominant.color}">${dominant.emoji} Most common: ${dominant.label} (${dominant.total} days)</span>` : ''}
    </div>
    <div class="sdt-row sdt-row--rpt">
      ${tiers.map(t => `
        <div class="sdt-badge" style="--sdt-color:${t.color}">
          <div class="sdt-emoji">${t.emoji}</div>
          <div class="sdt-count" style="color:${t.color}">${t.total}</div>
          <div class="sdt-label">${t.label}</div>
          <div class="sdt-range">${t.range}</div>
          <div class="sdt-sub">${t.weekdays} weekdays · ${t.weekends} weekends</div>
        </div>`).join('')}
    </div>`;

  const historyMonths = history.filter(h => h.result.totalDays > 0);
  const colTemplate = `160px repeat(${historyMonths.length}, 1fr)`;
  const tableHtml = historyMonths.length >= 2 ? `
    <div class="sdt-table-toggle-wrap">
      <button class="rpt-toggle-btn sdt-table-toggle-btn mt-3" type="button">
        <i class="bi bi-table me-1"></i>Month-by-Month Breakdown
        <i class="bi bi-chevron-down ms-2 rpt-toggle-chevron"></i>
      </button>
      <div class="rpt-inline-panel sdt-table-panel">
    <div class="sdt-at-table-wrap">
      <div class="sdt-at-table-title"><i class="bi bi-table me-1"></i>Month-by-Month Breakdown</div>
      <div class="sdt-at-table">
        <div class="sdt-at-head" style="grid-template-columns:${colTemplate}">
          <div class="sdt-at-tier-col">Tier / Range</div>
          ${historyMonths.map(h => `<div class="sdt-at-val-col">${h.label}</div>`).join('')}
        </div>
        ${tiers.map(t => {
          const counts = historyMonths.map(h => h.result.tiers.find(r => r.key === t.key)?.total ?? 0);
          const maxCount = Math.max(...counts, 1);
          return `<div class="sdt-at-row" style="grid-template-columns:${colTemplate}">
            <div class="sdt-at-tier-col">
              <span class="sdt-at-emoji">${t.emoji}</span>
              <span class="sdt-at-name" style="color:${t.color}">${t.label}</span>
              <span class="sdt-at-range">${t.range}</span>
            </div>
            ${counts.map(count => `
              <div class="sdt-at-val-col">
                <div class="sdt-at-cell">
                  <span class="sdt-at-num" style="color:${count > 0 ? t.color : '#cbd5e1'}">${count}</span>
                  <div class="sdt-at-bar-wrap"><div class="sdt-at-bar" style="width:${Math.round((count / maxCount) * 100)}%;background:${t.color}"></div></div>
                </div>
              </div>`).join('')}
          </div>`;
        }).join('')}
      </div>
    </div></div></div>` : '';

  container.innerHTML = badgesHtml + tableHtml;

  container.querySelector('.sdt-table-toggle-btn')?.addEventListener('click', function() {
    const panel = container.querySelector('.sdt-table-panel');
    if (!panel) return;
    panel.classList.toggle('show');
    const chevron = this.querySelector('.rpt-toggle-chevron');
    if (chevron) chevron.style.transform = panel.classList.contains('show') ? 'rotate(180deg)' : '';
  });
}

// ─── Month-over-Month Comparison ─────────────────────────────────────────────

function _renderMoM() {
  const el = _el('rpt-mom-content');
  if (!el) return;

  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];

  const now      = new Date();
  const curYM    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const curLabel  = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const prevLabel = prevDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const curExp  = expenses.filter(e => (e.date ?? '').startsWith(curYM)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const prevExp = expenses.filter(e => (e.date ?? '').startsWith(prevYM)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const curInc  = income.filter(i => (i.date ?? '').startsWith(curYM)).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const prevInc = income.filter(i => (i.date ?? '').startsWith(prevYM)).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const curNet  = curInc - curExp;
  const prevNet = prevInc - prevExp;

  const expChgPct = prevExp > 0 ? ((curExp - prevExp) / prevExp) * 100 : null;

  const _row = (label, cur, prev, icon, accentColor, lowerIsBetter = false) => {
    const diff   = cur - prev;
    const pct    = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
    const up     = diff > 0;
    const flat   = pct !== null && Math.abs(pct) < 2;
    const good   = flat ? true : lowerIsBetter ? !up : up;
    const tc     = flat ? '#94a3b8' : good ? '#10b981' : '#ef4444';
    const ti     = flat ? 'bi-dash-lg' : up ? 'bi-arrow-up' : 'bi-arrow-down';
    const pctStr = pct !== null ? `${up ? '+' : ''}${pct}%` : '—';
    const diffStr = `${diff >= 0 ? '+' : '\u2212'}${formatCurrency(Math.abs(diff))}`;
    return `<div class="mom-row">
      <div class="mom-row-label"><i class="bi ${icon} me-2" style="color:${accentColor}"></i>${label}</div>
      <div class="mom-row-prev">${formatCurrency(prev)}</div>
      <div class="mom-row-cur fw-semibold">${formatCurrency(cur)}</div>
      <div class="mom-row-change" style="color:${tc}"><i class="bi ${ti} me-1"></i>${pctStr}<span class="mom-diff">${diffStr}</span></div>
    </div>`;
  };

  let insightHtml = '';
  if (expChgPct !== null) {
    const abs = Math.abs(expChgPct);
    const ic  = expChgPct > 10 ? '#ef4444' : expChgPct > 2 ? '#f59e0b' : '#10b981';
    const ii  = expChgPct > 2 ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill';
    const msg = abs < 2
      ? `Spending is about the same as last month.`
      : expChgPct > 0
        ? `You spent <strong>${abs.toFixed(1)}% more</strong> than last month (${formatCurrency(curExp - prevExp)} extra).`
        : `You spent <strong>${abs.toFixed(1)}% less</strong> than last month — saved ${formatCurrency(prevExp - curExp)}.`;
    insightHtml = `<div class="mom-insight" style="border-left:3px solid ${ic};background:${ic}18;color:${ic}"><i class="bi ${ii} me-2"></i>${msg}</div>`;
  }

  el.innerHTML = `${insightHtml}
    <div class="mom-table">
      <div class="mom-header">
        <div class="mom-row-label"></div>
        <div class="mom-row-prev">${prevLabel}</div>
        <div class="mom-row-cur">${curLabel}</div>
        <div class="mom-row-change">Change</div>
      </div>
      ${_row('Expenses',     curExp,  prevExp,  'bi-arrow-up-circle-fill',   '#ef4444', true)}
      ${_row('Income',       curInc,  prevInc,  'bi-arrow-down-circle-fill', '#10b981')}
      ${_row('Net Savings',  curNet,  prevNet,  'bi-wallet2',               '#6366f1')}
    </div>`;
}

// ─── Category Trend Table ─────────────────────────────────────────────────────

function _renderCategoryTrends() {
  const el = _el('rpt-cat-trend-list');
  if (!el) return;

  const expenses = store.get('expenses') ?? [];
  const now = new Date();
  const months = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const catTotals = {};
  expenses.filter(e => months.slice(0, 3).some(m => (e.date ?? '').startsWith(m)))
    .forEach(e => { if (e.category) catTotals[e.category] = (catTotals[e.category] ?? 0) + (Number(e.amount) || 0); });

  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  if (!topCats.length) { el.innerHTML = '<p class="text-muted small mb-0">No category data yet.</p>'; return; }

  const mLabels = months.map(ym => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short' });
  });

  const rows = topCats.map((cat, idx) => {
    const ms      = months.map(ym => expenses.filter(e => e.category === cat && (e.date ?? '').startsWith(ym)).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    const cur     = ms[3];
    const prev    = ms[2];
    const diff    = cur - prev;
    const pct     = prev > 0 ? Math.round((diff / prev) * 100) : (cur > 0 ? null : 0);
    const flat    = pct !== null && Math.abs(pct) < 5;
    const up      = diff > 0;
    const tc      = flat ? '#94a3b8' : up ? '#ef4444' : '#10b981';
    const ti      = flat ? 'bi-dash-lg' : up ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
    const pctStr  = pct !== null ? `${up ? '+' : ''}${pct}%` : 'New';
    const color   = P[idx % P.length];
    const maxV    = Math.max(...ms, 1);
    const bars    = ms.map((v, i) => `<span style="display:inline-block;width:7px;height:${Math.max(Math.round((v / maxV) * 26), 2)}px;border-radius:2px;background:${i === 3 ? color : color + '55'};margin-top:auto"></span>`).join('');
    return `<div class="ctt-row">
      <div class="ctt-name"><span class="ctt-dot" style="background:${color}"></span>${cat}</div>
      <div class="ctt-spark" style="display:flex;align-items:flex-end;gap:2px;height:26px">${bars}</div>
      <div class="ctt-prev">${formatCurrency(prev)}</div>
      <div class="ctt-cur">${formatCurrency(cur)}</div>
      <div class="ctt-pct" style="color:${tc}"><i class="bi ${ti} me-1"></i>${pctStr}</div>
    </div>`;
  });

  el.innerHTML = `<div class="ctt-table">
    <div class="ctt-head">
      <div class="ctt-name">Category</div>
      <div class="ctt-spark" style="display:flex;gap:2px">${mLabels.map(l => `<span style="width:7px;font-size:.58rem;text-align:center;color:#94a3b8">${l[0]}</span>`).join('')}</div>
      <div class="ctt-prev">${mLabels[2]}</div>
      <div class="ctt-cur">${mLabels[3]}</div>
      <div class="ctt-pct">Trend</div>
    </div>
    ${rows.join('')}
  </div>`;
}

// ─── Spending Trend Forecast ──────────────────────────────────────────────────

let _forecastMonths = 3; // 3 or 6

function _spendingForecast(canvasId) {
  const canvas = _el(canvasId);
  if (!canvas) return;
  _kill(canvasId);

  const expenses = store.get('expenses') ?? [];
  const now = new Date();

  // Build the last N months (excluding current month to avoid partial data skewing)
  const histMonths = [];
  for (let i = _forecastMonths; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    histMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Current month (for comparison in table)
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Next month label
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextYM = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
  const nextLabel = nextDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Collect all categories that appeared in the history window
  const histExpenses = expenses.filter(e => histMonths.some(m => (e.date ?? '').startsWith(m)));
  if (!histExpenses.length) {
    _noData(canvasId, 'Not enough historical data — add expenses for the past few months');
    const summaryEl = _el('rpt-forecast-summary');
    if (summaryEl) summaryEl.innerHTML = '<p class="text-muted small mb-0">No data available.</p>';
    const tableEl = _el('rpt-forecast-table');
    if (tableEl) tableEl.innerHTML = '<p class="text-muted small mb-0">No data available.</p>';
    return;
  }

  // Per-category average across history months
  const catTotals = {};
  histExpenses.forEach(e => {
    if (!e.category) return;
    catTotals[e.category] = (catTotals[e.category] ?? 0) + (Number(e.amount) || 0);
  });

  // Average per month
  const catAvg = {};
  Object.entries(catTotals).forEach(([cat, total]) => {
    catAvg[cat] = total / _forecastMonths;
  });

  // Sort by forecast amount descending, take top 12
  const sorted = Object.entries(catAvg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (!sorted.length) {
    _noData(canvasId, 'No category data found');
    return;
  }
  _showCanvas(canvasId);

  const labels = sorted.map(([k]) => k);
  const forecastData = sorted.map(([, v]) => Math.round(v));
  const totalForecast = forecastData.reduce((s, v) => s + v, 0);

  // Current month actuals for comparison
  const curActuals = labels.map(cat =>
    expenses.filter(e => e.category === cat && (e.date ?? '').startsWith(curYM))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  );

  _ch[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `Forecast (${nextLabel})`,
          data: forecastData,
          backgroundColor: P.slice(0, labels.length).map(c => c + 'CC'),
          borderColor: P.slice(0, labels.length),
          borderWidth: 1.5,
          borderRadius: 7,
          borderSkipped: false,
          order: 1,
        },
        {
          label: 'Current Month Actual',
          data: curActuals,
          type: 'line',
          borderColor: 'rgba(148,163,184,.9)',
          backgroundColor: 'rgba(148,163,184,.08)',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: false,
          order: 0,
        },
      ],
    },
    options: {
      ...BASE_OPTS,
      plugins: {
        ...BASE_OPTS.plugins,
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 }, color: '#9ca3af', boxWidth: 10, padding: 12, usePointStyle: true },
        },
        tooltip: {
          ...BASE_OPTS.plugins.tooltip,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { ...BASE_OPTS.scales.x, ticks: { ...BASE_OPTS.scales.x.ticks, maxRotation: 35, minRotation: 0 } },
        y: {
          ...BASE_OPTS.scales.y,
          ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => '₹' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) },
        },
      },
    },
  });

  // ── Summary panel ──
  const summaryEl = _el('rpt-forecast-summary');
  if (summaryEl) {
    const curTotal = curActuals.reduce((s, v) => s + v, 0);
    const diff = totalForecast - curTotal;
    const diffPct = curTotal > 0 ? Math.round((diff / curTotal) * 100) : null;
    const diffColor = diff > 0 ? '#ef4444' : '#10b981';
    const diffIcon = diff > 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
    const topCat = sorted[0];

    summaryEl.innerHTML = `
      <div class="rpt-forecast-kpi-grid">
        <div class="rpt-forecast-kpi">
          <div class="rpt-forecast-kpi-label">Projected Total</div>
          <div class="rpt-forecast-kpi-val" style="color:#8b5cf6">${formatCurrency(totalForecast)}</div>
          <div class="rpt-forecast-kpi-sub">${nextLabel}</div>
        </div>
        <div class="rpt-forecast-kpi">
          <div class="rpt-forecast-kpi-label">Current Month</div>
          <div class="rpt-forecast-kpi-val">${formatCurrency(curTotal)}</div>
          <div class="rpt-forecast-kpi-sub">so far</div>
        </div>
        <div class="rpt-forecast-kpi">
          <div class="rpt-forecast-kpi-label">vs Current</div>
          <div class="rpt-forecast-kpi-val" style="color:${diffColor}">
            <i class="bi ${diffIcon} me-1"></i>${diffPct !== null ? (diff >= 0 ? '+' : '') + diffPct + '%' : '—'}
          </div>
          <div class="rpt-forecast-kpi-sub">${diff >= 0 ? formatCurrency(diff) + ' more' : formatCurrency(Math.abs(diff)) + ' less'}</div>
        </div>
        <div class="rpt-forecast-kpi">
          <div class="rpt-forecast-kpi-label">Avg Basis</div>
          <div class="rpt-forecast-kpi-val" style="color:#64748b">${_forecastMonths}M</div>
          <div class="rpt-forecast-kpi-sub">months used</div>
        </div>
      </div>
      <div class="rpt-forecast-top-cat mt-3">
        <i class="bi bi-trophy-fill me-1" style="color:#f59e0b"></i>
        Highest forecast: <strong>${topCat[0]}</strong> at <strong>${formatCurrency(Math.round(topCat[1]))}</strong>
      </div>
      <div class="rpt-forecast-note mt-2">
        <i class="bi bi-info-circle me-1"></i>
        Projection = average of last ${_forecastMonths} complete months per category.
      </div>`;
  }

  // ── Forecast table ──
  const tableEl = _el('rpt-forecast-table');
  if (tableEl) {
    const rows = sorted.map(([cat, avg], i) => {
      const forecast = Math.round(avg);
      const actual = curActuals[i];
      const diff = forecast - actual;
      const pct = actual > 0 ? Math.round((diff / actual) * 100) : null;
      const up = diff > 0;
      const tc = pct === null ? '#94a3b8' : Math.abs(pct) < 5 ? '#94a3b8' : up ? '#ef4444' : '#10b981';
      const ti = pct === null ? 'bi-dash-lg' : up ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
      const pctStr = pct !== null ? `${up ? '+' : ''}${pct}%` : 'New';
      const barPct = totalForecast > 0 ? Math.round((forecast / totalForecast) * 100) : 0;
      return `<div class="rpt-forecast-row">
        <div class="rpt-forecast-cat">
          <span class="rpt-forecast-dot" style="background:${P[i % P.length]}"></span>
          <span>${cat}</span>
        </div>
        <div class="rpt-forecast-bar-cell">
          <div class="rpt-forecast-bar-track">
            <div class="rpt-forecast-bar-fill" style="width:${barPct}%;background:${P[i % P.length]}88"></div>
          </div>
        </div>
        <div class="rpt-forecast-actual">${formatCurrency(actual)}</div>
        <div class="rpt-forecast-projected" style="color:#8b5cf6;font-weight:600">${formatCurrency(forecast)}</div>
        <div class="rpt-forecast-change" style="color:${tc}">
          <i class="bi ${ti} me-1"></i>${pctStr}
        </div>
      </div>`;
    });

    tableEl.innerHTML = `
      <div class="rpt-forecast-table-wrap">
        <div class="rpt-forecast-head">
          <div class="rpt-forecast-cat">Category</div>
          <div class="rpt-forecast-bar-cell">Share</div>
          <div class="rpt-forecast-actual">This Month</div>
          <div class="rpt-forecast-projected">Forecast</div>
          <div class="rpt-forecast-change">vs Actual</div>
        </div>
        ${rows.join('')}
        <div class="rpt-forecast-total-row">
          <div class="rpt-forecast-cat"><strong>Total</strong></div>
          <div class="rpt-forecast-bar-cell"></div>
          <div class="rpt-forecast-actual"><strong>${formatCurrency(curActuals.reduce((s, v) => s + v, 0))}</strong></div>
          <div class="rpt-forecast-projected" style="color:#8b5cf6"><strong>${formatCurrency(totalForecast)}</strong></div>
          <div class="rpt-forecast-change"></div>
        </div>
      </div>`;
  }
}



function _bindPeriodFilter() {
  document.querySelectorAll('.rpt-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpt-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _period = parseInt(btn.dataset.months, 10);
      render();
    });
  });
}

// ─── Spending Diary ───────────────────────────────────────────────────────────

const _now = new Date();
const _diaryState = {
  year:  _now.getFullYear(),
  month: _now.getMonth(),
  type:  'all',
  search: '',
};

const _CAT_ICONS = {
  Food:'🍔', Travel:'✈️', Utilities:'⚡', Shopping:'🛍️', Health:'💊',
  Entertainment:'🎬', Education:'📚', Household:'🏠', 'Personal Care':'💆',
  Kids:'🧒', Vehicle:'🚗', 'EMI / Loans':'🏦', Investments:'📈', Recharge:'📱',
  Other:'📌', Salary:'💰', Freelance:'💻', Business:'🏢', Investment:'📊',
  Gift:'🎁', Bonus:'🏅', Rent:'🏠', Dividend:'📉',
};

function _renderSpendingDiary() {
  const container = _el('diary-body');
  if (!container) return;

  const { year, month, type, search } = _diaryState;
  const ymStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const today  = new Date().toISOString().slice(0, 10);

  const monthLabel = _el('diary-month-label');
  if (monthLabel) {
    monthLabel.textContent = new Date(year, month, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  const nextBtn = _el('diary-next-month');
  const curNow  = new Date();
  if (nextBtn) nextBtn.disabled =
    year > curNow.getFullYear() ||
    (year === curNow.getFullYear() && month >= curNow.getMonth());

  let expenses = (store.get('expenses') ?? []).filter(e => (e.date ?? '').startsWith(ymStr));
  let income   = (store.get('income')   ?? []).filter(i => (i.date ?? '').startsWith(ymStr));

  const q = search.trim().toLowerCase();
  if (q) {
    expenses = expenses.filter(e =>
      (e.description ?? '').toLowerCase().includes(q) ||
      (e.category    ?? '').toLowerCase().includes(q));
    income = income.filter(i =>
      (i.description ?? '').toLowerCase().includes(q) ||
      (i.source      ?? '').toLowerCase().includes(q));
  }

  const allTxns = [];
  if (type !== 'income')  expenses.forEach(e => allTxns.push({ ...e, _type: 'expense' }));
  if (type !== 'expense') income.forEach(i =>   allTxns.push({ ...i, _type: 'income'  }));

  const totalExp = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalInc = income.reduce((s,  i) => s + (i.amount  ?? 0), 0);
  const net      = totalInc - totalExp;

  const strip = _el('diary-summary-strip');
  if (strip) {
    strip.innerHTML = `
      <div class="diary-stat">
        <span class="diary-stat-label">Income</span>
        <span class="diary-stat-val diary-stat-val--green">+${formatCurrency(totalInc)}</span>
      </div>
      <div class="diary-stat-div"></div>
      <div class="diary-stat">
        <span class="diary-stat-label">Expenses</span>
        <span class="diary-stat-val diary-stat-val--red">\u2212${formatCurrency(totalExp)}</span>
      </div>
      <div class="diary-stat-div"></div>
      <div class="diary-stat">
        <span class="diary-stat-label">Net</span>
        <span class="diary-stat-val" style="color:${net >= 0 ? '#10b981' : '#ef4444'}">${net >= 0 ? '+' : '\u2212'}${formatCurrency(Math.abs(net))}</span>
      </div>
      <div class="diary-stat-div"></div>
      <div class="diary-stat">
        <span class="diary-stat-label">Transactions</span>
        <span class="diary-stat-val diary-stat-val--purple">${allTxns.length}</span>
      </div>`;
  }

  if (allTxns.length === 0) {
    container.innerHTML = `<div class="diary-empty">
      <i class="bi bi-journal-x diary-empty-icon"></i>
      <div class="diary-empty-title">No transactions found</div>
      <div class="diary-empty-sub">${q ? 'Try a different search term' : 'No entries for this month'}</div>
    </div>`;
    return;
  }

  // Group by date
  const grouped = {};
  allTxns.forEach(t => {
    const d = t.date ?? '';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(t);
  });

  // Running cumulative net from oldest → newest
  const allSorted = [...allTxns].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  let running = 0;
  const runByDate = {};
  allSorted.forEach(t => {
    running += t._type === 'income' ? (t.amount ?? 0) : -(t.amount ?? 0);
    runByDate[t.date ?? ''] = running;
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  container.innerHTML = sortedDates.map(dateStr => {
    const txns   = grouped[dateStr];
    const dayExp = txns.filter(t => t._type === 'expense').reduce((s, t) => s + (t.amount ?? 0), 0);
    const dayInc = txns.filter(t => t._type === 'income' ).reduce((s, t) => s + (t.amount ?? 0), 0);
    const runBal = runByDate[dateStr] ?? 0;
    const isToday = dateStr === today;

    const d = new Date(dateStr + 'T00:00:00');
    const dayLabel = isToday
      ? 'Today'
      : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

    return `
    <div class="diary-day-group">
      <div class="diary-day-header">
        <div class="diary-day-left">
          <span class="diary-day-label${isToday ? ' diary-day-today' : ''}">${dayLabel}</span>
          <span class="diary-day-count">${txns.length} txn${txns.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="diary-day-right">
          ${dayInc > 0 ? `<span class="diary-day-chip diary-day-chip--inc">+${formatCurrency(dayInc)}</span>` : ''}
          ${dayExp > 0 ? `<span class="diary-day-chip diary-day-chip--exp">\u2212${formatCurrency(dayExp)}</span>` : ''}
          <span class="diary-day-chip diary-day-chip--bal" style="color:${runBal >= 0 ? '#6366f1' : '#ef4444'}" title="Cumulative net this month">
            <i class="bi bi-arrow-repeat" style="font-size:.6rem"></i> ${runBal >= 0 ? '+' : ''}${formatCurrency(runBal)}
          </span>
        </div>
      </div>
      <div class="diary-txn-list">
        ${txns.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).map(t => {
          const catOrSrc = t._type === 'income' ? (t.source ?? '') : (t.category ?? '');
          const icon = _CAT_ICONS[catOrSrc] ?? (t._type === 'income' ? '💵' : '💸');
          const desc = (t.description ?? '').trim() || catOrSrc;
          const pm   = t.paymentMethod ?? t.receivedIn ?? '';
          return `
          <div class="diary-txn-row diary-txn-row--${t._type}">
            <div class="diary-txn-icon">${icon}</div>
            <div class="diary-txn-body">
              <div class="diary-txn-name">${desc}</div>
              <div class="diary-txn-meta">
                <span class="diary-txn-cat">${catOrSrc}</span>
                ${pm ? `<span class="diary-txn-pm">${pm}</span>` : ''}
              </div>
            </div>
            <div class="diary-txn-amt diary-txn-amt--${t._type}">
              ${t._type === 'income' ? '+' : '\u2212'}${formatCurrency(t.amount ?? 0)}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function _bindDiary() {
  const prevBtn = _el('diary-prev-month');
  const nextBtn = _el('diary-next-month');

  const _go = (delta) => {
    _diaryState.month += delta;
    if (_diaryState.month < 0)  { _diaryState.month = 11; _diaryState.year--; }
    if (_diaryState.month > 11) { _diaryState.month = 0;  _diaryState.year++; }
    _renderSpendingDiary();
  };

  prevBtn?.addEventListener('click', () => _go(-1));
  nextBtn?.addEventListener('click', () => _go(+1));

  document.querySelectorAll('.diary-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diary-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _diaryState.type = btn.dataset.diaryType;
      _renderSpendingDiary();
    });
  });

  const searchEl = _el('diary-search');
  if (searchEl) {
    let _debounce;
    searchEl.addEventListener('input', () => {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => {
        _diaryState.search = searchEl.value;
        _renderSpendingDiary();
      }, 250);
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function render() {
  _renderKpi();
  _renderBudgetSummary();
  _renderMoM();
  _renderCategoryTrends();
  _renderSpendingDayTiers();
  _renderSpendingDiary();
  _categoryTrend('rpt-cat-trend');
  _monthlySpend('rpt-monthly-spend');
  _paymentMethodDonut('rpt-pay-method');
  _topSubcategories('rpt-top-subcat');
  _mileageTrend('rpt-mileage');
  _vehicleCostBar('rpt-veh-cost');
  _vehicleDonut('rpt-veh-donut');
  _budgetUtil('rpt-budget-util');
  _lendingBalance('rpt-lending-bal');
  _subDonut('rpt-sub-donut');
  _spendingForecast('rpt-forecast-bar');
}

export function renderVehicleInline() {
  _mileageTrend('veh-inline-mileage');
  _vehicleCostBar('veh-inline-cost');
  _vehicleDonut('veh-inline-donut');
}

export function renderBudgetInline() {
  _budgetUtil('budget-inline-util');
}

export function init() {
  _bindPeriodFilter();
  _bindDiary();

  // Forecast period toggle (3M / 6M avg)
  document.querySelectorAll('.rpt-forecast-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpt-forecast-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _forecastMonths = parseInt(btn.dataset.forecastMonths, 10);
      _spendingForecast('rpt-forecast-bar');
    });
  });

  // In-page section nav — scroll to section on click
  document.querySelectorAll('.rpt-nav-link[data-rpt-sec]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const sec = document.getElementById(link.dataset.rptSec);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Section nav active tracking via IntersectionObserver
  const _ioSections = document.querySelectorAll('.rpt-section[id]');
  const _ioLinks    = document.querySelectorAll('.rpt-nav-link[data-rpt-sec]');
  if (_ioSections.length && _ioLinks.length && 'IntersectionObserver' in window) {
    const _io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          _ioLinks.forEach(l => l.classList.remove('active'));
          document.querySelector(`.rpt-nav-link[data-rpt-sec="${entry.target.id}"]`)?.classList.add('active');
        }
      });
    }, { rootMargin: '-10% 0px -80% 0px', threshold: 0 });
    _ioSections.forEach(s => _io.observe(s));
  }

  const _rerender = () => { if (_el('tab-analytics')?.classList.contains('active')) render(); };
  store.on('expenses',           _rerender);
  store.on('income',             _rerender);
  store.on('tripLogs',           _rerender);
  store.on('vehicleExpenses',    _rerender);
  store.on('budgets',            _rerender);
  store.on('lendings',           _rerender);
  store.on('lendingSettlements', _rerender);
  store.on('subscriptions',      _rerender);
}
