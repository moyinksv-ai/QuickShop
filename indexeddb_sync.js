/* indexeddb_sync.js - Offline-first queueing and sync logic for Supabase
 * SECURITY HARDENING:
 *   - VALID_ACTION_TYPES allowlist: unknown sync operations are rejected before storage
 *   - validateAction(): structural check on every pending change before it is queued
 *   - sanitiseProduct() / sanitiseSale(): numeric fields clamped, strings length-limited
 *     before any data reaches Supabase — prevents negative prices, NaN, Infinity, oversized payloads
 *   - window.qsdb frozen after full assembly: external scripts cannot replace sync functions
 *   - Production console.log calls removed; only errors and warnings remain
 */

(function () {
  'use strict';

  const DB_NAME    = 'quickshop_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_sync';

  const VALID_ACTION_TYPES = Object.freeze([
    'addProduct',
    'updateProduct',
    'removeProduct',
    'addSale',
    'removeSale',
    'addStock'
  ]);

  const IS_PROD = (
    window.location.hostname !== 'localhost' &&
    !window.location.hostname.startsWith('127.') &&
    !window.location.hostname.startsWith('192.168.')
  );
  const log  = IS_PROD ? () => {} : (...a) => console.log('[qsdb]', ...a);
  const warn = (...a) => console.warn('[qsdb]', ...a);

  let dbPromise = null;

  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB not supported'));
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (ev) => {
        console.error('[qsdb] IndexedDB open error:', ev.target.error);
        reject(ev.target.error);
      };
      request.onsuccess = (ev) => resolve(ev.target.result);
      request.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
    return dbPromise;
  }

  function waitForSupabaseReady(timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) {
        return resolve(window.__QS_SUPABASE);
      }
      let waited = 0;
      const iv = setInterval(() => {
        if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) {
          clearInterval(iv);
          return resolve(window.__QS_SUPABASE);
        }
        waited += 100;
        if (waited >= timeoutMs) {
          clearInterval(iv);
          warn('Supabase did not initialise within timeout.');
          return resolve(window.__QS_SUPABASE || null);
        }
      }, 100);
    });
  }

  function validateAction(action) {
    if (!action || typeof action !== 'object') return 'Action must be an object';
    if (!VALID_ACTION_TYPES.includes(action.type))
      return 'Unknown action type: ' + String(action.type).slice(0, 50);
    if (!action.item || typeof action.item !== 'object') return 'Action must have an item object';

    const item = action.item;
    if (['addProduct','updateProduct','removeProduct','addStock'].includes(action.type)) {
      const id = item.id || item.productId;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_\-]{1,64}$/.test(id))
        return 'Item has invalid or missing id';
    }
    if (['addSale','removeSale'].includes(action.type)) {
      if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_\-]{1,64}$/.test(item.id))
        return 'Sale item has invalid or missing id';
    }
    return null;
  }

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

  var qsdb = {

    addPendingChange: async function(action) {
      var err = validateAction(action);
      if (err) {
        warn('addPendingChange rejected — validation failed:', err);
        return null;
      }
      var db = await getDb();
      return new Promise(function(resolve, reject) {
        var tx    = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.add(action);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror   = function(ev) {
          console.error('[qsdb] addPendingChange failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    },

    getAllPending: async function() {
      var db = await getDb();
      return new Promise(function(resolve, reject) {
        var tx    = db.transaction([STORE_NAME], 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror   = function(ev) {
          console.error('[qsdb] getAllPending failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    },

    clearPending: async function(id) {
      var db = await getDb();
      return new Promise(function(resolve, reject) {
        var tx    = db.transaction([STORE_NAME], 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req   = store.delete(id);
        req.onsuccess = function() { resolve(); };
        req.onerror   = function(ev) {
          console.error('[qsdb] clearPending failed:', ev.target.error);
          reject(ev.target.error);
        };
      });
    }
  };

  async function syncPendingToSupabase() {
    try {
      if (!navigator.onLine) { log('Offline — skipping sync.'); return; }

      var pending = await window.qsdb.getAllPending();
      if (!pending || pending.length === 0) { log('No pending items to sync.'); return; }

      log('Syncing ' + pending.length + ' pending item(s)…');

      var sb = await waitForSupabaseReady();
      if (!sb || !sb.client) { warn('Supabase not ready — sync deferred.'); return; }

      var supabase = sb.client;
      var user     = sb.user;
      if (!user || !user.id) { warn('No authenticated user — sync deferred.'); return; }

      for (var i = 0; i < pending.length; i++) {
        var act = pending[i];
        try {
          var validErr = validateAction(act);
          if (validErr) {
            warn('Skipping invalid queued action (id=' + act.id + '):', validErr);
            await window.qsdb.clearPending(act.id);
            continue;
          }

          var success = false;

          switch (act.type) {

            case 'addProduct': {
              var p = sanitiseProduct(act.item);
              var _r1 = await supabase.from('products').upsert({
                id: p.id, user_id: user.id,
                name: p.name, barcode: p.barcode || null,
                price: p.price, cost: p.cost, qty: p.qty,
                category: p.category,
                image_url: p.image || null, image_url2: p.image2 || null,
                icon: p.icon || null,
                created_at: new Date(p.createdAt).toISOString(),
                updated_at: new Date(p.updatedAt || p.createdAt).toISOString()
              }, { onConflict: 'id' });
              if (_r1.error) throw _r1.error;
              success = true;
              break;
            }

            case 'updateProduct': {
              var p2 = sanitiseProduct(act.item);
              var _r2 = await supabase.from('products').update({
                name: p2.name, barcode: p2.barcode || null,
                price: p2.price, cost: p2.cost, qty: p2.qty,
                category: p2.category,
                image_url: p2.image || null, image_url2: p2.image2 || null,
                icon: p2.icon || null,
                updated_at: new Date().toISOString()
              }).eq('id', p2.id).eq('user_id', user.id);
              if (_r2.error) throw _r2.error;
              success = true;
              break;
            }

            case 'removeProduct': {
              var p3 = sanitiseProduct(act.item);
              var _r3 = await supabase.from('products')
                .delete().eq('id', p3.id).eq('user_id', user.id);
              if (_r3.error) throw _r3.error;
              success = true;
              break;
            }

            case 'addSale': {
              var s = sanitiseSale(act.item);
              var _r4 = await supabase.from('sales').insert({
                id: s.id, user_id: user.id,
                product_id: s.productId,
                qty: s.qty, price: s.price, cost: s.cost,
                sale_date: new Date(s.ts).toISOString()
              });
              if (_r4.error) throw _r4.error;
              success = true;
              break;
            }

            case 'removeSale': {
              var s2 = sanitiseSale(act.item);
              var _r5 = await supabase.from('sales')
                .delete().eq('id', s2.id).eq('user_id', user.id);
              if (_r5.error) throw _r5.error;
              success = true;
              break;
            }

            case 'addStock': {
              var productId = String(act.item.productId || '').slice(0, 64);
              var qty       = Math.max(1, Math.floor(Number(act.item.qty) || 1));
              var _r6 = await supabase.from('products').select('qty')
                .eq('id', productId).eq('user_id', user.id).single();
              if (_r6.error) throw _r6.error;
              var newQty = Math.max(0, (Number(_r6.data.qty) || 0) + qty);
              var _r7 = await supabase.from('products')
                .update({ qty: newQty, updated_at: new Date().toISOString() })
                .eq('id', productId).eq('user_id', user.id);
              if (_r7.error) throw _r7.error;
              success = true;
              break;
            }

            default:
              warn('Unexpected action type after allowlist check — skipping:', act.type);
          }

          if (success) {
            await window.qsdb.clearPending(act.id);
            log('Synced item ' + act.id);
          }

        } catch(e) {
          console.error('[qsdb] Failed to sync item ' + act.id + ' — will retry.', e);
        }
      }

      log('Sync complete.');
      document.dispatchEvent(new Event('qs:data:synced'));

    } catch(e) {
      warn('syncPendingToSupabase error:', e);
    }
  }

  qsdb.syncPendingToSupabase = syncPendingToSupabase;
  window.qsdb = Object.freeze(qsdb);

  window.addEventListener('online', function() {
    log('Network restored — attempting sync…');
    syncPendingToSupabase();
  });

  document.addEventListener('qs:user:auth', function() {
    syncPendingToSupabase();
  });

  window.addEventListener('load', function() {
    setTimeout(syncPendingToSupabase, 3000);
  });

})();
