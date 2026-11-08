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


### 2026-11-08 — Preview-only lazy-load experiment for storefront swipe cards

- Branch: `experiment/storefront-image-lazyload-2026-11-08`.
- Change is limited to `catalog.js` public storefront `buildCard()`: both images in dual-image swipe cards now use `loading='lazy'` and `decoding='async'`; the detail hero remains eager and single-image cards retain existing behavior.
- Must test on Android: first viewport image appearance; scroll through long catalogue; category/search re-render; dual-image swipe when card is near viewport; lightbox; product detail hero; back/forward navigation; slow network and reload.
- Verify the first image in every visible card is loaded promptly, swipe second image loads when needed, and no blank/broken image placeholders remain.
- Compare equivalent before/after preview journeys using Supabase edge logs: public Storage image GET counts, unique URLs, HIT/MISS and response-content bytes. Treat those as observed gateway metrics, not invoice totals. Avoid testing against production vendor edits.
- Rollback: revert only the `catalog.js` experiment commit. No data/schema/storage mutation was made.
- Not approved for main or production. Require explicit user approval after preview results and regression review.
