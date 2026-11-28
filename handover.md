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


### 2026-11-08 — Cached egress attribution materially improved (read-only)

**Window:** 2026-11-07 07:00:00Z → 2026-11-08 07:00:00Z (24 hours). Project: `wicpvvypqpaljuexmczi`.

Supabase's unified `edge_logs` contain `request.path`, `request.headers.referer`, `response.headers.content_length`, `response.headers.cf_cache_status`, `response.status_code`, and user-agent fields. This is more useful for cached Storage egress than `storage_logs` alone, because CDN cache hits are visible at the gateway while not necessarily reaching the Storage origin log.

- Production referer `https://quickshopper.vercel.app/`: **2,188 public Storage image requests**, **275 distinct image URLs**, **399,071,202 gateway response-content bytes (~380 MiB)** with `cf_cache_status=HIT`.
- Same production referer: **70 image MISS requests**, **15,545,377 response-content bytes (~14.8 MiB)**.
- One anonymized `user_images/<owner-folder>/` group: **68 distinct image URLs**, **1,980 HIT requests**, **351,585,456 bytes (~335 MiB)**. Do not put the owner-folder ID in user-facing summaries or docs.
- Across all observed referers in this window, public Storage image HITs total **2,305 requests / 445,396,711 bytes (~424.8 MiB)**; image MISSes total **81 requests / 16,400,147 bytes (~15.6 MiB)**.
- One preview deployment referer contributed **187 HIT requests / 159 unique image URLs / 38,368,607 bytes (~36.6 MiB)**. Other previews contributed smaller amounts. Preview traffic is real Supabase usage when previews point to production Supabase.
- Production API paths: `POST /rest/v1/rpc/qs_get_store` appeared 46 times (plus 35 OPTIONS preflights); `GET /rest/v1/public_catalog_products` appeared 12 times. `GET /rest/v1/qs_market_products_v2` appeared twice from production referer and five times from one preview referer; `qs_market_offers_v2` appeared twice from that preview. This window therefore points much more strongly to public storefront image delivery than marketplace listing reads, but does not prove marketplace was not responsible for the earlier Nov 1 spike.
- Production cached image requests include Android Chrome and iPhone Safari user agents. This is not only a preview/developer artifact.
- Across the 275 distinct production image URLs, one copy of each response totals **60,399,763 bytes (~57.6 MiB)**; mean file size ~219.6 KB, largest ~455 KB. The 399 MB total is repeated CDN-hit delivery across requests/visits, not 275 unique files alone.

**Billing interpretation:** Supabase's current Egress documentation defines Cached Egress as egress served from its CDN via cache hits and says it typically applies to Storage Smart CDN; the Billing FAQ says cached egress applies only to Storage. This makes the `cf_cache_status=HIT` public Storage image traffic a strong direct explanation for cached-egress consumption. Gateway `content_length` sums are still observational log bytes, not an invoice-meter reconciliation; do not report them as exact billed usage or savings. References: https://supabase.com/docs/guides/platform/manage-your-usage/egress and https://supabase.com/docs/guides/platform/billing-faq.

**Source-level mechanism confirmed in main (`catalog.js`, SHA `a25727ec67ca3de27403716f2c977c4da8f72d6f`):**
- `qs_get_store` is the fast path and returns profile + products in one call; fallback fetches the full `public_catalog_products` list.
- `renderGrid()` builds a card for every filtered product in `allProducts`; the public storefront has no product-page pagination at this render stage.
- In `buildCard()`, single-image cards use `loading='lazy'`; dual-image cards set the first image's `src` immediately and `loading='eager'`, while only the second image is lazy. This means every dual-image product card can eagerly request its first original image when the full grid is rendered, even when far below the initial viewport.
- `sw.js` uses cache-first for public Storage image URLs, which can avoid repeat downloads on the same browser after a successful cache fill. It cannot prevent each new visitor/browser from making its first request for each image.
- The observed 68-image/1,980-hit concentration is consistent with many mobile visits to a large public catalogue. It is not yet proven that all 68 correspond to first images of dual-image cards; avoid stating that as fact until safely mapped.

**Current strongest conclusion:** public storefront catalogue images, particularly the 68-image high-repeat group, are the dominant observed cached-egress path in this 24-hour sample. This is a substantially stronger attribution than the earlier Storage-origin-only sample, which missed most CDN cache-hit traffic. It still does not prove the exact cause of the Nov 1 historical 2.984 GB daily spike.

**Next read-only step:** quantify the distribution of product image sizes at upload/source and verify whether the high-repeat 68-image group maps to first images of dual-image catalogue cards, without exposing owner IDs or modifying vendor records. Then prepare a minimal, reversible image-loading/size proposal. Do not change runtime behavior until scope and regression tests are reviewed.


### 2026-11-08 — Image upload pipeline cross-check

- `inventory.js` calls the shared `compressImage(file)` before upload, then stores the result as JPEG in `user_images`.
- Main `appss.js` defines `compressImage(file, maxWidth = 1024, quality = 0.7)`; it downsizes only when width exceeds 1024 px and encodes JPEG at quality 0.7.
- Main `catalog.js` `safeImgSrc()` returns a valid HTTPS URL unchanged; public storefront cards therefore use the stored original uploaded JPEG URL, not a resized thumbnail/transform URL.
- The 68-image high-repeat group has **12,914,017 bytes (~12.3 MiB)** across one copy of its 68 files, but gateway logs observed **351,585,456 bytes (~335.2 MiB)** delivered across 1,980 CDN HIT requests — a 27.23× delivery multiple for this window.
- Existing upload compression means the immediate, lower-risk investigation target is card image request timing/visibility and repeated visitor loads, not blindly changing upload quality or replacing stored originals. Do not reduce upload dimensions/quality without image-quality review and vendor-facing regression checks.


### 2026-11-08 — Read-only cross-check of the high-repeat image folder

- A read-only aggregate query against `storage.objects` and `public.products` for the anonymized owner folder visible in the highest-repeat edge-log image paths returned **230 stored Storage objects**, **108 product rows whose primary `image_url` points into that folder**, and **1 product row whose secondary `image_url2` points into it**.
- The 68 distinct image URLs seen in the 24-hour edge-log sample are therefore a subset of a larger product-image collection, not proof that the catalogue has exactly 68 products or that all 68 were dual-image/eager cards.
- Since single-image storefront cards are marked `loading='lazy'`, a plausible explanation is that visitors load a subset of the larger catalogue as they browse/scroll, and many separate visitors request the same popular images. The edge logs do not identify individual browser sessions, so this remains an interpretation rather than a proven per-session journey.
- This cross-check reinforces that the high-repeat group is product-image traffic, but it does **not** isolate eager loading as the cause. Keep the dual-image eager behavior as a separate code-level concern; do not attribute the 351.6 MB group to it without a controlled capture.


## 2026-11-12 — Fetch-trigger audit and baseline plan

### Current status
- No runtime code was changed during this audit. The work remains read-only on `investigate/supabase-egress-catalogue-2026-11-07`.
- The audited marketplace surface is `search.html`; the audited public vendor storefront is `catalog.js`.
- Before any TTL, realtime, incremental-update, or cache implementation, the next step is to establish a repeatable request/response-size baseline for eight named journeys. Do not claim savings until before/after measurements exist.

### Marketplace trigger audit — verified
1. **Marketplace first load:** route initialization enters `loadHome()` and `loadRecent(false)`, fetching the recent marketplace product page. Home page size is currently 60 records.
2. **Marketplace return/resume:** lifecycle handlers including `pageshow`, `visibilitychange`, and reconnect handling can enter the marketplace freshness path. The current design can invalidate in-memory memo/prefetch state and route through the current URL, causing a fresh authoritative marketplace request rather than a cheap freshness check.
3. **Marketplace realtime:** the marketplace products subscription listens broadly to `products` changes and can call `scheduleMarketRefresh()`, which invalidates client caches and re-routes the current marketplace URL. This can produce another full route-level data fetch.
4. **Marketplace product detail:** opening a product uses cached/prefetched `qs_market_offers_v2` when available; touchstart can prefetch the same offer set before the click. Direct product-slug navigation can first query `qs_market_products_v2` to resolve the slug.
5. **Marketplace search:** `qs_find_canonical_v2` RPC is used for search results.
6. **Marketplace category:** `qs_market_products_by_category_v2` is paginated with `range()`, currently 16 records per page. Load More is user-controlled and must not be silently converted into an all-products fetch.
7. **Marketplace stores:** the Stores tab is lazy-loaded. All stores use `qs_active_stores_v2`; category stores use `qs_market_stores_by_category_v2`, limited to 50.

### Public storefront trigger audit — verified
- **Initial fast path:** `qs_get_store` can return store/profile data and the complete available product list in one RPC response.
- **Fallback initialization:** profile resolution can query public profile/share-link data and then fetch the complete product list from the public catalogue/products path. A phone lookup may run concurrently when needed.
- **Vendor realtime:** `catalog.js` subscribes to `products` INSERT/UPDATE/DELETE events filtered by the current vendor `user_id`. Every matching event currently calls `fetchProducts()`, replacing the complete local product list and re-rendering the catalogue. This is a confirmed full-list refetch trigger.
- **Storefront lifecycle:** unlike the marketplace, the audited storefront does not currently use the same `pageshow`/`visibilitychange`/online full-refresh machinery. Do not apply a generic lifecycle TTL to storefront without proving a redundant trigger first.

### Confirmed navigation regression to preserve during this work
Marketplace vendor handoff creates storefront URLs containing `store`, `pid`, `from=market`, and `market_product`. The storefront intentionally opens the product detail when `pid` is present. The URL remains capable of carrying that `pid`, so refreshing the storefront after a Marketplace → vendor product → WhatsApp handoff can reopen the originating product detail instead of leaving the user at the vendor catalogue. This is a URL/state lifecycle defect, not a Supabase freshness issue. It must be fixed separately and covered by regression tests.

### Baseline measurement rule
The next investigation step is a request → response-size baseline for eight journeys: (1) marketplace first load, (2) marketplace return/resume, (3) marketplace realtime-triggered refresh, (4) marketplace product detail, (5) storefront first load, (6) storefront realtime-triggered catalogue refresh, (7) Marketplace → storefront handoff, and (8) storefront refresh after that handoff.

Capture, where available: request count, HTTP method, URL/path or RPC identity, response status, response Content-Length/encoded transfer bytes, decoded response size if available, timing, cache status, initiating browser event/function, payload row/item count, and repeated-request count. Separate PostgREST/API bytes from Supabase Storage image bytes. For Storage, record URL/object identity where safe, HIT/MISS status, response bytes, and image request count. Do not use log-observed response-content bytes as a billing-meter reconciliation.

For each journey run a clean baseline against the same current production-like catalogue and viewport. Repeat enough times to distinguish first-load from warm-cache behavior. Record median and total request bytes, not only one run. Compare preview candidate vs the same journey on the unchanged baseline branch/main. Also compare Storage image bytes independently from API bytes. Do not interpret a lower request count as a win if response bytes or correctness regress.

### Comparison and acceptance principles
- **Primary:** total Supabase response bytes per journey, split into API/PostgREST, RPC, Realtime and Storage/CDN where measurable.
- **Secondary:** request count, duplicate/refetch count, time to usable catalogue, and cache HIT/MISS behavior.
- **Correctness gates:** new/edited/deleted products still appear appropriately; filters/search/pagination remain correct; vendor-scoped realtime still updates stock/product state; cart and product detail state remain intact; Marketplace → storefront Back/Keep Shopping/WhatsApp flows remain intact; refresh after Marketplace handoff does not reopen the old product.
- Do not merge a cost optimization merely because a single synthetic run is smaller. Require repeatable before/after evidence and no regression in authoritative stock/checkout behavior.

### Explicit non-goals for the first baseline/experiment
- Do not change database schema/RPC contracts.
- Do not introduce Redis or another external cache as a first response.
- Do not redesign marketplace pagination.
- Do not remove realtime merely to reduce traffic.
- Do not change image upload quality based only on current egress evidence.
- Do not combine the first TTL experiment with incremental realtime updates or the separate lazy-image experiment. Keep experiments isolated so causality remains measurable.

## 2026-11-13 — Storefront incremental freshness implementation

### Implemented on investigation branch
- Runtime change is limited to catalog.js plus the regression guard test and these documentation updates. No Supabase schema, RPC, RLS, Storage, product, stock, sales, auth, referral, or vendor-account data was changed.
- The public storefront now keeps a scoped, versioned browser catalogue cache (qs_catalog_cache_v1:<store/token>). Cached product data is rendered immediately on repeat opens instead of always downloading the complete catalogue first.
- Freshness is checked with a lightweight products query returning only id, updated_at, and qty. This is deliberately separate from the logged-in vendor IndexedDB/offline sync path; the existing IndexedDB schema and pending-sync semantics were not modified.
- When freshness metadata detects changes, only changed/new product IDs are fetched. Products that disappear from the sellable qty > 0 set are removed locally. The full catalogue remains the bootstrap/recovery path.
- Existing storefront Realtime remains optional as a fast path. A Realtime INSERT/UPDATE row is applied directly to the local catalogue; DELETE removes by ID. Only an incomplete event payload falls back to a single-product fetch. The old event handler's full fetchProducts() + full-grid replacement path was removed.
- Cached storefront state is written back after incremental reconciliation and after direct Realtime updates.
- The initial bootstrap avoids a duplicate full product fetch: its first metadata pass seeds updated_at/qty fingerprints without re-downloading product rows.
- No attempt was made to make the storefront fully offline-write capable. Offline product-image creation remains a separate future workstream.

### Verification
- Investigation branch remains 21 commits ahead / 0 behind main after the PR/docs/runtime work. Re-check the exact comparison before any merge.
- Draft PR #9: https://github.com/moyinksv-ai/QuickShop/pull/9.
- Latest commit: fb404835867f24fcd5baa8d88bb4e6883ec47bf3.
- GitHub Actions regression run #331 / ID 43361409456: success; regression-guard job completed successfully.
- Vercel preview for the exact latest commit: https://quickshopper-k1ypcjwf4-moyinks-projects-5a3815db.vercel.app, deployment dpl_8dW3n3ESUcYXWD2MJi759PnxCpGK, READY.
- This deployment readiness plus CI success establishes build/test status, but browser-level mobile QA is still required before merge. No main merge is authorized.

### Remaining preview acceptance focus
1. Open a vendor storefront normally and verify first-load catalogue/checkout behaviour is unchanged.
2. Reload/reopen the same storefront and confirm cached products appear immediately; DevTools Network should show the lightweight metadata request rather than another complete qs_get_store product payload when the cache is warm.
3. Change one product on an authorized test vendor, keep the storefront open, and verify only that product changes in the UI. Do not mutate a paying vendor's live inventory merely for this test.
4. Set a product to zero stock/remove it and verify it disappears and any cart quantity is reconciled.
5. Add a product and verify it appears without a full catalogue refresh.
6. Test Marketplace → Storefront handoff, Back/Keep Shopping, product detail and WhatsApp checkout.
7. Test Android browser refresh/offline read behaviour. The service worker remains network-first for Supabase data; the new storefront cache is an application-level fast-start/freshness cache, not an authority override.

### Engineering decision
The egress investigation now moves from measurement-only mode to targeted cost optimization. The primary target is no longer "prove every byte first"; it is "stop unnecessary complete catalogue transfers while preserving server-authoritative freshness." The next meaningful work should be QA and measurement of this implementation, not another open-ended audit.

## Next-batch investigation — vendor stock/cost visibility and storefront absence

User raised a product-operability risk: hiding stock and cost from the vendor workflow may cause vendors to forget to maintain them. A product with missing/invalid stock or cost can consequently fail storefront eligibility or appear absent, even though the vendor believes the product exists.

Treat this as a **next-batch investigation**, not an assumption that the current root cause is confirmed.

### Required investigation
- Trace the exact storefront eligibility predicate from vendor save → database/RPC → public catalogue query → storefront rendering.
- Identify whether missing stock, zero stock, missing price/cost, invalid values, unpublished/listing state, image requirements, or another field can suppress a product.
- Compare the vendor's visible product state with the server-authoritative storefront eligibility state.
- Determine whether the vendor UI currently makes required storefront-driving fields sufficiently obvious.
- Prefer a product-state/status explanation over silently hiding a product. If a product is excluded, the vendor should be able to understand why.
- Consider a clear vendor-side readiness indicator such as "Ready for storefront", "Out of stock", or "Needs price/stock" rather than relying on hidden fields.
- Preserve the storefront's cost/egress optimization; do not solve this by restoring unnecessary full catalogue downloads.

### Safety requirement
Do not change storefront eligibility or vendor product semantics until the existing save/listing logic and public query predicate have been traced. Paying vendor data must not be mutated merely to test this hypothesis.


## Vendor sync traffic investigation — 2026-11-13

Findings: Supabase edge logs showed repeated get_my_products pulls and qs_upsert_products_and_listings_v2 calls within the same short activity windows. Code tracing identified two independent causes: IndexedDB queue writes scheduled an immediate sync on every transaction completion, while indexeddb_sync.js also scheduled syncs from online, auth, pageshow, and visibilitychange. The isSyncing flag only prevents overlap; it does not coalesce a trigger that arrives immediately after a prior sync finishes. syncCloudData() also has multiple callers, and its existing 5-minute freshness guard existed only in the visibility handler, so other automatic callers could still start a full vendor pull.

Safe fix implemented on branch investigate/supabase-egress-catalogue-2026-11-07: queue/lifecycle triggers now share a 750 ms debounce scheduler, coalescing rapid IndexedDB writes and lifecycle events without changing the queued payload or RPC batching. Automatic syncCloudData() pulls now have a 15-second cooldown; explicit user-driven refresh, manual sync, and initial authenticated reconciliation remain forced. No product fields, save semantics, RPC/database functions, IndexedDB data model, or vendor behavior were changed.

Regression guard added to verify the scheduler/cooldown and preserve forced manual sync. Next QA: exercise rapid product save/restock/delete, app switch/resume, reconnect, and manual refresh; compare edge-log request counts before/after. Pay particular attention to whether one logical product action produces one qs_upsert_products_and_listings_v2 call and whether automatic lifecycle events stop producing duplicate get_my_products calls within 15 seconds.


## 2026-11-17 — Marketplace image-transfer optimization: safe first step

- Confirmed current marketplace product-card images are assigned original public Storage URLs because `_IMG_TRANSFORM = false`; server-side Storage resizing is therefore not enabled.
- Implemented one deliberately narrow browser-side optimization on `investigate/supabase-egress-catalogue-2026-11-07`: marketplace product-card images now use native `loading="lazy"` and `decoding="async"`.
- Existing shimmer, `onload`, error handling, original-URL fallback, card sizing, object-fit styling, and image URL resolution are unchanged.
- This is an image-request reduction measure, not an image-compression change. It does not alter uploaded vendor originals or storefront visual quality.
- Do **not** change the current upload compression quality from JPEG 0.7 to 0.5 merely to reduce egress. File quality, pixel dimensions, and transfer size are separate levers. The next image experiment should compare representative display variants at controlled dimensions and qualities (for example 0.80 / 0.75 / 0.65 / 0.55), using actual browser transfer bytes and visual inspection before selecting a production value.
- Preferred future image architecture: retain the vendor original and generate purpose-sized display variants (card, detail, larger view) rather than serving one compressed asset everywhere. Do not enable Supabase Storage image transforms until plan availability and expected byte savings are verified.
- Supabase remains unavailable for live egress validation at this checkpoint. Therefore no claim of measured savings is made from this change.
- Regression guard now verifies marketplace card lazy loading/async decoding and preservation of the original-image fallback.
- Main remains untouched; this branch must be preview-tested before any merge.



## 2026-11-21 — Trigger → request → response-size baseline evidence

- Current baseline branch: `optimize/market-refresh-coalescing-2026-11-20`, 2 commits ahead / 0 behind `main`. No production merge or Supabase mutation was performed.
- Supabase project ref: `wicpvvypqpaljuexmczi`.
- A read-only Supabase unified-log check for **2026-11-13 00:00–24:00 UTC** provides the strongest historical request/response evidence currently available. This is log-observed gateway response content, not the authoritative billing meter.
- Production-origin public Storage image traffic for that day: **4,691 GET requests / 373 distinct image objects / 1,057,823,351 response-content bytes (~1.01 GB)**. Of these, **4,462 HIT requests / 1,010,988,925 bytes (~965 MB)** and **229 MISS requests / 46,834,426 bytes (~44.7 MB)**.
- The same production referer generated **6** first-page `qs_market_products_v2` requests with `offset=0&limit=60`, **10** `qs_find_canonical_v2` RPC requests, **145** legacy `qs_find_canonical` RPC requests, **1** category-page request, **1** stores-page request, and **23** `qs_market_offers_v2` product-detail offer requests in that window. REST response `content_length` was not populated for these database requests in the sampled gateway logs, so their response bytes cannot be responsibly reconstructed from this field.
- Repeated-image evidence is strong but trigger attribution is not yet complete: several individual image objects were requested **23–24 times** between approximately 08:25 and 23:22 UTC. The logs expose origin/referer and request timing, but cross-origin Storage requests often carry only the site origin as referer, so the log alone cannot prove whether each repeat came from marketplace lifecycle refresh, storefront opens, multiple visitors, or browser-level cache behavior.
- Current source inspection confirms marketplace cards use native `loading="lazy"` and currently leave `_IMG_TRANSFORM = false`; therefore the marketplace is presently requesting original Storage object URLs rather than Supabase render/image transformations. This is an important cost/image-size finding but is **not yet an approved image-quality optimization**.
- A current read-only log check for **2026-11-20 08:00 UTC → 2026-11-21 08:00 UTC** shows the Supabase project returning **HTTP 402** for application PostgREST requests, including `qs_get_store`, `public_catalog_profiles`, and `profiles`. This blocks a fresh live request baseline right now. OPTIONS requests still return 200. Do not interpret current absence of successful data requests as proof that the app has no traffic; it is consistent with the project restriction state.
- Therefore the baseline is **partially established**: Storage request/response volume is measurable historically, marketplace API trigger paths are source-confirmed, but a clean eight-journey before/after byte baseline still requires successful Supabase service responses and browser-level resource timing. No TTL, realtime redesign, schema change, or image recompression should be shipped solely from the current evidence.


## 2026-11-22 — Live Supabase trigger/request correlation after project recovery

- Supabase project `wicpvvypqpaljuexmczi` is currently `ACTIVE_HEALTHY`.
- A deliberate live test was performed after recovery: product edit attempts, marketplace browsing/scrolling, refresh, storefront browsing, and product-detail browsing. The relevant log window is approximately **08:40–09:05 UTC**.
- The live edge-log window shows **9 GET** requests to `qs_market_products_v2` and **66 GET** requests to `qs_market_offers_v2` between 08:53–08:59 UTC, plus **3** and **45** OPTIONS respectively. These are gateway request counts; the gateway `content_length` field is blank for these database responses, so database response bytes are **not** inferred from this sample.
- Storage logs in the same 08:53–08:59 window show **92 `storage.object.get_public` GETs / 19,140,654 logged response bytes (~18.25 MiB)** and **92 `storage.object.info_public` requests / 45,435 bytes**. These are log-observed response bytes, not a billing-meter reconciliation.
- Product-edit attempts occurred earlier: `qs_upsert_products_and_listings_v2` returned HTTP 400 / SQL state `P0001` repeatedly at 08:43–08:50 UTC. This is a separate confirmed vendor-save error pattern and must not be attributed to marketplace egress without further causal evidence.
- The products table is confirmed in the `supabase_realtime` publication, so the marketplace subscription can receive products-table changes. However, the available `realtime_logs` did **not** expose a reliable application-level products-change delivery event during the test window. Therefore the live data does **not** yet prove `products UPDATE → Realtime delivery → browser refresh` for the 08:53/08:57 marketplace request bursts.
- The timing currently favors the safer interpretation that the observed marketplace request bursts are user navigation/refresh/detail activity unless browser-side initiator/resource timing or a more specific Realtime event correlation proves otherwise.
- No Supabase schema/config/data mutation was made during this correlation pass. No freshness architecture redesign has been shipped.
- PR #11 remains draft and unmerged. Its current branch is `optimize/market-refresh-coalescing-2026-11-20`; latest branch commit after the CSP preservation fix is `c564a187fd9718d13bfcce0780843d5aa4bb4734c`.

### Current engineering decision
Do not broaden the Realtime change yet. The strongest next measurement is browser-side resource timing/initiator capture for the same controlled journeys, especially to distinguish a lifecycle/realtime-triggered `routeFromURL()` from ordinary navigation. The surgical product-detail coalescing change remains isolated and should be validated independently.



## 2026-11-25 — Next-release freshness + auth/navigation regression work

- New branch: `next-release-freshness-regressions-2026-11-25`, based on the current marketplace optimization branch; PR #12 is draft and **must not be merged to main yet**.
- Marketplace first-page freshness now has a persisted browser snapshot (`qs_market_snapshot_v1:home`) with a 30-minute cache age and a 15-second freshness-probe cooldown.
- The no-change path renders the persisted first-page snapshot immediately, then checks `qs_market_offers_v2` using a lightweight exact offer count + latest `offer_updated_at` probe. If unchanged, the existing card payload is retained and the full `qs_market_products_v2` first-page payload is not downloaded.
- Changed offers are mapped to affected canonical IDs and only those canonical cards are fetched in bounded batches. A decrease in total offer count is treated conservatively as a possible deletion/tombstone case and falls back to the authoritative first-page query rather than leaving stale cards visible.
- The current architecture is intentionally conservative about deletions: the existing aggregation view has no durable tombstone/change-log. Do not claim mathematically perfect deletion reconciliation until a durable change feed or equivalent server-side version/change-set exists. The implemented common path eliminates the expensive full-card payload when nothing changed and limits ordinary updates to affected canonical cards.
- Offline behavior: a valid persisted marketplace snapshot remains renderable when the freshness probe fails. Freshness failure does not erase the cached marketplace or force a network error state.
- Storefront already has the corresponding scoped local cache + lightweight `products(id, updated_at, qty)` metadata check + bounded changed-ID fetch path. Preserve that implementation; do not replace it with the marketplace cache mechanism.
- Vendor history regression found: `appss.js` previously replaced/pushed history states with bare `{ qsView: ... }`, discarding `qs-init.js`'s `qsScreen` landing/auth state. The next-release branch now merges vendor view state into the existing history state instead. This is intended to prevent vendor Back navigation from losing the landing/auth boundary.
- Sign-out regression found: Supabase local sign-out fires `SIGNED_OUT` immediately before its best-effort server revocation completes. The next-release branch records `qs_show_auth_after_signout` **before** calling `signOut({ scope: 'local' })`, so the explicit signed-out destination cannot race the auth event.
- No Supabase schema/config/data mutation was made for this work. No production deployment or merge was performed.
- PR #12 preview is available and must be behaviorally tested before release.


## 2026-11-26 — Current continuation: CI guard fix + service-worker image review

- Current branch: `next-release-freshness-regressions-2026-11-25`.
- PR #12 remains draft and unmerged; production remains untouched.
- Current branch head is `2d8d9467aa247b1b60cfa7f7ed45f11f16fb1bd7`, 22 commits ahead of `main` at the verified comparison point.
- The previous failed Regression guards run (#400 / ID 45514141536) was reproduced from its logs. The failure was a **regression-guard syntax error**, not an application/runtime regression: `assert.doesNotMatch(appSource, /history.replaceState({ qsView: restoredView }/)` was parsed as an unterminated regular expression. No tests executed in that run.
- The guard was corrected surgically to use literal `String.includes()` assertions for the three forbidden bare-history-state patterns. The underlying vendor-history invariant was preserved.
- `sw.js` was inspected on both the current branch head and `main`; the file is byte-for-byte identical at this point. It already has a dedicated `qs-images-v4.0` cache and explicitly allows Supabase Storage object URLs through the Supabase network-only bypass so product images can reach the cache-first image handler.
- QuickShop image uploads currently use timestamp/random filenames ending in `.jpg`, so the existing image-extension matcher does match the production upload format.
- Marketplace product cards intentionally use native `loading="lazy"`. Therefore a persisted marketplace snapshot does **not** imply that every offscreen image has previously been downloaded and placed in the browser image cache. This is a likely explanation for offline cards whose images were never viewed online, but it is not yet proof of the exact observed main-branch offline symptom.
- Do not solve this by eagerly downloading the entire marketplace image set: that would work against the Supabase egress objective. The safer invariant remains opportunistic cache-first delivery for images the browser has actually fetched.
- Exact-head Vercel deployment for `2d8d9467aa247b1b60cfa7f7ed45f11f16fb1bd7` is READY. Deployment ID: `dpl_9KCaTWzPqxVfvKS7AjLXvyFnXQYQ`; preview alias: `quickshopper-git-next-release-69fe11-moyinks-projects-5a3815db.vercel.app`.
- The GitHub Actions workflow is configured for both push and pull_request, but no new workflow run is currently exposed for the connector-created commit. Therefore CI is **not yet verified** on the corrected exact head. Do not call the branch CI-green until GitHub reports a successful run for `2d8d9467aa247b1b60cfa7f7ed45f11f16fb1bd7`.
- No production deployment, Supabase schema/config/data mutation, or merge was performed.


## 2026-11-26 — CI guard follow-up + CSP correction

- Run #405 / ID 45792464601 executed the regression suite on the PR merge ref and reached the tests successfully: **42 passed, 5 failed**.
- All five failures were inspected. Four were brittle source-guard assertions using unescaped regex parentheses/braces for literal source text; they did not indicate application regressions. Those guards were converted to literal `includes()` checks.
- The fifth failure was substantive: the marketplace router inline-script SHA-256 was not present in `search.html`'s CSP. The current inline scripts were hashed directly from the checked-in source; the CSP contained stale hashes. The two current hashes are now recorded in `search.html`, restoring the CSP invariant rather than weakening the guard.
- `sw.js` remains unchanged from `main`; the image-cache finding remains the lazy-loading/opportunistic-cache interaction described in the previous entry. No speculative eager image prefetch was added.
- Current branch head: `0c2ab8a8306423bb7f5bc0092d064ce3e6ed46cd`. PR #12 remains draft/unmerged. Production remains untouched.
- No fresh GitHub Actions run is exposed yet for this latest connector-created head, so CI is **not declared green**. The last completed run is #405 above. Static source verification of the corrected guards and CSP has been completed.


## 2026-11-28 — PR #12 recovery, exact-head verification, and next-phase handoff

### Repository identity and recovery correction
- The canonical repository is **`moyinksv-ai/QuickShop`**. The earlier failed recovery attempts queried the wrong owner (`Moyinks/QuickShop`); their 404 responses were not evidence that PR #12 or its branch had been deleted.
- PR #12: https://github.com/moyinksv-ai/QuickShop/pull/12
- Title: **Next release: safe marketplace freshness and navigation regressions**.
- State at this checkpoint: OPEN, DRAFT, UNMERGED; GitHub reports mergeable.
- Head branch: `next-release-freshness-regressions-2026-11-25`.
- Verified head SHA before this documentation-only continuation: `52379bf6fc16696b2ff9110f70d649f9290216e9`.
- Verified base: `main` at `10de99a4fba6644f4fa3d0256b33aacf0170d091`.
- Exact comparison: **31 commits ahead / 0 behind main**, five changed files before this documentation update: `appss.js`, `handover.md`, `regression.md`, `search.html`, and `tests/regression-guards.test.js`.
- The PR head includes the regression-guard correction commit `52379bf6fc16696b2ff9110f70d649f9290216e9`; it was not missing or lost.
- No branch recreation, reset, force-push, merge, production deployment, or Supabase mutation was performed during recovery.

### Exact-head CI and preview evidence
- GitHub Actions **Regression guards run #417**, run ID `46026811859`: completed **success** for exact PR head `52379bf6fc16696b2ff9110f70d649f9290216e9`, event `pull_request`.
- The same exact SHA also has push run #416 / ID `46026801215`: completed **success**.
- Earlier failures remain part of the audit trail, not the current result: #405 / ID `45792464601` had 42 passed / 5 failed; #415 / ID `45793117403` had 44 passed / 3 failed. The literal-string guard corrections and CSP digest correction were followed by the successful #416/#417 runs. Do not describe old failures as current unresolved CI failures.
- Vercel deployment for the exact head: ID `dpl_Da3smtgFMLVSHZaLDZoDSKphi4bt`, state **READY**, Git metadata confirms branch and SHA above. Preview alias: https://quickshopper-git-next-release-69fe11-moyinks-projects-5a3815db.vercel.app
- The PR also contains a Netlify deploy-preview notification for the same SHA: https://deploy-preview-12--quickshopperapp.netlify.app (deploy record `6b09a41fa12f7d56182818d8`). Treat the Vercel preview as the canonical target for the next smoke-test pass unless the owner explicitly chooses otherwise.
- CI success and deployment READY establish automated checks/build availability only. **They do not establish browser behavior, mobile usability, or measured Supabase egress savings. Manual preview smoke testing remains outstanding.**

### What PR #12 changes — scope to validate, not assume
1. **Marketplace first-page snapshot:** persisted, versioned snapshot key `qs_market_snapshot_v1:home`; 30-minute snapshot age; 15-second freshness-probe cooldown.
2. **Unchanged marketplace path:** render the stored first-page cards immediately, then query lightweight `qs_market_offers_v2` freshness metadata (exact count + latest `offer_updated_at`). If unchanged, do not download the full `qs_market_products_v2` first page again.
3. **Changed marketplace path:** map changed offers to canonical product IDs and fetch affected cards in bounded batches. If total offer count decreases, take the conservative authoritative first-page fallback because the current aggregation view does not provide durable tombstones/change history. Do not promise perfect deletion detection for every possible same-count mutation.
4. **Offline fallback:** if the freshness probe fails, preserve/render the valid stored marketplace snapshot; do not erase it or make network freshness failure blank the catalogue.
5. **Storefront:** preserve its existing scoped cache + lightweight `products(id, updated_at, qty)` metadata check + bounded changed-ID fetch. Do not replace it with the marketplace implementation.
6. **Vendor history:** `mergeVendorHistoryState(view)` preserves existing history fields (including the landing/auth screen state) while adding `qsView` and `qsVendorApp`.
7. **Sign-out:** write `qs_show_auth_after_signout` before `supabase.auth.signOut({ scope: 'local' })`, because local `SIGNED_OUT` fires before the server revocation completes.
8. **Product-detail refresh:** preserve the earlier coalescing guard so a products-table event does not tear down/re-route an already-open product detail.
9. **Service worker:** `sw.js` was confirmed byte-for-byte identical to main at the reviewed checkpoint. Do not change it as part of the current preview QA or image-sizing work without new evidence.

### Mandatory preview smoke test — next immediate task
Use the exact Vercel preview above on Android/mobile and, where possible, desktop responsive view. Use a dedicated authorized test vendor/account and test products only. Do not edit a paying vendor's real inventory to manufacture events.

**A. Marketplace request/freshness behavior**
- Cold first load: verify cards, deterministic order, search/category/Stores behavior, Load More, product details and offer display.
- Warm revisit with no data change: cached first page should appear immediately; inspect Network/Resource Timing and confirm the lightweight freshness probe occurs but the full first-page card payload does not.
- Repeat refresh/revisit inside the 15-second probe cooldown and after it expires; record exactly which requests happen. Do not mistake browser memory cache for absence of a Supabase request.
- Change one test-vendor offer/product while marketplace is open: verify only the affected canonical card(s) reconcile; unrelated cards remain stable.
- Exercise deletion/out-of-stock and offer-count decrease: verify conservative full-page fallback happens where intended and no stale sellable card remains.
- Exercise same-count edits and multiple changed IDs; ensure batching and merge order are correct.
- Product-detail open + product update/realtime event: detail must remain open and correct; returning to listing must reveal the latest state.
- Confirm filters, pagination and Load More are not accidentally reset or silently converted to an all-products fetch.

**B. Storefront and handoff**
- Cold storefront load; warm revisit unchanged; single product edit; add product; stock-to-zero/removal; and restore network after offline.
- For unchanged warm revisit, confirm lightweight metadata request rather than a complete catalogue payload.
- Marketplace → product detail → vendor storefront → Back/Keep Shopping → WhatsApp/order path.
- Refresh after the Marketplace handoff: remain on the intended vendor storefront/current listing state; do not reopen the old originating product detail unless a direct vendor URL intentionally includes a product ID.
- Verify product ordering, stock labels, cart quantity reconciliation, image fallbacks, dual-image swipe/lightbox and realtime updates.

**C. Vendor navigation/auth regressions**
- Vendor Home → Settings/payment/activation wall → system Back: remain inside vendor app and return to the correct vendor view; do not unexpectedly fall through to public landing.
- Explicit sign-out: ends at visible signed-out/auth destination, not blank screen or stale vendor app.
- Refresh after sign-out: must remain signed out and must not resurrect the app.
- Test browser Back/Forward and cold reload separately; history behavior can differ between these paths.
- Test slow network and repeat on Android browser/PWA if possible.

**D. Offline behavior**
- With marketplace/storefront first visited online, go offline and revisit. Confirm cached metadata/products remain usable and network failure does not wipe them.
- Distinguish cached product metadata from cached image assets. Lazy images never requested by that browser may not exist in `qs-images-v4.0`; this is expected under opportunistic caching.
- Do not demand that every marketplace image is offline-available unless a bounded image-prefetch policy is separately designed and measured.
- Reconnect and confirm reconciliation occurs without duplicate refresh storms or stale state.

**E. Evidence to capture**
For each journey, record preview SHA/URL, device/browser, online/offline state, exact action sequence, request path/RPC, method/status, request initiator, count, transferred bytes/decoded bytes where available, response rows, image URL/bytes, and observed UI state. Keep API/RPC and Storage image traffic separate. Compare against main using the same test account/catalogue, viewport, network and cache state. Use browser Resource Timing/DevTools where available and correlate with Supabase logs; gateway log bytes are not automatically billing-meter bytes.
- Pass criteria are both correctness and lower measured bytes on the unchanged warm path. A smaller request count alone is insufficient.
- No production merge until the owner has reviewed the evidence and explicitly authorizes it.

### Image resizing/layout work — approved investigation, not yet an implementation
The user wants image display to become more standard and consistent across Marketplace and Storefront while reducing transfer bytes from serving original images at display size. Visual character should remain familiar; no dramatic redesign, quality loss, or inconsistent card geometry.

Verified current facts:
- Marketplace `search.html` has `_IMG_TRANSFORM = false`; `imgTransform()` currently returns original public Storage URLs. Marketplace card images use `loading="lazy"` and `decoding="async"`.
- Storefront `safeImgSrc()` currently preserves the original public Storage URL; no storefront thumbnail transform is applied.
- Upload path currently compresses originals (historical source audit: max width 1024 px, JPEG quality 0.7). Do not lower upload quality globally as a shortcut.
- Keep `sw.js` untouched; the existing image cache is per-browser and opportunistic.

Required next investigation/design:
1. Inspect actual CSS/container dimensions and image aspect ratios for Marketplace cards, Storefront cards, product detail, and any secondary image/lightbox. Define consistent image slots/object-fit behavior without changing the overall visual identity.
2. Measure representative source image intrinsic dimensions, encoded bytes, format, and actual rendered CSS dimensions at common Android viewport sizes. Include portrait, landscape, square, transparent/PNG if supported, high-detail and low-light examples.
3. Derive output pixel dimensions from actual display slot dimensions × devicePixelRatio, with a defensible cap. Pixel count scales with width × height; if both dimensions are scaled by factor `s`, pixels scale by `s²`. For example, a 0.5 linear scale produces 0.25 pixel count, not 0.5; encoded byte savings are content/codec dependent and must be measured rather than assumed.
4. Compare purpose-sized variants (card thumbnail, product detail, larger/lightbox) against original using actual encoded transfer bytes and perceptual inspection. Test multiple formats/quality levels; do not assume a fixed JPEG quality or that 0.5 is acceptable.
5. Prefer retaining the original as the canonical vendor asset and deriving display variants. Never destructively overwrite the vendor original. Determine whether the current Supabase plan supports Storage image transformation and calculate actual cost/egress trade-offs before enabling it. If transform pricing is unavailable/uneconomic, evaluate pre-generated derivatives or another safe variant pipeline.
6. Use responsive `srcset`/`sizes` or equivalent only when the chosen URL variants are real, stable, and supported by the current hosting/storage configuration. Ensure cache keys/versioning invalidate old variants safely.
7. Compare bytes per viewed card and per journey, not just one image file. Lazy loading, correct slot sizing and CDN cache behavior affect aggregate savings.
8. Preserve loading shimmer, async decoding, error/original fallback, image ordering, dual-image gestures, lightbox, accessibility/alt text, offline opportunistic cache and image freshness. Do not eagerly download every image.
9. Add regression guards for stable image slot/aspect-ratio behavior, selected variant URL, fallback to original, no accidental eager loading, and no mutation of original uploads. Validate Android low-bandwidth behavior and actual visual quality before proposing merge.

### Release decision at this checkpoint
- PR #12 is still a **draft release candidate**, not approved for merge.
- Automated regression checks on exact head are green; preview deployment is READY.
- Manual smoke testing, request/byte measurements, and user acceptance are still required.
- Main and production remain untouched. Any documentation update should remain on this PR branch. Keep image resizing as a separate measured change after PR #12's current runtime fixes are smoke-tested, unless the owner explicitly chooses a combined but isolated commit series.


---

## 2026-11-28 — PR #12 regression investigation and fixes in progress

**Release boundary:** All fixes below are being made on the existing PR #12 branch, `next-release-freshness-regressions-2026-11-25`. Do not merge or deploy to production until CI and the user's Android preview retest pass. No production data, schema, storage policy, or Supabase configuration was changed.

### Evidence gathered from the user's Android test and Supabase logs

- Production `qs_upsert_products_and_listings_v2` calls returned repeated HTTP 400 responses between approximately 13:08 and 13:14 UTC on 2026-11-28.
- PostgreSQL recorded the specific exception `Product id belongs to another vendor` from line 81 of `qs_upsert_products_and_listings_v2(jsonb)`. The SQL ownership guard is correct and must not be weakened.
- Production Storage recorded an image upload to `user_images` returning HTTP 200 at 13:14:19 UTC. The product/listing RPC then failed at 13:14:25 and 13:14:42. Therefore the image binary upload can succeed while the product row that references it fails to sync.
- Preview requests for `qs_upsert_products_and_listings_v2` returned HTTP 204 and `get_my_products` returned HTTP 200 during the later preview test. No preview Storage upload request was present in the inspected log window, so a preview image-selection/compression failure is not yet proven to be a Storage rejection.

### Root causes identified

1. **Storefront refresh replayed the marketplace-selected product.** Marketplace vendor links include `pid`; `catalog.js` auto-opens that product every boot. The URL retained `pid`, so refreshing the vendor storefront replayed the product-detail overlay. Fix: capture and consume `pid` once for `from=market`, using `history.replaceState` to remove only `pid`; preserve `store`, `from`, and `market_product`. Direct vendor `?pid=` links remain unchanged.
2. **Landing/auth and vendor tab history competed for the same popstate.** `qs-init.js` handled a preserved `qsScreen` before `appss.js`, stopping the vendor listener. Also, app view restoration pushed duplicate states. Fix: while `mode-app` is active, leave popstate to `appss.js`; restore all valid vendor tabs including Home without pushing a duplicate; only seed vendor history when `qs_session_active` is true; at the authenticated history boundary, ask for sign-out confirmation and restore the current view on cancel.
3. **Explicit sign-out marker was consumed too early.** `SIGNED_OUT` called `handleAuthLogout()`, which removed `qs_show_auth_after_signout` before the reload. Fix: only consume the marker when `options.initialLoad` is true. A shared guarded `requestSignOut()` now serves Settings and the Back boundary and labels the signed-out history entry as auth.
4. **IndexedDB pending actions were not account-scoped.** `getAllPending()` returned every browser queue item and the worker submitted all of them using the currently logged-in user's ID. This can send an old vendor's product ID under another vendor and trigger the database's correct ownership exception. Fix: stamp new actions with their originating `userId`; filter queue reads and sync by the active user; claim legacy non-destructive actions only when their entity is present in that user's local snapshot; claim legacy delete actions only after a user-scoped RLS query confirms the row belongs to that user; leave ambiguous actions queued and report them rather than risk cross-account writes. Keep the database ownership guard intact.
5. **Manual Sync Now pushed the queue twice.** It called `syncPendingToSupabase()` directly and then `syncCloudData()`, which pushes again. Fix: one push+pull pass over pending changes only (no full-catalog requeue), with separate push/pull success reporting. Concurrent callers now await the same in-flight sync result; an in-flight operation is never reported as a successful upload.
6. **Image replacement failure erased the existing image preview.** Fix: retain the current image if a replacement fails; reset the second image input so the same file can be selected again; provide explicit decode/read/compression error messages instead of an opaque event string.

### Files changed in PR #12

- `appss.js`: authenticated history ownership, Back-boundary sign-out confirmation, sign-out marker lifecycle, one-pass manual sync, image preparation diagnostics.
- `qs-init.js`: defer popstate ownership to the vendor app while authenticated.
- `catalog.js`: one-time marketplace `pid` consumption.
- `indexeddb_sync.js`: per-user queue ownership, conservative legacy claiming, coalesced in-flight sync.
- `inventory.js`: preserve existing image when replacement upload fails; reset image picker inputs.
- `tests/regression-guards.test.js`: guards for the regressions above.
- `handover.md` and `regression.md`: this investigation and test requirements.

### Important compatibility / release cautions

- Legacy IndexedDB rows without an owner are not blindly assigned to whichever vendor logs in. Non-destructive legacy actions are claimed only when their item ID exists in the active user's local snapshot. Ambiguous or destructive legacy actions remain untouched and cause Sync Now to report an incomplete sync. This is intentional fail-closed behavior; verify the displayed count during preview retest. Do not delete or clear those rows as a workaround.
- The Storage 200 proves at least one production image upload succeeded; it does not prove the preview image picker is fixed. Preview image selection must be retested with the same Android device and a normal JPG/PNG/WebP image. If no Storage POST appears, inspect the now-specific client-side decode/read error.
- The SQL function `qs_upsert_products_and_listings_v2` and its ownership exception are not to be changed for this fix.
- CI has not yet been re-verified after the latest commits. Check PR #12 head, run all workflow jobs, and inspect the exact preview deployment before requesting retest.

### Required Android retest before merge

1. Sign in, open Inventory, press Android Back. Expect a sign-out confirmation, not landing. Cancel; the same inventory view must remain. Navigate Home → Inventory; Back should return Home; Back again should ask to sign out.
2. Confirm Sign Out in Settings and through the Back confirmation. Expect the login/auth screen after the reload, with the Home route still accessible. Refresh; it must remain on auth, not silently return to landing or reopen Inventory.
3. From marketplace, open a vendor product, confirm the selected product detail opens once, refresh the vendor page, and confirm the vendor product grid appears. Verify Back to Marketplace returns to the originating product.
4. Edit an existing product, select a replacement image, save, and confirm both image and product data persist. Repeat with the second image slot and with the same image selected twice. A failed replacement must preserve the old image.
5. Edit a product without adding an image. Confirm background sync completes once. Press Sync Now and verify no success toast appears if any batch fails or legacy actions remain unassigned. Verify another account's queued actions are not sent as the current vendor.
6. Confirm marketplace/storefront snapshots, incremental freshness, and offline cached rendering remain intact.

**Current state:** changes are committed to the PR #12 branch; CI and browser/device validation remain outstanding. No merge or production deployment is authorized.


### Additional hardening after the first green run (2026-11-28)

- Manual Sync Now no longer re-enqueues every local product. It pushes only the current vendor's pending queue and then performs its pull. This avoids turning a no-change manual sync into a full-catalog write.
- Pending queue sync coalesces concurrent callers and requests a follow-up pass if a new action is added while a batch is in progress. An offline push returns `ok: false`; it cannot be reported as a completed upload.
- Cloud pull/sync calls for the same vendor now await one shared result. A different account cannot inherit that result. Offline/not-ready cloud sync returns `pullOk: false`, so the manual button cannot display success for a skipped operation.
- Legacy delete actions can be migrated only after an RLS-scoped query confirms that the target row belongs to the currently authenticated vendor. If ownership cannot be proven, the action remains queued and the sync reports incomplete.
- Image decoding no longer rejects a valid image solely because an Android content provider supplied a generic MIME type. The browser must successfully decode the actual bytes; failure then receives a specific error.

The later commits above supersede the earlier CI statement. Re-check CI and Vercel against the final branch HEAD before asking for another Android test.


### Verification snapshot — 2026-11-28 13:43 UTC

- Runtime code commit: `07d8c6f6eab6ea4f6391b9f414685b68bc3b15b6`.
- GitHub Actions Regression guards run #483: **51 passed, 0 failed**.
- Vercel preview for that exact runtime commit: `dpl_GAZNP8zjfwTRq1hXVA4KQQxmu7TL`, state `READY`; page fetch returned HTTP 200.
- Preview URL: `https://quickshopper-6fmf9nwtw-moyinks-projects-5a3815db.vercel.app`.
- This verifies build, source guards, deployment metadata and public page reachability. It does **not** verify authenticated Android vendor workflows or actual image selection; user retest remains mandatory.
- PR #12 remains open/draft/unmerged. No production deploy, Supabase schema/policy change, or vendor-data mutation has occurred.


### Final sync consistency pass (2026-11-28)

- `syncCloudData` now re-checks the current vendor's IndexedDB queue after the cloud pull/reconciliation. If edits arrived during the pull, it flushes them before returning the sync result. This closes the race where a manual Sync Now could await an earlier push, report success, and then show a later background upload failure for an edit queued during the pull.
- The login recovery path now receives the initial pull result and bulk-requeues local products only when the pull succeeded, the initial pending push did not fail, and the cloud product count is exactly zero. It no longer rewrites the whole local catalog on every login.
- Manual Sync Now also no longer requeues every local product; it uses the pending queue only.


### User retest findings and next-release corrections (2026-11-28)

The user's latest Android preview retest confirms:
- Sign-out now lands on the auth screen; Sync Now works.
- Marketplace to storefront handoff and refresh no longer reopen the selected detail.
- Image selection intermittently fails with "the selected image cannot be read from this device", but succeeds on a subsequent attempt.
- The auth Home control is visually too quiet and did not respond reliably immediately after sign-out.
- A closed product-detail heading briefly bleeds into the storefront grid on initial scroll.
- Vendor stock can differ from the public storefront after an edit and refresh.

Code inspection established the storefront staleness window: the cached storefront skipped metadata reconciliation for 15 seconds after a recent probe. A stock edit during that window could leave the old snapshot on refresh. The server's atomic product/listing RPC updates the listing timestamp, so the public offer freshness signal is available. The correction is to probe compact product metadata on every full storefront page entry, while still fetching only changed product rows.

The sync path now also patches same-origin storefront cache entries with the qs_catalog_cache_v1 prefix for the matching vendor only, and only after qs_upsert_products_and_listings_v2 succeeds. The patch replaces or removes only the affected product and its metadata, preserving all unrelated cached products. Failed RPCs do not touch the public cache. Zero-stock products are removed from the sellable snapshot.

Additional UI/image corrections:
- Image compression now prefers URL.createObjectURL(file) to avoid Android's intermittent FileReader-to-base64 read path; FileReader remains a compatibility fallback. Object URLs are revoked after decode.
- The auth Home button now invokes the canonical landing transition directly rather than relying on a prior history entry.
- Closed detail overlay uses hidden visibility and disabled pointer events, and becomes visible only while open, preventing its content from bleeding through the grid.
- Product detail title typography has been strengthened; auth Home button has a clearer high-contrast surface.

Important verification boundary: these are source-level corrections committed to PR #12. They do not prove that the user's specific stock edit now refreshes correctly until the latest preview is tested on Android. Do not merge or deploy production until CI, preview deployment, and the focused Android retest pass.


### Verification — stock freshness and Android follow-up (2026-11-28)

- Runtime source commit: bbfbcbbc2adf57fee8902db03b0c8f8c8ff0bfe3.
- GitHub Actions Regression guards run #508: **56 passed, 0 failed** on the runtime source commit.
- Vercel preview for the exact runtime commit: deployment dpl_8ViN9d74v65LxAum4UAktKjEvKpa, state READY.
- Preview URL: https://quickshopper-2ok50grzk-moyinks-projects-5a3815db.vercel.app
- Authenticated Android verification of the new atomic stock patch, Blob URL image path, auth Home action, and detail-overlay bleed remains outstanding.
- PR #12 remains draft/open/unmerged. No production deployment and no Supabase schema, policy, or vendor-data mutation was performed.


### Marketplace stale-card retest + Supabase request-log review (2026-11-28)

User observed a marketplace card still visible after its last vendor listing became unavailable; tapping it showed "No vendor on QuickShop is selling this right now."

#### Confirmed root cause in source
- `reconcileMarketChangedProducts()` detected a falling active-offer count and returned `null`, with a comment claiming it would fall back to the authoritative page.
- Neither caller performed that fallback. `loadRecent()` and `scheduleMarketRefresh()` both treated `null` as "do nothing", leaving the old first-page snapshot visible.
- `qs_market_offers_v2` filters out `products.qty <= 0`, so removed listings have no tombstone in the delta query. A canonical detail lookup can correctly return an empty offer list while the old card remains in localStorage.
- Corrected in PR #12: on a falling offer count, fetch only the authoritative visible first page from `qs_market_products_v2`, replace the persisted first-page snapshot and UI, and preserve the incremental path for ordinary updates.

#### Request logs (production Supabase project, requests originated from PR preview)
Window: 2026-11-28 15:23–15:34 UTC, referer filtered to the preview deployment `quickshopper-2s0uy3du6...`.
- `qs_market_products_v2`: 5 GETs. Two identical first-page 60-row requests occurred 340 ms apart; two identical changed-ID (20 IDs) requests occurred 304 ms apart; one slug lookup. This points to duplicate initial/lifecycle and overlapping reconciliation work.
- `qs_market_offers_v2`: 104 canonical-ID detail/prefetch GETs across 53 distinct canonical-ID queries, plus 17 watermark GETs and 10 delta GETs. 56 OPTIONS preflights were also logged for the view.
- At least one canonical-ID lookup returned an empty JSON array (HTTP 200, content length 2, Content-Range */*), consistent with the no-vendor message.
- The 17 watermark GETs used the same exact-count/latest-timestamp query. `writeMarketSnapshot()` did not persist `probedAt`, so the 15-second freshness cooldown was ineffective after reading the snapshot again.
- The 104 canonical-ID queries were initiated by card `touchstart` prefetch. On Android, touchstart also occurs for scroll gestures; this was fetching vendor offers before a card was actually opened.
- Corrected in PR #12: authoritative first-page fallback for offer-count decreases; persist `probedAt`; coalesce overlapping snapshot reconciliations; suppress initial non-BFCache `pageshow` refresh that can duplicate the initial load; remove touchstart prefetch; start offer lookup on actual click and select only fields used to render vendor choices.
- These changes are intended to reduce unnecessary offer queries while retaining authoritative detail fetch on actual product open.

#### Important storefront metadata permission failure — unresolved release blocker
- In the same preview window, `GET /rest/v1/products?select=id,updated_at,qty&user_id=...` returned HTTP 401 four times (the broader 6-hour window showed 23 such failures).
- Postgres logs explicitly report `permission denied for table products` for the anon role. The table has no anon SELECT grant; the RLS policy alone does not grant SQL privileges.
- `public_catalog_products` is an existing anon-readable view with the public active-product projection, but it currently omits `updated_at`. The current storefront incremental metadata code therefore cannot work for public visitors, and the changed-row fetch against `products` is also invalid.
- Do NOT grant anon SELECT on the base `products` table. Safe correction needs a migration to append `updated_at` to the existing `public_catalog_products` view, then switch both metadata and changed-row reads to that public view. No such migration or database change has been made yet.
- PR #12 must not be merged until this is corrected and verified. The migration needs to be created with Supabase CLI and reviewed; production remains unchanged.

#### Sync log signal
- In the same preview window, `qs_upsert_products_and_listings_v2` had 3 POST requests returning HTTP 204, consistent with the user's report that Sync Now is now working.
- Earlier 400/P0001 "Product id belongs to another vendor" errors were still present in the broader log window at 13:08–13:14 UTC; these predate the latest 3 successful preview upserts and should remain in the regression watch.
- PostgREST also emitted several "Thread killed by timeout manager" system log entries around 15:23–15:30 UTC. They are not directly correlated to a specific QuickShop REST path in the available logs; do not attribute them to the new marketplace logic without further evidence.

No production deployment, SQL grant, schema mutation, or vendor-data mutation was performed in this log review.


### Verification after marketplace stale-card/request fixes (2026-11-28)

- Latest app-code commit tested: `4ed6ac21df2151ff803681ff8c14aac8b38b3ca7` (the subsequent commits only updated handover/regression documentation).
- GitHub Actions run #530: **59 tests passed, 0 failed**.
- Exact-app-commit Vercel deployment: `dpl_EobHUowprYQihQKSJc7XCjiHdeZR`, state READY.
- Preview URL: https://quickshopper-c8r1zkpkb-moyinks-projects-5a3815db.vercel.app
- PR #12 remains open/draft/unmerged.
- The storefront public metadata permission blocker remains unresolved and must be fixed with a reviewed migration before merge. No Supabase schema/grant/data changes have been made.



### Public storefront freshness permission fix (2026-11-28)

The user ran the reviewed SQL in the Supabase Dashboard for project `wicpvvypqpaljuexmczi`. The follow-up verification query returned:

- `anon_can_read_updated_at = true`
- `anon_has_full_table_select = false`
- `view_exposes_updated_at = true`
- `view_security_options = {security_invoker=true}`

A direct information_schema check also confirmed that `public_catalog_products.updated_at` is `timestamp with time zone`. This confirms the intended narrow permission boundary: anonymous clients can read the freshness timestamp through the public projection without receiving table-wide SELECT on `products`.

PR #12 client correction:
- `fetchCatalogProductMeta()` now selects only `id, updated_at, qty` from `public_catalog_products`.
- `fetchCatalogProductsByIds()` now fetches changed rows from `public_catalog_products`, retaining the 100-ID batch bound and active-stock filtering provided by the view.
- The changed-row projection now matches the view exactly and no longer requests `created_at`, which is not exposed by the view. Changed IDs are fetched in complete sequential batches of at most 100 (not truncated after the first 100), and mapped cache rows retain `updated_at` so a Realtime update does not force a redundant changed-row read on the next revisit.
- Public storefront bootstrap no longer falls back to the protected `products` base table if the public view fails. It returns the view error instead of issuing a predictably unauthorized request.
- Regression guards now require both freshness paths to use the public view and prohibit `.from('products')` in the standalone storefront client.

The live database change was applied manually through Dashboard SQL Editor because the user is working from a phone and cannot run the CLI. It does not yet have a corresponding committed Supabase migration file or migration-history entry. Do not fabricate or insert a migration-history row. When CLI access is available, reconcile the exact live DDL into a proper version-controlled migration and verify migration history before future schema deployments. The live SQL is the previously reviewed GRANT SELECT (updated_at) plus CREATE OR REPLACE VIEW definition; do not broaden grants.

Latest client/test commits:
- `catalog.js`: `35b9945cf9c06c4336906b29d117c3e4031cf0d7`
- `tests/regression-guards.test.js`: `c9c0e671da5ebd6089d8adaa9c77e9b5fc5ce582`

This source-level correction is not yet a release verification. Run CI and deploy a fresh preview for the latest branch head, then verify on Android that a cached storefront with no changes retains its cached payload, a single changed product fetches only that product, a zero-stock product disappears, and the view requests return successfully without any anon request to `/rest/v1/products`. Preserve the vendor IndexedDB/offline path and same-origin atomic cache patching. PR #12 remains open/draft/unmerged; no production deployment is authorized.


---

## Latest release follow-up — 2026-11-28 (post PR #12)

### Production identity
- main and the READY Vercel production deployment both point to 8d247c8c3ec6a911eeacde4042e84d16886bcd92 (PR #12 merge). Production aliases verified: quickshopper.vercel.app and quickshoppify.vercel.app.
- This is deployment verification only; it does not prove every installed PWA has already loaded the new JavaScript.

### PWA update propagation — still open
- Released sw.js is still qs-v2.1.10; the deployed sw.js did not change in PR #12. The app-shell strategy is stale-while-revalidate, and qs-init.js only logs when a new worker is installed. There is no visible, safe update prompt or controlled reload flow.
- Consequently, a returning installed PWA can run its cached JavaScript on the first visit while revalidation happens in the background. Do not claim universal immediate rollout.
- A future fix must explicitly account for offline fallback and in-progress vendor edits. Do not blindly bump the app-shell cache name: the activate handler deletes old caches, and deleting the old shell before the new shell is warmed could break offline startup. Keep image and marketplace caches intact. Prefer an explicit update-ready UX that never forces a reload while unsaved work may exist, and prove which assets are fresh before inviting reload.
- No PWA update code was changed in this follow-up branch.

### Vendor sync failure investigation
- Supabase Postgres logs for 2026-11-28 show 16 errors between 13:08:57 and 13:14:42 UTC, across 15 Postgres sessions/processes, all with Product id belongs to another vendor from qs_upsert_products_and_listings_v2(jsonb) (P0001, function line 81).
- The RPC ON CONFLICT (id) DO UPDATE ... WHERE products.user_id = auth.uid() deliberately refuses to update a row owned by another vendor; the subsequent ownership check raises this error. This is a protective cross-vendor boundary, not evidence of a database overwrite.
- The server logs do not include the affected product IDs, request body, or authenticated vendor ID. Therefore the precise queued row and affected vendor cannot be identified from the available logs. Do not delete, reassign, or rewrite any IndexedDB queue row or product record based on this evidence.
- Source review found a client-side attribution risk: getQueueOwnerId() fell back to qs_last_user_id and qs_user_cache when the authenticated app identity was not available. Those values are cached hints and can be stale during account transitions. The follow-up branch removes those fallbacks. When auth identity is unavailable, a new queue row remains unassigned and can only be claimed later through the existing guarded legacy-claim checks.
- This is preventative ownership hardening, not proof that the 16 logged failures were caused by that fallback. Existing wrongly tagged rows are not automatically repaired by this change.
- Do not modify the RPC or relax its ownership checks. After preview verification, investigate affected-device queue contents using a safe vendor-authorized diagnostic before deciding how to resolve any pre-existing bad row.

### Egress measurement
- No controlled before/after egress-byte comparison has been established. Supabase REST logs do not provide a reliable response-body byte count in the available query results; preview request samples are not production proof. Keep database egress and Storage image egress separate.
- Do not publish a savings percentage until Supabase Usage metrics are compared over matched activity windows.

### Branch / release discipline
- Branch: fix/strict-offline-queue-ownership-2026-11-28, based directly on production main SHA above.
- This branch changes only the queue owner resolver, a regression guard, and these handover/regression notes. No SQL, schema, RLS, RPC, storage, vendor data, or production deployment changes.
- Required before merge: exact-head CI regression run, diff review, preview smoke test for online/offline product edits and account switching, and explicit user approval. Production remains unchanged.
