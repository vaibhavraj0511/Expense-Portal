# Requirements Document

## Introduction

Dark Mode is a theming feature for the Expense Portal web app. It allows users to toggle between a light and dark visual theme using a button in the topbar. The selected preference is persisted in `localStorage` so it survives page reloads and sessions. Theming is implemented via a `data-theme="dark"` attribute on `<body>` combined with CSS custom properties (design tokens), ensuring all UI surfaces — sidebar, topbar, cards, modals, tables, and form controls — adapt consistently without JavaScript-driven style overrides.

## Glossary

- **Theme_Toggle**: The button element rendered in the topbar that switches between light and dark themes.
- **Theme_Manager**: The JavaScript module (`js/theme.js`) responsible for reading, applying, and persisting the active theme.
- **Active_Theme**: The currently applied theme, either `"light"` or `"dark"`.
- **Theme_Preference**: The string value (`"light"` or `"dark"`) stored under the key `"theme"` in `localStorage`.
- **Dark_Token_Set**: The set of CSS custom property overrides declared under `[data-theme="dark"]` that redefine the design tokens for dark mode.
- **Body**: The `<body>` HTML element of `index.html`.
- **System_Preference**: The operating-system-level color scheme preference exposed via the `prefers-color-scheme` media query.

---

## Requirements

### Requirement 1: Theme Initialization on Page Load

**User Story:** As a returning user, I want my previously chosen theme applied immediately on page load, so that I never see a flash of the wrong theme.

#### Acceptance Criteria

1. WHEN the page loads, THE Theme_Manager SHALL read the Theme_Preference from `localStorage`.
2. WHEN a Theme_Preference of `"dark"` is found in `localStorage`, THE Theme_Manager SHALL set `data-theme="dark"` on the Body before first render.
3. WHEN no Theme_Preference exists in `localStorage`, THE Theme_Manager SHALL apply the Active_Theme that matches the System_Preference reported by `prefers-color-scheme`.
4. WHEN neither a Theme_Preference nor a detectable System_Preference exists, THE Theme_Manager SHALL default the Active_Theme to `"light"`.

---

### Requirement 2: Theme Toggle Button in Topbar

**User Story:** As a user, I want a clearly visible toggle button in the topbar, so that I can switch themes at any time without navigating away.

#### Acceptance Criteria

1. THE Theme_Toggle SHALL be rendered inside the `.ep-topbar` header element, in the right-hand action group alongside the avatar.
2. WHEN the Active_Theme is `"light"`, THE Theme_Toggle SHALL display a moon icon (`bi-moon-stars-fill`) and carry the accessible label `"Switch to dark mode"`.
3. WHEN the Active_Theme is `"dark"`, THE Theme_Toggle SHALL display a sun icon (`bi-sun-fill`) and carry the accessible label `"Switch to light mode"`.
4. THE Theme_Toggle SHALL be keyboard-focusable and operable via the Enter and Space keys.

---

### Requirement 3: Theme Switching Behaviour

**User Story:** As a user, I want clicking the toggle to instantly switch the theme, so that I get immediate visual feedback.

#### Acceptance Criteria

1. WHEN the user activates the Theme_Toggle, THE Theme_Manager SHALL toggle the Active_Theme from `"light"` to `"dark"` or from `"dark"` to `"light"`.
2. WHEN the Active_Theme changes to `"dark"`, THE Theme_Manager SHALL set `data-theme="dark"` on the Body.
3. WHEN the Active_Theme changes to `"light"`, THE Theme_Manager SHALL remove the `data-theme` attribute from the Body.
4. WHEN the Active_Theme changes, THE Theme_Manager SHALL update the Theme_Toggle icon and `aria-label` to reflect the new Active_Theme.
5. WHEN the Active_Theme changes, THE Theme_Manager SHALL persist the new value as the Theme_Preference in `localStorage` under the key `"theme"`.

---

### Requirement 4: CSS Dark Token Set

**User Story:** As a developer, I want all colours defined as CSS variables, so that dark mode is applied purely through CSS without JavaScript style manipulation.

#### Acceptance Criteria

1. THE Dark_Token_Set SHALL override all colour-related CSS custom properties defined in `:root` that affect background, surface, text, border, and shadow values.
2. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL set `--page-bg` to a dark background value (e.g. `#0f1117`).
3. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL set card and surface background variables to dark surface values (e.g. `#1a1d2e`).
4. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL set body text colour to a light value (e.g. `#e2e8f0`) ensuring a contrast ratio of at least 4.5:1 against the dark background.
5. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL preserve all brand/accent colour tokens (`--primary`, `--success`, `--danger`, `--warning`, `--info`) at their original values.
6. THE Dark_Token_Set SHALL be declared in `css/styles.css` under the selector `[data-theme="dark"]`.

---

### Requirement 5: Bootstrap Component Compatibility

**User Story:** As a user, I want Bootstrap modals, tables, form controls, and alerts to respect the dark theme, so that the UI looks consistent throughout.

#### Acceptance Criteria

1. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply dark background and light text overrides to Bootstrap modal dialogs (`.modal-content`).
2. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply dark background and light text overrides to Bootstrap table elements (`table`, `thead`, `tbody`, `tr`, `td`, `th`).
3. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply dark background and light text overrides to Bootstrap form controls (`.form-control`, `.form-select`).
4. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply dark background and light text overrides to Bootstrap dropdown menus (`.dropdown-menu`, `.dropdown-item`).

---

### Requirement 6: Theme Persistence Across Sessions

**User Story:** As a returning user, I want my theme preference remembered across browser sessions, so that I don't have to re-select it every visit.

#### Acceptance Criteria

1. THE Theme_Manager SHALL store the Theme_Preference in `localStorage` using the key `"theme"` with a string value of either `"light"` or `"dark"`.
2. WHEN the user closes and reopens the browser, THE Theme_Manager SHALL restore the previously saved Theme_Preference on the next page load.
3. IF `localStorage` is unavailable (e.g. private browsing restrictions), THEN THE Theme_Manager SHALL fall back to applying the System_Preference without throwing an uncaught exception.

---

### Requirement 7: Login Page Theme Support

**User Story:** As a user, I want the login page to also respect the dark theme, so that the experience is consistent before and after authentication.

#### Acceptance Criteria

1. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply dark background and surface overrides to the login page panels (`.lp-left`, `.lp-right`, `.lp-card`).
2. WHEN `data-theme="dark"` is present on the Body, THE Dark_Token_Set SHALL apply light text colour overrides to login page text elements.
3. THE Theme_Manager SHALL apply the Active_Theme before the login page is rendered, so that no flash of unstyled content occurs.
