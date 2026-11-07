# QuickShop Engineering Handover
**Updated:** 2026-11-07  
**Repository:** `moyinksv-ai/QuickShop`  
**Active working branch:** `design/quickshop-ui-refinement`  
**Production baseline:** `main`  
**Release rule:** No merge to `main`, production deployment, schema change, or destructive data operation without explicit user approval.

> This file is the first document a new engineering session must read. It supersedes conversational assumptions, not the detailed history in `document.md` and `regression.md`. Re-fetch branch heads, files, preview deployment and tests before acting; never assume a remembered SHA or preview is still current.

---

## 0. Immediate priorities (in order)

1. **WP10 Add Product: investigate and resolve user-reported preview defects** (user has manually tested the current WP10 preview; see §2). Do not declare WP10 complete until these are fixed and mobile browser QA passes.
2. **Urgent marketplace/catalogue egress and deterministic caching investigation** (see §3). It is a separate, high-priority workstream. Do not combine broad changes with WP10 fixes merely to save time; use small isolated commits/branches and coordinate against the current WP10 branch.
3. Continue remaining WP10 work only after the above is safely reconciled: WP10-C browser/device Back/history root-cause work, WP10-D form UX redesign, WP10-E inventory header hierarchy, and known save-path risk R5.
4. Keep the public engineering evidence log updated for the user's future portfolio, X and LinkedIn.

The user explicitly said to inspect all affected paths and edge cases **before fixing anything**. They expect atomic tracing, deterministic reasoning, no blind changes, and no regressions. If an operation is risky or its blast radius is unclear, stop and explain the decision needed.

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
2. Fetch current branch heads and exact latest commits for `main`, `design/quickshop-ui-refinement`; verify Vercel deployment commit/preview and whether branch changed since last report.
3. Do not assume the old WP10 preview URL maps to current HEAD. Confirm the deployment.
4. Reproduce user's WP10 findings on the preview if browser capability is available. If no browser is available, say so and use source tracing; do not claim reproduction.
5. Trace draft save/hydration/route/back logic and build a minimal state-transition diagram plus root-cause report before changing code.
6. In parallel only where safe, continue read-only egress trace: request lifecycle instrumentation/baseline, query plans and actual view/function definitions, Storage image metadata/cache headers, historical Usage dashboard breakdown, service worker cache behaviour, realtime subscriptions, public storefront and logged-in paths.
7. Write the full edge-case matrix and proposed changes with blast radius. Ask the user only for product decisions or risky actions that cannot be safely inferred.
8. Implement in small isolated commits, add tests, inspect full diff, deploy preview, test on mobile, report results and remaining risks.
9. No production merge/deploy without explicit approval.

## 7. Status truth table at handover

| Item | Status |
|---|---|
| WP10 full-screen Add Product workspace | User confirmed visually good |
| WP10 draft persistence/resume | User's latest preview test indicates not working end-to-end |
| WP10 page Back control | User reports broken |
| WP10 refresh/deep-link route persistence | User reports refresh returns to Home |
| WP10 return to Inventory then Add Product | User reports it does not open expected draft/resume/clear choice |
| WP10 mobile/browser QA | Incomplete |
| WP10-C/D/E | Not complete / re-verify |
| Marketplace randomized ordering | Previously found in source; re-verify current branch |
| Service worker network-first marketplace table strategy | Previously found; re-verify current branch |
| Marketplace pageshow/visibility refresh invalidation | Previously found; re-verify current branch |
| Whole-products realtime invalidation | Previously found; re-verify scope and effects |
| `qs_active_stores_v2.last_product_update` | Previously observed NULL; re-check live schema |
| Official 2+ GB historical egress root cause | Unknown; historical Usage breakdown required |
| Redis need | Not established; do not add yet |
| Portfolio review | Not completed; prior retrieval failed |
| Production changes | None authorized |

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
