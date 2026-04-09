# Requirements Document

## Introduction

The Expense Portal currently shows a small auth banner at the top of the page prompting users to sign in with Google. This feature replaces that banner with a dedicated, full-screen login page that serves as the entry point to the app. Users must authenticate via Google OAuth 2.0 before the main application content is shown. No username/password login is offered.

## Glossary

- **Login_Page**: The full-screen landing view shown to unauthenticated users, containing the Google sign-in button and branding.
- **App_Content**: The main Expense Portal UI (sidebar, dashboard, and all feature modules) shown only after successful authentication.
- **Auth_Module**: The existing `js/auth.js` module responsible for managing Google Identity Services OAuth 2.0 tokens.
- **GIS**: Google Identity Services — the Google-provided JavaScript library loaded from `https://accounts.google.com/gsi/client`.
- **Token**: The OAuth 2.0 access token issued by Google after the user grants consent.
- **Session**: The period during which a valid, non-expired Token is held in localStorage.

## Requirements

### Requirement 1: Display the Login Page to Unauthenticated Users

**User Story:** As a visitor, I want to see a branded login page when I open the Expense Portal, so that I know where I am and how to sign in.

#### Acceptance Criteria

1. WHEN the app loads and no valid Session exists, THE Login_Page SHALL be displayed in place of the App_Content.
2. THE Login_Page SHALL display the Expense Portal name and the 💰 brand icon.
3. THE Login_Page SHALL display a single "Sign in with Google" button as the only authentication option.
4. THE Login_Page SHALL occupy the full viewport height and center its content vertically and horizontally.
5. WHILE the Login_Page is displayed, THE App_Content SHALL remain hidden from the user.

### Requirement 2: Initiate Google Sign-In

**User Story:** As a visitor, I want to click a "Sign in with Google" button, so that I can authenticate using my Google account.

#### Acceptance Criteria

1. WHEN the user clicks the "Sign in with Google" button, THE Auth_Module SHALL request an OAuth 2.0 access token via the GIS token client.
2. WHEN the GIS library has not finished loading at the time the button is clicked, THE Login_Page SHALL disable the sign-in button and display a loading indicator until GIS is ready.
3. IF the GIS library fails to load within 10 seconds, THEN THE Login_Page SHALL display an error message informing the user to check their internet connection.
4. WHILE a sign-in request is in progress, THE Login_Page SHALL disable the sign-in button to prevent duplicate requests.

### Requirement 3: Transition to App Content After Successful Sign-In

**User Story:** As a user, I want to be taken directly into the Expense Portal after signing in, so that I can start managing my expenses without extra steps.

#### Acceptance Criteria

1. WHEN the Auth_Module dispatches the `auth:signedIn` event, THE Login_Page SHALL be hidden and THE App_Content SHALL be made visible.
2. WHEN a valid Session already exists on page load, THE Login_Page SHALL be skipped and THE App_Content SHALL be displayed immediately.
3. WHEN the transition from Login_Page to App_Content occurs, THE App_Content SHALL be fully initialised before being shown to the user.

### Requirement 4: Handle Sign-In Errors

**User Story:** As a user, I want to see a clear error message if sign-in fails, so that I understand what went wrong and can try again.

#### Acceptance Criteria

1. IF the Google OAuth flow returns an error response, THEN THE Login_Page SHALL display a human-readable error message to the user.
2. IF the error is `popup_closed_by_user`, THEN THE Login_Page SHALL display a message indicating the sign-in was cancelled and the user may try again.
3. WHEN an error is displayed, THE Login_Page SHALL re-enable the sign-in button so the user can retry.
4. IF an error is displayed, THEN THE Login_Page SHALL provide a way for the user to dismiss the error message.

### Requirement 5: Sign Out Returns User to Login Page

**User Story:** As a signed-in user, I want signing out to return me to the login page, so that the app is left in a secure, unauthenticated state.

#### Acceptance Criteria

1. WHEN the Auth_Module dispatches the `auth:signedOut` event, THE App_Content SHALL be hidden and THE Login_Page SHALL be displayed.
2. WHEN the Login_Page is shown after sign-out, THE Login_Page SHALL display no residual user data or error messages from the previous session.

### Requirement 6: Responsive and Accessible Login Page

**User Story:** As a user on any device, I want the login page to be usable and readable, so that I can sign in regardless of screen size.

#### Acceptance Criteria

1. THE Login_Page SHALL render correctly on viewport widths from 320px to 2560px.
2. THE Login_Page SHALL use colour contrast ratios that meet WCAG 2.1 AA standards for all text and interactive elements.
3. THE Login_Page SHALL be navigable using a keyboard alone, with the sign-in button reachable via Tab and activatable via Enter or Space.
4. THE Login_Page SHALL include appropriate ARIA roles and labels on interactive elements.
