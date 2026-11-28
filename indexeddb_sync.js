/* indexeddb_sync.js — Offline-first queueing and sync logic for Supabase
 *
 * SECURITY HARDENING
 * ─────────────────────────────────────────────────────────────────────────
 *  · VALID_ACTION_TYPES allowlist: unknown operations rejected before storage
 *  · validateAction(): structural check on every pending change before queuing
 *  · sanitiseProduct() / sanitiseSale(): numeric fields clamped, strings
 *    length-limited before reaching Supabase — prevents NaN, Infinity,
 *    negative prices, oversized payloads
 *  · window.qsdb frozen after assembly: external scripts cannot replace fns
 *  · Production log calls suppressed via IS_PROD flag
 *
 * BATCHING (avoids per-item HTTP round trips on reconnect)
 * ─────────────────────────────────────────────────────────────────────────
 *  · addProduct + updateProduct  → single upsert array   (1 HTTP call)
 *  · removeProduct               → single .in() delete   (1 HTTP call)
 *  · addSale                     → single upsert array   (1 HTTP call)
 *  · removeSale                  → single .in() delete   (1 HTTP call)
 *  · addStock                    → individual (read-modify-write, must stay serial)
 *  If a batch fails the entire group stays in queue for retry on next sync.
 *  Partial success within a batch is impossible — all-or-nothing per group.
 *
 * isSyncing GUARD
 * ─────────────────────────────────────────────────────────────────────────
 *  · Module-level flag prevents concurrent sync runs.
 *  · Multiple triggers (online event, auth event, manual Sync Now, page load)
 *    will coalesce: the second call returns immediately, queues no work.
 */

(function () {
  'use strict';

  var DB_NAME    = 'quickshop_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'pending_sync';

  var VALID_ACTION_TYPES = Object.freeze([
    'addProduct', 'updateProduct', 'removeProduct',
    'addSale', 'removeSale', 'addStock',
    'addNote', 'updateNote', 'removeNote'
  ]);

  var IS_PROD = (
    window.location.hostname !== 'localhost' &&
    !window.location.hostname.startsWith('127.') &&
    !window.location.hostname.startsWith('192.168.')
  );
  var log  = IS_PROD ? function () {} : function () {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['[qsdb]'].concat(args));
  };
  var warn = function () {
    var args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, ['[qsdb]'].concat(args));
  };

  // ── Concurrency guard ────────────────────────────────────────────────
  var isSyncing = false;
  // Coalesce lifecycle/queue sync triggers that arrive within the same
  // short window. The existing isSyncing guard only prevents overlap; it
  // does not prevent a second trigger from starting immediately after the
  // first run completes.
  var syncScheduleTimer = null;
  var SYNC_SCHEDULE_DELAY_MS = 750;

  function schedulePendingSync() {
    if (!navigator.onLine) return;
    if (syncScheduleTimer) clearTimeout(syncScheduleTimer);
    syncScheduleTimer = setTimeout(function () {
      syncScheduleTimer = null;
      syncPendingToSupabase();
    }, SYNC_SCHEDULE_DELAY_MS);
  }

  // ── IndexedDB ────────────────────────────────────────────────────────
  var dbPromise = null;

  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        dbPromise = null; // allow retry if environment gains IndexedDB support
        return reject(new Error('IndexedDB not supported'));
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = function (ev) {
        console.error('[qsdb] IndexedDB open error:', ev.target.error);
        dbPromise = null; // FIXED: clear cached rejected promise so next call retries
        reject(ev.target.error);
      };
      request.onsuccess = function (ev) { resolve(ev.target.result); };
      request.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
    return dbPromise;
  }

  // ── Supabase readiness ───────────────────────────────────────────────
  function waitForSupabaseReady(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.__QS_SUPABASE && window.__QS_SUPABASE.client)
        return resolve(window.__QS_SUPABASE);
      var waited = 0;
      var iv = setInterval(function () {
        if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) {
          clearInterval(iv); return resolve(window.__QS_SUPABASE);
        }
        waited += 100;
        if (waited >= (timeoutMs || 3000)) {
          clearInterval(iv);
          warn('Supabase did not initialise within timeout.');
          return resolve(window.__QS_SUPABASE || null);
        }
      }, 100);
    });
  }

  // ── Validation ───────────────────────────────────────────────────────
  function validateAction(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object';
    if (!VALID_ACTION_TYPES.includes(action.type))
      return 'Unknown action type: ' + String(action.type).slice(0, 50);
    if (!action.item || typeof action.item !== 'object')
      return 'Action must have an item object';
    var item = action.item;
    if (['addProduct','updateProduct','removeProduct','addStock'].includes(action.type)) {
      var id = item.id || item.productId;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_\-]{1,64}$/.test(id))
        return 'Item has invalid or missing id';
    }
    if (['addSale','removeSale'].includes(action.type)) {
      if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_\-]{1,64}$/.test(item.id))
        return 'Sale item has invalid or missing id';
    }
    if (['addNote','updateNote','removeNote'].includes(action.type)) {
      if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 64)
        return 'Note item has invalid or missing id';
    }
    return null;
  }

  // ── Sanitisers ───────────────────────────────────────────────────────
  function sanitiseProduct(p) {
    function safeNum(v)      { var n = Number(v); return (isFinite(n) && n >= 0) ? n : 0; }
    function safeStr(v, max) { return (typeof v === 'string' ? v : String(v || '')).slice(0, max); }
    return {
      id:          safeStr(p.id, 64),
      name:        safeStr((p.name || '').trim() || 'Unnamed', 200),
      description: p.description != null ? safeStr(p.description, 500) : null,
      barcode:     p.barcode  != null ? safeStr(p.barcode,  64)   : null,
      price:     safeNum(p.price),
      cost:      safeNum(p.cost),
      qty:       Math.max(0, Math.floor(safeNum(p.qty))),
      category:  safeStr(p.category || 'Others', 50),
      image:     p.image    != null ? safeStr(p.image,  4096)   : null,
      image2:    p.image2   != null ? safeStr(p.image2, 4096)   : null,
      icon:      p.icon     != null ? safeStr(p.icon,   10)     : null,
      canonicalId: (typeof p.canonicalId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.canonicalId)) ? p.canonicalId : null,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now()
    };
  }

  function sanitiseSale(s) {
    function safeNum(v)      { var n = Number(v); return (isFinite(n) && n >= 0) ? n : 0; }
    function safeStr(v, max) { return (typeof v === 'string' ? v : String(v || '')).slice(0, max); }
    return {
      id:        safeStr(s.id, 64),
      productId: safeStr(s.productId || '', 64),
      qty:       Math.max(1, Math.floor(safeNum(s.qty))),
      price:     safeNum(s.price),
      cost:      safeNum(s.cost),
      ts:        typeof s.ts === 'number' ? s.ts : Date.now()
    };
  }

  function getQueueOwnerId() {
    try {
      var app = window.__QS_APP;
      var user = app && typeof app.getUser === 'function' ? app.getUser() : null;
      if (user && user.id) return String(user.id);
    } catch (_) {}
    try {
      var lastUserId = localStorage.getItem('qs_last_user_id');
      if (lastUserId) return String(lastUserId);
    } catch (_) {}
    try {
      var cached = JSON.parse(localStorage.getItem('qs_user_cache') || 'null');
      if (cached && cached.id) return String(cached.id);
    } catch (_) {}
    return null;
  }

  // Old queue rows have no owner. Claim non-destructive actions only when their
  // entity is present in this account's local snapshot. Delete actions use a
  // separate user-scoped RLS ownership query before they may be claimed.
  function legacyActionMatchesCurrentState(action, localState) {
    if (!action || !action.item || !localState) return false;
    var item = action.item;
    function contains(rows, id) {
      return Array.isArray(rows) && id != null &&
        rows.some(function (row) { return row && String(row.id) === String(id); });
    }
    switch (action.type) {
      case 'addProduct':
      case 'updateProduct':
        return contains(localState.products, item.id);
      case 'addStock':
        return contains(localState.products, item.productId);
      case 'addSale':
        return contains(localState.sales, item.id);
      case 'addNote':
      case 'updateNote':
        return contains(localState.notes, item.id);
      default:
        return false;
    }
  }

  async function claimLegacyDeleteActions(legacyActions, supabase, userId) {
    var groups = [
      { type: 'removeProduct', table: 'products' },
      { type: 'removeSale', table: 'sales' },
      { type: 'removeNote', table: 'notes' }
    ];
    var claimed = [];
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var candidates = legacyActions.filter(function (action) {
        return action && !action.userId && action.type === group.type &&
          action.item && action.item.id != null;
      });
      if (!candidates.length) continue;
      var ids = Array.from(new Set(candidates.map(function (action) {
        return String(action.item.id);
      })));
      try {
        // RLS + explicit user_id filter prove ownership without exposing another
        // vendor's row. Only existing rows owned by this user may be claimed.
        var ownedResult = await supabase.from(group.table).select('id')
          .eq('user_id', userId).in('id', ids);
        if (ownedResult.error) {
          warn('Legacy ' + group.type + ' ownership check failed:', ownedResult.error);
          continue;
        }
        var ownedIds = new Set((ownedResult.data || []).map(function (row) {
          return String(row.id);
        }));
        for (var ci = 0; ci < candidates.length; ci++) {
          var candidate = candidates[ci];
          if (!ownedIds.has(String(candidate.item.id))) continue;
          try {
            if (await window.qsdb.claimPendingForUser(candidate.id, userId)) {
              candidate.userId = userId;
              claimed.push(candidate);
            }
          } catch (claimError) {
            warn('Could not assign legacy delete action id=' + candidate.id + ':', claimError);
          }
        }
      } catch (ownershipError) {
        warn('Legacy ' + group.type + ' ownership check threw:', ownershipError);
      }
    }
    return claimed;
  }

  // ── Public API ───────────────────────────────────────────────────────
  var qsdb = {

    addPendingChange: async function (action) {
      var err = validateAction(action);
      if (err) { warn('addPendingChange rejected:', err); return null; }
      // Bind every new offline action to the account that created it. The queue
      // survives sign-out, but another vendor must never inherit its writes.
      var storedAction = Object.assign({}, action);
      var ownerId = getQueueOwnerId();
      if (ownerId) storedAction.userId = ownerId;
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.add(storedAction);
        req.onsuccess = function () {
          // If a vendor edits while a push is already running, the active batch
          // may have taken its snapshot before this row existed. Request one more
          // pass after that batch settles so the new action is not stranded.
          if (isSyncing) syncAgainRequested = true;
          resolve(req.result);
        };
        req.onerror   = function (ev) {
          console.error('[qsdb] addPendingChange failed:', ev.target.error);
          reject(ev.target.error);
        };
        tx.oncomplete = function () {
          if (navigator.onLine) schedulePendingSync();
        };
      });
    },

    getAllPending: async function (userId) {
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          resolve(userId ? rows.filter(function (action) { return action && action.userId === userId; }) : rows);
        };
        req.onerror   = function (ev) {
          console.error('[qsdb] getAllPending failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    },

    claimPendingForUser: async function (id, userId) {
      if (!userId) return false;
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(id);
        req.onsuccess = function () {
          var action = req.result;
          if (!action || action.userId) { resolve(false); return; }
          action.userId = userId;
          var put = store.put(action);
          put.onsuccess = function () { resolve(true); };
          put.onerror = function (ev) { reject(ev.target.error); };
        };
        req.onerror = function (ev) { reject(ev.target.error); };
      });
    },

    clearPending: async function (id) {
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror   = function (ev) {
          console.error('[qsdb] clearPending failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    }

  };

  // Coalesce manual and automatic callers onto the same in-flight push. A caller
  // must never interpret "another sync is running" as a successful upload.
  var syncInFlightPromise = null;
  var syncAgainRequested = false;

  async function syncPendingToSupabase() {
    if (syncInFlightPromise) {
      log('Sync already running — awaiting the active result.');
      return syncInFlightPromise;
    }
    syncInFlightPromise = (async function () {
      var result;
      do {
        syncAgainRequested = false;
        result = await syncPendingToSupabaseInternal();
      } while (syncAgainRequested && navigator.onLine);
      return result;
    })();
    try {
      return await syncInFlightPromise;
    } finally {
      syncInFlightPromise = null;
      syncAgainRequested = false;
    }
  }

  // ── syncPendingToSupabase (BATCHED) ──────────────────────────────────
  async function syncPendingToSupabaseInternal() {

    if (isSyncing) { log('Sync in progress — refusing a duplicate push.'); return { ok: false, skipped: true, reason: 'already-syncing' }; }
    if (!navigator.onLine) { log('Offline — push not completed; changes remain queued.'); return { ok: false, skipped: true, reason: 'offline', failedBatches: ['offline'] }; }

    isSyncing = true;
    log('Sync started.');

    // Callers (btnSyncNow, syncCloudData) need to know whether this actually
    // succeeded instead of assuming it did — every failure below is recorded
    // here instead of only console-logged, and reported in the return value.
    var failedBatches = [];
    var fatalError = null;

    try {
      var sb = await waitForSupabaseReady(3000);
      if (!sb || !sb.client) { warn('Supabase not ready — deferred.'); isSyncing = false; return { ok: false, skipped: true, reason: 'not-ready' }; }
      // __QS_SUPABASE is frozen so sb.user is always null. Use the authoritative
      // app identity before reading the queue so actions are scoped to this vendor.
      var user = (window.__QS_APP && typeof window.__QS_APP.getUser === 'function')
        ? window.__QS_APP.getUser()
        : sb.user;
      if (!user || !user.id) { warn('No user — deferred.'); isSyncing = false; return { ok: false, skipped: true, reason: 'no-user' }; }
      var userId = user.id;
      var supabase = sb.client;
      var allPending = await window.qsdb.getAllPending();
      var pending = (allPending || []).filter(function (action) {
        return action && action.userId === userId;
      });

      // Safely migrate legacy rows only when their entity is present in the
      // current account's local snapshot. Never send unowned rows blindly.
      var legacyPending = (allPending || []).filter(function (action) {
        return action && !action.userId;
      });
      var localState = null;
      try {
        localState = window.__QS_APP && typeof window.__QS_APP.getState === 'function'
          ? window.__QS_APP.getState()
          : null;
      } catch (_) {}
      var claimedLegacy = [];
      for (var li = 0; li < legacyPending.length; li++) {
        var legacyAction = legacyPending[li];
        if (!legacyActionMatchesCurrentState(legacyAction, localState)) continue;
        try {
          if (await window.qsdb.claimPendingForUser(legacyAction.id, userId)) {
            legacyAction.userId = userId;
            claimedLegacy.push(legacyAction);
          }
        } catch (claimError) {
          warn('Could not assign legacy pending action id=' + legacyAction.id + ':', claimError);
        }
      }
      // Deleted entities are absent from localState. Claim their old queue rows
      // only after a user-scoped RLS query proves the cloud row belongs to userId.
      var claimedLegacyDeletes = await claimLegacyDeleteActions(legacyPending, supabase, userId);
      claimedLegacy = claimedLegacy.concat(claimedLegacyDeletes);
      pending = pending.concat(claimedLegacy);
      var unassignedPending = legacyPending.length - claimedLegacy.length;
      if (!pending.length) {
        if (unassignedPending > 0) {
          failedBatches.push('unassigned-pending');
          isSyncing = false;
          return { ok: false, skipped: true, reason: 'unassigned-pending',
            failedBatches: failedBatches, unassignedPending: unassignedPending };
        }
        log('Nothing pending for this account. Other vendors\' queued actions are untouched.');
        isSyncing = false;
        return { ok: true, skipped: true, reason: 'nothing-pending' };
      }
      log('Pending actions for current account:', pending.length, '/ Unassigned legacy:', unassignedPending);

      // ── Group by type ──────────────────────────────────────────────
      var productUpsertRows   = []; var productUpsertActIds = [];
      var productDeleteIds    = []; var productDeleteActIds = [];
      var saleInsertRows      = []; var saleInsertActIds    = [];
      var saleDeleteIds       = []; var saleDeleteActIds    = [];
      var noteUpsertRows      = []; var noteUpsertActIds    = [];
      var noteDeleteIds       = []; var noteDeleteActIds    = [];
      var stockSerial         = [];
      var invalidActIds       = [];

      pending.forEach(function (act) {
        var err = validateAction(act);
        if (err) { warn('Dropping invalid action id=' + act.id + ':', err); invalidActIds.push(act.id); return; }

        switch (act.type) {
          case 'addProduct':
          case 'updateProduct': {
            var p = sanitiseProduct(act.item);
            productUpsertRows.push({
              id: p.id, user_id: userId,
              name: p.name, barcode: p.barcode || null,
              description: p.description || null,
              price: p.price, cost: p.cost, qty: p.qty,
              category: p.category,
              image_url:  p.image  || null,
              image_url2: p.image2 || null,
              icon: p.icon || null,
              canonical_id: p.canonicalId || null,
              created_at: new Date(p.createdAt).toISOString(),
              updated_at: new Date(p.updatedAt || p.createdAt).toISOString()
            });
            productUpsertActIds.push(act.id);
            break;
          }
          case 'removeProduct': {
            productDeleteIds.push(act.item.id);
            productDeleteActIds.push(act.id);
            break;
          }
          case 'addSale': {
            var s = sanitiseSale(act.item);
            saleInsertRows.push({
              id: s.id, user_id: userId, product_id: s.productId,
              qty: s.qty, price: s.price, cost: s.cost,
              sale_date: new Date(s.ts).toISOString(),
              product_name: s.productName || null,
              barcode: s.barcode || null,
              category: s.category || null,
              payment_method: s.paymentMethod || null
            });
            saleInsertActIds.push(act.id);
            break;
          }
          case 'removeSale': {
            saleDeleteIds.push(act.item.id);
            saleDeleteActIds.push(act.id);
            break;
          }
          case 'addNote':
          case 'updateNote': {
            var n = act.item;
            noteUpsertRows.push({
              id:         String(n.id || '').slice(0, 64),
              user_id:    userId,
              title:      n.title ? String(n.title).slice(0, 200) : null,
              content:    String(n.content || '').slice(0, 10000),
              created_at: n.ts ? new Date(n.ts).toISOString() : new Date().toISOString()
            });
            noteUpsertActIds.push(act.id);
            break;
          }
          case 'removeNote': {
            noteDeleteIds.push(String(act.item.id).slice(0, 64));
            noteDeleteActIds.push(act.id);
            break;
          }
          case 'addStock': {
            var addProductId = String(act.item.productId || '').slice(0, 64);
            if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(addProductId)) {
              warn('addStock: invalid productId, skipping action id=' + act.id);
              invalidActIds.push(act.id);
              break;
            }
            stockSerial.push(act);
            break;
          }
        }
      });

      // Drop invalid actions from queue immediately
      for (var ii = 0; ii < invalidActIds.length; ii++) {
        try { await window.qsdb.clearPending(invalidActIds[ii]); } catch (_) {}
      }

      var doneActIds = [];
      var productSupersededActIds = [];
      var noteSupersededActIds = [];

      // ── Product upserts ──────────────────────────────────────────
      if (productUpsertRows.length > 0) {
        // Deduplicate by id — if the same product was queued multiple times,
        // Postgres throws "cannot affect row a second time" on batch upsert.
        // Keep the last entry for each id (most recent change wins).
        var seenProductIds = {};
        for (var pi = productUpsertRows.length - 1; pi >= 0; pi--) {
          if (seenProductIds[productUpsertRows[pi].id]) {
            productSupersededActIds.push(productUpsertActIds[pi]);
            productUpsertRows.splice(pi, 1);
            productUpsertActIds.splice(pi, 1);
          } else {
            seenProductIds[productUpsertRows[pi].id] = true;
          }
        }
        log('Product upsert batch:', productUpsertRows.length);
        try {
          // One DB transaction now owns both product truth and its marketplace
          // mapping. A successful sync can no longer leave one side updated
          // while the other side silently fails.
          var r1 = await supabase.rpc('qs_upsert_products_and_listings_v2', { rows: productUpsertRows });
          if (r1.error) { console.error('[qsdb] Product upsert failed:', r1.error); failedBatches.push('products'); }
          else {
            doneActIds = doneActIds.concat(productUpsertActIds, productSupersededActIds);
            log('Product + marketplace upsert OK.');
          }
        } catch (e) { console.error('[qsdb] Product upsert threw:', e); failedBatches.push('products'); }
      }

      // ── Product deletes ──────────────────────────────────────────
      if (productDeleteIds.length > 0) {
        log('Product delete batch:', productDeleteIds.length);
        try {
          var r2 = await supabase.rpc('qs_delete_products_v2', { product_ids: productDeleteIds });
          if (r2.error) { console.error('[qsdb] Product delete failed:', r2.error); failedBatches.push('product-deletes'); }
          else {
            doneActIds = doneActIds.concat(productDeleteActIds);
            log('Product + marketplace delete OK.');
          }
        } catch (e) { console.error('[qsdb] Product delete threw:', e); failedBatches.push('product-deletes'); }
      }

      // ── Sale inserts (upsert so retries are idempotent) ──────────
      if (saleInsertRows.length > 0) {
        log('Sale insert batch:', saleInsertRows.length);
        try {
          var r3 = await supabase.from('sales')
            .upsert(saleInsertRows, { onConflict: 'id', ignoreDuplicates: true });
          if (r3.error) { console.error('[qsdb] Sale insert failed:', r3.error); failedBatches.push('sales'); }
          else { doneActIds = doneActIds.concat(saleInsertActIds); log('Sale insert OK.'); }
        } catch (e) { console.error('[qsdb] Sale insert threw:', e); failedBatches.push('sales'); }
      }

      // ── Sale deletes ─────────────────────────────────────────────
      if (saleDeleteIds.length > 0) {
        log('Sale delete batch:', saleDeleteIds.length);
        try {
          var r4 = await supabase.from('sales').delete()
            .in('id', saleDeleteIds).eq('user_id', userId);
          if (r4.error) { console.error('[qsdb] Sale delete failed:', r4.error); failedBatches.push('sale-deletes'); }
          else { doneActIds = doneActIds.concat(saleDeleteActIds); log('Sale delete OK.'); }
        } catch (e) { console.error('[qsdb] Sale delete threw:', e); failedBatches.push('sale-deletes'); }
      }

      // ── Note upserts ─────────────────────────────────────────────
      if (noteUpsertRows.length > 0) {
        // Deduplicate by id — same reason as products above
        var seenNoteIds = {};
        for (var ni = noteUpsertRows.length - 1; ni >= 0; ni--) {
          if (seenNoteIds[noteUpsertRows[ni].id]) {
            noteSupersededActIds.push(noteUpsertActIds[ni]);
            noteUpsertRows.splice(ni, 1);
            noteUpsertActIds.splice(ni, 1);
          } else {
            seenNoteIds[noteUpsertRows[ni].id] = true;
          }
        }
        log('Note upsert batch:', noteUpsertRows.length);
        try {
          var rn1 = await supabase.from('notes')
            .upsert(noteUpsertRows, { onConflict: 'id', ignoreDuplicates: false });
          if (rn1.error) { console.error('[qsdb] Note upsert failed:', rn1.error); failedBatches.push('notes'); }
          else { doneActIds = doneActIds.concat(noteUpsertActIds, noteSupersededActIds); log('Note upsert OK.'); }
        } catch (e) { console.error('[qsdb] Note upsert threw:', e); failedBatches.push('notes'); }
      }

      // ── Note deletes ──────────────────────────────────────────────
      if (noteDeleteIds.length > 0) {
        log('Note delete batch:', noteDeleteIds.length);
        try {
          var rn2 = await supabase.from('notes').delete()
            .in('id', noteDeleteIds).eq('user_id', userId);
          if (rn2.error) { console.error('[qsdb] Note delete failed:', rn2.error); failedBatches.push('note-deletes'); }
          else { doneActIds = doneActIds.concat(noteDeleteActIds); log('Note delete OK.'); }
        } catch (e) { console.error('[qsdb] Note delete threw:', e); failedBatches.push('note-deletes'); }
      }

      // ── addStock: serial with optimistic locking ─────────────────
      // A plain read-modify-write is a race — two devices or two tabs can
      // read the same qty, both increment, and one increment is silently lost.
      //
      // The UPDATE is guarded with .eq('qty', currentQty) so it only affects
      // a row if qty has not changed since we read it. When another writer
      // changes qty between our read and write, Supabase updates 0 rows and
      // returns error=null (Supabase v2 does not expose rowsAffected directly).
      //
      // FIX: after a null-error update we re-fetch qty and compare it to the
      // newQty we intended to write. If they match, the update landed. If they
      // differ, a concurrent writer changed qty under us — treat as a lock-miss
      // and retry. This is the only reliable way to detect a zero-row update
      // in Supabase v2 without enabling Prefer:return=representation (which
      // would double the response payload on every stock update).
      for (var si = 0; si < stockSerial.length; si++) {
        var act = stockSerial[si];
        var stockOk = false;
        for (var attempt = 0; attempt < 3; attempt++) {
          try {
            var productId = String(act.item.productId || '').slice(0, 64);
            var addQty    = Math.max(1, Math.floor(Number(act.item.qty) || 1));

            // Step 1: read current qty
            var fetchRes = await supabase.from('products').select('qty')
              .eq('id', productId).eq('user_id', userId).single();
            if (fetchRes.error) throw fetchRes.error;

            var currentQty = Number(fetchRes.data.qty) || 0;
            var newQty     = Math.max(0, currentQty + addQty);

            // Step 2: conditional update — only applies if qty still matches
            var updRes = await supabase.from('products')
              .update({ qty: newQty, updated_at: new Date().toISOString() })
              .eq('id', productId).eq('user_id', userId).eq('qty', currentQty);
            if (updRes.error) throw updRes.error;

            // Step 3: verify the update actually landed by re-reading qty.
            // If qty equals newQty, our write won. If it differs, a concurrent
            // writer changed it between our read and write (lock-miss) — retry.
            var verifyRes = await supabase.from('products').select('qty')
              .eq('id', productId).eq('user_id', userId).single();
            if (verifyRes.error) throw verifyRes.error;

            var confirmedQty = Number(verifyRes.data.qty);
            if (confirmedQty !== newQty) {
              warn('[qsdb] addStock lock-miss on attempt ' + (attempt + 1) +
                   ' for ' + productId +
                   ' (expected ' + newQty + ', got ' + confirmedQty + ') — retrying.');
              continue;
            }

            stockOk = true;
            doneActIds.push(act.id);
            log('addStock OK (attempt ' + (attempt + 1) + '):', productId);
            break;

          } catch (e) {
            if (attempt === 2) {
              console.error('[qsdb] addStock failed after 3 attempts for action', act.id, e);
            } else {
              warn('[qsdb] addStock attempt ' + (attempt + 1) + ' failed, retrying:', e.message || e);
            }
          }
        }
        if (!stockOk) {
          warn('[qsdb] addStock action id=' + act.id + ' left in queue for next sync.');
          if (failedBatches.indexOf('stock-adjustments') === -1) failedBatches.push('stock-adjustments');
        }
      }

      // ── Mark done ────────────────────────────────────────────────
      for (var di = 0; di < doneActIds.length; di++) {
        try { await window.qsdb.clearPending(doneActIds[di]); } catch (_) {}
      }

      var deferred = pending.length - invalidActIds.length - doneActIds.length;
      if (unassignedPending > 0 && failedBatches.indexOf('unassigned-pending') === -1) {
        failedBatches.push('unassigned-pending');
      }
      log('Sync done. Done:', doneActIds.length, '/ Total:', pending.length, '/ Deferred:', deferred,
          '/ Unassigned legacy:', unassignedPending);

      if (doneActIds.length > 0) document.dispatchEvent(new Event('qs:data:synced'));

    } catch (e) {
      warn('syncPendingToSupabase error:', e);
      fatalError = e;
    }
    // FIXED: isSyncing reset happens here — after the try/catch — so it fires
    // on every code path: normal completion, thrown exception, and the early
    // returns above (which set isSyncing = false then return before this line).
    isSyncing = false;

    return {
      ok: !fatalError && failedBatches.length === 0,
      synced: (typeof doneActIds !== 'undefined' && doneActIds) ? doneActIds.length : 0,
      total: (typeof pending !== 'undefined' && pending) ? pending.length : 0,
      failedBatches: failedBatches,
      unassignedPending: unassignedPending,
      fatalError: fatalError ? (fatalError.message || String(fatalError)) : null
    };
  }

  qsdb.syncPendingToSupabase = syncPendingToSupabase;
  window.qsdb = Object.freeze(qsdb);

  // ── Sync triggers ────────────────────────────────────────────────────
  window.addEventListener('online', function () {
    log('Network restored — scheduling sync.'); schedulePendingSync();
  });
  document.addEventListener('qs:user:auth', function () { schedulePendingSync(); });
  window.addEventListener('pageshow', function () {
    if (navigator.onLine) schedulePendingSync();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.onLine) schedulePendingSync();
  });
  // Only attempt on load if a session is already present — avoids wasted
  // round-trip + 3-second delay on unauthenticated / first-ever loads.
  window.addEventListener('load', function () {
    // __QS_SUPABASE.user is always null (frozen object).
    // Check __QS_APP.getUser() instead, with fallback to localStorage
    // session flag for cases where appss.js hasn't initialised yet.
    var hasUser = (window.__QS_APP && typeof window.__QS_APP.getUser === 'function' && window.__QS_APP.getUser())
      || (window.__QS_SUPABASE && window.__QS_SUPABASE.user)
      || localStorage.getItem('qs_session_active') === 'true';
    if (hasUser) {
      setTimeout(schedulePendingSync, 1500);
    }
  });

})();
