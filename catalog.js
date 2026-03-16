/* ═══════════════════════════════════════════════════════════════════════════
   catalog.js — QuickShop Public Catalog  (STANDALONE)

   Loaded ONLY when URL contains ?store= or ?token= parameters.
   Zero dependency on appss.js, inventory.js, or share-catalog.js.
   Requires only: supabase-config.js  (sets window.__QS_SUPABASE synchronously)

   Features
   ─────────
   · Multi-product cart with qty management (Jumia / Amazon style)
   · WhatsApp multi-item checkout — one consolidated order message
   · Dual-image product cards, tap-to-cycle, long-tap to lightbox
   · Category filter chips + live client-side search
   · Skeleton loading → data → empty/error states
   · XSS-safe: all dynamic content via textContent / property assignment
   · Memory-efficient: single event delegation on grid & cart, not per-card
   · Accessible: ARIA roles, labels, focus management, keyboard nav
   · Handles both URL patterns:
       ?store=<UUID>           — direct (preferred)
       ?token=<opaque-token>   — legacy, resolved via share_links table
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── 0. EARLY GUARD ───────────────────────────────────────────────────── */

  var _p     = new URLSearchParams(window.location.search);
  var STORE_ID     = (_p.get('store') || '').replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 64);
  var TOKEN        = (_p.get('token') || '').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 128);
  var _rawPhone    = (_p.get('phone') || '').replace(/\D/g, '').slice(0, 15);
  // Enforce minimum 7 digits — shorter strings produce broken wa.me links
  var SELLER_PHONE = (_rawPhone.length >= 7) ? _rawPhone : '';

  // Validate STORE_ID — must be 3-64 alphanumeric/hyphen chars.
  // Rejects obviously garbage params without hitting the DB.
  var _validStoreId = /^[a-zA-Z0-9\-]{1,64}$/.test(STORE_ID);

  var IS_PROD = (
    window.location.hostname !== 'localhost' &&
    !window.location.hostname.startsWith('127.') &&
    !window.location.hostname.startsWith('192.168.')
  );

  if (!STORE_ID && !TOKEN) return; // not a catalog URL — do nothing

  /* ── 1. WAIT FOR SUPABASE ──────────────────────────────────────────────── */

  function waitForClient(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.__QS_SUPABASE && window.__QS_SUPABASE.client)
        return resolve(window.__QS_SUPABASE.client);
      var waited = 0;
      var iv = setInterval(function () {
        if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) {
          clearInterval(iv);
          return resolve(window.__QS_SUPABASE.client);
        }
        waited += 100;
        if (waited >= (timeoutMs || 5000)) {
          clearInterval(iv);
          return resolve(null);
        }
      }, 100);
    });
  }

  /* ── 2. CART STATE — pure in-memory Map, intentionally not persisted ─── */
  //  Map<productId: string, { product: Object, qty: number }>

  var cart = new Map();

  function cartAdd(product) {
    if (!cart.has(product.id)) {
      cart.set(product.id, { product: product, qty: 1 });
      refreshCartUI();
    }
  }

  function cartSetQty(productId, qty) {
    var entry = cart.get(productId);
    if (!entry) return;
    var maxStock = (typeof entry.product.qty === 'number') ? entry.product.qty : Infinity;
    var n = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), maxStock);
    if (n === 0) { cart.delete(productId); }
    else         { entry.qty = n; }
    refreshCartUI();
  }

  function cartRemove(productId) {
    cart.delete(productId);
    refreshCartUI();
  }

  function cartCount() {
    var n = 0;
    cart.forEach(function (e) { n += e.qty; });
    return n;
  }

  function cartTotal() {
    var t = 0;
    cart.forEach(function (e) { t += e.product.price * e.qty; });
    return t;
  }

  /* ── 3. FORMATTING ────────────────────────────────────────────────────── */

  function fmt(v) {
    return '\u20A6' + Number(v || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  }

  function mono(name) {
    return (name || '?').trim().split(/\s+/).map(function (w) { return w[0] || ''; })
      .slice(0, 2).join('').toUpperCase() || '?';
  }

  /* ── 4. CSS INJECTION — scoped under #qs-catalog, injected once ────────── */

  function injectCSS() {
    if (document.getElementById('qs-cat-css')) return;
    var s = document.createElement('style');
    s.id = 'qs-cat-css';
    s.textContent = [
      /* --- body catalog mode --- */
      'body.qs-cat{background:#0e0e14;color:#f0f0f6;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        '-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden;}',
      'body.qs-cat #qs-landing,body.qs-cat .app,body.qs-cat .bottom-nav,',
        'body.qs-cat #loginScreen{display:none!important;}',

      /* --- root catalog wrapper --- */
      '#qs-catalog{display:none;padding-bottom:140px;}',
      'body.qs-cat #qs-catalog{display:block;}',

      /* --- header --- */
      '#cat-hdr{position:sticky;top:0;z-index:100;',
        'background:rgba(14,14,20,0.95);backdrop-filter:blur(20px);',
        '-webkit-backdrop-filter:blur(20px);',
        'border-bottom:1px solid rgba(255,255,255,0.07);',
        'padding:12px 16px 12px;display:flex;align-items:center;gap:13px;}',

      /* avatar — circular, elevated */
      '#cat-avatar{width:48px;height:48px;border-radius:50%;flex-shrink:0;',
        'background:linear-gradient(135deg,rgba(124,58,237,0.3),rgba(109,40,217,0.15));',
        'border:2px solid rgba(124,58,237,0.45);',
        'box-shadow:0 0 0 3px rgba(124,58,237,0.1);',
        'display:flex;align-items:center;justify-content:center;',
        'font-size:17px;font-weight:900;color:#c4b5fd;overflow:hidden;}',
      '#cat-avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;}',

      /* store info */
      '#cat-store-info{flex:1;min-width:0;}',
      '#cat-store-name{font-size:17px;font-weight:900;color:#fff;',
        'letter-spacing:-.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
        'line-height:1.2;}',
      '#cat-store-sub{font-size:11px;color:rgba(240,240,246,0.4);',
        'margin-top:1px;font-weight:500;}',

      /* tagline strip — sits between search bar and category chips */
      '#cat-tagline{',
        'display:none;', /* hidden until tagline set */
        'padding:8px 20px 6px;',
        'text-align:center;',
        'font-size:13px;font-style:italic;font-weight:400;',
        'color:rgba(240,240,246,0.6);line-height:1.65;',
        'border-bottom:1px solid rgba(255,255,255,0.05);',
        'margin:0;',
      '}',
      '#cat-tagline.visible{display:block;}',

      /* status pill */
      '#cat-status{display:inline-flex;align-items:center;gap:5px;',
        'background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);',
        'border-radius:100px;padding:3px 8px 3px 6px;margin-top:5px;}',
      '#cat-status-text{font-size:10px;font-weight:700;color:#34d399;letter-spacing:.3px;}',
      '.cat-live-dot{width:5px;height:5px;border-radius:50%;background:#34d399;flex-shrink:0;',
        'animation:cat-pulse 1.8s ease-in-out infinite;}',
      '@keyframes cat-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}',

      /* --- search --- */
      '#cat-search-wrap{padding:10px 12px 6px;background:#0e0e14;}',
      '#cat-search{width:100%;padding:10px 14px;',
        'background:rgba(255,255,255,0.05);',
        'border:1px solid rgba(255,255,255,0.1);',
        'border-radius:12px;color:#f0f0f6;font-size:14px;',
        'outline:none;box-sizing:border-box;',
        '-webkit-appearance:none;}',
      '#cat-search::placeholder{color:rgba(240,240,246,0.3);}',
      '#cat-search:focus{border-color:rgba(124,58,237,0.6);',
        'background:rgba(124,58,237,0.05);}',

      /* --- category chips --- */
      '#cat-chips{display:flex;gap:7px;padding:8px 12px;overflow-x:auto;',
        'scrollbar-width:none;-webkit-overflow-scrolling:touch;}',
      '#cat-chips::-webkit-scrollbar{display:none;}',
      '.cat-chip{flex-shrink:0;padding:6px 14px;border-radius:100px;',
        'font-size:12px;font-weight:700;cursor:pointer;border:none;',
        'background:rgba(255,255,255,0.06);color:rgba(240,240,246,0.6);',
        'transition:all .15s;}',
      '.cat-chip.active{background:rgba(124,58,237,0.2);color:#a78bfa;',
        'border:1px solid rgba(124,58,237,0.4);}',

      /* --- results bar --- */
      '#cat-results-bar{padding:2px 14px 6px;',
        'font-size:11px;color:rgba(240,240,246,0.3);font-weight:600;',
        'letter-spacing:.4px;text-transform:uppercase;}',

      /* --- grid --- */
      '#cat-grid{display:grid;grid-template-columns:repeat(2,1fr);',
        'gap:8px;padding:0 10px;}',
      '@media(min-width:460px){#cat-grid{grid-template-columns:repeat(3,1fr);}}',

      /* --- card --- */
      '.cat-card{background:rgba(255,255,255,0.04);',
        'border:1px solid rgba(255,255,255,0.08);',
        'border-radius:14px;overflow:hidden;',
        'display:flex;flex-direction:column;',
        'transition:transform .15s,border-color .15s;}',
      '.cat-card.oos{opacity:.55;}',

      /* --- thumb --- */
      '.cat-thumb{aspect-ratio:1/1;position:relative;overflow:hidden;',
        'background:rgba(255,255,255,0.04);flex-shrink:0;}',
      '.cat-thumb img{width:100%;height:100%;object-fit:cover;',
        'display:block;transition:opacity .2s;}',
      '.cat-thumb .cat-mono,.cat-thumb .cat-emoji{',
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}',
      '.cat-mono{font-size:26px;font-weight:900;color:rgba(255,255,255,0.2);}',
      '.cat-emoji{font-size:36px;}',
      '.cat-img-dots{position:absolute;bottom:6px;left:0;right:0;',
        'display:flex;justify-content:center;gap:4px;pointer-events:none;}',
      '.cat-img-dot{width:5px;height:5px;border-radius:50%;',
        'transition:background .2s;display:inline-block;}',
      '.cat-img-dot.on{background:#fff;}',
      '.cat-img-dot.off{background:rgba(255,255,255,0.35);}',

      /* --- stock badges --- */
      '.cat-badge{position:absolute;top:7px;right:7px;',
        'font-size:9px;font-weight:800;letter-spacing:.4px;',
        'padding:3px 7px;border-radius:100px;text-transform:uppercase;}',
      '.cat-badge-oos{background:rgba(239,68,68,0.88);color:#fff;}',
      '.cat-badge-low{background:rgba(245,158,11,0.88);color:#fff;}',

      /* --- stock count --- */
      '.cat-stock{font-size:10px;font-weight:700;color:#10b981;margin-top:3px;',
        'letter-spacing:.2px;}',

      /* --- card info --- */
      '.cat-info{padding:9px 10px 6px;flex:1;}',
      '.cat-cat{font-size:9px;font-weight:700;letter-spacing:.6px;',
        'text-transform:uppercase;color:rgba(240,240,246,0.35);margin-bottom:3px;}',
      '.cat-name{font-size:13px;font-weight:700;color:#f0f0f6;',
        'line-height:1.35;margin-bottom:5px;',
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.cat-price{font-size:15px;font-weight:800;color:#a78bfa;letter-spacing:-.3px;}',

      /* --- add to cart button --- */
      '.cat-add-btn{display:flex;align-items:center;justify-content:center;gap:5px;',
        'margin:6px 10px 10px;padding:9px 0;border-radius:10px;',
        'font-size:12px;font-weight:800;cursor:pointer;border:none;',
        'background:rgba(124,58,237,0.15);color:#a78bfa;',
        'transition:all .15s;-webkit-tap-highlight-color:transparent;}',
      '.cat-add-btn.in-cart{background:rgba(16,185,129,0.15);color:#34d399;}',
      '.cat-add-btn.in-cart .cat-btn-icon::before{content:"✓";}',
      '.cat-add-btn:not(.in-cart) .cat-btn-icon::before{content:"+";}',
      '.cat-add-btn[disabled]{opacity:.4;cursor:not-allowed;}',

      /* --- empty / error states --- */
      '#cat-empty,#cat-error{padding:60px 20px;text-align:center;',
        'display:none;flex-direction:column;align-items:center;gap:12px;}',
      '#cat-empty.show,#cat-error.show{display:flex;}',
      '.cat-state-icon{font-size:48px;margin-bottom:4px;}',
      '.cat-state-title{font-size:17px;font-weight:800;color:#fff;}',
      '.cat-state-sub{font-size:13px;color:rgba(240,240,246,0.4);line-height:1.6;max-width:260px;}',

      /* --- skeleton --- */
      '#cat-skeletons{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 10px;}',
      '@media(min-width:460px){#cat-skeletons{grid-template-columns:repeat(3,1fr);}}',
      '.cat-skel{background:rgba(255,255,255,0.04);border-radius:14px;overflow:hidden;}',
      '.cat-skel-thumb{aspect-ratio:1/1;background:rgba(255,255,255,0.06);',
        'animation:cat-skel 1.4s ease-in-out infinite alternate;}',
      '.cat-skel-lines{padding:10px;}',
      '.cat-skel-line{height:9px;border-radius:5px;margin-bottom:8px;',
        'background:rgba(255,255,255,0.06);',
        'animation:cat-skel 1.4s ease-in-out infinite alternate;}',
      '.cat-skel-line.short{width:55%;}',
      '.cat-skel-btn{height:34px;border-radius:10px;margin:4px 10px 10px;',
        'background:rgba(255,255,255,0.04);',
        'animation:cat-skel 1.4s ease-in-out infinite alternate;}',
      '@keyframes cat-skel{from{opacity:.4}to{opacity:.9}}',

      /* --- cart bar (sticky bottom) --- */
      '#cat-cart-bar{position:fixed;bottom:0;left:0;right:0;z-index:200;',
        'padding:10px 14px 14px;',
        'background:rgba(14,14,20,0.95);backdrop-filter:blur(20px);',
        '-webkit-backdrop-filter:blur(20px);',
        'border-top:1px solid rgba(255,255,255,0.1);',
        'transform:translateY(100%);transition:transform .25s cubic-bezier(.16,1,.3,1);',
        'padding-bottom:max(14px,env(safe-area-inset-bottom));}',
      '#cat-cart-bar.visible{transform:translateY(0);}',
      '#cat-cart-bar-inner{',
        'display:flex;align-items:center;justify-content:space-between;',
        'background:linear-gradient(135deg,#7c3aed,#6d28d9);',
        'border-radius:14px;padding:13px 16px;cursor:pointer;',
        'box-shadow:0 8px 30px rgba(124,58,237,0.4);',
        '-webkit-tap-highlight-color:transparent;}',
      '#cat-cart-left{display:flex;align-items:center;gap:10px;}',
      '#cat-cart-badge{background:rgba(255,255,255,0.25);color:#fff;',
        'font-size:11px;font-weight:800;width:22px;height:22px;border-radius:50%;',
        'display:flex;align-items:center;justify-content:center;}',
      '#cat-cart-label{color:#fff;font-size:14px;font-weight:700;}',
      '#cat-cart-total-preview{color:rgba(255,255,255,0.85);font-size:14px;font-weight:700;}',

      /* --- cart drawer overlay --- */
      '#cat-cart-overlay{position:fixed;inset:0;z-index:300;',
        'background:rgba(0,0,0,0);',
        'pointer-events:none;transition:background .25s;}',
      '#cat-cart-overlay.open{background:rgba(0,0,0,0.72);pointer-events:auto;}',
      '#cat-cart-drawer{position:absolute;bottom:0;left:0;right:0;',
        'background:#18181f;',
        'border-top-left-radius:22px;border-top-right-radius:22px;',
        'border-top:1px solid rgba(255,255,255,0.1);',
        'max-height:85vh;display:flex;flex-direction:column;',
        'transform:translateY(100%);',
        'transition:transform .3s cubic-bezier(.16,1,.3,1);}',
      '#cat-cart-overlay.open #cat-cart-drawer{transform:translateY(0);}',
      '#cat-cart-dh{padding:16px 18px 12px;',
        'display:flex;align-items:center;justify-content:space-between;',
        'border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;}',
      '#cat-cart-title{font-size:17px;font-weight:800;color:#fff;}',
      '#cat-cart-close{background:rgba(255,255,255,0.08);border:none;',
        'color:rgba(240,240,246,0.7);font-size:16px;cursor:pointer;',
        'width:32px;height:32px;border-radius:50%;',
        'display:flex;align-items:center;justify-content:center;}',
      '#cat-cart-items{overflow-y:auto;flex:1;padding:6px 0;}',
      '#cat-cart-empty-msg{padding:40px 20px;text-align:center;',
        'color:rgba(240,240,246,0.35);font-size:14px;}',

      /* --- cart item row --- */
      '.cart-item{display:flex;align-items:center;gap:10px;',
        'padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.05);}',
      '.cart-item:last-child{border-bottom:none;}',
      '.ci-thumb{width:44px;height:44px;border-radius:9px;',
        'background:rgba(255,255,255,0.06);flex-shrink:0;overflow:hidden;',
        'display:flex;align-items:center;justify-content:center;}',
      '.ci-thumb img{width:100%;height:100%;object-fit:cover;}',
      '.ci-thumb-mono{font-size:14px;font-weight:900;color:rgba(255,255,255,0.3);}',
      '.ci-info{flex:1;min-width:0;}',
      '.ci-name{font-size:13px;font-weight:700;color:#f0f0f6;',
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.ci-price{font-size:12px;color:rgba(240,240,246,0.5);margin-top:2px;}',
      '.ci-controls{display:flex;align-items:center;gap:6px;flex-shrink:0;}',
      '.qty-btn{width:28px;height:28px;border-radius:8px;border:none;cursor:pointer;',
        'background:rgba(255,255,255,0.08);color:#fff;',
        'font-size:16px;font-weight:700;',
        'display:flex;align-items:center;justify-content:center;',
        '-webkit-tap-highlight-color:transparent;}',
      '.qty-btn:active{background:rgba(255,255,255,0.15);}',
      '.qty-btn[disabled]{opacity:0.28;cursor:not-allowed;pointer-events:none;}',
      '.ci-stock-max{font-size:10px;color:#f87171;font-weight:600;margin-top:3px;}',
      '.qty-val{font-size:14px;font-weight:700;color:#fff;min-width:20px;text-align:center;}',
      '.ci-remove{width:28px;height:28px;border-radius:8px;border:none;cursor:pointer;',
        'background:rgba(239,68,68,0.12);color:#f87171;',
        'font-size:14px;display:flex;align-items:center;justify-content:center;',
        '-webkit-tap-highlight-color:transparent;}',

      /* --- cart footer --- */
      '#cat-cart-footer{padding:14px 16px;border-top:1px solid rgba(255,255,255,0.08);',
        'flex-shrink:0;',
        'padding-bottom:max(16px,env(safe-area-inset-bottom));}',
      '#cat-total-row{display:flex;justify-content:space-between;align-items:center;',
        'margin-bottom:12px;}',
      '#cat-total-label{font-size:13px;color:rgba(240,240,246,0.5);font-weight:600;}',
      '#cat-total-amount{font-size:20px;font-weight:900;color:#fff;letter-spacing:-.5px;}',
      '#cat-checkout-btn{width:100%;padding:15px;border-radius:14px;border:none;',
        'background:#25d366;color:#fff;font-size:15px;font-weight:800;',
        'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;',
        'box-shadow:0 6px 24px rgba(37,211,102,0.35);',
        'transition:all .15s;letter-spacing:-.2px;',
        '-webkit-tap-highlight-color:transparent;}',
      '#cat-checkout-btn:active{transform:scale(.97);}',
      '#cat-checkout-btn:disabled{opacity:.5;cursor:not-allowed;}',

      /* --- lightbox --- */
      '#cat-lightbox{position:fixed;inset:0;z-index:500;',
        'background:rgba(0,0,0,0.94);',
        'display:none;align-items:center;justify-content:center;',
        'flex-direction:column;gap:14px;padding:20px;}',
      '#cat-lightbox.open{display:flex;}',
      '#cat-lb-img{max-width:100%;max-height:80vh;',
        'border-radius:12px;object-fit:contain;}',
      '#cat-lb-close{position:absolute;top:16px;right:16px;',
        'background:rgba(255,255,255,0.12);border:none;color:#fff;',
        'width:38px;height:38px;border-radius:50%;font-size:18px;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;}',
      '#cat-lb-nav{display:none;align-items:center;gap:20px;}',
      '#cat-lightbox.multi #cat-lb-nav{display:flex;}',
      '.cat-lb-arr{background:rgba(255,255,255,0.12);border:none;color:#fff;',
        'width:44px;height:44px;border-radius:50%;font-size:24px;cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;}',
      '.cat-lb-arr:disabled{opacity:0.25;pointer-events:none;}',
      '#cat-lb-counter{font-size:13px;font-weight:600;color:rgba(255,255,255,0.55);',
        'min-width:40px;text-align:center;}',

      /* --- footer branding CTA --- */
      '#cat-branding{padding:12px 20px 16px;text-align:center;}',
      '#cat-branding-link{display:inline-flex;flex-direction:column;align-items:center;',
        'gap:5px;text-decoration:none;',
        'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);',
        'border-radius:14px;padding:12px 20px;',
        'transition:all .2s;-webkit-tap-highlight-color:transparent;}',
      '#cat-branding-link:active{background:rgba(124,58,237,0.1);',
        'border-color:rgba(124,58,237,0.3);}',
      '#cat-branding-label{font-size:12px;color:rgba(240,240,246,0.35);font-weight:500;}',
      '#cat-branding-btn{font-size:13px;font-weight:800;',
        'color:rgba(167,139,250,0.8);letter-spacing:-.2px;}',

      /* --- util --- */
      '.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}',

      /* --- image swipe strip --- */
      /* Outer clip — same aspect-ratio as the original thumb */
      '.cat-swipe-strip{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;',
        'background:rgba(255,255,255,0.04);flex-shrink:0;cursor:grab;}',
      '.cat-swipe-strip:active{cursor:grabbing;}',
      /* Inner track slides horizontally */
      '.cat-swipe-track{display:flex;height:100%;',
        'transition:transform .28s cubic-bezier(.4,0,.2,1);',
        'will-change:transform;}',
      '.cat-swipe-track.no-transition{transition:none;}',
      '.cat-swipe-slide{flex:0 0 100%;height:100%;position:relative;overflow:hidden;}',
      '.cat-swipe-slide img{width:100%;height:100%;object-fit:cover;display:block;',
        'pointer-events:none;-webkit-user-drag:none;user-select:none;}',
      /* Dots stay overlaid on the strip */
      '.cat-swipe-dots{position:absolute;bottom:7px;left:0;right:0;',
        'display:flex;justify-content:center;gap:4px;pointer-events:none;z-index:2;}',
      '.cat-swipe-dot{width:5px;height:5px;border-radius:50%;',
        'transition:background .2s,transform .2s;display:inline-block;}',
      '.cat-swipe-dot.on{background:#fff;transform:scale(1.25);}',
      '.cat-swipe-dot.off{background:rgba(255,255,255,0.35);}',
      /* Tap hint — fades in then out on first render of dual-image card */
      '.cat-swipe-hint{position:absolute;bottom:24px;left:0;right:0;',
        'display:flex;justify-content:center;pointer-events:none;z-index:3;}',
      '.cat-swipe-hint span{font-size:10px;font-weight:700;letter-spacing:.3px;',
        'color:rgba(255,255,255,0.7);background:rgba(0,0,0,0.55);',
        'border-radius:100px;padding:3px 9px;',
        'animation:cat-hint-fade 2.4s ease forwards;}',
      '@keyframes cat-hint-fade{0%{opacity:0}15%{opacity:1}70%{opacity:1}100%{opacity:0}}',

      /* --- description expand/collapse --- */
      '.cat-desc-wrap{border-top:1px solid rgba(255,255,255,0.06);margin:0 10px;}',
      '.cat-desc-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;',
        'padding:7px 0;background:none;border:none;cursor:pointer;',
        'color:rgba(240,240,246,0.45);font-size:10.5px;font-weight:700;',
        'letter-spacing:.4px;text-transform:uppercase;',
        '-webkit-tap-highlight-color:transparent;}',
      '.cat-desc-arrow{font-size:9px;transition:transform .22s;display:inline-block;}',
      '.cat-desc-arrow.up{transform:rotate(180deg);}',
      /* Height animation via max-height trick */
      '.cat-desc-body{max-height:0;overflow:hidden;',
        'transition:max-height .28s cubic-bezier(.4,0,.2,1);}',
      '.cat-desc-body.open{max-height:200px;}',
      '.cat-desc-text{font-size:12px;line-height:1.65;',
        'color:rgba(240,240,246,0.65);padding:2px 0 10px;}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ── 5. BUILD HTML SHELL ─────────────────────────────────────────────── */
  // All structure created via createElement — no innerHTML with user data.

  function buildShell() {
    // Remove landing page / any existing catalog
    var existing = document.getElementById('qs-catalog');
    if (existing) existing.remove();

    var root = document.createElement('div');
    root.id = 'qs-catalog';

    // Header
    var hdr = document.createElement('header');
    hdr.id = 'cat-hdr';
    hdr.setAttribute('role', 'banner');
    var avatar = document.createElement('div');
    avatar.id = 'cat-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    var sinfo = document.createElement('div');
    sinfo.id = 'cat-store-info';
    var sname = document.createElement('div');
    sname.id = 'cat-store-name';
    sname.textContent = 'Loading…';
    var ssub = document.createElement('div');
    ssub.id = 'cat-store-sub';
    ssub.textContent = 'WhatsApp catalog';
    var sstat = document.createElement('div');
    sstat.id = 'cat-status';
    var dot = document.createElement('span');
    dot.className = 'cat-live-dot';
    dot.setAttribute('aria-hidden', 'true');
    var stxt = document.createElement('span');
    stxt.id = 'cat-status-text';
    stxt.textContent = 'OPEN NOW';
    sstat.appendChild(dot);
    sstat.appendChild(stxt);
    sinfo.appendChild(sname);
    sinfo.appendChild(ssub);
    sinfo.appendChild(sstat);
    hdr.appendChild(avatar);
    hdr.appendChild(sinfo);
    root.appendChild(hdr);

    // Search
    var sw = document.createElement('div');
    sw.id = 'cat-search-wrap';
    var si = document.createElement('input');
    si.id = 'cat-search';
    si.type = 'search';
    si.placeholder = 'Search products…';
    si.setAttribute('aria-label', 'Search products');
    si.setAttribute('autocomplete', 'off');
    si.setAttribute('spellcheck', 'false');
    sw.appendChild(si);
    root.appendChild(sw);

    // Tagline strip — hidden until populated
    var taglineEl = document.createElement('p');
    taglineEl.id = 'cat-tagline';
    taglineEl.setAttribute('aria-label', 'Store tagline');
    root.appendChild(taglineEl);

    // Category chips
    var chips = document.createElement('div');
    chips.id = 'cat-chips';
    chips.setAttribute('role', 'list');
    chips.setAttribute('aria-label', 'Filter by category');
    root.appendChild(chips);

    // Results bar
    var rb = document.createElement('div');
    rb.id = 'cat-results-bar';
    root.appendChild(rb);

    // Skeleton placeholders (shown during fetch)
    var skels = document.createElement('div');
    skels.id = 'cat-skeletons';
    for (var sk = 0; sk < 6; sk++) {
      var sc = document.createElement('div');
      sc.className = 'cat-skel';
      var st = document.createElement('div'); st.className = 'cat-skel-thumb';
      var sl = document.createElement('div'); sl.className = 'cat-skel-lines';
      var sl1 = document.createElement('div'); sl1.className = 'cat-skel-line';
      var sl2 = document.createElement('div'); sl2.className = 'cat-skel-line short';
      var sb2 = document.createElement('div'); sb2.className = 'cat-skel-btn';
      sl.appendChild(sl1); sl.appendChild(sl2);
      sc.appendChild(st); sc.appendChild(sl); sc.appendChild(sb2);
      skels.appendChild(sc);
    }
    root.appendChild(skels);

    // Product grid
    var grid = document.createElement('div');
    grid.id = 'cat-grid';
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Products');
    root.appendChild(grid);

    // Empty state
    var empty = document.createElement('div');
    empty.id = 'cat-empty';
    empty.setAttribute('role', 'status');
    var ei = document.createElement('div'); ei.className = 'cat-state-icon'; ei.textContent = '📦';
    var et = document.createElement('div'); et.className = 'cat-state-title'; et.textContent = 'No products found';
    var es = document.createElement('div'); es.className = 'cat-state-sub';
    es.textContent = 'Try a different search or category filter.';
    empty.appendChild(ei); empty.appendChild(et); empty.appendChild(es);
    root.appendChild(empty);

    // Error state
    var err = document.createElement('div');
    err.id = 'cat-error';
    err.setAttribute('role', 'alert');
    var erri = document.createElement('div'); erri.className = 'cat-state-icon'; erri.textContent = '⚠️';
    var errt = document.createElement('div'); errt.className = 'cat-state-title'; errt.textContent = 'Catalog unavailable';
    var errs = document.createElement('div'); errs.className = 'cat-state-sub';
    errs.id = 'cat-error-msg';
    errs.textContent = 'This link may have expired or the store may be offline.';
    err.appendChild(erri); err.appendChild(errt); err.appendChild(errs);
    root.appendChild(err);

    // Cart bar (sticky bottom)
    var bar = document.createElement('div');
    bar.id = 'cat-cart-bar';
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', 'View your cart');
    bar.setAttribute('tabindex', '0');
    var bari = document.createElement('div');
    bari.id = 'cat-cart-bar-inner';
    var barl = document.createElement('div');
    barl.id = 'cat-cart-left';
    var badge = document.createElement('div');
    badge.id = 'cat-cart-badge';
    badge.setAttribute('aria-live', 'polite');
    var blabel = document.createElement('div');
    blabel.id = 'cat-cart-label';
    blabel.textContent = 'View Cart';
    barl.appendChild(badge);
    barl.appendChild(blabel);
    var bprice = document.createElement('div');
    bprice.id = 'cat-cart-total-preview';
    bari.appendChild(barl);
    bari.appendChild(bprice);
    bar.appendChild(bari);
    document.body.appendChild(bar); // outside root so it overlays correctly

    // Cart drawer overlay
    var overlay = document.createElement('div');
    overlay.id = 'cat-cart-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cat-cart-title');
    overlay.setAttribute('aria-hidden', 'true');
    var drawer = document.createElement('div');
    drawer.id = 'cat-cart-drawer';
    // Drawer header
    var dh = document.createElement('div');
    dh.id = 'cat-cart-dh';
    var dt = document.createElement('h2');
    dt.id = 'cat-cart-title';
    dt.textContent = 'Your Cart';
    var dc = document.createElement('button');
    dc.id = 'cat-cart-close';
    dc.type = 'button';
    dc.setAttribute('aria-label', 'Close cart');
    dc.textContent = '✕';
    dh.appendChild(dt);
    dh.appendChild(dc);
    // Drawer items
    var ditems = document.createElement('div');
    ditems.id = 'cat-cart-items';
    // Drawer footer
    var dfoot = document.createElement('div');
    dfoot.id = 'cat-cart-footer';
    var dtotalrow = document.createElement('div');
    dtotalrow.id = 'cat-total-row';
    var dtlabel = document.createElement('span');
    dtlabel.id = 'cat-total-label';
    dtlabel.textContent = 'Total';
    var dtamt = document.createElement('span');
    dtamt.id = 'cat-total-amount';
    dtotalrow.appendChild(dtlabel);
    dtotalrow.appendChild(dtamt);
    var chkbtn = document.createElement('button');
    chkbtn.id = 'cat-checkout-btn';
    chkbtn.type = 'button';
    chkbtn.setAttribute('aria-label', 'Send order via WhatsApp');
    // WhatsApp icon SVG (static, no user data)
    var waSvgNS = 'http://www.w3.org/2000/svg';
    var waSvg = document.createElementNS(waSvgNS, 'svg');
    waSvg.setAttribute('viewBox','0 0 24 24'); waSvg.setAttribute('fill','currentColor');
    waSvg.setAttribute('width','18'); waSvg.setAttribute('height','18');
    waSvg.setAttribute('aria-hidden','true');
    var waPath = document.createElementNS(waSvgNS, 'path');
    waPath.setAttribute('d','M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z');
    waSvg.appendChild(waPath);
    chkbtn.appendChild(waSvg);
    chkbtn.appendChild(document.createTextNode(' Order via WhatsApp'));
    dfoot.appendChild(dtotalrow);
    dfoot.appendChild(chkbtn);
    drawer.appendChild(dh);
    drawer.appendChild(ditems);
    drawer.appendChild(dfoot);
    overlay.appendChild(drawer);
    document.body.appendChild(overlay); // outside root, full screen

    // Lightbox
    var lb = document.createElement('div');
    lb.id = 'cat-lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Product image');
    var lbc = document.createElement('button');
    lbc.id = 'cat-lb-close';
    lbc.type = 'button';
    lbc.setAttribute('aria-label', 'Close image');
    lbc.textContent = '✕';
    var lbimg = document.createElement('img');
    lbimg.id = 'cat-lb-img';
    lbimg.alt = '';
    var lbnav = document.createElement('div');
    lbnav.id = 'cat-lb-nav';
    var lbprevBtn = document.createElement('button');
    lbprevBtn.id = 'cat-lb-prev';
    lbprevBtn.type = 'button';
    lbprevBtn.className = 'cat-lb-arr';
    lbprevBtn.setAttribute('aria-label', 'Previous image');
    lbprevBtn.textContent = '‹';
    var lbctr = document.createElement('span');
    lbctr.id = 'cat-lb-counter';
    lbctr.textContent = '1 / 2';
    var lbnextBtn = document.createElement('button');
    lbnextBtn.id = 'cat-lb-next';
    lbnextBtn.type = 'button';
    lbnextBtn.className = 'cat-lb-arr';
    lbnextBtn.setAttribute('aria-label', 'Next image');
    lbnextBtn.textContent = '›';
    lbnav.appendChild(lbprevBtn);
    lbnav.appendChild(lbctr);
    lbnav.appendChild(lbnextBtn);
    lb.appendChild(lbc);
    lb.appendChild(lbimg);
    lb.appendChild(lbnav);
    document.body.appendChild(lb);

    // Branding CTA footer — links to landing page
    var brand = document.createElement('div');
    brand.id = 'cat-branding';
    var brandLink = document.createElement('a');
    brandLink.id = 'cat-branding-link';
    brandLink.href = window.location.origin + '/';
    brandLink.target = '_blank';
    brandLink.rel = 'noopener noreferrer';
    brandLink.setAttribute('aria-label', 'Create your own catalog with QuickShop');
    var brandTop = document.createElement('div');
    brandTop.id = 'cat-branding-label';
    brandTop.textContent = 'Want a catalog like this?';
    var brandBtn = document.createElement('div');
    brandBtn.id = 'cat-branding-btn';
    brandBtn.textContent = 'Create yours free → QuickShop';
    brandLink.appendChild(brandTop);
    brandLink.appendChild(brandBtn);
    brand.appendChild(brandLink);
    root.appendChild(brand);

    document.body.appendChild(root);
    return root;
  }

  /* ── 6. SHOW ERROR STATE ─────────────────────────────────────────────── */

  function showError(msg) {
    var skels = document.getElementById('cat-skeletons');
    var grid  = document.getElementById('cat-grid');
    var err   = document.getElementById('cat-error');
    var emsg  = document.getElementById('cat-error-msg');
    if (skels) skels.style.display = 'none';
    if (grid)  grid.style.display  = 'none';
    if (emsg && msg) emsg.textContent = msg;
    if (err) err.classList.add('show');
  }

  /* ── 7. STORE RESOLUTION ─────────────────────────────────────────────── */
  // Returns effectiveStoreId string or null.

  // UUID pattern — 8-4-4-4-12 hex chars
  var _uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function resolveStore(client) {
    if (STORE_ID) {
      if (!_validStoreId) {
        showError('Invalid store link. Please ask the seller for a valid link.');
        return null;
      }

      // If it looks like a UUID, use it directly as the user_id
      if (_uuidPattern.test(STORE_ID)) return STORE_ID;

      // Otherwise treat it as a business slug — look up in profiles
      try {
        var sr = await client
          .from('profiles')
          .select('id')
          .eq('slug', STORE_ID)
          .maybeSingle();
        if (sr.data && sr.data.id) return sr.data.id;
        showError('Store not found. Please ask the seller for a valid link.');
        return null;
      } catch (e) {
        return null;
      }
    }

    // Fall back to opaque token → share_links table lookup
    if (!TOKEN) return null;
    try {
      var r = await client
        .from('share_links')
        .select('store_id, expires_at')
        .eq('token', TOKEN)
        .maybeSingle();
      if (r.error || !r.data) return null;
      if (r.data.expires_at && new Date(r.data.expires_at) < new Date()) {
        showError('This catalog link has expired. Please ask the seller for a new one.');
        return null;
      }
      return r.data.store_id || null;
    } catch (e) {
      return null;
    }
  }

  /* ── 8. RENDER CATEGORY CHIPS ───────────────────────────────────────── */

  var activeCategory = 'All';
  var allProducts    = [];
  var searchQuery    = '';

  function renderChips(categories) {
    var container = document.getElementById('cat-chips');
    if (!container) return;
    container.innerHTML = '';
    var cats = ['All'].concat(categories);
    cats.forEach(function (cat) {
      var chip = document.createElement('button');
      chip.className = 'cat-chip' + (cat === activeCategory ? ' active' : '');
      chip.type = 'button';
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('aria-pressed', cat === activeCategory ? 'true' : 'false');
      chip.textContent = cat;
      chip.dataset.cat = cat;
      container.appendChild(chip);
    });
  }

  /* ── 9. FILTER PRODUCTS (client-side) ───────────────────────────────── */

  function filteredProducts() {
    var q = searchQuery.toLowerCase().trim();
    return allProducts.filter(function (p) {
      var catMatch = (activeCategory === 'All') || (p.category === activeCategory);
      if (!catMatch) return false;
      if (!q) return true;
      return (p.name || '').toLowerCase().indexOf(q) !== -1 ||
             (p.category || '').toLowerCase().indexOf(q) !== -1 ||
             (p.barcode || '').indexOf(q) !== -1;
    });
  }

  /* ── 10. BUILD PRODUCT CARD (DOM only, no innerHTML with user data) ─── */

  function buildCard(p) {
    var inStock = typeof p.qty !== 'number' || p.qty > 0;
    var lowStock = inStock && typeof p.qty === 'number' && p.qty <= 3 && p.qty > 0;
    var images = [p.image_url, p.image_url2].filter(Boolean);

    var card = document.createElement('div');
    card.className = 'cat-card' + (!inStock ? ' oos' : '');
    card.setAttribute('role', 'listitem');
    card.dataset.id = p.id;

    /* ── Thumb ── */
    var thumb = document.createElement('div');
    thumb.className = 'cat-thumb';
    thumb.dataset.productId = p.id;

    if (images.length > 1) {
      // ── Dual images: swipeable strip ────────────────────────────────────
      // Replace plain thumb with a swipe-capable strip so images slide
      // horizontally. Info and description stay anchored — never move.
      thumb.className = 'cat-swipe-strip';
      thumb.dataset.productId = p.id;

      var track = document.createElement('div');
      track.className = 'cat-swipe-track';

      images.forEach(function (src, i) {
        var slide = document.createElement('div');
        slide.className = 'cat-swipe-slide';
        var img = document.createElement('img');
        img.src     = src;
        img.alt     = (p.name || '') + (images.length > 1 ? ' — photo ' + (i + 1) : '');
        img.loading = i === 0 ? 'eager' : 'lazy';
        slide.appendChild(img);
        track.appendChild(slide);
      });
      thumb.appendChild(track);

      // Dots
      var swipeDots = document.createElement('div');
      swipeDots.className = 'cat-swipe-dots';
      swipeDots.setAttribute('aria-hidden', 'true');
      images.forEach(function (_, i) {
        var d = document.createElement('span');
        d.className = 'cat-swipe-dot ' + (i === 0 ? 'on' : 'off');
        swipeDots.appendChild(d);
      });
      thumb.appendChild(swipeDots);

      // Swipe hint — shows once then fades
      var hint = document.createElement('div');
      hint.className = 'cat-swipe-hint';
      var hintSpan = document.createElement('span');
      hintSpan.textContent = 'swipe';
      hint.appendChild(hintSpan);
      thumb.appendChild(hint);

      // Store metadata for swipe handler and lightbox
      thumb.dataset.images    = JSON.stringify(images);
      thumb.dataset.swipeIdx  = '0';
      thumb.dataset.lightboxAlt = p.name || '';

    } else if (images.length === 1) {
      // Single image — tap opens lightbox
      var imgEl = document.createElement('img');
      imgEl.src     = images[0];
      imgEl.alt     = p.name || '';
      imgEl.loading = 'lazy';
      imgEl.dataset.imgIndex = '0';
      imgEl.dataset.productId = p.id;
      thumb.appendChild(imgEl);
      thumb.dataset.lightboxSrc  = images[0];
      thumb.dataset.lightboxAlt  = p.name || '';
      thumb.style.cursor = 'zoom-in';
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('aria-label', 'View full image of ' + (p.name || 'product'));

    } else if (p.icon && p.icon.trim()) {
      var emojiSpan = document.createElement('span');
      emojiSpan.className = 'cat-emoji';
      emojiSpan.setAttribute('aria-hidden', 'true');
      emojiSpan.textContent = p.icon;
      thumb.appendChild(emojiSpan);
    } else {
      var monoSpan = document.createElement('span');
      monoSpan.className = 'cat-mono';
      monoSpan.setAttribute('aria-hidden', 'true');
      monoSpan.textContent = mono(p.name);
      thumb.appendChild(monoSpan);
    }

    // Stock badge
    if (!inStock) {
      var oosBadge = document.createElement('span');
      oosBadge.className = 'cat-badge cat-badge-oos';
      oosBadge.textContent = 'Out of stock';
      thumb.appendChild(oosBadge);
    } else if (lowStock) {
      var lowBadge = document.createElement('span');
      lowBadge.className = 'cat-badge cat-badge-low';
      lowBadge.textContent = 'Only ' + p.qty + ' left';
      thumb.appendChild(lowBadge);
    }

    card.appendChild(thumb);

    /* ── Info ── */
    var info = document.createElement('div');
    info.className = 'cat-info';
    var catLabel = document.createElement('div');
    catLabel.className = 'cat-cat';
    catLabel.textContent = p.category || 'General';
    var nameEl = document.createElement('div');
    nameEl.className = 'cat-name';
    nameEl.textContent = p.name || 'Product';
    var priceEl = document.createElement('div');
    priceEl.className = 'cat-price';
    priceEl.textContent = fmt(p.price || 0);
    info.appendChild(catLabel);
    info.appendChild(nameEl);
    info.appendChild(priceEl);
    // Stock count — show when qty is known and <= 10 (creates urgency, hides for large stock)
    if (typeof p.qty === 'number' && p.qty > 0 && p.qty <= 10) {
      var stockEl = document.createElement('div');
      stockEl.className = 'cat-stock';
      stockEl.textContent = p.qty + ' in stock';
      info.appendChild(stockEl);
    }
    card.appendChild(info);

    /* ── Description — collapsed, tap to expand ── */
    if (p.description && p.description.trim()) {
      var descWrap = document.createElement('div');
      descWrap.className = 'cat-desc-wrap';

      var descToggle = document.createElement('button');
      descToggle.className = 'cat-desc-toggle';
      descToggle.type = 'button';
      descToggle.setAttribute('aria-expanded', 'false');
      var toggleText = document.createElement('span');
      toggleText.textContent = 'Details';
      var toggleArrow = document.createElement('span');
      toggleArrow.className = 'cat-desc-arrow';
      toggleArrow.setAttribute('aria-hidden', 'true');
      descToggle.appendChild(toggleText);
      descToggle.appendChild(toggleArrow);

      var descBody = document.createElement('div');
      descBody.className = 'cat-desc-body';
      descBody.setAttribute('aria-hidden', 'true');
      var descText = document.createElement('p');
      descText.className = 'cat-desc-text';
      descText.textContent = p.description; // textContent — safe, no XSS
      descBody.appendChild(descText);

      descToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var expanded = descToggle.getAttribute('aria-expanded') === 'true';
        descToggle.setAttribute('aria-expanded', String(!expanded));
        descBody.setAttribute('aria-hidden', String(expanded));
        descBody.classList.toggle('open', !expanded);
        toggleArrow.classList.toggle('up', !expanded);
      });

      descWrap.appendChild(descToggle);
      descWrap.appendChild(descBody);
      card.appendChild(descWrap);
    }

    /* ── Add to Cart button ── */
    if (inStock) {
      var addBtn = document.createElement('button');
      addBtn.className = 'cat-add-btn' + (cart.has(p.id) ? ' in-cart' : '');
      addBtn.type = 'button';
      addBtn.dataset.productId = p.id;
      addBtn.setAttribute('aria-label',
        (cart.has(p.id) ? 'Added to cart: ' : 'Add to cart: ') + (p.name || 'product'));
      var btnIcon = document.createElement('span');
      btnIcon.className = 'cat-btn-icon';
      btnIcon.setAttribute('aria-hidden', 'true');
      var btnText = document.createElement('span');
      btnText.textContent = cart.has(p.id) ? 'Added' : 'Add to Cart';
      addBtn.appendChild(btnIcon);
      addBtn.appendChild(btnText);
      card.appendChild(addBtn);
    } else {
      var oosBtn = document.createElement('div');
      oosBtn.className = 'cat-add-btn';
      oosBtn.setAttribute('disabled', '');
      oosBtn.setAttribute('aria-disabled', 'true');
      oosBtn.textContent = 'Out of stock';
      card.appendChild(oosBtn);
    }

    return card;
  }

  /* ── 11. RENDER PRODUCT GRID ─────────────────────────────────────────── */

  function renderGrid() {
    var grid  = document.getElementById('cat-grid');
    var empty = document.getElementById('cat-empty');
    var rb    = document.getElementById('cat-results-bar');
    if (!grid) return;

    var filtered = filteredProducts();
    grid.innerHTML = '';

    if (filtered.length === 0) {
      grid.style.display = 'none';
      if (empty) empty.classList.add('show');
    } else {
      grid.style.display = '';
      if (empty) empty.classList.remove('show');
      filtered.forEach(function (p) {
        grid.appendChild(buildCard(p));
      });
    }

    if (rb) {
      rb.textContent = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '');
    }
  }

  /* ── 12. CART UI ─────────────────────────────────────────────────────── */

  function refreshCartUI() {
    var count = cartCount();
    var total = cartTotal();

    // Cart bar
    var bar   = document.getElementById('cat-cart-bar');
    var badge = document.getElementById('cat-cart-badge');
    var prev  = document.getElementById('cat-cart-total-preview');
    if (bar) {
      if (count > 0) { bar.classList.add('visible'); }
      else           { bar.classList.remove('visible'); }
    }
    if (badge) badge.textContent = count;
    if (prev)  prev.textContent  = fmt(total);

    // Update add-to-cart buttons on grid
    var grid = document.getElementById('cat-grid');
    if (grid) {
      // Sync all add-to-cart buttons with current cart state
      grid.querySelectorAll('.cat-add-btn').forEach(function (btn) {
        var pid = btn.dataset.productId;
        if (!pid) return;
        var inCart = cart.has(pid);
        btn.classList.toggle('in-cart', inCart);
        var txt = btn.querySelector('span:not(.cat-btn-icon)');
        if (txt) txt.textContent = inCart ? 'Added' : 'Add to Cart';
      });
    }

    // Re-render drawer items if drawer is open
    var overlay = document.getElementById('cat-cart-overlay');
    if (overlay && overlay.classList.contains('open')) {
      renderCartItems();
    }
  }

  function buildCartRow(p, qty) {
    var maxStock = (typeof p.qty === 'number') ? p.qty : Infinity;
    var atMax = (qty >= maxStock);
    var row = document.createElement('div');
    row.className = 'cart-item';
    row.dataset.productId = p.id;

    var cthumb = document.createElement('div');
    cthumb.className = 'ci-thumb';
    if (p.image_url) {
      var cimg = document.createElement('img');
      cimg.src = p.image_url; cimg.alt = p.name || ''; cimg.loading = 'lazy';
      cthumb.appendChild(cimg);
    } else {
      var cm = document.createElement('span');
      cm.className = 'ci-thumb-mono';
      cm.setAttribute('aria-hidden', 'true');
      cm.textContent = mono(p.name);
      cthumb.appendChild(cm);
    }

    var cinfo = document.createElement('div');
    cinfo.className = 'ci-info';
    var cname = document.createElement('div');
    cname.className = 'ci-name';
    cname.textContent = p.name || 'Product';
    var cprice = document.createElement('div');
    cprice.className = 'ci-price';
    cprice.textContent = qty > 1
      ? fmt(p.price * qty) + ' (' + fmt(p.price) + ' each)'
      : fmt(p.price);
    cinfo.appendChild(cname);
    cinfo.appendChild(cprice);
    if (atMax && maxStock !== Infinity) {
      var hint = document.createElement('div');
      hint.className = 'ci-stock-max';
      hint.textContent = 'Max stock reached';
      cinfo.appendChild(hint);
    }

    var ctrl = document.createElement('div');
    ctrl.className = 'ci-controls';

    var minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn'; minusBtn.type = 'button';
    minusBtn.dataset.action = 'qty-minus'; minusBtn.dataset.productId = p.id;
    minusBtn.setAttribute('aria-label', 'Decrease quantity'); minusBtn.textContent = '−';

    var qtyVal = document.createElement('span');
    qtyVal.className = 'qty-val'; qtyVal.setAttribute('aria-live', 'polite');
    qtyVal.textContent = qty;

    var plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn'; plusBtn.type = 'button';
    plusBtn.dataset.action = 'qty-plus'; plusBtn.dataset.productId = p.id;
    plusBtn.setAttribute('aria-label', 'Increase quantity'); plusBtn.textContent = '+';
    if (atMax) { plusBtn.disabled = true; plusBtn.setAttribute('aria-disabled', 'true'); }

    var removeBtn = document.createElement('button');
    removeBtn.className = 'ci-remove'; removeBtn.type = 'button';
    removeBtn.dataset.action = 'cart-remove'; removeBtn.dataset.productId = p.id;
    removeBtn.setAttribute('aria-label', 'Remove from cart'); removeBtn.textContent = '✕';

    ctrl.appendChild(minusBtn); ctrl.appendChild(qtyVal);
    ctrl.appendChild(plusBtn); ctrl.appendChild(removeBtn);
    row.appendChild(cthumb); row.appendChild(cinfo); row.appendChild(ctrl);
    return row;
  }

  function renderCartItems() {
    var container = document.getElementById('cat-cart-items');
    var totalEl   = document.getElementById('cat-total-amount');
    var chkBtn    = document.getElementById('cat-checkout-btn');
    if (!container) return;

    if (cart.size === 0) {
      container.innerHTML = '';
      var msg = document.createElement('div');
      msg.id = 'cat-cart-empty-msg';
      msg.textContent = 'Your cart is empty. Add some products!';
      container.appendChild(msg);
      if (chkBtn) chkBtn.disabled = true;
      if (totalEl) totalEl.textContent = fmt(0);
      return;
    }
    if (chkBtn) chkBtn.disabled = false;

    // Remove empty msg if present
    var emptyMsg = container.querySelector('#cat-cart-empty-msg');
    if (emptyMsg) emptyMsg.remove();

    // Remove rows for items no longer in cart
    container.querySelectorAll('.cart-item[data-product-id]').forEach(function (row) {
      if (!cart.has(row.dataset.productId)) row.remove();
    });

    // Update existing rows in-place, append new ones — preserves scroll & focus
    cart.forEach(function (entry) {
      var p   = entry.product;
      var qty = entry.qty;
      var maxStock = (typeof p.qty === 'number') ? p.qty : Infinity;
      var atMax = (qty >= maxStock);
      var existing = container.querySelector('.cart-item[data-product-id="' + p.id + '"]');
      if (existing) {
        var qv = existing.querySelector('.qty-val');
        if (qv) qv.textContent = qty;
        var cp = existing.querySelector('.ci-price');
        if (cp) cp.textContent = qty > 1
          ? fmt(p.price * qty) + ' (' + fmt(p.price) + ' each)'
          : fmt(p.price);
        var pb = existing.querySelector('[data-action="qty-plus"]');
        if (pb) { pb.disabled = atMax; pb.setAttribute('aria-disabled', atMax ? 'true' : 'false'); }
        var hint = existing.querySelector('.ci-stock-max');
        if (atMax && maxStock !== Infinity) {
          if (!hint) {
            var h = document.createElement('div');
            h.className = 'ci-stock-max'; h.textContent = 'Max stock reached';
            var ci = existing.querySelector('.ci-info');
            if (ci) ci.appendChild(h);
          }
        } else if (hint) { hint.remove(); }
      } else {
        container.appendChild(buildCartRow(p, qty));
      }
    });

    if (totalEl) totalEl.textContent = fmt(cartTotal());
  }

    /* ── 13. OPEN / CLOSE CART DRAWER ───────────────────────────────────── */

  var _lastFocusBeforeDrawer = null;

  function openCartDrawer() {
    var overlay = document.getElementById('cat-cart-overlay');
    if (!overlay) return;
    _lastFocusBeforeDrawer = document.activeElement;
    renderCartItems();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    // Focus first interactive element
    var close = document.getElementById('cat-cart-close');
    if (close) setTimeout(function () { close.focus(); }, 310);
  }

  function closeCartDrawer() {
    var overlay = document.getElementById('cat-cart-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (_lastFocusBeforeDrawer && _lastFocusBeforeDrawer.focus) {
      setTimeout(function () { _lastFocusBeforeDrawer.focus(); }, 50);
    }
  }

  /* ── 14. WHATSAPP CHECKOUT ───────────────────────────────────────────── */

  function buildWhatsAppMessage(storeName) {
    var lines = ['\uD83D\uDED2 New order from *' + (storeName || 'your catalog') + '*:\n'];
    cart.forEach(function (entry) {
      var p    = entry.product;
      var line = '\u2022 ' + entry.qty + '\u00D7 ' + (p.name || 'Product')
               + ' \u2014 ' + fmt(p.price * entry.qty);
      if (entry.qty > 1) line += ' (' + fmt(p.price) + ' each)';
      lines.push(line);
    });
    lines.push('');
    lines.push('*Total: ' + fmt(cartTotal()) + '*');
    lines.push('\nPlease confirm availability. Thank you! \u{1F64F}');
    return lines.join('\n');
  }

  function doCheckout(storeName) {
    if (cart.size === 0) return;
    var msg  = buildWhatsAppMessage(storeName);
    var href = SELLER_PHONE
      ? 'https://wa.me/' + SELLER_PHONE + '?text=' + encodeURIComponent(msg)
      : 'https://wa.me/?text='                      + encodeURIComponent(msg);
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  /* ── 15. LIGHTBOX ────────────────────────────────────────────────────── */

  var _lbImages = [];
  var _lbIdx    = 0;

  function lbShow(idx) {
    var lbimg   = document.getElementById('cat-lb-img');
    var ctr     = document.getElementById('cat-lb-counter');
    var prevBtn = document.getElementById('cat-lb-prev');
    var nextBtn = document.getElementById('cat-lb-next');
    if (!lbimg) return;
    _lbIdx = idx;
    lbimg.src = _lbImages[idx];
    if (ctr)     ctr.textContent = (idx + 1) + ' / ' + _lbImages.length;
    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === _lbImages.length - 1);
  }

  function openLightbox(images, alt, startIdx) {
    var lb    = document.getElementById('cat-lightbox');
    var lbimg = document.getElementById('cat-lb-img');
    if (!lb || !lbimg) return;
    _lbImages = Array.isArray(images) ? images : [images];
    _lbIdx    = startIdx || 0;
    lbimg.alt = alt || '';
    lb.classList.toggle('multi', _lbImages.length > 1);
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    lbShow(_lbIdx);
    var close = document.getElementById('cat-lb-close');
    if (close) setTimeout(function () { close.focus(); }, 50);
  }

  function closeLightbox() {
    var lb = document.getElementById('cat-lightbox');
    if (lb) { lb.classList.remove('open', 'multi'); lb.setAttribute('aria-hidden', 'true'); }
    var lbimg = document.getElementById('cat-lb-img');
    if (lbimg) { lbimg.src = ''; lbimg.alt = ''; }
    _lbImages = [];
  }

  /* ── 16. EVENT DELEGATION ────────────────────────────────────────────── */
  // Single listener on each container — not per-card. Prevents memory leaks.

  function attachEvents(storeName) {
    /* ── Grid: add-to-cart, thumb tap, swipe, keyboard ── */
    var grid = document.getElementById('cat-grid');
    if (grid) {

      // ── Swipe gesture handler ──────────────────────────────────────────
      // Uses pointer events (works for both touch and mouse).
      // Attached to grid via delegation — one listener, zero per-card cost.
      var _swipe = null; // active swipe state

      function swipeUpdateTrack(strip, idx, animate) {
        var track = strip.querySelector('.cat-swipe-track');
        if (!track) return;
        if (!animate) track.classList.add('no-transition');
        track.style.transform = 'translateX(-' + (idx * 100) + '%)';
        if (!animate) { track.offsetHeight; track.classList.remove('no-transition'); }
        // Update dots
        strip.querySelectorAll('.cat-swipe-dot').forEach(function (d, i) {
          d.className = 'cat-swipe-dot ' + (i === idx ? 'on' : 'off');
        });
        strip.dataset.swipeIdx = String(idx);
      }

      grid.addEventListener('pointerdown', function (e) {
        var strip = e.target.closest('.cat-swipe-strip');
        if (!strip) return;
        var imgs;
        try { imgs = JSON.parse(strip.dataset.images || '[]'); } catch (_) { return; }
        if (imgs.length < 2) return;
        _swipe = {
          strip:   strip,
          images:  imgs,
          startX:  e.clientX,
          startY:  e.clientY,
          idx:     parseInt(strip.dataset.swipeIdx || '0', 10),
          moved:   false,
          canceled: false
        };
        strip.setPointerCapture(e.pointerId);
      });

      grid.addEventListener('pointermove', function (e) {
        if (!_swipe || _swipe.canceled) return;
        var dx = e.clientX - _swipe.startX;
        var dy = e.clientY - _swipe.startY;
        // If more vertical than horizontal — cancel swipe, let page scroll
        if (!_swipe.moved && Math.abs(dy) > Math.abs(dx) + 4) {
          _swipe.canceled = true;
          return;
        }
        if (Math.abs(dx) > 6) {
          _swipe.moved = true;
          e.preventDefault();
          var track = _swipe.strip.querySelector('.cat-swipe-track');
          if (track) {
            var base = _swipe.idx * 100;
            // Rubber-band at edges
            var pct = (dx / _swipe.strip.offsetWidth) * 100;
            if ((_swipe.idx === 0 && dx > 0) || (_swipe.idx === _swipe.images.length - 1 && dx < 0)) {
              pct = pct * 0.25; // resistance
            }
            track.classList.add('no-transition');
            track.style.transform = 'translateX(' + (-base + pct) + '%)';
          }
        }
      }, { passive: false });

      grid.addEventListener('pointerup', function (e) {
        if (!_swipe) return;
        var swipe = _swipe;
        _swipe = null;
        if (swipe.canceled) return;

        var dx = e.clientX - swipe.startX;

        if (!swipe.moved || Math.abs(dx) < 30) {
          // Tap — snap back and open lightbox
          swipeUpdateTrack(swipe.strip, swipe.idx, true);
          if (!swipe.moved) {
            openLightbox(swipe.images, swipe.strip.dataset.lightboxAlt || '', swipe.idx);
          }
          return;
        }

        // Commit swipe
        var newIdx = swipe.idx;
        if (dx < -30 && swipe.idx < swipe.images.length - 1) newIdx++;
        if (dx >  30 && swipe.idx > 0)                        newIdx--;
        swipeUpdateTrack(swipe.strip, newIdx, true);
      });

      grid.addEventListener('pointercancel', function () { _swipe = null; });

      // ── Click handler ──────────────────────────────────────────────────
      grid.addEventListener('click', function (e) {
        var target = e.target;

        // Add to cart
        var addBtn = target.closest('.cat-add-btn');
        if (addBtn && !addBtn.disabled && !addBtn.hasAttribute('disabled')) {
          var pid = addBtn.dataset.productId;
          if (cart.has(pid)) {
            cartRemove(pid);
          } else {
            var product = allProducts.find(function (p) { return p.id === pid; });
            if (product) cartAdd(product);
          }
          return;
        }

        // Single image thumb tap — lightbox
        var singleThumb = target.closest('.cat-thumb[data-lightbox-src]');
        if (singleThumb) {
          openLightbox([singleThumb.dataset.lightboxSrc], singleThumb.dataset.lightboxAlt);
          return;
        }

        // Description toggle — handled by its own listener on the button
        // (event bubbles, no action needed here)
      });

      grid.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var thumb = e.target.closest('.cat-thumb[data-lightbox-src]');
        if (thumb) { e.preventDefault(); openLightbox([thumb.dataset.lightboxSrc], thumb.dataset.lightboxAlt); }
      });
    }

    /* ── Category chips ── */
    var chips = document.getElementById('cat-chips');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var chip = e.target.closest('.cat-chip');
        if (!chip) return;
        activeCategory = chip.dataset.cat || 'All';
        chips.querySelectorAll('.cat-chip').forEach(function (c) {
          var active = c.dataset.cat === activeCategory;
          c.classList.toggle('active', active);
          c.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        renderGrid();
      });
    }

    /* ── Search ── */
    var search = document.getElementById('cat-search');
    if (search) {
      var searchTimer;
      search.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          searchQuery = (search.value || '').trim();
          renderGrid();
        }, 180);
      });
    }

    /* ── Cart bar ── */
    var bar = document.getElementById('cat-cart-bar');
    if (bar) {
      bar.addEventListener('click', openCartDrawer);
      bar.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCartDrawer(); }
      });
    }

    /* ── Cart drawer ── */
    var overlay = document.getElementById('cat-cart-overlay');
    if (overlay) {
      // Close on backdrop click
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeCartDrawer();
      });
      // Focus trap + Escape
      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeCartDrawer(); return; }
        if (e.key !== 'Tab') return;
        var focusable = overlay.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),[tabindex="0"]'
        );
        if (!focusable.length) return;
        var first = focusable[0];
        var last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      // Cart close button
      var dc = document.getElementById('cat-cart-close');
      if (dc) dc.addEventListener('click', closeCartDrawer);

      // Checkout button
      var chk = document.getElementById('cat-checkout-btn');
      if (chk) chk.addEventListener('click', function () { doCheckout(storeName); });

      // Cart item controls (delegated)
      var cartItems = document.getElementById('cat-cart-items');
      if (cartItems) {
        cartItems.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-action]');
          if (!btn) return;
          var action = btn.dataset.action;
          var pid    = btn.dataset.productId;
          if (!pid) return;
          if (action === 'qty-minus') {
            var entry = cart.get(pid);
            // cartSetQty → refreshCartUI → renderCartItems (if drawer open). No extra calls needed.
            if (entry) cartSetQty(pid, entry.qty - 1);
          } else if (action === 'qty-plus') {
            var entry2 = cart.get(pid);
            if (entry2) {
              var maxQty = (typeof entry2.product.qty === 'number') ? entry2.product.qty : Infinity;
              if (entry2.qty < maxQty) cartSetQty(pid, entry2.qty + 1);
            }
          } else if (action === 'cart-remove') {
            // cartRemove → refreshCartUI → renderCartItems (if drawer open).
            cartRemove(pid);
          }
        });
      }
    }

    /* ── Lightbox ── */
    var lb = document.getElementById('cat-lightbox');
    if (lb) {
      lb.addEventListener('click', function (e) {
        if (e.target === lb || e.target.id === 'cat-lb-close') closeLightbox();
      });
      lb.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft'  && _lbIdx > 0) lbShow(_lbIdx - 1);
        if (e.key === 'ArrowRight' && _lbIdx < _lbImages.length - 1) lbShow(_lbIdx + 1);
      });
    }
    var lbprevEl = document.getElementById('cat-lb-prev');
    if (lbprevEl) lbprevEl.addEventListener('click', function () { if (_lbIdx > 0) lbShow(_lbIdx - 1); });
    var lbnextEl = document.getElementById('cat-lb-next');
    if (lbnextEl) lbnextEl.addEventListener('click', function () { if (_lbIdx < _lbImages.length - 1) lbShow(_lbIdx + 1); });
  }

  /* ── 17. MAIN BOOTSTRAP ──────────────────────────────────────────────── */

  var _catalogInitDone = false;
  async function initCatalog() {
    if (_catalogInitDone) return;
    _catalogInitDone = true;
    // Inject styles and build DOM shell immediately — no flash
    injectCSS();
    document.body.classList.add('qs-cat');
    buildShell();

    // Wait for Supabase
    var client = await waitForClient(6000);
    if (!client) {
      showError('Could not connect to the database. Please check your internet connection.');
      return;
    }

    // Resolve store ID
    var storeId = await resolveStore(client);
    if (!storeId) {
      showError('This catalog link is invalid or has expired.');
      return;
    }

    // Fetch profile + products.
    // Strategy: try the security-scoped views first (post-migration).
    // If either view is missing ("not in schema cache"), fall back to querying
    // the underlying tables directly with explicit safe-column selects —
    // this matches the behaviour of the original working catalog code and
    // keeps the catalog functional before the migration is applied.

    async function fetchProducts() {
      // Try view first
      var vr = await client
        .from('public_catalog_products')
        .select('*')
        .eq('user_id', storeId)
        .order('name', { ascending: true });
      if (!vr.error) return vr;

      // View missing — fall back to products table directly.
      // Only select public-safe columns (no cost, no internal fields).
      // qty > 0 filter mirrors the view WHERE clause.
      console.warn('[Catalog] View missing, falling back to products table:', vr.error.message);
      return client
        .from('products')
        .select('id, user_id, name, price, qty, category, image_url, image_url2, icon, description')
        .eq('user_id', storeId)
        .gt('qty', 0)
        .order('name', { ascending: true });
    }

    async function fetchProfile() {
      // Try view first
      var vr = await client
        .from('public_catalog_profiles')
        .select('*')
        .eq('id', storeId)
        .maybeSingle();
      if (!vr.error) return vr;

      // View missing — fall back to profiles table.
      // Explicit columns only — never expose email.
      console.warn('[Catalog] Profile view missing, falling back to profiles table:', vr.error.message);
      return client
        .from('profiles')
        .select('id, name, business_name, tagline')
        .eq('id', storeId)
        .maybeSingle();
    }

    var profileResult, productsResult;
    try {
      var results = await Promise.all([ fetchProfile(), fetchProducts() ]);
      profileResult  = results[0];
      productsResult = results[1];
    } catch (e) {
      showError('Failed to load catalog data. Please try again.');
      return;
    }

    if (productsResult.error) {
      var errMsg = (productsResult.error && productsResult.error.message) || String(productsResult.error);
      console.error('[Catalog] Products fetch error:', productsResult.error);
      showError('Could not load products. (' + errMsg + ')');
      return;
    }

    // Profile
    var profile   = profileResult.data;
    var _rawName = (profile && (profile.business_name || profile.name)) || '';
    var storeName;
    if (_rawName) {
      // Possessive: "Moyinks" → "Moyinks' Store", "James" → "James' Store"
      var _possessive = _rawName.trimEnd().endsWith('s')
        ? _rawName.trimEnd() + "' Store"
        : _rawName.trimEnd() + "'s Store";
      storeName = _possessive;
    } else {
      storeName = 'Our Store';
    }

    // Update header
    var sname = document.getElementById('cat-store-name');
    if (sname) sname.textContent = storeName;

    // Render tagline if vendor has set one
    var taglineDiv = document.getElementById('cat-tagline');
    if (taglineDiv) {
      var tagline = profile && profile.tagline && profile.tagline.trim();
      if (tagline) {
        taglineDiv.textContent = tagline; // textContent — safe, no XSS
        taglineDiv.classList.add('visible');
      }
    }

    var ssub = document.getElementById('cat-store-sub');
    if (ssub) ssub.textContent = 'WhatsApp orders';
    var avatar = document.getElementById('cat-avatar');
    if (avatar) {
      if (profile && profile.avatar_url) {
        // Show real logo/photo
        var avImg = document.createElement('img');
        avImg.src = profile.avatar_url;
        avImg.alt = storeName;
        avatar.innerHTML = '';
        avatar.appendChild(avImg);
      } else {
        // Fallback to initials
        avatar.textContent = mono(_rawName || storeName);
      }
    }

    // Hide skeletons, show grid area
    var skels = document.getElementById('cat-skeletons');
    if (skels) skels.style.display = 'none';

    // Load product data
    allProducts = productsResult.data || [];
    var _ssub = document.getElementById('cat-store-sub');
    if (_ssub) _ssub.textContent = allProducts.length + ' product' + (allProducts.length !== 1 ? 's' : '') + ' · WhatsApp orders';

    // Build category list (unique, sorted)
    var catSet = {};
    allProducts.forEach(function (p) { if (p.category) catSet[p.category] = true; });
    var categories = Object.keys(catSet).sort();

    // Render chips + grid
    renderChips(categories);
    renderGrid();

    // Attach all events (single pass)
    attachEvents(storeName);

    // ── Realtime subscription — live inventory updates ──
    // Supabase pushes a notification any time the vendor's products table changes.
    // We re-fetch the full product list and re-render — no page refresh needed.
    try {
      var realtimeChannel = client
        .channel('catalog-products-' + storeId)
        .on(
          'postgres_changes',
          {
            event:  '*',           // INSERT, UPDATE, DELETE
            schema: 'public',
            table:  'products',
            filter: 'user_id=eq.' + storeId
          },
          function(payload) {
            // Re-fetch and re-render silently
            fetchProducts().then(function(result) {
              if (result.error || !result.data) return;
              allProducts = result.data;

              // Rebuild category chips
              var catSet = {};
              allProducts.forEach(function(p) { if (p.category) catSet[p.category] = true; });
              var categories = Object.keys(catSet).sort();
              renderChips(categories);

              // Re-render grid — preserves active category + search query
              renderGrid();

              // Update product count in header
              var ssub2 = document.getElementById('cat-store-sub');
              if (ssub2) ssub2.textContent = allProducts.length + ' product' + (allProducts.length !== 1 ? 's' : '') + ' · WhatsApp orders';

              // Sync cart — remove items no longer in stock or deleted
              var validIds = new Set(allProducts.map(function(p) { return p.id; }));
              cart.forEach(function(entry, pid) {
                if (!validIds.has(pid)) {
                  cart.delete(pid);
                } else {
                  // Cap qty at new stock level
                  var updated = allProducts.find(function(p) { return p.id === pid; });
                  if (updated && typeof updated.qty === 'number' && entry.qty > updated.qty) {
                    if (updated.qty <= 0) {
                      cart.delete(pid);
                    } else {
                      entry.qty = updated.qty;
                      entry.product = updated;
                    }
                  } else if (updated) {
                    entry.product = updated; // refresh price/name in case vendor edited
                  }
                }
              });
              refreshCartUI();
            });
          }
        )
        .subscribe(function(status) {
          if (!IS_PROD) console.log('[Catalog] Realtime status:', status);
        });
    } catch(e) {
      console.warn('[Catalog] Realtime subscription failed:', e);
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCatalog);
  } else {
    initCatalog();
  }

})();
