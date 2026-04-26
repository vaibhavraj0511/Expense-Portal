# Expense Portal — User Guide

Quick reference for every section. Data is never deleted from Google Sheets unless you manually delete an entry — "hidden" means the app stops loading it.

---

## 1. Dashboard
Overview of your financial health. Read-only — no data entry here.
- **Net Worth** = Total assets (accounts + savings) − liabilities (credit card debt + outstanding borrowed amounts)
- **Spend Rate** = Projected monthly spend based on your daily average so far
- **Savings Rate** = % of income saved this month (target: 20%+)
- **Charts** = Monthly income vs expense, category breakdown, savings rate trend, spending heatmap
- **Daily Spending Profile** = How many days this month you spent ₹0 / ₹1–₹99 / ₹100–₹499 / ₹500–₹999 / ₹1k–₹4.9k / ₹5000+, split by weekdays and weekends (see [Daily Spending Profile](#daily-spending-profile) below)
- **Spending Insights** = Month-over-month changes per category

---

## 2. Expenses
Record every outgoing payment.
- Linked to an **Account** or **Credit Card** → balance is auto-debited
- **Category + Sub-category** used across Budgets, Tax Summary, and AI Insights
- Filter by date range, category, or payment method

---

## 3. Income
Record every incoming payment.
- Linked to a **Received In** account → balance is auto-credited
- Source used for Salary Splitter and AI Insights

---

## 4. Accounts
Manage bank accounts and credit cards.
- **Account balance** changes automatically when you add expenses/income/transfers/lendings linked to it
- **Credit Card**: tracks spent vs payments; net outstanding shows as a liability in Net Worth
- You can manually adjust balance if needed

---

## 5. Budgets
Set monthly spending limits per category.
- **Auto-roll**: at the start of each month a new budget period is automatically created based on your template
- Shows actual vs budgeted spend in real time
- Overspent budgets show in red

---

## 6. Savings Goals
Track progress toward a financial target.
- Does **not** auto-debit — you manually add contributions
- **Archive rule**: goal is 100% complete AND target date is older than **2 years** → hidden from app (still in sheet)

---

## 7. Transfers
Move money between your own accounts.
- Debits the **From** account and credits the **To** account automatically
- Useful for salary credit, internal fund moves

---

## 8. Recurring
Auto-create expense or income entries on a schedule.
- Frequencies: **Weekly / Monthly / Yearly**
- **Runs automatically every time the app loads** — if a due date was missed since last login, it backdates and creates the entry
- Can be **paused** without deleting
- Deducts from linked account automatically (same as regular expense/income)
- No archive rule — stays active until you delete it

---

## 9. Bills
Track regular bills (electricity, rent, internet etc.)
- Mark a bill as **paid** to log it; does not auto-debit unless linked to Recurring
- **Archive rule**: bill is marked **inactive** AND last paid date is older than **2 years** → hidden from app

---

## 10. Lendings & Borrowings
Track money you lent to or borrowed from people.
- **I Lent** → auto-creates an expense in linked account (money left your account)
- **I Borrowed** → auto-creates an income in linked account (money entered your account)
- **Settlement** → reverse entry: repayment of lent money credits back, repayment of borrowed money debits account
- Stat cards (I'm Owed / I Owe / Pending) are **clickable** — shows per-person breakdown
- Click any person's name in People Summary → full transaction history with running balance
- **Archive rule**: entry is **fully settled** AND entry date is older than **6 months** → hidden from app

---

## 11. Split Expenses
Split a shared bill among multiple people.
- When you save a split, it **automatically creates Lending entries** for each participant:
  - If you paid → creates "I Lent" entries for each person's share
  - If someone else paid → creates "I Borrowed" entry for your share
- Settle splits via the **Lendings section** (not from here)
- Status shows **Settled** (green) only when all linked lending entries are fully settled
- **Archive rule**: all participants fully settled AND split date is older than **6 months** → hidden from app

---

## 12. Investments
Track stocks, mutual funds, FDs, gold etc.
- Manual entry — no live price feed
- Tracks invested amount vs current value
- Returns calculated as (current − invested) / invested

---

## 13. Loans
Track institutional loans (home, car, personal).
- Enter principal, interest rate, tenure → EMI is auto-calculated
- Generates full repayment schedule
- Outstanding amount appears as liability in Net Worth
- No auto-debit — mark EMIs paid manually

---

## 14. Subscriptions
Track monthly/yearly subscriptions (Netflix, Spotify etc.)
- Calculates monthly equivalent cost for yearly plans
- **Pagination**: 12 subscriptions per page
- No auto-debit — reminder only

---

## 15. Vehicles
Track vehicle expenses, trips, maintenance, insurance, documents.
- **Trip Log** tracks fuel efficiency (km/litre)
- **Maintenance** tracks upcoming service due dates
- **Documents** tracks expiry dates (insurance, PUC, RC)
- No auto-debit

---

## 16. Cash Flow
Visual timeline of income vs expenses by month.
- Read-only — pulls from Expenses and Income sections
- No data entry here

---

## 17. Financial Calendar
Calendar view showing bills due, recurring entries, loan EMIs.
- Read-only — aggregates events from Bills, Recurring, Loans
- Helps plan upcoming payments

---

## 18. Tax Summary
Annual tax overview based on your income and expense categories.
- Reads from Income and Expenses
- Categories like "Medical", "Investment" can be mapped to tax deductions
- No data entry here

---

## 19. Salary Splitter
Plan how to allocate your monthly income across categories.
- Enter your income → set % or fixed amounts for each bucket (rent, savings, food etc.)
- Does **not** create any actual entries — planning tool only

---

## 20. AI Insights
Local smart analysis — no external API needed. Reads all your expenses, income, budgets, and savings.

Sections shown:
- **Spending Velocity** — how fast you are spending vs time elapsed this month
- **Financial Health Score** — overall score out of 100 based on savings rate, budget adherence, consistency
- **Unusual Spending** — transactions/months that are statistical anomalies (z-score based)
- **Biggest Transactions** — top 5 transactions this month by amount
- **What If?** — how much you could save by cutting top discretionary categories by 20%
- **Next Month Forecast** — predicted spend per category based on your trend
- **Goal Completion Estimates** — when you will reach each savings goal at your current pace
- **Budget Recommendations** — suggested monthly limits for unbudgeted categories
- **Category Trends** — 3-month growth or decline per category
- **Recurring Expenses** — auto-detected fixed monthly costs from description patterns
- **Daily Spending Profile** — tier breakdown with weekday vs weekend split (see below)
- **Spending by Day of Week** — which day of the week you spend the most (all-time)
- **Year-over-Year** — same month this year vs last year (shown only if last year data exists)
- **Income Allocation** — % of income spent per category
- **Personalised Tips** — actionable suggestions based on your data

---

## 21. Analytics
Visual reports across all your financial data. Responds to the **3M / 6M / 1Y** period filter at the top.

- **Daily Spending Profile** — current month tier breakdown + month-by-month table (rows = tiers, columns = months)
- **Category Spending Trend** — top 6 categories plotted month-over-month as lines
- **Monthly Spending** — bar chart; green = below average, red = above average
- **Payment Method Split** — donut chart of spend by cash/UPI/card etc.
- **Top Subcategories** — horizontal bar of top 10 sub-categories by spend
- **Budget Health** — spent vs limit for every budget this month
- **Vehicle Analytics** — mileage trend, monthly vehicle cost, cost split
- **Lending Summary** — net balance per person (positive = they owe you)
- **Subscription Breakdown** — monthly cost per service + total

---

## 22. Categories
Manage expense categories and income sources.
- Add, edit, or delete custom categories used in Expenses and Budgets
- Changes reflect immediately across all sections that use categories
- Default categories cannot be deleted

---

## 23. Trips
Track trip-based expenses and split costs.
- Create a trip → add expenses under it
- Split costs with friends directly from the trip view
- Generates per-person summary of who owes what
- Linked to Lendings — settlements handled from the Lendings section

---

## 24. Staff / Maid
Track domestic staff attendance and salary.
- Mark daily attendance (Present / Absent / Half Day)
- Auto-calculates monthly salary based on attendance and daily rate
- Salary deduction for absent days is automatic

---

## Daily Spending Profile

Shown on **Dashboard**, **AI Insights**, and **Analytics**. Classifies every calendar day of the current month (or selected month in Analytics) into one of 6 tiers based on total spending that day:

| Emoji | Tier | Range | Meaning |
|-------|------|-------|----------|
| 🟢 | Rest Day | ₹0 | No spending at all |
| ☕ | Chai Day | ₹1–₹99 | Minimal spend — chai, snacks |
| 🛒 | Light Day | ₹100–₹499 | Light spend — grocery, transit |
| 🍽 | Dining Day | ₹500–₹999 | Moderate — eating out |
| 🛍 | Shopping Day | ₹1k–₹4.9k | Heavy — shopping or big purchase |
| 💸 | Big Spend | ₹5000+ | Large transaction day |

Each badge also shows how many of those days were **weekdays (Mon–Fri)** vs **weekends (Sat–Sun)**.

**Analytics** additionally shows a month-by-month breakdown table so you can compare your spending behaviour across months.

---

## Archive & Auto-Hide Rules Summary

| Section | Hidden when | Threshold |
|---|---|---|
| Savings Goals | Completed (100%) | Target date > **2 years** ago |
| Bills | Marked inactive | Last paid > **2 years** ago |
| Lendings | Fully settled | Entry date > **6 months** ago |
| Split Expenses | All participants settled | Split date > **6 months** ago |

> **Important:** Hidden entries are **never deleted** from Google Sheets. The app just stops loading them to reduce clutter. You can always view the raw data in your sheet.

---

## Auto-Debit / Auto-Credit Summary

| Action | Auto Effect |
|---|---|
| Add Expense with account | Account balance **debited** |
| Add Income with account | Account balance **credited** |
| Add Transfer | From account **debited**, To account **credited** |
| Add Lending (I Lent) with account | Account balance **debited** |
| Add Lending (I Borrowed) with account | Account balance **credited** |
| Record Settlement on Lent | Account balance **credited** (money back) |
| Record Settlement on Borrowed | Account balance **debited** (money paid back) |
| Recurring due date reached | Expense/Income **auto-created** on next app load |
| Create Split Expense | **Lending entries auto-created** for all participants |
