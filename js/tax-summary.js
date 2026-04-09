// js/tax-summary.js — Tax Summary Report module
// Financial year: April 1 – March 31

import * as store from './store.js';
import { formatCurrency } from './utils.js';

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

  let tax = calcSlabTax(taxableIncome, config.slabs);

  // 87A Rebate
  if (taxableIncome <= config.rebate87A) tax = 0;

  // 4% Health & Education Cess
  const cess     = Math.round(tax * 0.04);
  const totalTax = Math.round(tax + cess);

  return { taxableIncome, stdDed, totalDeductions, baseTax: Math.round(tax), cess, totalTax };
}

function renderTaxEstimator(fy) {
  const badge = document.getElementById('tax-est-fy-badge');
  if (badge) badge.textContent = `FY ${fy}`;

  // Auto-fill income from selected FY data
  const bounds = getFYBounds(fy);
  const income = (store.get('income') ?? []).filter(r => inFY(r.date, bounds));
  const totalIncome = income.reduce((s, r) => s + (r.amount ?? 0), 0);
  const grossEl = document.getElementById('tax-gross-income');
  if (grossEl && !grossEl.dataset.manuallyEdited) grossEl.value = Math.round(totalIncome) || '';
}

function calculateAndRender() {
  const fy        = document.getElementById('tax-fy-select')?.value ?? '2025-26';
  const empType   = document.getElementById('tax-emp-type')?.value ?? 'salaried';
  const gross     = parseFloat(document.getElementById('tax-gross-income')?.value) || 0;
  const tds       = parseFloat(document.getElementById('tax-tds-paid')?.value)     || 0;
  const ded80C    = parseFloat(document.getElementById('tax-80c')?.value)           || 0;
  const ded80D    = parseFloat(document.getElementById('tax-80d')?.value)           || 0;
  const hra       = parseFloat(document.getElementById('tax-hra')?.value)           || 0;
  const otherD    = parseFloat(document.getElementById('tax-other-ded')?.value)     || 0;

  if (!gross) {
    const res = document.getElementById('tax-estimator-result');
    if (res) { res.innerHTML = `<div class="alert alert-warning py-2">Please enter your gross income.</div>`; res.classList.remove('d-none'); }
    return;
  }

  const opts = { employmentType: empType, ded80C, ded80D, hra, otherD };

  const newR = calcTax(gross, fy, 'newRegime', opts);
  const oldR = calcTax(gross, fy, 'oldRegime', opts);

  const newPayable = Math.max(0, newR.totalTax - tds);
  const oldPayable = Math.max(0, oldR.totalTax - tds);
  const betterRegime = newR.totalTax <= oldR.totalTax ? 'new' : 'old';
  const saving = Math.abs(oldR.totalTax - newR.totalTax);

  // ITR filing requirement check
  const basicExempt = empType === 'salaried' ? 250000 : 250000;
  const mustFileITR = gross > basicExempt || tds > 0;

  const res = document.getElementById('tax-estimator-result');
  if (!res) return;
  res.classList.remove('d-none');

  res.innerHTML = `
    <!-- Recommendation Banner -->
    <div class="tax-recommend-banner tax-recommend-${betterRegime}">
      <div class="tax-recommend-icon">
        <i class="bi bi-${betterRegime === 'new' ? 'lightning-charge-fill' : 'shield-fill-check'}"></i>
      </div>
      <div>
        <div class="tax-recommend-title">
          ${betterRegime === 'new' ? 'New Tax Regime is better for you' : 'Old Tax Regime is better for you'}
        </div>
        <div class="tax-recommend-sub">
          You save ${formatCurrency(saving)} by choosing the ${betterRegime === 'new' ? 'New' : 'Old'} Regime
          ${saving === 0 ? '(Both regimes result in same tax)' : ''}
        </div>
      </div>
    </div>

    <!-- ITR Filing Notice -->
    <div class="alert ${mustFileITR ? 'alert-info' : 'alert-success'} py-2 mt-3 small">
      <i class="bi bi-${mustFileITR ? 'file-earmark-check-fill' : 'check-circle-fill'} me-2"></i>
      ${mustFileITR
        ? `<strong>ITR Filing Required:</strong> Your income exceeds the basic exemption limit. You must file ITR for FY ${fy}.`
        : `<strong>ITR Filing may be optional</strong> if your income is below ₹2.5L and no TDS was deducted.`
      }
    </div>

    <!-- Comparison Table -->
    <div class="table-responsive mt-3">
      <table class="table table-bordered table-sm tax-compare-table">
        <thead class="table-light">
          <tr>
            <th>Particulars</th>
            <th class="text-center ${betterRegime === 'new' ? 'table-success' : ''}">
              New Regime ${betterRegime === 'new' ? '✓ Recommended' : ''}
            </th>
            <th class="text-center ${betterRegime === 'old' ? 'table-success' : ''}">
              Old Regime ${betterRegime === 'old' ? '✓ Recommended' : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Gross Income</td>
            <td class="text-end">${formatCurrency(gross)}</td>
            <td class="text-end">${formatCurrency(gross)}</td>
          </tr>
          <tr>
            <td>Standard Deduction</td>
            <td class="text-end text-success">− ${formatCurrency(newR.stdDed)}</td>
            <td class="text-end text-success">− ${formatCurrency(oldR.stdDed)}</td>
          </tr>
          ${oldR.totalDeductions > 0 ? `
          <tr>
            <td>Other Deductions (80C/80D/HRA)</td>
            <td class="text-end text-muted">Not allowed</td>
            <td class="text-end text-success">− ${formatCurrency(oldR.totalDeductions)}</td>
          </tr>` : ''}
          <tr class="fw-semibold">
            <td>Taxable Income</td>
            <td class="text-end">${formatCurrency(newR.taxableIncome)}</td>
            <td class="text-end">${formatCurrency(oldR.taxableIncome)}</td>
          </tr>
          <tr>
            <td>Income Tax</td>
            <td class="text-end">${formatCurrency(newR.baseTax)}</td>
            <td class="text-end">${formatCurrency(oldR.baseTax)}</td>
          </tr>
          <tr>
            <td>Health & Education Cess (4%)</td>
            <td class="text-end">${formatCurrency(newR.cess)}</td>
            <td class="text-end">${formatCurrency(oldR.cess)}</td>
          </tr>
          ${newR.taxableIncome <= (TAX_CONFIG[fy]?.newRegime?.rebate87A ?? 1200000) ? `
          <tr class="text-success small">
            <td colspan="3"><i class="bi bi-check-circle-fill me-1"></i>87A Rebate applied — Zero tax under New Regime</td>
          </tr>` : ''}
          <tr class="fw-bold table-light">
            <td>Total Tax Payable</td>
            <td class="text-end fs-6 ${betterRegime === 'new' ? 'text-success' : ''}">${formatCurrency(newR.totalTax)}</td>
            <td class="text-end fs-6 ${betterRegime === 'old' ? 'text-success' : ''}">${formatCurrency(oldR.totalTax)}</td>
          </tr>
          ${tds > 0 ? `
          <tr>
            <td>TDS Already Paid</td>
            <td class="text-end text-success">− ${formatCurrency(tds)}</td>
            <td class="text-end text-success">− ${formatCurrency(tds)}</td>
          </tr>
          <tr class="fw-bold">
            <td>${newPayable > 0 || oldPayable > 0 ? 'Balance Tax Payable' : 'Refund Due'}</td>
            <td class="text-end ${newPayable > 0 ? 'text-danger' : 'text-success'}">
              ${newPayable > 0 ? formatCurrency(newPayable) : 'Refund: ' + formatCurrency(tds - newR.totalTax)}
            </td>
            <td class="text-end ${oldPayable > 0 ? 'text-danger' : 'text-success'}">
              ${oldPayable > 0 ? formatCurrency(oldPayable) : 'Refund: ' + formatCurrency(tds - oldR.totalTax)}
            </td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="tax-disclaimer">
      <i class="bi bi-exclamation-triangle-fill me-1"></i>
      This is an <strong>estimate only</strong>. Consult a CA for exact tax liability. Does not account for surcharge, advance tax, or special income.
    </div>
  `;
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

  // Update stat cards
  const el = id => document.getElementById(id);
  if (el('tax-stat-income'))   el('tax-stat-income').textContent   = formatCurrency(totalIncome);
  if (el('tax-stat-expenses')) el('tax-stat-expenses').textContent = formatCurrency(totalExpenses);
  if (el('tax-stat-savings')) {
    el('tax-stat-savings').textContent = formatCurrency(netSavings);
    el('tax-stat-savings').style.color = netSavings >= 0 ? '#10b981' : '#ef4444';
  }
  if (el('tax-stat-rate')) el('tax-stat-rate').textContent = savingsRate + '%';

  // Income by source
  const incomeBySource = {};
  income.forEach(r => {
    const src = r.source || r.description || 'Other';
    incomeBySource[src] = (incomeBySource[src] ?? 0) + r.amount;
  });
  renderBreakdown('tax-income-breakdown', incomeBySource, totalIncome, 'success');

  // Expenses by category
  const expByCategory = {};
  expenses.forEach(r => {
    const cat = r.category || 'Uncategorized';
    expByCategory[cat] = (expByCategory[cat] ?? 0) + r.amount;
  });
  renderBreakdown('tax-expense-breakdown', expByCategory, totalExpenses, 'danger');

  // Monthly summary
  renderMonthly('tax-monthly-breakdown', income, expenses, fy);
}

function renderBreakdown(containerId, data, total, colorClass) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    container.innerHTML = `<div class="text-muted text-center py-3 small">No data for this period</div>`;
    return;
  }

  container.innerHTML = `
    <table class="table table-sm mb-0">
      <thead class="table-light">
        <tr>
          <th>Name</th>
          <th class="text-end">Amount</th>
          <th class="text-end">%</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(([name, amount]) => {
          const pct = total > 0 ? ((amount / total) * 100).toFixed(1) : 0;
          return `<tr>
            <td>${name}</td>
            <td class="text-end text-${colorClass} fw-semibold">${formatCurrency(amount)}</td>
            <td class="text-end text-muted small">${pct}%</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot class="table-light fw-bold">
        <tr>
          <td>Total</td>
          <td class="text-end text-${colorClass}">${formatCurrency(total)}</td>
          <td class="text-end">100%</td>
        </tr>
      </tfoot>
    </table>`;
}

function renderMonthly(containerId, income, expenses, fy) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const startYear = parseInt(fy.split('-')[0]);
  // FY months: Apr(3)…Dec(11), Jan(0)…Mar(2) of next year
  const monthData = MONTHS.map((label, i) => {
    const monthIdx  = i < 9 ? i + 3 : i - 9;         // 3..11, 0..2
    const yearOfMon = i < 9 ? startYear : startYear + 1;

    const inc = income.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === monthIdx && d.getFullYear() === yearOfMon;
    }).reduce((s, r) => s + r.amount, 0);

    const exp = expenses.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === monthIdx && d.getFullYear() === yearOfMon;
    }).reduce((s, r) => s + r.amount, 0);

    return { label, inc, exp, net: inc - exp };
  });

  const hasData = monthData.some(m => m.inc > 0 || m.exp > 0);
  if (!hasData) {
    container.innerHTML = `<div class="text-muted text-center py-3 small">No data for this period</div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm mb-0">
        <thead class="table-light">
          <tr>
            <th>Month</th>
            <th class="text-end">Income</th>
            <th class="text-end">Expenses</th>
            <th class="text-end">Net</th>
          </tr>
        </thead>
        <tbody>
          ${monthData.map(m => `
            <tr class="${m.inc === 0 && m.exp === 0 ? 'text-muted' : ''}">
              <td>${m.label}</td>
              <td class="text-end text-success">${m.inc > 0 ? formatCurrency(m.inc) : '—'}</td>
              <td class="text-end text-danger">${m.exp > 0 ? formatCurrency(m.exp) : '—'}</td>
              <td class="text-end fw-semibold" style="color:${m.net >= 0 ? '#10b981' : '#ef4444'}">
                ${m.inc > 0 || m.exp > 0 ? (m.net >= 0 ? '+' : '') + formatCurrency(m.net) : '—'}
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot class="table-light fw-bold">
          <tr>
            <td>Total</td>
            <td class="text-end text-success">${formatCurrency(monthData.reduce((s, m) => s + m.inc, 0))}</td>
            <td class="text-end text-danger">${formatCurrency(monthData.reduce((s, m) => s + m.exp, 0))}</td>
            <td class="text-end" style="color:${monthData.reduce((s, m) => s + m.net, 0) >= 0 ? '#10b981' : '#ef4444'}">
              ${(monthData.reduce((s, m) => s + m.net, 0) >= 0 ? '+' : '') + formatCurrency(monthData.reduce((s, m) => s + m.net, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>`;
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
  });

  document.getElementById('tax-calculate-btn')?.addEventListener('click', calculateAndRender);

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
