// js/ai-advisor.js — AI Financial Advisor (local analysis, no API key needed)
import * as store from './store.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function el(id) { return document.getElementById(id); }
function pct(v, total) { return total > 0 ? Math.round((v / total) * 100) : 0; }

// ─── Category buckets (50/30/20 rule) ─────────────────────────────────────────

const ESSENTIALS_CATS = ['rent','housing','groceries','grocery','food','vegetables','milk','transport',
  'fuel','petrol','diesel','electricity','water','gas','utilities','healthcare','medical','doctor',
  'medicine','insurance','education','school','fees','emi','loan','ration','internet','phone','mobile'];
const SAVINGS_CATS    = ['savings','investment','mutual fund','sip','fd','ppf','nps','stocks','equity',
  'gold','emergency','recurring deposit'];
// everything else = guilt-free / wants

function classifyCat(cat) {
  const c = (cat ?? '').toLowerCase();
  if (SAVINGS_CATS.some(k => c.includes(k)))    return 'savings';
  if (ESSENTIALS_CATS.some(k => c.includes(k))) return 'essentials';
  return 'wants';
}

// ─── Data collection ──────────────────────────────────────────────────────────

function collectData() {
  const expenses = store.get('expenses') ?? [];
  const income   = store.get('income')   ?? [];
  const loans    = store.get('loans')    ?? [];
  const now      = new Date();

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Income
  const incomeByMonth = {};
  income.forEach(r => {
    const ym = String(r.date ?? '').slice(0, 7);
    if (months.includes(ym)) incomeByMonth[ym] = (incomeByMonth[ym] ?? 0) + (Number(r.amount) || 0);
  });
  const incMonths        = Object.keys(incomeByMonth).length || 1;
  const avgMonthlyIncome = Object.values(incomeByMonth).reduce((s, v) => s + v, 0) / incMonths;

  // Expenses by month + category
  const expByMonth = {};
  const catMap     = {};
  expenses.forEach(r => {
    const ym  = String(r.date ?? '').slice(0, 7);
    const cat = r.category ?? 'Other';
    const amt = Number(r.amount) || 0;
    if (months.includes(ym))       expByMonth[ym]  = (expByMonth[ym]  ?? 0) + amt;
    if (months.slice(-3).includes(ym)) catMap[cat]  = (catMap[cat]     ?? 0) + amt;
  });
  const expMonths          = Object.keys(expByMonth).length || 1;
  const avgMonthlyExpenses = Object.values(expByMonth).reduce((s, v) => s + v, 0) / expMonths;

  const catAvg = {};
  Object.entries(catMap).forEach(([k, v]) => { catAvg[k] = Math.round(v / 3); });

  // Active loans
  const activeLoans = loans.filter(l => l.status === 'active' || !l.status);

  return {
    avgMonthlyIncome:   Math.round(avgMonthlyIncome),
    avgMonthlyExpenses: Math.round(avgMonthlyExpenses),
    surplus:            Math.round(avgMonthlyIncome - avgMonthlyExpenses),
    catAvg,
    activeLoans,
    incMonths,
  };
}

function _calcEMI(principal, ratePerAnnum, tenureMonths) {
  if (!principal || !tenureMonths) return 0;
  if (!ratePerAnnum) return principal / tenureMonths;
  const r = ratePerAnnum / 12 / 100;
  return principal * r * Math.pow(1 + r, tenureMonths) / (Math.pow(1 + r, tenureMonths) - 1);
}

// ─── Advisor card definitions ─────────────────────────────────────────────────

const ADVISORS = [
  { id: 'budget-clarity',  title: 'Budget Clarity Generator',   icon: 'bi-pie-chart-fill',   color: '#6366f1', bg: 'rgba(99,102,241,.1)',  desc: 'Build a realistic 50/30/20 budget from your actual spending data.',        tags: ['income','expenses'] },
  { id: 'spending-leaks',  title: 'Spending Leak Detector',     icon: 'bi-droplet-half',      color: '#ef4444', bg: 'rgba(239,68,68,.1)',   desc: 'Pinpoint your top overspending categories and estimate monthly savings.',  tags: ['expenses'] },
  { id: 'income-expansion',title: 'Income Expansion Ideas',     icon: 'bi-graph-up-arrow',    color: '#10b981', bg: 'rgba(16,185,129,.1)',  desc: '3 realistic, low-effort ways to grow your income based on your data.',     tags: ['income'] },
  { id: 'smart-savings',   title: 'Smart Savings Plan',         icon: 'bi-piggy-bank-fill',   color: '#f59e0b', bg: 'rgba(245,158,11,.1)', desc: 'Calculate your emergency fund target and a month-by-month savings plan.',  tags: ['income','expenses'] },
  { id: 'debt-strategy',   title: 'Debt Reduction Strategist',  icon: 'bi-credit-card-fill',  color: '#8b5cf6', bg: 'rgba(139,92,246,.1)',  desc: 'Avalanche vs Snowball — see which saves more interest for your loans.',    tags: ['loans'] },
  { id: 'zero-budget',     title: 'Zero-Based Budget Creator',  icon: 'bi-calculator-fill',   color: '#14b8a6', bg: 'rgba(20,184,166,.1)', desc: 'Assign every rupee a job until Income − All Allocations = ₹0.',           tags: ['income','expenses'] },
  { id: 'mindset-reset',   title: 'Money Mindset Reset',        icon: 'bi-sun-fill',          color: '#f97316', bg: 'rgba(249,115,22,.1)', desc: 'A 7-day daily money ritual and mindset reframes to build financial clarity.', tags: ['behavioral'] },
];

// ─── Local analysis generators ────────────────────────────────────────────────

function genBudgetClarity(d) {
  const inc  = d.avgMonthlyIncome;
  if (!inc) return `<div class="adv-empty-state"><i class="bi bi-info-circle"></i> No income data found. Add income entries to generate this plan.</div>`;

  const rec50 = Math.round(inc * 0.50);
  const rec30 = Math.round(inc * 0.30);
  const rec20 = Math.round(inc * 0.20);

  const buckets = { essentials: 0, wants: 0, savings: 0 };
  const byBucket = { essentials: [], wants: [], savings: [] };
  Object.entries(d.catAvg).forEach(([cat, amt]) => {
    const b = classifyCat(cat);
    buckets[b] += amt;
    byBucket[b].push({ cat, amt });
  });

  const totalExp = Object.values(buckets).reduce((s, v) => s + v, 0);
  const doing    = buckets.savings >= rec20 ? 'You\'re saving at or above the recommended 20% — great discipline!' :
                   buckets.essentials <= rec50 ? 'Your essential spending is within the 50% guideline.' :
                   'You have a positive monthly surplus to work with.';
  const improve  = buckets.wants > rec30
    ? `Your "wants" spending (${fmt(buckets.wants)}) exceeds the recommended ${fmt(rec30)} (30%). Consider trimming ${fmt(buckets.wants - rec30)}/month.`
    : buckets.savings < rec20
    ? `Your savings (${fmt(buckets.savings)}) are below the recommended ${fmt(rec20)} (20%). Aim to redirect ${fmt(rec20 - buckets.savings)}/month.`
    : `Your essentials (${fmt(buckets.essentials)}) are above the 50% target (${fmt(rec50)}). Look for areas to reduce fixed costs.`;

  const row = (label, actual, recommended, color) => `
    <tr>
      <td><span class="adv-badge" style="background:${color}20;color:${color}">${label}</span></td>
      <td class="text-end fw-bold">${fmt(actual)}</td>
      <td class="text-end text-muted">${fmt(recommended)}</td>
      <td class="text-end">${pct(actual, inc)}% <small class="text-muted">/ ${label==='Essentials'?'50':label==='Wants'?'30':'20'}%</small></td>
      <td class="text-end">${actual <= recommended ? '<span class="adv-pill adv-pill--ok">On Track</span>' : '<span class="adv-pill adv-pill--warn">Over</span>'}</td>
    </tr>`;

  const catRows = (arr) => arr.sort((a,b)=>b.amt-a.amt).map(({cat,amt}) =>
    `<div class="adv-li"><i class="bi bi-dash adv-li-icon"></i><span>${esc(cat)} — ${fmt(amt)}/mo</span></div>`).join('');

  return `
    <h5 class="adv-h5"><i class="bi bi-pie-chart-fill me-2" style="color:#6366f1"></i>Your 50/30/20 Budget Breakdown</h5>
    <p class="adv-p text-muted">Based on avg monthly income of <strong>${fmt(inc)}</strong> over ${d.incMonths} month(s).</p>
    <div class="table-responsive mb-3">
      <table class="table table-sm adv-table">
        <thead><tr><th>Category</th><th class="text-end">Your Actual</th><th class="text-end">Recommended</th><th class="text-end">% of Income</th><th class="text-end">Status</th></tr></thead>
        <tbody>
          ${row('Essentials', buckets.essentials, rec50, '#6366f1')}
          ${row('Wants',      buckets.wants,      rec30, '#f59e0b')}
          ${row('Savings',    buckets.savings,    rec20, '#10b981')}
          <tr class="adv-table-total"><td colspan="2"><strong>Total Tracked</strong></td><td class="text-end" colspan="3"><strong>${fmt(totalExp)}</strong> of ${fmt(inc)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="adv-two-col">
      <div class="adv-section-box adv-section-box--blue">
        <div class="adv-section-label"><i class="bi bi-house-fill me-1"></i>Essentials (${fmt(buckets.essentials)})</div>
        ${byBucket.essentials.length ? catRows(byBucket.essentials) : '<div class="text-muted" style="font-size:.78rem">None categorized</div>'}
      </div>
      <div class="adv-section-box adv-section-box--amber">
        <div class="adv-section-label"><i class="bi bi-emoji-smile-fill me-1"></i>Wants (${fmt(buckets.wants)})</div>
        ${byBucket.wants.length ? catRows(byBucket.wants) : '<div class="text-muted" style="font-size:.78rem">None categorized</div>'}
      </div>
    </div>
    <hr class="adv-hr">
    <div class="adv-insight-row">
      <div class="adv-insight adv-insight--green"><i class="bi bi-check-circle-fill"></i> <strong>Doing well:</strong> ${doing}</div>
      <div class="adv-insight adv-insight--amber"><i class="bi bi-exclamation-circle-fill"></i> <strong>Improve now:</strong> ${improve}</div>
    </div>`;
}

function genSpendingLeaks(d) {
  const cats = Object.entries(d.catAvg).sort((a, b) => b[1] - a[1]);
  if (!cats.length) return `<div class="adv-empty-state"><i class="bi bi-info-circle"></i> No expense data found for the last 3 months.</div>`;

  const totalExp = cats.reduce((s, [, v]) => s + v, 0);
  const inc      = d.avgMonthlyIncome || totalExp;

  // Top leak categories = wants only, sorted by amount
  const leaks = cats.filter(([cat]) => classifyCat(cat) === 'wants').slice(0, 5);
  const savingsPotential = leaks.slice(0, 3).reduce((s, [,v]) => s + Math.round(v * 0.3), 0);

  const leakRows = leaks.map(([cat, amt], i) => {
    const pctInc = pct(amt, inc);
    const benchmark = 5;
    const isHigh = pctInc > benchmark;
    const save   = Math.round(amt * 0.25);
    return `
      <div class="adv-leak-row">
        <div class="adv-leak-rank">#${i + 1}</div>
        <div class="adv-leak-body">
          <div class="adv-leak-name">${esc(cat)}</div>
          <div class="adv-leak-bar-wrap"><div class="adv-leak-bar" style="width:${Math.min(pctInc*4,100)}%;background:${isHigh?'#ef4444':'#f59e0b'}"></div></div>
        </div>
        <div class="adv-leak-right">
          <div class="adv-leak-amt">${fmt(amt)}<small>/mo</small></div>
          <div class="adv-leak-save">${isHigh ? `Save ~${fmt(save)} (cut 25%)` : 'Looks reasonable'}</div>
        </div>
      </div>`;
  }).join('');

  const quickWin = leaks[0] ? `Cut your <strong>${esc(leaks[0][0])}</strong> spending by 25% this month — that's <strong>${fmt(Math.round(leaks[0][1] * 0.25))}</strong> saved with one decision.` : 'Review your top expense category and set a monthly cap.';

  return `
    <h5 class="adv-h5"><i class="bi bi-droplet-half me-2" style="color:#ef4444"></i>Your Spending Leaks</h5>
    <p class="adv-p text-muted">Analyzing ${fmt(totalExp)}/month across ${cats.length} categories · Last 3 months average.</p>
    <div class="adv-leak-list">${leakRows || '<p class="text-muted">No "wants" spending detected.</p>'}</div>
    <hr class="adv-hr">
    <div class="adv-insight adv-insight--amber mb-2"><i class="bi bi-lightning-fill"></i> <strong>Quick Win this week:</strong> ${quickWin}</div>
    <div class="adv-insight adv-insight--green"><i class="bi bi-piggy-bank-fill"></i> <strong>Monthly savings potential</strong> if you reduce top 3 leaks by 25%: <strong>${fmt(savingsPotential)}/month</strong> — that's <strong>${fmt(savingsPotential * 12)}/year</strong>.</div>
    <hr class="adv-hr">
    <div class="adv-all-cats">
      <div class="adv-section-label mb-2">All spending categories</div>
      ${cats.map(([cat, amt]) => `
        <div class="adv-cat-row">
          <span class="adv-cat-name">${esc(cat)}</span>
          <div class="adv-cat-bar-wrap"><div class="adv-cat-bar" style="width:${Math.min(pct(amt,totalExp)*2,100)}%;background:${classifyCat(cat)==='wants'?'#ef4444':classifyCat(cat)==='savings'?'#10b981':'#6366f1'}"></div></div>
          <span class="adv-cat-amt">${fmt(amt)}</span>
          <span class="adv-cat-pct">${pct(amt, inc)}%</span>
        </div>`).join('')}
    </div>`;
}

function genIncomeExpansion(d) {
  const inc = d.avgMonthlyIncome;
  const ideas = [
    { title: 'Freelance on Fiverr / Upwork', icon: 'bi-laptop', how: 'Sign up at fiverr.com → create a gig based on your skill (writing, design, data entry, social media). First step: complete your profile today.', time: '5–10 hrs/week', potential: Math.round(inc * 0.15), platform: 'Fiverr, Upwork (free to join)' },
    { title: 'Online Tutoring / Teaching', icon: 'bi-book', how: 'Register on Vedantu, UrbanPro, or Superprof. Teach school subjects, spoken English, or any skill you know. First step: list yourself on UrbanPro today.', time: '4–8 hrs/week', potential: Math.round(inc * 0.12), platform: 'Vedantu, UrbanPro, Superprof' },
    { title: 'Sell Digital Products', icon: 'bi-cloud-arrow-up', how: 'Create templates, notes, planners, or e-books and sell on Instamojo or Gumroad. First step: identify one skill others ask you about — package it.', time: '2–4 hrs/week (after setup)', potential: Math.round(inc * 0.10), platform: 'Instamojo, Gumroad (free)' },
  ];

  return `
    <h5 class="adv-h5"><i class="bi bi-graph-up-arrow me-2" style="color:#10b981"></i>3 Ways to Expand Your Income</h5>
    <p class="adv-p text-muted">Based on your average monthly income of <strong>${fmt(inc)}</strong>. These are flexible, home-based opportunities.</p>
    ${ideas.map((idea, i) => `
      <div class="adv-idea-card">
        <div class="adv-idea-header">
          <div class="adv-idea-num">${i + 1}</div>
          <div class="adv-idea-icon"><i class="bi ${idea.icon}"></i></div>
          <div class="adv-idea-title">${idea.title}</div>
          <div class="adv-idea-potential">${fmt(idea.potential)}+/mo potential</div>
        </div>
        <div class="adv-idea-body">
          <div class="adv-idea-row"><i class="bi bi-arrow-right-circle-fill" style="color:#10b981"></i><span><strong>First step:</strong> ${idea.how}</span></div>
          <div class="adv-idea-row"><i class="bi bi-clock-fill" style="color:#6366f1"></i><span><strong>Time needed:</strong> ${idea.time}</span></div>
          <div class="adv-idea-row"><i class="bi bi-tools" style="color:#f59e0b"></i><span><strong>Platforms:</strong> ${idea.platform}</span></div>
        </div>
      </div>`).join('')}
    <div class="adv-insight adv-insight--green mt-2"><i class="bi bi-calculator-fill"></i> If all 3 work out, your income could grow by <strong>${fmt(ideas.reduce((s,i)=>s+i.potential,0))}/month</strong> — a <strong>${pct(ideas.reduce((s,i)=>s+i.potential,0), inc)}% increase</strong>.</div>`;
}

function genSmartSavings(d) {
  const inc     = d.avgMonthlyIncome;
  const exp     = d.avgMonthlyExpenses;
  const surplus = d.surplus;
  if (!inc) return `<div class="adv-empty-state"><i class="bi bi-info-circle"></i> No income data found.</div>`;

  const efTarget3 = exp * 3;
  const efTarget6 = exp * 6;
  const saveable  = Math.max(Math.round(surplus * 0.5), 0);
  const months3   = saveable > 0 ? Math.ceil(efTarget3 / saveable) : '∞';
  const months6   = saveable > 0 ? Math.ceil(efTarget6 / saveable) : '∞';

  const milestones = [];
  let running = 0;
  for (let m = 1; m <= 6; m++) {
    running += saveable;
    const pctDone = pct(Math.min(running, efTarget3), efTarget3);
    milestones.push({ m, running, pctDone });
  }

  return `
    <h5 class="adv-h5"><i class="bi bi-piggy-bank-fill me-2" style="color:#f59e0b"></i>Your Emergency Fund Plan</h5>
    <div class="adv-stats-row">
      <div class="adv-stat"><div class="adv-stat-val" style="color:#10b981">${fmt(surplus)}</div><div class="adv-stat-label">Monthly Surplus</div></div>
      <div class="adv-stat"><div class="adv-stat-val" style="color:#f59e0b">${fmt(saveable)}</div><div class="adv-stat-label">Recommended Save/mo (50% of surplus)</div></div>
      <div class="adv-stat"><div class="adv-stat-val" style="color:#6366f1">${fmt(efTarget3)}</div><div class="adv-stat-label">3-Month Emergency Fund Target</div></div>
      <div class="adv-stat"><div class="adv-stat-val" style="color:#8b5cf6">${fmt(efTarget6)}</div><div class="adv-stat-label">6-Month Target (ideal)</div></div>
    </div>
    <hr class="adv-hr">
    <div class="adv-section-label mb-2">📅 Month-by-Month Progress (3-Month Goal)</div>
    ${milestones.map(({m, running, pctDone}) => `
      <div class="adv-month-row">
        <div class="adv-month-label">Month ${m}</div>
        <div class="adv-month-bar-wrap"><div class="adv-month-bar" style="width:${pctDone}%;background:${pctDone>=100?'#10b981':'#f59e0b'}"></div></div>
        <div class="adv-month-val">${fmt(Math.min(running, efTarget3))} <small class="text-muted">(${pctDone}%)</small></div>
      </div>`).join('')}
    <hr class="adv-hr">
    <div class="adv-insight adv-insight--blue mb-2"><i class="bi bi-bank2"></i> <strong>Where to keep it:</strong> Open a separate savings account or liquid mutual fund (e.g., Paytm Money, Groww). Keep it separate from your main account so you're not tempted to spend it.</div>
    ${surplus < 0 ? `<div class="adv-insight adv-insight--red"><i class="bi bi-exclamation-triangle-fill"></i> <strong>You have a deficit of ${fmt(Math.abs(surplus))}/month.</strong> Focus on reducing expenses first before building the emergency fund.</div>` : `<div class="adv-insight adv-insight--green"><i class="bi bi-calendar-check"></i> At ${fmt(saveable)}/month, you'll reach your 3-month fund in <strong>${months3} months</strong> and full 6-month fund in <strong>${months6} months</strong>.</div>`}`;
}

function genDebtStrategy(d) {
  const loans = d.activeLoans;
  if (!loans.length) return `<div class="adv-empty-state"><i class="bi bi-check-circle-fill" style="color:#10b981"></i> No active loans found. You're debt-free!</div>`;

  const withEMI = loans.map(l => ({
    ...l,
    emi: Math.round(_calcEMI(l.principal, l.interestRate, l.tenureMonths)),
  }));

  const avalanche = [...withEMI].sort((a, b) => b.interestRate - a.interestRate);
  const snowball  = [...withEMI].sort((a, b) => a.principal - b.principal);

  const totalDebt    = loans.reduce((s, l) => s + l.principal, 0);
  const totalEMI     = withEMI.reduce((s, l) => s + l.emi, 0);
  const maxRate      = Math.max(...loans.map(l => l.interestRate));
  const rateSpread   = maxRate - Math.min(...loans.map(l => l.interestRate));
  const useAvalanche = rateSpread >= 3 || maxRate >= 15;

  const recommended  = useAvalanche ? avalanche : snowball;
  const method       = useAvalanche ? 'Debt Avalanche' : 'Debt Snowball';
  const reason       = useAvalanche
    ? `Your highest interest rate is <strong>${maxRate}%</strong> — a ${rateSpread.toFixed(1)}% spread across loans. Avalanche saves the most interest by attacking high-rate debt first.`
    : `Your loan amounts are varied but interest rates are similar. Snowball keeps you motivated by clearing smaller debts quickly.`;

  const loanRows = recommended.map((l, i) => `
    <div class="adv-debt-row">
      <div class="adv-debt-rank">${i + 1}</div>
      <div class="adv-debt-body">
        <div class="adv-debt-name">${esc(l.name || l.type || 'Loan')}</div>
        <div class="adv-debt-meta">${l.interestRate}% p.a. · ${l.tenureMonths} months</div>
      </div>
      <div class="adv-debt-right">
        <div class="adv-debt-principal">${fmt(l.principal)}</div>
        <div class="adv-debt-emi">EMI ${fmt(l.emi)}/mo</div>
      </div>
    </div>`).join('');

  return `
    <h5 class="adv-h5"><i class="bi bi-credit-card-fill me-2" style="color:#8b5cf6"></i>Debt Reduction Strategy</h5>
    <div class="adv-stats-row">
      <div class="adv-stat"><div class="adv-stat-val" style="color:#ef4444">${fmt(totalDebt)}</div><div class="adv-stat-label">Total Debt</div></div>
      <div class="adv-stat"><div class="adv-stat-val" style="color:#8b5cf6">${fmt(totalEMI)}</div><div class="adv-stat-label">Total EMI/month</div></div>
      <div class="adv-stat"><div class="adv-stat-val" style="color:#f59e0b">${loans.length}</div><div class="adv-stat-label">Active Loans</div></div>
    </div>
    <div class="adv-method-badge" style="border-color:#8b5cf6;background:rgba(139,92,246,.08)">
      <div class="adv-method-title">Recommended: <strong>${method}</strong></div>
      <div class="adv-method-reason">${reason}</div>
    </div>
    <div class="adv-section-label mb-2">Pay off in this order:</div>
    <div class="adv-debt-list">${loanRows}</div>
    <hr class="adv-hr">
    <div class="adv-insight adv-insight--purple"><i class="bi bi-stars"></i> <strong>Mindset tip:</strong> Each time you clear a loan, redirect its EMI amount to the next debt. This "snowball of momentum" accelerates your path to debt freedom.</div>`;
}

function genZeroBudget(d) {
  const inc = d.avgMonthlyIncome;
  if (!inc) return `<div class="adv-empty-state"><i class="bi bi-info-circle"></i> No income data found. Add income entries to generate this plan.</div>`;

  const cats     = Object.entries(d.catAvg).sort((a, b) => b[1] - a[1]);
  const totalExp = cats.reduce((s, [, v]) => s + v, 0);
  const surplus  = inc - totalExp;
  const savingsAlloc  = Math.round(inc * 0.20);
  const emergencyAlloc = Math.round(inc * 0.05);
  const investAlloc   = Math.round(inc * 0.10);
  const debtAlloc     = d.activeLoans.reduce((s, l) => s + Math.round(_calcEMI(l.principal, l.interestRate, l.tenureMonths)), 0);
  const assignedFixed = savingsAlloc + emergencyAlloc + investAlloc + debtAlloc;
  const remainForExp  = inc - assignedFixed;
  let   allocated     = 0;

  const expRows = cats.map(([cat, amt]) => {
    const adjusted = Math.min(amt, Math.round(remainForExp * (amt / Math.max(totalExp, 1))));
    allocated += adjusted;
    return `<tr><td>${esc(cat)}</td><td class="text-end">${fmt(amt)}</td><td class="text-end">${fmt(adjusted)}</td><td>${adjusted < amt ? `<span class="adv-pill adv-pill--warn">−${fmt(amt - adjusted)}</span>` : '<span class="adv-pill adv-pill--ok">Keep</span>'}</td></tr>`;
  }).join('');

  const remainder = inc - allocated - assignedFixed;

  return `
    <h5 class="adv-h5"><i class="bi bi-calculator-fill me-2" style="color:#14b8a6"></i>Zero-Based Budget</h5>
    <p class="adv-p text-muted">Every rupee of <strong>${fmt(inc)}</strong> is assigned a job. Income − All Allocations = ₹0.</p>
    <div class="adv-section-label mb-2">💼 Fixed Allocations First</div>
    <div class="table-responsive mb-3">
      <table class="table table-sm adv-table">
        <thead><tr><th>Job</th><th class="text-end">Amount</th><th class="text-end">% of Income</th></tr></thead>
        <tbody>
          <tr><td><span class="adv-badge" style="background:#d1fae5;color:#065f46">Emergency Fund</span></td><td class="text-end">${fmt(emergencyAlloc)}</td><td class="text-end">${pct(emergencyAlloc,inc)}%</td></tr>
          <tr><td><span class="adv-badge" style="background:#dbeafe;color:#1e40af">Investments / SIP</span></td><td class="text-end">${fmt(investAlloc)}</td><td class="text-end">${pct(investAlloc,inc)}%</td></tr>
          <tr><td><span class="adv-badge" style="background:#ede9fe;color:#5b21b6">Savings Goal</span></td><td class="text-end">${fmt(savingsAlloc)}</td><td class="text-end">${pct(savingsAlloc,inc)}%</td></tr>
          ${debtAlloc > 0 ? `<tr><td><span class="adv-badge" style="background:#fee2e2;color:#991b1b">Loan EMIs</span></td><td class="text-end">${fmt(debtAlloc)}</td><td class="text-end">${pct(debtAlloc,inc)}%</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    <div class="adv-section-label mb-2">🛒 Spending Allocations (${fmt(remainForExp)} remaining)</div>
    <div class="table-responsive mb-3">
      <table class="table table-sm adv-table">
        <thead><tr><th>Category</th><th class="text-end">Current</th><th class="text-end">Budget</th><th>Action</th></tr></thead>
        <tbody>${expRows}</tbody>
      </table>
    </div>
    <div class="adv-insight ${remainder === 0 ? 'adv-insight--green' : 'adv-insight--amber'}">
      <i class="bi bi-${remainder === 0 ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i>
      <strong>Balance: ${fmt(inc)} − ${fmt(inc - remainder)} = ${fmt(remainder)}</strong>
      ${remainder > 0 ? ` — assign this ${fmt(remainder)} to savings or investments to reach true zero.` : ' — perfectly balanced!'}
    </div>`;
}

function genMindsetReset() {
  const days = [
    { day: 'Mon', action: 'Write down your #1 financial goal and post it somewhere visible. Be specific: amount + deadline.' },
    { day: 'Tue', action: 'Review last week\'s spending. No judgment — just observe. Note one pattern.' },
    { day: 'Wed', action: 'List 3 things money allows you to do that you\'re grateful for.' },
    { day: 'Thu', action: 'Identify one "money fear" you have. Write it down, then write the opposite belief.' },
    { day: 'Fri', action: 'Transfer a fixed amount to your savings account — even ₹100 counts as a win.' },
    { day: 'Sat', action: 'Do one free or low-cost activity you enjoy. Prove that fun ≠ spending.' },
    { day: 'Sun', action: 'Set next week\'s spending intention. Review budget vs actuals. Celebrate any wins.' },
  ];

  const reframes = [
    { old: '"I can\'t afford it."', better: '"How can I afford it? What would I need to change?"' },
    { old: '"Money is stressful."', better: '"Money is a tool. I am learning to use it wisely."' },
    { old: '"I\'ll save when I earn more."', better: '"I save now, at every income level — that\'s how wealth is built."' },
  ];

  const challenge = [
    { week: 1, focus: 'Awareness', task: 'Track every expense manually every day — no app, pen & paper only.' },
    { week: 2, focus: 'Reduction', task: 'Eliminate one "leak" category for the full week. No dining out / no impulse shopping.' },
    { week: 3, focus: 'Income',    task: 'Do one thing to earn extra money — sell something, do a gig, offer a service.' },
    { week: 4, focus: 'Momentum', task: 'Automate a recurring savings transfer. Celebrate your progress — you built a habit.' },
  ];

  return `
    <h5 class="adv-h5"><i class="bi bi-sun-fill me-2" style="color:#f97316"></i>7-Day Money Mindset Reset</h5>
    <div class="adv-week-grid">
      ${days.map(({day, action}) => `
        <div class="adv-day-card">
          <div class="adv-day-label">${day}</div>
          <div class="adv-day-action">${action}</div>
        </div>`).join('')}
    </div>
    <hr class="adv-hr">
    <div class="adv-section-label mb-2">🔄 Mindset Reframes</div>
    ${reframes.map(r => `
      <div class="adv-reframe-row">
        <div class="adv-reframe-old"><i class="bi bi-x-circle-fill text-danger me-1"></i>${r.old}</div>
        <div class="adv-reframe-arrow"><i class="bi bi-arrow-down"></i></div>
        <div class="adv-reframe-new"><i class="bi bi-check-circle-fill text-success me-1"></i>${r.better}</div>
      </div>`).join('')}
    <hr class="adv-hr">
    <div class="adv-section-label mb-2">📅 30-Day Challenge</div>
    ${challenge.map(({week, focus, task}) => `
      <div class="adv-challenge-row">
        <div class="adv-challenge-week">Week ${week}<br><small>${focus}</small></div>
        <div class="adv-challenge-task">${task}</div>
      </div>`).join('')}
    <hr class="adv-hr">
    <div class="adv-insight adv-insight--amber"><i class="bi bi-journal-text"></i> <strong>Journal prompt for today:</strong> "What does financial freedom look like for me in 3 years? What is one belief I need to let go of to get there?"</div>`;
}

const GENERATORS = {
  'budget-clarity':   genBudgetClarity,
  'spending-leaks':   genSpendingLeaks,
  'income-expansion': genIncomeExpansion,
  'smart-savings':    genSmartSavings,
  'debt-strategy':    genDebtStrategy,
  'zero-budget':      genZeroBudget,
  'mindset-reset':    (_d) => genMindsetReset(),
};

// ─── Result modal ─────────────────────────────────────────────────────────────

function _ensureModal() {
  if (document.getElementById('adv-result-modal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div class="modal fade" id="adv-result-modal" tabindex="-1" aria-labelledby="adv-result-modal-title" aria-hidden="true">
    <div class="modal-dialog modal-xl modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header adv-modal-header">
          <div class="adv-modal-title-wrap">
            <span class="adv-modal-icon" id="adv-modal-icon"></span>
            <div>
              <h5 class="modal-title" id="adv-result-modal-title"></h5>
              <small class="adv-modal-sub" id="adv-modal-sub"></small>
            </div>
          </div>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body adv-modal-body" id="adv-modal-body">
          <div id="adv-result-content" class="adv-result-content"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
}

function openAdvisor(advisorId) {
  const advisor = ADVISORS.find(a => a.id === advisorId);
  if (!advisor) return;
  _ensureModal();

  const modal     = bootstrap.Modal.getOrCreateInstance(document.getElementById('adv-result-modal'));
  const titleEl   = el('adv-result-modal-title');
  const iconEl    = el('adv-modal-icon');
  const subEl     = el('adv-modal-sub');
  const contentEl = el('adv-result-content');

  if (titleEl) titleEl.textContent = advisor.title;
  if (iconEl)  iconEl.innerHTML    = `<i class="bi ${advisor.icon}" style="color:${advisor.color}"></i>`;
  if (subEl)   subEl.textContent   = 'Generated from your real financial data · No AI required';

  const data = collectData();
  const html = GENERATORS[advisorId]?.(data) ?? '<div class="adv-empty-state">Plan not available.</div>';
  if (contentEl) contentEl.innerHTML = html;

  modal.show();
}

// ─── Render cards grid ────────────────────────────────────────────────────────

function renderGrid() {
  const grid = el('advisor-grid');
  if (!grid) return;
  grid.innerHTML = ADVISORS.map(a => `
    <div class="adv-card">
      <div class="adv-card-icon-wrap" style="background:${a.bg}">
        <i class="bi ${a.icon}" style="color:${a.color}"></i>
      </div>
      <div class="adv-card-body">
        <div class="adv-card-title">${esc(a.title)}</div>
        <div class="adv-card-desc">${esc(a.desc)}</div>
        <div class="adv-card-tags">${a.tags.map(t => `<span class="adv-tag adv-tag--${t}">${t}</span>`).join('')}</div>
      </div>
      <button class="adv-generate-btn" data-adv-id="${a.id}" style="--adv-color:${a.color}">
        <i class="bi bi-bar-chart-fill me-1"></i>Analyse Now
      </button>
    </div>`).join('');
  grid.querySelectorAll('.adv-generate-btn').forEach(btn => {
    btn.addEventListener('click', () => openAdvisor(btn.dataset.advId));
  });
}

// ─── Snapshot strip ───────────────────────────────────────────────────────────

function updateSnapshot() {
  const d = collectData();
  const incEl     = el('adv-snap-income');
  const expEl     = el('adv-snap-expenses');
  const loansEl   = el('adv-snap-loans');
  const surplusEl = el('adv-snap-surplus');
  if (incEl)     incEl.textContent   = fmt(d.avgMonthlyIncome);
  if (expEl)     expEl.textContent   = fmt(d.avgMonthlyExpenses);
  if (loansEl)   loansEl.textContent = `${d.activeLoans.length} active`;
  if (surplusEl) {
    surplusEl.textContent = fmt(Math.abs(d.surplus));
    surplusEl.style.color = d.surplus >= 0 ? '#10b981' : '#ef4444';
  }
}

// ─── Init / Render ────────────────────────────────────────────────────────────

let _ready = false;

export function init() {
  if (_ready) return;
  _ready = true;
}

export function render() {
  const mainEl = el('advisor-main');
  if (mainEl) mainEl.classList.remove('d-none');
  updateSnapshot();
  renderGrid();
}
