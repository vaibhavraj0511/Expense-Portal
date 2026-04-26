# Requirements Document

## Introduction

The Lendings & Borrowings feature adds a personal ledger to the Expense Portal that tracks money lent to others and money borrowed from others. Users can record new lending/borrowing transactions, log partial or full settlements, and view a clear summary of outstanding and settled amounts. When an account is optionally selected on a Ledger_Entry or Settlement, the feature mirrors a corresponding transaction into the expenses or income store to reflect the real cash movement in that account's balance.

## Glossary

- **Lending_Borrowing_Module**: The front-end module responsible for all lending and borrowing UI and logic within the Expense Portal.
- **Ledger_Entry**: A single record representing money lent to a person or money borrowed from a person, including the original amount, date, and optional note.
- **Settlement**: A record of a full or partial repayment against a Ledger_Entry.
- **Counterparty**: The person (name) associated with a Ledger_Entry — either the person who received the lent money or the person who gave the borrowed money.
- **Outstanding_Balance**: The remaining unpaid amount for a Ledger_Entry, calculated as the original amount minus the sum of all associated Settlements.
- **Net_Summary**: The aggregate view showing total amount the user is owed (sum of outstanding lending balances) and total amount the user owes (sum of outstanding borrowing balances).
- **Google_Sheets_API**: The backend data store used by the Expense Portal, accessed via the existing `api.js` client.
- **Account_Reference**: An optional reference to an existing account from the Accounts store. When selected, the Lending_Borrowing_Module writes a mirrored transaction to the expenses or income store to reflect the cash movement in that account's balance.
- **Mirrored_Transaction**: A record written to the expenses store (debit) or income store (credit) by the Lending_Borrowing_Module to represent the cash impact of a Ledger_Entry or Settlement on a selected account. It uses a reserved category ("Lending" or "Borrowing") so it is identifiable and can be removed when the parent record is deleted.

---

## Requirements

### Requirement 1: Record a Lending Transaction

**User Story:** As a user, I want to record money I lent to someone, so that I have a reminder of what is owed to me.

#### Acceptance Criteria

1. WHEN the user submits a new lending entry with a Counterparty name, amount, and date, THE Lending_Borrowing_Module SHALL save the entry to the Google_Sheets_API with a type of "lent".
2. THE Lending_Borrowing_Module SHALL require the Counterparty name, amount, and date fields before saving a lending entry.
3. IF the amount field contains a non-positive or non-numeric value, THEN THE Lending_Borrowing_Module SHALL display a validation error and prevent saving.
4. WHERE the user provides an optional note, THE Lending_Borrowing_Module SHALL persist the note alongside the Ledger_Entry.
5. WHERE the user selects an optional Account_Reference, THE Lending_Borrowing_Module SHALL persist the account identifier alongside the Ledger_Entry and write a Mirrored_Transaction to the expenses store to decrease that account's balance by the lent amount.

---

### Requirement 2: Record a Borrowing Transaction

**User Story:** As a user, I want to record money I borrowed from someone, so that I have a reminder of what I owe.

#### Acceptance Criteria

1. WHEN the user submits a new borrowing entry with a Counterparty name, amount, and date, THE Lending_Borrowing_Module SHALL save the entry to the Google_Sheets_API with a type of "borrowed".
2. THE Lending_Borrowing_Module SHALL require the Counterparty name, amount, and date fields before saving a borrowing entry.
3. IF the amount field contains a non-positive or non-numeric value, THEN THE Lending_Borrowing_Module SHALL display a validation error and prevent saving.
4. WHERE the user provides an optional note, THE Lending_Borrowing_Module SHALL persist the note alongside the Ledger_Entry.
5. WHERE the user selects an optional Account_Reference, THE Lending_Borrowing_Module SHALL persist the account identifier alongside the Ledger_Entry and write a Mirrored_Transaction to the income store to increase that account's balance by the borrowed amount.

---

### Requirement 3: Record a Settlement (Full or Partial)

**User Story:** As a user, I want to log a repayment against a lending or borrowing entry, so that I can track how much has been settled and what remains outstanding.

#### Acceptance Criteria

1. WHEN the user records a Settlement against a Ledger_Entry, THE Lending_Borrowing_Module SHALL save the settlement amount and date to the Google_Sheets_API linked to the parent Ledger_Entry.
2. THE Lending_Borrowing_Module SHALL require a settlement amount and date before saving a Settlement.
3. IF the settlement amount exceeds the current Outstanding_Balance of the Ledger_Entry, THEN THE Lending_Borrowing_Module SHALL display a validation error and prevent saving.
4. IF the settlement amount equals the Outstanding_Balance of the Ledger_Entry, THEN THE Lending_Borrowing_Module SHALL mark the Ledger_Entry status as "settled".
5. WHILE a Ledger_Entry has one or more Settlements that do not fully cover the original amount, THE Lending_Borrowing_Module SHALL display the entry status as "partial".
6. THE Lending_Borrowing_Module SHALL allow multiple Settlements to be recorded against a single Ledger_Entry until the Outstanding_Balance reaches zero.
7. WHERE the user selects an optional Account_Reference when recording a Settlement on a "lent" entry, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the income store to increase that account's balance by the settlement amount.
8. WHERE the user selects an optional Account_Reference when recording a Settlement on a "borrowed" entry, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the expenses store to decrease that account's balance by the settlement amount.

---

### Requirement 4: View Outstanding and Settled Entries

**User Story:** As a user, I want to see all my lending and borrowing entries with their current status, so that I know what is still open and what has been resolved.

#### Acceptance Criteria

1. THE Lending_Borrowing_Module SHALL display all Ledger_Entries in a list, showing Counterparty name, original amount, Outstanding_Balance, date, type ("lent" / "borrowed"), and status ("outstanding", "partial", "settled").
2. WHEN the user filters by status, THE Lending_Borrowing_Module SHALL display only Ledger_Entries matching the selected status.
3. WHEN the user filters by type, THE Lending_Borrowing_Module SHALL display only Ledger_Entries matching the selected type ("lent" or "borrowed").
4. THE Lending_Borrowing_Module SHALL display the list sorted by date descending by default.

---

### Requirement 5: Net Summary View

**User Story:** As a user, I want to see a summary of the total I am owed and the total I owe, so that I can understand my overall lending and borrowing position at a glance.

#### Acceptance Criteria

1. THE Lending_Borrowing_Module SHALL display the total Outstanding_Balance across all "lent" entries as "Total I'm Owed".
2. THE Lending_Borrowing_Module SHALL display the total Outstanding_Balance across all "borrowed" entries as "Total I Owe".
3. WHEN a Settlement is recorded or a Ledger_Entry is deleted, THE Lending_Borrowing_Module SHALL recalculate and update the Net_Summary without requiring a page reload.
4. THE Lending_Borrowing_Module SHALL exclude fully settled Ledger_Entries from the Net_Summary totals.

---

### Requirement 6: Delete a Ledger Entry

**User Story:** As a user, I want to delete a lending or borrowing entry, so that I can remove records that were entered by mistake.

#### Acceptance Criteria

1. WHEN the user confirms deletion of a Ledger_Entry, THE Lending_Borrowing_Module SHALL remove the entry and all associated Settlements from the Google_Sheets_API.
2. WHEN the user initiates deletion, THE Lending_Borrowing_Module SHALL display a confirmation prompt before executing the delete.
3. IF the Google_Sheets_API returns an error during deletion, THEN THE Lending_Borrowing_Module SHALL display an error message and leave the Ledger_Entry intact in the UI.

---

### Requirement 7: Data Persistence via Google Sheets

**User Story:** As a user, I want my lending and borrowing data stored in my Google Sheet, so that it persists across sessions and devices.

#### Acceptance Criteria

1. THE Lending_Borrowing_Module SHALL store Ledger_Entries in a dedicated sheet named "Lendings" in the user's Google Spreadsheet.
2. THE Lending_Borrowing_Module SHALL store Settlements in a dedicated sheet named "LendingSettlements" in the user's Google Spreadsheet.
3. WHEN the Lending_Borrowing_Module initialises, THE Lending_Borrowing_Module SHALL fetch all rows from the "Lendings" and "LendingSettlements" sheets and load them into the in-memory store.
4. IF the Google_Sheets_API returns an error during data fetch, THEN THE Lending_Borrowing_Module SHALL display an error message and render an empty list rather than crashing.

---

### Requirement 8: Conditional Account Balance Impact via Mirrored Transactions

**User Story:** As a user, I want lending and borrowing entries to optionally affect my account balances, so that my account totals accurately reflect cash that has left or entered my accounts.

#### Acceptance Criteria

1. WHEN a "lent" Ledger_Entry is saved with an Account_Reference, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the expenses store with the category "Lending", the lent amount, and the selected account as the payment method, so that the account balance decreases by the lent amount.
2. WHEN a "borrowed" Ledger_Entry is saved with an Account_Reference, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the income store with the category "Borrowing", the borrowed amount, and the selected account as the received-in account, so that the account balance increases by the borrowed amount.
3. WHEN a Settlement is recorded against a "lent" entry with an Account_Reference, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the income store with the category "Lending", the settlement amount, and the selected account as the received-in account, so that the account balance increases by the settlement amount.
4. WHEN a Settlement is recorded against a "borrowed" entry with an Account_Reference, THE Lending_Borrowing_Module SHALL write a Mirrored_Transaction to the expenses store with the category "Borrowing", the settlement amount, and the selected account as the payment method, so that the account balance decreases by the settlement amount.
5. WHEN a Ledger_Entry with an associated Mirrored_Transaction is deleted, THE Lending_Borrowing_Module SHALL also delete the corresponding Mirrored_Transaction from the expenses or income store.
6. WHEN a Settlement with an associated Mirrored_Transaction is deleted, THE Lending_Borrowing_Module SHALL also delete the corresponding Mirrored_Transaction from the expenses or income store.
7. WHEN a Ledger_Entry or Settlement is saved without an Account_Reference, THE Lending_Borrowing_Module SHALL NOT write any Mirrored_Transaction and SHALL NOT modify any account balance.

---

### Requirement 9: Account Selection for Balance Impact

**User Story:** As a user, I want to optionally select a bank account on lending, borrowing, and settlement entries, so that the relevant account balance is automatically updated to reflect the real cash movement.

#### Acceptance Criteria

1. WHEN the user creates a lending entry, THE Lending_Borrowing_Module SHALL present an optional account selector populated from the existing Accounts store.
2. WHEN the user creates a borrowing entry, THE Lending_Borrowing_Module SHALL present an optional account selector populated from the existing Accounts store.
3. WHEN the user records a Settlement, THE Lending_Borrowing_Module SHALL present an optional account selector populated from the existing Accounts store.
4. WHERE an Account_Reference is selected, THE Lending_Borrowing_Module SHALL display the account name alongside the Ledger_Entry or Settlement in the list view.
5. WHERE no Account_Reference is selected, THE Lending_Borrowing_Module SHALL save the Ledger_Entry or Settlement without any balance impact and without writing a Mirrored_Transaction.
6. IF the Accounts store contains no accounts, THEN THE Lending_Borrowing_Module SHALL hide the account selector rather than displaying an empty dropdown.
