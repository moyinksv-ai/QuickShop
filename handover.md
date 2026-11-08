# QuickShop Engineering Handover
**Updated:** 2026-11-08  
**Repository:** `moyinksv-ai/QuickShop`  
**Active working branch:** `investigate/supabase-egress-catalogue-2026-11-07` (read-only Supabase egress/catalogue investigation)  
**Production baseline:** `main`  
**Release rule:** No merge to `main`, production deployment, schema change, or destructive data operation without explicit user approval.

> This file is the first document a new engineering session must read. It supersedes conversational assumptions, not the detailed history in `document.md` and `regression.md`. Re-fetch branch heads, files, preview deployment and tests before acting; never assume a remembered SHA or preview is still current.

---

## Add Product draft lifecycle hotfix — 2026-11-07

- Branch: `hotfix/add-product-draft-lifecycle`; PR #8 merged into `main` on 2026-11-07. Merge commit: `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`.
- Confirmed causes: shared panel cleanup called `hideAddForm()` while the workspace was already closed; that function saved default cost/quantity values before checking visibility. The draft-content predicate counted those remembered defaults as real content. Pending autosave timers were not cancelled by discard/removal, allowing a removed draft to be written back.
- Hotfix changes: make closed-workspace cleanup a no-op; only persist drafts containing meaningful product information (name, barcode, price, description, or image); centralize autosave cancellation and invoke it during clear/discard/remove/restore; guard scheduled saves to the open add workspace; restore saved field values without scheduling an unnecessary immediate rewrite.
- Scope: `inventory.js`, regression guard tests, and this handover note only. No schema, Supabase, product, stock, sales, auth, referral, or vendor-account mutations.
- Additional confirmed regression during preview: the first hotfix edit left orphaned lines/braces in `hideAddForm()`; `inventory.js` therefore failed to parse and the entire inventory IIFE did not execute, leaving the inventory view blank and controls inert. Corrected surgically in commit `a668ad2b605e39eafbebac308f6fddf762fd8277`; no draft-lifecycle logic was otherwise changed by that correction.
- A syntax regression guard was added in commit `bb1136c2867f7a9c5dfc97979ccacbc50ff48d27`, using `vm.Script` to parse `inventory.js` as part of the test suite.
- Latest PR-head verification: GitHub Actions run `42361862489` (run #300) completed successfully; the regression suite passed. The latest PR preview deployment `dpl_FrVQsfh5dDSBTtdZf7DdWtgB9g29` reached `READY` for source commit `47b1e7f9841783ab6689e5d7c107a281f6c9f9d5`. The user confirmed all preview tests passed.
- PR #8 merged successfully. Production deployment `dpl_E3Q1dbczVXkQ9eWic7oonKPXoGas` is `READY` for exact `main` merge commit `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`, with production aliases including `quickshopper.vercel.app`.
- A rollback branch `backup/main-before-pr8-2026-11-07` preserves the exact pre-PR8 main SHA `3d68545d507da9b8d1466edda9d8b8d5a565daaa`. Previous production deployment `dpl_6WmW9mzGsyJcYgMLFGH49nayG87q` is `READY` for that same SHA. For fast recovery, roll back Vercel to that deployment; source-control recovery is to revert merge commit `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`.
- PR #8 changed only `inventory.js`, regression tests, `handover.md`, and `regression.md`; no schema/Supabase/product/stock/sales/auth/referral/vendor-account data mutations. No database rollback is required.
- The user confirmed all preview checks passed **and subsequently confirmed the post-merge production smoke test passed**. Do not treat production smoke as outstanding unless a new regression is reported.
- Device-local recovery note: already-created phantom drafts may remain in a vendor's localStorage. The new meaningful-content validation prevents cost/quantity-only records from prompting; do not bulk-delete vendor storage or touch server data.
- Rollback: revert the hotfix commit; no database rollback required.

## 0. Immediate priorities (in order)

1. **Post-merge production smoke check:** PR #8 is merged and Vercel production deployment `dpl_E3Q1dbczVXkQ9eWic7oonKPXoGas` is READY for merge SHA `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`. Perform a safe production smoke check using read-only paths or an authorized test vendor/account: sign-in/session restoration, Inventory list, Add Product open/close/draft resume/discard, existing product edit, sell/restock, and public storefront/catalogue visibility. Never create or mutate sample records on a paying vendor's account.
2. **Current engineering workstream: Supabase egress, marketplace and catalogue caching (§3).** Continue the already-created dedicated investigation branch with read-only measurement and root-cause tracing. The Supabase Usage screenshot supplied on 2026-11-08 shows `Cached Egress 6.803 / 5 GB (136%)`, `Egress 0.356 / 5 GB (7%)`, and a ~2.984 GB cached-egress spike on **Nov 1**. The exact per-service breakdown for that spike is not available from the UI shown. Do not claim the marketplace is proven as the sole cause yet. Trace marketplace/catalogue/image request paths and measure them. No cache/schema/Supabase production change is authorized until the cause and safe fix are verified.
3. Re-fetch current main and relevant source before starting; create one dedicated branch for this egress/caching workstream. Keep it separate from the completed Add Product hotfix.
4. Preserve rollback: backup branch `backup/main-before-pr8-2026-11-07` points to pre-PR8 SHA `3d68545d507da9b8d1466edda9d8b8d5a565daaa`; Vercel rollback deployment is `dpl_6WmW9mzGsyJcYgMLFGH49nayG87q`. No database rollback is required for PR #8.
5. Keep the public engineering evidence log updated with verified outcomes only.

The user has paying vendors. Protect existing vendor data and operational workflows above shipping speed. The user has already manually tested the semantic colour scheme and earlier preview changes, and most recently confirmed the three Add Product feedback checks. Do not ask them to repeat those tests without a specific reason.

### Current release audit — 2026-11-07 (supersedes stale historical WP10 status entries below)

- Repository: `moyinksv-ai/QuickShop`; PR #7: https://github.com/moyinksv-ai/QuickShop/pull/7
- Production baseline before release: `main` at `5267e1096c8868b4b11584c9d585915f2586b65a`; verified current production Vercel deployment: `dpl_5yaBANt9VTARFQL3vSXe39b2E3Je` (`READY`).
- Feature branch before this handover update: `design/quickshop-ui-refinement` at `0778641e1fbdd89e5ff64c58b589cac0ee95c653`, 39 commits ahead / 0 behind main. Eight files changed: `appss.js`, `document.md`, `handover.md`, `index.html`, `inventory.js`, `regression.md`, `styless.css`, `tests/regression-guards.test.js`.
- Exact-HEAD automated checks: GitHub Actions Regression guards succeeded; 38 tests passed, 0 failed. Vercel preview for that SHA was READY: https://quickshopper-9wj5eoao6-moyinks-projects-5a3815db.vercel.app
- User-confirmed preview acceptance: semantic colour scheme and earlier changes tested; latest Add Product checks passed for create-success feedback, edit-success feedback, and validation feedback. Earlier draft recovery and Back-save confirmation were also reported working.
- Source/diff audit: no SQL migrations, schema edits, RLS/policy changes, Supabase function changes, product/sales data contract changes, or changes to the marketplace/catalogue query files. Existing product create/edit business logic and inventory stock mutation handlers are retained. Drafts are device-local in localStorage, keyed by authenticated user ID, and are not inserted into the product sync queue until the vendor explicitly saves a product.
- Inventory modal changes are presentation-state only: mode-specific title/button text, hide the sale total for restock, clear stale modal error. The sell payment-selection disabled state and sell/restock mutation handlers remain unchanged.
- Add Product changes move the existing shared form into a dedicated full-screen workspace, persist new-product draft fields locally, and show success/validation feedback. The logout ordering now calls `hideAddForm()` before clearing `editingProductId`, preventing an edit form from being treated as a new-product draft.
- Barcode-result visibility was specifically rechecked: although its inline `display:none` was removed from markup, the existing `#barcodeResult { display:none; }` CSS rule remains, and scanner start/stop handlers explicitly hide/show it. This is not a confirmed regression.
- No claim is made that every device/browser edge case has been physically exercised. Automated checks and the user's preview checks passed; production smoke checks remain required after deployment.
- Rollback point: restore production traffic to Vercel deployment `dpl_5yaBANt9VTARFQL3vSXe39b2E3Je`, which serves the exact pre-release `main` SHA above. A Git revert of the eventual merge commit is the source-control recovery path. No database rollback is required for this release.
- The earlier WP10 status table and older “unresolved” statements later in this handover are historical snapshots and are superseded by this current release audit and the dated verification entries in `regression.md`. Re-check current source and the post-merge deployment before claiming production verification.


### Post-merge production release — 2026-11-07

- PR #7 merged successfully: https://github.com/moyinksv-ai/QuickShop/pull/7
- Merge commit and current `main` SHA at release: `e99d30e5216b3abeeefe8254f1af78d3a83e44e3`.
- Vercel production deployment for that exact SHA: `dpl_AiyfZjGMGvbKNNFpdWDBuWPPt3tx`; state `READY`; aliases include `quickshopper.vercel.app`.
- Pre-release rollback deployment remains `dpl_5yaBANt9VTARFQL3vSXe39b2E3Je` (READY, original `main` SHA `5267e1096c8868b4b11584c9d585915f2586b65a`). To restore service quickly, use Vercel production rollback to this deployment. Then separately revert the merge commit in Git if the code is to be removed from `main`.
- The PR-head regression run #281 completed successfully: 38 tests passed, 0 failed. The handover-only update was separately built as a READY preview before merge.
- Vercel confirms the production deployment is READY and the production aliases are assigned. A successful deployment is not a substitute for a real authenticated vendor smoke test; post-release device/browser checks should still cover sign-in, inventory list, add/edit product, sell/restock, and storefront/catalogue visibility. Do not make sample changes to paying vendors' real inventory merely to test production; use an authorized test vendor/account or read-only checks.
- No Supabase migration or data transformation was deployed. Existing vendor records and inventory were not intentionally modified by this release.

---

## 1. Product, workflow and non-negotiable engineering rules

QuickShop is an active vendor/buyer marketplace PWA built with GitHub, Vercel previews and Supabase. The user is building it as a serious income-generating product. They prefer a professional, modern, restrained product experience—not a wholesale redesign when asking for operational improvements.

### Working discipline
- Read current source, history, live schema/config where relevant, and tests before writing.
- Establish exact branch HEAD and compare it with `main`; never infer state from old conversation summaries.
- Use a dedicated feature branch for each coherent workstream. Do not create multiple competing branches for one incremental fix.
- Preserve working behaviour. Make the smallest change that fixes the proven root cause.
- Trace async JavaScript and event lifecycles atomically: entry point → state → effect/listener → network request → response → render/cache.
- Identify affected surfaces and edge cases before implementation; explicitly inspect logged-out and logged-in vendor flows.
- Add/update automated regression guards and manual QA instructions before considering a fix complete.
- Run relevant tests, syntax checks, `git diff --check`, and inspect the complete diff. Test the Vercel preview on mobile, especially Android browser navigation.
- A passing source-pattern test or Vercel READY status is not sufficient evidence of correctness.
- Preserve rollback safety. Record exact commits, branch, preview, checks and known limitations.
- Never merge or deploy production without the user's explicit approval.
- Do not ask the user to repeat context already in this handover. The user is on ChatGPT Free and often uses a small Android phone; batch independent read-only work efficiently, but do not batch risky edits or omit verification.
- Keep communication clear: state what is proven, what is only a hypothesis, what was changed, what remains, and whether user action is required. Do not leave the user stranded after tool limitations/timeouts.

### Product/business facts
- The first-10-vendors free-for-life offer is finished.
- The remaining two founder-tier vendors are still eligible for ₦1,500 once-for-life. Do not advertise this scarcity offer on the landing page.
- Next standard price selected by the user: ₦3,000 quarterly.
- No double activation fee. Do not re-open pricing unless asked.
- User wants public posts about genuine engineering improvements; do not exaggerate results or claim measured savings without measurements.

## 2. WP10 — Add Product workspace and form

### Last known implementation state (must re-verify)
- Branch: `design/quickshop-ui-refinement`
- Last previously reported commit: `e616e21b2f55377f6c57cf1658051b2a8db3d52b` (re-fetch current branch HEAD; do not assume this is still HEAD).
- Previously reported Vercel preview: https://quickshopper-bst883j2s-moyinks-projects-5a3815db.vercel.app (verify it still corresponds to the current branch commit).
- Previous report: Vercel READY; 34/34 regression tests passed; real mobile/browser QA still pending.
- The latest repository comparison observed during this handover: branch is 9 commits ahead of `main`, 0 behind. Changed files included `appss.js`, `document.md`, `index.html`, `inventory.js`, `styless.css`, and `tests/regression-guards.test.js`. Re-run comparison before any write.

### User's new direct preview observations (treat as acceptance criteria)
The user manually opened the WP10 preview and confirmed:
1. Add Product screen is now full-screen. **This is good and should be preserved.**
2. Entered values do not appear after a page refresh. The user expects draft progress to be saved/resumable, so determine whether this is a real persistence defect or a draft not being restored/rendered.
3. The page's own Back button does not work.
4. Refreshing the Add Product page navigates back to Home.
5. Navigating back to Inventory and tapping Add Product does not open a fresh/resumable Add Product screen with the expected draft prompt.
6. Expected behaviour: leaving the Add Product page via its Back control should tell the vendor their progress has been saved (non-disruptive confirmation). When they tap Add Product again, they should be offered **Continue draft** or **Clear draft**. Clearing must require an intentional action/confirmation and must not silently discard work.
7. Browser/device Back must not be used to control form-field progression. The earlier agreed direction was explicit in-form navigation (e.g. arrows/next controls) for field progression; page navigation/back is separate.
8. User asks whether progress can be saved and resumed; this is approved in principle, but implementation must be robust and maintainable. Avoid complex persistence unless its lifecycle and isolation are proven.

### Required investigation before any WP10 fix
- Trace Add Product route entry, refresh/deep-link handling, history state, app shell routing and Back button handler.
- Trace draft creation, debounce/autosave, storage key, user/vendor scoping, hydration order, validation, image/file handling, successful save cleanup and explicit discard.
- Determine why refresh falls back to Home and why the Back control is inert. Do not paper over by adding another navigation handler without identifying competing handlers.
- Check new and existing vendors; logged-in vendor identity changes; logout/login as another account; multiple tabs; browser refresh; browser Back/Forward; PWA standalone; offline/online; interrupted upload; image picker/app switching; failed validation; save failure; successful product creation; duplicate submission.
- Drafts must never leak across vendors/accounts. Do not store sensitive credentials. Decide whether image blobs can safely persist in the chosen storage; if not, clearly preserve text/metadata and explain image re-selection without losing other fields.
- Avoid a draft being deleted on refresh, route change, failed upload, or auth restoration. Clear only after confirmed successful product creation or explicit user discard.
- Keep existing add/edit product logic, scanner, validation, image fields, offline sync queue and inventory semantics intact unless the exact change requires a reviewed adjustment.

### Image-first product creation idea (product exploration, not yet approved implementation)
The user is exploring a simpler bulk-friendly flow:
- Let vendors choose a creation method based on whether they already have product pictures.
- A picture-first path could resemble WhatsApp: select/take a photo first, then type a caption/description; the caption becomes the product details/description shown under the product.
- Retain the existing details-first path for vendors who prefer entering the name/details before selecting pictures.
- The goal is less friction, easier onboarding and adding many products, not a generic redesign.
- This is a product proposal only. Do not implement until the existing Add Product flow and draft persistence are understood, and UX/data mapping, image handling, multiple-photo behaviour, product name/description/price/quantity requirements, validation, upload failure/retry, and bulk creation implications have been assessed.
- Do not assume WhatsApp-style caption should replace the product name. Determine the cleanest mapping and ask the user if a product decision materially affects data or UX.
- Any new path must feed the existing canonical product creation/save pipeline, not fork business logic.

### Previously reported WP10 work
- WP10-B: Add Product workspace and add-only autosave; shared product form moved into workspace while preserving existing save logic.
- Existing scanner, validation, image fields and offline sync queue reportedly preserved.
- Drafts reportedly isolated by user, resumable/discardable and cleared after successful creation. The user's latest test indicates this behaviour is not working end-to-end; verify source and actual preview rather than trusting prior claims.
- Remaining WP10-C: browser/device Back and history navigation root-cause investigation.
- WP10-D: form redesign.
- WP10-E: inventory header hierarchy.
- R5: save path reportedly contains an awaited pending-change operation without an outer catch. Re-inspect current code and decide whether this is still present and how to handle safely.

## 3A. Egress investigation status — 2026-11-08

### Supabase Usage evidence supplied by the user
- Current billing cycle shown: **22 Oct 2026 → 22 Nov 2026** on the Free Plan.
- Supabase Usage Summary shows **Cached Egress: 6.803 / 5 GB (136%)**, with **1.80 GB overage**.
- Normal **Egress: 0.356 / 5 GB (7%)**.
- The Egress daily chart shows a large **29 Oct** total-traffic spike and a particularly large **1 Nov** cached-egress spike.
- Cached Egress daily tooltip showed **2.984 GB on 1 Nov 2026**.
- The visible Egress chart tooltip on 29 Oct showed Storage Egress 40.077 MB (61.6%), PostgREST Egress 22.476 MB (34.5%), Auth 168.787 KB (0.3%), and Realtime 2.359 MB (3.6%). This tooltip is for total egress on 29 Oct, not the 1 Nov cached-egress spike.
- The user reports that the Usage UI does not expose a further per-service breakdown for the 1 Nov cached-egress spike from the available chart.
- This proves the organization has exceeded the Free Plan cached-egress allowance and that cached egress is the dominant usage category in the current billing cycle. It does **not** by itself prove which QuickShop route/resource caused the spike.

### Operational interpretation
- The immediate objective is to reduce **future** egress before the Supabase restriction warning date of **14 Nov 2026**, not to recover already-consumed bandwidth.
- Do not delete vendor/product data, images, or database records merely to reduce egress.
- Treat preview traffic as real Supabase traffic when previews point at the production Supabase project. A new Vercel preview deployment itself is not inherently the problem; the requests made by that preview are what matter.
- Marketplace remains a high-priority hypothesis because it repeatedly fetches public catalogue data/images and has previously observed reload/invalidation behaviour. It is not yet a proven root cause.
- The Free Plan warning does not mean QuickShop is permanently ended on 14 Nov. If usage is corrected, the restriction risk can be reassessed; if a restriction is applied, upgrading or waiting for the next billing reset are separate recovery paths. Do not promise uninterrupted service without checking the current Supabase account status.

### Investigation branch / safety
- Branch: `investigate/supabase-egress-catalogue-2026-11-07`
- Branch base: `cebdac1976ce2423b386d48cd8bd2969ba01aa06`
- This workstream has remained **read-only** so far: no source, schema, database, storage, Supabase configuration, or vendor data has been changed.
- Next evidence target: quantify marketplace/catalogue request counts and response bytes by journey; inspect Storage image requests and image dimensions; trace duplicate catalogue fetches, realtime-triggered reloads, pageshow/visibility refreshes, service-worker behavior, and preview traffic.
- Only after the request/byte source is established should a surgical optimization be implemented.

## 3. Urgent workstream — Supabase egress, marketplace and catalogue caching

### User's goal
Optimize QuickShop's operating cost to the barest practical level while retaining the aura and reliability of a high-quality marketplace. Do not change layouts or visual identity merely to optimize. Make unnecessary work difficult to trigger and correctness easy to verify.

The marketplace should not fetch the same unchanged catalogue/images on every refresh. Existing **Load More** remains the explicit mechanism for requesting more products. Product order must be stable. Vendor changes should be detected cheaply and only necessary data refreshed.

### Evidence already collected (not final diagnosis)
Supabase project ref: `wicpvvypqpaljuexmczi` (QuickShop).
- Available sampled edge logs: approximately 3,616 Storage image GETs and ~623.61 MiB estimated response content.
- Most sampled image requests were under `/storage/v1/object/public/user_images/...`.
- About 98.5% of sampled requests were marked CDN cache HIT.
- Sampled database REST response bytes were almost zero.
- This is log-window content-length estimation, **not** the authoritative billed egress total.
- User saw a day above 2 GB approximately 2–3 days before the initial Nov 6 investigation (likely around Nov 3–4, but verify exact date and timezone). The sampled 24-hour logs did not cover that historical day. Retrieve official Supabase Usage daily breakdown and distinguish cached vs uncached egress/services before attributing the incident.
- Do not state that cached responses are free. Confirm current billing definitions/plan and usage for this project.

### Source-level findings already observed on `design/quickshop-ui-refinement` (re-fetch and verify exact current code)
1. `search.html` marketplace feed uses a `weightedShuffle()`/quality-bucket mechanism with `Math.random()`. Its first-page memo is in-memory only; a fresh page load loses it. This explains random product rearrangement across refreshes. It does not by itself prove the egress spike.
2. `sw.js` marketplace-table handling was observed as network-first: cached successful responses are stored, but online refresh still requests Supabase. Existing cache does not currently guarantee an offline/cache-first hit on normal reload.
3. `search.html` has `pageshow` and `visibilitychange` freshness handling. On qualifying returns it clears in-session product memo/prefetch state, marks stores unloaded, then schedules route reload after ~220ms.
4. A PostgreSQL changes subscription on the whole `products` table can trigger the same broad cache invalidation/route reload. Determine subscription filter, event volume and intended behaviour; do not remove realtime blindly.
5. Marketplace surfaces include home feed, categories, store listings, search results and product detail. Audit each separately.
6. `qs_active_stores_v2.last_product_update` was observed as NULL in its definition/result, so it cannot currently be assumed to be a reliable freshness cursor.
7. `qs_get_store` is an existing public storefront fast path returning store profile and available products together; fallback fetches profile and products separately. Preserve access rules and response contract.
8. Public catalogue views and `qs_get_store` were observed to exclude `qty <= 0`; marketplace offers view also filters unavailable stock. These are existing business rules.
9. Storefront `catalog.js` has its own product loading and realtime behaviour, including a vendor-filtered subscription; it must be audited separately.
10. Authenticated vendor app has its own cloud sync. A visibility return after its five-minute throttle may sync products, sales, notes, categories and audit logs. Preserve this system and test logged-in vendors browsing their own catalogue/marketplace.
11. Marketplace product cards did not visibly set explicit lazy image loading in the inspected sections; verify exact current rendering and network behaviour before changing.
12. Public vendor storefront may load all available products rather than page them; measure real payloads and assess backwards-compatible pagination. Do not change without understanding shared links/cart behaviour.

### Required scope and edge cases — inspect BEFORE any fix
- Logged-out marketplace visitor, logged-in buyer/vendor, vendor viewing their own public catalogue, vendor viewing another vendor's catalogue, and account switching.
- Cold return (new browser/session), hot return (same tab/app after backgrounding), refresh, Back/Forward, PWA standalone, multiple tabs, offline/online restoration, slow/failed network.
- Home feed, category feed, search, store list, product detail, public vendor storefront, authenticated vendor inventory/catalogue, cart and checkout.
- New canonical product vs new vendor offer on an existing canonical product. A new offer may not create a new canonical product; notification logic must not miss it.
- Edited name/details/price/images, quantity/stock change, sold out, deleted, vendor inactive/suspended/entitlement change, offer added/removed, vendor ownership/visibility changes.
- Pagination under concurrent inserts/deletes/edits; stable order with unique tie-breaker; no duplicates/skips; Load More fetches only next page.
- Cart correctness: updated price/stock, quantity caps, removed/deleted/sold-out item behaviour and existing vendor/source context.
- Image cache key/versioning, public URL stability, compression/resizing, lazy loading, browser cache headers, CDN cache hit/miss and origin/billed egress. Don't mutate image URLs without reviewing old cached URLs and upload pipeline.
- Realtime subscriptions: scope/filter, duplicate subscriptions, event bursts, debounce/coalescing, cleanup on navigation, cross-vendor blast radius. Realtime should ideally signal that a freshness check is needed, not force every client to refetch the whole catalogue.
- Service-worker cache strategy, cache versioning, stale-while-revalidate vs network-first vs cache-first, invalidation and logout/account separation. Never serve private vendor data from shared public cache.
- Supabase RLS, view/function grants, public RPC response shape, pagination and indexes. Any schema migration requires separate review and explicit approval where risk warrants it.
- Browser storage limits/eviction, stale cache fallback, clock skew and first-visit baseline. A lightweight freshness signal must be authoritative and inexpensive.

### Desired user experience
- On return to marketplace, show valid cached catalogue immediately, preserving the customer's place/order where appropriate.
- Run a lightweight, cheap change check rather than re-downloading all product rows/images.
- If relevant new products/offers have been added, show a subtle, non-intrusive, dismissible prompt/dropdown such as “Some vendors added new products” with an explicit “View new arrivals” action. Do not interrupt browsing or force an update.
- Existing catalogue remains usable when prompt is dismissed. Do not repeat the same prompt on every render; persist an appropriate seen/dismissed watermark per user/session/device without leaking accounts.
- “View new arrivals” fetches only relevant new items and integrates them without silently reshuffling the existing catalogue.
- Existing Load More remains deliberate and fetches only the next page.
- Edits, stock changes, sold-out items, deletions and vendor eligibility changes must remain correct and visible according to existing business rules; do not treat them as “new arrivals.”
- The same correctness must apply when a logged-in vendor browses marketplace and their own/another public catalogue. Authenticated app sync remains separate and must not be broken.

### Architecture direction (hypothesis, not permission to implement blindly)
- First establish measured baseline request counts/bytes for each user journey.
- Fix deterministic ordering and pagination first where it affects cache correctness.
- Evaluate persistent browser/service-worker cache for public catalogue responses, including safe freshness validation.
- Use cheap authoritative catalogue revision/change feed or timestamps only after confirming reliable data model. Current `last_product_update` field was observed NULL and is not sufficient.
- Consider targeted invalidation and coalesced realtime signals, not whole-feed reloads on every product event.
- Apply image lazy loading, appropriately sized derivatives and stable versioned URLs only after tracing image upload and display pipeline.
- Redis is **not** the first step. Browser/CDN caching and query/request reduction are separate. Add Redis only if measured repeated shared server-side queries justify the extra service, cost, invalidation complexity and operational burden.

## 4. Regression guardrails required

Add tests for actual invariants, not brittle source-string presence alone:
- deterministic ordering for identical dataset; unique tie-breaker;
- pagination cursor/order has no duplicates/skips under defined concurrent-change semantics;
- first visit fetches intended first page once;
- hot/cold return does not trigger duplicate full catalogue loads;
- refresh reuses valid cache and performs only the agreed lightweight freshness check;
- Load More fetches only the next page;
- new canonical product and new offer on existing canonical product are detected correctly;
- edits update fields; stock change caps cart; sold-out/deleted products disappear; vendor eligibility remains enforced;
- one vendor event cannot cause unnecessary broad refetches for unrelated vendors;
- subscriptions are deduplicated and cleaned up;
- public cache cannot leak authenticated/private data across users or accounts;
- logged-in vendor marketplace and own/other storefront paths work;
- images lazy-load and use appropriate stable cache keys without stale-image bugs;
- offline fallback and online recovery work;
- service-worker cache version changes and invalidation work;
- Add Product draft is isolated by account, survives refresh/navigation as designed, restores predictably, and clears only after success/explicit discard;
- Back button and browser/device Back are distinct and both behave correctly;
- no regression to scanner, validation, image uploads, offline sync, stock, cart, checkout, referrals or auth.
Keep deterministic automated tests plus a written manual Android/mobile preview checklist. Record actual request counts and response sizes before/after; don't claim savings without measurements.

## 5. Documentation and public engineering log

- `handover.md` (this file): first-read operational context, current state, priorities, exact stopping point, acceptance criteria, unresolved questions and next actions.
- `document.md`: product behaviour/architecture decisions and durable design principles. Inspect its current actual content before assuming it is a product spec; it was previously titled “QuickShop Regression Guardrails,” so consider correcting its role/name only after review.
- `regression.md`: regression history, release gates and manual/automated test results.
- Maintain a dated engineering work log (create only after checking whether one already exists) with evidence, hypothesis vs confirmed root cause, changes, commits, preview, tests, metrics and rollback notes.
- Maintain a public-story/evidence section: problem, user/business impact, investigation, tradeoffs, verified implementation, measured result and safeguards. This feeds future X/LinkedIn posts and portfolio case study. Never publish secrets, user data, internal credentials, or unverified claims.

Portfolio supplied by user: https://moyinks.vercel.app. A previous attempt to retrieve it failed; retry later, do not claim it has been reviewed until successfully inspected.

## 6. Exact next actions for the next engineer/session

1. Read this file, then `document.md`, `regression.md`, and relevant tests.
2. Confirm the post-PR #8 production deployment `dpl_E3Q1dbczVXkQ9eWic7oonKPXoGas` still serves merge SHA `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`; production aliases include `quickshopper.vercel.app`.
3. Complete safe production smoke checks with read-only or authorized test-vendor access. Do not create/edit/sell/restock against a paying vendor's real records.
4. Start the next isolated workstream: Supabase egress, marketplace and catalogue caching (§3). Read `document.md`, `regression.md`, and relevant tests; inspect the current source on main, then create a dedicated branch.
5. First obtain official Supabase Usage daily breakdown for the historical >2 GB day (verify exact date/timezone and service/category), then measure request counts/response sizes for cold/hot marketplace, category/search, product detail, public storefront and logged-in vendor journeys.
6. Trace current service-worker caching, pageshow/visibility refresh, realtime subscriptions, pagination/order, image request/cache headers, public RPC/view payloads and authenticated sync. Keep this read-only until the measured root cause and blast radius are documented.
7. Produce an evidence-backed baseline, edge-case matrix, proposed smallest safe change, rollback plan and test plan before implementation. Ask the user only for product decisions or risky actions that cannot be safely inferred.
8. Implement in small isolated commits, add deterministic regression tests, inspect full diff, deploy preview, test on mobile, report verified outcomes and measured before/after metrics.
9. No further production merge/deploy without explicit approval.

## 7. Status truth table at handover

| Item | Status |
|---|---|
| WP10 full-screen Add Product workspace | User confirmed visually good |
| WP10 draft persistence/resume | Hotfix merged in PR #8; user confirmed preview QA passes; production deployment READY; authenticated production smoke check pending |
| WP10 page Back control | User confirmed latest preview checks pass; production smoke check pending |
| WP10 refresh/deep-link route persistence | User reports refresh returns to Home |
| WP10 return to Inventory then Add Product | User reports it does not open expected draft/resume/clear choice |
| WP10 mobile/browser QA | User confirmed latest preview tests pass; production smoke check pending |
| WP10-C/D/E | Not complete / re-verify |
| Marketplace randomized ordering | Previously found in source; re-verify current branch |
| Service worker network-first marketplace table strategy | Previously found; re-verify current branch |
| Marketplace pageshow/visibility refresh invalidation | Previously found; re-verify current branch |
| Whole-products realtime invalidation | Previously found; re-verify scope and effects |
| `qs_active_stores_v2.last_product_update` | Previously observed NULL; re-check live schema |
| Official 2+ GB historical egress root cause | Unknown; historical Usage breakdown required |
| Redis need | Not established; do not add yet |
| Portfolio review | Not completed; prior retrieval failed |
| PR #8 production release | Merged as `e1b25695af50c6ee390eb15f9c4a0a9a1f45f6a9`; Vercel READY; rollback branch/deployment preserved |

**Do not treat any item marked “previously found” as verified in the current checkout until re-fetched.**


## Latest WP10 follow-up — product-save feedback (2026-11-07)

- Current reviewed baseline before this follow-up: `design/quickshop-ui-refinement` at `c4076129ec8e0b5d82cf2aa77c267bd777e0d852`; preview deployment was READY at `https://quickshopper-12bbuz14f-moyinks-projects-5a3815db.vercel.app`.
- User confirmed the Add Product draft save/resume flow and its Back confirmation were fixed, then reported a separate regression: pressing Save clears the form fields without visible confirmation.
- Confirmed cause: global `appToast` used z-index `99999`, while Add Product workspace uses `1000000` and the highest CSS overlay found is `1000001`. Toasts were being generated beneath the workspace. This affected creation success, edit success, validation, and upload feedback.
- The product creation flow mutates app state, calls `addActivityLog()` (which synchronously flushes local state through `saveState()`), then awaits IndexedDB queue insertion. Queue sync to Supabase runs asynchronously. Do not label the toast as proof of completed remote sync.
- The follow-up raises the global toast above all CSS overlays, clarifies create/edit success copy, and adds regression guards. See the 2026-11-07 entry in `regression.md`.
- Required preview QA: add a valid product and confirm a visible success toast; edit a product and confirm visible update feedback; submit invalid values and confirm validation feedback; trigger an image upload failure safely and confirm the error remains visible. Also recheck draft resume/Back confirmation so the shared toast layer does not obscure other workspace behaviour.
- Automated tests and Vercel deployment status must be checked for the exact new commit. The user must confirm the preview. Main and production remain untouched.


### Latest verification note — 2026-11-07

- Toast-layering fix commit: `f73fb0a234c94c8f9ecdf9c8a4f5de7760d71dea`; test-pattern correction commit: `a78fab9ad46a6ae8c0cb66c01c0962988aed96d8`.
- Preview for `a78fab9` reached Vercel READY: `https://quickshopper-hweok8clw-moyinks-projects-5a3815db.vercel.app`.
- CI run #277 exposed one stale pre-existing draft test assertion (it expected an old inline save call); 37/38 tests passed, with the only failure at the outdated assertion. The current source saves via `hideAddForm()` before clearing; update the assertion to this actual contract and verify a new CI run.
- No physical-device or authenticated runtime QA has yet been performed for the toast fix. User confirmation is still required. Main and production remain untouched.


## 2026-11-08 — Read-only egress tracing checkpoint

### Repository state verified
- Current investigation branch HEAD at the start of this checkpoint: `7ce9fd91d53114951a94a4e4c4a4a443f29129bd`.
- Current `main` HEAD: `4e1026766a84553b454bc6e9ca3353d2b966656d`.
- Immediately before this documentation update, GitHub comparison showed 5 commits ahead / 0 behind `main`; only `handover.md` and `regression.md` differed. The current comparison must be re-fetched after this update. Merge base remains `cebdac1976ce2423b386d48cd8bd2969ba01aa06`.
- No application code, SQL, schema, storage object, Supabase configuration, or vendor-data changes were made in this tracing pass.

### Static request-lifecycle findings — proven from current source
- **Marketplace initial product load:** `search.html` calls `qs_market_products_v2` once for the first page (`range(0, ...)`) and renders the returned product images. Product-card images do **not** set a native `loading="lazy"` attribute, so the current source does not intentionally defer those image requests.
- **Marketplace detail prefetch:** `renderProductCard()` starts `_prefetchProduct(item)` on `touchstart`, which queries all matching `qs_market_offers_v2` rows for that canonical product and caches the promise in `_prefetchCache` (bounded to 60 entries). Opening the detail view reuses that promise in-session; `invalidateMarketCaches()` clears it, so a qualifying freshness/lifecycle refresh can make a later tap fetch offers again. A direct `?product=<slug>` route separately looks up the product row from `qs_market_products_v2` before opening detail. These are source-confirmed request paths; their response sizes and actual user frequency remain unmeasured.
- **Marketplace image loading:** product-card images are assigned `src` immediately and do not set native lazy loading. This differs from the public storefront product cards, which set the first image eager and subsequent images lazy (or lazy for a single image). Do not infer image bytes from card count; actual browser transfer and cache behavior still need measurement.
- **Request attribution limitation:** the 2026-11-07 Supabase log sample contained 233 PostgREST log rows, but the available PostgREST attributes only exposed `path=/` rather than the individual REST/RPC path or response bytes. Realtime logs likewise exposed service-internal connection/replication events, not a reliable count of application `products` change events. Those logs cannot identify which QuickShop client journey issued a request or quantify per-RPC payload bytes.
- **Marketplace category:** `qs_market_products_by_category_v2` is paginated with `range`; Load More is the explicit append path. The first category page is memoized only in memory and is lost on refresh.
- **Marketplace product detail:** a card touch can prefetch `qs_market_offers_v2`; opening detail reuses that promise. The detail path therefore adds an offers request when it was not already prefetched, in addition to the listing-page request that supplied the card.
- **Marketplace freshness:** the page subscribes to every `public.products` INSERT/UPDATE/DELETE through `qs-market-products-live-v2`. Any event invalidates both in-memory product/offer caches and schedules `routeFromURL()` after 220 ms. `pageshow`, `visibilitychange` and `online` can also schedule the same refresh (with a 5-second lifecycle throttle). This is a confirmed full catalogue re-fetch mechanism, not yet a measured egress total.
- **Marketplace ordering:** the first-page result is fetched by `created_at` but then shuffled with `Math.random()`. This makes the visual order unstable between independently fetched pages/refreshes and complicates any future cache/pagination design.
- **Public storefront/catalogue:** `catalog.js` uses `qs_get_store` as a fast path and receives the store profile plus an array of products in one RPC response. If that RPC is unavailable it falls back to a full `public_catalog_products` query (or the `products` table) ordered by name. The storefront therefore has a single full-product-list download on normal initialization rather than explicit product pagination.
- **Storefront realtime:** each public storefront subscribes to `products` filtered by its vendor ID; every product change causes `fetchProducts()` and re-renders the **entire** product list. This is a separate potential amplification path from marketplace freshness.
- **Storefront images:** current storefront product/detail images use the original public Storage URLs. The source does not apply the marketplace `imgTransform()` helper; the marketplace helper is also disabled on the Free plan. The storefront sets `loading="lazy"` for secondary/detail images in several places, but the initial product card/list rendering must still be treated as image-heavy until measured in a real browser.
- **Service worker:** `sw.js` treats Supabase API calls as network-only, except marketplace REST views which are network-first with cached response fallback. Supabase public Storage image GETs use cache-first handling. This means the SW can reduce repeat image transfers on a controlled client after an image is cached, but it does not prevent the initial Storage request and does not cache authoritative catalogue API responses while online.

### Read-only Supabase log evidence — 2026-11-07 00:00Z through 2026-11-08 00:00Z
- Storage logs recorded **525 successful GET requests** with **29,941,524 bytes** of response content length in the sampled 24-hour window. This is a log sample, not the Supabase billed Cached Egress total.
- Of those Storage GETs, **133 requests / 28,309,399 bytes** had referer `https://quickshopper.vercel.app/`. The root URL is also the public storefront route when `?store=...` is present, so this is strong evidence that public storefront/catalogue image delivery is a major current source of Storage traffic. It is not sufficient to attribute every byte under that referer exclusively to product images.
- The same sampled window contained **no Storage GETs with a `search.html` referer**. This does not prove marketplace traffic is absent historically; it only means the marketplace was not represented in this particular 24-hour Storage-log sample.
- The root-referer sample includes repeated successful 200 responses for the same large original images. Several individual files were fetched twice; examples include roughly 390 KB, 328 KB, 317 KB and 300 KB files, each with two logged GETs. The duplicate 200s are evidence of repeated origin/CDN-facing requests in the log stream, but are not by themselves proof of billed egress because the log does not expose Supabase billing/cache-hit attribution.
- Storage responses advertise `cache-control: max-age=3600`, and the sampled GETs were all HTTP 200; the available Storage log fields do not expose a definitive billed-cache-hit flag. Do not equate these log bytes with the 2.984 GB cached-egress billing bar.
- PostgREST logs in the sampled window expose only `path=/` for the observed entries, so the available log stream cannot currently provide reliable per-RPC/REST response-byte attribution for the marketplace/storefront catalogue queries. The source trace therefore remains the reliable evidence for request multiplicity, while browser Network capture is still required for actual response-byte measurements per journey.

### Revised evidence ranking
1. **Confirmed:** Cached Egress is the cost problem (6.803 GB / 5 GB for the current billing cycle; 2.984 GB on Nov 1).
2. **Confirmed:** Public storefront/catalogue Storage traffic is substantial in the sampled 24-hour log window (28.3 MB under the production root referer, within 29.94 MB total logged Storage GET response bytes).
3. **Confirmed:** Storefront realtime can re-download the full vendor catalogue after every matching product mutation.
4. **Confirmed:** Marketplace freshness can invalidate and re-fetch the catalogue on products realtime events, pageshow, visibility changes and online transitions.
5. **Not proven:** The exact cause of the 2.984 GB Nov 1 billing spike, and the exact proportion attributable to marketplace versus public storefront/catalogue versus other Supabase resources.

### Next read-only measurement step
Use a browser Network capture against a protected preview or controlled test session and record per journey: request URL/RPC, initiator, status, transfer/encoded bytes, decoded size when available, and Storage image count/bytes. Specifically compare a cold marketplace load, refresh, Back/Forward return, product detail, cold public storefront, storefront Back/Forward, and a controlled product update that triggers the storefront realtime listener. Do not change caching, schema, Storage URLs, or realtime behavior until those measurements identify the dominant request/byte path.
