# Implementation Plan: Google Login Page

## Overview

Replace the existing auth banner in `index.html` with a dedicated full-screen login page. A new `js/login.js` module drives all login page lifecycle transitions using the existing `auth.js` API and DOM events.

## Tasks

- [x] 1. Add login page markup to `index.html`
  - Remove the existing `#auth-banner` element
  - Insert `#login-page` div before `#app-content` with the structure: `.login-card > .login-brand`, `#login-error`, `#sign-in-btn`, `#login-spinner`
  - Add `role="main"` and `aria-label="Sign in to Expense Portal"` to `#login-page`
  - Add `role="alert"` and `aria-live="assertive"` to `#login-error`; hide it by default (`d-none`)
  - Add Bootstrap spinner markup inside `#login-spinner`; hide it by default (`d-none`)
  - Include 💰 brand icon and "Expense Portal" heading in `.login-brand`
  - Add `<script type="module">` block at bottom of body to import and call `initLoginPage()`
  - _Requirements: 1.2, 1.3, 1.4, 6.3, 6.4_

- [x] 2. Add login page styles to `css/styles.css`
  - [x] 2.1 Add `/* -- Login Page */` CSS block at end of `css/styles.css`
    - `.login-page`: full-viewport flex container, gradient background `#1a1f36` → `#252b47`, centered content
    - `.login-card`: centered white card using existing `--card-radius` and `--shadow-lg` CSS variables
    - `.login-brand`: brand icon sizing and spacing
    - Responsive adjustments for viewports ≥ 320px
    - _Requirements: 1.4, 6.1, 6.2_

- [x] 3. Create `js/login.js` — core module scaffold and initial view logic
  - [x] 3.1 Create `js/login.js` with `initLoginPage()` export
    - Import `initAuth`, `getAccessToken`, `isSignedIn` from `./auth.js`
    - Declare `_loading` and `_error` module-level state variables
    - On init: call `initAuth()`, then check `isSignedIn()` to show either `#login-page` or `#app-content` (add/remove `d-none`)
    - _Requirements: 1.1, 1.5, 3.2_

  - [ ]* 3.2 Write property test for login/app mutual exclusivity (Property 1)
    - `// Feature: google-login-page, Property 1: Login/App mutual exclusivity`
    - Use fast-check to generate arbitrary localStorage token states (valid token, expired token, no token)
    - After calling `initLoginPage()`, assert exactly one of `#login-page` / `#app-content` is visible
    - **Validates: Requirements 1.1, 1.5, 3.2**

- [x] 4. Implement sign-in button click handler in `js/login.js`
  - [x] 4.1 Attach click handler to `#sign-in-btn` that calls `getAccessToken(false)`
    - Set `_loading = true`, disable `#sign-in-btn`, show `#login-spinner`, clear `#login-error` before calling
    - On success: do nothing (transition handled by `auth:signedIn` listener)
    - On error: call internal `_showError(message)` helper, set `_loading = false`, re-enable button, hide spinner
    - Map `popup_closed_by_user` to the cancellation message; map GIS timeout to the connection error message; all others to generic message
    - _Requirements: 2.1, 2.2, 2.4, 4.1, 4.2, 4.3_

  - [ ]* 4.2 Write property test for sign-in button triggering auth request (Property 2)
    - `// Feature: google-login-page, Property 2: Sign-in button triggers auth request`
    - Use fast-check to simulate arbitrary enabled-button click events
    - Assert `getAccessToken` is called exactly once per click
    - **Validates: Requirements 2.1**

  - [ ]* 4.3 Write property test for button disabled while loading (Property 3)
    - `// Feature: google-login-page, Property 3: Button disabled while loading`
    - Use fast-check to generate arbitrary in-flight request states (`_loading = true`)
    - Assert `#sign-in-btn` has `disabled` attribute whenever `_loading` is true
    - **Validates: Requirements 2.4**

- [x] 5. Implement `auth:signedIn` and `auth:signedOut` event listeners in `js/login.js`
  - [x] 5.1 Listen for `auth:signedIn` on `document`
    - Call app initialisation (import and invoke the existing app init function from `index.html`'s inline script or a dedicated init module)
    - Only after init completes: hide `#login-page`, show `#app-content`
    - Reset `_loading = false`, hide spinner, re-enable button
    - _Requirements: 3.1, 3.3_

  - [x] 5.2 Listen for `auth:signedOut` on `document`
    - Hide `#app-content`, show `#login-page`
    - Clear `#login-error` content and add `d-none`
    - Reset `_loading = false`, re-enable button, hide spinner
    - _Requirements: 5.1, 5.2_

  - [ ]* 5.3 Write property test for sign-in / sign-out round trip (Property 4)
    - `// Feature: google-login-page, Property 4: Sign-in / sign-out round trip`
    - Use fast-check to generate arbitrary sequences of `auth:signedIn` / `auth:signedOut` events
    - Assert final DOM state matches the last event dispatched
    - **Validates: Requirements 3.1, 5.1**

  - [ ]* 5.4 Write property test for app initialised before shown (Property 5)
    - `// Feature: google-login-page, Property 5: App initialised before shown`
    - Use fast-check to generate arbitrary `auth:signedIn` events
    - Assert app init function is called and resolves before `#app-content` loses `d-none`
    - **Validates: Requirements 3.3**

- [x] 6. Implement error display and dismiss logic in `js/login.js`
  - [x] 6.1 Implement `_showError(message)` helper
    - Set `#login-error` text content to `message`, remove `d-none`
    - Set `aria-describedby` on `#sign-in-btn` pointing to `#login-error`
    - _Requirements: 4.1, 4.2, 6.4_

  - [x] 6.2 Attach dismiss handler to the `×` button inside `#login-error`
    - On click: add `d-none` to `#login-error`, clear its text, remove `aria-describedby` from `#sign-in-btn`
    - _Requirements: 4.4_

  - [ ]* 6.3 Write property test for error state correctness (Property 6)
    - `// Feature: google-login-page, Property 6: Error state correctness`
    - Use fast-check to generate arbitrary error strings returned by `getAccessToken`
    - Assert `#login-error` is visible with non-empty message and `#sign-in-btn` is not disabled
    - **Validates: Requirements 4.1, 4.3**

  - [ ]* 6.4 Write property test for sign-out clears error state (Property 7)
    - `// Feature: google-login-page, Property 7: Sign-out clears error state`
    - Use fast-check to generate arbitrary error states followed by `auth:signedOut`
    - Assert `#login-error` is hidden and contains no text after sign-out
    - **Validates: Requirements 5.2**

- [ ] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Validate ARIA attributes and accessibility
  - [x] 8.1 Verify ARIA attributes are present in all login page states
    - Confirm `#login-page` has `role="main"` and `aria-label`
    - Confirm `#login-error` has `role="alert"` and `aria-live="assertive"`
    - Confirm `#sign-in-btn` has a non-empty accessible label at all times
    - _Requirements: 6.3, 6.4_

  - [ ]* 8.2 Write property test for ARIA attributes present (Property 8)
    - `// Feature: google-login-page, Property 8: ARIA attributes present`
    - Use fast-check to render the login page in arbitrary states (error shown, loading, idle)
    - Assert required ARIA attributes are always present
    - **Validates: Requirements 6.4**

  - [ ]* 8.3 Write unit tests for specific examples and edge cases
    - Login page DOM contains 💰 brand icon and "Expense Portal" text (Req 1.2)
    - Exactly one `#sign-in-btn` exists in the login page (Req 1.3)
    - `#login-error` has a dismiss button when an error is shown (Req 4.4)
    - GIS timeout (10 s) shows the connection error message (Req 2.3)
    - `popup_closed_by_user` error shows the cancellation message (Req 4.2)

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use [fast-check](https://github.com/dubzzz/fast-check) with a minimum of 100 iterations each
- `js/auth.js` is used without modification throughout
