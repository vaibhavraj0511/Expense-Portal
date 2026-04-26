// js/insights.js — AI Insights computation engine (pure functions, no DOM)

const FIXED_PATTERNS = [
  'rent', 'mortgage', 'emi', 'loan', 'insurance',
  'utilities', 'electricity', 'water', 'internet',
  'subscription', 'tax',
  'investment', 'invest', 'sip', 'mutual fund', 'stocks', 'equity',
  'fd', 'fixed deposit', 'ppf', 'nps', 'provident',
];

const TREND_THRESHOLD = 100;
const ANOMALY_Z_THRESHOLD = 2.0;
const MIN_RECORDS = 0;   // always show dashboard
const MIN_MONTHS = 0;    // always show dashboard
const MIN_TREND_MONTHS = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getYYYYMM(dateStr) {
  return String(dateStr ?? '').slice(0, 7);
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getNMonthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Public: Monthly Aggregation ─────────────────────────────────────────────

export function buildMonthlyAggregates(expenses) {
  // Returns Map<category, Map<YYYY-MM, number>>
  const agg = new Map();
  for (const e of expenses) {
    const cat = e.category ?? 'Other';
    const month = getYYYYMM(e.date);
    if (!month) continue;
    if (!agg.has(cat)) agg.set(cat, new Map());
    const catMap = agg.get(cat);
    catMap.set(month, (catMap.get(month) ?? 0) + (Number(e.amount) || 0));
  }
  // Sort each category's months
  for (const [, catMap] of agg) {
    const sorted = new Map([...catMap.entries()].sort());
    agg.set([...agg.entries()].find(([, v]) => v === catMap)[0], sorted);
  }
  return agg;
}

// ─── Public: Linear Regression ───────────────────────────────────────────────

export function computeTrendSlope(monthlyValues) {
  const n = monthlyValues.length;
  if (n < MIN_TREND_MONTHS) return NaN;
  const xMean = (n - 1) / 2;
  const yMean = monthlyValues.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (monthlyValues[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function computeRegressionForecast(monthlyValues) {
  const n = monthlyValues.length;
  if (n < MIN_TREND_MONTHS) return NaN;
  const slope = computeTrendSlope(monthlyValues);
  const xMean = (n - 1) / 2;
  const yMean = monthlyValues.reduce((a, b) => a + b, 0) / n;
  const intercept = yMean - slope * xMean;
  return Math.max(0, intercept + slope * n);
}

// ─── Public: Weighted Moving Average ─────────────────────────────────────────

export function computeWMAForecast(monthlyValues) {
  const vals = monthlyValues.slice(-3);
  if (vals.length === 0) return 0;
  if (vals.length === 1) return vals[0];
  if (vals.length === 2) return (vals[0] + 2 * vals[1]) / 3;
  return Math.max(0, (vals[0] + 2 * vals[1] + 3 * vals[2]) / 6);
}

// ─── Public: Trend Classification ────────────────────────────────────────────

export function classifyTrend(slope) {
  if (isNaN(slope)) return 'Stable';
  if (slope > TREND_THRESHOLD) return 'Increasing';
  if (slope < -TREND_THRESHOLD) return 'Decreasing';
  return 'Stable';
}

// ─── Public: Z-Score ─────────────────────────────────────────────────────────

export function computeZScores(values) {
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return values.map(v => (v - mean) / stddev);
}

// ─── Public: Anomaly Detection ───────────────────────────────────────────────

export function detectAnomalies(expenses, aggregates) {
  const anomalies = [];

  // Per-expense z-score within category
  const byCategory = new Map();
  for (const e of expenses) {
    const cat = e.category ?? 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(e);
  }

  for (const [cat, records] of byCategory) {
    const amounts = records.map(r => Number(r.amount) || 0);
    const zs = computeZScores(amounts);
    if (!zs) continue;
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const stddev = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
    for (let i = 0; i < records.length; i++) {
      if (zs[i] > ANOMALY_Z_THRESHOLD) {
        anomalies.push({
          type: 'expense',
          category: cat,
          label: records[i].description || records[i].date || cat,
          amount: amounts[i],
          zScore: zs[i],
          mean,
          stddev,
        });
      }
    }
  }

  // Per-month z-score per category
  for (const [cat, catMap] of aggregates) {
    const months = [...catMap.keys()].sort();
    const values = months.map(m => catMap.get(m));
    const zs = computeZScores(values);
    if (!zs) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stddev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    for (let i = 0; i < months.length; i++) {
      if (zs[i] > ANOMALY_Z_THRESHOLD) {
        anomalies.push({
          type: 'monthly',
          category: cat,
          label: months[i],
          amount: values[i],
          zScore: zs[i],
          mean,
          stddev,
        });
      }
    }
  }

  return anomalies.sort((a, b) => b.zScore - a.zScore);
}

// ─── Public: Category Classification ─────────────────────────────────────────

export function classifyCategory(name) {
  const lower = String(name ?? '').toLowerCase();
  return FIXED_PATTERNS.some(p => lower.includes(p)) ? 'Fixed' : 'Discretionary';
}

// ─── Public: Month-over-Month ─────────────────────────────────────────────────

export function computeMoM(expenses) {
  const cur = getCurrentMonth();
  const prev = getPreviousMonth();

  let currentTotal = 0, previousTotal = 0;
  const byCat = new Map();

  for (const e of expenses) {
    const m = getYYYYMM(e.date);
    const amt = Number(e.amount) || 0;
    const cat = e.category ?? 'Other';

    if (m === cur) currentTotal += amt;
    if (m === prev) previousTotal += amt;

    if (m === cur || m === prev) {
      if (!byCat.has(cat)) byCat.set(cat, { current: 0, previous: 0 });
      const c = byCat.get(cat);
      if (m === cur) c.current += amt;
      if (m === prev) c.previous += amt;
    }
  }

  const absoluteDiff = currentTotal - previousTotal;
  const percentChange = previousTotal === 0 ? null : (absoluteDiff / previousTotal) * 100;
  const direction = percentChange === null ? null : percentChange > 0 ? 'up' : percentChange < 0 ? 'down' : 'flat';

  const byCategory = new Map();
  for (const [cat, vals] of byCat) {
    const diff = vals.current - vals.previous;
    const pct = vals.previous === 0 ? null : (diff / vals.previous) * 100;
    byCategory.set(cat, { ...vals, diff, pct });
  }

  return { currentTotal, previousTotal, absoluteDiff, percentChange, direction, byCategory };
}

// ─── Public: Savings Rate ─────────────────────────────────────────────────────

export function computeSavingsRate(expenses, income, months = 3) {
  const cutoff = getNMonthsAgo(months);
  const totalIncome = income
    .filter(r => getYYYYMM(r.date) >= cutoff)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalExpenses = expenses
    .filter(r => getYYYYMM(r.date) >= cutoff)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (totalIncome === 0) return 0;
  return Math.max(0, Math.min(100, ((totalIncome - totalExpenses) / totalIncome) * 100));
}

// ─── Public: Budget Recommendations ──────────────────────────────────────────

export function computeBudgetRecommendations(aggregates, savingsRate, budgets, classifications) {
  const recs = [];
  const budgetMap = new Map(budgets.map(b => [b.category, Number(b.monthlyLimit) || 0]));

  for (const [cat, catMap] of aggregates) {
    const months = [...catMap.keys()].sort().slice(-3);
    if (months.length === 0) continue;
    const avg = months.reduce((s, m) => s + catMap.get(m), 0) / months.length;
    if (avg === 0) continue;

    const isDiscretionary = (classifications.get(cat) ?? 'Discretionary') === 'Discretionary';
    const factor = (savingsRate < 20 && isDiscretionary) ? 0.85 : 0.95;
    const recommended = avg * factor;
    const currentBudget = budgetMap.has(cat) ? budgetMap.get(cat) : null;
    const diff = currentBudget !== null ? recommended - currentBudget : null;

    recs.push({ category: cat, recommended, currentBudget, diff, hasBudget: currentBudget !== null });
  }

  return recs.sort((a, b) => b.recommended - a.recommended);
}

// ─── Public: Financial Health Score ──────────────────────────────────────────

export function computeFinancialHealth(expenses, income, budgets, aggregates) {
  // 1. Savings Rate score (0–100): maps savings rate % → score
  const savingsRate = computeSavingsRate(expenses, income, 1); // current month
  const savingsScore = Math.min(100, savingsRate);

  // 2. Budget Adherence score: % of budgeted categories where spend <= limit
  const curMonth = getCurrentMonth();
  let budgetTotal = 0, budgetMet = 0;
  for (const b of budgets) {
    const limit = Number(b.monthlyLimit) || 0;
    if (limit <= 0) continue;
    const catMap = aggregates.get(b.category);
    const spent = catMap ? (catMap.get(curMonth) ?? 0) : 0;
    budgetTotal++;
    if (spent <= limit) budgetMet++;
  }
  const budgetScore = budgetTotal === 0 ? 0 : Math.round((budgetMet / budgetTotal) * 100);

  // 3. Spending Consistency score: inverse of avg month-over-month variance
  //    Low variance = consistent = high score
  let consistencyScore = 0; // default 0 when not enough data
  const allMonths = new Set();
  for (const e of expenses) { const m = getYYYYMM(e.date); if (m) allMonths.add(m); }
  const sortedMonths = [...allMonths].sort().slice(-6);
  if (sortedMonths.length >= 3) {
    const monthTotals = sortedMonths.map(m =>
      expenses.filter(e => getYYYYMM(e.date) === m).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    );
    const mean = monthTotals.reduce((a, b) => a + b, 0) / monthTotals.length;
    if (mean > 0) {
      const cv = Math.sqrt(monthTotals.reduce((a, b) => a + (b - mean) ** 2, 0) / monthTotals.length) / mean;
      consistencyScore = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
    }
  }

  // Overall score: weighted average
  const overall = Math.round(savingsScore * 0.4 + budgetScore * 0.35 + consistencyScore * 0.25);

  // No data state — if expenses is empty, return neutral placeholder
  if (expenses.length === 0) {
    return {
      overall: 0, savingsScore: 0, budgetScore: 0, consistencyScore: 0,
      label: 'No Data', description: 'Add expenses and income to calculate your financial health score.',
      savingsRate: 0, hasData: false,
    };
  }

  const label =
    overall >= 80 ? 'Excellent' :
    overall >= 60 ? 'Good' :
    overall >= 40 ? 'Fair' :
    'Needs Attention';

  const description =
    overall >= 80 ? "You're managing your finances really well." :
    overall >= 60 ? 'Good progress. A few areas to improve.' :
    overall >= 40 ? "Fair. There's room for improvement." :
    'Your finances need immediate attention.';

  return { overall, savingsScore, budgetScore, consistencyScore, label, description, savingsRate, hasData: true };
}

// ─── Public: Personalised Tips ───────────────────────────────────────────────

export function computePersonalisedTips(momResult, savingsRate, savings, forecasts) {
  const tips = [];
  const { byCategory } = momResult;

  // Watch: top 3 categories by spend increase
  const increases = [...byCategory.entries()]
    .filter(([, v]) => v.diff > 0)
    .sort((a, b) => b[1].diff - a[1].diff)
    .slice(0, 3);

  // Well Done: top 3 categories by spend decrease
  const decreases = [...byCategory.entries()]
    .filter(([, v]) => v.diff < 0)
    .sort((a, b) => a[1].diff - b[1].diff)
    .slice(0, 3);

  for (const [cat, vals] of increases) {
    tips.push({
      priority: 'normal',
      type: 'watch',
      category: cat,
      message: `${cat} spending increased by ₹${Math.abs(vals.diff).toFixed(0)} this month. Consider setting a budget for ${cat}.`,
    });
  }

  for (const [cat, vals] of decreases) {
    tips.push({
      priority: 'normal',
      type: 'well-done',
      category: cat,
      message: `Great job! You spent ₹${Math.abs(vals.diff).toFixed(0)} less on ${cat} compared to last month.`,
    });
  }

  if (savingsRate < 10) {
    tips.unshift({
      priority: 'high',
      type: 'savings-rate',
      message: `Your savings rate is critically low (${savingsRate.toFixed(1)}%). Review your discretionary spending immediately.`,
    });
  }

  // Savings goal tips
  const curMonth = getCurrentMonth();
  const curIncome = momResult.currentTotal; // proxy: use current month expenses as reference
  for (const goal of (savings ?? [])) {
    const remaining = (Number(goal.targetAmount) || 0) - (Number(goal.savedAmount) || 0);
    if (remaining <= 0) continue;
    const forecastTotal = forecasts.reduce((s, f) => s + f.forecast, 0);
    if (forecastTotal > 0 && remaining > 0) {
      tips.push({
        priority: 'normal',
        type: 'savings-goal',
        goalName: goal.name,
        message: `To reach your "${goal.name}" goal, you need ₹${remaining.toFixed(0)} more. Your projected spend of ₹${forecastTotal.toFixed(0)} next month may limit progress.`,
      });
    }
  }

  return tips;
}

// ─── Public: computeAll ──────────────────────────────────────────────────────

export function computeAll(expenses, income, budgets, savings) {
  expenses = expenses ?? [];
  income = income ?? [];
  budgets = budgets ?? [];
  savings = savings ?? [];

  // Data sufficiency — always return hasEnoughData: true, but flag sparse data
  const insufficientReasons = [];
  if (expenses.length < 5) {
    insufficientReasons.push(`Add at least 5 expense records for full insights (you have ${expenses.length}).`);
  }

  // Always proceed — sections handle their own empty states
  const hasEnoughData = true;

  const hasIncome = income.length > 0;
  const aggregates = buildMonthlyAggregates(expenses);

  // Trends & Forecasts
  const trends = [];
  const forecasts = [];
  const budgetMap = new Map(budgets.map(b => [b.category, Number(b.monthlyLimit) || 0]));

  for (const [cat, catMap] of aggregates) {
    const sortedMonths = [...catMap.keys()].sort();
    const allValues = sortedMonths.map(m => catMap.get(m));

    // Trend
    const last6Months = sortedMonths.slice(-6);
    const last6Values = last6Months.map(m => catMap.get(m));
    const slope = computeTrendSlope(allValues);
    const direction = classifyTrend(slope);
    trends.push({ category: cat, slope: isNaN(slope) ? 0 : slope, direction, monthlyValues: last6Values, months: last6Months });

    // Forecast
    if (allValues.length >= MIN_TREND_MONTHS) {
      const wma = computeWMAForecast(allValues);
      const reg = computeRegressionForecast(allValues);
      const forecast = Math.max(wma, isNaN(reg) ? 0 : reg);
      const average = allValues.reduce((a, b) => a + b, 0) / allValues.length;
      const pctDiff = average === 0 ? 0 : ((forecast - average) / average) * 100;
      const budgetLimit = budgetMap.has(cat) ? budgetMap.get(cat) : null;
      forecasts.push({
        category: cat,
        forecast,
        average,
        pctDiff,
        budgetLimit,
        exceedsBudget: budgetLimit !== null && forecast > budgetLimit,
      });
    }
  }

  // Sort trends: Increasing → Stable → Decreasing
  const dirOrder = { Increasing: 0, Stable: 1, Decreasing: 2 };
  trends.sort((a, b) => dirOrder[a.direction] - dirOrder[b.direction]);

  const totalForecast = forecasts.reduce((s, f) => s + f.forecast, 0);

  // Anomalies
  const anomalies = detectAnomalies(expenses, aggregates);

  // Classification
  const curMonth = getCurrentMonth();
  const classifications = new Map();
  let totalDiscretionary = 0, totalFixed = 0;
  const classCategories = [];

  for (const [cat, catMap] of aggregates) {
    const type = classifyCategory(cat);
    classifications.set(cat, type);
    const currentMonthSpend = catMap.get(curMonth) ?? 0;
    classCategories.push({ name: cat, type, currentMonthSpend });
    if (type === 'Discretionary') totalDiscretionary += currentMonthSpend;
    else totalFixed += currentMonthSpend;
  }

  const totalClassSpend = totalDiscretionary + totalFixed;
  const discretionaryPct = totalClassSpend === 0 ? 0 : (totalDiscretionary / totalClassSpend) * 100;

  // Savings rate (3-month window)
  const savingsRate3m = computeSavingsRate(expenses, income, 3);
  const savingsRateCur = computeSavingsRate(expenses, income, 1);

  // Budget recommendations
  const recommendations = computeBudgetRecommendations(aggregates, savingsRate3m, budgets, classifications);

  // Projected savings rate if recommendations followed
  const curMonthIncome = income
    .filter(r => getYYYYMM(r.date) === curMonth)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const recTotal = recommendations.reduce((s, r) => s + r.recommended, 0);
  const projectedSavingsRate = curMonthIncome === 0 ? 0 :
    Math.max(0, ((curMonthIncome - recTotal) / curMonthIncome) * 100);

  // MoM
  const mom = computeMoM(expenses);

  // Tips
  const tips = computePersonalisedTips(mom, savingsRateCur, savings, forecasts);

  // Financial Health Score
  const health = computeFinancialHealth(expenses, income, budgets, aggregates);

  return {
    hasEnoughData,
    insufficientReasons,
    hasIncome,
    mom,
    trends,
    forecasts,
    totalForecast,
    anomalies,
    classification: { categories: classCategories, totalDiscretionary, totalFixed, discretionaryPct },
    recommendations,
    projectedSavingsRate,
    tips,
    health,
    lastUpdated: new Date(),
  };
}

// ─── Public: Income vs Expense Ratio by Category ─────────────────────────────

export function computeIncomeExpenseRatio(expenses, income) {
  const curMonth = getCurrentMonth();
  const prevMonth = getPreviousMonth();

  // Try current month first; fall back to previous month if no income yet
  let activeMonth = curMonth;
  let totalIncome = (income ?? [])
    .filter(r => getYYYYMM(r.date) === curMonth)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if (totalIncome <= 0) {
    const prevIncome = (income ?? [])
      .filter(r => getYYYYMM(r.date) === prevMonth)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (prevIncome > 0) {
      activeMonth = prevMonth;
      totalIncome = prevIncome;
    }
  }

  const catTotals = new Map();
  for (const e of (expenses ?? [])) {
    if (getYYYYMM(e.date) !== activeMonth) continue;
    const cat = e.category ?? 'Other';
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + (Number(e.amount) || 0));
  }

  const result = [];
  for (const [category, amount] of catTotals) {
    const pct = totalIncome > 0 ? (amount / totalIncome) * 100 : 0;
    const classification = pct > 30 ? 'high' : pct >= 15 ? 'medium' : 'low';
    result.push({ category, amount, pct, classification });
  }

  const isFallback = activeMonth !== curMonth;
  return { items: result.sort((a, b) => b.pct - a.pct), totalIncome, activeMonth, isFallback };
}

// ─── Public: Daily Spending Tier Analysis ─────────────────────────────────────

const SPENDING_TIERS_DEF = [
  { key: 'zero',     label: 'Rest Day',     emoji: '🟢', range: '₹0',          color: '#10b981', min: 0,    max: 0        },
  { key: 'minimal',  label: 'Chai Day',     emoji: '☕', range: '₹1–₹99',      color: '#34d399', min: 1,    max: 99       },
  { key: 'light',    label: 'Light Day',    emoji: '🛒', range: '₹100–₹499',   color: '#3b82f6', min: 100,  max: 499      },
  { key: 'moderate', label: 'Dining Day',   emoji: '🍽', range: '₹500–₹999',   color: '#f59e0b', min: 500,  max: 999      },
  { key: 'heavy',    label: 'Shopping Day', emoji: '🛍', range: '₹1k–₹4.9k',   color: '#ef4444', min: 1000, max: 4999     },
  { key: 'splurge',  label: 'Big Spend',    emoji: '💸', range: '₹5000+',       color: '#dc2626', min: 5000, max: Infinity },
];

export function computeSpendingDayTiers(expenses, income, monthYM) {
  if (!monthYM) {
    const d = new Date();
    monthYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const [year, month] = monthYM.split('-').map(Number);
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === (now.getMonth() + 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDay     = isCurrentMonth ? now.getDate() : daysInMonth;

  const monthlyIncome = (income ?? [])
    .filter(r => String(r.date ?? '').startsWith(monthYM))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const dayMap = {};
  (expenses ?? [])
    .filter(r => String(r.date ?? '').startsWith(monthYM))
    .forEach(r => {
      const dk = String(r.date).slice(0, 10);
      dayMap[dk] = (dayMap[dk] ?? 0) + (Number(r.amount) || 0);
    });

  const dailyBudget = monthlyIncome > 0 ? monthlyIncome / daysInMonth : 0;

  const counts = {};
  SPENDING_TIERS_DEF.forEach(t => { counts[t.key] = { total: 0, weekdays: 0, weekends: 0 }; });

  for (let d = 1; d <= lastDay; d++) {
    const ds    = `${String(year)}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const total = dayMap[ds] ?? 0;
    const dow   = new Date(ds + 'T12:00:00').getDay();
    const isWE  = dow === 0 || dow === 6;

    let key;
    if      (total === 0)    key = 'zero';
    else if (total < 100)    key = 'minimal';
    else if (total < 500)    key = 'light';
    else if (total < 1000)   key = 'moderate';
    else if (total < 5000)   key = 'heavy';
    else                     key = 'splurge';

    counts[key].total++;
    if (isWE) counts[key].weekends++; else counts[key].weekdays++;
  }

  let longestZeroStreak = 0, curStreak = 0;
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${String(year)}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if ((dayMap[ds] ?? 0) === 0) { curStreak++; longestZeroStreak = Math.max(longestZeroStreak, curStreak); }
    else curStreak = 0;
  }

  return {
    tiers: SPENDING_TIERS_DEF.map(t => ({ ...t, ...counts[t.key] })),
    dailyBudget,
    monthlyIncome,
    totalDays: lastDay,
    longestZeroStreak,
    monthYM,
    hasIncome: monthlyIncome > 0,
  };
}
