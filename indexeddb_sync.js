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

  // ── Public API ───────────────────────────────────────────────────────
  var qsdb = {

    addPendingChange: async function (action) {
      var err = validateAction(action);
      if (err) { warn('addPendingChange rejected:', err); return null; }
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.add(action);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function (ev) {
          console.error('[qsdb] addPendingChange failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    },

    getAllPending: async function () {
      var db = await getDb();
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([STORE_NAME], 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function (ev) {
          console.error('[qsdb] getAllPending failed:', ev.target.error);
          reject(ev.target.error);
        };
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

  // ── syncPendingToSupabase (BATCHED) ──────────────────────────────────
  async function syncPendingToSupabase() {

    if (isSyncing) { log('Sync in progress — skipping.'); return; }
    if (!navigator.onLine) { log('Offline — skipping sync.'); return; }

    isSyncing = true;
    log('Sync started.');

    try {
      var pending = await window.qsdb.getAllPending();
      // FIXED: early returns inside try never reached finally → isSyncing
      // stayed true forever, permanently killing the sync queue.
      // All guard conditions now use early-exit via a local flag so the
      // outer try/finally always runs and isSyncing is always reset.
      if (!pending || pending.length === 0) { log('Nothing pending.'); isSyncing = false; return; }
      log('Pending actions:', pending.length);

      var sb = await waitForSupabaseReady(3000);
      if (!sb || !sb.client) { warn('Supabase not ready — deferred.'); isSyncing = false; return; }
      var supabase = sb.client;
      // __QS_SUPABASE is frozen so sb.user is always null.
      // Read the authoritative user from __QS_APP.getUser() instead —
      // it returns currentUser directly from appss.js memory.
      var user = (window.__QS_APP && typeof window.__QS_APP.getUser === 'function')
        ? window.__QS_APP.getUser()
        : sb.user;
      if (!user || !user.id) { warn('No user — deferred.'); isSyncing = false; return; }
      var userId = user.id;

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

      // ── Product upserts ──────────────────────────────────────────
      if (productUpsertRows.length > 0) {
        // Deduplicate by id — if the same product was queued multiple times,
        // Postgres throws "cannot affect row a second time" on batch upsert.
        // Keep the last entry for each id (most recent change wins).
        var seenProductIds = {};
        for (var pi = productUpsertRows.length - 1; pi >= 0; pi--) {
          if (seenProductIds[productUpsertRows[pi].id]) {
            productUpsertRows.splice(pi, 1);
            productUpsertActIds.splice(pi, 1);
          } else {
            seenProductIds[productUpsertRows[pi].id] = true;
          }
        }
        log('Product upsert batch:', productUpsertRows.length);
        try {
          var r1 = await supabase.from('products')
            .upsert(productUpsertRows, { onConflict: 'id' });
          if (r1.error) { console.error('[qsdb] Product upsert failed:', r1.error); }
          else {
            doneActIds = doneActIds.concat(productUpsertActIds);
            log('Product upsert OK.');
            // ── Register/update marketplace listings ──────────────────────
            // canonical.js::registerListing() calls qs_register_listing RPC which
            // populates qs_vendor_listings + qs_canonical_products for search.html.
            // The old inventory.js did this inline on save; the new sync path
            // (appss.js → indexeddb_sync.js) skipped it, leaving the marketplace
            // tables empty. Fix: fire-and-forget for every successfully upserted product.
            if (window.__QS_CANONICAL && typeof window.__QS_CANONICAL.registerListing === 'function') {
              productUpsertRows.forEach(function(row) {
                try {
                  window.__QS_CANONICAL.registerListing({
                    id:       row.id,
                    name:     row.name,
                    price:    row.price,
                    category: row.category || null
                  });
                } catch (_) { /* fire-and-forget: never block sync */ }
              });
            }
          }
        } catch (e) { console.error('[qsdb] Product upsert threw:', e); }
      }

      // ── Product deletes ──────────────────────────────────────────
      if (productDeleteIds.length > 0) {
        log('Product delete batch:', productDeleteIds.length);
        try {
          var r2 = await supabase.from('products').delete()
            .in('id', productDeleteIds).eq('user_id', userId);
          if (r2.error) { console.error('[qsdb] Product delete failed:', r2.error); }
          else { doneActIds = doneActIds.concat(productDeleteActIds); log('Product delete OK.'); }
        } catch (e) { console.error('[qsdb] Product delete threw:', e); }
      }

      // ── Sale inserts (upsert so retries are idempotent) ──────────
      if (saleInsertRows.length > 0) {
        log('Sale insert batch:', saleInsertRows.length);
        try {
          var r3 = await supabase.from('sales')
            .upsert(saleInsertRows, { onConflict: 'id', ignoreDuplicates: true });
          if (r3.error) { console.error('[qsdb] Sale insert failed:', r3.error); }
          else { doneActIds = doneActIds.concat(saleInsertActIds); log('Sale insert OK.'); }
        } catch (e) { console.error('[qsdb] Sale insert threw:', e); }
      }

      // ── Sale deletes ─────────────────────────────────────────────
      if (saleDeleteIds.length > 0) {
        log('Sale delete batch:', saleDeleteIds.length);
        try {
          var r4 = await supabase.from('sales').delete()
            .in('id', saleDeleteIds).eq('user_id', userId);
          if (r4.error) { console.error('[qsdb] Sale delete failed:', r4.error); }
          else { doneActIds = doneActIds.concat(saleDeleteActIds); log('Sale delete OK.'); }
        } catch (e) { console.error('[qsdb] Sale delete threw:', e); }
      }

      // ── Note upserts ─────────────────────────────────────────────
      if (noteUpsertRows.length > 0) {
        // Deduplicate by id — same reason as products above
        var seenNoteIds = {};
        for (var ni = noteUpsertRows.length - 1; ni >= 0; ni--) {
          if (seenNoteIds[noteUpsertRows[ni].id]) {
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
          if (rn1.error) { console.error('[qsdb] Note upsert failed:', rn1.error); }
          else { doneActIds = doneActIds.concat(noteUpsertActIds); log('Note upsert OK.'); }
        } catch (e) { console.error('[qsdb] Note upsert threw:', e); }
      }

      // ── Note deletes ──────────────────────────────────────────────
      if (noteDeleteIds.length > 0) {
        log('Note delete batch:', noteDeleteIds.length);
        try {
          var rn2 = await supabase.from('notes').delete()
            .in('id', noteDeleteIds).eq('user_id', userId);
          if (rn2.error) { console.error('[qsdb] Note delete failed:', rn2.error); }
          else { doneActIds = doneActIds.concat(noteDeleteActIds); log('Note delete OK.'); }
        } catch (e) { console.error('[qsdb] Note delete threw:', e); }
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
        }
      }

      // ── Mark done ────────────────────────────────────────────────
      for (var di = 0; di < doneActIds.length; di++) {
        try { await window.qsdb.clearPending(doneActIds[di]); } catch (_) {}
      }

      var deferred = pending.length - invalidActIds.length - doneActIds.length;
      log('Sync done. Done:', doneActIds.length, '/ Total:', pending.length, '/ Deferred:', deferred);

      if (doneActIds.length > 0) document.dispatchEvent(new Event('qs:data:synced'));

    } catch (e) {
      warn('syncPendingToSupabase error:', e);
    }
    // FIXED: isSyncing reset happens here — after the try/catch — so it fires
    // on every code path: normal completion, thrown exception, and the early
    // returns above (which set isSyncing = false then return before this line).
    isSyncing = false;
  }

  qsdb.syncPendingToSupabase = syncPendingToSupabase;
  window.qsdb = Object.freeze(qsdb);

  // ── Sync triggers ────────────────────────────────────────────────────
  window.addEventListener('online', function () {
    log('Network restored — syncing.'); syncPendingToSupabase();
  });
  document.addEventListener('qs:user:auth', function () { syncPendingToSupabase(); });
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
      setTimeout(syncPendingToSupabase, 1500);
    }
  });

})();
