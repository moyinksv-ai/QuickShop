/*
 * qs-init.js — QuickShop initialisation bootstrap
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces ALL three inline <script> blocks that were previously in index.html,
 * which prevented the CSP from dropping 'unsafe-inline' for script-src.
 *
 * Load order in index.html (after this file is in place):
 *
 *   <!-- end of <body> -->
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="supabase-config.js"></script>
 *   <script src="qs-init.js"></script>          ← replaces all three inline blocks
 *
 * And the CSP script-src directive can now be tightened to remove 'unsafe-inline'.
 *
 * WHAT THIS FILE DOES (in execution order):
 *   1. Service-worker registration (was inline block 1)
 *   2. Landing-page CTA wiring + scroll-reveal (was inline block 2, the IIFE)
 *   3. Conditional script loader — loads catalog.js OR the full admin stack
 *      (was inline block 3, the other IIFE)
 *
 * SECURITY NOTES:
 *   • addScript() validates every src against a hardcoded allowlist before
 *     inserting — prevents prototype-pollution or future callers from loading
 *     arbitrary URLs.
 *   • window.__qs_showLanding is still exposed as a global (needed by appss.js
 *     auth flow) but is defined as a non-writable property so it cannot be
 *     replaced by a later script.
 *   • No eval(), no innerHTML, no dynamic string construction for src values.
 */

(function () {
  'use strict';

  /* ── 1. Service-worker registration ───────────────────────────────────── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js')
        .then(function (reg) {
          reg.onupdatefound = function () {
            var installing = reg.installing;
            if (!installing) return;
            installing.onstatechange = function () {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[QS] New version available — reload when ready.');
              }
            };
          };
        })
        .catch(function (err) { console.error('[QS] SW registration failed:', err); });
    });
  }

  /* ── 2. Landing page CTA wiring + scroll-reveal ───────────────────────── */
  // Guard: only run if the landing section is present (not catalog mode)
  if (document.getElementById('qs-landing')) {

    // Expose globally so appss.js auth flow can call it — non-writable so
    // no later script can overwrite the reference.
    try {
      Object.defineProperty(window, '__qs_showLanding', {
        value: function () {
          var auth    = document.getElementById('loginScreen');
          var landing = document.getElementById('qs-landing');
          document.body.classList.remove('qs-show-auth');
          if (auth) { auth.removeAttribute('style'); auth.style.display = 'none'; }
          if (landing) { landing.classList.remove('qs-hidden'); landing.removeAttribute('style'); }
          window.scrollTo(0, 0);
        },
        writable: false,
        configurable: false,
        enumerable: false
      });
    } catch (_) {
      // Fallback for environments where defineProperty is restricted
      window.__qs_showLanding = function () {
        var auth    = document.getElementById('loginScreen');
        var landing = document.getElementById('qs-landing');
        document.body.classList.remove('qs-show-auth');
        if (auth) { auth.removeAttribute('style'); auth.style.display = 'none'; }
        if (landing) { landing.classList.remove('qs-hidden'); landing.removeAttribute('style'); }
        window.scrollTo(0, 0);
      };
    }

    function showAuth() {
      var landing = document.getElementById('qs-landing');
      var auth    = document.getElementById('loginScreen');
      if (landing) landing.classList.add('qs-hidden');
      if (auth)    { auth.removeAttribute('style'); auth.style.display = 'flex'; }
      document.body.classList.add('qs-show-auth');
      window.scrollTo(0, 0);
    }

    function showSignup() {
      showAuth();
      setTimeout(function () {
        var b = document.getElementById('btnShowSignup');
        if (b) b.click();
      }, 60);
    }

    var signupBtnIds = ['qs-nav-up', 'qs-hero-up', 'qs-plan-free', 'qs-plan-pro', 'qs-final'];
    var signinBtnIds = ['qs-nav-in', 'qs-hero-in'];

    signupBtnIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', showSignup);
    });
    signinBtnIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', showAuth);
    });

    // Back-to-landing: event delegation so it works even if the button re-renders
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btnBackToLanding') {
        e.preventDefault();
        e.stopPropagation();
        window.__qs_showLanding();
      }
    });

    // Scroll-reveal via IntersectionObserver
    var reveals = document.querySelectorAll('.ql-reveal');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('ql-visible');
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      // Fallback: show all immediately for older browsers
      reveals.forEach(function (el) { el.classList.add('ql-visible'); });
    }
  }

  /* ── 3. Conditional script loader ─────────────────────────────────────── */
  /*
   * catalog.js is a fully standalone module for the customer-facing storefront.
   * Loading both runtimes on the same page is wasteful and causes state conflicts.
   *
   * URL patterns that trigger catalog mode:
   *   ?store=<UUID>    — direct store link (preferred)
   *   ?token=<token>   — legacy share_links token
   *
   * SECURITY: Only scripts from the allowlist below can be loaded.
   * async=false on dynamically-inserted scripts enforces insertion order —
   * defer=true is silently ignored on dynamic scripts per the HTML spec.
   */

  var SCRIPT_ALLOWLIST = [
    'catalog.js',
    'indexeddb_sync.js',
    'share-catalog.js',
    'appss.js',
    'inventory.js'
  ];

  function addScript(src, ordered) {
    // Reject anything not in the allowlist to prevent injection
    if (SCRIPT_ALLOWLIST.indexOf(src) === -1) {
      console.error('[QS] Blocked attempt to load unlisted script:', src);
      return;
    }
    var s = document.createElement('script');
    s.src = src;
    if (ordered) s.async = false;
    document.body.appendChild(s);
  }

  var params    = new URLSearchParams(window.location.search);
  var isCatalog = params.has('store') || params.has('token');

  if (isCatalog) {
    // Customer storefront — catalog.js is standalone, async is fine
    addScript('catalog.js', false);
  } else {
    // Admin app — ordered load required (inventory.js depends on __QS_APP from appss.js)
    // Save the install prompt for later — show it via the Install button in Settings.
    // Calling preventDefault() suppresses the browser's default banner so we
    // can show it at the right moment instead of randomly.
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.__QS_INSTALL_PROMPT = e;
    });
    // Clear the saved prompt once the app is installed
    window.addEventListener('appinstalled', function () {
      window.__QS_INSTALL_PROMPT = null;
    });
    addScript('indexeddb_sync.js', true);
    addScript('share-catalog.js', true);
    addScript('appss.js',         true);
    addScript('inventory.js',     true);
  }

})();
