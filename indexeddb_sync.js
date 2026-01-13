/* indexeddb_sync.js - Offline-first queueing and sync logic for Supabase */

(function () {
  'use strict';

  const DB_NAME = 'quickshop_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'pending_sync';
  let dbPromise = null;

  function getDb() {
    if (dbPromise) return dbPromise;
    
    dbPromise = new Promise((resolve, reject) => {
      // Check if IndexedDB is supported
      if (!('indexedDB' in window)) {
        console.error('IndexedDB not supported');
        return reject('IndexedDB not supported');
      }
      
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject('IndexedDB error: ' + event.target.error);
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        console.log('IndexedDB upgrade needed...');
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // 'id' is the auto-incrementing primary key
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
          console.warn('QuickShop: Supabase did not initialize within timeout.');
          return resolve(window.__QS_SUPABASE || null);
        }
      }, 100);
    });
  }

  const qsdb = {
    addPendingChange: async (action) => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(action);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
          console.error('Failed to add pending change:', event.target.error);
          reject(event.target.error);
        };
      });
    },

    getAllPending: async () => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
          console.error('Failed to get all pending changes:', event.target.error);
          reject(event.target.error);
        };
      });
    },

    clearPending: async (id) => {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          console.error('Failed to clear pending change:', event.target.error);
          reject(event.target.error);
        };
      });
    }
  };

  window.qsdb = qsdb;

  // Supabase sync: attempt to push pending items
  async function syncPendingToSupabase() {
    try {
      if (!navigator.onLine) {
        console.log('Offline, skipping sync.');
        return;
      }
      
      const pending = await window.qsdb.getAllPending();
      if (!pending || pending.length === 0) {
        console.log('No pending items to sync.');
        return;
      }
      
      console.log(`Syncing ${pending.length} pending item(s)...`);

      const sb = await waitForSupabaseReady();
      
      if (!sb || !sb.client) {
        console.warn('Supabase not ready for sync.');
        return;
      }

      const supabase = sb.client;
      const user = sb.user;
      
      if (!user || !user.id) {
        console.warn('No user, skipping sync.');
        return;
      }

      for (const act of pending) {
        try {
          let success = false;

          switch (act.type) {
            case 'addProduct': {
              const product = act.item;
              const { error } = await supabase
                .from('products')
                .insert({
                  id: product.id,
                  user_id: user.id,
                  name: product.name,
                  barcode: product.barcode || null,
                  price: product.price,
                  cost: product.cost,
                  qty: product.qty || 0,
                  category: product.category || 'Others',
                  image_url: product.image || null,
                  icon: product.icon || null,
                  created_at: product.createdAt ? new Date(product.createdAt).toISOString() : new Date().toISOString(),
                  updated_at: product.updatedAt ? new Date(product.updatedAt).toISOString() : new Date().toISOString()
                });
              
              if (error) throw error;
              success = true;
              break;
            }

            case 'updateProduct': {
              const product = act.item;
              const { error } = await supabase
                .from('products')
                .update({
                  name: product.name,
                  barcode: product.barcode || null,
                  price: product.price,
                  cost: product.cost,
                  qty: product.qty || 0,
                  category: product.category || 'Others',
                  image_url: product.image || null,
                  icon: product.icon || null,
                  updated_at: new Date().toISOString()
                })
                .eq('id', product.id)
                .eq('user_id', user.id);
              
              if (error) throw error;
              success = true;
              break;
            }

            case 'removeProduct': {
              const product = act.item;
              const { error } = await supabase
                .from('products')
                .delete()
                .eq('id', product.id)
                .eq('user_id', user.id);
              
              if (error) throw error;
              success = true;
              break;
            }

            case 'addSale': {
              const sale = act.item;
              const { error } = await supabase
                .from('sales')
                .insert({
                  id: sale.id,
                  user_id: user.id,
                  product_id: sale.productId,
                  qty: sale.qty,
                  price: sale.price,
                  cost: sale.cost,
                  sale_date: sale.ts ? new Date(sale.ts).toISOString() : new Date().toISOString()
                });
              
              if (error) throw error;
              success = true;
              break;
            }

            case 'removeSale': {
              const sale = act.item;
              const { error } = await supabase
                .from('sales')
                .delete()
                .eq('id', sale.id)
                .eq('user_id', user.id);
              
              if (error) throw error;
              success = true;
              break;
            }

            case 'addStock': {
              const { productId, qty } = act.item;
              
              // Fetch current qty
              const { data: currentProduct, error: fetchError } = await supabase
                .from('products')
                .select('qty')
                .eq('id', productId)
                .eq('user_id', user.id)
                .single();
              
              if (fetchError) throw fetchError;
              
              const newQty = (currentProduct.qty || 0) + (qty || 0);
              
              const { error: updateError } = await supabase
                .from('products')
                .update({ qty: newQty, updated_at: new Date().toISOString() })
                .eq('id', productId)
                .eq('user_id', user.id);
              
              if (updateError) throw updateError;
              success = true;
              break;
            }

            default:
              console.warn('Unknown sync action type:', act.type);
          }

          if (success) {
            await window.qsdb.clearPending(act.id);
            console.log(`Synced item ${act.id}`);
          }

        } catch (e) {
          console.error(`Failed to sync item ${act.id}. Will retry.`, e);
        }
      }
      
      console.log('Sync complete.');
      document.dispatchEvent(new Event('qs:data:synced'));

    } catch (e) {
      console.warn('syncPendingToSupabase failed', e);
    }
  }
  
  window.qsdb.syncPendingToSupabase = syncPendingToSupabase;

  window.addEventListener('online', () => {
    console.log('Online, attempting sync...');
    syncPendingToSupabase(); 
  });

  document.addEventListener('qs:user:auth', () => {
    syncPendingToSupabase();
  });

  window.addEventListener('load', () => {
    setTimeout(syncPendingToSupabase, 3000); 
  });

})();