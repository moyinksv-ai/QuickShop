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

  // Decide the document mode before registering any screen-history handlers.
  // index.html contains the landing DOM even on /?store=... catalog routes, but
  // those routes belong to catalog.js and must not inherit landing history state.
  var params = new URLSearchParams(window.location.search);
  var isCatalog = params.has('store') || params.has('token');

  /* ── 1. Service-worker registration + safe update propagation ─────────── */
  if ('serviceWorker' in navigator) {
    var hadServiceWorkerController = !!navigator.serviceWorker.controller;
    var updateRefreshPending = false;
    var updateRefreshInFlight = false;
    var updateBanner = null;

    function isVisibleElement(el) {
      if (!el) return false;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      return style ? style.display !== 'none' && style.visibility !== 'hidden' :
        el.style.display !== 'none';
    }

    function hasOpenVendorEditor() {
      var workspace = document.getElementById('addProductWorkspace');
      if (isVisibleElement(workspace) && workspace.getAttribute('aria-hidden') !== 'true') return true;

      var app = window.__QS_APP;
      try {
        if (app && typeof app.getEditingProductId === 'function' && app.getEditingProductId()) return true;
      } catch (_) {}

      var modals = document.querySelectorAll('.modal');
      for (var i = 0; i < modals.length; i++) {
        if (isVisibleElement(modals[i])) return true;
      }

      var active = document.activeElement;
      return !!(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    }

    function showUpdateBanner() {
      if (updateBanner || !document.body) return;
      var banner = document.createElement('aside');
      banner.id = 'qs-update-ready';
      banner.className = 'qs-update-ready';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');

      var message = document.createElement('span');
      message.className = 'qs-update-ready-message';
      message.textContent = 'A QuickShop update is ready. Save or finish any open form before reloading.';

      var reloadButton = document.createElement('button');
      reloadButton.type = 'button';
      reloadButton.className = 'qs-update-ready-action';
      reloadButton.textContent = 'Update';

      var dismissButton = document.createElement('button');
      dismissButton.type = 'button';
      dismissButton.className = 'qs-update-ready-dismiss';
      dismissButton.textContent = 'Later';
      dismissButton.setAttribute('aria-label', 'Dismiss update notice');

      reloadButton.addEventListener('click', function () {
        if (hasOpenVendorEditor()) {
          var app = window.__QS_APP;
          if (app && typeof app.toast === 'function') {
            app.toast('Finish or save the open form first, then tap Update again.', 'warning', 4500);
          }
          return;
        }
        var confirmUpdate = window.__QS_APP && window.__QS_APP.showConfirm;
        var decision = typeof confirmUpdate === 'function'
          ? confirmUpdate({
              title: 'Update QuickShop',
              message: 'Your saved and queued offline changes are retained. Make sure any open form is saved before reloading.',
              okText: 'Reload now'
            })
          : Promise.resolve(window.confirm('Reload QuickShop to apply the update? Save any open form first.'));
        Promise.resolve(decision).then(function (confirmed) {
          if (confirmed) window.location.reload();
        }).catch(function () {});
      });

      dismissButton.addEventListener('click', function () {
        if (updateBanner && updateBanner.parentNode) updateBanner.parentNode.removeChild(updateBanner);
        updateBanner = null;
      });

      banner.appendChild(message);
      banner.appendChild(reloadButton);
      banner.appendChild(dismissButton);
      document.body.appendChild(banner);
      updateBanner = banner;
    }

    function refreshUpdatedAppShell() {
      if (!updateRefreshPending || updateRefreshInFlight || !navigator.onLine) return;
      var controller = navigator.serviceWorker.controller;
      if (!controller || typeof MessageChannel === 'undefined') return;

      var urls = [];
      var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
      nodes.forEach(function (node) {
        var raw = node.src || node.href;
        if (!raw) return;
        try {
          var url = new URL(raw, window.location.href);
          if (url.origin === window.location.origin && urls.indexOf(url.href) === -1) {
            urls.push(url.href);
          }
        } catch (_) {}
      });
      if (!urls.length) return;

      updateRefreshInFlight = true;
      var channel = new MessageChannel();
      channel.port1.onmessage = function (event) {
        updateRefreshInFlight = false;
        var result = event.data || {};
        if (result.ok === true && result.total === urls.length) {
          updateRefreshPending = false;
          showUpdateBanner();
        } else {
          console.warn('[QS] App update assets could not all be refreshed; keeping the current page and offline cache.');
        }
      };
      try {
        controller.postMessage({ type: 'QS_REFRESH_APP_SHELL', urls: urls }, [channel.port2]);
      } catch (_) {
        updateRefreshInFlight = false;
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // The first controller takeover is a fresh install, not an app update.
      if (!hadServiceWorkerController) {
        hadServiceWorkerController = true;
        return;
      }
      updateRefreshPending = true;
      refreshUpdatedAppShell();
    });
    window.addEventListener('online', refreshUpdatedAppShell);

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js')
        .then(function (reg) {
          reg.onupdatefound = function () {
            var installing = reg.installing;
            if (!installing) return;
            installing.onstatechange = function () {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[QS] New worker installed; waiting for app-shell refresh before offering reload.');
              }
            };
          };
          if (updateRefreshPending) refreshUpdatedAppShell();
        })
        .catch(function (err) { console.error('[QS] SW registration failed:', err); });
    });
  }

  /* ── 2. Landing page CTA wiring + scroll-reveal ───────────────────────── */
  // Guard: only run if the landing section is present (not catalog mode)
  if (!isCatalog && document.getElementById('qs-landing')) {

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

    function showAuth(fromHistory, forceLogin) {
      var body = document.body;
      var landing = document.getElementById('qs-landing');
      var auth = document.getElementById('loginScreen');
      var app = document.querySelector('.app');
      var bottomNav = document.querySelector('.bottom-nav');
      // A pending verification/reset step owns the auth surface. Do not clear its
      // persistence marker just because browser Back/Forward restores this entry.
      var hasPendingAuthFlow = body.classList.contains('qs-auth-pending');
      body.classList.remove('mode-app', 'qs-cat-early');
      if (!hasPendingAuthFlow) body.classList.remove('qs-auth-pending');
      body.classList.add('qs-show-auth');
      if (landing) landing.classList.add('qs-hidden');
      if (auth) { auth.removeAttribute('style'); auth.style.display = 'flex'; }
      if (app) { app.removeAttribute('style'); app.style.display = 'none'; }
      if (bottomNav) { bottomNav.removeAttribute('style'); bottomNav.style.display = 'none'; }

      // Only a deliberate landing-page Sign In CTA resets the visible form to login.
      // Sign Up uses its own explicit switch; popstate restoration leaves interrupted
      // verification/reset screens untouched.
      if (forceLogin && !hasPendingAuthFlow) {
        if (window.__QS_APP && typeof window.__QS_APP.showLoginForm === 'function') {
          window.__QS_APP.showLoginForm();
        } else {
          ['signupForm', 'resetForm', 'resetVerifyForm', 'verificationNotice', 'authLoading'].forEach(function (id) {
            var form = document.getElementById(id);
            if (form) form.style.display = 'none';
          });
          var loginForm = document.getElementById('loginForm');
          if (loginForm) loginForm.style.display = 'flex';
        }
      }

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
      // Once authenticated, vendor tab history belongs exclusively to appss.js.
      // Do not interpret its preserved qsScreen field as a landing/auth request.
      if (document.body.classList.contains('mode-app')) return;
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
      if (el) el.addEventListener('click', function () { showAuth(false, true); });
    });

    // Back-to-landing: event delegation so it works even if the button re-renders
    document.addEventListener('click', function (e) {
      var target = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('#btnBackToLanding')
        : null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      // Sign-out replaces the active vendor entry with an auth entry, so
      // there may be no reliable prior landing entry to pop back to. Perform
      // the canonical transition directly; it also normalizes this history entry.
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
