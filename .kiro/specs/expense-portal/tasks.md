# Implementation Plan: Expense Portal

## Overview

Build a client-side SPA using HTML, Bootstrap 5, and vanilla JavaScript (ES modules) that persists data to Google Sheets via the REST API. Implementation proceeds module-by-module, wiring everything together through the shared store and dashboard at the end.

## Tasks

- [x] 1. Project scaffold and configuration
  - Create `index.html` with Bootstrap 5 CDN, Chart.js CDN, and tab navigation skeleton (Dashboard, Expenses, Income, Accounts, Budgets, Savings Goals, Transfers, Vehicles)
  - Create `css/styles.css` with minimal custom styles
  - Create `js/config.js` with the `CONFIG` object (apiKey, spreadsheetId, sheet names)
  - Display a configuration error banner and disable all forms when `apiKey` or `spreadsheetId` is empty
  - _Requirements: 5.1, 5.5_

- [ ] 2. API client (`js/api.js`)
  - [x] 2.1 Implement `appendRow(sheetName, rowValues)` using the Sheets `values.append` endpoint with `valueInputOption=USER_ENTERED`
    - Attach the API key as a query parameter
    - _Requirements: 5.1, 5.2_
  - [x] 2.2 Implement `fetchRows(sheetName)` using the Sheets `values.get` endpoint on the full sheet range
    - Return `string[][]`; return `[]` when the sheet is empty
    - _Requirements: 5.1, 5.3_
  - [x] 2.3 Add 10-second `AbortController` timeout to both methods; re-throw failures as `ApiError { code, message }`
    - _Requirements: 5.6_
  - [ ]* 2.4 Write unit tests for `api.js` (valid config, missing key, HTTP 4xx, network error, timeout)
    - _Requirements: 5.5, 5.6_

- [ ] 3. Shared utilities (`js/store.js`, `js/validation.js`, `js/utils.js`)
  - [x] 3.1 Implement `store.js` with `set`, `get`, `on`, `off` and the full state shape for all nine collections
    - _Requirements: 2.1, 7.1_
  - [x] 3.2 Implement `validation.js`: `requireFields`, `requirePositiveNumber`, `requireFutureDate`, `requireDifferentValues`; each returns `{ valid, errors }`
    - _Requirements: 1.4, 1.5, 1.6, 6.3, 6.4, 6.5, 11.5, 11.6, 13.3, 13.4, 14.3, 14.4, 14.5, 15.3, 15.4, 15.5, 16.3, 16.4, 16.7_
  - [ ]* 3.3 Write property test — Property 1: missing required fields are rejected
    - **Property 1: Missing required fields are rejected**
    - **Validates: Requirements 1.4, 6.3, 11.5, 13.3, 14.3, 15.3, 16.3, 16.7**
  - [ ]* 3.4 Write property test — Property 2: non-positive amounts are rejected
    - **Property 2: Non-positive amounts are rejected**
    - **Validates: Requirements 1.5, 1.6, 6.4, 6.5, 11.6, 13.4, 14.4, 15.4, 16.4**
  - [ ]* 3.5 Write property test — Property 3: past target dates are rejected for savings goals
    - **Property 3: Past target dates are rejected for savings goals**
    - **Validates: Requirements 14.5**
  - [ ]* 3.6 Write property test — Property 4: same source and destination transfer is rejected
    - **Property 4: Same source and destination transfer is rejected**
    - **Validates: Requirements 15.5**
  - [x] 3.7 Implement `utils.js`: `formatDate`, `formatCurrency`, `getCurrentMonth` (returns `YYYY-MM`), `isInCurrentMonth(dateStr)`
    - _Requirements: 4.1, 9.1, 9.2, 9.3_

- [ ] 4. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Expense module (`js/expenses.js`)
  - [x] 5.1 Implement `serialize` / `deserialize` for `ExpenseRecord`
    - _Requirements: 5.2, 5.3, 5.4_
  - [ ]* 5.2 Write property test — Property 5 (ExpenseRecord): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 5.4**
  - [x] 5.3 Implement `init()`: bind expense form submit, validate with `validation.js`, call `appendRow`, re-fetch, call `store.set('expenses', ...)`, reset form on success; show inline Bootstrap `is-invalid` errors on failure
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 2.5, 2.7_
  - [x] 5.4 Implement `render()`: read from store, sort by date descending, render table rows; show empty state when collection is empty
    - _Requirements: 2.2, 2.3, 2.6_
  - [x] 5.5 Implement category filter and date range filter; validate end >= start before applying; implement clear-filters action
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 5.6 Write property test — Property 6: records sorted by date descending
    - **Property 6: Records are displayed sorted by date descending**
    - **Validates: Requirements 2.6**
  - [ ]* 5.7 Write property test — Property 7: category filter returns only matching records
    - **Property 7: Category filter returns only matching records**
    - **Validates: Requirements 3.2**
  - [ ]* 5.8 Write property test — Property 8: date range filter returns only records within range
    - **Property 8: Date range filter returns only records within range**
    - **Validates: Requirements 3.4**
  - [ ]* 5.9 Write property test — Property 9: clearing filters restores all records
    - **Property 9: Clearing filters restores all records**
    - **Validates: Requirements 3.5**

- [ ] 6. Income module (`js/income.js`)
  - [x] 6.1 Implement `serialize` / `deserialize` for `IncomeRecord`
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ]* 6.2 Write property test — Property 5 (IncomeRecord): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 10.3**
  - [x] 6.3 Implement `init()` and `render()` mirroring the expense module; include source filter and date range filter
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ]* 6.4 Write property test — Property 8 (income): date range filter returns only records within range
    - **Property 8: Date range filter returns only records within range**
    - **Validates: Requirements 8.4**

- [ ] 7. Accounts module (`js/accounts.js`)
  - [x] 7.1 Implement `serialize` / `deserialize` for `Account` and `CreditCard`
    - _Requirements: 11.8_
  - [ ]* 7.2 Write property test — Property 5 (Account, CreditCard): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 11.8**
  - [x] 7.3 Implement `init()`: bind account form and credit card form submits; validate; save via `appendRow`; re-fetch; update store; render list
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - [x] 7.4 Implement `render()`: display accounts list and credit cards list; show empty states
    - _Requirements: 11.7_
  - [x] 7.5 Expose `getPaymentMethodOptions()` returning combined account names + credit card names for use by the expense form dropdown
    - _Requirements: 1.2_
  - [ ]* 7.6 Write property test — Property 24: payment method dropdown options match saved accounts and credit cards
    - **Property 24: Payment method dropdown options match saved accounts and credit cards**
    - **Validates: Requirements 1.2**

- [ ] 8. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Budgets module (`js/budgets.js`)
  - [x] 9.1 Implement `serialize` / `deserialize` for `BudgetRecord`
    - _Requirements: 13.9_
  - [ ]* 9.2 Write property test — Property 5 (BudgetRecord): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 13.9**
  - [x] 9.3 Implement `init()` and `render()`: budget form with category, monthly limit, and month fields; validate; save; display budget list
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [ ]* 9.4 Write property test — Property 18: budget vs actual correctly computes actual spending per category per month
    - **Property 18: Budget vs actual correctly computes actual spending per category per month**
    - **Validates: Requirements 13.5, 13.8**
  - [ ]* 9.5 Write property test — Property 19: budget warning shown when actual spending reaches 80% of limit
    - **Property 19: Budget warning shown when actual spending reaches 80% of limit**
    - **Validates: Requirements 13.6**
  - [ ]* 9.6 Write property test — Property 20: budget exceeded indicator shown when actual spending exceeds limit
    - **Property 20: Budget exceeded indicator shown when actual spending exceeds limit**
    - **Validates: Requirements 13.7**

- [ ] 10. Savings Goals module (`js/savings.js`)
  - [x] 10.1 Implement `serialize` / `deserialize` for `SavingsGoal`
    - _Requirements: 14.9_
  - [ ]* 10.2 Write property test — Property 5 (SavingsGoal): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 14.9**
  - [x] 10.3 Implement `init()` and `render()`: savings goal form; validate (positive amount, future date); save; display goals with progress bar, remaining amount, and completion indicator
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_
  - [ ]* 10.4 Write property test — Property 21: savings goal progress and remaining amount are correctly computed
    - **Property 21: Savings goal progress and remaining amount are correctly computed**
    - **Validates: Requirements 14.6**
  - [ ]* 10.5 Write property test — Property 22: savings goal completion indicator shown when saved amount meets target
    - **Property 22: Savings goal completion indicator shown when saved amount meets target**
    - **Validates: Requirements 14.8**

- [ ] 11. Transfers module (`js/transfers.js`)
  - [x] 11.1 Implement `serialize` / `deserialize` for `TransferRecord`
    - _Requirements: 15.9_
  - [ ]* 11.2 Write property test — Property 5 (TransferRecord): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 15.9**
  - [x] 11.3 Implement `init()` and `render()`: transfer form with source/destination dropdowns populated from accounts; validate (positive amount, different accounts); save; display transfers list sorted by date descending
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8_
  - [ ]* 11.4 Write property test — Property 6 (transfers): records sorted by date descending
    - **Property 6: Records are displayed sorted by date descending**
    - **Validates: Requirements 15.8**

- [ ] 12. Vehicles module (`js/vehicles.js`)
  - [x] 12.1 Implement `serialize` / `deserialize` for `VehicleTripLog` and `VehicleExpenseRecord`
    - _Requirements: 16.11_
  - [ ]* 12.2 Write property test — Property 5 (VehicleTripLog, VehicleExpenseRecord): round-trip serialization
    - **Property 5: All record types round-trip through serialization**
    - **Validates: Requirements 16.11**
  - [x] 12.3 Implement trip log form: validate (required fields, positive distance and fuel cost); save; render trip log table sorted by date descending
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.8_
  - [x] 12.4 Implement vehicle expense form: validate (required fields); save; render vehicle expense table sorted by date descending
    - _Requirements: 16.5, 16.6, 16.7, 16.9_
  - [x] 12.5 Implement monthly summary: sum distance, fuel cost (from trip logs), and amount (from vehicle expenses) for the current calendar month
    - _Requirements: 16.10_
  - [ ]* 12.6 Write property test — Property 25: vehicle monthly summary correctly aggregates current-month records
    - **Property 25: Vehicle monthly summary correctly aggregates current-month records**
    - **Validates: Requirements 16.10**
  - [ ]* 12.7 Write property test — Property 6 (vehicles): records sorted by date descending
    - **Property 6: Records are displayed sorted by date descending**
    - **Validates: Requirements 16.8, 16.9**

- [ ] 13. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 14. Dashboard module (`js/dashboard.js`)
  - [x] 14.1 Subscribe to all store keys; on any change recalculate monthly income total, monthly expense total, and net balance for the current calendar month; render with deficit styling when net balance is negative
    - _Requirements: 4.1, 9.1, 9.2, 9.3, 9.4, 9.7_
  - [ ]* 14.2 Write property test — Property 10: dashboard monthly expense total equals sum of current-month expense amounts
    - **Property 10: Dashboard monthly expense total equals sum of current-month expense amounts**
    - **Validates: Requirements 4.1, 9.2**
  - [ ]* 14.3 Write property test — Property 11: dashboard monthly income total equals sum of current-month income amounts
    - **Property 11: Dashboard monthly income total equals sum of current-month income amounts**
    - **Validates: Requirements 9.1**
  - [ ]* 14.4 Write property test — Property 12: net balance equals total income minus total expenses
    - **Property 12: Net balance equals total income minus total expenses**
    - **Validates: Requirements 9.3**
  - [x] 14.5 Render category spending breakdown and income-per-source breakdown
    - _Requirements: 4.2, 9.6_
  - [ ]* 14.6 Write property test — Property 14: category spending breakdown correctly sums amounts
    - **Property 14: Category spending breakdown correctly sums amounts**
    - **Validates: Requirements 4.2**
  - [ ]* 14.7 Write property test — Property 13: income per source breakdown correctly sums amounts
    - **Property 13: Income per source breakdown correctly sums amounts**
    - **Validates: Requirements 9.6**
  - [x] 14.8 Render Chart.js pie/doughnut chart for category spend and bar chart for 6-month income vs expense; store chart instances in module scope and update via `chart.update()` on re-render
    - _Requirements: 4.3, 4.4, 9.5_
  - [x] 14.9 Render budget vs actual section: for each budget record compute actual spending, show warning at ≥80% and exceeded indicator when over limit
    - _Requirements: 13.5, 13.6, 13.7, 13.8_
  - [x] 14.10 Render credit card utilization progress bars; show warning when balance ≥ credit limit
    - _Requirements: 12.2, 12.3, 12.4, 12.5_
  - [ ]* 14.11 Write property test — Property 15: credit card outstanding balance equals sum of matching expenses
    - **Property 15: Credit card outstanding balance equals sum of matching expenses**
    - **Validates: Requirements 12.1, 12.4**
  - [ ]* 14.12 Write property test — Property 16: credit card utilization equals balance divided by credit limit
    - **Property 16: Credit card utilization equals balance divided by credit limit**
    - **Validates: Requirements 12.2**
  - [ ]* 14.13 Write property test — Property 17: credit card at or over limit triggers warning
    - **Property 17: Credit card at or over limit triggers warning**
    - **Validates: Requirements 12.5**
  - [ ]* 14.14 Write property test — Property 23: transfer amounts are excluded from expense and income totals
    - **Property 23: Transfer amounts are excluded from expense and income totals**
    - **Validates: Requirements 15.7**
  - [x] 14.15 Render zero values and empty chart states when no records exist
    - _Requirements: 4.6, 9.8_

- [x] 15. Wire everything together in `index.html`
  - [x] 15.1 Import all modules as `<script type="module">`; call `init()` on each module after DOM ready; load all data collections from Google Sheets on startup and populate the store
    - _Requirements: 2.1, 7.1_
  - [x] 15.2 Wire the expense form payment method dropdown to `accounts.getPaymentMethodOptions()`; re-populate dropdown whenever the accounts store key changes
    - _Requirements: 1.2_
  - [x] 15.3 Wire transfer form source/destination dropdowns to the accounts store in the same way
    - _Requirements: 15.1_
  - [x] 15.4 Implement shared `showError(message)` utility and wire all module API error handlers to it
    - _Requirements: 2.4, 2.5, 7.4, 10.4_

- [ ] 16. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use [fast-check](https://github.com/dubzzz/fast-check) with a minimum of 100 iterations each
- Each property test file should include the tag comment: `// Feature: expense-portal, Property N: <property_text>`
- Unit tests live in `tests/api.test.js` and cover config errors, HTTP errors, network errors, and timeout behavior
- All chart instances are stored in module scope and updated via `chart.update()` to avoid re-creating canvas elements
