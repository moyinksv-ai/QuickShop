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


## 2026-10-29 checkout, activation-claim, referral, and admin-filter follow-up

- **Product detail primary action:** the lower purchase-area button now says `Checkout` (with a live cart-total label), commits the selected quantity, and opens the store-scoped cart. It replaces the inert-looking `In Cart — Update Qty` action. The header checkout button was removed so the header can breathe.
- **Marketplace detail navigation:** Back to Marketplace stays on the left, Keep shopping stays on the right, and a small muted `More from this store` hint sits between them. Keep shopping returns to that same vendor catalogue. Standard storefront detail keeps its single Back to Store action; the lower Checkout action works there too.
- **Activation payment claim root cause:** the vendor application had no call to `qs_submit_payment_claim_v2`, even though the database RPC and admin read path existed. The new Settings activation section uses owner-authenticated RPCs to show activation/claim state and submit an idempotent `activation` claim. The click only records a claim for review; it does not activate a store. The server rejects new activation claims for already-active or founder accounts.
- **Activation queue/filter semantics:** Pending activation now includes inactive, non-founder accounts with no subscription expiry whether or not they have submitted a claim. Each row distinguishes `Payment claimed · Awaiting verification`, `Awaiting payment claim`, and rejected/cancelled claim states. The dashboard filter is an anchored fixed-position popover; selecting a filter closes it, active chips remain available to clear filters, outside click/Escape closes it, and it no longer pushes vendor cards down.
- **Referral attribution:** `/r/<16-hex-code>` redirects to `/?ref=<code>`; the landing app captures the valid code, resolves it with `resolve_referral_code`, and calls `set_my_referrer`. The new database migration writes `referral_source` and `referral_attributed_at` with the immutable `referred_by` assignment and exposes a narrow owner-only activation-status RPC. Admin activation fallback now records its source and timestamp too.
- **Referral reward timing:** `public.referrals` remains activation-triggered by design. A correctly attributed but inactive account should not yet have a reward row. Admin activation is the step that awards the referral after payment has been verified.


## 2026-11-07 — Add Product save feedback hidden behind full-screen workspace

### User-observed regression

The user reported that pressing Save cleared the entered product details but gave no visible confirmation that the product had been saved. The same workspace also contains validation, image-upload, and edit actions that rely on the shared toast system.

### Confirmed source root cause

- The Add Product workspace uses CSS `z-index: 1000000`.
- The global `appToast` is appended to `document.body` with inline `z-index: 99999`.
- The save handler did call its success toast, but the workspace was stacked above it. The same ordering hid other toast messages while Add/Edit Product was open.
- The add flow updates local app state and `addActivityLog()` calls `saveState()`, whose synchronous first step flushes local state to localStorage. The product is then handed to the IndexedDB pending-sync queue; cloud sync is asynchronous. The success toast is therefore a local-save acknowledgement, not proof that Supabase has already completed a remote sync.

### Scoped correction

- Raise the shared toast layer above the highest CSS overlay, not just above the Add Product workspace, so success and error feedback remain visible consistently.
- Use explicit success styling and clear copy for both product creation and product editing.
- Add regression guards for toast stacking and both save-success messages.
- Do not change product creation, validation, image upload, edit, or offline-sync semantics as part of this visibility correction.

### Verification status

Source inspection confirms the stacking mismatch and the save/queue ordering described above. Automated regression and preview deployment checks must be recorded against the resulting commit. The user must still confirm the visible success feedback on the preview. No main-branch or production change is authorized.


### CI follow-up — stale draft guard corrected

The first CI run after adding the toast-layering guard also exposed an older assertion in the draft-recovery test. It expected a pre-refactor inline call to `saveAddProductDraft()`; the current implementation correctly performs that save in `hideAddForm()` through the `draftWasSaved` result before clearing the form. The test now asserts the current lifecycle contract instead of requiring the obsolete source pattern. No draft runtime code was changed for this test correction.


## 2026-11-07 — Add Product draft lifecycle and Inventory bootstrap hotfix

### User-observed production regression

After PR #7 reached production, the user reported repeated saved-progress messages and phantom resume prompts after ordinary panel navigation. Resume could show an effectively empty form with remembered defaults, and discarding a draft did not reliably keep it discarded.

### Confirmed draft lifecycle causes

- Shared panel cleanup called `hideAddForm()` while the Add Product workspace was already closed.
- The old function saved form state before checking whether the workspace was open.
- The meaningful-content test counted remembered cost/quantity defaults as a real draft.
- A pending autosave timer could fire after discard/removal and recreate the just-removed localStorage record.

### Hotfix and additional preview regression

- `inventory.js`: closed-workspace cleanup now returns before any save/clear work; only product name, barcode, price, description, or image qualifies as meaningful draft content; pending autosave timers are cancelled during clear, discard/removal, restore, and save scheduling; scheduled saves are restricted to an open Add Product workspace.
- The first hotfix preview exposed a separate syntax regression in `hideAddForm()`: orphaned lines/braces remained after the new closed-workspace early return. This caused `inventory.js` to fail parsing, preventing the entire inventory module from bootstrapping. The user observed a blank inventory with inert controls.
- Commit `a668ad2b605e39eafbebac308f6fddf762fd8277` removed only the orphaned block and restored the function structure.
- Commit `bb1136c2867f7a9c5dfc97979ccacbc50ff48d27` added an explicit `vm.Script` syntax check for `inventory.js` to the regression suite. This closes the previous test gap where `appss.js` and other scripts were parsed but `inventory.js` was not.

### Verification and limits

- PR #8 latest HEAD: `bb1136c2867f7a9c5dfc97979ccacbc50ff48d27`; PR remains Draft and unmerged.
- GitHub Actions run #297 / run ID `42359908331`: **39 passed, 0 failed**, including test 14 (Inventory module parses) and test 35 (draft lifecycle prevents phantom drafts and cancels stale autosaves).
- Vercel deployment `dpl_3pXwzeYSyQwamLjPJqNPy66tVDsH`: **READY**, exact source commit `bb1136c2867f7a9c5dfc97979ccacbc50ff48d27`; preview: https://quickshopper-dk7bfi6lg-moyinks-projects-5a3815db.vercel.app.
- The user must still confirm actual preview runtime behaviour on mobile/browser. CI and READY establish syntax/build/deployment status, not that Inventory buttons and Add Product flows work in the user's browser.
- No schema, Supabase, product, stock, sales, auth, referral, or vendor-account data changes. Draft state remains device-local; no production data cleanup is authorized or needed.
- Rollback: keep PR #8 unmerged until preview acceptance. If later merged and a regression appears, revert the merge commit; no database rollback is required.


## 2026-11-07 — PR #8 production merge and release verification

- Owner explicitly confirmed all PR #8 preview tests passed and instructed merge.
- PR #8: https://github.com/moyinksv-ai/QuickShop/pull/8 — merged successfully.
- Merge commit / main SHA: `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`.
- Pre-merge backup branch: `backup/main-before-pr8-2026-11-07` at `3d68545d507da9b8d1466edda9d8b8d5a565daaa`.
- Pre-merge Vercel production rollback deployment: `dpl_6WmW9mzGsyJcYgMLFGH49nayG87q`, READY for that exact pre-merge SHA.
- Latest PR-head CI run #300 / ID `42361862489`: success. The earlier exact test log for the functional syntax-guard commit `bb1136c2867f7a9c5dfc97979ccacbc50ff48d27` showed 39/39 passing, including Inventory syntax parsing and draft lifecycle checks. The final docs-only PR head also passed the workflow.
- Vercel preview for PR head `47b1e7f9841783ab6689e5d7c107a281f6c9f9d5`: READY at https://quickshopper-knh4yusbg-moyinks-projects-5a3815db.vercel.app. Owner confirmed all preview tests passed.
- Production deployment `dpl_E3Q1dbczVXkQ9eWic7oonKPXoGas`: READY for exact merge SHA; aliases include `quickshopper.vercel.app`.
- Scope remained four files: `inventory.js`, `tests/regression-guards.test.js`, `handover.md`, `regression.md`. No schema, Supabase, product, stock, sales, auth, referral or vendor-account data mutation. No database rollback required.
- Production deployment readiness is confirmed; authenticated production smoke QA remains outstanding. Use read-only checks or an authorized test vendor/account, never a paying vendor's live inventory.
- Recovery: Vercel rollback to `dpl_6WmW9mzGsyJcYgMLFGH49nayG87q`; source control revert merge commit `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`.

### Next workstream per handover

Continue the urgent Supabase egress / marketplace / catalogue caching investigation (§3 of `handover.md)), beginning with read-only evidence gathering: official historical daily Usage breakdown for the >2 GB day (verify exact date/timezone and cached vs uncached service categories), plus request/response baselines for marketplace, product detail, storefront and logged-in vendor journeys. Then trace service-worker cache strategy, route refresh invalidation, realtime subscription scope, deterministic ordering/pagination and image delivery. Do not implement caching/schema changes or claim savings until the cause is measured and verified.


## 2026-11-08 — Supabase egress / marketplace investigation checkpoint

### Verified production usage evidence
- User supplied the Supabase Organization Usage screenshots for the current billing cycle (22 Oct 2026 → 22 Nov 2026).
- Cached Egress is **6.803 GB / 5 GB (136%)**, with **1.80 GB overage**.
- Normal Egress is **0.356 GB / 5 GB (7%)**.
- Cached Egress per-day chart shows a **2.984 GB spike on 1 Nov 2026**.
- The available UI does not provide a further per-service breakdown for that 1 Nov cached-egress bar.
- Therefore: cached egress is a confirmed cost/usage problem, but the exact QuickShop request/resource responsible is **not yet proven**.

### Current hypothesis and guardrail
- Marketplace/catalogue traffic is a leading hypothesis because the source audit already found repeated public catalogue/image fetch opportunities, broad product-change invalidation, online network-first behavior, and original Storage image URLs.
- Do not convert these observations into a root-cause claim until request counts/response sizes and execution paths are measured.
- Preview deployments can generate real Supabase traffic when they use the production project. Count the requests generated by preview testing rather than treating Vercel deployment creation itself as the egress cause.
- Do not delete vendor/product/image data or make production cache/schema changes as a speculative response.

### Current branch
- Investigation branch: `investigate/supabase-egress-catalogue-2026-11-07`.
- Investigation remains read-only at this checkpoint; no code, SQL, schema, storage, Supabase config, or vendor data has been changed.
- Production baseline remains untouched.
- Next step: measure marketplace/storefront request counts and response bytes, especially Storage image delivery and repeated catalogue loads; then trace the exact reload/invalidation path before proposing a fix.

### Supabase restriction-risk note
- The dashboard warns that the organization exceeded quota in the previous billing period and may be restricted from **14 Nov 2026** if it remains over quota.
- This is a usage/restriction warning, not evidence that QuickShop will permanently terminate on 14 Nov. Keep the app protected by reducing future usage and monitor the organization's actual status. Do not promise that waiting until 22 Nov is the only recovery path; if Supabase applies a restriction, the team should follow the current Supabase account guidance or upgrade if necessary.


## 2026-11-08 — Supabase egress tracing evidence

### Repository and scope
- Investigation branch `investigate/supabase-egress-catalogue-2026-11-07` was re-fetched and compared with `main` before this tracing pass.
- Pre-update comparison: 5 commits ahead / 0 behind; only `handover.md` and `regression.md` differed from `main`. Re-fetch the current comparison after this documentation update. No runtime code or Supabase state was changed.

### Proven source invariants to guard during any future optimization
- Marketplace first-page product cards render original `image_url` values directly because `_IMG_TRANSFORM = false`; product-card images do not set `loading="lazy"`.
- Marketplace product-card `touchstart` prefetches matching vendor offers from `qs_market_offers_v2`; the promise is reused for detail opening only while the in-memory prefetch cache survives. A marketplace freshness invalidation clears that cache. Direct slug navigation performs a separate `qs_market_products_v2` lookup.
- Marketplace card images set `src` immediately without native lazy loading; storefront product-card images do set lazy loading (first dual-image eager, second lazy). Browser transfer counts/bytes remain unmeasured.
- The sampled PostgREST logs (233 rows) expose only `path=/` in the available attributes, and realtime logs do not expose a reliable application-level products-change event count. They cannot supply per-RPC byte attribution or identify the client journey.
- Marketplace freshness is not a cheap freshness check: products realtime events call `scheduleMarketRefresh()`, which clears the in-memory catalogue/offer caches and routes back through the current URL, causing a fresh catalogue request when online and visible.
- `pageshow` and `visibilitychange` can invoke the same refresh path, subject to the current 5-second lifecycle throttle. Any optimization must preserve correct Back/Forward restoration while avoiding duplicate authoritative downloads.
- Marketplace category pages use explicit `range()` pagination and Load More; do not silently replace that user-controlled boundary with an all-products fetch.
- Public storefront initialization can receive the entire product list through `qs_get_store`; the fallback path also fetches the entire list. Storefront product realtime events re-fetch that full list.
- Supabase public Storage images must remain public-cache-safe and must never be replaced with URLs that leak private/authenticated vendor data.

### Read-only measurement recorded
- Supabase Storage logs for 2026-11-07 00:00Z → 2026-11-08 00:00Z: 525 successful GETs, 29,941,524 logged response-content bytes.
- Production root referer `https://quickshopper.vercel.app/`: 133 GETs, 28,309,399 bytes.
- No Storage GET with a `search.html` referer appeared in that sampled window.
- These are log observations only; they are **not** the Supabase billed Cached Egress number and must not be reported as measured savings/cost reduction.
- The largest sampled original images are hundreds of KB each, with multiple same-file 200 responses appearing twice. This supports the image-transfer hypothesis for public storefront traffic but does not establish the historical Nov 1 billing spike's sole cause.

### Release guard
No cache/schema/realtime/Storage optimization has been approved or implemented from this evidence alone. The next test must capture browser request initiators and transfer bytes for each named journey before any production-facing optimization is proposed.


## 2026-11-08 — Cached egress and storefront image-load guardrails

- The 2026-11-07 07:00Z → 2026-11-08 07:00Z Supabase gateway sample shows production public Storage image CDN HIT traffic of 2,188 requests / 275 unique URLs / 399,071,202 response-content bytes; 70 MISS requests / 15,545,377 bytes. This is log-observed response content, not a billing-meter reconciliation.
- One anonymized Storage owner-folder group contains 68 distinct image URLs and accounts for 1,980 HIT requests / 351,585,456 response-content bytes. Do not expose the folder/user ID in docs intended for broad sharing.
- Supabase documentation defines Cached Egress as CDN cache-hit egress and says Cached Egress applies only to Storage. This confirms public Storage image CDN hits are directly relevant to the billing category; gateway byte totals remain approximate observations.
- Main `catalog.js` currently renders every filtered product card from `allProducts`. For dual-image cards, the first image is assigned a URL and marked `loading='eager'`; only the second is lazy. Single-image cards are lazy. This eager-first-image behavior is a high-priority candidate to test, not an approved change.
- `qs_get_store` returns the complete storefront product list. Do not change its return shape or the store's product data contract as part of a first image-delivery optimization without a separate compatibility audit.
- `sw.js` cache-first image behavior is per-client and only helps after that browser has cached an image. Do not assume it prevents first-view egress for new visitors.
- API log sample: production `qs_get_store` POST 46 calls; `public_catalog_products` GET 12 calls; production `qs_market_products_v2` GET 2 calls. These are request counts only; response byte headers were not available for many API rows.
- Preserve: image correctness/fallbacks, product ordering, category/search filters, dual-image swipe interaction, lightbox, stock states, cart behavior, vendor product visibility, and storefront realtime stock updates.
- Any proposed fix must be narrowly scoped, tested on a preview using production-like catalogue sizes, checked for Android mobile behavior and low-bandwidth conditions, and compared with main. No main merge or production deployment without explicit user approval.


### 2026-11-08 — Existing image pipeline guard

- Product uploads already pass through `compressImage(file)`: default max width 1024 px, JPEG quality 0.7, then upload to public `user_images`.
- Storefront `safeImgSrc()` returns the original HTTPS Storage URL unchanged; no storefront thumbnail transformation is currently applied.
- The measured 68-image group is about 12.9 MB for one copy of its files but about 351.6 MB across 1,980 CDN HIT responses in the sample. Prioritize testing when/how catalogue card images are requested before changing upload compression. Protect image clarity and vendor originals.


### 2026-11-08 — Clarification: high-repeat images vs eager loading

- Read-only aggregate matching of the high-repeat image owner's Storage folder to product rows found 230 stored objects, 108 primary product-image references and 1 secondary-image reference.
- The 68 unique URLs in edge logs are only the images actually requested in the sampled window; they are not necessarily the complete catalogue. Single-image product cards are lazy-loaded, so browsing/scrolling by many separate visitors is a plausible explanation for which subset was fetched.
- Do not claim the 68-image group was caused by dual-image eager loading. That code behavior exists and should be tested independently, but the current data does not establish it as the cause of these specific 68 URLs.
- Preserve the distinction between per-visitor first-view image delivery and repeated requests across different visitors. Edge logs do not provide session IDs that let us distinguish those journeys.


## 2026-11-12 — Egress trigger audit regression coverage

### Fetch-trigger invariants
Before implementing freshness/caching changes, verify that the following remain true:
- Marketplace first load performs the expected initial product fetch and does not duplicate it through a second initialization path.
- Marketplace lifecycle resume/visibility/online events are coalesced according to the implemented freshness policy and do not create refresh storms.
- A marketplace realtime event does not cause multiple full catalogue fetches for one logical change unless explicitly justified.
- Marketplace search, category pagination, Load More, Stores lazy loading, and product-detail offer loading remain functionally separate.
- Storefront initial load uses the fast `qs_get_store` path when available and does not accidentally add duplicate fallback product fetches.
- A current-vendor product realtime event updates the storefront correctly; unrelated vendor events must not rebuild the current catalogue.
- API response-byte measurements and Storage image response-byte measurements are recorded separately; neither is treated as a billing reconciliation without supporting evidence.

### Marketplace → storefront handoff regression
- Marketplace product detail → vendor card → storefront opens the intended vendor.
- `pid` correctly opens the originating product on the initial handoff.
- Back/Keep Shopping behavior remains correct.
- WhatsApp/order handoff remains correct.
- Refreshing the vendor storefront after the handoff must stay at the vendor catalogue/current screen rather than reopening the originating product detail.
- Direct vendor links with a legitimate `pid` must retain their intended product-opening behavior.

### Baseline test protocol
Run the eight named journeys on the unchanged baseline and record request count + response bytes before any freshness change. Repeat each journey sufficiently to separate cold/first-view from warm/repeat behavior. Do not mutate paying vendors' inventory to create realtime events; use existing read-only traffic, an authorized test vendor, or controlled non-production test data where available.

## 2026-11-13 — Storefront incremental freshness regression coverage

### New guardrails
- Storefront cache is versioned and scoped by store/token input.
- Freshness metadata requests only id, updated_at, and qty.
- Changed products are fetched by bounded ID batches rather than re-fetching the complete catalogue.
- Initial bootstrap metadata seeds fingerprints without causing a second full product download.
- Realtime product changes must not call the old full fetchProducts() path.
- Realtime payloads are applied directly when available; incomplete payloads may fetch only the affected product.
- Incremental changes/deletions update the rendered catalogue and persist the new cache state.
- Existing Marketplace/Storefront handoff, cart, detail, stock, ordering, and image-loading invariants remain in the existing guard suite.

### Verification
- PR #9 remains draft; do not merge to main until preview QA passes.
- Latest CI regression run #331 / ID 43361409456 succeeded.
- Latest preview deployment is READY for commit fb404835867f24fcd5baa8d88bb4e6883ec47bf3.

## Next-batch regression coverage — product storefront eligibility

Add explicit regression coverage for the risk that vendor-facing stock/cost fields being visually hidden or easy to forget can make a valid product disappear from the public storefront.

The future guard should verify:
- A product with all required storefront fields is visible.
- A product missing/invalid storefront-driving fields is classified predictably.
- The vendor can see the reason/status when a product is not storefront-ready.
- Zero stock is distinguished from missing stock and from an unpublished/invalid product.
- Price/cost visibility requirements are verified against the actual current storefront eligibility predicate before changing UI.
- Fixes must not reintroduce full catalogue refetches or bypass server-authoritative stock validation.


## Vendor sync traffic investigation — 2026-11-13

Findings: Supabase edge logs showed repeated get_my_products pulls and qs_upsert_products_and_listings_v2 calls within the same short activity windows. Code tracing identified two independent causes: IndexedDB queue writes scheduled an immediate sync on every transaction completion, while indexeddb_sync.js also scheduled syncs from online, auth, pageshow, and visibilitychange. The isSyncing flag only prevents overlap; it does not coalesce a trigger that arrives immediately after a prior sync finishes. syncCloudData() also has multiple callers, and its existing 5-minute freshness guard existed only in the visibility handler, so other automatic callers could still start a full vendor pull.

Safe fix implemented on branch investigate/supabase-egress-catalogue-2026-11-07: queue/lifecycle triggers now share a 750 ms debounce scheduler, coalescing rapid IndexedDB writes and lifecycle events without changing the queued payload or RPC batching. Automatic syncCloudData() pulls now have a 15-second cooldown; explicit user-driven refresh, manual sync, and initial authenticated reconciliation remain forced. No product fields, save semantics, RPC/database functions, IndexedDB data model, or vendor behavior were changed.

Regression guard added to verify the scheduler/cooldown and preserve forced manual sync. Next QA: exercise rapid product save/restock/delete, app switch/resume, reconnect, and manual refresh; compare edge-log request counts before/after. Pay particular attention to whether one logical product action produces one qs_upsert_products_and_listings_v2 call and whether automatic lifecycle events stop producing duplicate get_my_products calls within 15 seconds.


## 2026-11-17 — Marketplace image-loading optimization guard

The marketplace product grid now uses native lazy loading and asynchronous image decoding for product-card images.

### Protected behavior
- Product-card image URLs remain unchanged.
- Existing shimmer/loading state remains intact.
- Existing `onload` cleanup remains intact.
- Existing error fallback to the original public Storage URL remains intact.
- Existing final placeholder behavior remains intact.
- Card dimensions, `object-fit: cover`, and visual styling remain unchanged.
- No vendor-uploaded originals, image compression settings, Supabase Storage configuration, or database schema were changed.

### Why this is intentionally narrow
Lazy loading can reduce unnecessary first-view image requests when users do not scroll far enough to expose every card. It is therefore a safer first image-egress experiment than changing JPEG quality or resizing uploaded originals.

### Next image experiment
Do not assume quality `0.5` is better than `0.7`. Compare representative images at controlled display dimensions and several quality levels, recording actual browser transfer bytes and visual acceptability. Prefer purpose-sized display variants while retaining originals if a measurable reduction is justified.



## 2026-11-22 — Marketplace live-trigger regression evidence

- Controlled live Supabase correlation confirmed the marketplace request volume during the test window without establishing Realtime as the trigger.
- Protect the distinction between **request correlation** and **trigger attribution**: 9 marketplace-product GETs and 66 marketplace-offer GETs in the 08:53–08:59 window are real gateway requests, but current Supabase Realtime logs do not identify a matching products-change delivery to the browser.
- Storage response volume for the same window was 92 public-object GETs / 19,140,654 logged response bytes. Keep API and Storage byte measurements separate.
- `qs_upsert_products_and_listings_v2` 400/P0001 errors occurred during the preceding vendor edit attempts and are a separate regression/investigation item.
- Do not weaken or remove marketplace freshness solely to reduce these request counts. First obtain browser initiator/resource timing for a controlled repeat so any optimization targets the actual trigger.



## 2026-11-25 — Next-release marketplace/auth/navigation guards

### Marketplace freshness
- Persisted first-page marketplace snapshot must exist and be scoped/versioned.
- Valid snapshot must be considered before the full `qs_market_products_v2` first-page query.
- Freshness probe must use only lightweight offer metadata (`offer_updated_at` + exact count).
- Changed canonical IDs must be fetched from `qs_market_products_v2` in bounded batches.
- Offer-count decrease must not silently leave stale/deleted cards; conservative authoritative fallback is required.
- Marketplace cache failure must not erase a usable offline snapshot.
- Existing product-detail freshness guard remains: a products-table event must not re-route an already-open product detail.

### Vendor navigation / auth
- Vendor history writes must merge with the existing history state rather than replacing `qsScreen` with a bare `qsView`.
- Settings/activation/payment-related Back must remain inside the vendor app until the vendor-app history boundary is intentionally reached.
- Sign-out destination marker must be written before local Supabase `signOut()` because `SIGNED_OUT` fires immediately for local scope.
- Sign-out must end on a visible authenticated-out surface and must not resurrect the vendor app after refresh.
- Do not mark either regression as verified solely from source inspection; preview behavioral testing is required.

### Release gate
- PR #12 is draft/unmerged.
- Production remains untouched.
- Required manual smoke paths for the next release: sign out → visible auth/landing → refresh; vendor Settings/activation Back → vendor Home; marketplace refresh unchanged → no full first-page payload; change one product/offer → only affected reconciliation; storefront refresh unchanged → cached catalogue + metadata check; offline revisit → cached state remains usable.


## 2026-11-26 — CI guard correction + SW/image-cache review

### CI
- Run #400 / ID 45514141536 failed before executing any regression test because `tests/regression-guards.test.js` contained three malformed regular-expression literals in the vendor-history guard.
- The malformed pattern `/history.replaceState({ qsView: restoredView }/` caused Node 20 to throw `SyntaxError: Invalid regular expression: Unterminated group` at line 750. This was a guard syntax failure, not evidence that the vendor-history code regressed.
- Corrected the three negative assertions to literal `String.includes()` checks, preserving the intended invariant that bare history-state writes must not reappear.
- Corrected head: `2d8d9467aa247b1b60cfa7f7ed45f11f16fb1bd7`.

### Service worker / offline images
- Current `sw.js` is identical on `main` and the next-release branch at the reviewed head; no SW regression was introduced by PR #12.
- Supabase Storage URLs are deliberately exempted from the generic Supabase network-only rule and enter the image cache-first handler. The image handler uses `qs-images-v4.0`.
- Production image uploads currently end in `.jpg`, so the handler's extension matcher covers QuickShop's current upload path.
- Marketplace cards use native lazy loading. Consequently, only images actually requested by the browser have been opportunistically cached. A persisted product snapshot can therefore be available offline while some offscreen product images are not cached.
- Do not change the SW to pre-download all marketplace images merely to make offline browsing visually complete; that would create avoidable Storage transfer and undermine the egress work. If a stronger offline-image guarantee is required, it should be designed as an explicit bounded asset-prefetch policy and measured separately.
- A dedicated SW regression guard should be considered before the release only if the repository test harness is extended to inspect `sw.js`; no runtime SW change is justified by the current evidence.

### Release evidence
- Exact-head Vercel deployment: READY, deployment ID `dpl_9KCaTWzPqxVfvKS7AjLXvyFnXQYQ`.
- Exact-head GitHub Actions result is still outstanding because no new workflow run is currently exposed for the connector-created commit.
- PR #12 remains draft/unmerged. Production remains untouched.


## 2026-11-26 — Regression suite follow-up: CSP + brittle guard corrections

- Run #405 / ID 45792464601 executed successfully through the test runner and reported **42 passing / 5 failing**.
- Four failures were test-implementation defects: literal source snippets containing regex metacharacters were asserted with regexes that did not escape them. These were corrected to literal `String.includes()` checks.
- The fifth failure was a real CSP invariant failure: the SHA-256 digest of the marketplace router inline script was absent from the page CSP. The page had stale hashes after the marketplace router changed. The CSP was corrected with the hashes computed from the current checked-in inline scripts; the test remains an exact digest check.
- No weakening of the CSP test was made.
- No `sw.js` change was made; its behavior remains identical to `main` and still uses the existing cache-first image path for eligible public Storage images.
- Latest branch head: `0c2ab8a8306423bb7f5bc0092d064ce3e6ed46cd`. PR #12 remains draft/unmerged and production is untouched.
- CI has not yet produced a new run for this latest head; do not treat the branch as CI-green until the workflow reports success.


## 2026-11-28 — PR #12 exact-head release and image-delivery regression gates

### Verified release candidate
- Canonical repository: `moyinksv-ai/QuickShop`.
- PR #12: https://github.com/moyinksv-ai/QuickShop/pull/12 — OPEN, DRAFT, UNMERGED.
- Branch: `next-release-freshness-regressions-2026-11-25`.
- Exact runtime/test head under review before this docs-only update: `52379bf6fc16696b2ff9110f70d649f9290216e9`; base main: `10de99a4fba6644f4fa3d0256b33aacf0170d091`.
- Compare: 31 ahead / 0 behind main; five changed files before the docs update.
- Exact-head Regression guards runs #416 (push, ID `46026801215`) and #417 (pull_request, ID `46026811859`) both completed successfully.
- Exact-head Vercel deployment `dpl_Da3smtgFMLVSHZaLDZoDSKphi4bt` is READY. Preview alias: https://quickshopper-git-next-release-69fe11-moyinks-projects-5a3815db.vercel.app
- Automated green + READY is not manual acceptance. Do not mark any browser-level regression fixed/verified until the smoke test is actually performed.

### Marketplace freshness assertions
- Warm revisit with unchanged data renders the persisted first-page snapshot and uses the lightweight exact-count/latest-`offer_updated_at` probe; it must not download the full first-page product payload.
- Changed offers map to canonical IDs and fetch only affected cards in bounded batches.
- Offer-count decrease triggers conservative authoritative fallback; no stale/deleted item may silently remain.
- If the probe fails/offline, a valid persisted snapshot remains usable.
- Product detail must not be torn down by a marketplace products event; returning to listing must reconcile freshness.
- Search, category pagination, Stores lazy loading, Load More, product-detail offers and sort/order behavior remain distinct and correct.
- Test same-count updates, multiple changed IDs, deletion/out-of-stock, repeated refresh, lifecycle resume, realtime event and cooldown boundaries. Assert requests/bytes and UI state, not only source snippets.

### Storefront freshness assertions
- Warm unchanged revisit uses the scoped cache plus lightweight `products(id, updated_at, qty)` metadata query, not a full catalogue download.
- Changed/new products are fetched by bounded IDs; removed/out-of-stock products are reconciled; incomplete realtime payloads may fetch only the affected product.
- Existing IndexedDB/offline vendor sync queue, pending writes, forced manual sync and server-authoritative stock validation remain intact.
- Realtime updates remain vendor-scoped and do not rebuild the full catalogue.
- Marketplace handoff, direct vendor links, product detail, cart, WhatsApp checkout, Back/Keep Shopping, ordering and image gestures remain correct.

### Navigation/auth release gates
- History state writes merge vendor view state with existing landing/auth state; no bare `{ qsView: ... }` replacement may return.
- Vendor payment/activation/settings Back stays inside the vendor app until the intended history boundary.
- Sign-out destination marker is written before local Supabase signOut emits `SIGNED_OUT`.
- Sign-out shows a visible signed-out/auth surface, not a blank page.
- Refresh after sign-out remains signed out and does not resurrect the vendor app.
- Browser Back/Forward, refresh, cold load and PWA resume are tested separately.

### Offline/image-cache invariants
- Do not change `sw.js` without a separately evidenced defect and explicit scoped review.
- Existing `qs-images-v4.0` behavior is opportunistic: only images the browser has actually requested can be present in its cache. Product snapshot persistence does not imply every lazy/offscreen image is cached.
- No eager full-marketplace image download. That would undermine egress reduction.
- Offline product metadata/catalogue availability and offline image availability are separate assertions; report them separately.
- Preserve original public Storage URL fallback and current image error/placeholder behavior.

### Image resizing/display consistency — next measured workstream
- Current marketplace transform flag is false and current card/detail paths serve original Storage objects; storefront also uses original public URLs. Lazy loading is not image resizing.
- Keep canonical uploaded originals immutable. Any display variant must be a derivative with safe fallback to the original.
- Derive target pixel dimensions from measured CSS slot dimensions × devicePixelRatio; test representative devices and image aspect ratios. A 50% reduction in both width and height means 25% of the source pixel count, but encoded bytes are content/format dependent and must be measured.
- Test card/detail/lightbox variants independently; ensure a large/lightbox view does not accidentally receive a tiny card thumbnail.
- Preserve aspect ratio/crop consistency, object-fit behavior, visual hierarchy, card grid alignment, image clarity, shimmer, decoding, error fallback, secondary-image swipe, lightbox, accessibility, cache versioning and lazy loading.
- Compare actual transfer bytes (cold and warm CDN/browser cache) and perceptual quality at multiple controlled dimensions/formats/quality levels. Do not select quality 0.5 or alter global upload compression based on intuition.
- Do not enable Supabase transform endpoints until plan support, transformation cost, URL semantics, cache behavior and net egress impact are verified.
- Add source/runtime regression tests for variant selection, responsive sizing, original fallback, no accidental eager loading, no destructive original replacement, and consistent marketplace/storefront presentation.

### Manual preview acceptance matrix (must be recorded before merge)
1. Marketplace cold load and warm unchanged revisit; inspect full page query vs metadata probe.
2. Marketplace one-product change, multiple changed IDs, same-count edit, deletion/stock zero, and detail-open realtime.
3. Search/category/Stores/Load More/pagination/order.
4. Storefront cold/warm revisit, one product change, add/remove/out-of-stock and vendor-scoped realtime.
5. Marketplace → product detail → vendor storefront → Back/Keep Shopping → WhatsApp; refresh must not reopen stale originating product.
6. Vendor Settings/payment wall → system Back; remains in vendor app.
7. Explicit sign-out → visible auth/landing → refresh; stays signed out, no blank screen or app resurrection.
8. Offline revisit for both marketplace and storefront; distinguish cached product data from unrequested images.
9. Android browser/PWA, low bandwidth, reconnect and lifecycle resume.
10. Record request initiators, request count, HTTP status, transferred/decoded bytes, image bytes, cache state and UI correctness. Compare preview and main under equivalent test conditions.
- Use only a dedicated authorized test vendor/test products for mutations. Do not edit paying vendors' live inventory.

### Merge gate
PR #12 remains draft and unmerged until manual preview QA is completed and reviewed. CI success and deployment READY do not establish functional correctness or measured egress savings. No production/main changes without the user's explicit approval.


---

## 2026-11-28 — regression cases added for PR #12

### Authenticated navigation and sign-out

- While `body.mode-app` is active, `qs-init.js` must not interpret vendor history entries as landing/auth transitions or stop the vendor popstate listener.
- Vendor history restoration must accept Home and every valid tab, and must not push a new history entry while restoring a popped state.
- At the authenticated app history boundary, Back must ask whether to sign out. Cancel must restore the exact current vendor view without duplicate history entries.
- The Settings Sign Out button and Back-boundary sign-out must use the same guarded flow.
- `qs_show_auth_after_signout` must survive the immediate Supabase `SIGNED_OUT` callback and be consumed only by the subsequent initial-load auth check. After reload, auth/login must be visible; a public landing transition must not override it.

### Marketplace → storefront handoff

- A marketplace-origin `pid` opens the selected product on the first storefront visit.
- The handoff `pid` is removed from the URL after capture, while `store`, `from=market`, and `market_product` remain.
- Refreshing the storefront must show the vendor product grid, not replay the selected product detail.
- Direct vendor `?pid=` deep links remain persistent and continue to open the requested product.
- Returning to marketplace must still route to the originating canonical product slug.

### Offline queue ownership and sync truthfulness

- New IndexedDB actions carry the creating vendor's `userId`.
- A sync for vendor A processes only vendor A's queue actions; vendor B's actions remain queued for B.
- Legacy unowned non-destructive actions are claimed only when their entity is present in the active vendor's local snapshot. Legacy deletes are claimed only after a user-scoped RLS query confirms ownership. Ambiguous legacy actions remain queued and are surfaced as incomplete, never silently dropped or sent to another vendor.
- The database error `Product id belongs to another vendor` remains enforced; no client change weakens the SQL ownership guard.
- Concurrent sync callers await the same in-flight result. An in-flight/duplicate call cannot return a false success.
- Manual Sync Now performs one push+pull pass over the pending queue only; it must not re-enqueue the full catalog or push twice. The UI distinguishes push failure, pull failure, and unassigned legacy actions; it must not say Sync complete when any required work failed.

### Product image upload/edit

- A failed replacement upload must not clear an existing product image from the edit form.
- Image picker inputs can select the same image again, including the second image slot.
- File read, browser decode, canvas compression, and Storage upload failures produce distinguishable messages.
- A Storage upload success followed by product RPC failure must be reported as a product-sync failure, not mislabeled as an image binary upload failure.
- Verify on Android preview with JPG/PNG/WebP and inspect Storage request logs. Absence of a Storage POST indicates failure before the Storage request and must be diagnosed client-side.

### Release gate

- All above source guards and existing marketplace/storefront freshness, offline sync, product-detail freshness, and image fallback guards must pass CI.
- Android preview retest is mandatory. No merge or production deployment until the user explicitly approves after retest.


### Additional sync/image regression guards (2026-11-28)

- An edit queued while a push is running must trigger a follow-up pass after the active batch settles; it must not remain stranded behind a coalesced promise.
- Concurrent cloud-sync callers for the same vendor await the same result. A different vendor cannot receive another account's result.
- Offline/not-ready sync must return an incomplete result, never a success-shaped skip.
- Manual Sync Now sends pending actions only; it must not enqueue every local product or force a full-catalog write when no product changed.
- Android file-picker MIME metadata may be generic even for valid image bytes; do not reject solely by MIME. Decode the bytes and return a clear unsupported-format/read/compression/storage error.
- Legacy delete actions are claimed only after an explicit `user_id = currentUser.id` query confirms the row belongs to the current vendor.


### Verification snapshot — 2026-11-28

The regression suite passed **51/51** on runtime commit `07d8c6f6eab6ea4f6391b9f414685b68bc3b15b6`. The exact commit's Vercel preview reached `READY` and returned HTTP 200. Authenticated Android tests remain an explicit release gate; source tests and public page reachability do not replace them.


### Final sync consistency regression cases (2026-11-28)

- After the cloud pull/reconciliation, re-read the active vendor's pending queue. If any actions arrived during the pull, flush them before reporting completion.
- Login recovery may bulk-queue local products only after a successful pull confirms zero cloud products and the initial pending push did not fail. A normal login with a non-empty cloud catalog must not requeue the whole local catalog.


### Storefront atomic stock freshness and Android UI follow-up (2026-11-28)

- A cached storefront must perform a compact metadata probe on every full page entry; a 15-second recent-probe TTL must not suppress a stock freshness check on explicit refresh.
- The metadata probe reads only id, updated_at, and qty. If no fingerprints changed, keep the cached product payload. If one product changed, fetch only that product by ID. Do not re-fetch the full catalogue for a single edit.
- After qs_upsert_products_and_listings_v2 returns success, patch same-origin storefront cache entries whose storeId matches the authenticated vendor. Replace only the matching product and metadata; remove the product from the sellable cache when qty reaches zero. Do not patch any cache on RPC error.
- Product/listing RPC remains server-authoritative. Never optimistically update a public storefront cache before server confirmation. Preserve checkout stock validation.
- Android image preparation should prefer Blob URLs and revoke them after decode; FileReader is only a compatibility fallback. Keep image size/format validation and existing-image preservation.
- Auth Home must navigate through the canonical landing transition directly, without depending on history.back() after sign-out.
- Closed product-detail overlay must be visibility-hidden and non-interactive so its heading cannot bleed into the storefront grid during scroll. Detail title and auth Home button should remain high-contrast and accessible.
- Release gate: verify vendor edit, successful RPC, same-device cache patch, storefront refresh shows new stock without a full catalogue fetch; test zero-stock removal and another vendor cache isolation. Run CI and retest on Android preview before merge.


### Verification — atomic stock freshness and UI follow-up (2026-11-28)

- Regression guards: **56/56 passed**, run #508, runtime commit bbfbcbbc2adf57fee8902db03b0c8f8c8ff0bfe3.
- Exact-commit Vercel preview: deployment dpl_8ViN9d74v65LxAum4UAktKjEvKpa, state READY.
- Android acceptance tests remain required: immediate stock update on storefront revisit, zero-stock removal, no full catalogue refetch for one changed product, image selection, auth Home, and no closed-detail overlay bleed.
- This is not a production release approval. PR #12 remains draft/open/unmerged.


### Marketplace deletion, request-volume and storefront permission guards (2026-11-28)

- When active-offer count falls, the delta view cannot expose the removed row because `qs_market_offers_v2` filters `qty > 0`. The client must fetch the authoritative visible first page from `qs_market_products_v2` and replace the persisted snapshot; returning null and retaining stale cards is forbidden.
- Persist `probedAt` in `qs_market_snapshot_v1:home`; a 15-second freshness TTL that is not serialized does not throttle re-reads from localStorage.
- Coalesce overlapping `reconcileMarketSnapshot` calls. Initial non-persisted `pageshow` must not trigger a second first-page request immediately after `routeFromURL()`.
- Do not prefetch vendor offers on card `touchstart`: touchstart fires for scroll gestures. Fetch vendor-offer rows only after an actual card click. Keep the detail query projection to fields used by vendor cards: product_id, vendor_id, storefront_name, storefront_tagline, storefront_avatar_url, price.
- Storefront freshness must not query the base `products` table as anon. Existing `public_catalog_products` is anon-readable but omits `updated_at`; add that safe timestamp to the view in a reviewed Supabase migration, then query the view for both metadata and changed product rows. Never solve this by granting anon SELECT on `products`.
- Release blocker: four preview `GET /products` metadata requests returned 401 during 15:23–15:34 UTC on 2026-11-28. Do not merge until the view migration and client query are verified.
- Request sample in that preview window: 5 `qs_market_products_v2` GETs (including two duplicate first-page and two duplicate changed-ID reads), 17 watermark GETs, 10 delta GETs, and 104 canonical offer GETs for 53 distinct canonical IDs. This is a short test window, not a general production traffic baseline.
- Sync signal: 3 product/listing upsert RPC calls returned 204 in the same window. Earlier 400/P0001 cross-vendor ownership errors remain in the broader day log and should continue to be monitored.


### Verification after marketplace deletion/request fixes (2026-11-28)

- Latest app-code commit tested: `4ed6ac21df2151ff803681ff8c14aac8b38b3ca7` (subsequent commits only update release notes).
- Regression guard run #530: **59/59 passed**.
- Exact-app-commit preview deployment: `dpl_EobHUowprYQihQKSJc7XCjiHdeZR`, READY.
- PR #12 is still draft/open. Storefront metadata query 401 is a merge blocker pending a safe public-view migration; do not grant anon SELECT on base products.



### Public storefront view access and incremental freshness (2026-11-28)

- Anonymous storefront freshness metadata must come from `public_catalog_products`, selecting only `id, updated_at, qty`.
- Changed storefront product rows must also come from `public_catalog_products`, filtered by the matching `user_id` and fetched in complete sequential ID batches of at most 100. Never truncate reconciliation after the first 100 IDs. Do not query the protected `products` table from the public storefront.
- Preserve `updated_at` in mapped changed-row cache entries so Realtime updates do not create a false stale fingerprint and trigger a redundant fetch on the next revisit.
- The changed-row projection must contain only columns exposed by the public view; `created_at` is not part of that view.
- If the public view request fails, surface/retain the failure state; do not silently fall back to a base-table request that anonymous users are intentionally not permitted to make.
- The database permission invariant is: anon can SELECT `products.updated_at` at column scope; anon does not have table-wide SELECT on `products`; `public_catalog_products` exposes `updated_at` and retains `security_invoker=true`.
- No full catalogue refetch for one changed product. Keep the bootstrap metadata seed, local removal of products absent from the active public view, bounded changed-row fetch, and persisted cache behavior.
- Release verification must include a no-change revisit (metadata probe only), one-product update (one changed-row fetch), zero-stock removal, another vendor's storefront isolation, and no anonymous `/rest/v1/products` requests. Confirm IndexedDB/offline vendor sync and atomic cache patch behavior remain unchanged.
- The live SQL was applied by the user in Supabase Dashboard. A version-controlled migration file and migration-history reconciliation remain outstanding until CLI workflow is available; do not manually fabricate migration history.


---

## 2026-11-28: first-rollout-safe PWA update rollout

- The installing worker must validate the root app document and `search.html`, discover same-origin script/stylesheet URLs, and include all dynamic scripts loaded by `qs-init.js`.
- Every required same-origin document and asset must fetch successfully with revalidation before the worker writes to the existing app-shell cache or calls `skipWaiting()`.
- If any required fetch fails (including offline installation), the existing app-shell cache must remain untouched and the old worker must remain active. Image and marketplace caches remain intact.
- The first update must work when the currently open page is running the old production `qs-init.js`, which has no new update-message listener. The new worker cannot depend on that page sending a message.
- A worker takeover must never force-reload a page. Existing first-rollout pages may not display an Update banner; they use the refreshed shell on their next normal navigation/reload. Subsequent updates may show Update/Later from the new bootstrap.
- Automated regression coverage must simulate both complete install preflight and an asset failure, proving no cache writes and no activation on failure.
- Android preview QA remains mandatory: update an already-installed PWA from the previous worker; test first install; simulate offline/failed asset refresh; confirm old cache and offline images/marketplace remain available; verify no forced reload while Add Product/product edit/modal/focused form is active; confirm subsequent update banner and user-controlled reload; verify online/offline sync and vendor A/B isolation.
- Cache writes are delayed until all network requests succeed, but Cache API writes are not a transactional multi-entry commit. Browser quota/write-failure behaviour remains a residual risk to test.
- No production release until exact-head CI, preview deployment, and Android lifecycle QA pass.

