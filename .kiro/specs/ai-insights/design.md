# Design Document: AI Insights

## Overview

The AI Insights feature adds a dedicated tab to the Expense Portal SPA that surfaces intelligent, data-driven analysis of the user's financial behaviour. All computation runs entirely client-side using vanilla JavaScript statistical algorithms — no external ML service, no build step, no new dependencies.

The feature is split into two modules:

- **`js/insights.js`** — pure computation engine (no DOM access). Accepts plain data arrays and returns structured result objects.
- **`js/ai-insights.js`** — view/render layer. Subscribes to the store, calls the engine, and writes HTML into the tab panel.

This separation keeps the engine fully unit-testable without a DOM environment.

---

## Architecture

```
store (expenses, income, budgets, savings)
        │
        │  store.on(key, handler)
        ▼
  ai-insights.js  (view layer)
        │
        │  computeAll(expenses, income, budgets, savings)
        ▼
   insights.js  (engine — pure functions)
        │
        │  returns InsightsResult object
        ▼
  ai-insights.js  (renders HTML into #tab-ai-insights)
        │
        │  drawSparkline(canvas, data)
        │  drawDonut(svgEl, slices)
        ▼
  DOM / CSS (.ai-* classes)
```

### Module Responsibilities

| Module | Responsibilities |
|---|---|
| `insights.js` | Monthly aggregation, linear regression, WMA, z-score, classification, MoM diff, recommendations |
| `ai-insights.js` | Store subscription, tab wiring, HTML rendering, sparkline canvas, SVG donut, localStorage for dismissed items |

---

## Components and Interfaces

### insights.js — Public API

```js
/**
 * Main entry point. Returns a complete InsightsResult.
 * @param {Expense[]}  expenses
 * @param {Income[]}   income
 * @param {Budget[]}   budgets
 * @param {Saving[]}   savings
 * @returns {InsightsResult}
 */
export function computeAll(expenses, income, budgets, savings)

// Individual engine functions (also exported for unit testing)
export function buildMonthlyAggregates(expenses)          // → Map<category, Map<YYYY-MM, number>>
export function computeTrendSlope(monthlyValues)           // → number  (₹/month, linear regression)
export function classifyTrend(slope)                       // → 'Increasing' | 'Stable' | 'Decreasing'
export function computeWMAForecast(monthlyValues)          // → number  (3-month WMA, weights 1-2-3)
export function computeRegressionForecast(monthlyValues)   // → number  (next-period linear extrapolation)
export function computeZScores(values)                     // → number[]
export function detectAnomalies(expenses, aggregates)      // → Anomaly[]
export function classifyCategory(categoryName)             // → 'Fixed' | 'Discretionary'
export function computeMoM(expenses)                       // → MoMResult
export function computeBudgetRecommendations(aggregates, savingsRate, budgets, classifications) // → Recommendation[]
export function computeSavingsRate(expenses, income, months) // → number (0–100)
export function computePersonalisedTips(momResult, savingsRate, savings, forecasts) // → Tip[]
```

### InsightsResult shape

```js
{
  hasEnoughData: boolean,          // false → show empty state
  insufficientReasons: string[],   // human-readable reasons
  hasIncome: boolean,

  mom: {
    currentTotal: number,
    previousTotal: number,
    absoluteDiff: number,
    percentChange: number,         // positive = increase
    byCategory: Map<string, { current, previous, diff, pct }>
  },

  trends: [{
    category: string,
    slope: number,
    direction: 'Increasing' | 'Stable' | 'Decreasing',
    monthlyValues: number[],       // last 6 months, oldest first
    months: string[],              // YYYY-MM labels
  }],

  forecasts: [{
    category: string,
    forecast: number,
    average: number,
    pctDiff: number,
    budgetLimit: number | null,
    exceedsBudget: boolean,
  }],
  totalForecast: number,

  anomalies: [{
    type: 'expense' | 'monthly',
    category: string,
    label: string,                 // description or "YYYY-MM"
    amount: number,
    zScore: number,
    mean: number,
    stddev: number,
  }],

  classification: {
    categories: [{ name, type: 'Fixed'|'Discretionary', currentMonthSpend }],
    totalDiscretionary: number,
    totalFixed: number,
    discretionaryPct: number,
  },

  recommendations: [{
    category: string,
    recommended: number,
    currentBudget: number | null,
    diff: number | null,
    hasBudget: boolean,
  }],
  projectedSavingsRate: number,

  tips: [{
    priority: 'high' | 'normal',
    type: 'watch' | 'well-done' | 'savings-rate' | 'savings-goal',
    message: string,
    category?: string,
    goalName?: string,
  }],

  lastUpdated: Date,
}
```

### ai-insights.js — Public API

```js
export function init()   // called once from index.html bootstrap
export function render() // called by store subscriptions and refresh button
```

---

## Data Models

### Input types (from store)

```js
// Expense_Record
{ date: 'YYYY-MM-DD', category: string, subCategory: string,
  amount: number, description: string, paymentMethod: string }

// Income_Record
{ date: 'YYYY-MM-DD', source: string, amount: number, receivedIn: string }

// Budget_Record
{ id: string, category: string, monthlyLimit: number, month: string }

// Saving (savings goal)
{ name: string, targetAmount: number, savedAmount: number, targetDate?: string }
```

### localStorage schema

```js
// Key: 'ai-insights-dismissed'
// Value: JSON array of dismissed recommendation category names
// e.g. ["Entertainment", "Shopping"]
```

---

## Algorithm Designs

### 1. Monthly Aggregation

Group expenses by `category` and `YYYY-MM` prefix of `date`:

```
aggregates[category][YYYY-MM] = sum of amounts
```

Returns a `Map<string, Map<string, number>>` sorted by month key.

### 2. Linear Regression (Trend Slope & Regression Forecast)

Given an array of `n` monthly values `y[0..n-1]`, treat index as `x`:

```
x̄ = (n-1) / 2
ȳ = mean(y)
slope = Σ((xᵢ - x̄)(yᵢ - ȳ)) / Σ((xᵢ - x̄)²)
intercept = ȳ - slope * x̄
forecast(next) = intercept + slope * n
```

Minimum 3 data points required. Returns `NaN` if insufficient data.

### 3. Weighted Moving Average (WMA Forecast)

Given the last 3 monthly values `[oldest, middle, recent]`:

```
WMA = (1 * oldest + 2 * middle + 3 * recent) / (1 + 2 + 3)
    = (oldest + 2*middle + 3*recent) / 6
```

If fewer than 3 months available, fall back to simple average of available months.

### 4. Conservative Forecast

```
forecast = max(WMA, regressionForecast)
```

Ensures the estimate is never optimistically low.

### 5. Z-Score Anomaly Detection

For a set of values `v[0..n-1]`:

```
mean   = Σ(vᵢ) / n
stddev = sqrt(Σ((vᵢ - mean)²) / n)
z[i]   = (v[i] - mean) / stddev
```

- Skip if `n < 3` (not enough data for meaningful statistics)
- Skip if `stddev === 0` (all values identical — no anomaly possible)
- Flag as anomaly if `z > 2.0`

Applied to both individual `Expense_Record` amounts (within category) and `Monthly_Aggregate` values (per category over time).

### 6. Discretionary vs Fixed Classification

Pattern matching against lowercase category name:

```js
const FIXED_PATTERNS = [
  'rent', 'mortgage', 'emi', 'loan', 'insurance',
  'utilities', 'electricity', 'water', 'internet',
  'subscription', 'tax'
];

function classifyCategory(name) {
  const lower = name.toLowerCase();
  return FIXED_PATTERNS.some(p => lower.includes(p)) ? 'Fixed' : 'Discretionary';
}
```

### 7. Budget Recommendations

```
baseFactor = 0.95
strictFactor = 0.85  (applied when 3-month savings rate < 20%)

3MonthAvg[cat] = mean of last 3 Monthly_Aggregates for category
factor = (savingsRate < 20 && isDiscretionary) ? strictFactor : baseFactor
recommendation[cat] = 3MonthAvg[cat] * factor
```

### 8. Savings Rate

```
savingsRate = (totalIncome - totalExpenses) / totalIncome * 100
```

Computed over a configurable window (default: last 3 months for recommendations, current month for tips).

---

## UI Layout

### Tab Structure

The AI Insights tab panel (`id="tab-ai-insights"`) is divided into named sections rendered top-to-bottom:

```
┌─────────────────────────────────────────────────────┐
│  [Summary Banner] Month-over-Month + Last Updated   │
│  [Refresh Button]                                   │
├─────────────────────────────────────────────────────┤
│  [Section: Spending Trends]                         │
│    Card grid — one card per category                │
│    Each card: direction badge, slope, sparkline     │
├─────────────────────────────────────────────────────┤
│  [Section: Forecasts]                               │
│    Card grid — forecast + avg + % diff              │
│    Total projected spend footer                     │
├─────────────────────────────────────────────────────┤
│  [Section: Unusual Spending]                        │
│    List of anomaly cards sorted by z-score          │
├─────────────────────────────────────────────────────┤
│  [Section: Discretionary vs Fixed]                  │
│    SVG donut chart (left) + category list (right)   │
│    Summary totals + contextual tip if > 60%         │
├─────────────────────────────────────────────────────┤
│  [Section: Budget Recommendations]                  │
│    Card per category + projected savings rate       │
├─────────────────────────────────────────────────────┤
│  [Section: Personalised Tips]                       │
│    Watch categories + Well Done + savings tips      │
└─────────────────────────────────────────────────────┘
```

### Sparkline Implementation (Canvas)

Each trend card contains a `<canvas class="ai-sparkline">` element (width: 120px, height: 40px). Rendered by `drawSparkline(canvas, values, color)`:

```
1. Normalise values to [0, canvas.height] range
2. Draw a polyline connecting (x, y) points
3. Fill area under the line with semi-transparent color
4. No axes, no labels — purely visual indicator
5. Color: green (#10b981) for Decreasing, red (#ef4444) for Increasing, grey (#94a3b8) for Stable
```

No external chart library. Uses the 2D Canvas API directly.

### Donut Chart Implementation (SVG)

The discretionary/fixed breakdown uses an inline SVG donut:

```
1. Two slices: Discretionary (indigo #6366f1) and Fixed (slate #64748b)
2. SVG viewBox="0 0 120 120", cx=60, cy=60, r=45, strokeWidth=20
3. Circumference = 2π * 45 ≈ 282.7
4. Each slice: <circle> with stroke-dasharray and stroke-dashoffset
5. Center label: percentage of discretionary spend
6. Legend rendered as HTML below the SVG
```

No external chart library. Pure SVG stroke-dasharray technique.

---

## CSS Class Naming Conventions

All AI Insights styles use the `.ai-` prefix to avoid collisions with existing styles:

```css
/* Layout */
.ai-section          /* section wrapper with heading */
.ai-section-title    /* section heading text */
.ai-card-grid        /* responsive card grid */

/* Insight Cards */
.ai-card             /* base insight card */
.ai-card-header      /* card top row */
.ai-card-body        /* card content area */
.ai-card-footer      /* card bottom row */
.ai-card--warning    /* modifier: budget exceeded */
.ai-card--anomaly    /* modifier: anomaly card */

/* Trend */
.ai-trend-badge              /* direction badge */
.ai-trend-badge--increasing  /* red variant */
.ai-trend-badge--stable      /* grey variant */
.ai-trend-badge--decreasing  /* green variant */
.ai-sparkline                /* canvas element */

/* Donut */
.ai-donut-wrap       /* flex container for donut + legend */
.ai-donut-svg        /* the SVG element */
.ai-donut-label      /* center text overlay */
.ai-donut-legend     /* legend list */

/* Summary Banner */
.ai-summary-banner   /* top MoM summary row */
.ai-summary-item     /* individual metric in banner */
.ai-summary-value    /* large number */
.ai-summary-change   /* percentage change */
.ai-summary-change--up    /* red + arrow-up */
.ai-summary-change--down  /* green + arrow-down */

/* Tips */
.ai-tip              /* tip card */
.ai-tip--high        /* high-priority tip (red left border) */
.ai-tip--watch       /* watch category tip */
.ai-tip--well-done   /* positive reinforcement tip */

/* Anomaly */
.ai-anomaly-card     /* anomaly list item */
.ai-zscore-badge     /* z-score display */

/* Recommendation */
.ai-rec-card         /* recommendation card */
.ai-rec-dismiss      /* dismiss button */

/* States */
.ai-empty-state      /* no-data placeholder */
.ai-loading          /* loading overlay */
.ai-last-updated     /* timestamp text */
```

---

## Store Subscription and Reactivity Pattern

`ai-insights.js` follows the same pattern used by `dashboard.js`:

```js
// In init():
const WATCHED_KEYS = ['expenses', 'income', 'budgets', 'savings'];
WATCHED_KEYS.forEach(key => store.on(key, _onStoreChange));

// Debounced handler to batch rapid successive updates:
let _debounceTimer = null;
function _onStoreChange() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(render, 150);
}
```

The 150ms debounce prevents redundant re-renders when multiple store keys update in quick succession (e.g. initial data load).

The `render()` function:
1. Reads all four store keys
2. Calls `computeAll(expenses, income, budgets, savings)`
3. Checks `hasEnoughData` — renders empty state if false
4. Renders each section by calling dedicated `_render*` helpers
5. Updates the "Last updated" timestamp

---

## localStorage Usage for Dismissed Recommendations

```js
const LS_KEY = 'ai-insights-dismissed';

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); }
  catch { return []; }
}

function dismissRecommendation(category) {
  const dismissed = getDismissed();
  if (!dismissed.includes(category)) {
    dismissed.push(category);
    localStorage.setItem(LS_KEY, JSON.stringify(dismissed));
  }
  render(); // re-render to hide dismissed card
}

function resetDismissed() {
  localStorage.removeItem(LS_KEY);
  render();
}
```

Dismissed categories are filtered out before rendering the recommendations section. A "Reset dismissed" link is shown when any recommendations are dismissed.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Data sufficiency guard

*For any* set of expense records with fewer than 10 records or fewer than 2 distinct YYYY-MM months, `computeAll` must return `hasEnoughData: false` and the view must render the empty state rather than any analysis sections.

**Validates: Requirements 2.1, 2.2**

---

### Property 2: Trend classification is exhaustive and correct

*For any* computed `Trend_Slope` value, `classifyTrend(slope)` must return exactly one of `'Increasing'`, `'Stable'`, or `'Decreasing'`, where: slope > 100 → Increasing, slope < -100 → Decreasing, and |slope| ≤ 100 → Stable.

**Validates: Requirements 3.2, 3.3, 3.4**

---

### Property 3: Trend cards sort order

*For any* array of trend results, the rendered card order must place all `'Increasing'` categories before all `'Stable'` categories, and all `'Stable'` categories before all `'Decreasing'` categories.

**Validates: Requirements 3.6**

---

### Property 4: Conservative forecast is never below either component

*For any* category with at least 3 months of data, the returned forecast must satisfy `forecast >= WMAForecast` and `forecast >= regressionForecast` (i.e. it is the maximum of the two).

**Validates: Requirements 4.1, 4.2**

---

### Property 5: Forecast total equals sum of category forecasts

*For any* set of category forecasts, `totalForecast` must equal the arithmetic sum of all individual category forecast values.

**Validates: Requirements 4.5**

---

### Property 6: Z-score computation correctness

*For any* array of numeric values with at least 3 elements and non-zero standard deviation, `computeZScores(values)` must return an array where each element equals `(value - mean) / stddev`, and the mean of the z-scores is approximately 0.

**Validates: Requirements 5.1, 5.3**

---

### Property 7: Anomaly flagging threshold

*For any* expense record or monthly aggregate whose z-score exceeds 2.0, it must appear in the anomalies list; and for any with z-score ≤ 2.0, it must not appear. Categories with fewer than 3 data points must produce zero anomalies.

**Validates: Requirements 5.2, 5.4, 5.6**

---

### Property 8: Anomaly sort order

*For any* list of detected anomalies, the rendered order must be strictly descending by z-score (highest z-score first).

**Validates: Requirements 5.7**

---

### Property 9: Category classification is deterministic and exhaustive

*For any* category name, `classifyCategory(name)` must return `'Fixed'` if the lowercased name contains any of the fixed patterns, and `'Discretionary'` otherwise. Every category must receive exactly one classification.

**Validates: Requirements 6.1, 6.2**

---

### Property 10: Discretionary/Fixed totals are consistent

*For any* set of current-month expenses, `totalDiscretionary + totalFixed` must equal the total current-month spend, and `discretionaryPct` must equal `totalDiscretionary / (totalDiscretionary + totalFixed) * 100`.

**Validates: Requirements 6.5**

---

### Property 11: Budget recommendation factor application

*For any* category, the recommendation must equal `3MonthAverage * 0.95` when the 3-month savings rate is ≥ 20%, and `3MonthAverage * 0.85` when the savings rate is < 20% and the category is Discretionary.

**Validates: Requirements 7.1, 7.2**

---

### Property 12: Dismissed recommendations persist across renders

*For any* dismissed category, after calling `dismissRecommendation(category)` and then calling `render()`, that category's recommendation card must not appear in the DOM; and `getDismissed()` must include that category name.

**Validates: Requirements 7.6**

---

### Property 13: Month-over-month computation correctness

*For any* set of expense records, `computeMoM` must return `percentChange = (currentTotal - previousTotal) / previousTotal * 100`, and the direction indicator (red/up vs green/down) must match the sign of `percentChange`.

**Validates: Requirements 8.1, 8.2, 8.4, 8.5**

---

### Property 14: Watch and Well Done category identification

*For any* set of per-category MoM changes, the Watch list must contain the top 3 categories by spend increase and the Well Done list must contain the top 3 by spend decrease; no category may appear in both lists.

**Validates: Requirements 9.1, 9.2**

---

### Property 15: Tips rendered for every Watch and Well Done category

*For any* non-empty Watch list, the rendered tips section must contain at least one tip per Watch category; and for any non-empty Well Done list, at least one positive message per Well Done category.

**Validates: Requirements 9.3, 9.4**

---

### Property 16: Store reactivity triggers re-render

*For any* change to the `expenses`, `income`, `budgets`, or `savings` store keys, the view's render function must be invoked within 500ms of the store update.

**Validates: Requirements 10.2**

---

## Error Handling

| Scenario | Handling |
|---|---|
| `store.get('expenses')` returns `null` or `undefined` | Treat as empty array; show data-sufficiency empty state |
| `store.get('income')` is empty | Render all non-income insights; show notice banner |
| Division by zero in savings rate (income = 0) | Return 0% savings rate |
| Division by zero in z-score (stddev = 0) | Skip anomaly detection for that category |
| Division by zero in MoM % (previous = 0) | Return `null` for percentChange; render as "N/A" |
| Fewer than 3 months for regression | Return `null` forecast; omit category from forecasts section |
| `localStorage` unavailable (private browsing) | Catch `SecurityError`; dismissed state falls back to in-memory Set |
| Malformed `localStorage` JSON | Catch parse error; treat as empty dismissed list |

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. They are complementary:

- **Unit tests** cover specific examples, integration points, and edge cases
- **Property tests** verify universal correctness across randomised inputs

### Unit Tests (examples and edge cases)

- `computeAll` with exactly 10 expenses across 2 months → `hasEnoughData: true`
- `computeAll` with 9 expenses → `hasEnoughData: false`
- `computeAll` with all expenses in 1 month → `hasEnoughData: false` (trend reason)
- `classifyCategory('Rent Payment')` → `'Fixed'`
- `classifyCategory('Entertainment')` → `'Discretionary'`
- `computeMoM` when previous month has zero spend → `percentChange: null`
- `getDismissed()` when localStorage is empty → `[]`
- `dismissRecommendation` when localStorage throws → no crash, in-memory fallback
- Donut chart with 100% discretionary → single full-circle slice
- Sparkline with all-zero values → flat line at bottom

### Property-Based Tests

Use a property-based testing library appropriate for the target environment. For vanilla JS in a browser/Node context, **fast-check** (npm) is the recommended choice.

Each property test must run a minimum of **100 iterations**.

Each test must include a comment tag in the format:
`// Feature: ai-insights, Property N: <property_text>`

**Property 1 — Data sufficiency guard**
```
// Feature: ai-insights, Property 1: hasEnoughData is false for < 10 records or < 2 months
fc.assert(fc.property(
  fc.array(arbitraryExpense(), { maxLength: 9 }),
  (expenses) => computeAll(expenses, [], [], []).hasEnoughData === false
), { numRuns: 100 });
```

**Property 2 — Trend classification exhaustive**
```
// Feature: ai-insights, Property 2: classifyTrend returns correct direction for any slope
fc.assert(fc.property(
  fc.float({ noNaN: true }),
  (slope) => {
    const dir = classifyTrend(slope);
    if (slope > 100)  return dir === 'Increasing';
    if (slope < -100) return dir === 'Decreasing';
    return dir === 'Stable';
  }
), { numRuns: 100 });
```

**Property 4 — Conservative forecast**
```
// Feature: ai-insights, Property 4: forecast >= max(WMA, regression) for any monthly data
fc.assert(fc.property(
  fc.array(fc.float({ min: 0, noNaN: true }), { minLength: 3, maxLength: 24 }),
  (values) => {
    const wma = computeWMAForecast(values);
    const reg = computeRegressionForecast(values);
    const forecast = Math.max(wma, reg);
    return forecast >= wma && forecast >= reg;
  }
), { numRuns: 100 });
```

**Property 6 — Z-score mean is ~0**
```
// Feature: ai-insights, Property 6: mean of z-scores is approximately 0
fc.assert(fc.property(
  fc.array(fc.float({ min: 0, max: 100000, noNaN: true }), { minLength: 3, maxLength: 50 }),
  (values) => {
    const zs = computeZScores(values);
    if (zs === null) return true; // stddev = 0, skipped
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    return Math.abs(mean) < 1e-9;
  }
), { numRuns: 100 });
```

**Property 9 — Category classification exhaustive**
```
// Feature: ai-insights, Property 9: every category name gets exactly one classification
fc.assert(fc.property(
  fc.string({ minLength: 1 }),
  (name) => {
    const result = classifyCategory(name);
    return result === 'Fixed' || result === 'Discretionary';
  }
), { numRuns: 100 });
```

**Property 10 — Discretionary + Fixed totals sum to total**
```
// Feature: ai-insights, Property 10: totalDiscretionary + totalFixed === total spend
fc.assert(fc.property(
  fc.array(arbitraryExpense(), { minLength: 10 }),
  (expenses) => {
    const result = computeAll(expenses, [], [], []);
    if (!result.hasEnoughData) return true;
    const { totalDiscretionary, totalFixed } = result.classification;
    const total = expenses
      .filter(e => e.date.startsWith(getCurrentMonth()))
      .reduce((s, e) => s + e.amount, 0);
    return Math.abs(totalDiscretionary + totalFixed - total) < 0.01;
  }
), { numRuns: 100 });
```

**Property 11 — Budget recommendation factor**
```
// Feature: ai-insights, Property 11: recommendation = avg * correct factor
fc.assert(fc.property(
  fc.array(fc.float({ min: 0, max: 50000, noNaN: true }), { minLength: 3, maxLength: 3 }),
  fc.boolean(), // isDiscretionary
  fc.boolean(), // savingsRateBelow20
  (monthlyValues, isDiscretionary, lowSavings) => {
    const avg = monthlyValues.reduce((a, b) => a + b, 0) / 3;
    const factor = (lowSavings && isDiscretionary) ? 0.85 : 0.95;
    const expected = avg * factor;
    // verify engine produces same result
    return Math.abs(computeRecommendation(avg, isDiscretionary, lowSavings ? 15 : 25) - expected) < 0.01;
  }
), { numRuns: 100 });
```

**Property 13 — MoM percentage change sign matches direction indicator**
```
// Feature: ai-insights, Property 13: direction indicator matches sign of percentChange
fc.assert(fc.property(
  fc.array(arbitraryExpense(), { minLength: 10 }),
  (expenses) => {
    const mom = computeMoM(expenses);
    if (mom.percentChange === null) return true;
    if (mom.percentChange > 0) return mom.direction === 'up';
    if (mom.percentChange < 0) return mom.direction === 'down';
    return true;
  }
), { numRuns: 100 });
```
