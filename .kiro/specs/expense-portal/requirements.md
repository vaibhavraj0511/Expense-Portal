# Requirements Document

## Introduction

The Expense Portal is a client-side web application built with HTML, CSS, Bootstrap, and JavaScript. It allows users to log expenses and income via forms, store and retrieve financial data through the Google Sheets API, and view summarized data on a dashboard with charts including net balance and income vs expense comparisons.

## Glossary

- **Expense_Portal**: The web application described in this document
- **Expense_Form**: The UI component that collects expense entry data from the user
- **Expense_Record**: A single expense entry consisting of date, category, amount, description, and payment method
- **Google_Sheets_API**: The Google Sheets REST API used as the data backend
- **Dashboard**: The UI view that displays expense summaries and charts
- **Chart**: A visual representation of expense data (e.g., bar chart, pie chart)
- **Category**: A label classifying the type of expense (e.g., Food, Travel, Utilities)
- **Spreadsheet**: The Google Sheets document used to store Expense_Records
- **API_Client**: The JavaScript module responsible for communicating with the Google_Sheets_API
- **Income_Record**: A single income entry consisting of date, source, amount, and description
- **Income_Form**: The UI component that collects income entry data from the user
- **Source**: A label classifying the origin of income (e.g., Salary, Freelance, Investment)
- **Net_Balance**: The result of total income minus total expenses for a given period
- **Account**: A financial account owned by the user (e.g., savings account, checking account, cash wallet)
- **Payment_Method**: The account or credit card selected when recording an Expense_Record
- **Credit_Card**: A credit card account with a defined credit limit owned by the user
- **Credit_Limit**: The maximum borrowing amount assigned to a Credit_Card
- **Utilization**: The ratio of the current outstanding balance on a Credit_Card to its Credit_Limit
- **Budget**: A user-defined spending limit for a specific Category within a calendar month
- **Budget_Record**: A single budget entry consisting of category, monthly limit amount, and the month it applies to
- **Savings_Goal**: A user-defined financial target consisting of a name, target amount, target date, and current saved amount
- **Transfer_Record**: A record of money moved from one Account to another that is neither an expense nor income
- **Vehicle_Trip_Log**: A record of a vehicle trip consisting of date, distance, fuel cost, and purpose
- **Vehicle_Expense_Record**: A record of a vehicle-specific expense such as maintenance, insurance, or fuel fill-up
- **Mileage_Section**: The UI section dedicated to displaying vehicle trip logs and vehicle expense summaries

## Requirements

### Requirement 1: Expense Entry Form

**User Story:** As a user, I want to fill out a form to add a new expense, so that I can record my spending quickly.

#### Acceptance Criteria

1. THE Expense_Form SHALL include fields for date, category, amount, description, and payment method.
2. THE Expense_Form SHALL provide a dropdown for payment method populated from the user's saved Accounts and Credit_Cards.
3. WHEN the user submits the Expense_Form with all required fields filled, THE Expense_Portal SHALL send the Expense_Record to the Spreadsheet via the Google_Sheets_API.
4. WHEN the user submits the Expense_Form with one or more required fields empty, THE Expense_Form SHALL display a validation error message identifying the missing fields.
5. WHEN the user enters a non-numeric value in the amount field, THE Expense_Form SHALL display a validation error message indicating that amount must be a positive number.
6. WHEN the user enters an amount less than or equal to zero, THE Expense_Form SHALL display a validation error message indicating that amount must be greater than zero.
7. WHEN an Expense_Record is successfully saved, THE Expense_Form SHALL reset all fields to their default empty state.
8. THE Expense_Form SHALL provide a predefined list of Category options for the user to select from.

### Requirement 2: Fetch and Display Expense Data

**User Story:** As a user, I want to see all my recorded expenses in a table, so that I can review my spending history.

#### Acceptance Criteria

1. WHEN the Expense_Portal loads, THE API_Client SHALL fetch all Expense_Records from the Spreadsheet via the Google_Sheets_API.
2. WHEN Expense_Records are successfully fetched, THE Expense_Portal SHALL display the records in a tabular format showing date, category, amount, and description.
3. WHEN the Spreadsheet contains no Expense_Records, THE Expense_Portal SHALL display an empty state message indicating no expenses have been recorded.
4. IF the Google_Sheets_API returns an error during fetch, THEN THE Expense_Portal SHALL display an error message describing the failure and SHALL NOT render partial data.
5. IF the Google_Sheets_API returns an error during save, THEN THE Expense_Portal SHALL display an error message and SHALL retain the user's form input so the user can retry.
6. THE Expense_Portal SHALL display Expense_Records sorted by date in descending order.
7. WHEN a new Expense_Record is successfully saved, THE API_Client SHALL re-fetch all Expense_Records and refresh the displayed table.

### Requirement 3: Expense Data Filtering

**User Story:** As a user, I want to filter the expense list by category or date range, so that I can find specific expenses easily.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a Category filter control that allows the user to select one or more categories.
2. WHEN the user applies a Category filter, THE Expense_Portal SHALL display only Expense_Records matching the selected categories.
3. THE Expense_Portal SHALL provide a date range filter with a start date and end date input.
4. WHEN the user applies a date range filter, THE Expense_Portal SHALL display only Expense_Records whose date falls within the specified range (inclusive).
5. WHEN the user clears all filters, THE Expense_Portal SHALL display all Expense_Records.
6. WHEN the user sets an end date earlier than the start date, THE Expense_Portal SHALL display a validation error and SHALL NOT apply the filter.

### Requirement 4: Dashboard with Expense Summaries

**User Story:** As a user, I want to see a summary dashboard with charts, so that I can understand my spending patterns at a glance.

#### Acceptance Criteria

1. THE Dashboard SHALL display the total amount of all Expense_Records for the current calendar month.
2. THE Dashboard SHALL display a breakdown of total spending per Category.
3. THE Dashboard SHALL render a pie or doughnut Chart showing the proportion of spending per Category.
4. THE Dashboard SHALL render a bar Chart showing total spending per month for the last 6 calendar months.
5. WHEN Expense_Records are updated (after a new save or re-fetch), THE Dashboard SHALL recalculate and re-render all summary values and Charts.
6. WHEN no Expense_Records exist, THE Dashboard SHALL display zero values for all summaries and render empty Chart states.

### Requirement 5: Google Sheets API Integration

**User Story:** As a developer, I want the application to read and write data through the Google Sheets API, so that expense data is persisted without a dedicated backend server.

#### Acceptance Criteria

1. THE API_Client SHALL authenticate with the Google_Sheets_API using an API key configured at application startup.
2. WHEN appending an Expense_Record, THE API_Client SHALL write a new row to the Spreadsheet containing date, category, amount, description, and payment method in that column order.
3. WHEN fetching Expense_Records, THE API_Client SHALL read all rows from the designated data range in the Spreadsheet and parse each row into an Expense_Record.
4. THE API_Client SHALL serialize Expense_Records to the Spreadsheet row format and deserialize Spreadsheet rows back to Expense_Records (round-trip property: parse(format(record)) produces an equivalent Expense_Record).
5. IF the API key is missing or invalid at startup, THEN THE Expense_Portal SHALL display a configuration error message and SHALL disable the Expense_Form and Dashboard.
6. THE API_Client SHALL include the request timeout, and IF a request exceeds 10 seconds without a response, THEN THE API_Client SHALL cancel the request and return a timeout error.

### Requirement 6: Income Entry Form

**User Story:** As a user, I want to fill out a form to add a new income entry, so that I can record my earnings alongside my expenses.

#### Acceptance Criteria

1. THE Income_Form SHALL include fields for date, source, amount, and description.
2. WHEN the user submits the Income_Form with all required fields filled, THE Expense_Portal SHALL send the Income_Record to the Spreadsheet via the Google_Sheets_API.
3. WHEN the user submits the Income_Form with one or more required fields empty, THE Income_Form SHALL display a validation error message identifying the missing fields.
4. WHEN the user enters a non-numeric value in the amount field, THE Income_Form SHALL display a validation error message indicating that amount must be a positive number.
5. WHEN the user enters an amount less than or equal to zero, THE Income_Form SHALL display a validation error message indicating that amount must be greater than zero.
6. WHEN an Income_Record is successfully saved, THE Income_Form SHALL reset all fields to their default empty state.
7. THE Income_Form SHALL provide a predefined list of Source options for the user to select from.

### Requirement 7: Fetch and Display Income Data

**User Story:** As a user, I want to see all my recorded income entries in a table, so that I can review my earnings history.

#### Acceptance Criteria

1. WHEN the Expense_Portal loads, THE API_Client SHALL fetch all Income_Records from the Spreadsheet via the Google_Sheets_API.
2. WHEN Income_Records are successfully fetched, THE Expense_Portal SHALL display the records in a tabular format showing date, source, amount, and description.
3. WHEN the Spreadsheet contains no Income_Records, THE Expense_Portal SHALL display an empty state message indicating no income has been recorded.
4. IF the Google_Sheets_API returns an error during Income_Record fetch, THEN THE Expense_Portal SHALL display an error message describing the failure and SHALL NOT render partial data.
5. THE Expense_Portal SHALL display Income_Records sorted by date in descending order.
6. WHEN a new Income_Record is successfully saved, THE API_Client SHALL re-fetch all Income_Records and refresh the displayed income table.

### Requirement 8: Income Data Filtering

**User Story:** As a user, I want to filter the income list by source or date range, so that I can find specific income entries easily.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a Source filter control that allows the user to select one or more income sources.
2. WHEN the user applies a Source filter, THE Expense_Portal SHALL display only Income_Records matching the selected sources.
3. THE Expense_Portal SHALL provide a date range filter for income with a start date and end date input.
4. WHEN the user applies a date range filter to income, THE Expense_Portal SHALL display only Income_Records whose date falls within the specified range (inclusive).
5. WHEN the user clears all income filters, THE Expense_Portal SHALL display all Income_Records.
6. WHEN the user sets an end date earlier than the start date on the income filter, THE Expense_Portal SHALL display a validation error and SHALL NOT apply the filter.

### Requirement 9: Dashboard with Income, Expense, and Net Balance Summaries

**User Story:** As a user, I want the dashboard to show both income and expenses with a net balance, so that I can understand my overall financial position at a glance.

#### Acceptance Criteria

1. THE Dashboard SHALL display the total income amount from all Income_Records for the current calendar month.
2. THE Dashboard SHALL display the total expense amount from all Expense_Records for the current calendar month.
3. THE Dashboard SHALL display the Net_Balance for the current calendar month, calculated as total income minus total expenses.
4. WHEN the Net_Balance is negative, THE Dashboard SHALL render the Net_Balance value in a visually distinct style to indicate a deficit.
5. THE Dashboard SHALL render a bar Chart comparing total income against total expenses per month for the last 6 calendar months.
6. THE Dashboard SHALL render a breakdown of total income per Source alongside the existing breakdown of total spending per Category.
7. WHEN Expense_Records or Income_Records are updated (after a new save or re-fetch), THE Dashboard SHALL recalculate and re-render all summary values, Net_Balance, and Charts.
8. WHEN no Income_Records exist, THE Dashboard SHALL display zero for all income summaries and render empty income Chart states.

### Requirement 10: Google Sheets API Integration for Income Records

**User Story:** As a developer, I want income data to be read and written through the Google Sheets API, so that income entries are persisted in the same backend as expenses.

#### Acceptance Criteria

1. WHEN appending an Income_Record, THE API_Client SHALL write a new row to a designated income range in the Spreadsheet containing date, source, amount, and description in that column order.
2. WHEN fetching Income_Records, THE API_Client SHALL read all rows from the designated income data range in the Spreadsheet and parse each row into an Income_Record.
3. THE API_Client SHALL serialize Income_Records to the Spreadsheet row format and deserialize Spreadsheet rows back to Income_Records (round-trip property: parse(format(record)) produces an equivalent Income_Record).
4. IF the Google_Sheets_API returns an error during Income_Record save, THEN THE Expense_Portal SHALL display an error message and SHALL retain the user's Income_Form input so the user can retry.

### Requirement 11: Account and Payment Method Management

**User Story:** As a user, I want to add accounts and credit cards as payment methods, so that I can track which account or card was used for each expense.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a form to add an Account with fields for account name and account type (e.g., savings, checking, cash wallet).
2. THE Expense_Portal SHALL provide a form to add a Credit_Card with fields for card name and Credit_Limit.
3. WHEN the user submits an account form with all required fields filled, THE Expense_Portal SHALL save the Account to the Spreadsheet via the Google_Sheets_API.
4. WHEN the user submits a credit card form with all required fields filled, THE Expense_Portal SHALL save the Credit_Card to the Spreadsheet via the Google_Sheets_API.
5. WHEN the user submits an account or credit card form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
6. WHEN the user submits a credit card form with a Credit_Limit less than or equal to zero, THE Expense_Portal SHALL display a validation error indicating that Credit_Limit must be a positive number.
7. THE Expense_Portal SHALL display a list of all saved Accounts and Credit_Cards.
8. THE API_Client SHALL serialize Account records and Credit_Card records to the Spreadsheet row format and deserialize rows back to the respective record types (round-trip property: parse(format(record)) produces an equivalent record).

### Requirement 12: Credit Card Utilization Tracking

**User Story:** As a user, I want to see the current utilization of each credit card, so that I can monitor how much of my credit limit I have used.

#### Acceptance Criteria

1. THE Expense_Portal SHALL calculate the current outstanding balance for each Credit_Card as the sum of all Expense_Records whose Payment_Method is that Credit_Card.
2. THE Expense_Portal SHALL display each Credit_Card with its card name, Credit_Limit, current outstanding balance, and Utilization percentage.
3. THE Dashboard SHALL render a visual indicator (e.g., progress bar) for each Credit_Card showing Utilization relative to Credit_Limit.
4. WHEN an Expense_Record with a Credit_Card as Payment_Method is saved, THE Expense_Portal SHALL recalculate and update the Utilization for that Credit_Card.
5. WHEN a Credit_Card's outstanding balance equals or exceeds its Credit_Limit, THE Expense_Portal SHALL display a visual warning on that Credit_Card's utilization indicator.

### Requirement 13: Budget Management

**User Story:** As a user, I want to set a monthly spending budget per category, so that I can control my spending and be warned when I am approaching or exceeding my limits.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a form to create a Budget_Record with fields for category, monthly limit amount, and the applicable month.
2. WHEN the user submits the budget form with all required fields filled, THE Expense_Portal SHALL save the Budget_Record to the Spreadsheet via the Google_Sheets_API.
3. WHEN the user submits the budget form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
4. WHEN the user enters a monthly limit amount less than or equal to zero, THE Expense_Portal SHALL display a validation error indicating that the budget amount must be a positive number.
5. THE Dashboard SHALL display each Budget_Record alongside the actual total spending for that Category in the applicable month.
6. WHEN actual spending for a Category reaches 80 percent or more of the Budget_Record monthly limit, THE Dashboard SHALL display a warning indicator for that Category budget.
7. WHEN actual spending for a Category exceeds the Budget_Record monthly limit, THE Dashboard SHALL display an exceeded indicator for that Category budget.
8. WHEN Expense_Records are updated, THE Dashboard SHALL recalculate and re-render all budget vs actual comparisons.
9. THE API_Client SHALL serialize Budget_Records to the Spreadsheet row format and deserialize rows back to Budget_Records (round-trip property: parse(format(record)) produces an equivalent Budget_Record).

### Requirement 14: Savings Goals

**User Story:** As a user, I want to set savings goals with a target amount and date, so that I can track my progress toward financial targets.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a form to create a Savings_Goal with fields for goal name, target amount, target date, and initial saved amount.
2. WHEN the user submits the savings goal form with all required fields filled, THE Expense_Portal SHALL save the Savings_Goal to the Spreadsheet via the Google_Sheets_API.
3. WHEN the user submits the savings goal form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
4. WHEN the user enters a target amount less than or equal to zero, THE Expense_Portal SHALL display a validation error indicating that the target amount must be a positive number.
5. WHEN the user enters a target date earlier than the current date, THE Expense_Portal SHALL display a validation error indicating that the target date must be in the future.
6. THE Expense_Portal SHALL display each Savings_Goal with its name, target amount, current saved amount, remaining amount, and a progress indicator showing percentage of target reached.
7. THE Expense_Portal SHALL allow the user to update the current saved amount for an existing Savings_Goal.
8. WHEN a Savings_Goal's current saved amount equals or exceeds its target amount, THE Expense_Portal SHALL display a completion indicator for that goal.
9. THE API_Client SHALL serialize Savings_Goal records to the Spreadsheet row format and deserialize rows back to Savings_Goal records (round-trip property: parse(format(record)) produces an equivalent Savings_Goal record).

### Requirement 15: Account-to-Account Money Transfer

**User Story:** As a user, I want to record transfers between my accounts, so that I can track money movement without it affecting my expense or income totals.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a form to create a Transfer_Record with fields for date, source account, destination account, amount, and an optional description.
2. WHEN the user submits the transfer form with all required fields filled, THE Expense_Portal SHALL save the Transfer_Record to the Spreadsheet via the Google_Sheets_API.
3. WHEN the user submits the transfer form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
4. WHEN the user enters a transfer amount less than or equal to zero, THE Expense_Portal SHALL display a validation error indicating that the transfer amount must be a positive number.
5. WHEN the user selects the same account for both source and destination, THE Expense_Portal SHALL display a validation error indicating that source and destination accounts must be different.
6. THE Expense_Portal SHALL display all Transfer_Records in a dedicated transfers list showing date, source account, destination account, amount, and description.
7. THE Dashboard SHALL NOT include Transfer_Record amounts in total expense or total income calculations.
8. THE Expense_Portal SHALL display Transfer_Records sorted by date in descending order.
9. THE API_Client SHALL serialize Transfer_Records to the Spreadsheet row format and deserialize rows back to Transfer_Records (round-trip property: parse(format(record)) produces an equivalent Transfer_Record).

### Requirement 16: Vehicle Mileage and Vehicle Expense Tracking

**User Story:** As a user, I want to log vehicle trips and vehicle-specific expenses, so that I can monitor my transportation costs and mileage over time.

#### Acceptance Criteria

1. THE Expense_Portal SHALL provide a form to create a Vehicle_Trip_Log with fields for date, distance traveled (in kilometers or miles), fuel cost, and purpose.
2. WHEN the user submits the trip log form with all required fields filled, THE Expense_Portal SHALL save the Vehicle_Trip_Log to the Spreadsheet via the Google_Sheets_API.
3. WHEN the user submits the trip log form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
4. WHEN the user enters a distance or fuel cost less than or equal to zero, THE Expense_Portal SHALL display a validation error indicating that the value must be a positive number.
5. THE Expense_Portal SHALL provide a form to create a Vehicle_Expense_Record with fields for date, expense type (e.g., maintenance, insurance, fuel fill-up), amount, and description.
6. WHEN the user submits the vehicle expense form with all required fields filled, THE Expense_Portal SHALL save the Vehicle_Expense_Record to the Spreadsheet via the Google_Sheets_API.
7. WHEN the user submits the vehicle expense form with one or more required fields empty, THE Expense_Portal SHALL display a validation error message identifying the missing fields.
8. THE Mileage_Section SHALL display all Vehicle_Trip_Logs in a table showing date, distance, fuel cost, and purpose, sorted by date in descending order.
9. THE Mileage_Section SHALL display all Vehicle_Expense_Records in a table showing date, expense type, amount, and description, sorted by date in descending order.
10. THE Mileage_Section SHALL display a summary showing total distance traveled, total fuel cost, and total vehicle expenses for the current calendar month.
11. THE API_Client SHALL serialize Vehicle_Trip_Log records and Vehicle_Expense_Records to the Spreadsheet row format and deserialize rows back to the respective record types (round-trip property: parse(format(record)) produces an equivalent record).
