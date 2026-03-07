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
    'addSale', 'removeSale', 'addStock'
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
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB not supported'));
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = function (ev) {
        console.error('[qsdb] IndexedDB open error:', ev.target.error);
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
    return null;
  }

  // ── Sanitisers ───────────────────────────────────────────────────────
  function sanitiseProduct(p) {
    function safeNum(v)      { var n = Number(v); return (isFinite(n) && n >= 0) ? n : 0; }
    function safeStr(v, max) { return (typeof v === 'string' ? v : String(v || '')).slice(0, max); }
    return {
      id:        safeStr(p.id, 64),
      name:      safeStr(p.name || '', 200),
      barcode:   p.barcode  != null ? safeStr(p.barcode,  64)   : null,
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
      if (!pending || pending.length === 0) { log('Nothing pending.'); return; }
      log('Pending actions:', pending.length);

      var sb = await waitForSupabaseReady(3000);
      if (!sb || !sb.client) { warn('Supabase not ready — deferred.'); return; }
      var supabase = sb.client;
      var user     = sb.user;
      if (!user || !user.id) { warn('No user — deferred.'); return; }
      var userId = user.id;

      // ── Group by type ──────────────────────────────────────────────
      var productUpsertRows   = []; var productUpsertActIds = [];
      var productDeleteIds    = []; var productDeleteActIds = [];
      var saleInsertRows      = []; var saleInsertActIds    = [];
      var saleDeleteIds       = []; var saleDeleteActIds    = [];
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
              sale_date: new Date(s.ts).toISOString()
            });
            saleInsertActIds.push(act.id);
            break;
          }
          case 'removeSale': {
            saleDeleteIds.push(act.item.id);
            saleDeleteActIds.push(act.id);
            break;
          }
          case 'addStock': {
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
        log('Product upsert batch:', productUpsertRows.length);
        try {
          var r1 = await supabase.from('products')
            .upsert(productUpsertRows, { onConflict: 'id' });
          if (r1.error) { console.error('[qsdb] Product upsert failed:', r1.error); }
          else { doneActIds = doneActIds.concat(productUpsertActIds); log('Product upsert OK.'); }
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

      // ── addStock: serial (read-modify-write, cannot batch) ───────
      for (var si = 0; si < stockSerial.length; si++) {
        var act = stockSerial[si];
        try {
          var productId = String(act.item.productId || '').slice(0, 64);
          var addQty    = Math.max(1, Math.floor(Number(act.item.qty) || 1));
          var fetchRes  = await supabase.from('products').select('qty')
            .eq('id', productId).eq('user_id', userId).single();
          if (fetchRes.error) throw fetchRes.error;
          var newQty = Math.max(0, (Number(fetchRes.data.qty) || 0) + addQty);
          var updRes = await supabase.from('products')
            .update({ qty: newQty, updated_at: new Date().toISOString() })
            .eq('id', productId).eq('user_id', userId);
          if (updRes.error) throw updRes.error;
          doneActIds.push(act.id);
          log('addStock OK:', productId);
        } catch (e) {
          console.error('[qsdb] addStock failed for action', act.id, '— will retry.', e);
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
    } finally {
      isSyncing = false;
    }
  }

  qsdb.syncPendingToSupabase = syncPendingToSupabase;
  window.qsdb = Object.freeze(qsdb);

  // ── Sync triggers ────────────────────────────────────────────────────
  window.addEventListener('online', function () {
    log('Network restored — syncing.'); syncPendingToSupabase();
  });
  document.addEventListener('qs:user:auth', function () { syncPendingToSupabase(); });
  window.addEventListener('load', function () { setTimeout(syncPendingToSupabase, 3000); });

})();
