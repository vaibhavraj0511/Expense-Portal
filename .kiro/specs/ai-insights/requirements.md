# Requirements Document

## Introduction

The AI Insights feature adds a dedicated "AI Insights" tab to the personal finance expense tracker. It provides intelligent, data-driven analysis of the user's spending behaviour using client-side statistical and heuristic algorithms (moving averages, linear regression, z-score anomaly detection, etc.) — no external ML service is required. The feature surfaces spending trends, category-level predictions, discretionary vs. fixed expense classification, anomaly alerts, and personalised budget recommendations, all derived from the data already held in the app's store (expenses, income, budgets, categories, savings).

---

## Glossary

- **Insights_Engine**: The client-side JavaScript module (`js/insights.js`) that computes all statistical analyses and exposes results to the view layer.
- **Insights_View**: The JavaScript module (`js/ai-insights.js`) that renders the AI Insights tab in the DOM.
- **Expense_Record**: An object in `store.get('expenses')` with fields `{ date, category, subCategory, amount, description, paymentMethod }`.
- **Income_Record**: An object in `store.get('income')` with fields `{ date, source, amount, receivedIn }`.
- **Budget_Record**: An object in `store.get('budgets')` with fields `{ id, category, monthlyLimit, month }`.
- **Monthly_Aggregate**: The total amount spent in a given category for a given YYYY-MM month.
- **Trend_Slope**: The rate of change (₹ per month) computed via simple linear regression over Monthly_Aggregates.
- **Z_Score**: A standard-score value computed as `(value − mean) / stddev` over a rolling window of Monthly_Aggregates.
- **Anomaly**: An Expense_Record or Monthly_Aggregate whose Z_Score exceeds a configurable threshold (default 2.0).
- **Discretionary_Category**: A spending category classified as non-essential and controllable by the user (e.g. Entertainment, Shopping, Dining Out).
- **Fixed_Category**: A spending category classified as recurring and largely non-negotiable (e.g. Rent, Utilities, Insurance, EMI).
- **Savings_Rate**: `(total_income − total_expenses) / total_income × 100` for a given period.
- **Budget_Recommendation**: A suggested monthly spending limit for a category, derived from historical averages and savings-rate targets.
- **Forecast**: A projected Monthly_Aggregate for the next 1–3 months, computed via linear regression or weighted moving average.
- **Insight_Card**: A single rendered UI card presenting one finding (trend, anomaly, recommendation, etc.).

---

## Requirements

### Requirement 1: Navigation Entry Point

**User Story:** As a user, I want an "AI Insights" item in the main navigation bar, so that I can access the insights tab from anywhere in the app.

#### Acceptance Criteria

1. THE Insights_View SHALL add a navigation item labelled "AI Insights" to the existing sidebar/nav bar, positioned directly below the "Dashboard" item.
2. WHEN the user clicks the "AI Insights" nav item, THE Insights_View SHALL display the AI Insights tab panel and hide all other tab panels.
3. WHEN the AI Insights tab is active, THE Insights_View SHALL highlight the "AI Insights" nav item using the same active styling applied to other nav items.
4. THE Insights_View SHALL render the AI Insights tab panel within the existing single-page application layout without a full page reload.

---

### Requirement 2: Data Sufficiency Guard

**User Story:** As a user, I want the insights page to tell me when there is not enough data to generate meaningful analysis, so that I am not confused by empty or misleading results.

#### Acceptance Criteria

1. WHEN `store.get('expenses')` contains fewer than 10 Expense_Records, THE Insights_View SHALL display an empty-state message explaining that at least 10 expense records are needed to generate insights.
2. WHEN `store.get('expenses')` contains fewer than 2 distinct YYYY-MM months of data, THE Insights_View SHALL display a message indicating that at least 2 months of data are required for trend analysis.
3. WHEN sufficient data becomes available (via store update), THE Insights_View SHALL automatically re-render the insights without requiring a manual page refresh.
4. IF `store.get('income')` is empty, THEN THE Insights_View SHALL render all non-income-dependent insights and display a notice that income-based metrics are unavailable.

---

### Requirement 3: Spending Trend Analysis

**User Story:** As a user, I want to see how my spending in each category is trending over time, so that I can identify categories where my costs are rising or falling.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute a Trend_Slope for each category that has Monthly_Aggregates for at least 3 distinct months.
2. WHEN the Trend_Slope for a category is positive and its absolute value exceeds ₹100/month, THE Insights_Engine SHALL classify that category as "Increasing".
3. WHEN the Trend_Slope for a category is negative and its absolute value exceeds ₹100/month, THE Insights_Engine SHALL classify that category as "Decreasing".
4. WHEN the absolute value of the Trend_Slope is ₹100/month or less, THE Insights_Engine SHALL classify that category as "Stable".
5. THE Insights_View SHALL render one Insight_Card per category showing the trend direction, Trend_Slope value, and a sparkline chart of the last 6 Monthly_Aggregates.
6. THE Insights_View SHALL sort trend cards so that "Increasing" categories appear first, followed by "Stable", then "Decreasing".

---

### Requirement 4: Spending Forecasts

**User Story:** As a user, I want to see predicted spending for next month in each category, so that I can plan my budget proactively.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute a Forecast for each category that has Monthly_Aggregates for at least 3 distinct months, using a 3-month weighted moving average (weights: oldest = 1, middle = 2, most recent = 3).
2. THE Insights_Engine SHALL also compute a linear-regression-based Forecast for the same categories and return the higher of the two values as the conservative estimate.
3. THE Insights_View SHALL display the Forecast for each category alongside the category's average monthly spend and the percentage difference between the Forecast and the average.
4. WHEN a Forecast exceeds the corresponding Budget_Record's `monthlyLimit` for the upcoming month, THE Insights_View SHALL highlight that category's forecast card with a warning indicator.
5. THE Insights_View SHALL display a total projected monthly spend by summing all category Forecasts.

---

### Requirement 5: Anomaly Detection

**User Story:** As a user, I want to be alerted when an individual expense or a monthly category total is unusually high, so that I can investigate unexpected charges.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute the Z_Score for each Expense_Record's amount within its category, using the mean and standard deviation of all historical amounts in that category.
2. WHEN an Expense_Record's Z_Score exceeds 2.0, THE Insights_Engine SHALL flag that record as an Anomaly.
3. THE Insights_Engine SHALL compute the Z_Score for each Monthly_Aggregate per category over the available monthly history.
4. WHEN a Monthly_Aggregate's Z_Score exceeds 2.0, THE Insights_Engine SHALL flag that month-category combination as an Anomaly.
5. THE Insights_View SHALL render flagged Anomalies in a dedicated "Unusual Spending" section, showing the expense description (or month label), category, amount, and how many standard deviations above the mean it is.
6. IF a category has fewer than 3 historical data points, THEN THE Insights_Engine SHALL skip Z_Score computation for that category and not flag any records in it as Anomalies.
7. THE Insights_View SHALL sort anomalies by Z_Score descending so the most extreme outliers appear first.

---

### Requirement 6: Discretionary vs. Fixed Category Classification

**User Story:** As a user, I want to see which of my spending categories are discretionary (controllable) vs. fixed (non-negotiable), so that I know where I have room to cut back.

#### Acceptance Criteria

1. THE Insights_Engine SHALL maintain a default classification list that marks the following category name patterns as Fixed_Category: "rent", "mortgage", "emi", "loan", "insurance", "utilities", "electricity", "water", "internet", "subscription", "tax".
2. THE Insights_Engine SHALL classify all categories not matching the Fixed_Category patterns as Discretionary_Category by default.
3. THE Insights_View SHALL display a donut chart showing the proportion of total spending that is Discretionary_Category vs. Fixed_Category for the current month.
4. THE Insights_View SHALL display a list of all categories with their classification badge (Discretionary / Fixed) and their current-month spend.
5. THE Insights_View SHALL display the total discretionary spend and total fixed spend for the current month as summary metrics.
6. WHEN the discretionary spend exceeds 60% of total spend, THE Insights_View SHALL display a contextual tip suggesting the user review discretionary categories.

---

### Requirement 7: Budget Recommendations

**User Story:** As a user, I want the app to suggest monthly budget limits for each category based on my historical spending and a savings target, so that I can set realistic budgets.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute a Budget_Recommendation for each category as the 3-month average Monthly_Aggregate multiplied by a configurable reduction factor (default 0.95, representing a 5% reduction target).
2. WHEN the user's overall Savings_Rate over the last 3 months is below 20%, THE Insights_Engine SHALL apply a stricter reduction factor of 0.85 to all Discretionary_Category Budget_Recommendations.
3. THE Insights_View SHALL display each Budget_Recommendation alongside the category's current Budget_Record limit (if one exists) and the difference between the two.
4. WHEN no Budget_Record exists for a category, THE Insights_View SHALL display the Budget_Recommendation with a prompt to create a budget for that category.
5. THE Insights_View SHALL display a projected Savings_Rate that would result if the user followed all Budget_Recommendations, based on the most recent month's income.
6. THE Insights_View SHALL allow the user to dismiss individual Budget_Recommendations; dismissed recommendations SHALL be stored in `localStorage` and not re-shown until the user resets them.

---

### Requirement 8: Month-over-Month Spending Summary

**User Story:** As a user, I want a concise summary comparing this month's spending to last month's, so that I can quickly gauge whether I am spending more or less overall.

#### Acceptance Criteria

1. THE Insights_Engine SHALL compute the total spend for the current month and the previous month from Expense_Records.
2. THE Insights_Engine SHALL compute the percentage change between the current month's total and the previous month's total.
3. THE Insights_View SHALL display the current month total, previous month total, absolute difference, and percentage change as summary metrics at the top of the AI Insights tab.
4. WHEN the current month's total is higher than the previous month's total, THE Insights_View SHALL render the percentage change in red with an upward arrow icon.
5. WHEN the current month's total is lower than the previous month's total, THE Insights_View SHALL render the percentage change in green with a downward arrow icon.
6. THE Insights_Engine SHALL compute the same month-over-month comparison for each individual category and expose the results for use by the trend cards.

---

### Requirement 9: Top Spending Insights & Personalised Tips

**User Story:** As a user, I want to receive personalised, actionable tips based on my actual spending patterns, so that I can make informed financial decisions.

#### Acceptance Criteria

1. THE Insights_Engine SHALL identify the top 3 categories by spend increase (month-over-month) and expose them as "Watch" categories.
2. THE Insights_Engine SHALL identify the top 3 categories by spend decrease (month-over-month) and expose them as "Well Done" categories.
3. THE Insights_View SHALL render a "Personalised Tips" section containing at least one tip per Watch category, stating the category name, the increase amount, and a suggested action (e.g. "Consider setting a budget for [category]").
4. THE Insights_View SHALL render a positive reinforcement message for each Well Done category.
5. WHEN the user's Savings_Rate for the current month is below 10%, THE Insights_View SHALL display a high-priority tip recommending an immediate review of discretionary spending.
6. WHEN the user has a savings goal in `store.get('savings')` and the projected end-of-month net is insufficient to make progress toward it, THE Insights_View SHALL display a tip linking the shortfall to the relevant savings goal name.

---

### Requirement 10: Insights Refresh and Reactivity

**User Story:** As a user, I want the insights to update automatically when I add or modify expenses, so that the analysis always reflects my latest data.

#### Acceptance Criteria

1. THE Insights_View SHALL subscribe to store change events for `expenses`, `income`, `budgets`, and `savings` keys.
2. WHEN any subscribed store key changes, THE Insights_View SHALL recompute all insights via the Insights_Engine and re-render the full tab within 500ms.
3. THE Insights_View SHALL provide a manual "Refresh Insights" button that triggers the same recompute-and-render cycle.
4. WHILE a recompute is in progress, THE Insights_View SHALL display a loading indicator and disable the "Refresh Insights" button.
5. THE Insights_View SHALL display a "Last updated" timestamp showing when the insights were most recently computed.
