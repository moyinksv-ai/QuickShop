# QuickShop — Engineering Documentation

**Version:** 2.5  
**Last Updated:** March 17, 2026  
**Status:** Active Development  
**Repository:** https://github.com/moyinksv-ai/QuickShop  
**Live URL:** https://quickshopper.vercel.app  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [System Architecture](#3-system-architecture)
4. [Design Decisions](#4-design-decisions)
5. [UI/UX Decisions](#5-uiux-decisions)
6. [Database Schema](#6-database-schema)
7. [Security Architecture](#7-security-architecture)
8. [Deployment](#8-deployment)
9. [Change Log](#9-change-log)
10. [Known Issues & Safe Extension Points](#10-known-issues--safe-extension-points)
11. [AI Handoff Context](#11-ai-handoff-context)

---

## 1. Project Overview

### What It Is

QuickShop is a **mobile-first, offline-capable Progressive Web App (PWA)** that gives small business owners a complete inventory management and sales recording system that works with or without internet connectivity, and generates a shareable customer-facing product catalog accessible via a single WhatsApp link.

### The Problem It Solves

Small and micro business owners in emerging markets — market traders, fragrance vendors, boutique operators, food sellers — face three specific problems that existing solutions do not address simultaneously:

1. **Unreliable connectivity.** Many operate in markets with poor or expensive mobile data. A cloud-dependent app becomes useless mid-transaction.
2. **Customer catalog sharing.** WhatsApp is the primary commerce channel. Vendors need a way to share a browsable product list, not a PDF or a screenshot.
3. **Zero infrastructure tolerance.** There is no IT team. The vendor is also the developer. The system must deploy itself and stay deployed without intervention.

QuickShop solves all three: it stores all data locally first, syncs when online, and generates a public storefront accessible to any customer with the link — no account, no app install.

### Target Users

| Role | Description |
|---|---|
| **Vendor (Admin)** | Business owner who manages inventory, records sales, views reports, and shares the catalog. Uses the app on their own phone. Examples: ALL'S Signature (fragrances), Moyinks. |
| **Customer (Catalog)** | Customer who receives a `?store=slug` link via WhatsApp, browses products, builds a cart, and submits an order back via WhatsApp. No account required. |

### Core Capabilities

- Inventory: add/edit/delete products with dual photos, barcode, price, cost, stock, category, description
- Sales: record transactions from home dashboard with auto stock decrement
- Offline-first: all mutations queue to IndexedDB and batch-sync to Supabase on reconnect
- Customer catalog: public storefront with swipeable dual-image cards, category chips, search, cart, WhatsApp checkout, realtime stock updates
- Notes: vendor notepad synced to cloud
- Reports: daily/weekly revenue and profit charts
- Barcode scanner: ZXing camera scanning for quick product lookup
- AI Insights: GPT-powered business analysis via Supabase Edge Function
- PWA: installable from browser, works fully offline after first visit

---

## 2. Tech Stack

### Frontend Runtime

| Technology | Version | Role |
|---|---|---|
| **Vanilla JavaScript** | ES2020+ | All application logic. No framework, no transpiler, no bundler. Runs directly in the browser. |
| **HTML5** | — | Single `index.html` shell. Entire app served from one file with conditional module loading. |
| **CSS3** | — | `styless.css` (~930 lines). CSS custom properties as design tokens. Dark/light theme via `[data-theme]`. |
| **IndexedDB** | Browser API | Offline sync queue. Raw Promise-wrapped `IDBRequest` calls. No third-party wrapper. |
| **Web Storage** | Browser API | `localStorage` for state persistence across sessions. Schema-validated on every load. |
| **Service Worker** | Browser API | Runtime caching. App shell, images, navigation fallback. No Workbox. |
| **Web Crypto API** | Browser API | `crypto.randomUUID()` for all entity IDs. Cryptographically safe. |
| **Canvas API** | Browser API | Client-side JPEG compression before image upload. Reduces storage costs. |
| **Pointer Events API** | Browser API | Swipe gesture detection on catalog product cards. Works on both touch and mouse. |

### Cloud Services (Supabase)

| Service | Usage |
|---|---|
| **Postgres** | Primary database. Products, sales, notes, categories, profiles, audit logs, share links. |
| **Supabase Auth** | Email/password with PKCE flow. JWT sessions. Token refresh error handling. |
| **Supabase Storage** | Bucket `user_images`. Product photos (compressed JPEG) and vendor avatars. Public CDN URLs. |
| **Supabase Realtime** | Catalog page subscribes to `postgres_changes` on `products` table. Live stock updates. |
| **Row Level Security** | All tables have RLS. Policies enforce `auth.uid() = user_id` for all vendor data. |
| **Edge Functions** | Deno-based serverless. Used for: AI insights (legacy), share link generation (legacy — now replaced by client-side slug). |

### Third-Party Libraries (CDN loaded)

| Library | Source | Version | Role |
|---|---|---|---|
| `@zxing/library` | unpkg.com | 0.21.3 (pinned) | Barcode scanning via device camera. Version pinned to prevent breaking changes. |
| `chart.js` | jsDelivr | latest | Sales/profit charts on Reports panel. |
| `@supabase/supabase-js` | jsDelivr | @2 | Supabase client SDK. |

> **Why CDN?** No build step. No `node_modules` in repo. The app deploys as static files. CDN availability is the only dependency.

### Infrastructure

| Tool | Role |
|---|---|
| **Vercel** | Static hosting with global CDN. Build via `build.sh` which injects credentials. Zero server infrastructure. |
| **GitHub** | Version control. `main` branch auto-deploys to Vercel on push. |
| **Termux (Android)** | Terminal emulator used by the developer for Git operations and deployments from a mobile device. This is the primary deployment tool — no laptop required. |

### Development Tools

| Tool | Role |
|---|---|
| **Claude (Anthropic)** | Primary AI pair programmer for architecture design, bug diagnosis, security review, and feature implementation throughout this project. |
| **Supabase Dashboard** | Table editor, SQL runner, auth management, storage browser, RLS policy management. |
| **Chrome DevTools (Android)** | Console debugging via remote inspection or in-browser console. Primary debugging environment. |

---

## 3. System Architecture

### 3.1 The Module Structure

The application is split into discrete JavaScript files with strict dependency ordering. There is no bundler. Load order is enforced manually via `async=false` on dynamically inserted scripts.

```
index.html
├── styless.css                    — design system, loaded synchronously
├── supabase-config.js             — generated at build time, sets window.__QS_SUPABASE
├── qs-init.js                     — SW registration, beforeinstallprompt handler
│
├── [if ?store= or ?token= in URL]
│   └── catalog.js                 — fully standalone customer storefront
│
└── [admin app, ordered]
    ├── indexeddb_sync.js           — offline sync queue
    ├── share-catalog.js            — WhatsApp share functionality
    ├── appss.js                    — application core
    └── inventory.js                — inventory module
```

**Why this split?** `catalog.js` is a completely standalone module. Loading the full admin stack on a customer's device is wasteful (adds ~300KB) and creates state conflicts. The conditional loader branches at the earliest safe point — after `supabase-config.js` has set `window.__QS_SUPABASE`.

### 3.2 Module Responsibilities

| File | Lines | Responsibility |
|---|---|---|
| `supabase-config.js` | 90 | Generated at build. Sets `window.__QS_SUPABASE = Object.freeze({ client, user: null })`. Never committed to Git. |
| `qs-init.js` | 194 | Service Worker registration. Landing page CTA wiring. `beforeinstallprompt` capture. Conditional script loader. |
| `appss.js` | 3,869 | Admin app core. Auth, state management, cloud sync, notes, reports, settings, dashboard, navigation, toast, modals, sell flow. Exposes `window.__QS_APP` bridge. |
| `inventory.js` | 985 | Inventory module. Barcode scanner, image upload, product add/edit form, inventory list, CSV bulk import. Reads from `window.__QS_APP`. Exposes `window.__QS_INVENTORY`. |
| `indexeddb_sync.js` | 474 | Offline sync queue. IndexedDB `pending_sync` store. Batch upsert/delete to Supabase. Exposes `window.qsdb` (frozen). |
| `share-catalog.js` | 404 | Catalog share. Business name slug generation, profiles upsert, WhatsApp share sheet, phone modal. |
| `catalog.js` | 1,819 | Customer storefront. Store resolution, product grid, swipe images, description, cart, WhatsApp checkout, realtime. Zero dependencies on admin modules. |
| `styless.css` | 929 | Design system. CSS custom properties, dark/light theme, responsive breakpoints. |
| `sw.js` | 142 | Service Worker v4.0. Runtime caching. No precache list. |
| `manifest.json` | — | PWA manifest. Includes `id` field for Chrome 144+. |

### 3.3 The `__QS_APP` Bridge Pattern

`appss.js` wraps everything in an IIFE and closes over all state. Other modules cannot access `appss.js` internals directly. Instead, `appss.js` exposes a frozen interface:

```javascript
window.__QS_APP = Object.freeze({
  getClient,                          // Returns Supabase JS client
  getUser: () => currentUser,         // Always live. NEVER reads from frozen __QS_SUPABASE.
  get currentUser() { return currentUser; }, // Getter for direct property access
  saveState,                          // Persist state to localStorage + Supabase
  getState: () => state,              // Live state reference (not a copy)
  syncCloudData,                      // Full cloud sync cycle
  showConfirm,                        // Confirmation modal (returns Promise<boolean>)
  generateAdvancedInsights,           // AI insights Edge Function call
  toast, errlog, uid, showLoading,
  addActivityLog, compressImage,
  createModalBackdrop, createModalCloseButton,
  renderProducts, renderDashboard, renderChips,
  openModalFor,                       // Opens sell modal for a given product ID
  getEditingProductId: () => editingProductId,
  setEditingProductId: (v) => { editingProductId = v; },
});
```

`inventory.js` reads exclusively from `window.__QS_APP`. It calls back into `appss.js` only via the functions exposed on this bridge. `appss.js` delegates back to inventory via `window.__QS_INVENTORY`:

```javascript
window.__QS_INVENTORY = Object.freeze({
  initAll, renderInventory, showAddForm, hideAddForm,
  clearAddForm, openEditProduct, populateCategoryDropdown,
  stopScanner, startScanner, showCsvImportModal,
});
```

**Why freeze both bridges?** `Object.freeze()` prevents runtime tampering. If a browser extension or injected script tries to replace `window.__QS_APP.toast`, the write silently fails in strict mode. This is runtime integrity protection, not just convention.

### 3.4 State Management

State lives in three layers simultaneously:

```
In-memory (state object)
    ↕ written on every mutation
localStorage (JSON, key: quickshop_stable_v1_{userId})
    ↕ schema-validated on every read
    ↕ synced via IndexedDB queue + direct Supabase calls
Supabase Postgres
```

**The `state` object shape:**
```javascript
{
  products:   [],   // Array of product objects
  sales:      [],   // Array of sale records
  notes:      [],   // Array of note objects
  categories: [],   // Array of category name strings
  logs:       [],   // Audit log entries (last 200)
  changes:    [],   // Legacy field, kept for backward compat
  _avatarUrl: null  // In-memory only, not persisted
}
```

**Schema validator (`validateLoadedState`):** Every field of every product/sale/note is explicitly mapped and sanitised on load from localStorage. This prevents corrupt data, version mismatches, or injected malicious content from reaching the running state. **This function must be updated whenever a new field is added to any entity.**

### 3.5 Offline Sync Flow (IndexedDB Queue)

All mutations to products, sales, and notes go through `window.qsdb`:

```
User action (edit/add/delete)
    → State updated in memory (optimistic UI)
    → localStorage written
    → UI re-renders (instant feedback)
    → window.qsdb.addPendingChange({ type, item }) → IndexedDB
    → syncPendingToSupabase() triggered by:
          - window 'online' event
          - document 'qs:user:auth' event (fired by handleAuthUser)
          - window 'load' event (if session exists)
          - manual Settings → Sync Now button
    → Batch operations sent to Supabase:
          productUpsertRows → single .upsert() call
          productDeleteIds  → single .in().delete() call
          saleInsertRows    → single .upsert() call (ignoreDuplicates)
          saleDeleteIds     → single .in().delete() call
          noteUpsertRows    → single .upsert() call
          noteDeleteIds     → single .in().delete() call
          addStock          → serial (read-modify-write, cannot batch)
    → Successful actions deleted from IndexedDB
```

**Deduplication:** If the same product is edited multiple times offline, multiple `updateProduct` entries queue up. Before sending, they are deduplicated by `id` (last write wins) to prevent the Postgres error: `ON CONFLICT DO UPDATE command cannot affect row a second time`.

### 3.6 Cloud Sync Merge Strategy

`syncCloudData()` runs on login and after pending sync. Merge rules:

| Data Type | Strategy |
|---|---|
| **Products** | Cloud is authoritative for known IDs. Products with pending local changes (`pendingProductIds`) are preserved unchanged. Products deleted from cloud but with pending local changes are kept. |
| **Sales** | Cloud replaces local by merge (union of both, cloud wins on conflict). |
| **Notes** | Cloud replaces known IDs. Local-only notes (not yet synced) are preserved alongside cloud notes. |
| **Categories** | Cloud replaces entirely if non-empty. Falls back to local if cloud returns empty. |
| **Logs** | Cloud replaces entirely (last 200 entries, server ordered). |

### 3.7 Authentication Flow

```
Page load
    → initAuth()
    → waitForSupabaseReady() — polls until window.__QS_SUPABASE.client is set
    → supabase.auth.getSession()
        → if session exists: handleAuthUser(user)
        → if no session: stay on landing/login

supabase.auth.onAuthStateChange fires for:
    INITIAL_SESSION   → if session: handleAuthUser()
    SIGNED_IN         → handleAuthUser()
    USER_UPDATED      → handleAuthUser()
    SIGNED_OUT        → handleAuthLogout()
    TOKEN_REFRESH_ERROR → handleAuthLogout() (forced logout for expired tokens)

handleAuthUser(user):
    1. currentUser = user
    2. setSupabaseUser(user) — attempts write to __QS_SUPABASE.user (may fail if frozen, handled gracefully)
    3. Check !user.email_confirmed_at → show verification notice if unconfirmed
    4. Set localStorage 'qs_session_active' = 'true'
    5. Set localStorage 'qs_last_user_id' = user.id
    6. body.classList.add('mode-app')
    7. loadLocalData(user.id)
    8. syncCloudData(user)
    9. Bootstrap product push (queue any local products not yet in pending queue)
    10. dispatch 'qs:user:auth' event → triggers indexeddb_sync

Login form submit:
    1. signInWithPassword()
    2. Check isConfirmed = email_confirmed_at || confirmed_at
       → if both null: signOut() + show verification notice
       → if either set: proceed (handles Supabase verification ON/OFF)
    3. localStorage 'qs_session_active' = 'true'
    4. body.classList.add('mode-app')
```

> ⚠️ **Inconsistency:** `handleAuthUser` (line 1176) checks only `email_confirmed_at`. The login form checks both `email_confirmed_at` AND `confirmed_at` (the smart check). On token refresh or auth state change events, the old single-field check applies. This should be unified.

---

## 4. Design Decisions

### 4.1 No Framework — Why Vanilla JavaScript?

**Decision:** Build without React, Vue, Angular, or any component framework.

**Reasoning:**
- Zero build step. Deploy by pushing files to GitHub — Vercel serves them directly.
- Developer deploys from Termux on Android. No `npm run build` needed.
- No `node_modules` in the repository. No dependency version conflicts.
- The app is content-heavy but not interaction-heavy. The complexity that frameworks solve (fine-grained reactivity, component reuse at scale) is not present here.
- Full control over exactly what JavaScript runs in the browser.

**Tradeoff:** More verbose DOM manipulation. No component reuse pattern. Shared logic (like `escapeHtml`) must be manually ensured across modules.

### 4.2 Single HTML File with Conditional Loader

**Decision:** One `index.html` serves both the admin app and the customer catalog, branching based on URL parameters.

```javascript
var isCatalog = p.has('store') || p.has('token');
if (isCatalog) {
  addScript('catalog.js', false);
} else {
  addScript('indexeddb_sync.js', true);
  addScript('share-catalog.js', true);
  addScript('appss.js', true);
  addScript('inventory.js', true);
}
```

**Reasoning:** Eliminates a router. Catalog customers never download the admin stack (~300KB). Admin users never execute catalog code. Zero state conflicts between the two runtimes.

**Alternative considered:** Separate HTML files (`catalog.html`, `app.html`). Rejected because it adds complexity to the share URL pattern and requires maintaining two HTML files with shared head content.

### 4.3 IndexedDB as Sync Queue (Not Direct Supabase Calls)

**Decision:** All product/sale/note mutations go to IndexedDB first, then Supabase.

**Reasoning:** True offline-first. Vendor can add 50 products with zero signal. All sync when connection returns. Direct Supabase calls would silently lose data when offline. IndexedDB entries survive page reloads, app closes, phone restarts.

**Alternative considered:** Write to Supabase directly and handle failures with retry logic. Rejected because retry logic without a persistent queue means data loss on page close.

### 4.4 Runtime Caching Service Worker (No Precache List)

**Decision:** Service Worker v4.0 caches nothing on install. All caching happens at first use (runtime).

**Previous approach:** Precache list including all JS files + some CDN URLs. **Why it failed:** `cache.addAll()` in the install handler is atomic — if any single URL returns non-200, the entire SW install aborts. A network hiccup, Vercel cold start, or even a missing file causes a silent failure. The SW never activates, Chrome never fires `beforeinstallprompt`, and the app never qualifies as installable.

**Current approach:** Install event only calls `self.skipWaiting()`. Nothing can fail. The SW installs instantly on first visit. Resources are cached as they're fetched. App is fully offline after the first complete page load.

### 4.5 Slug-Based Catalog URLs

**Decision:** Replace JWT tokens in share URLs with human-readable business name slugs.

**Previous URL:** `quickshopper.vercel.app/?store=wicpvvy...&token=eyJhb...` (100+ chars)  
**Current URL:** `quickshopper.vercel.app/?store=alls-signature&phone=234...` (~55 chars)

**Slugification:** Business name → lowercase → non-alphanumeric replaced with `-` → trimmed → max 40 chars. Collision handling: if another vendor has the same slug, append last 4 chars of user_id (e.g., `alls-signature-a3f9`).

**Slug generation:** Runs client-side when vendor taps Share Catalog. Stored in `profiles.slug` via Supabase upsert. Subsequent shares reuse the stored slug — no regeneration.

**Lookup:** `catalog.js` checks if `?store=` value matches UUID pattern → use directly. If not → query `public_catalog_profiles` view by `slug` column to get `user_id`.

### 4.6 Public Views Instead of Direct Table Access

**Decision:** Catalog reads from `public_catalog_products` and `public_catalog_profiles` views, not tables directly.

**Reasoning:** The anon key with SELECT on the `products` table would expose `cost` (vendor's margin), `created_at`, `updated_at`, and any future private fields. Views explicitly enumerate safe columns. If a new sensitive column is added to `products`, it is invisible to the catalog until explicitly added to the view.

### 4.7 Frozen Global Objects

Three objects are frozen after creation:
- `window.__QS_APP` — admin app bridge
- `window.__QS_INVENTORY` — inventory module bridge  
- `window.qsdb` — IndexedDB sync interface

**Reasoning:** `Object.freeze()` is a defence-in-depth measure. Browser extensions, injected scripts, or console tampering cannot replace functions on these objects. Writes silently fail in strict mode.

> ⚠️ **Critical:** `window.__QS_SUPABASE` is also frozen (set in `supabase-config.js`). This means `__QS_SUPABASE.user` can never be updated after initialization. **All code that needs the current user MUST use `window.__QS_APP.getUser()` or the `currentUser` closure variable.** Reading `__QS_SUPABASE.user` will always return `null` for logged-in users.

---

## 5. UI/UX Decisions

### 5.1 Admin App Layout

- **Single page, bottom navigation:** Home, Inventory, Reports, Notes, Settings. No routing, no URL changes. `setActiveView()` toggles `.panel.active` CSS class.
- **Topbar:** Sticky, `z-index: 200`. Contains title and search input. Search collapses to a 32×32 icon that expands on tap to 168px.
- **Toast notifications:** Fixed position at top (`calc(env(safe-area-inset-top) + 12px)`). Solid dark backgrounds for readability on both light and dark themes. `pointer-events: none` when invisible — critical to prevent ghost tap-blocking over the topbar.
- **Settings panel:** Sticky profile header with avatar, name, online/offline badge. Scrollable body below.

### 5.2 Product Form (Vendor)

- **Modal overlay** `position: fixed` over the app. Closes on backdrop tap or X button.
- **Image upload:** Two square slot buttons (Photo 1, Photo 2) plus an "Add Photos" button that opens the file picker with `multiple` enabled for simultaneous selection. Images upload in the background (non-blocking). Per-slot spinners during upload. Save button blocks if any upload is in progress.
- **"Add Photos" implementation:** Uses the same `invImg` input element with `multiple` attribute toggled on/off — avoids a separate hidden input that Android Chrome unreliably opens from `display: none`.
- **Description textarea:** 500-char limit (`maxlength="500"`). Styled with design tokens to match other inputs (dark background, correct text color). ⚠️ No live character counter yet — this is a known pending item.
- **Category dropdown:** Populated dynamically from `state.categories`. Set **after** `showAddForm()` returns, not before — `showAddForm()` previously called `populateCategoryDropdown()` which rebuilt the `<select>` and reset the selected value.

### 5.3 Customer Catalog Layout

- **2-column grid** on mobile (< 460px), 3-column on wider screens.
- **Sticky header:** Store avatar, name, product count, OPEN NOW pill. Backdrop blur. `z-index: 100`.
- **Store tagline:** Italic strip between search and chips. Only renders if vendor has set a tagline. Uses `textContent` (safe, no XSS).
- **Category chips:** Horizontal scroll. "All" chip always first. Chips built from product data — only categories that have actual products appear.
- **Search:** 180ms debounce. Filters both name and category fields.

### 5.4 Product Cards (Customer Catalog)

**Single image:** Tap opens full-screen lightbox with close button.

**Dual images (swipe strip):**
- `position: relative; overflow: hidden` outer container (same `aspect-ratio: 1/1`)
- Inner `flex` track slides horizontally via `translateX`
- **Pointer events** (not touch events) — works on mobile touch, tablet stylus, desktop mouse
- Vertical scroll detection: if `|dy| > |dx| + 4`, cancel swipe and let page scroll
- Rubber-band resistance at edges (`pct * 0.25`) — prevents overscroll
- Tap (< 30px movement): opens lightbox at current slide index
- Dot indicators overlaid on the image, update on each slide
- "swipe" hint fades in then out on first render via `@keyframes cat-hint-fade`

**Description (current implementation — pending redesign):**
- `DETAILS` toggle button below price. Expands via `max-height` CSS animation.
- Full description text with no truncation.
- ⚠️ **Known layout problem:** The CSS grid uses `align-items: start` per row. When one card expands, its column grows taller, misaligning with the adjacent card. This is the bug described at the end of the current session.

**Planned redesign (agreed, not yet coded):**
- Description truncated to 2 lines (`-webkit-line-clamp: 2`) in the card — fixed card height
- "See more →" link opens a full-screen product detail page (slide-up overlay)
- Detail page: hero swipe strip (top 45%), name/price/stock, full description, qty controls, Add to Cart

### 5.5 Navigation Patterns

- **Admin app:** Bottom tab bar. No browser history. `setActiveView()` shows/hides panels.
- **Catalog:** No navigation stack. Single scrollable page. Lightbox and cart drawer are overlays. Product detail page (planned) will also be an overlay with back button.
- **Landing page → Auth:** CTAs add `body.qs-show-auth` class which reveals the auth form. No page change.

---

## 6. Database Schema

### Tables

```sql
profiles
  id          UUID   PK (FK auth.users.id)
  name        TEXT
  business_name TEXT
  email       TEXT
  avatar_url  TEXT
  tagline     TEXT           CHECK (length <= 120)
  slug        TEXT   UNIQUE  -- human-readable URL slug
  created_at  TIMESTAMPTZ

products
  id          TEXT   PK     -- NOT UUID; format: 20-char alphanumeric
  user_id     UUID   FK (profiles.id)
  name        TEXT
  description TEXT           CHECK (length <= 500)
  price       NUMERIC
  cost        NUMERIC        -- NEVER exposed to anon key
  qty         INTEGER
  category    TEXT
  image_url   TEXT
  image_url2  TEXT
  icon        TEXT           -- emoji fallback when no image
  barcode     TEXT
  created_at  TIMESTAMPTZ
  updated_at  TIMESTAMPTZ

sales
  id          TEXT   PK
  user_id     UUID   FK
  product_id  TEXT   FK (products.id)
  qty         INTEGER
  price       NUMERIC
  cost        NUMERIC
  sale_date   TIMESTAMPTZ

notes
  id          UUID   PK     -- Full UUID with dashes (NOT the 20-char uid())
  user_id     UUID   FK
  title       TEXT
  content     TEXT
  created_at  TIMESTAMPTZ

categories
  id          UUID   PK
  user_id     UUID   FK
  name        TEXT

audit_logs
  id          TEXT   PK
  user_id     UUID   FK
  action      TEXT
  details     TEXT
  performed_by TEXT
  created_at  TIMESTAMPTZ

share_links
  id          UUID   PK
  token       TEXT
  store_id    UUID   FK (profiles.id)
  expires_at  TIMESTAMPTZ
```

> ⚠️ **Important ID Type Note:** Product IDs are `TEXT` (20-char uid()), not UUID. Note IDs are full UUID (noteUid()). Sales IDs are TEXT. This distinction matters for RLS policies and validation regex.

### Public Views

```sql
-- Readable by anon key — powers customer catalog
CREATE VIEW public_catalog_products AS
SELECT id, user_id, name, price, qty, category,
       image_url, image_url2, icon, description
FROM products WHERE qty > 0;

CREATE VIEW public_catalog_profiles AS
SELECT id, name, business_name, avatar_url, tagline, slug
FROM profiles;

GRANT SELECT ON public_catalog_products TO anon;
GRANT SELECT ON public_catalog_profiles TO anon;
```

### RLS Policy Pattern

```sql
-- Vendor data: owner only
CREATE POLICY "owner" ON products
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Catalog reads: public
CREATE POLICY "public read" ON products
  FOR SELECT TO anon USING (true);
```

Applied to: `products`, `sales`, `notes`, `categories`, `audit_logs`, `profiles`, `share_links`.

---

## 7. Security Architecture

### Input Sanitisation

- `escapeHtml(s)` applied to all user-generated content before DOM insertion. Prevents XSS.
- All entity IDs validated against `/^[a-zA-Z0-9_\-]{1,64}$/` before DB queries.
- `safeStr(v, max)`, `safeNum(v)`, `safeId(v)` applied in `validateLoadedState()` and `sanitiseProduct()`/`sanitiseSale()` in indexeddb_sync.
- Image URLs validated to `https://` scheme before setting as `img.src` attribute.
- IndexedDB `VALID_ACTION_TYPES` allowlist: `addProduct`, `updateProduct`, `removeProduct`, `addSale`, `removeSale`, `addStock`, `addNote`, `removeNote`. Unknown types rejected before storage.
- Product image URLs limited to 4096 chars. Description limited to 500 chars. Note content has no explicit DB limit but is sanitised.

### Auth Security

- PKCE flow via Supabase Auth — prevents token interception via MITM.
- `TOKEN_REFRESH_ERROR` forces `handleAuthLogout()` — prevents zombie sessions on mobile where tabs sleep >24h.
- Email verification check adapts to Supabase setting (see login form handler).
- `disableBtn()` on login/signup buttons prevents double-submit race conditions.

### Runtime Integrity

- `window.__QS_APP`, `window.__QS_INVENTORY`, `window.qsdb` all frozen.
- `window.n`, `window.fmt` defined as `writable: false, configurable: false`.
- `window.__QS_SUPABASE` frozen in `supabase-config.js` — prevents client replacement.

### Content Security Policy

Set via `<meta http-equiv="Content-Security-Policy">` in `index.html`:

```
default-src 'self'
script-src  'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in https://world.openfoodfacts.org
img-src     'self' data: blob: https://*.supabase.co https://*.supabase.in
style-src   'self' 'unsafe-inline'
font-src    'self'
media-src   'none'
object-src  'none'
base-uri    'self'
form-action 'self'
frame-src   'none'
worker-src  'self'
```

> `'unsafe-inline'` is required for the inline scripts in `index.html` (landing page, conditional loader, `beforeinstallprompt` handler). This cannot be removed without moving all inline scripts to external files.

### Known Security Constraint

The Supabase anon key is publicly visible in `supabase-config.js`. This is unavoidable for a client-side app. The entire security model depends on Supabase RLS being correctly configured. **If RLS is disabled or misconfigured on any table, any person with the anon key can read all vendor data for all users.** RLS must be verified after any schema change.

---

## 8. Deployment

### How It Works

```bash
# build.sh (runs on Vercel)
cp supabase-config.example.js supabase-config.js
sed -i "s|%%SUPABASE_URL%%|$SUPABASE_URL|g" supabase-config.js
sed -i "s|%%SUPABASE_ANON_KEY%%|$SUPABASE_ANON_KEY|g" supabase-config.js
echo "Build done."
```

Vercel environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.  
Build command: `bash build.sh`  
Output directory: `.` (repo root)

### Deploying from Termux

```bash
cd "/storage/emulated/0/Documents/Quickhopupdate1"
git add .
git commit -m "Update $(date '+%Y-%m-%d %H:%M')"
git push --force https://TOKEN@github.com/moyinksv-ai/QuickShop.git main
```

`--force` is used because GitHub web UI uploads and Termux pushes can diverge. `--force` always makes the local state authoritative. **Do not use both GitHub web UI and Termux simultaneously.**

### Files NOT in Git

- `supabase-config.js` — in `.gitignore`, contains live credentials
- Any `.env` files

---

## 9. Change Log

All changes were made during the development session beginning March 13, 2026. Changes are ordered chronologically.

### Session Origin (March 13)

Initial state: App existed with working basic inventory/sales. The session began due to a `TypeError: Cannot assign to read only property 'user'` crash in `handleAuthUser`. This single bug masked a cascade of four related failures.

---

### Fix: Frozen Object Crash (`appss.js`)

**Problem:** `supabase-config.js` called `Object.freeze(window.__QS_SUPABASE)` before `appss.js` loaded. `handleAuthUser()` tried to write `window.__QS_SUPABASE.user = user` — threw `TypeError` on frozen property in strict mode.

**Fix:** `setSupabaseUser()` helper checks `Object.getOwnPropertyDescriptor` before writing. If frozen, silently skips. `getUser()` changed to return `currentUser` directly (the authoritative in-memory variable), bypassing the frozen object entirely.

**Impact:** This fix resolved four downstream bugs simultaneously (IndexedDB sync, Share Catalog auth, avatar upload auth, getUser null).

---

### Fix: Landing Page Flash (`index.html`)

**Problem:** Logged-in users saw the marketing landing page flash before `mode-app` CSS class was applied.

**Fix:** `#qs-landing { display: none !important }` added to critical inline styles. Visitor visibility restored via `:not(.mode-app):not(.qs-cat-early) #qs-landing:not(.qs-hidden) { display: block !important }`. `INITIAL_SESSION` event handled explicitly in `onAuthStateChange`.

---

### Fix: Sign In/Sign Up Broken (`index.html`)

**Problem:** CSS specificity conflict — visitor rule `body:not(.mode-app):not(.qs-cat-early) #qs-landing` (specificity 0,3,1) overrode `.qs-hidden` (0,1,0), preventing the auth forms from being hidden correctly.

**Fix:** Added `:not(.qs-hidden)` to the visitor rule.

---

### Fix: IndexedDB Sync Never Ran (`indexeddb_sync.js`)

**Problem:** `syncPendingToSupabase()` read `sb.user` which was always `null` (frozen object). Every sync cycle hit "No user — deferred." 11+ pending actions never synced.

**Fix:** User resolution changed to `window.__QS_APP.getUser()` as primary source, with `sb.user` as fallback. Load event check similarly updated.

---

### Feature: Notes Offline Resilience (`indexeddb_sync.js`, `appss.js`)

**Problem:** Notes bypassed IndexedDB entirely, going direct to Supabase. Notes created offline were lost. Deleted notes were "resurrected" on next sync. `syncCloudData` replaced local notes entirely with cloud copy.

**Fix:**
- `addNote`/`removeNote` added to `VALID_ACTION_TYPES` and batch processing
- Notes queued to IndexedDB on save and delete
- `syncCloudData` note merge: cloud replaces known IDs, local-only notes preserved
- Separate `isSaveStateSyncing` flag — prevents `saveState()` from being blocked by concurrent `syncCloudData()`

---

### Fix: Note UUID Format (`appss.js`)

**Problem:** Note IDs used `uid()` — 20-char truncated hex without dashes. Supabase `notes.id` is `UUID` type. Upsert failed with `invalid input syntax for type uuid`.

**Fix:** `noteUid()` function added. Returns full RFC-4122 UUID (`crypto.randomUUID()` unmodified). All new notes use `noteUid()`. Schema validator updated to use `noteUid()` for notes missing an ID.

---

### Fix: Duplicate Product Upsert Crash (`indexeddb_sync.js`)

**Problem:** Same product edited multiple times offline queued duplicate `updateProduct` entries. Postgres: `ON CONFLICT DO UPDATE command cannot affect row a second time`.

**Fix:** Deduplicate `productUpsertRows` and `noteUpsertRows` by ID before sending batch. Last entry wins (most recent change).

---

### Fix: Share Catalog Auth (`share-catalog.js`)

**Problem:** `getCurrentUserId()` checked `window.currentUser` (never set — `currentUser` lives inside `appss.js` IIFE closure). Always returned `null`. "Please log in to share" shown even when logged in.

**Fix:** Checks `window.__QS_APP.getUser()` as primary source.

---

### Feature: Parallel Non-Blocking Image Upload (`inventory.js`)

**Problem:** Sequential image uploads blocked the entire product form. Full-screen loading overlay appeared. Vendor could not fill other fields during upload.

**Fix:** `uploadImageToSlot()` async helper. Each slot uploads independently with per-slot spinner. `isAnyUploadInProgress()` guard on Save button. Form stays fully interactive during upload.

---

### Feature: "Add Photos" Multi-Select (`inventory.js`, `index.html`)

**Problem:** Separate hidden `invImgBoth` input (`display: none`) was unreliable on Android Chrome — OS file picker would not open from `.click()` on hidden inputs.

**Fix:** Reuses existing `invImg` input with `multiple` attribute toggled dynamically. Android already trusted this input. Both files upload in parallel via `Promise.all` when 2 files selected. `multiple` attribute removed after use.

---

### Fix: Category Resets to Default on Edit (`inventory.js`)

**Problem:** `showAddForm()` called `populateCategoryDropdown()` which rebuilt the `<select>` element from scratch, resetting its selected value back to the first option (Drinks). Vendor's category selection was always overwritten.

**Fix:** Removed `populateCategoryDropdown()` from inside `showAddForm()`. Category value set after `showAddForm()` returns in `openEditProduct()`.

---

### Fix: image2 Stripped from All Products (`appss.js`)

**Problem:** `validateLoadedState()` schema validator was missing the `image2` field. Every app reload stripped `image2` from all products in localStorage. Edit form showed only one image. Catalog showed only one image.

**Fix:** `image2: typeof p.image2 === 'string' ? safeStr(p.image2, 4096) : null` added to schema validator.

---

### Fix: Toast Blocking Topbar Taps (`appss.js`)

**Problem:** Toast element had `pointer-events: auto` permanently, including when invisible at `opacity: 0`. An invisible ghost element sat over the topbar and absorbed every tap — including taps on the search input, preventing it from expanding.

**Fix:** Toast created with `pointer-events: none`. Enabled to `auto` during animate-in. Reset to `none` on dismiss (timer and manual X button).

---

### Fix: Service Worker PWA Install Failure (`sw.js`)

**Problem:** SW had precache list including all JS files. `cache.addAll()` is atomic — one failed fetch aborted the entire install. Chrome never fired `beforeinstallprompt`. "This app cannot be installed."

**Fix:** Complete rewrite to runtime caching. Install event only calls `skipWaiting()`. Strategies: navigation=network-first-with-fallback, images=cache-first, app-shell=stale-while-revalidate, Supabase=network-only.

---

### Feature: Store Tagline (`appss.js`, `catalog.js`)

**Addition:** Vendors can set a tagline (max 120 chars) in Settings → Store Profile. Stored in `profiles.tagline`. Rendered as italic strip between search bar and category chips in customer catalog. Only renders if set.

**SQL required:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE profiles ADD CONSTRAINT profiles_tagline_length CHECK (tagline IS NULL OR char_length(tagline) <= 500);
```

---

### Feature: Product Description (`inventory.js`, `catalog.js`, `appss.js`, `indexeddb_sync.js`)

**Addition:** Vendors can add a description (max 500 chars) per product. Stored in `products.description`. Shown in customer catalog with expand/collapse toggle.

**SQL required:**
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL;
ALTER TABLE products ADD CONSTRAINT products_description_length CHECK (description IS NULL OR char_length(description) <= 500);
```

---

### Feature: Slug-Based Catalog URLs (`share-catalog.js`, `catalog.js`)

**Replaced:** Edge function call that returned JWT-based URLs.  
**New:** Client-side slug generation from business name. Stored in `profiles.slug`. Catalog resolves slug → user_id via `public_catalog_profiles` view.

**SQL required:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS profiles_slug_idx ON profiles(slug);
```

---

### Fix: Catalog Slug Resolution Blocked by RLS (`catalog.js`)

**Problem:** Slug lookup queried `profiles` table directly. Anon key blocked by RLS. Catalog showed "unavailable."

**Fix:** Slug lookup queries `public_catalog_profiles` view (anon-readable) with fallback to direct `profiles` query. Supabase errors on the lookup are now properly logged instead of swallowed.

---

### Fix: Login Blocks All Users with Verification Off (`appss.js`)

**Problem:** Login form checked `email_confirmed_at` alone. When Supabase email verification is disabled, this field is `null` for all users → all users blocked.

**Fix:** `const isConfirmed = data.user.email_confirmed_at || data.user.confirmed_at`. Only blocks if both are `null` (verification ON and user genuinely unconfirmed).

---

### Fix: Description Not Showing in Catalog

**Problem:** `public_catalog_products` view was created before `description` column was added to `products`. `SELECT *` on the view returned no `description` field.

**Fix:** View recreated:
```sql
DROP VIEW IF EXISTS public_catalog_products;
CREATE VIEW public_catalog_products AS
SELECT id, user_id, name, price, qty, category, image_url, image_url2, icon, description
FROM products WHERE qty > 0;
GRANT SELECT ON public_catalog_products TO anon;
```

---

## 10. Known Issues & Safe Extension Points

### 10.1 Active Known Issues

| Issue | Location | Severity | Description |
|---|---|---|---|
| **PWA not installable** | `pwa-192.png`, `pwa-512.png` | High | Chrome shows "This app cannot be installed." Root cause: icon files may be missing from repo root. Chrome requires loadable icons. |
| **Auth check inconsistency** | `appss.js` line 1176 | Medium | `handleAuthUser` checks only `email_confirmed_at`. Login form checks both fields. These should be unified. |
| **Description card layout** | `catalog.js` | Medium | Expanding description elongates one card without affecting adjacent card height. Grid alignment breaks. Planned fix: full-screen product detail page. |
| **No character counter on description** | `index.html`, `inventory.js` | Low | Vendor textarea has `maxlength="500"` but no live counter. Vendors discover truncation after publishing. |
| **Category data mismatch** | Supabase `products` | Low | Products synced before category fix may have wrong categories in Supabase. Must be manually re-edited and saved. |

### 10.2 What MUST NOT Be Modified

| Code | Reason |
|---|---|
| `Object.freeze(window.__QS_APP)` | Runtime integrity. Removal allows runtime tampering. |
| `Object.freeze(window.qsdb)` | Same. |
| `const getUser = () => currentUser` | Must return `currentUser` directly. NEVER change to read `__QS_SUPABASE.user` — it is always `null`. |
| `VALID_ACTION_TYPES` allowlist | Security. Unknown action types must be rejected before IndexedDB storage. |
| `validateLoadedState()` | Schema boundary. All fields must be explicitly mapped. Do not remove field checks. |
| `async=false` on dynamically inserted scripts | Load order. `inventory.js` depends on `window.__QS_APP` set by `appss.js`. Changing to async will cause race conditions. |
| `supabase-config.js` in `.gitignore` | Credentials must never be committed. |
| The `noteUid()` function | Notes table `id` is UUID type. Using `uid()` for notes will cause Supabase type errors. |

### 10.3 Safe Extension Points

| Area | What Can Be Added |
|---|---|
| `VALID_ACTION_TYPES` | New action types (e.g., `updateNote`) — must add corresponding validation, sanitisation, and batch execution in `syncPendingToSupabase()`. |
| `validateLoadedState()` | New product/note/sale fields — add to the `.map(p => ({...}))` block. New fields not listed here are stripped on load. |
| `window.__QS_APP` | New methods can be added before `Object.freeze()`. Cannot be modified after freeze. |
| `catalog.js buildCard()` | Safe to add new card elements. Maintain `textContent` for user data (no `innerHTML`). |
| `catalog.js buildShell()` | Safe to add new UI sections. |
| `public_catalog_products` view | Safe to add columns. Must run `DROP VIEW / CREATE VIEW / GRANT SELECT` sequence. |
| `public_catalog_profiles` view | Same as above. |
| CSS custom properties in `styless.css` | New tokens under `:root`. All existing tokens used extensively — do not rename. |
| Settings panel in `appss.js renderSettingsPanel()` | New sections can be added inside `.qs-settings-body`. Wire buttons after the HTML is set (not inside the template literal). |

---

## 11. AI Handoff Context

This section is written specifically for an AI system continuing development on this codebase.

### Last Session State (March 17, 2026)

**Last completed work:** Fixed description not showing in catalog (recreated `public_catalog_products` view). Fixed catalog slug resolution via `public_catalog_profiles` view. Fixed login blocking all users when email verification is off.

**Last described bug (open):** The product description expands inside the catalog card, causing grid misalignment. The card with description grows tall; the adjacent card does not. The screenshot shows ASAD by Lattafa's card elongated with the full description visible, while ASAD Lattafa + Intense Cocktail sits at normal height beside it.

**Agreed plan (not yet coded):**

1. **Description truncation in card:** Use `-webkit-line-clamp: 2` to show max 2 lines of description in the card. Fixed card height. Add "See more →" text link below truncation if description exists.

2. **Full-screen product detail page:** Slide-up overlay (`position: fixed, inset: 0, z-index: 400`). Triggered by tapping "See more" or the card itself (optional). Structure:
   - Back button top-left: `← Back to store`
   - Hero: swipe strip (same mechanics as card) filling ~45% of screen height
   - Product name, category label, price, stock badge
   - Full description (no truncation, comfortable line height)
   - Quantity controls: `−` `[qty]` `+` with stock cap
   - Add to Cart / In Cart button
   - Cart state syncs with main grid (same `cart` Map)

3. **Live character counter on vendor form:** Below `#invDesc` textarea. Updates on `input` event. Format: `"47 / 300"`. Amber at 260+, red at 290+.

4. **Description character limit change:** Current limit is 500 in both `maxlength` attribute and DB constraint. Agreed limit for redesign is 300 chars. Update `maxlength="300"` in `index.html`, `safeStr(p.description, 300)` in `indexeddb_sync.js` sanitiser and upsert row, and `safeStr(p.description, 300)` in `appss.js` schema validator.

### Files to Modify for Next Feature

| File | Change Needed |
|---|---|
| `catalog.js` | 1. `buildCard()`: add truncated description with "See more" trigger. 2. Add product detail overlay DOM builder. 3. Add detail overlay open/close handlers. 4. Add CSS for detail overlay, truncation, see-more link. |
| `inventory.js` | Add character counter below `invDesc` textarea (wired in `initAddProductHandler` or as standalone init). |
| `index.html` | Change `maxlength="500"` to `maxlength="300"` on `#invDesc`. |
| `indexeddb_sync.js` | Change `safeStr(p.description, 500)` to `safeStr(p.description, 300)` in both sanitiser and upsert row. |
| `appss.js` | Change `safeStr(p.description, 500)` to `safeStr(p.description, 300)` in schema validator. Also unify auth check: `handleAuthUser` at line 1176 should use `isConfirmed = user.email_confirmed_at \|\| user.confirmed_at`. |

### Critical Context for Any AI Continuing This Work

1. **`__QS_SUPABASE.user` is always `null`.** Do not read it anywhere. Use `window.__QS_APP.getUser()` or `currentUser` (in `appss.js` closure).

2. **`uid()` is for products/sales only.** Notes require `noteUid()` — full UUID with dashes. The `notes` table `id` column is `UUID` type in Postgres.

3. **DOM manipulation uses `textContent`, not `innerHTML`, for all user data.** Do not change this. XSS prevention.

4. **`catalog.js` is fully standalone.** It cannot import from or call any admin module. If catalog.js needs shared logic, it must be self-contained.

5. **Schema validator strips unlisted fields.** Any new product/note/sale field MUST be added to `validateLoadedState()` in `appss.js` or it will be silently removed on every app load.

6. **IndexedDB action types must be added to `VALID_ACTION_TYPES`.** New sync operations that bypass this allowlist will be rejected before storage.

7. **Image uploads use per-slot state (`_uploadInProgress`), not a global flag.** Both slots upload in parallel. The Save button checks `isAnyUploadInProgress()` before proceeding.

8. **Category must be set after `showAddForm()`** in `openEditProduct()`. `showAddForm()` no longer calls `populateCategoryDropdown()`. If it ever does again, the category value will reset.

9. **The `beforeinstallprompt` handler is inline in `index.html`** (inside the conditional loader script), not in `qs-init.js`. It captures and saves the event to `window.__QS_INSTALL_PROMPT`. Do not move this to `qs-init.js` — the event fires before external scripts load.

10. **Public views must be explicitly recreated (not `CREATE OR REPLACE`) when adding columns.** Postgres does not allow `CREATE OR REPLACE` to add new columns to a view. Use `DROP VIEW IF EXISTS / CREATE VIEW / GRANT SELECT`.

---

*End of Documentation*

*This document was generated by Claude (Anthropic) on March 17, 2026 by reading the complete development session transcript, all source files, and all comments in the codebase.*
