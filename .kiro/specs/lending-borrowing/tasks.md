# Implementation Plan: Lending & Borrowing

## Overview

Implement the Lending & Borrowing module as a vanilla-JS ES module (`js/lendings.js`) following the same patterns as `expenses.js` and `income.js`. The module uses Google Sheets as the backend via `api.js`, an in-memory store via `store.js`, Bootstrap 5 modals, data-card grids, and `paginate.js` for pagination.

## Tasks

- [ ] 1. Extend config and store with lending sheet keys and state
  - Add `lendings: 'Lendings'` and `lendingSettlements: 'LendingSettlements'` to `CONFIG.sheets` in `js/config.js`
  - Add `lendings: []` and `lendingSettlements: []` to the `state` object in `js/store.js`
  - _Requirements: 7.1, 7.2_

- [ ] 2. Implement serialization and core pure functions in `js/lendings.js`
  - [ ] 2.1 Implement `serialize`, `deserialize`, `serializeSettlement`, `deserializeSettlement`
    - Follow the column layouts defined in the design document
    - _Requirements: 7.1, 7.2_

  - [ ]* 2.2 Write property test for serialization round-trip (LedgerEntry)
    - **Property 1: Serialization round-trip**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 2.3 Write property test for serialization round-trip (Settlement)
    - **Property 1: Serialization round-trip (Settlement variant)**
    - **Validates: Requirements 7.1, 7.2**

  - [ ] 2.4 Implement `computeOutstanding(entry, settlements)` and `computeStatus(entry, settlements)`
    - `computeOutstanding` returns `Math.max(entry.amount - sum(settlements), 0)`
    - `computeStatus` returns `"settled"`, `"partial"`, or `"outstanding"` based on outstanding value
    - _Requirements: 3.4, 3.5, 3.6, 5.4_

  - [ ]* 2.5 Write property test for outstanding balance invariant
    - **Property 6: Outstanding balance invariant**
    - **Validates: Requirements 3.6, 5.4**

  - [ ]* 2.6 Write property test for status computation
    - **Property 7: Status computation**
    - **Validates: Requirements 3.4, 3.5**

- [ ] 3. Implement validation logic in `js/lendings.js`
  - [ ] 3.1 Implement `validateEntry(entry)` — requires counterparty, amount > 0, date
    - Return `{ valid, errors }` following the pattern in `validation.js`
    - _Requirements: 1.2, 1.3, 2.2, 2.3_

  - [ ] 3.2 Implement `validateSettlement(settlement, entry, existingSettlements)` — requires amount > 0, date; rejects amount > outstanding
    - _Requirements: 3.2, 3.3_

  - [ ]* 3.3 Write property test for required fields validation
    - **Property 3: Required fields validation**
    - **Validates: Requirements 1.2, 2.2, 3.2**

  - [ ]* 3.4 Write property test for invalid amount rejected
    - **Property 4: Invalid amount rejected**
    - **Validates: Requirements 1.3, 2.3**

  - [ ]* 3.5 Write property test for settlement over-payment rejected
    - **Property 8: Settlement over-payment rejected**
    - **Validates: Requirements 3.3**

- [ ] 4. Implement `_writeMirroredTx` and `_deleteMirroredTx` in `js/lendings.js`
  - [ ] 4.1 Implement `_writeMirroredTx({ type, entryType, amount, date, accountRef, counterparty })` — writes to expenses or income sheet based on entry/settlement type, returns the written record's id
    - `"lent"` entry → expense with `category: 'Lending'`, `paymentMethod: accountRef`
    - `"borrowed"` entry → income with `source: 'Borrowing'`, `receivedIn: accountRef`
    - Settlement on `"lent"` → income with `source: 'Lending'`, `receivedIn: accountRef`
    - Settlement on `"borrowed"` → expense with `category: 'Borrowing'`, `paymentMethod: accountRef`
    - Skip entirely if `accountRef` is empty
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.7_

  - [ ] 4.2 Implement `_deleteMirroredTx(mirroredTxId, storeKey)` — removes the record from expenses or income store; logs warning if not found
    - _Requirements: 8.5, 8.6_

  - [ ]* 4.3 Write property test for mirrored transaction written with correct store, category, amount, and account
    - **Property 12: Mirrored transaction written with correct store, category, amount, and account**
    - **Validates: Requirements 1.5, 2.5, 3.7, 3.8, 8.1, 8.2, 8.3, 8.4**

  - [ ]* 4.4 Write property test for no mirrored transaction without account reference
    - **Property 13: No mirrored transaction without account reference**
    - **Validates: Requirements 8.7, 9.5**

  - [ ]* 4.5 Write property test for mirrored transaction deleted with parent record
    - **Property 14: Mirrored transaction deleted with parent record**
    - **Validates: Requirements 8.5, 8.6**

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement `render()` and net summary in `js/lendings.js`
  - [ ] 6.1 Implement `render()` — reads `store.get('lendings')` and `store.get('lendingSettlements')`, applies filter state, sorts by date descending, passes to paginator
    - Each card shows: counterparty, type badge, original amount, outstanding balance, date, status badge, optional account name
    - _Requirements: 4.1, 4.4_

  - [ ] 6.2 Implement net summary banner update inside `render()` — compute "Total I'm Owed" and "Total I Owe" from outstanding balances
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.3 Implement filter state and filter bar binding (status filter, type filter)
    - _Requirements: 4.2, 4.3_

  - [ ]* 6.4 Write property test for filter returns only matching entries
    - **Property 9: Filter returns only matching entries**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 6.5 Write property test for sort order is date descending
    - **Property 10: Sort order is date descending**
    - **Validates: Requirements 4.4**

  - [ ]* 6.6 Write property test for net summary equals sum of outstanding balances by type
    - **Property 11: Net summary equals sum of outstanding balances by type**
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [ ] 7. Implement `_bindLedgerForm()` in `js/lendings.js`
  - [ ] 7.1 Bind the `#lending-form` submit handler — validate, call `appendRow`, re-fetch, update store, call `_writeMirroredTx` if account selected, close modal on success
    - Show inline error banner inside modal on API error; keep modal open
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 7.2 Populate the account selector `<select>` in the ledger entry modal from `store.get('accounts')`; hide selector if accounts store is empty
    - _Requirements: 9.1, 9.2, 9.6_

  - [ ]* 7.3 Write property test for entry type is preserved
    - **Property 2: Entry type is preserved**
    - **Validates: Requirements 1.1, 2.1**

  - [ ]* 7.4 Write property test for note is persisted
    - **Property 5: Note is persisted**
    - **Validates: Requirements 1.4, 2.4**

  - [ ]* 7.5 Write property test for account selector options match store
    - **Property 16: Account selector options match store**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [ ] 8. Implement `_bindSettlementForm()` in `js/lendings.js`
  - [ ] 8.1 Bind the `#settlement-form` submit handler — validate (including over-payment check), call `appendRow`, re-fetch, update store, call `_writeMirroredTx` if account selected, close modal on success
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8_

  - [ ] 8.2 Populate the account selector in the settlement modal from `store.get('accounts')`; hide if empty
    - _Requirements: 9.3, 9.6_

- [ ] 9. Implement `_deleteEntry(id)` in `js/lendings.js`
  - Show `epConfirm` prompt before deleting
  - Delete all associated settlements from `LendingSettlements` sheet via `writeAllRows`
  - Delete the entry from `Lendings` sheet via `writeAllRows`
  - Call `_deleteMirroredTx` for the entry's `mirroredTxId` and for each settlement's `mirroredTxId`
  - Show error banner and leave entry intact on API error
  - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 9.1 Write property test for deletion removes entry and all its settlements
    - **Property 15: Deletion removes entry and all its settlements**
    - **Validates: Requirements 6.1**

- [ ] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement `init()` and add HTML structure
  - [ ] 11.1 Implement `init()` in `js/lendings.js` — call `_bindLedgerForm()`, `_bindSettlementForm()`, register `store.on('lendings', render)` and `store.on('lendingSettlements', render)`, fetch initial data from both sheets and populate store
    - On fetch error: show global error banner, set store to `[]`, render empty list
    - _Requirements: 7.3, 7.4_

  - [ ] 11.2 Add sidebar nav button `data-tab="tab-lendings"` with `bi-people-fill` icon and label "Lendings" to `index.html`
    - _Requirements: 4.1_

  - [ ] 11.3 Add `#tab-lendings` tab pane with net summary banner, filter bar, data-cards grid, and pagination nav to `index.html`
    - _Requirements: 4.1, 5.1, 5.2_

  - [ ] 11.4 Add modal `#oc-lending` (new/edit ledger entry form) to `index.html`
    - Fields: type (lent/borrowed), counterparty, amount, date, account selector, note
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 9.1, 9.2_

  - [ ] 11.5 Add modal `#oc-settlement` (record settlement form) to `index.html`
    - Fields: amount, date, account selector, note; hidden entryId field
    - _Requirements: 3.1, 3.2, 9.3_

  - [ ] 11.6 Wire `import { init as initLendings } from './lendings.js'` and call `initLendings()` in the main app initialisation script in `index.html`
    - _Requirements: 7.3_

- [ ] 12. Write unit tests in `tests/lendings.unit.test.js`
  - [ ]* 12.1 Write unit tests for `computeOutstanding` and `computeStatus`
    - Known lent entry with known settlements → expected outstanding balance
    - Settlement exactly equal to outstanding → status becomes `"settled"`
    - Entry with zero settlements → status is `"outstanding"`
    - _Requirements: 3.4, 3.5, 3.6_

  - [ ]* 12.2 Write unit tests for mirrored transaction integration
    - Saving an entry with an account ref results in the correct mirrored transaction in the store
    - `mirroredTxId` missing on delete → deletion still completes
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

  - [ ]* 12.3 Write unit tests for error and edge cases
    - API fetch error → store stays empty, no exception thrown
    - Accounts store empty → account selector is hidden
    - _Requirements: 7.4, 9.6_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests live in `tests/lendings.property.test.js` using [fast-check](https://github.com/dubzzz/fast-check) with `numRuns: 100`
- Unit tests live in `tests/lendings.unit.test.js`
- Each property test must include a comment tag: `// Feature: lending-borrowing, Property N: <property text>`
- Checkpoints ensure incremental validation before wiring everything together
