# QuickShop Regression Check — 2026-10-28

## Release decision

**Hold merge to `main` until the release-blocking checks below are completed.** The feature branch was 115 commits ahead of `main` at the start of the 2026-10-29 follow-up (before the navigation fix and its regression guard) and changes authentication/session routing, signup, referral attribution, admin UI/API, payout flows, database grants, and Vercel routing. A passing source-pattern suite and a READY preview are not enough evidence to safely merge this entire accumulated diff into production.

## Baseline and rollback safety

- Production baseline branch: `main`
- Baseline SHA observed during this review: `fd20d2f5352b96b4282680a032decb116ecc0e23`
- Feature branch: `feat/integrated-referrals-otp`
- Feature branch comparison at the start of the 2026-10-29 follow-up: 115 commits ahead, 0 behind. The follow-up adds a targeted landing/auth history fix and regression guard; re-fetch exact branch heads before any release decision.
- No merge, push to `main`, or production deployment was performed during this check.
- Before any eventual merge, create a durable backup branch pointing to the then-current `main` SHA (for example `backup/main-before-quickshop-release-2026-10-28`) and record the merge commit SHA. A rollback should revert the merge commit or redeploy the backup SHA; do not reset or force-push `main`.

## Follow-up: landing/auth Back navigation — 2026-10-29

### User-observed regression

The user reported that pressing Back from the authentication screen toward the landing page could leave a blank screen. This is a release-blocking navigation failure. The requirement applies to Android system Back, iPhone Safari Back/edge-swipe, desktop browser Back/Forward, and the in-auth Home control.

### Source-level root cause

The original Sign In wiring registered `showAuth` directly as a click listener. Because browser event listeners pass the click Event as the first argument, the new `showAuth(fromHistory)` implementation interpreted that Event as a truthy history-restoration flag and skipped `history.pushState`. This left the auth screen visible without an auth history entry, so Back could leave the document instead of restoring landing. Separately, `appss.js` has its own `popstate` listener for vendor-app tab navigation, which must not override landing/auth screen transitions.

### Fix committed on feature branch

- `qs-init.js`: add a `qsScreen` history-state marker while preserving unrelated state properties.
- Sign In passes an explicit `false` to `showAuth` rather than its click Event, so opening auth reliably pushes one same-document `auth` entry; restoring auth through Forward does not push a duplicate.
- Back from auth restores landing through the canonical transition. The auth-only Home button uses Back when the expected auth history entry exists.
- Auth/landing `popstate` events stop propagation to the vendor-app tab-history listener so the two history systems do not fight each other.
- Landing state updates preserve the current URL and query string.
- `tests/regression-guards.test.js`: add source-level guards for Back/Forward screen restoration, explicit click-flag handling, duplicate-entry prevention, and separation from vendor tab navigation.

### Verification status and limits

- Navigation implementation commit: `150b746836afe58f1bf2cdcfb795a34cf51f3c08`; the regression test and documentation updates follow it on the same feature branch. Re-fetch the exact branch HEAD before release.
- `node --test tests/regression-guards.test.js` ran in a Vercel sandbox using Node.js 22: **15 passed, 0 failed**.
- A Playwright Chromium smoke test against the checked-out feature source and a local static server passed desktop, Android-sized (393×873), and iPhone-sized (390×844) viewports for landing → Sign In → browser Back → browser Forward → in-auth Home. It verified the landing/auth display states and history state transitions; no uncaught page errors were observed.
- This was Chromium viewport emulation, not a physical Android device, Android system gesture, or iPhone Safari/WebKit test.
- The current Vercel preview is protected by Vercel SSO. Automated browser access reached the Vercel login page (403), so the deployed preview could not be smoke-tested in this run. The local harness also lacks the untracked `supabase-config.js`, so live Supabase auth/session startup and verification/recovery flows were not validated by this browser run.
- Local browser console reported the Sentry CDN script blocked by an integrity-hash mismatch. The `index.html` integrity attribute is identical on `main` and the feature branch, so this appears to be a pre-existing issue rather than a regression from this fix; it remains a separate cleanup item.
- Re-run the suite and verify the deployment/CI status for the exact latest feature commit before release. Do not merge to `main` or deploy production on static guards and local browser smoke alone.

## Checks confirmed from repository/CI metadata

- The regression-guard workflow is configured to run `node --test tests/regression-guards.test.js` on pushes and pull requests using Node.js 20.
- GitHub Actions run #122 for commit `15cd711ad9fe68da566f099b803ca8c162d49a7f` reported **success**.
- The most recent Vercel deployment returned by the branch deployment list was **READY** for feature commit `bf03a9832549e987afc975998a51074c1d38ac18` (preview URL: https://quickshopper-rn90oxarc-moyinks-projects-5a3815db.vercel.app/).
- The user manually confirmed the landing/auth fix worked, and confirmed the Browse Market button beside the hero CTA is visible and working.
- Static regression guards cover landing/auth visibility, delegated Home and sign-out behavior, cold-start routing, signup duplicate-submission and already-verified-email response guards, top Marketplace visibility, admin vendor filtering, admin API response behavior under payment-claim success/failure, and referral payout request protections.

## Last-pass risk review

### Landing, auth, and signup

- Keep the CSS invariant that landing and auth screens cannot be displayed simultaneously.
- Keep one canonical Home-to-landing transition and delegated handling for nested Home button targets.
- Treat an unauthenticated `INITIAL_SESSION` separately from explicit sign-out; preserve pending verification/reset restoration.
- Signup UI is a `div`, not a native form. Click and Enter must call the same guarded handler; validation must happen before the in-flight lock.
- Empty Supabase `user.identities`, `email_confirmed_at`, and `confirmed_at` responses are guarded to avoid showing a new-account/OTP-success state for an existing verified email. This is a client-side response guard; it does not prove that Supabase never attempts email delivery under every project configuration.

### Marketplace navigation

- Preserve the top `Market →` link targeting `search.html`; do not hide it at narrow widths or add a duplicate.
- The user confirms the Browse Market CTA next to the hero CTA is visible and works.
- Automated source assertions check for visibility/layout rules, but an actual 360–390 CSS-pixel visual check and desktop check still need to be recorded against the newest preview.

### Admin/API, payouts, and RLS

- The branch contains meaningful changes to `admin.html`, `api/admin.js`, payout workflows, and the referral payout read-grant migration.
- Automated tests exercise mocked vendor/claim responses and assert some payout transition guards. They do not establish that production Supabase RLS, live grants, admin credentials, concurrent payout requests, and actual paid-state transitions all work together.
- Before release, verify admin access with a valid token and rejection without/with an invalid token; verify the service-role key never reaches the browser; exercise payout detail requests and mark-paid against safe test data; confirm audit logging and idempotency under retry; verify referral payout RLS/grants against the actual target database.
- Never test a real payout or create production test accounts without explicit safe test instructions.

### Referral attribution and OTP persistence

- The feature includes persistent referral capture, short referral URLs, attribution after verified authentication, and pending OTP/reset state restoration.
- CI/source checks do not replace a controlled end-to-end test for new email signup → verification → reload/resume → attribution, existing verified email signup, invalid/self referral, and password reset/reload.
- The preview is configured around the production Supabase project according to prior project notes; avoid creating test accounts or modifying live referral data without a deliberate test plan.

### Routing and deployment

- Review the changed `vercel.json` redirects/rewrites and confirm preview routes do not unexpectedly canonicalize users to the production domain.
- Confirm latest preview routes and assets return expected responses; verify console/network behavior in a real browser.
- No production deploy or main-branch mutation is authorized until the checks above are completed.

## Required release gate

- [ ] Re-run CI on the exact final feature commit and verify it is green.
- [ ] Open latest preview on narrow mobile and desktop; test landing refresh, Sign In, Sign Up, Home, verified-email duplicate signup, sign-in, sign-out, verification/reset restoration, Marketplace top link, and Browse Market CTA.
- [ ] Check browser console/network for new errors.
- [ ] Complete safe admin authorization and payout/RLS smoke tests.
- [ ] Complete controlled referral attribution test without accidentally writing unwanted production data.
- [ ] Recompare exact final feature HEAD to current `main` and review all changed files.
- [ ] Create backup branch from current `main` and record its SHA before merging.
- [ ] Merge only if all applicable checks pass; record merge SHA and deployment URL. If any check is unavailable or fails, keep the branch unmerged and report the blocker.

**Status:** Automated source-level checks have passed on a prior commit and the latest preview deployment is READY. Browser-level, live admin/payout/RLS, and controlled end-to-end signup/referral checks are not fully evidenced here. Therefore this is not yet a clean release sign-off.


## Follow-up: marketplace Back restoration and vendor-scoped checkout — 2026-10-29

### Root causes

- The landing-to-marketplace transition adds qs-navigating and animates the landing page to opacity zero. Browsers can restore that DOM from the back-forward cache with the class still present, producing a blank-looking landing page on Android Back or iPhone Safari Back/edge-swipe.
- Marketplace product links pass from=market, market_product, and the selected vendor's local pid to the vendor catalog. The catalog opened the selected product after a 120 ms timeout, allowing the underlying vendor grid to paint before the detail overlay appeared. The native Back handler also closed the overlay before navigating back to the marketplace, exposing the grid during the redirect.
- A deeper history-owner collision was found: qs-init.js registered the landing/auth popstate handler whenever #qs-landing existed in the DOM. That markup is still present on catalog URLs, even though hidden in catalog mode. The handler initialized catalog history as qsScreen=landing and used stopImmediatePropagation(), preventing catalog.js from handling the detail Back event. This is why the previous landing/auth fix could interfere with marketplace navigation.
- The marketplace handoff opened product details but did not add the selected product to the vendor cart. The existing cart and WhatsApp checkout were store-scoped, but the handoff did not connect the selected marketplace intent to that cart.
- In search.html, the product-detail Back button pushed a new listing URL instead of popping the existing detail history entry. That left the product detail one step behind in browser history, so a later phone/browser Back could reopen it. The button also did not invalidate in-flight product/vendor fetches before changing visible state.

### Fix on isolated branch

- index.html: clear qs-navigating on pageshow so back-forward-cache restoration returns the landing page to full visibility. Updated the exact CSP SHA-256 allowlist hash for the modified inline transition script.
- qs-init.js: resolve store/token catalog mode before registering landing/auth history handlers, so hidden landing markup cannot claim the catalog page's history state or swallow its popstate event.
- catalog.js: seed the selected marketplace product into the existing store-scoped cart idempotently; open the deep-linked detail overlay in the same task to prevent the 120 ms grid flash; and redirect directly to the marketplace on native Back without first exposing the vendor grid.
- Added a visible, store-scoped cart summary/review action at the top of marketplace-origin vendor catalogs, plus Checkout and Keep shopping actions on the marketplace-selected product detail. Checkout remains available while viewing other products from the same store. The cart drawer includes Continue shopping alongside WhatsApp checkout. Existing quantity controls, item removal, stock limits, totals, and store-scoped cart storage remain the source of truth.
- search.html: mark product-detail history entries created from marketplace listings and use history.back() for the detail Back button instead of pushing a duplicate listing URL. Direct product URLs use a replace-and-route fallback. Increment the navigation sequence when Back occurs so stale async detail/vendor results cannot repaint after leaving the screen. Updated the exact CSP hash for the modified inline marketplace router.
- tests/regression-guards.test.js: added guards for back-forward-cache restoration and both inline CSP hashes, marketplace cart seeding, store scoping, same-task detail opening, landing/catalog history ownership, no-grid-flash Back routing, and marketplace product-detail Back behavior.

### Verification performed

- Syntax checks passed for catalog.js, qs-init.js, and tests/regression-guards.test.js.
- Regression suite: 20 tests passed, 0 failed.
- Playwright Chromium smoke tests passed at 393×873 (Android-sized), 390×844 (iPhone-sized), and 1280×900 for landing → marketplace → Back, confirming the landing fade class is cleared and opacity returns to 1.
- Playwright catalog-flow smoke tests passed with a mocked Supabase client: marketplace-selected item auto-added to cart; Keep shopping reveals the store grid without leaving the vendor; a second same-store product can be added; Checkout remains available on additional product details; cart quantity increment/decrement and removal update totals; Continue shopping works; WhatsApp checkout contains both product lines and the correct total; a second vendor does not inherit the first vendor's cart; native Back from the marketplace-selected detail returns to search.html without leaving the vendor grid visible.
- The landing-to-marketplace browser smoke also loaded search.html with no new CSP-blocked-script errors. The new search.html history behavior has source-level regression coverage; a fully data-backed interactive test of that marketplace product-detail button was not available because the local environment lacks the live Supabase configuration.
- Limits: these were Chromium viewport simulations, not physical Android/iPhone Safari tests. The catalog test used mocked Supabase data; live Supabase reads, actual vendor records, and real WhatsApp launch were not exercised. The local static server also shows pre-existing missing supabase-config.js and Sentry SRI warnings; no new CSP/runtime errors were observed in the targeted smoke tests. Do not merge to main or promote to production until a protected preview can be checked against live data and physical mobile Back behavior.


## 2026-10-29 auth/cart follow-up regression investigation

- **Vendor sign-out warning disappeared:** the delegated handler introduced for the dynamically-rendered Settings button explicitly signed out immediately. Keep delegation (a startup-only button binding misses the dynamically rendered control), but require the existing in-app `showConfirm` modal before calling Supabase. Cancel and missing-modal cases fail closed; double taps are guarded while the modal/request is active.
- **Sign In remained in Sign Up mode:** the landing bootstrap changed screen visibility only. It did not ask the app auth state to switch the active form. The explicit landing Sign In CTA now calls the app-owned `showLoginForm` transition; Sign Up continues to use its existing `btnShowSignup` handler. Browser history restoration does not force login mode, and pending OTP/reset screens retain their `qs-auth-pending` ownership.
- **OTP / reset persistence:** verification and password-reset email markers and restoration handlers remain in place. The Sign In mode change is gated off while an interrupted verification/reset flow is active; regression guards assert the storage and restoration paths.
- **Marketplace product-detail quantity:** the detail selector previously updated only the local `_detailQty` display and waited for a separate Add/Update Qty click before committing to the already-seeded cart. Both plus and minus now write the selected quantity immediately when the product already exists in the store-scoped cart, and the cart UI/total refreshes through the existing `cartSetQty` path.
- **Marketplace-to-catalog flash:** the deep-link handler already seeds the cart and opens detail in the same task, but the normal 320ms slide animation exposed the vendor grid underneath. Marketplace-origin detail now opens without that initial slide and restores the normal transition for later in-store product detail opens.
