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

    // One canonical state transition owns landing/auth visibility. Keeping this
    // centralized prevents competing click handlers from restoring different UI states.
    // Screen history is separate from the vendor app's tab history. It lets
    // browser Back/Forward (including Android system Back and iOS Safari's
    // edge-swipe) restore a real screen instead of leaving landing and auth hidden.
    function mergeScreenState(screen) {
      var current = window.history.state;
      var next = current && typeof current === 'object' ? Object.assign({}, current) : {};
      next.qsScreen = screen;
      return next;
    }

    function showLandingNow() {
      var body = document.body;
      var auth = document.getElementById('loginScreen');
      var landing = document.getElementById('qs-landing');
      var app = document.querySelector('.app');
      var bottomNav = document.querySelector('.bottom-nav');
      body.classList.remove('qs-show-auth', 'qs-auth-pending', 'mode-app', 'qs-cat-early');
      if (auth) { auth.removeAttribute('style'); auth.style.display = 'none'; }
      if (app) { app.removeAttribute('style'); app.style.display = 'none'; }
      if (bottomNav) { bottomNav.removeAttribute('style'); bottomNav.style.display = 'none'; }
      if (landing) {
        landing.classList.remove('qs-hidden', 'qs-navigating');
        landing.removeAttribute('style');
      }
      // Keep the active entry labelled as landing without discarding other
      // state fields owned by the application.
      try {
        if (window.history.state && window.history.state.qsScreen !== 'landing') {
          window.history.replaceState(mergeScreenState('landing'), '', window.location.href);
        }
      } catch (_) {}
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    // Expose globally so auth flow can return to landing using the same transition.
    try {
      Object.defineProperty(window, '__qs_showLanding', {
        value: showLandingNow,
        writable: false,
        configurable: false,
        enumerable: false
      });
    } catch (_) {
      window.__qs_showLanding = showLandingNow;
    }

    function showAuth(fromHistory) {
      var body = document.body;
      var landing = document.getElementById('qs-landing');
      var auth = document.getElementById('loginScreen');
      var app = document.querySelector('.app');
      var bottomNav = document.querySelector('.bottom-nav');
      body.classList.remove('mode-app', 'qs-auth-pending', 'qs-cat-early');
      body.classList.add('qs-show-auth');
      if (landing) landing.classList.add('qs-hidden');
      if (auth) { auth.removeAttribute('style'); auth.style.display = 'flex'; }
      if (app) { app.removeAttribute('style'); app.style.display = 'none'; }
      if (bottomNav) { bottomNav.removeAttribute('style'); bottomNav.style.display = 'none'; }
      // Add one same-document history entry for auth. Do not add another entry
      // when restoring auth through Forward or when the CTA switches to signup.
      try {
        if (!fromHistory && (!window.history.state || window.history.state.qsScreen !== 'auth')) {
          window.history.pushState(mergeScreenState('auth'), '', window.location.href);
        }
      } catch (_) {}
      window.scrollTo(0, 0);
    }

    // Establish a stable landing entry before the user opens authentication.
    // Preserve unrelated state fields and never rewrite the URL/query string.
    try {
      if (!window.history.state || !window.history.state.qsScreen) {
        window.history.replaceState(mergeScreenState('landing'), '', window.location.href);
      }
    } catch (_) {}

    window.addEventListener('popstate', function (event) {
      var screen = event.state && event.state.qsScreen;
      var authIsVisible = document.body.classList.contains('qs-show-auth');
      if (screen === 'auth') {
        showAuth(true);
        event.stopImmediatePropagation();
        return;
      }
      if (screen === 'landing' || authIsVisible) {
        showLandingNow();
        // appss.js also handles popstate for the vendor tab stack. Keep auth/
        // landing transitions out of that handler so it cannot override them.
        event.stopImmediatePropagation();
      }
    });

    function showSignup() {
      showAuth();
      // FIXED: the original setTimeout(click, 60) was a race — on slow networks
      // or cold loads appss.js hasn't bound its listener to btnShowSignup yet,
      // so the click fires on a deaf element and the vendor lands on login.
      // Strategy: poll for the listener being ready (signalled by appss.js
      // setting window.__QS_APP), then click. Fall back to direct DOM click
      // after 2s regardless so the UI never hangs.
      var elapsed = 0;
      var iv = setInterval(function () {
        elapsed += 50;
        var b = document.getElementById('btnShowSignup');
        if (window.__QS_APP && b) {
          clearInterval(iv);
          b.click();
        } else if (elapsed >= 2000) {
          clearInterval(iv);
          if (b) b.click(); // best-effort fallback
        }
      }, 50);
    }

    var signupBtnIds = ['qs-nav-up', 'qs-hero-up', 'qs-plan-free', 'qs-plan-pro', 'qs-final'];
    var signinBtnIds = ['qs-nav-in', 'qs-hero-in'];

    signupBtnIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', showSignup);
    });
    signinBtnIds.forEach(function (id) {
      var el = document.getElementById(id);
      // Do not pass the click Event as showAuth's fromHistory flag. A direct
      // listener would make that argument truthy and silently skip pushState.
      if (el) el.addEventListener('click', function () { showAuth(false); });
    });

    // Back-to-landing: event delegation so it works even if the button re-renders
    document.addEventListener('click', function (e) {
      var target = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('#btnBackToLanding')
        : null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      // The auth entry was created by this script, so use Back to keep the
      // browser history truthful; popstate performs the canonical transition.
      if (window.history.state && window.history.state.qsScreen === 'auth') {
        window.history.back();
        return;
      }
      if (typeof window.__qs_showLanding === 'function') window.__qs_showLanding();
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
    'canonical.js',
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
    (document.body || document.head || document.documentElement).appendChild(s);
  }

  var params    = new URLSearchParams(window.location.search);
  var isCatalog = params.has('store') || params.has('token');

  if (isCatalog) {
    // Customer storefront — catalog.js is fully standalone, no load-order
    // dependency. Dynamic scripts default to async=true which is correct here.
    // NOTE: do NOT add a second script to this branch assuming ordered loading —
    // async=false only applies when ordered=true is passed to addScript().
    addScript('catalog.js', false);
  } else {
    // Admin app — ordered load required (inventory.js depends on __QS_APP from appss.js)
    //
    // beforeinstallprompt / appinstalled must be registered HERE, not in a
    // dynamically-inserted script. qs-init.js is a static <script src> tag
    // and executes synchronously during HTML parse — well before the browser
    // fires beforeinstallprompt (which only fires after the load event AND
    // after the SW is active). Static scripts are always in time.
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); // suppress auto-banner; we show our own Install button
      window.__QS_INSTALL_PROMPT = e;
    });
    window.addEventListener('appinstalled', function () {
      window.__QS_INSTALL_PROMPT = null;
    });

    addScript('indexeddb_sync.js', true);
    addScript('share-catalog.js', true);
    addScript('appss.js',         true);
    addScript('canonical.js',     true);
    addScript('inventory.js',     true);
  }

})();
