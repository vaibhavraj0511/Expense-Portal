// js/tax-summary.js — Tax Summary Report module
// Financial year: April 1 – March 31

import * as store from './store.js';
import { formatCurrency } from './utils.js';

let _txChart = null; // Chart.js instance for monthly chart

// ─── Tax Calculation Engine ───────────────────────────────────────────────────

const TAX_CONFIG = {
  '2025-26': {
    newRegime: {
      slabs: [
        { upto: 400000,  rate: 0   },
        { upto: 800000,  rate: 0.05 },
        { upto: 1200000, rate: 0.10 },
        { upto: 1600000, rate: 0.15 },
        { upto: 2000000, rate: 0.20 },
        { upto: 2400000, rate: 0.25 },
        { upto: Infinity, rate: 0.30 },
      ],
      rebate87A: 1200000,   // zero tax if income ≤ 12L
      stdDeductionSalaried: 75000,
      stdDeductionSelf: 0,
    },
    oldRegime: {
      slabs: [
        { upto: 250000,  rate: 0    },
        { upto: 500000,  rate: 0.05 },
        { upto: 1000000, rate: 0.20 },
        { upto: Infinity, rate: 0.30 },
      ],
      rebate87A: 500000,
      stdDeductionSalaried: 50000,
      stdDeductionSelf: 0,
      maxDeduction80C: 150000,
      maxDeduction80D: 25000,
    },
  },
  '2024-25': {
    newRegime: {
      slabs: [
        { upto: 300000,  rate: 0    },
        { upto: 700000,  rate: 0.05 },
        { upto: 1000000, rate: 0.10 },
        { upto: 1200000, rate: 0.15 },
        { upto: 1500000, rate: 0.20 },
        { upto: Infinity, rate: 0.30 },
      ],
      rebate87A: 700000,
      stdDeductionSalaried: 50000,
      stdDeductionSelf: 0,
    },
    oldRegime: {
      slabs: [
        { upto: 250000,  rate: 0    },
        { upto: 500000,  rate: 0.05 },
        { upto: 1000000, rate: 0.20 },
        { upto: Infinity, rate: 0.30 },
      ],
      rebate87A: 500000,
      stdDeductionSalaried: 50000,
      stdDeductionSelf: 0,
      maxDeduction80C: 150000,
      maxDeduction80D: 25000,
    },
  },
};

function calcSlabTax(income, slabs) {
  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    if (income <= prev) break;
    const taxable = Math.min(income, slab.upto) - prev;
    tax += taxable * slab.rate;
    prev = slab.upto;
  }
  return Math.max(0, tax);
}

function calcTax(grossIncome, fy, regime, opts = {}) {
  const config  = TAX_CONFIG[fy]?.[regime] ?? TAX_CONFIG['2025-26'][regime];
  const isSal   = opts.employmentType === 'salaried';
  const stdDed  = isSal ? config.stdDeductionSalaried : config.stdDeductionSelf;

  let taxableIncome = Math.max(0, grossIncome - stdDed);

  let totalDeductions = 0;
  if (regime === 'oldRegime') {
    const ded80C  = Math.min(opts.ded80C  ?? 0, config.maxDeduction80C ?? 150000);
    const ded80D  = Math.min(opts.ded80D  ?? 0, config.maxDeduction80D ?? 25000);
    const hra     = opts.hra     ?? 0;
    const otherD  = opts.otherD  ?? 0;
    totalDeductions = ded80C + ded80D + hra + otherD;
    taxableIncome = Math.max(0, taxableIncome - totalDeductions);
  }

  let baseTax = calcSlabTax(taxableIncome, config.slabs);

  // 87A Rebate
  if (taxableIncome <= config.rebate87A) baseTax = 0;

  // Surcharge
  let surcharge = 0;
  if      (taxableIncome > 50000000) surcharge = baseTax * 0.37;
  else if (taxableIncome > 20000000) surcharge = baseTax * 0.25;
  else if (taxableIncome > 10000000) surcharge = baseTax * 0.15;
  else if (taxableIncome >  5000000) surcharge = baseTax * 0.10;
  surcharge = Math.round(surcharge);

  // 4% Health & Education Cess
  const cess     = Math.round((baseTax + surcharge) * 0.04);
  const totalTax = Math.round(baseTax + surcharge + cess);

  return { taxableIncome, stdDed, totalDeductions, baseTax: Math.round(baseTax), surcharge, cess, totalTax };
}

// ─── Deduction utilization bars ──────────────────────────────────────────────

function renderDeductionUtil() {
  const el = document.getElementById('tax-deduction-util');
  if (!el) return;
  const fy     = document.getElementById('tax-fy-select')?.value ?? '2025-26';
  const ded80C = parseFloat(document.getElementById('tax-80c')?.value) || 0;
  const ded80D = parseFloat(document.getElementById('tax-80d')?.value) || 0;
  const gross  = parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
  if (gross <= 0) { el.innerHTML = ''; return; }
  const cfg  = TAX_CONFIG[fy]?.oldRegime ?? TAX_CONFIG['2025-26'].oldRegime;
  const max80C = cfg.maxDeduction80C ?? 150000;
  const max80D = cfg.maxDeduction80D ?? 25000;
  const items = [
    { label: '80C', used: Math.min(ded80C, max80C), max: max80C },
    { label: '80D', used: Math.min(ded80D, max80D), max: max80D },
  ];
  el.innerHTML = items.map(r => {
    const pct = r.max > 0 ? Math.round((r.used / r.max) * 100) : 0;
    const gap = r.max - r.used;
    const save = Math.round(gap * 0.30);
    return `<div class="tax-ded-util mb-2">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="small fw-semibold">${r.label}</span>
        <span class="small text-muted">${formatCurrency(r.used)} / ${formatCurrency(r.max)}</span>
      </div>
      <div class="tax-ded-bar-wrap"><div class="tax-ded-bar" style="width:${pct}%;background:${pct >= 100 ? '#10b981' : '#f59e0b'}"></div></div>
      ${gap > 0 ? `<div class="small text-muted mt-1"><i class="bi bi-lightbulb me-1 text-warning"></i>+${formatCurrency(gap)} more → save ~${formatCurrency(save)}</div>` : `<div class="small text-success mt-1"><i class="bi bi-check-circle-fill me-1"></i>Limit fully used</div>`}
    </div>`;
  }).join('');
}

// ─── Tax-saving tips ──────────────────────────────────────────────────────────

function renderTaxTips(gross, fy, opts, newR, oldR, betterRegime) {
  const tips = [];
  const cfg  = TAX_CONFIG[fy]?.oldRegime ?? TAX_CONFIG['2025-26'].oldRegime;
  if (betterRegime === 'old') {
    const gap80C = Math.max(0, (cfg.maxDeduction80C ?? 150000) - Math.min(opts.ded80C ?? 0, cfg.maxDeduction80C ?? 150000));
    const gap80D = Math.max(0, (cfg.maxDeduction80D ?? 25000)  - Math.min(opts.ded80D ?? 0, cfg.maxDeduction80D ?? 25000));
    if (gap80C > 0) tips.push(`<div class="tax-tip-row"><i class="bi bi-piggy-bank-fill text-primary me-2"></i>Invest <strong>${formatCurrency(gap80C)}</strong> more in 80C (PPF/ELSS/LIC) → save ~<strong>${formatCurrency(Math.round(gap80C * 0.30))}</strong></div>`);
    if (gap80D > 0) tips.push(`<div class="tax-tip-row"><i class="bi bi-heart-pulse-fill text-danger me-2"></i>Add health insurance of <strong>${formatCurrency(gap80D)}</strong> under 80D → save ~<strong>${formatCurrency(Math.round(gap80D * 0.30))}</strong></div>`);
  }
  if (newR.taxableIncome <= (TAX_CONFIG[fy]?.newRegime?.rebate87A ?? 1200000))
    tips.push(`<div class="tax-tip-row"><i class="bi bi-check-circle-fill text-success me-2"></i>87A Rebate applies — <strong>zero tax</strong> under New Regime if income ≤ ₹12L</div>`);
  if (!tips.length) return '';
  return `<div class="tax-tips-card mt-3"><div class="fw-semibold small mb-2"><i class="bi bi-lightbulb-fill text-warning me-1"></i>Tax Saving Opportunities</div>${tips.join('')}</div>`;
}

function renderTaxEstimator(fy) {
  const badge = document.getElementById('tax-est-fy-badge');
  if (badge) badge.textContent = `FY ${fy}`;
  const bounds = getFYBounds(fy);
  const income = (store.get('income') ?? []).filter(r => inFY(r.date, bounds));
  const totalIncome = income.reduce((s, r) => s + (r.amount ?? 0), 0);
  const grossEl = document.getElementById('tax-gross-income');
  if (grossEl && !grossEl.dataset.manuallyEdited) grossEl.value = Math.round(totalIncome) || '';
  renderDeductionUtil();
  // Auto-calculate with defaults so Est. Tax card is never empty on load
  if (totalIncome > 0) calculateAndRender();
}

function calculateAndRender() {
  const fy      = document.getElementById('tax-fy-select')?.value ?? '2025-26';
  const empType = document.getElementById('tax-emp-type')?.value ?? 'salaried';
  const gross   = parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
  const tds     = parseFloat(document.getElementById('tax-tds-paid')?.value)     || 0;
  const ded80C  = parseFloat(document.getElementById('tax-80c')?.value)           || 0;
  const ded80D  = parseFloat(document.getElementById('tax-80d')?.value)           || 0;
  const hra     = parseFloat(document.getElementById('tax-hra')?.value)           || 0;
  const otherD  = parseFloat(document.getElementById('tax-other-ded')?.value)     || 0;

  const res = document.getElementById('tax-estimator-result');
  if (!gross) {
    if (res) { res.innerHTML = `<div class="alert alert-warning py-2 small">Please enter your gross income.</div>`; res.classList.remove('d-none'); }
    return;
  }

  const opts = { employmentType: empType, ded80C, ded80D, hra, otherD };
  const newR = calcTax(gross, fy, 'newRegime', opts);
  const oldR = calcTax(gross, fy, 'oldRegime', opts);
  const newPay = Math.max(0, newR.totalTax - tds);
  const oldPay = Math.max(0, oldR.totalTax - tds);
  const betterRegime = newR.totalTax <= oldR.totalTax ? 'new' : 'old';
  const saving = Math.abs(oldR.totalTax - newR.totalTax);
  const mustFile = gross > 250000 || tds > 0;

  // Update Est. Tax stat card
  const bestTax = betterRegime === 'new' ? newR.totalTax : oldR.totalTax;
  const estEl = document.getElementById('tax-stat-est-tax');
  const regEl = document.getElementById('tax-est-regime');
  if (estEl) { estEl.textContent = formatCurrency(bestTax); estEl.style.color = bestTax > 0 ? '#d97706' : '#10b981'; }
  if (regEl) regEl.innerHTML = `<span style="color:#6b7280;font-size:.65rem">${betterRegime === 'new' ? 'New' : 'Old'} Regime recommended</span>`;

  renderDeductionUtil();
  if (!res) return;
  res.classList.remove('d-none');

  const surchargeRow = (newR.surcharge > 0 || oldR.surcharge > 0) ? `
    <tr><td>Surcharge</td><td class="text-end">${formatCurrency(newR.surcharge)}</td><td class="text-end">${formatCurrency(oldR.surcharge)}</td></tr>` : '';

  res.innerHTML = `
    <div class="tax-recommend-banner tax-recommend-${betterRegime}">
      <div class="tax-recommend-icon"><i class="bi bi-${betterRegime === 'new' ? 'lightning-charge-fill' : 'shield-fill-check'}"></i></div>
      <div>
        <div class="tax-recommend-title">${betterRegime === 'new' ? 'New' : 'Old'} Regime is better for you</div>
        <div class="tax-recommend-sub">Save ${formatCurrency(saving)} vs ${betterRegime === 'new' ? 'Old' : 'New'} Regime${saving === 0 ? ' (same tax in both)' : ''}</div>
      </div>
    </div>
    <div class="alert ${mustFile ? 'alert-info' : 'alert-success'} py-2 mt-2 small">
      <i class="bi bi-${mustFile ? 'file-earmark-check-fill' : 'check-circle-fill'} me-2"></i>
      ${mustFile ? `<strong>ITR Filing Required</strong> for FY ${fy}` : '<strong>ITR filing may be optional</strong> — income below ₹2.5L'}
    </div>
    <div class="table-responsive mt-2">
      <table class="table table-bordered table-sm tax-compare-table">
        <thead class="table-light">
          <tr>
            <th>Particulars</th>
            <th class="text-center ${betterRegime === 'new' ? 'table-success' : ''}">New ${betterRegime === 'new' ? '✓' : ''}</th>
            <th class="text-center ${betterRegime === 'old' ? 'table-success' : ''}">Old ${betterRegime === 'old' ? '✓' : ''}</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Gross Income</td><td class="text-end">${formatCurrency(gross)}</td><td class="text-end">${formatCurrency(gross)}</td></tr>
          <tr><td>Std. Deduction</td><td class="text-end text-success">− ${formatCurrency(newR.stdDed)}</td><td class="text-end text-success">− ${formatCurrency(oldR.stdDed)}</td></tr>
          ${oldR.totalDeductions > 0 ? `<tr><td>80C/80D/HRA</td><td class="text-end text-muted">Not allowed</td><td class="text-end text-success">− ${formatCurrency(oldR.totalDeductions)}</td></tr>` : ''}
          <tr class="fw-semibold"><td>Taxable Income</td><td class="text-end">${formatCurrency(newR.taxableIncome)}</td><td class="text-end">${formatCurrency(oldR.taxableIncome)}</td></tr>
          <tr><td>Income Tax</td><td class="text-end">${formatCurrency(newR.baseTax)}</td><td class="text-end">${formatCurrency(oldR.baseTax)}</td></tr>
          ${surchargeRow}
          <tr><td>Cess (4%)</td><td class="text-end">${formatCurrency(newR.cess)}</td><td class="text-end">${formatCurrency(oldR.cess)}</td></tr>
          ${newR.taxableIncome <= (TAX_CONFIG[fy]?.newRegime?.rebate87A ?? 1200000) ? `<tr class="text-success small"><td colspan="3"><i class="bi bi-check-circle-fill me-1"></i>87A Rebate — zero tax under New Regime</td></tr>` : ''}
          <tr class="fw-bold table-light"><td>Total Tax</td>
            <td class="text-end ${betterRegime === 'new' ? 'text-success' : ''}">${formatCurrency(newR.totalTax)}</td>
            <td class="text-end ${betterRegime === 'old' ? 'text-success' : ''}">${formatCurrency(oldR.totalTax)}</td>
          </tr>
          ${tds > 0 ? `
          <tr><td>TDS Paid</td><td class="text-end text-success">− ${formatCurrency(tds)}</td><td class="text-end text-success">− ${formatCurrency(tds)}</td></tr>
          <tr class="fw-bold"><td>${newPay > 0 || oldPay > 0 ? 'Balance Payable' : 'Refund Due'}</td>
            <td class="text-end ${newPay > 0 ? 'text-danger' : 'text-success'}">${newPay > 0 ? formatCurrency(newPay) : 'Refund: ' + formatCurrency(tds - newR.totalTax)}</td>
            <td class="text-end ${oldPay > 0 ? 'text-danger' : 'text-success'}">${oldPay > 0 ? formatCurrency(oldPay) : 'Refund: ' + formatCurrency(tds - oldR.totalTax)}</td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>
    ${renderTaxTips(gross, fy, opts, newR, oldR, betterRegime)}
    <div class="tax-disclaimer mt-2">
      <i class="bi bi-exclamation-triangle-fill me-1"></i>
      Estimate only. Consult a CA for exact liability.${newR.surcharge > 0 ? ' Surcharge applied.' : ''}
    </div>
  `;

  // Render efficiency gauge
  _renderEfficiencyGauge(gross, betterRegime === 'new' ? newR : oldR, opts, fy);
}

function _renderEfficiencyGauge(gross, result, opts, fy) {
  const wrap   = document.getElementById('tax-efficiency-gauge');
  const canvas = document.getElementById('tax-gauge-canvas');
  const scoreEl = document.getElementById('tax-gauge-score');
  if (!wrap || !canvas || typeof Chart === 'undefined') return;

  const cfg    = TAX_CONFIG[fy]?.oldRegime ?? TAX_CONFIG['2025-26'].oldRegime;
  const used80C = Math.min(opts.ded80C ?? 0, cfg.maxDeduction80C ?? 150000);
  const used80D = Math.min(opts.ded80D ?? 0, cfg.maxDeduction80D ?? 25000);
  const maxDed  = (cfg.maxDeduction80C ?? 150000) + (cfg.maxDeduction80D ?? 25000);
  const usedDed = used80C + used80D;
  // Score: 0–100 based on deduction utilization (50pts) + low effective rate (50pts)
  const dedScore  = maxDed > 0 ? (usedDed / maxDed) * 50 : 50;
  const effRate   = gross > 0 ? result.totalTax / gross : 0;
  const rateScore = Math.max(0, 50 - effRate * 200); // lower rate = higher score
  const score     = Math.round(dedScore + rateScore);
  const color     = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444';
  const label     = score >= 70 ? 'Optimized' : score >= 40 ? 'Fair' : 'Needs Work';

  wrap.classList.remove('d-none');
  if (scoreEl) { scoreEl.textContent = `${score}/100 — ${label}`; scoreEl.style.color = color; }

  // Destroy previous gauge chart if any
  if (wrap._gaugeChart) { wrap._gaugeChart.destroy(); }
  wrap._gaugeChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [score, 100 - score],
        backgroundColor: [color, 'rgba(226,232,240,.4)'],
        borderWidth: 0, borderRadius: 6,
        circumference: 180, rotation: 270,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 600 },
    },
  });
}

// ─── Financial Year Helpers ───────────────────────────────────────────────────

function getFYBounds(fy) {
  // fy = "2024-25" → start: 2024-04-01, end: 2025-03-31
  const startYear = parseInt(fy.split('-')[0]);
  return {
    start: new Date(startYear, 3, 1),   // April 1
    end:   new Date(startYear + 1, 2, 31, 23, 59, 59), // March 31
  };
}

function getFYLabel(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getYearFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  // April onwards belongs to current FY, Jan-March belongs to previous FY
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function buildFYOptions() {
  const income   = store.get('income')   ?? [];
  const expenses = store.get('expenses') ?? [];
  const all      = [...income, ...expenses];
  const years    = new Set();

  all.forEach(r => {
    const y = getYearFromDate(r.date);
    if (y) years.add(y);
  });

  // Always include current FY
  const now = new Date();
  const curFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  years.add(curFYStart);

  return [...years].sort((a, b) => b - a).map(y => getFYLabel(y));
}

function inFY(dateStr, bounds) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= bounds.start && d <= bounds.end;
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// ─── Render ───────────────────────────────────────────────────────────────────

function renderReport(fy) {
  const bounds   = getFYBounds(fy);
  const income   = (store.get('income')   ?? []).filter(r => inFY(r.date, bounds));
  const expenses = (store.get('expenses') ?? []).filter(r => inFY(r.date, bounds));

  const totalIncome   = income.reduce((s, r)   => s + (r.amount ?? 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + (r.amount ?? 0), 0);
  const netSavings    = totalIncome - totalExpenses;
  const savingsRate   = totalIncome > 0 ? ((netSavings / totalIncome) * 100).toFixed(1) : 0;

  // Empty state
  const hasData = totalIncome > 0 || totalExpenses > 0;
  const emptyEl = document.getElementById('tax-empty-state');
  const leftCol = document.querySelector('#tab-tax-summary .col-lg-8');
  if (emptyEl) emptyEl.classList.toggle('d-none', hasData);
  if (leftCol)  leftCol.classList.toggle('d-none', !hasData);

  const el = id => document.getElementById(id);
  if (el('tax-stat-income'))   el('tax-stat-income').textContent   = formatCurrency(totalIncome);
  if (el('tax-stat-expenses')) el('tax-stat-expenses').textContent = formatCurrency(totalExpenses);
  if (el('tax-stat-savings')) { el('tax-stat-savings').textContent = formatCurrency(netSavings); el('tax-stat-savings').style.color = netSavings >= 0 ? '#10b981' : '#ef4444'; }
  if (el('tax-stat-rate')) el('tax-stat-rate').textContent = savingsRate + '%';

  // Hero subtitle — live numbers
  const heroSub = el('tax-hero-sub');
  if (heroSub) {
    heroSub.innerHTML = `<strong style="color:rgba(255,255,255,.95)">${formatCurrency(totalIncome)}</strong> income &nbsp;&middot;&nbsp; <strong style="color:rgba(167,243,208,.95)">${formatCurrency(netSavings)}</strong> saved &nbsp;&middot;&nbsp; <span style="color:rgba(255,255,255,.75)">Rate: ${savingsRate}%</span>`;
  }

  // YoY deltas
  const fyStart    = parseInt(fy.split('-')[0]);
  const prevFY     = getFYLabel(fyStart - 1);
  const prevBounds = getFYBounds(prevFY);
  const allInc = store.get('income')   ?? [];
  const allExp = store.get('expenses') ?? [];
  const hasPrev = [...allInc, ...allExp].some(r => inFY(r.date, prevBounds));
  if (hasPrev) {
    const prevInc  = allInc.filter(r => inFY(r.date, prevBounds)).reduce((s, r) => s + (r.amount ?? 0), 0);
    const prevExp  = allExp.filter(r => inFY(r.date, prevBounds)).reduce((s, r) => s + (r.amount ?? 0), 0);
    const prevNet  = prevInc - prevExp;
    const prevRate = prevInc > 0 ? ((prevNet / prevInc) * 100) : 0;
    renderYoYChip('tax-yoy-income',   totalIncome,            prevInc);
    renderYoYChip('tax-yoy-expenses', totalExpenses,          prevExp);
    renderYoYChip('tax-yoy-savings',  netSavings,             prevNet);
    renderYoYChip('tax-yoy-rate',     parseFloat(savingsRate),prevRate);
  }

  const incomeBySource = {};
  income.forEach(r => { const src = r.source || r.description || 'Other'; incomeBySource[src] = (incomeBySource[src] ?? 0) + r.amount; });
  renderBreakdown('tax-income-breakdown', incomeBySource, totalIncome, 'success');

  const expByCategory = {};
  expenses.forEach(r => { const cat = r.category || 'Uncategorized'; expByCategory[cat] = (expByCategory[cat] ?? 0) + r.amount; });
  renderBreakdown('tax-expense-breakdown', expByCategory, totalExpenses, 'danger');

  renderMonthly(income, expenses, fy);
}

function renderBreakdown(containerId, data, total, colorClass) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    container.innerHTML = `<div class="text-muted text-center py-3 small">No data for this period</div>`;
    return;
  }
  const barColor = colorClass === 'success' ? '#10b981' : '#ef4444';
  container.innerHTML = sorted.map(([name, amount]) => {
    const pct = total > 0 ? ((amount / total) * 100).toFixed(1) : 0;
    return `<div class="tax-bd-row">
      <div class="tax-bd-top">
        <span class="tax-bd-name">${name}</span>
        <span class="tax-bd-amt" style="color:${barColor}">${formatCurrency(amount)}</span>
        <span class="tax-bd-pct">${pct}%</span>
      </div>
      <div class="tax-bd-bar-wrap"><div class="tax-bd-bar" style="width:${pct}%;background:${barColor}25;border-left:3px solid ${barColor}"></div></div>
    </div>`;
  }).join('') + `<div class="tax-bd-total"><span>Total</span><span style="color:${barColor}">${formatCurrency(total)}</span></div>`;
}

function renderMonthly(income, expenses, fy) {
  const canvas = document.getElementById('tax-monthly-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const startYear = parseInt(fy.split('-')[0]);
  const monthData = MONTHS.map((label, i) => {
    const monthIdx  = i < 9 ? i + 3 : i - 9;
    const yearOfMon = i < 9 ? startYear : startYear + 1;
    const inc = income.filter(r => { const d = new Date(r.date); return d.getMonth() === monthIdx && d.getFullYear() === yearOfMon; }).reduce((s, r) => s + r.amount, 0);
    const exp = expenses.filter(r => { const d = new Date(r.date); return d.getMonth() === monthIdx && d.getFullYear() === yearOfMon; }).reduce((s, r) => s + r.amount, 0);
    return { label, inc, exp };
  });
  if (_txChart) { _txChart.destroy(); _txChart = null; }
  const netData = monthData.map(m => (m.inc > 0 || m.exp > 0) ? m.inc - m.exp : null);
  _txChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Income',   data: monthData.map(m => m.inc), backgroundColor: 'rgba(16,185,129,.75)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4, borderSkipped: false, order: 2 },
        { label: 'Expenses', data: monthData.map(m => m.exp), backgroundColor: 'rgba(239,68,68,.70)',  borderColor: '#ef4444', borderWidth: 1, borderRadius: 4, borderSkipped: false, order: 3 },
        { label: 'Net', data: netData, type: 'line', borderColor: 'rgba(99,102,241,.9)', backgroundColor: 'rgba(99,102,241,.08)', borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.35, fill: false, spanGaps: false, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, color: '#64748b', usePointStyle: true } },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#94a3b8', bodyColor: '#f1f5f9', padding: 10, cornerRadius: 10,
          callbacks: { label: c => ` ${c.dataset.label}: ${formatCurrency(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } }, border: { display: false } },
        y: { grid: { color: 'rgba(226,232,240,.5)' }, border: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => '₹' + (v >= 1000 ? Math.round(v/1000) + 'k' : v) } },
      },
    },
  });
  const lbl = document.getElementById('tax-monthly-fy-label');
  if (lbl) lbl.textContent = `FY ${fy}`;
}

function renderYoYChip(elId, current, prev) {
  const el = document.getElementById(elId);
  if (!el || prev === null || prev === 0) { if (el) el.innerHTML = ''; return; }
  const delta = current - prev;
  const pct   = ((delta / Math.abs(prev)) * 100).toFixed(1);
  const up    = delta >= 0;
  el.innerHTML = `<span class="tax-yoy-chip-inner ${up ? 'tax-yoy--up' : 'tax-yoy--down'}"><i class="bi bi-arrow-${up ? 'up' : 'down'}-short"></i>${Math.abs(pct)}% vs last FY</span>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initTaxSummary() {
  const select = document.getElementById('tax-fy-select');
  if (!select) return;

  function refreshOptions() {
    const options = buildFYOptions();
    const current = select.value;
    select.innerHTML = options.map(fy =>
      `<option value="${fy}" ${fy === current ? 'selected' : ''}>${fy}</option>`
    ).join('');
    if (!select.value && options.length) select.value = options[0];
  }

  function refresh() {
    refreshOptions();
    if (select.value) {
      renderReport(select.value);
      renderTaxEstimator(select.value);
    }
  }

  select.addEventListener('change', () => {
    if (select.value) {
      renderReport(select.value);
      renderTaxEstimator(select.value);
      // Reset result when FY changes
      const res = document.getElementById('tax-estimator-result');
      if (res) res.classList.add('d-none');
    }
  });

  // Mark gross income as manually edited so FY switch doesn't overwrite it
  document.getElementById('tax-gross-income')?.addEventListener('input', function() {
    this.dataset.manuallyEdited = '1';
    renderDeductionUtil();
  });
  document.getElementById('tax-80c')?.addEventListener('input', renderDeductionUtil);
  document.getElementById('tax-80d')?.addEventListener('input', renderDeductionUtil);

  document.getElementById('tax-calculate-btn')?.addEventListener('click', calculateAndRender);

  document.getElementById('tax-export-btn')?.addEventListener('click', () => window.print());

  store.on('income',   refresh);
  store.on('expenses', refresh);

  refresh();
}

export function renderTaxSummary() {
  const select = document.getElementById('tax-fy-select');
  const options = buildFYOptions();
  select.innerHTML = options.map(fy =>
    `<option value="${fy}">${fy}</option>`
  ).join('');
  if (options.length) {
    select.value = options[0];
    renderReport(options[0]);
  }
}
