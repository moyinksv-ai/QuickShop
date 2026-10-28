# QuickShop Regression Guardrails

## Purpose and release rule

This document is the working checklist for changes to QuickShop. The production baseline is `main`; feature work belongs on a feature branch and must be verified in preview before any merge or production deployment. Never modify or deploy `main` without explicit authorization.

A successful build is not the same as a production-ready release. Do not claim a fix is verified unless the relevant automated checks and browser-level checks have actually run.

## Incident: landing page and auth Home button overlap

### Root cause

The landing page's general visibility rule used `!important` and was more specific than the later auth-specific hide rule:

```css
body:not(.mode-app):not(.qs-cat-early):not(.qs-auth-pending)
  #qs-landing:not(.qs-hidden) { display: block !important; }
```

When `qs-show-auth` was active but the other three classes were absent and `#qs-landing` lacked `qs-hidden`, that general rule could still force the landing page visible. Because the Home control is positioned within `#loginScreen`, both screens could overlap. The earlier attempted fixes targeted the Home button without correcting the competing landing-page rule.

### Permanent guard

The general landing-page display selector must explicitly exclude `body.qs-show-auth`. Auth and landing visibility are mutually exclusive. The regression test must assert this exclusion; do not weaken it to a check that only verifies the Home button has a hide rule.

### Single owner for the Home transition

`qs-init.js` owns the delegated Home-button handler and the canonical `window.__qs_showLanding` transition. `appss.js` must not register a competing direct click handler. The canonical transition must clear the auth/app/category-pending body states, hide auth/app/bottom navigation, reveal the landing page, and respect reduced-motion preferences. Delegation must support clicks on nested button content via `closest()`.

## Incident: cold visit incorrectly opens the auth screen

### Root cause

`initAuth()` receives Supabase's `INITIAL_SESSION` event with no session on a normal public visit. Treating that event exactly like an explicit `SIGNED_OUT` event routed every first-time visitor into the login screen. That is an auth-flow decision, not a CSS visibility failure.

### Permanent guard

- An ordinary cold visit with no session returns to the public landing page through `window.__qs_showLanding()`.
- If a pending email-verification or password-reset flow was saved before a mobile browser/PWA was suspended, restore that auth flow instead of losing the user's place.
- Explicit sign-out remains a distinct path; do not conflate it with the initial no-session event.
- Add regression coverage for the `INITIAL_SESSION` branch and the pending verification/reset exception.

## Incident: signup may issue duplicate requests or misreport an existing account

### Findings and fix

The signup form had three submission routes: the form's native `submit` event, an explicit button `click` handler, and custom Enter-key handlers. A normal button click can trigger both click and form submit, and Enter can trigger both the custom key handler and native submit. On slow mobile networks this can issue repeated signup requests and repeated/ambiguous OTP messaging. The form now has one native submit entry point plus an in-flight guard.

Supabase can return a successful-shaped signup response with an empty `user.identities` array when an email is already registered and email confirmation is enabled. The UI must not create a profile or claim a new verification code was sent for that response; it now routes back to sign-in and offers password reset. It also checks returned `email_confirmed_at` and `confirmed_at` fields so an already-verified email response does not enter the new-signup verification screen. This is a client-side response guard, not a guarantee that Supabase never attempts delivery; the backend response is authoritative and must be tested against the project's actual email-confirmation settings.

### Authentication flow map (current source-level map)

| Entry / event | Expected screen transition | Guard / risk |
|---|---|---|
| Cold visit, no session | Landing | Do not treat `INITIAL_SESSION` with no user as explicit sign-out. |
| Landing → Sign In | Auth / login form | Landing hidden; auth visible. |
| Landing → Sign Up | Auth / signup form | One native submit route; duplicate submission guarded. |
| New email signup accepted | Verification notice | Persist pending verification email; do not assume a delivery guarantee beyond Supabase response. |
| Existing email detected by empty identities | Login form + sign-in/reset guidance | Do not create a new local profile or claim OTP sent. |
| Resend verification | Verification notice remains | Read email from the displayed verification target; avoid duplicate handlers. |
| Valid signup OTP | Authenticated app after session resolution | Must preserve session/referral attribution and not merely flip a body class. |
| Password reset request | Reset OTP form | Persist reset email so a cold reload can resume. |
| Valid recovery OTP | Set new password, then login | Clear pending reset state and session appropriately. |
| Explicit sign-out | Landing after reload unless an interrupted verification/reset flow is pending | Preserve explicit sign-out intent separately from ordinary cold load. |
| Authenticated app → Settings → Sign Out | Signed-out state | Remove app-owned session markers and local auth session. |

**Scope limitation:** the current signup UI in `index.html` is email/password-based (`signupEmail`); it does not collect a phone number or invoke phone OTP APIs. The duplicate-account guard above therefore addresses the verified-email case in this code path. A verified phone-number OTP flow, if one exists in a separate service or deployment, is not evidenced by these source files and must not be claimed fixed based on this change.

## UI state invariants

| State | Required invariant |
|---|---|
| Landing / signed out | Landing visible; auth screen hidden; Home control hidden. |
| Sign-in, sign-up, verification, password reset | Auth screen visible; landing hidden; Home control available. |
| Authenticated app | App visible; landing and auth screens hidden; bottom navigation follows app state. |
| Return to landing | Clear auth/app/category state classes; hide app/auth/nav; show landing; scroll to top. |
| Category/catalog early route | Landing/auth/app shell hidden as intended by catalog routing; do not let generic landing CSS override this route. |

Whenever changing a UI state, inspect all related sources together: `index.html`, `styless.css`, `qs-init.js`, and `appss.js`. Check CSS specificity, `!important`, inline styles, element classes, body classes, startup timing, event delegation, and reload paths. Avoid multiple independent owners for the same transition.

## Required automated checks

Run:

```sh
node --test tests/regression-guards.test.js
```

The regression suite should cover:
- landing/auth visibility exclusivity and the CSS selector that enforces it;
- a single delegated Home transition and reduced-motion behavior;
- JavaScript syntax for `appss.js`, `qs-init.js`, admin API, and inline admin code;
- vendor sign-out delegation and session cleanup;
- admin search/filter semantics and unknown payment-state handling;
- payout-cycle reservation/idempotency guards, permissions migration, and protected admin payout transitions.

A source-pattern test is useful but does not prove runtime behavior. Add behavioral/browser tests for bugs involving CSS cascade, DOM state, focus, navigation, or responsive layout.

## Required preview smoke test before merge

Use a clean browser session and test at least a narrow mobile viewport (360–390 CSS px) and desktop:

1. Open the landing URL directly and refresh. Confirm there is no floating Home button and no auth form overlay.
2. Click Sign In and Sign Up from the landing page. Confirm the auth screen is shown, the landing page is not visible underneath, and Home is available.
3. Click Home (including clicking its text/icon). Confirm landing returns, auth is hidden, and the page scrolls to the top.
4. Complete a successful sign-in; confirm the app shell is shown.
5. Sign out from Settings and confirm the correct signed-out state after the reload.
6. Exercise verification and password-reset entry/return paths.
7. Check mobile navigation for overlap, clipped labels, horizontal overflow, and tap targets.
8. Check browser console and network for new errors, failed scripts, or missing assets.
9. For admin changes, verify authorized and unauthorized access, search by store/owner/email/phone/ID, pending activation visibility, queue dismissal/keyboard behavior, and payout transitions against safe test data.

Record what was actually tested. Do not claim authenticated admin or payment-flow validation if credentials or safe test data were unavailable.

## Branch comparison and release safety

This feature branch has a large accumulated difference from `main` (81 commits at the time this document was introduced). Review the changed-file list and functional diff before merge; prioritize auth/session routing, referral capture/routing, admin authorization and payout mutations, Supabase RLS/grants, and deployment configuration. A green check does not replace reviewing security-sensitive behavior.

Do not remove or rewrite existing referral, payout, admin, or offline-sync behavior merely to fix a UI bug. Preserve the existing migration and guard tests. If a required production secret/configuration is missing, fail safely and report the blocker without exposing secret values.

## Change discipline

- Make the smallest root-cause fix that preserves established behavior.
- Before editing, read the current file and compare it with `main`; do not patch from stale snippets.
- Never make concurrent writes to the same file.
- After edits, inspect the resulting diff and verify tests against the actual commit.
- Preview only until the user explicitly authorizes production merge/deployment.
- If a check could not run, state that limitation plainly.

## Incident: top Marketplace link missing beside Sign In

### Source comparison and correction
The top navigation link exists in both `main` and the feature branch, but the feature branch added compact mobile navigation rules before the base navigation rules. Because the base rules occur later with the same selector specificity, they override the intended compact spacing. On narrow screens this can cause the navigation group to exceed the available width and clip an entry point. I moved the responsive overrides after the base styles so the compact layout actually wins in the CSS cascade. The Marketplace link itself remains the existing `search.html` link; no duplicate link or broad landing redesign was added.

### Permanent guard
- Keep the top Marketplace link visible beside Sign In at narrow widths.
- Keep responsive navigation overrides after the base navigation declarations.
- Do not solve clipping by hiding Marketplace or adding a duplicate link.
- The regression test checks the link, CSS ordering, and absence of a rule that hides it.

## Incident: signup click handler removed while eliminating duplicate submit routes

### Root cause
The signup UI is a `div#signupForm`, not a native `form`, and `#btnSignup` is `type="button"`. Removing the button click and Enter handlers while keeping only a `submit` listener meant the UI could not emit the event the code was waiting for. This was a regression introduced by the duplicate-submit cleanup.

### Correction and guard
- Restore explicit button-click and Enter-key routes to the same `handleSignupSubmit` function.
- Keep the `signupInFlight` guard to prevent overlapping network requests.
- Test the actual DOM shape and binding paths; do not assume a `div` behaves like a form.

## Incident: signup validation could lock the form

### Root cause
The duplicate-submit guard was set before synchronous field validation. Any invalid name, email, or password returned early before reaching the `try/finally`, leaving `signupInFlight` true and preventing a corrected retry until the page was reloaded.

### Permanent guard
- Run synchronous validation before setting `signupInFlight`.
- Set the in-flight guard immediately before asynchronous work and always release it in `finally`.
- Keep regression assertions that invalid name, email, and password-confirmation paths occur before the guard is set.

