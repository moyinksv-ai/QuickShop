/*
 * QuickShop — appss.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All logic lives inside initApp() to share a single closed scope.
 * No globals are created. Sections are clearly marked for navigation.
 *
 * TABLE OF CONTENTS
 * ─────────────────
 *  §0  Bootstrap & Helpers     waitForSupabaseReady, initApp entry, Sentry
 *  §1  Core Utilities          escapeHtml, uid, dates, toast, compressImage
 *  §2  Pull-to-Refresh         initPullToRefresh, triggerRefresh
 *  §3  Modal & UI Helpers      confirm, backdrop, showModal, loading, auth forms
 *  §4  Data Layer              setUserProfile, getUserProfile, saveState,
 *                               validateLoadedState, loadLocalData, syncCloudData
 *  §5  Auth                    initAuthHandlers, initAuth, handleAuthUser,
 *                               handleAuthLogout
 *  §6  Scanner                 startScanner, handleScanResult, handlers
 *  §7  Inventory — Products    renderChips, renderProducts, openModalFor,
 *                               doAddStock, doSell, undoLastFor, removeProduct
 *  §8  Inventory — Forms       imageUpload, clearAddForm, validateProduct,
 *                               initAddProductHandler, CSV import
 *  §9  Activity Log            addActivityLog, renderActivityLog, auditLog
 * §10  Dashboard               renderDashboard
 * §11  Notes                   renderNotes, initNotesHandlers
 * §12  Settings & Demo         initDemoAndSettingsHandlers, renderCategoryEditor,
 *                               renderSettingsPanel
 * §13  Navigation              setActiveView, cleanupViewState, initNavigationHandlers
 * §14  Reports                 createBuckets, renderReports, renderReportsChart,
 *                               renderTop3Products, initReportsHandlers, generateCsv
 * §15  Insights & Copilot      _computeSignals, _buildInsightDom, copilot session,
 *                               merchant memory, Gemini AI, generateAdvancedInsights
 * §16  Search & Theme          initSearchHandler, initThemeToggle, toggleTheme
 * §17  App Bootstrap           initAppUI, boot sequence, back button, visibility
 * §18  Inventory Bridge        window.__QS_APP — public API for inventory.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

function waitForSupabaseReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) return resolve(window.__QS_SUPABASE);
    let waited = 0;
    const iv = setInterval(() => {
      if (window.__QS_SUPABASE && window.__QS_SUPABASE.client) {
        clearInterval(iv);
        return resolve(window.__QS_SUPABASE);
      }
      waited += 100;
      if (waited >= timeoutMs) {
        clearInterval(iv);
        return resolve(window.__QS_SUPABASE || null);
      }
    }, 100);
  });
}

function initApp() {
  'use strict';


  // ═══════════════════════════════════════════════════════════════════════════
  // §0  BOOTSTRAP & HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  const IS_PROD = window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');
  const log = IS_PROD ? () => {} : (...a) => console.log('[QS]', ...a);

  // ── Referral capture ─────────────────────────────────────────────────────
  // If the user arrived via a catalog's branding link (?ref=<UUID>), capture
  // the referrer's user_id into sessionStorage immediately at boot so it
  // survives navigation between Login ↔ Signup tabs. Consumed once at signup
  // then cleared. UUID-validated here to prevent garbage data reaching the DB.
  (function captureReferral() {
    try {
      var _refParam = new URLSearchParams(window.location.search).get('ref');
      if (_refParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_refParam)) {
        sessionStorage.setItem('qs_referrer_id', _refParam);
      }
    } catch (_) {}
  })();

  // ── Sentry initialisation ────────────────────────────────────────────────
  // Replace YOUR_SENTRY_DSN with the DSN from your Sentry project settings.
  // The DSN is public-safe — it only lets data IN, never exposes your data.
  // Get it at: sentry.io → Your Project → Settings → Client Keys (DSN)
  if (typeof Sentry !== 'undefined') {
    Sentry.init({
      dsn: 'YOUR_SENTRY_DSN',
      release: 'quickshop@4.48',
      environment: IS_PROD ? 'production' : 'development',
      // Capture 100% of errors, 5% of performance traces (free tier safe)
      tracesSampleRate: 0.05,
      // Ignore benign browser noise
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
        'NetworkError',
        'Load failed',
        'AbortError',
      ],
      beforeSend(event) {
        // Strip any accidental PII from breadcrumbs before sending
        if (event.breadcrumbs && event.breadcrumbs.values) {
          event.breadcrumbs.values = event.breadcrumbs.values.map(b => {
            if (b.data && b.data.url) {
              try {
                const u = new URL(b.data.url);
                u.search = ''; // strip query params (may contain tokens)
                b.data.url = u.toString();
              } catch(_) {}
            }
            return b;
          });
        }
        return event;
      }
    });
  }
  // ── End Sentry init ──────────────────────────────────────────────────────
  const errlog = (...a) => {
    console.error('[QS Error]', ...a);
    // Forward to Sentry if available — captures the Error object (last arg)
    // so Sentry gets the full stack trace, not just a string.
    if (typeof Sentry !== 'undefined') {
      const err = a.find(x => x instanceof Error);
      if (err) {
        Sentry.captureException(err, { extra: { context: a[0] } });
      } else {
        Sentry.captureMessage(a.map(x => String(x)).join(' '), 'error');
      }
    }
  };
  

  // ═══════════════════════════════════════════════════════════════════════════
  // §1  CORE UTILITIES — escapeHtml, uid, dates, formatters, toast, compressImage
  // ═══════════════════════════════════════════════════════════════════════════
  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  // FIX 1: Use crypto.randomUUID() to prevent ID collisions — Math.random() is not cryptographically safe.
  function uid() {
    try { return self.crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
    catch (_) { return 'p' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
  }
  // noteUid() returns a full RFC-4122 UUID with dashes — required because
  // the Supabase notes table id column is type UUID, not TEXT.
  // uid() strips dashes and truncates which is valid for TEXT columns (products/sales)
  // but throws "invalid input syntax for type uuid" on UUID columns.
  function noteUid() {
    try { return self.crypto.randomUUID(); }
    catch (_) {
      // Fallback: generate a valid UUID v4 format manually
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }
  }
  const _n = function(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; };
  const _fmt = function(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); };
  // Expose as read-only globals — external scripts cannot overwrite these
  try {
    Object.defineProperty(window, 'n',   { value: _n,   writable: false, configurable: false, enumerable: false });
    Object.defineProperty(window, 'fmt', { value: _fmt, writable: false, configurable: false, enumerable: false });
  } catch(_) { window.n = _n; window.fmt = _fmt; } // fallback for edge environments
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month:'short', day:'numeric' }); }
  function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  
  let toastTimer = null;

  // Toast config per type
  // Solid dark backgrounds — readable on both light and dark themes.
  // The toast floats above the page so it must not rely on the page
  // background for contrast. Semi-transparent bgs looked washed out in
  // light mode (screenshot confirmed).
  const TOAST_CFG = {
    success: { icon: '✓', accent: '#10b981', bg: '#052e16', border: 'rgba(16,185,129,0.4)',  text: '#6ee7b7' },
    error:   { icon: '✕', accent: '#ef4444', bg: '#1c0a0a', border: 'rgba(239,68,68,0.4)',   text: '#fca5a5' },
    warning: { icon: '⚠', accent: '#f59e0b', bg: '#1c1007', border: 'rgba(245,158,11,0.4)', text: '#fcd34d' },
    info:    { icon: 'ℹ', accent: '#818cf8', bg: '#0d0d1f', border: 'rgba(99,102,241,0.4)', text: '#c7d2fe' },
  };

  function toast(message, type = 'info', ms = 3200) {
    try {
      const cfg = TOAST_CFG[type] || TOAST_CFG.info;

      // Build or reuse container
      let t = document.getElementById('appToast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'appToast';
        Object.assign(t.style, {
          position: 'fixed',
          left: '12px', right: '12px',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          maxWidth: '420px', margin: '0 auto',
          borderRadius: '14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
          opacity: '0',
          transform: 'translateY(-24px) scale(0.97)',
          transition: 'opacity 0.28s cubic-bezier(0.34,1.56,0.64,1), transform 0.28s cubic-bezier(0.34,1.56,0.64,1)',
          zIndex: '99999',
          pointerEvents: 'none', // none when invisible — never blocks taps underneath
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'stretch',
        });
        document.body.appendChild(t);
      }

      if (toastTimer) clearTimeout(toastTimer);

      // Rebuild inner HTML each call for correct type styling
      t.style.background = cfg.bg;
      t.style.border = '1px solid ' + cfg.border;
      t.innerHTML = '';

      // Left accent bar
      const accent = document.createElement('div');
      Object.assign(accent.style, {
        width: '4px', flexShrink: '0',
        background: cfg.accent,
        borderRadius: '14px 0 0 14px',
      });

      // Body
      const body = document.createElement('div');
      Object.assign(body.style, {
        display: 'flex', alignItems: 'center', gap: '10px',
        flex: '1', padding: '12px 14px',
      });

      const iconEl = document.createElement('span');
      Object.assign(iconEl.style, {
        fontSize: '15px', fontWeight: '800',
        color: cfg.accent, flexShrink: '0',
        width: '18px', textAlign: 'center',
      });
      iconEl.textContent = cfg.icon;

      const msgEl = document.createElement('span');
      Object.assign(msgEl.style, {
        fontSize: '13px', fontWeight: '600',
        color: cfg.text, lineHeight: '1.4', flex: '1',
      });
      msgEl.textContent = message;

      // Dismiss X
      const dismiss = document.createElement('button');
      Object.assign(dismiss.style, {
        background: 'none', border: 'none',
        color: 'rgba(255,255,255,0.5)', fontSize: '16px',
        cursor: 'pointer', padding: '0', flexShrink: '0',
        lineHeight: '1', marginLeft: '4px',
      });
      dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.addEventListener('click', function () {
        t.style.opacity = '0';
        t.style.transform = 'translateY(-16px) scale(0.96)';
        t.style.pointerEvents = 'none';
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      });

      body.appendChild(iconEl);
      body.appendChild(msgEl);
      body.appendChild(dismiss);
      t.appendChild(accent);
      t.appendChild(body);

      // Animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          t.style.opacity = '1';
          t.style.transform = 'translateY(0) scale(1)';
          t.style.pointerEvents = 'auto'; // enable interaction while visible
        });
      });

      toastTimer = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(-16px) scale(0.96)';
        t.style.pointerEvents = 'none'; // disable when invisible — stop blocking taps
        toastTimer = null;
      }, ms);

    } catch (e) { console.warn('toast failed', e); }
  }

  function compressImage(file, maxWidth = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width, height = img.height;
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Compression failed'));
          }, 'image/jpeg', quality);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  }

  const getSupabase = () => window.__QS_SUPABASE || {};
  const getClient = () => (getSupabase().client || null);
  // __QS_SUPABASE.user is always null because supabase-config.js freezes
  // the object before appss.js can write to it. currentUser is the
  // authoritative source — set by handleAuthUser on every auth event.
  const getUser = () => currentUser;

  const LOCAL_KEY_PREFIX = 'quickshop_stable_v1_';
  let currentUser = null;
  let state = { products: [], sales: [], changes: [], notes: [], categories: [], logs: [] };
  let isSyncing = false;
  let isSyncInProgress = false;
  let _lastSyncAt = 0; // timestamp of the last completed syncCloudData call
  let isSaveStateSyncing = false;
  let editingNoteId = null;
  let editingProductId = null;
  const DEFAULT_CATEGORIES = ['Drinks', 'Snacks', 'Groceries', 'Clothing', 'Others'];
  let activeCategory = 'All';

  let codeReader = null, videoStream = null, lastScannedBarcode = null;
  let scannerActive = false, currentScanMode = 'form', smartScanProduct = null;
  let modalContext = null;

  const $ = id => document.getElementById(id);

  let pullToRefresh = {
    element: null, spinner: null, startY: 0, currentY: 0,
    isPulling: false, isRefreshing: false, threshold: 80, resistance: 0.5,
    state: 'IDLE'
  };


  // ═══════════════════════════════════════════════════════════════════════════
  // §2  PULL-TO-REFRESH
  // ═══════════════════════════════════════════════════════════════════════════
  function initPullToRefresh() {
    const ptr = document.createElement('div');
    ptr.id = 'pullToRefreshIndicator';
    ptr.style.cssText = `position:fixed;top:0;left:0;right:0;height:60px;display:flex;align-items:center;justify-content:center;background:var(--bg-glass);transform:translateY(-60px);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);z-index:9999;pointer-events:none;`;
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.style.cssText = `width:30px;height:30px;border:3px solid rgba(16,185,129,0.2);border-top-color:var(--accent-emerald);border-radius:50%;`;
    ptr.appendChild(spinner);
    document.body.appendChild(ptr);
    pullToRefresh.element = ptr;
    pullToRefresh.spinner = spinner;
  }

  function updatePullToRefreshUI() {
  if (!pullToRefresh.element) return;
  
  if (pullToRefresh.state === 'PULLING') {
    const distance = Math.min(pullToRefresh.distance, 100);
    pullToRefresh.element.style.transform = `translateY(${distance - 60}px)`;
    if (pullToRefresh.spinner) {
      pullToRefresh.spinner.style.animation = distance > 70 ? 'spin 0.8s linear infinite' : 'none';
    }
  } else if (pullToRefresh.state === 'REFRESHING') {
    pullToRefresh.element.style.transform = 'translateY(0)';
    if (pullToRefresh.spinner) {
      pullToRefresh.spinner.style.animation = 'spin 0.8s linear infinite';
    }
  } else {
    pullToRefresh.element.style.transform = 'translateY(-60px)';
    if (pullToRefresh.spinner) {
      pullToRefresh.spinner.style.animation = 'none';
    }
  }
}

function handleTouchStart(e) {
  // Stop if modal is open or we aren't at the top
  if (document.body.classList.contains('modal-open') || window.scrollY > 5) return;
  
  pullToRefresh.startY = e.touches[0].clientY;
  pullToRefresh.state = 'PULLING';
  pullToRefresh.distance = 0; // Reset
}

function handleTouchMove(e) {
  if (pullToRefresh.state !== 'PULLING') return;

  const currentY = e.touches[0].clientY;
  const delta = currentY - pullToRefresh.startY;

  if (delta < 0 || window.scrollY > 5) {
    pullToRefresh.state = 'IDLE';
    updatePullToRefreshUI();
    return;
  }

  // Apply resistance so the indicator moves at 40% of finger speed —
  // requires a deliberate hard pull rather than an accidental swipe.
  pullToRefresh.distance = delta * 0.4;
  updatePullToRefreshUI();

  if (delta > 10 && e.cancelable) e.preventDefault();
}

function handleTouchEnd() {
  if (pullToRefresh.state === 'PULLING') {
    // Threshold 120px of resisted distance (~300px of actual finger travel)
    // — accidental scrolls never reach this; intentional pulls do.
    if (pullToRefresh.distance > 120) {
      pullToRefresh.state = 'REFRESHING';
      updatePullToRefreshUI();
      setTimeout(() => location.reload(), 500);
    } else {
      pullToRefresh.state = 'IDLE';
      pullToRefresh.distance = 0;
      updatePullToRefreshUI();
    }
  }
}


  async function triggerRefresh() {
    if (isSyncInProgress) return;
    pullToRefresh.isRefreshing = true;
    pullToRefresh.state = 'REFRESHING';
    if (pullToRefresh.element) {
      pullToRefresh.element.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
      pullToRefresh.element.style.transform = 'translateY(0)';
    }
    if (pullToRefresh.spinner) {
      pullToRefresh.spinner.style.animation = 'spin 0.8s linear infinite';
    }
    if (currentUser && navigator.onLine) {
      await syncCloudData(currentUser);
      setTimeout(() => { 
        resetPullToRefresh(); 
        toast('Refreshed', 'info', 1500); 
      }, 300);
    } else {
      const currentView = document.querySelector('.panel.active')?.id;
      if (currentView === 'homePanel') { renderProducts(); renderDashboard(); }
      else if (currentView === 'inventoryPanel') renderInventory();
      setTimeout(() => { 
        resetPullToRefresh(); 
        toast('Refreshed', 'info', 1500); 
      }, 300);
    }
  }

  function resetPullToRefresh() {
    if (pullToRefresh.spinner) {
      pullToRefresh.spinner.style.animation = 'none';
    }
    if (pullToRefresh.element) {
      pullToRefresh.element.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
      pullToRefresh.element.style.transform = 'translateY(-60px)';
    }
    setTimeout(() => {
      pullToRefresh.isRefreshing = false;
      pullToRefresh.state = 'IDLE';
    }, 300);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §3  MODAL & UI HELPERS — backdrop, confirm, loading, auth forms, inventory insight
  // ═══════════════════════════════════════════════════════════════════════════
  function createModalBackdrop(id, zIndex = 99998) {
    let backdrop = document.getElementById(id);
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = id;
    backdrop.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:${zIndex};display:none;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function createModalCloseButton(onClose) {
    const btn = document.createElement('button');
    btn.className = 'modal-close-x';
    btn.innerHTML = '&times;';
    btn.type = 'button';
    btn.style.cssText = `position:absolute;top:12px;right:12px;background:transparent;border:0;font-size:32px;line-height:1;color:var(--text-muted);cursor:pointer;padding:4px 8px;transition:color 0.2s,transform 0.2s;z-index:10;`;
    btn.onmouseover = () => { btn.style.color = 'var(--text-dark)'; btn.style.transform = 'scale(1.1)'; };
    btn.onmouseout = () => { btn.style.color = 'var(--text-muted)'; btn.style.transform = 'scale(1)'; };
    btn.onclick = onClose;
    return btn;
  }

  function showAddForm(asModal = true) {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.showAddForm();
  }

  function hideAddForm() {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.hideAddForm();
  }

  // FIX 9: applyBottomPadding() removed. CSS .list rule now uses
  // calc(var(--nav-h) + 16px + env(safe-area-inset-bottom)) so inline override is redundant
  // and was adding a competing 40px on top of what CSS already set.

  function setupActivityLogClick() {
    const activityLogList = $('activityLogList');
    if (!activityLogList) return;
    const newList = activityLogList.cloneNode(true);
    activityLogList.parentNode.replaceChild(newList, activityLogList);
    newList.addEventListener('click', (e) => {
      const row = e.target.closest('#activityLogList > div');
      if (row) openFullAuditLog();
    });
    newList.addEventListener('mouseover', (e) => {
      const row = e.target.closest('#activityLogList > div');
      if (row) { row.style.background = 'var(--card-glass-hover)'; row.style.cursor = 'pointer'; }
    });
    newList.addEventListener('mouseout', (e) => {
      const row = e.target.closest('#activityLogList > div');
      if (row) row.style.background = 'var(--card-glass)';
    });
  }

  function showModal() {
    const mb = $('modalBackdrop');
    if (!mb) return;
    mb.style.display = 'flex';
    
    let existingCloseBtn = mb.querySelector('.modal-close-x');
    if (!existingCloseBtn) {
      const modalEl = mb.querySelector('.modal');
      if (modalEl) {
        const closeBtn = createModalCloseButton(hideModal);
        modalEl.insertBefore(closeBtn, modalEl.firstChild);
      }
    }
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const qty = $('modalQty');
        if (qty) { qty.focus(); qty.select(); }
      });
    });
  }

  function hideModal() {
    const mb = $('modalBackdrop');
    modalContext = null;
    const errEl = $('modalError');
    if (errEl) errEl.textContent = '';
    if (!mb || mb.style.display === 'none') return;
    // Animate out — .closing triggers CSS scaleOut on .modal + fadeOut on .modal-backdrop.
    // 200ms timeout outlasts both animations before snapping to display:none.
    const modalEl = mb.querySelector('.modal');
    mb.classList.add('closing');
    if (modalEl) modalEl.classList.add('closing');
    setTimeout(() => {
      mb.style.display = 'none';
      mb.classList.remove('closing');
      if (modalEl) modalEl.classList.remove('closing');
    }, 200);
  }

  function initKeyboardDetection() {
    document.addEventListener('focusin', (e) => {
      if (['','TEXTAREA','SELECT'].includes(e.target.tagName)) document.body.classList.add('keyboard-open');
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || !['','TEXTAREA','SELECT'].includes(active.tagName)) document.body.classList.remove('keyboard-open');
      }, 50);
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Escape') { hideModal(); hideAddForm(); stopScanner(); closeFullAuditLog(); closeInventoryInsight(); return; }
      if (['','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if (modKey && e.key === 'k') { e.preventDefault(); const h = $('headerSearchInput'); if (h) h.focus(); }
      if (modKey && e.key === 'n') {
        e.preventDefault();
        const v = document.querySelector('.panel.active')?.id;
        if (v === 'inventoryPanel') { editingProductId = null; clearAddForm(); showAddForm(true); }
      }
    });
  }

  let confirmResolve = null;
  function initConfirmModal() {
    const backdrop = $('confirmModalBackdrop'), okBtn = $('confirmModalOK'), cancelBtn = $('confirmModalCancel');
    if (!backdrop || !okBtn || !cancelBtn) return;

    // FIX 13: ARIA accessibility attributes
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    const titleEl = $('confirmModalTitle'), msgEl = $('confirmModalMessage');
    if (titleEl && !titleEl.id) titleEl.id = 'confirmModalTitle';
    if (msgEl && !msgEl.id) msgEl.id = 'confirmModalMessage';
    if (titleEl) backdrop.setAttribute('aria-labelledby', 'confirmModalTitle');
    if (msgEl) backdrop.setAttribute('aria-describedby', 'confirmModalMessage');

    const close = (result) => {
      if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
      // Resolve promise immediately so callers aren't blocked by animation timing.
      // Animate the modal out before snapping display:none.
      const modalEl = backdrop.querySelector('.modal');
      backdrop.classList.add('closing');
      if (modalEl) modalEl.classList.add('closing');
      setTimeout(() => {
        backdrop.style.display = 'none';
        backdrop.classList.remove('closing');
        if (modalEl) modalEl.classList.remove('closing');
      }, 200);
    };
    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (e) => { if (e.target.id === 'confirmModalBackdrop') close(false); });

    // FIX 13: ESC key closes modal
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
  }

  // FIX 2: Remove window.confirm() blocking-dialog fallback — resolve(false) gracefully instead.
  function showConfirm({ title = 'Are you sure?', message, okText = 'OK', okDanger = false }) {
    return new Promise((resolve) => {
      const backdrop = $('confirmModalBackdrop'), titleEl = $('confirmModalTitle');
      const messageEl = $('confirmModalMessage'), okBtn = $('confirmModalOK');
      if (!backdrop || !titleEl || !messageEl || !okBtn) return resolve(false);
      confirmResolve = resolve;
      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.textContent = okText;
      okBtn.style.background = okDanger ? 'var(--danger)' : 'var(--accent-emerald)';
      backdrop.style.display = 'flex';
      // Focus cancel by default — safer UX for destructive actions
      requestAnimationFrame(() => { const c = $('confirmModalCancel'); if (c) c.focus(); });
    });
  }

  function setBottomNavVisible(v) { const bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = v ? 'flex' : 'none'; }
  function hideAllAuthForms() {
    ['loginForm','signupForm','resetForm','verificationNotice','authLoading'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  }
  function showLoginForm() { hideAllAuthForms(); const el = $('loginForm'); if (el) el.style.display = 'flex'; clearAuths(); }
  function showSignupForm() { hideAllAuthForms(); const el = $('signupForm'); if (el) el.style.display = 'flex'; clearAuths(); }
  function showResetForm() { hideAllAuthForms(); const el = $('resetForm'); if (el) el.style.display = 'flex'; clearAuths(); }
  function showVerificationNotice(email) {
    hideAllAuthForms();
    const el = $('verificationNotice');
    if (el) el.style.display = 'flex';
    const emailEl = $('verificationEmail');
    if (emailEl) emailEl.textContent = email || (getUser() && getUser().email) || '';
  }
  function showAuthLoading() { hideAllAuthForms(); const el = $('authLoading'); if (el) el.style.display = 'flex'; }
  function clearAuths() {
    ['loginEmail','loginPass','signupName','signupBusiness','signupEmail','signupPass','signupPassConfirm','resetEmail'].forEach(id => {
      const el = $(id);
      if (el) { el.value = ''; el.classList.remove('error'); }
    });
  }

  function showLoading(show = true, text = 'Processing...') {
    let overlay = $('loadingOverlay');
    if (!overlay && show) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay active';
      overlay.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>' + escapeHtml(text) + '</p></div>';
      document.body.appendChild(overlay);
      return;
    }
    if (overlay) overlay.classList.toggle('active', !!show);
  }

  function disableBtn(btn, disable = true) {
    if (!btn) return;
    btn.disabled = disable;
    if (disable) btn.setAttribute('aria-busy','true');
    else btn.removeAttribute('aria-busy');
  }

  function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

  function showInventoryInsight(node) {
  const view = $('inventoryInsightView');
  const content = $('inventoryInsightsContent');
  if (!view || !content) return;

  // Replace content safely via DOM
  while (content.firstChild) content.removeChild(content.firstChild);
  if (node instanceof Node) {
    content.appendChild(node);
  } else {
    const fallback = document.createElement('div');
    fallback.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
    fallback.textContent = 'Insights could not be displayed.';
    content.appendChild(fallback);
  }

  // Show as full-screen (same pattern as audit log)
  view.style.display = 'flex';
  view.classList.remove('closing');

  // Lock background scroll
  document.body.classList.add('modal-open');
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  view.dataset.scrollY = scrollY;
}

  function closeInventoryInsight() {
    const view = $('inventoryInsightView');
    if (!view || view.style.display === 'none') return;
    view.classList.add('closing');
    setTimeout(() => {
      view.style.display = 'none';
      view.classList.remove('closing');
      document.body.classList.remove('modal-open');
      const scrollY = view.dataset.scrollY;
      document.body.style.position = '';
      document.body.style.top      = '';
      document.body.style.width    = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY));
    }, 230);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §4  DATA LAYER — profile, saveState, validateState, loadLocalData, syncCloudData
  // ═══════════════════════════════════════════════════════════════════════════
  async function setUserProfile(uid, profile) {
    const supabase = getClient();
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: uid, name: profile.name, business_name: profile.businessName,
        email: profile.email, created_at: profile.createdAt ? new Date(profile.createdAt).toISOString() : new Date().toISOString(),
        avatar_url: profile.avatarUrl !== undefined ? profile.avatarUrl : undefined
      });
      if (error) throw error;
      return true;
    } catch (e) { errlog('setUserProfile', e); return false; }
  }

  async function getUserProfile(uid) {
    const supabase = getClient();
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
      if (error) throw error;
      return data;
    } catch (e) { errlog('getUserProfile', e); return null; }
  }

  async function saveState() {
    const localKey = currentUser ? LOCAL_KEY_PREFIX + currentUser.id : LOCAL_KEY_PREFIX + 'anon';
    try {
      localStorage.setItem(localKey, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) { errlog('local save failed', e); toast('Failed to save data locally!', 'error'); }
    if (!currentUser || !getClient() || !navigator.onLine) return;
    if (isSaveStateSyncing) return;
    isSaveStateSyncing = true;
    try {
      const supabase = getClient();
      // FIXED: was a sequential await-in-loop — 1 HTTP call per note.
      // Now a single batch upsert regardless of note count.
      if (state.notes.length > 0) {
        const noteRows = state.notes.map(note => ({
          id: note.id, user_id: currentUser.id, title: note.title || null,
          content: note.content, created_at: note.ts ? new Date(note.ts).toISOString() : new Date().toISOString()
        }));
        await supabase.from('notes').upsert(noteRows, { onConflict: 'id', ignoreDuplicates: false });
      }
      const existingCategories = await supabase.from('categories').select('name').eq('user_id', currentUser.id);
      const existingNames = new Set((existingCategories.data || []).map(c => c.name));
      // FIXED: was a sequential await-in-loop — 1 HTTP call per new category.
      // Now collects new ones and inserts in a single batch call.
      const newCats = state.categories.filter(cat => !existingNames.has(cat));
      if (newCats.length > 0) {
        await supabase.from('categories').insert(newCats.map(name => ({ user_id: currentUser.id, name })));
      }
      if (state.logs.length > 0) {
        const logRows = state.logs.slice(0, 50).map(log => ({
          id: log.id, user_id: currentUser.id,
          action: log.action, details: log.details,
          performed_by: log.user,
          created_at: log.ts ? new Date(log.ts).toISOString() : new Date().toISOString()
        }));
        await supabase.from('audit_logs').upsert(logRows, { onConflict: 'id', ignoreDuplicates: true });
      }
    } catch (e) { errlog('saveState failed', e); toast('Cloud sync failed.', 'error'); }
    finally { isSaveStateSyncing = false; }
  }

  // ── LOCAL STATE SCHEMA VALIDATOR ────────────────────────────────────────────
  // Validates and sanitises every field loaded from localStorage so that a
  // tampered device or browser extension cannot inject malicious content.
  function validateLoadedState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const MAX_ID = 64, MAX_NAME = 200, MAX_CAT = 50, MAX_STR = 500;
    function safeId(v)       { return (typeof v === 'string' && /^[a-zA-Z0-9_\-]{1,64}$/.test(v)) ? v : null; }
    function safeStr(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
    function safeNum(v)      { const n = Number(v); return (isFinite(n) && n >= 0) ? n : 0; }

    const products = Array.isArray(raw.products) ? raw.products.filter(p => {
      return p && typeof p === 'object' && safeId(p.id) && typeof p.name === 'string' && p.name.trim();
    }).map(p => ({
      id: safeId(p.id),
      name: safeStr(p.name, MAX_NAME),
      description: typeof p.description === 'string' ? safeStr(p.description, 500) : null,
      barcode: typeof p.barcode === 'string' ? safeStr(p.barcode, 64) : null,
      price: safeNum(p.price),
      cost: safeNum(p.cost),
      qty: safeNum(p.qty),
      category: safeStr(p.category || 'Others', MAX_CAT),
      image:  typeof p.image  === 'string' ? safeStr(p.image,  4096) : null,
      image2: typeof p.image2 === 'string' ? safeStr(p.image2, 4096) : null,
      icon:   typeof p.icon   === 'string' ? safeStr(p.icon,   10)   : null,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now()
    })) : [];

    const sales = Array.isArray(raw.sales) ? raw.sales.filter(s =>
      s && typeof s === 'object' && safeId(s.id)
    ).map(s => ({
      id: safeId(s.id),
      productId: safeStr(s.productId || '', MAX_ID),
      qty: safeNum(s.qty),
      price: safeNum(s.price),
      cost: safeNum(s.cost),
      ts: typeof s.ts === 'number' ? s.ts : Date.now()
    })) : [];

    const notes = Array.isArray(raw.notes) ? raw.notes.filter(n =>
      n && typeof n === 'object'
    ).map(n => ({
      id: typeof n.id === 'string' ? safeStr(n.id, MAX_ID) : noteUid(),
      title: safeStr(n.title || '', MAX_NAME),
      content: safeStr(n.content || '', 10000),
      ts: typeof n.ts === 'number' ? n.ts : Date.now()
    })) : [];

    const categories = Array.isArray(raw.categories)
      ? raw.categories.filter(c => typeof c === 'string' && c.trim()).map(c => safeStr(c.trim(), MAX_CAT))
      : [];

    const logs = Array.isArray(raw.logs) ? raw.logs.filter(l =>
      l && typeof l === 'object'
    ).slice(0, 500).map(l => ({
      id: typeof l.id === 'string' ? safeStr(l.id, MAX_ID) : uid(),
      action: safeStr(l.action || '', 50),
      details: safeStr(l.details || '', MAX_STR),
      user: safeStr(l.user || '', 100),
      ts: typeof l.ts === 'number' ? l.ts : Date.now()
    })) : [];

    return { products, sales, notes, categories, logs, changes: [] };
  }
  // ────────────────────────────────────────────────────────────────────────────

  function loadLocalData(uid = null) {
    const localKey = uid ? LOCAL_KEY_PREFIX + uid : LOCAL_KEY_PREFIX + 'anon';
    let validated = null;
    try {
      const localRaw = localStorage.getItem(localKey);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        validated = validateLoadedState(parsed);
      }
    } catch (e) { errlog('Failed to parse local data', e); }
    if (validated) {
      state = {
        products: validated.products,
        sales: validated.sales,
        changes: [],
        notes: validated.notes,
        categories: validated.categories.length > 0 ? validated.categories : [...DEFAULT_CATEGORIES],
        logs: validated.logs
      };
    } else {
      state = { products: [], sales: [], changes: [], notes: [], categories: [...DEFAULT_CATEGORIES], logs: [] };
    }
    initAppUI();
  }

  async function syncCloudData(user) {
    if (!user || !getClient() || !navigator.onLine) {
      if (!navigator.onLine) log('Offline, skipping cloud sync.');
      return;
    }
    if (isSyncInProgress) return;
    isSyncInProgress = true;
    showLoading(true, 'Syncing data...');
    try {
      if (window.qsdb && window.qsdb.syncPendingToSupabase) await window.qsdb.syncPendingToSupabase();
      const supabase = getClient();
      const [productsRes, salesRes, notesRes, categoriesRes, logsRes] = await Promise.all([
        supabase.from('products').select('*').eq('user_id', user.id),
        supabase.from('sales').select('*').eq('user_id', user.id)
          .gte('sale_date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from('notes').select('*').eq('user_id', user.id),
        supabase.from('categories').select('*').eq('user_id', user.id),
        supabase.from('audit_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200)
      ]);
      const cloudProducts = (productsRes.data || []).map(p => ({
        id: p.id, name: p.name, barcode: p.barcode, price: p.price, cost: p.cost, qty: p.qty,
        category: p.category || 'Others', image: p.image_url, image2: p.image_url2 || null, icon: p.icon,
        description: p.description || null,
        createdAt: new Date(p.created_at).getTime(),
        updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : new Date(p.created_at).getTime()
      }));
      const cloudSales = (salesRes.data || []).map(s => ({
        id: s.id, productId: s.product_id, qty: s.qty, price: s.price, cost: s.cost,
        ts: new Date(s.sale_date).getTime(),
        productName: s.product_name || null,
        barcode: s.barcode || null,
        category: s.category || null,
        paymentMethod: s.payment_method || null
      }));
      const cloudNotes = (notesRes.data || []).map(n => ({
        id: n.id, title: n.title, content: n.content, ts: new Date(n.created_at).getTime()
      }));
      const cloudCategories = (categoriesRes.data || []).map(c => c.name);
      const cloudLogs = (logsRes.data || []).map(l => ({
        id: l.id, action: l.action, details: l.details, user: l.performed_by,
        ts: new Date(l.created_at).getTime()
      }));
      const pendingChanges = (window.qsdb && await window.qsdb.getAllPending()) || [];
      const pendingProductIds = new Set(
        pendingChanges.filter(c => c.type === 'updateProduct' || c.type === 'addProduct' || c.type === 'addStock')
          .map(c => c.item.id || c.item.productId)
      );
      const productMap = new Map((state.products || []).map(p => [p.id, p]));
      cloudProducts.forEach(p => { if (!pendingProductIds.has(p.id)) productMap.set(p.id, p); });
      const cloudProductIds = new Set(cloudProducts.map(p => p.id));
      // Keep product if: it exists in cloud OR it's pending upload to cloud (never discard unsynced work)
      state.products = Array.from(productMap.values()).filter(p =>
        cloudProductIds.has(p.id) || pendingProductIds.has(p.id)
      );
      // Sales merge: cloud returns only the last 90 days. Preserve local sales
      // outside that window — they are valid for historical reports and exports.
      const salesCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const salesMap = new Map(
        (state.sales || []).filter(s => s.ts < salesCutoff).map(s => [s.id, s])
      );
      cloudSales.forEach(s => salesMap.set(s.id, s));
      state.sales = Array.from(salesMap.values());
      // Merge notes: cloud is authoritative for known IDs, but preserve
      // local-only notes (created offline, not yet synced to cloud).
      if (cloudNotes.length > 0) {
        const cloudNoteIds = new Set(cloudNotes.map(n => n.id));
        const localOnlyNotes = (state.notes || []).filter(n => !cloudNoteIds.has(n.id));
        state.notes = [...cloudNotes, ...localOnlyNotes];
      }
      // If cloud returned nothing, keep local state unchanged.
      state.categories = cloudCategories.length > 0 ? cloudCategories : (state.categories.length > 0 ? state.categories : [...DEFAULT_CATEGORIES]);
      if (cloudLogs.length > 0) {
        const cloudLogIds = new Set(cloudLogs.map(l => l.id));
        const localOnly = (state.logs || []).filter(l => !cloudLogIds.has(l.id));
        state.logs = [...cloudLogs, ...localOnly].sort((a, b) => b.ts - a.ts).slice(0, 200);
      }
      // else: cloud returned nothing — keep local state.logs unchanged
      toast('Data synced from cloud', 'info', 1500);
    } catch (e) { errlog('syncCloudData failed', e); toast('Failed to sync cloud data', 'error'); }
    finally {
      showLoading(false);
      isSyncInProgress = false;
      _lastSyncAt = Date.now();
    }
    initAppUI();
    await saveState();
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §5  AUTH — mapAuthError, initAuthHandlers, initAuth, handleAuthUser, handleAuthLogout
  // ═══════════════════════════════════════════════════════════════════════════
  function mapAuthError(e) {
    if (!e) return 'An error occurred';
    const msg = e.message || String(e);
    if (msg.indexOf('network') !== -1 || msg.indexOf('fetch') !== -1) return 'Network error. Check connection.';
    if (msg.indexOf('already registered') !== -1 || msg.indexOf('already exists') !== -1) return 'Email already registered';
    if (msg.indexOf('Invalid login') !== -1) return 'Invalid email or password';
    if (msg.indexOf('Email not confirmed') !== -1) return 'Please verify your email first';
    if (msg.indexOf('password') !== -1 && msg.indexOf('short') !== -1) return 'Password is too weak (min 6 chars)';
    return msg;
  }

  function createPasswordToggle(inputId) {
    const input = $(inputId);
    if (!input) return null;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;';
    const parent = input.parentNode;
    parent.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.innerHTML = '👁️';
    toggle.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;border:0;font-size:18px;cursor:pointer;padding:4px 8px;opacity:0.7;transition:opacity 0.2s;';
    toggle.addEventListener('mouseover', () => { toggle.style.opacity = '1'; });
    toggle.addEventListener('mouseout', () => { toggle.style.opacity = '0.7'; });
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (input.type === 'password') {
        input.type = 'text';
        toggle.innerHTML = '🙈';
      } else {
        input.type = 'password';
        toggle.innerHTML = '👁️';
      }
    });
    wrapper.appendChild(toggle);
    return toggle;
  }

  function initAuthHandlers() {
    createPasswordToggle('loginPass');
    createPasswordToggle('signupPass');
    createPasswordToggle('signupPassConfirm');

    const loginForm = $('loginForm');
    if (loginForm) {
      const handleLoginSubmit = async (e) => {
        if (e) e.preventDefault();
        const loginEmail = $('loginEmail'), loginPass = $('loginPass');
        const email = (loginEmail && loginEmail.value || '').trim();
        const pass = (loginPass && loginPass.value) || '';
        if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (loginEmail) loginEmail.classList.add('error'); return; }
        if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (loginPass) loginPass.classList.add('error'); return; }
        try {
          showAuthLoading(); 
          const btnLogin = $('btnLogin');
          disableBtn(btnLogin, true);
          const supabase = getClient();
          if (!supabase) throw new Error('Supabase not initialized');
          const { data, error } = await supabase.auth.signInWithPassword({ email: email, password: pass });
          if (error) throw error;
          // Smart verification check:
          // When Supabase email verification is ON and user hasn't confirmed,
          // both email_confirmed_at and confirmed_at are null.
          // When verification is OFF, Supabase auto-sets confirmed_at.
          // So we only block if BOTH are null — meaning verification is
          // enabled and this user genuinely hasn't confirmed their email.
          const isConfirmed = data.user.email_confirmed_at || data.user.confirmed_at;
          if (!isConfirmed) {
            await supabase.auth.signOut();
            showVerificationNotice(email);
            toast('Please verify your email before logging in', 'error');
            return;
          }
          localStorage.setItem('qs_session_active', 'true');
          document.body.classList.add('mode-app');
          toast('Login successful');
        } catch (e) {
          errlog('login error', e);
          showLoginForm();
          toast(mapAuthError(e), 'error');
        } finally {
          const btnLogin = $('btnLogin');
          disableBtn(btnLogin, false);
          const authLoading = $('authLoading');
          if (authLoading) authLoading.style.display = 'none';
        }
      };

      loginForm.addEventListener('submit', handleLoginSubmit);
      const loginEmail = $('loginEmail');
      const loginPass = $('loginPass');
      if (loginEmail) {
        loginEmail.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleLoginSubmit();
          }
        });
      }
      if (loginPass) {
        loginPass.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleLoginSubmit();
          }
        });
      }
      const _btnLoginEl = $('btnLogin');
      if (_btnLoginEl) _btnLoginEl.addEventListener('click', handleLoginSubmit);
    }

    const btnShowSignup = $('btnShowSignup');
    if (btnShowSignup) btnShowSignup.addEventListener('click', showSignupForm);
    const btnBackToLogin = $('btnBackToLogin');
    if (btnBackToLogin) btnBackToLogin.addEventListener('click', showLoginForm);
    const btnForgotPassword = $('btnForgotPassword');
    if (btnForgotPassword) btnForgotPassword.addEventListener('click', showResetForm);
    const btnBackToLoginFromReset = $('btnBackToLoginFromReset');
    if (btnBackToLoginFromReset) btnBackToLoginFromReset.addEventListener('click', showLoginForm);

    const signupForm = $('signupForm');
    if (signupForm) {
      const handleSignupSubmit = async (e) => {
        if (e) e.preventDefault();
        const signupName = $('signupName'), signupBusiness = $('signupBusiness');
        const signupEmail = $('signupEmail'), signupPass = $('signupPass'), signupPassConfirm = $('signupPassConfirm');
        const name = (signupName && signupName.value || '').trim();
        const business = (signupBusiness && signupBusiness.value || '').trim();
        const email = (signupEmail && signupEmail.value || '').trim();
        const pass = (signupPass && signupPass.value) || '';
        const passConfirm = (signupPassConfirm && signupPassConfirm.value) || '';
        if (!name) { toast('Please enter your full name', 'error'); if (signupName) signupName.classList.add('error'); return; }
        if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (signupEmail) signupEmail.classList.add('error'); return; }
        if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (signupPass) signupPass.classList.add('error'); return; }
        if (pass !== passConfirm) { toast('Passwords do not match', 'error'); if (signupPassConfirm) signupPassConfirm.classList.add('error'); return; }
        try {
          showAuthLoading();
          const btnSignup = $('btnSignup');
          disableBtn(btnSignup, true);
          const supabase = getClient();
          if (!supabase) throw new Error('Supabase not initialized');
          const { data, error } = await supabase.auth.signUp({
            email: email, password: pass,
            options: { data: { full_name: name, business_name: business || null } }
          });
          if (error) throw error;
          const user = data.user;
          const profile = { uid: user.id, name, businessName: business || null, email: user.email, createdAt: Date.now() };
          await setUserProfile(user.id, profile);

          // ── Referral attribution ────────────────────────────────────────
          // Consume the pending referral captured at boot or from catalog.js.
          // Written once — never overwritten. Self-referral blocked here and
          // at DB level (trigger also checks referred_by !== id).
          try {
            var _pendingRef = sessionStorage.getItem('qs_referrer_id');
            if (
              _pendingRef &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(_pendingRef) &&
              _pendingRef !== user.id
            ) {
              const supabaseRef = getClient();
              if (supabaseRef) {
                await supabaseRef.from('profiles')
                  .update({ referred_by: _pendingRef })
                  .eq('id', user.id);
              }
            }
            sessionStorage.removeItem('qs_referrer_id');
          } catch (_refErr) { errlog('referral attribution', _refErr); }
          // ── End referral attribution ─────────────────────────────────────

          showVerificationNotice(email);
          toast('Account created — verification email sent. Please verify before logging in.');
        } catch (e) {
          errlog('signup error', e);
          showSignupForm();
          toast(mapAuthError(e), 'error');
        } finally {
          const btnSignup = $('btnSignup');
          disableBtn(btnSignup, false);
          const authLoading = $('authLoading');
          if (authLoading) authLoading.style.display = 'none';
        }
      };

      signupForm.addEventListener('submit', handleSignupSubmit);
      const signups = ['signupName', 'signupBusiness', 'signupEmail', 'signupPass', 'signupPassConfirm'];
      signups.forEach(Id => {
        const el = $(Id);
        if (el) {
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSignupSubmit();
            }
          });
        }
      });
      const _btnSignupEl = $('btnSignup');
      if (_btnSignupEl) _btnSignupEl.addEventListener('click', handleSignupSubmit);
    }

    const btnSendReset = $('btnSendReset');
    if (btnSendReset) {
      btnSendReset.addEventListener('click', async function () {
        const resetEmail = $('resetEmail');
        const email = (resetEmail && resetEmail.value || '').trim();
        if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (resetEmail) resetEmail.classList.add('error'); return; }
        try {
          showAuthLoading(); disableBtn(btnSendReset, true);
          const supabase = getClient();
          if (!supabase) throw new Error('Supabase not initialized');
          const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
          if (error) throw error;
          toast('Password reset email sent. Check your inbox.');
          showLoginForm();
        } catch (e) {
          errlog('reset error', e);
          showResetForm();
          toast(mapAuthError(e), 'error');
        } finally {
          disableBtn(btnSendReset, false);
          const authLoading = $('authLoading');
          if (authLoading) authLoading.style.display = 'none';
        }
      });
    }

    const btnResendVerification = $('btnResendVerification');
    if (btnResendVerification) {
      btnResendVerification.addEventListener('click', async function () {
        try {
          const supabase = getClient();
          const user = getUser();
          if (!user) { toast('You need to be signed in to resend verification', 'error'); return; }
          const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
          if (error) throw error;
          toast('Verification email resent. Check your inbox.');
        } catch (e) { errlog('resend verification error', e); toast('Failed to resend verification. Try again later.', 'error'); }
      });
    }

    const btnCheckVerification = $('btnCheckVerification');
    if (btnCheckVerification) {
      btnCheckVerification.addEventListener('click', async function () {
        try {
          showAuthLoading();
          const supabase = getClient();
          const { data, error } = await supabase.auth.getUser();
          if (error) throw error;
          if (data.user && data.user.email_confirmed_at) {
            toast('Email verified! Loading your account...');
          } else {
            toast('Email not verified yet. Please check your inbox.', 'error');
            showVerificationNotice(data.user.email);
          }
        } catch (e) {
          errlog('check verification error', e);
          toast('Error checking verification status', 'error');
          const user = getUser();
          showVerificationNotice(user && user.email);
        } finally {
          const authLoading = $('authLoading');
          if (authLoading) authLoading.style.display = 'none';
        }
      });
    }

    const btnLogoutFromVerification = $('btnLogoutFromVerification');
    if (btnLogoutFromVerification) {
      btnLogoutFromVerification.addEventListener('click', async function () {
        try {
          const supabase = getClient();
          if (supabase) await supabase.auth.signOut();
          toast('Logged out');
          showLoginForm();
        } catch (e) { errlog('logout error', e); toast('Logout failed', 'error'); }
      });
    }

    const btnLogout = $('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        const confirmed = await showConfirm({
          title: 'Sign Out',
          message: 'Are you sure you want to sign out?',
          okText: 'Sign Out',
          okDanger: true
        });
        if (!confirmed) return;
        try {
          const supabase = getClient();
          if (supabase) await supabase.auth.signOut();
          localStorage.removeItem('qs_session_active');
          document.body.classList.remove('mode-app');
          toast('Signed out');
          window.location.reload();
        } catch (e) { errlog('signout error', e); toast('Sign out failed: ' + (e.message || ''), 'error'); }
      });
    }
  }

  async function initAuth() {
    const sb = await waitForSupabaseReady();
    if (!sb || !sb.client) {
      log('No Supabase found. Running in offline/anon mode.');
      document.body.classList.remove('qs-auth-pending'); // no auth to wait for
      initAppUI();
      return;
    }
    const supabase = sb.client;

    // Dedup guard: track the last user ID that handleAuthUser was called for
    // so that getSession() and the immediate INITIAL_SESSION event — which
    // both fire on a warm session — do not run the full boot sequence twice.
    // SIGNED_IN always runs regardless (it represents a new login action).
    let _lastHandledUserId = null;

    let session = null;
    try {
      const { data } = await supabase.auth.getSession();
      session = data && data.session ? data.session : null;
    } catch (e) {
      errlog('getSession failed — booting in offline mode', e);
      // Supabase unreachable on cold start. Boot the UI anyway so the vendor
      // is not left on a blank screen. onAuthStateChange will fire when
      // connectivity resumes and will complete the auth flow at that point.
      document.body.classList.remove('qs-auth-pending');
      initAppUI();
      return;
    }

    if (session && session.user) {
      _lastHandledUserId = session.user.id;
      handleAuthUser(session.user);
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session && session.user) {
          // Skip if getSession() already handled this user above.
          if (session.user.id !== _lastHandledUserId) {
            _lastHandledUserId = session.user.id;
            handleAuthUser(session.user);
          }
        } else {
          handleAuthLogout();
        }
        return;
      }
      if (event === 'SIGNED_IN' && session && session.user) {
        // Always run on explicit sign-in — user may have switched accounts.
        _lastHandledUserId = session.user.id;
        handleAuthUser(session.user);
      } else if (event === 'USER_UPDATED' && session && session.user) {
        _lastHandledUserId = session.user.id;
        handleAuthUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        _lastHandledUserId = null;
        handleAuthLogout();
      } else if (event === 'TOKEN_REFRESH_ERROR') {
        console.warn('[QS] Token refresh failed — forcing logout.');
        _lastHandledUserId = null;
        handleAuthLogout();
      }
    });
  }

  function setSupabaseUser(user) {
    if (!window.__QS_SUPABASE) return;
    var desc = Object.getOwnPropertyDescriptor(window.__QS_SUPABASE, 'user');
    var writable = !desc || (!desc.get && !desc.set && desc.writable !== false);
    if (writable) { try { window.__QS_SUPABASE.user = user; } catch(_) {} }
  }

  async function handleAuthUser(user) {
    currentUser = user;
    setSupabaseUser(user);
    // Smart check: only block if BOTH fields are null.
    // When verification is OFF, Supabase auto-sets confirmed_at even if
    // email_confirmed_at is null. Checking only email_confirmed_at blocks
    // all users when verification is disabled.
    const isUserConfirmed = user.email_confirmed_at || user.confirmed_at;
    if (!isUserConfirmed) {
      localStorage.removeItem('qs_session_active');
      document.body.classList.remove('qs-auth-pending');
document.body.classList.remove('mode-app'); // auth resolved (unverified)
      const loginScreen = $('loginScreen'), appScreen = document.querySelector('.app');
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appScreen) appScreen.style.display = 'none';
      showVerificationNotice(user.email);
      return;
    }
    localStorage.setItem('qs_session_active', 'true');
    localStorage.setItem('qs_last_user_id', user.id);
    // Cache slim identity so renderSettingsPanel can render fully while offline.
    // Only id, email, and user_metadata — no tokens, no session data.
    try {
      localStorage.setItem('qs_user_cache', JSON.stringify({
        id: user.id,
        email: user.email || '',
        user_metadata: user.user_metadata || {}
      }));
    } catch(_) {}
    document.body.classList.add('mode-app');
    document.body.classList.remove('qs-auth-pending'); // auth resolved — allow landing rules to apply
    // Set Sentry user context — use ID only, never email (no PII in error reports)
    if (typeof Sentry !== 'undefined') {
      Sentry.setUser({ id: user.id });
    }
    const loginScreen = $('loginScreen');
    if (loginScreen) loginScreen.style.display = 'none';
    setBottomNavVisible(true);
    const userEmailEl = $('userEmail');
    if (userEmailEl) userEmailEl.textContent = user.email || '—';
    const userDisplayNameEl = $('userDisplayName');
    if (userDisplayNameEl) {
      const meta = user.user_metadata || {};
      const displayName = meta.full_name || meta.business_name || '';
      userDisplayNameEl.textContent = displayName ? `Name: ${displayName}` : '';
    }
    loadLocalData(user.id);
    await syncCloudData(user);
    // After cloud sync: if local products exist but cloud had none, queue them all for upload.
    // This recovers from the case where products were created offline or before Supabase tables existed.
    if (window.qsdb && window.qsdb.addPendingChange && state.products && state.products.length > 0) {
      try {
        const pending = await window.qsdb.getAllPending();
        const alreadyQueued = new Set(pending.map(p => p.item && (p.item.id || p.item.productId)).filter(Boolean));
        for (const p of state.products) {
          if (!alreadyQueued.has(p.id)) {
            await window.qsdb.addPendingChange({ type: 'addProduct', item: p });
          }
        }
        await window.qsdb.syncPendingToSupabase();
      } catch(e) { errlog('bootstrap product push failed', e); }
    }
    document.dispatchEvent(new Event('qs:user:auth'));

    // If settings panel is active, re-render it now that currentUser is set.
    // Without this, navigating to settings before auth resolves leaves
    // the panel blank permanently until the vendor navigates away and back.
    const settingsPanel = $('settingsPanel');
    if (settingsPanel && settingsPanel.classList.contains('active')) {
      renderSettingsPanel();
    }
  }

  function handleAuthLogout() {
    currentUser = null;
    setSupabaseUser(null);
    localStorage.removeItem('qs_session_active');
    localStorage.removeItem('qs_last_user_id');
    localStorage.removeItem('qs_user_cache');
    // Clear Sentry user so subsequent errors aren't attributed to the old user
    if (typeof Sentry !== 'undefined') {
      Sentry.setUser(null);
    }
    document.body.classList.remove('qs-auth-pending');
document.body.classList.remove('mode-app'); // auth resolved (logged out)
    const loginScreen = $('loginScreen'), appScreen = document.querySelector('.app');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
    showLoginForm();
    setBottomNavVisible(false);
    const userEmailEl = $('userEmail'), userDisplayNameEl = $('userDisplayName');
    if (userEmailEl) userEmailEl.textContent = '—';
    if (userDisplayNameEl) userDisplayNameEl.textContent = '';
    loadLocalData(null);
    showLoading(false);
  }

  function initOnlineOfflineHandlers() {
    window.addEventListener('online', () => {
      toast('Back online — syncing...', 'info');
      if (currentUser) syncCloudData(currentUser);
    });
    window.addEventListener('offline', () => {
      toast('You are offline. Changes will sync when reconnected.', 'warning', 4000);
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §6  SCANNER — barcode, smart scan
  // ═══════════════════════════════════════════════════════════════════════════
  function stopScanner() {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.stopScanner();
  }

  function handleScanResult(result) {
    // Moved to inventory.js
  }

  async function startScanner(mode = 'form') {
    if (window.__QS_INVENTORY) return window.__QS_INVENTORY.startScanner(mode);
  }

  function initBarcodeScannerHandlers() {
    // Moved to inventory.js — called via initAll()
  }

  function hideSmartModal() {
    // Moved to inventory.js
  }

  function initSmartScannerHandlers() {
    // Moved to inventory.js — called via initAll()
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §7  INVENTORY — PRODUCTS — chips, renderProducts, openModalFor, doAddStock,
  //                            doSell, undoLastFor, activityLog, auditLog
  // ═══════════════════════════════════════════════════════════════════════════
  function renderChips() {
    try {
    const chipsEl = $('chips');
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    const displayCategories = ['All', ...state.categories];
    displayCategories.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (c === activeCategory ? ' active' : '');
      btn.type = 'button';
      btn.textContent = c;
      btn.addEventListener('click', function () { activeCategory = c; renderChips(); renderProducts(); });
      chipsEl.appendChild(btn);
    });
    } catch(e) { errlog('renderChips', e); }
  }

  let searchTimer = null;
  function scheduleRenderProducts() { clearTimeout(searchTimer); searchTimer = setTimeout(renderProducts, 120); }

  function renderProducts() {
    try {
    const productListEl = $('productList'), headerSearch = $('headerSearchInput');
    if (!productListEl) return;
    productListEl.innerHTML = '';
    const q = (headerSearch && headerSearch.value.trim().toLowerCase()) || '';
    const items = (state.products || []).filter(p => {
      if (activeCategory !== 'All' && (p.category || 'Others') !== activeCategory) return false;
      if (q && !(((p.name || '').toLowerCase().includes(q)) || ((p.barcode || '') + '').includes(q))) return false;
      return true;
    });
    if (!items.length) {
      const no = document.createElement('div');
      no.className = 'small';
      no.style.padding = '14px';
      no.style.background = 'var(--card-glass)';
      no.style.borderRadius = '12px';
      no.style.border = '1px solid var(--border-glass)';
      no.textContent = 'No products — add from Inventory or load demo';
      productListEl.appendChild(no);
      return;
    }
    for (const p of items) {
      const card = document.createElement('div');
      card.className = 'product-card';
      const thumb = document.createElement('div');
      thumb.className = 'p-thumb';
      if (p.image) {
        const img = document.createElement('img');
        img.src = p.image;
        img.alt = p.name || 'thumb';
        img.crossOrigin = 'anonymous';
        thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase());
      }
      const info = document.createElement('div');
      info.className = 'p-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'p-name';
      nameEl.textContent = p.name || 'Unnamed';
      const subEl = document.createElement('div');
      subEl.className = 'p-sub';
      const qtyText = (typeof p.qty === 'number') ? `${p.qty} in stock` : '—';
      subEl.textContent = `${qtyText} • ${fmt(p.price || 0)}` + (p.barcode ? (' • Barcode: ' + p.barcode) : '');
      info.appendChild(nameEl);
      info.appendChild(subEl);
      const actions = document.createElement('div');
      actions.className = 'p-actions';
      const group = document.createElement('div');
      group.className = 'p-actions-row';
      const sell = document.createElement('button');
      sell.className = 'btn-sell';
      sell.type = 'button';
      sell.textContent = 'Sell';
      sell.dataset.id = p.id;
      sell.dataset.action = 'sell';
      const undo = document.createElement('button');
      undo.className = 'btn-undo';
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.dataset.id = p.id;
      undo.dataset.action = 'undo';
      group.appendChild(sell);
      group.appendChild(undo);
      actions.appendChild(group);
      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(actions);
      productListEl.appendChild(card);
    }
    } catch(e) { errlog('renderProducts', e); const el=$('productList'); if(el){el.innerHTML='';const d=document.createElement('div');d.className='small';d.style.padding='14px';d.textContent='Display error — pull to refresh.';el.appendChild(d);} }
  }

  function initProductListHandlers() {
    const productListEl = $('productList');
    if (productListEl) {
      productListEl.addEventListener('click', function (ev) {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const act = btn.dataset.action, id = btn.dataset.id;
        if (act === 'sell') { openModalFor('sell', id); return; }
        if (act === 'undo') { undoLastFor(id); return; }
      });
    }
  }

  function openModalFor(mode, productId) {
    const p = (state.products || []).find(x => x.id === productId);
    if (!p) { toast('Product not found', 'error'); return; }
    modalContext = { mode, productId, paymentMethod: null };

    const titleEl  = $('modalTitle');
    const itemEl   = $('modalItem');
    const metaEl   = $('modalMeta');
    const totalEl  = $('modalTotal');
    const qtyEl    = $('modalQty');
    const payRow   = $('modalPayRow');
    const payLabel = $('modalPayLabel');
    const confirm  = $('modalConfirm');

    if (titleEl) titleEl.textContent = mode === 'sell' ? 'Sell Items' : 'Add Stock';

    if (itemEl) itemEl.textContent = p.name;

    if (metaEl) {
      metaEl.innerHTML = '';
      const badge = document.createElement('span');
      badge.className = 'modal-cat-badge';
      badge.textContent = p.category || 'General';
      const stock = document.createElement('span');
      stock.className = 'modal-stock-text';
      stock.textContent = typeof p.qty === 'number' ? p.qty + ' in stock' : 'stock unknown';
      metaEl.appendChild(badge);
      metaEl.appendChild(stock);
    }

    if (qtyEl) qtyEl.value = 1;

    if (totalEl) {
      totalEl.textContent = 'Total \u2014 ' + fmt(window.n(p.price) * 1);
    }

    const isSell = mode === 'sell';
    if (payRow)   payRow.style.display   = isSell ? 'flex'  : 'none';
    if (payLabel) payLabel.style.display = isSell ? 'block' : 'none';

    [$('modalPayCash'), $('modalPayTransfer')].forEach(function(btn) {
      if (btn) btn.classList.remove('active');
    });

    if (confirm) confirm.disabled = isSell;

    showModal();
  }

  // FIX 3: _modalConfirmLock prevents double-click race that could trigger two sells.
  let _modalConfirmLock = false;
  function initModalHandlers() {
    const modalCancel = $('modalCancel');
    if (modalCancel) modalCancel.addEventListener('click', hideModal);

    const modalBackdropEl = $('modalBackdrop');
    if (modalBackdropEl) {
      modalBackdropEl.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'modalBackdrop') hideModal();
      });
    }

    // Live total update as qty changes
    const modalQtyEl = $('modalQty');
    if (modalQtyEl) {
      modalQtyEl.addEventListener('input', function () {
        if (!modalContext || modalContext.mode !== 'sell') return;
        const p = state.products.find(x => x.id === modalContext.productId);
        if (!p) return;
        const q = Math.max(1, Math.floor(window.n(this.value)));
        const totalEl = $('modalTotal');
        if (totalEl) totalEl.textContent = 'Total \u2014 ' + fmt(window.n(p.price) * q);
      });
    }

    // Payment method toggle buttons
    [$('modalPayCash'), $('modalPayTransfer')].forEach(function (btn) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (!modalContext) return;
        modalContext.paymentMethod = this.dataset.method;
        [$('modalPayCash'), $('modalPayTransfer')].forEach(function (b) {
          if (b) b.classList.remove('active');
        });
        this.classList.add('active');
        const confirm = $('modalConfirm');
        if (confirm) confirm.disabled = false;
      });
    });

    const modalConfirm = $('modalConfirm');
    if (modalConfirm) {
      modalConfirm.addEventListener('click', async function () {
        if (_modalConfirmLock) return;
        _modalConfirmLock = true;
        modalConfirm.disabled = true;
        try {
          if (!modalContext) { hideModal(); return; }
          const qtyEl = $('modalQty');
          const q = Math.max(1, Math.floor(window.n(qtyEl && qtyEl.value)));
          if (modalContext.mode === 'sell') {
            const p = state.products.find(x => x.id === modalContext.productId);
            if (!p) { toast('Product not found.', 'error'); hideModal(); return; }
            if (typeof p.qty !== 'number') p.qty = 0;
            if (p.qty < q) {
              let errEl = $('modalError');
              if (!errEl) {
                errEl = document.createElement('div');
                errEl.id = 'modalError';
                errEl.className = 'error-text';
                errEl.style.marginTop = '10px';
                qtyEl.parentElement.insertAdjacentElement('afterend', errEl);
              }
              errEl.textContent = `Not enough stock. You only have ${p.qty}.`;
              const modal = qtyEl.closest('.modal');
              if (modal) {
                modal.style.animation = 'shake 0.3s ease';
                setTimeout(() => { modal.style.animation = ''; }, 300);
              }
              return;
            }
            let errEl = $('modalError');
            if (errEl) errEl.textContent = '';
            doSell(modalContext.productId, q, modalContext.paymentMethod);
          } else {
            doAddStock(modalContext.productId, q);
          }
          hideModal();
        } finally {
          _modalConfirmLock = false;
          // Re-disable for sell mode if no payment chosen (guards if modal stays open)
          if (modalContext && modalContext.mode === 'sell' && !modalContext.paymentMethod) {
            modalConfirm.disabled = true;
          } else {
            modalConfirm.disabled = false;
          }
        }
      });
    }
  }

  function addActivityLog(action, details) {
    const user = currentUser ? (currentUser.email || 'User') : 'Anon';
    const entry = { id: uid(), ts: Date.now(), action: action, details: details, user: user };
    if (!state.logs) state.logs = [];
    state.logs.unshift(entry);
    if (state.logs.length > 200) state.logs = state.logs.slice(0, 200);
    saveState();
  }

  // FIX 4: Use DOM methods only — no innerHTML with user-controlled data.
  function renderActivityLog() {
    try {
    const container = $('activityLogArea');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:600;margin-bottom:8px;margin-top:24px;color:var(--text-primary);';
    heading.textContent = 'Activity History (Audit Log)';
    container.appendChild(heading);

    const sub = document.createElement('div');
    sub.className = 'small';
    sub.style.cssText = 'margin-bottom:12px;color:var(--text-secondary);';
    sub.textContent = 'Review recent actions. Click to view full log.';
    container.appendChild(sub);

    const listEl = document.createElement('div');
    listEl.id = 'activityLogList';
    listEl.style.cssText = 'display:flex;flex-direction:column;gap:0;max-height:300px;overflow-y:auto;border:1px solid var(--border-glass);padding:0;border-radius:var(--radius);background:var(--card-glass);';
    container.appendChild(listEl);

    const logs = (state.logs || []).slice(0, 5);
    if (logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.style.cssText = 'color:var(--text-muted);text-align:center;padding:20px;';
      empty.textContent = 'No activity recorded yet.';
      listEl.appendChild(empty);
      setupActivityLogClick();
      return;
    }
    logs.forEach(logEntry => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:12px;background:var(--card-glass);border-bottom:1px solid var(--border-glass);font-size:13px;cursor:pointer;transition:background 0.2s;';

      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;justify-content:space-between;color:var(--text-muted);font-size:11px;margin-bottom:4px;';
      const tsSpan = document.createElement('span');
      tsSpan.textContent = formatDateTime(logEntry.ts);
      const userSpan = document.createElement('span');
      userSpan.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      userSpan.textContent = logEntry.user || '';
      topRow.appendChild(tsSpan);
      topRow.appendChild(userSpan);

      const botRow = document.createElement('div');
      botRow.style.cssText = 'display:flex;justify-content:space-between;margin-top:4px;';
      const actionSpan = document.createElement('span');
      actionSpan.style.fontWeight = '600';
      actionSpan.style.color = (logEntry.action === 'Delete' || logEntry.action === 'Undo') ? '#ef4444' : 'var(--text-primary)';
      actionSpan.textContent = logEntry.action || '';
      const detailSpan = document.createElement('span');
      detailSpan.style.cssText = 'color:var(--text-secondary);font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      detailSpan.textContent = logEntry.details || '';
      botRow.appendChild(actionSpan);
      botRow.appendChild(detailSpan);

      row.appendChild(topRow);
      row.appendChild(botRow);
      listEl.appendChild(row);
    });
    setupActivityLogClick();
    } catch(e) { errlog('renderActivityLog', e); }
  }

  // FIX 5: Use DOM methods only — no innerHTML with user-controlled data.
  function openFullAuditLog() {
    const modal = $('fullAuditLogModal'), list = $('fullAuditLogList');
    if (!modal || !list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    list.style.border = 'none';
    list.style.background = 'transparent';

    const logs = state.logs || [];
    if (logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.style.cssText = 'padding:40px;text-align:center;color:var(--text-muted)';
      empty.textContent = 'No activity recorded yet.';
      list.appendChild(empty);
    } else {
      logs.forEach(logEntry => {
        const row = document.createElement('div');
        row.className = 'full-log-row';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';
        const tsSpan = document.createElement('span');
        tsSpan.style.cssText = 'font-size:11px;color:var(--text-muted)';
        tsSpan.textContent = formatDateTime(logEntry.ts);
        const userSpan = document.createElement('span');
        userSpan.style.cssText = 'font-size:11px;color:var(--text-muted)';
        userSpan.textContent = logEntry.user || '';
        topRow.appendChild(tsSpan);
        topRow.appendChild(userSpan);

        const botRow = document.createElement('div');
        botRow.style.cssText = 'display:flex;justify-content:space-between;';
        const actionSpan = document.createElement('span');
        actionSpan.style.fontWeight = '700';
        actionSpan.style.color = (logEntry.action === 'Delete' || logEntry.action === 'Undo') ? '#ef4444' : 'var(--text-primary)';
        actionSpan.textContent = logEntry.action || '';
        const detailSpan = document.createElement('span');
        detailSpan.style.cssText = 'color:var(--text-secondary);font-size:13px';
        detailSpan.textContent = logEntry.details || '';
        botRow.appendChild(actionSpan);
        botRow.appendChild(detailSpan);

        row.appendChild(topRow);
        row.appendChild(botRow);
        list.appendChild(row);
      });
    }
    modal.style.display = 'flex';
  }

  function closeFullAuditLog() {
    const modal = $('fullAuditLogModal');
    if (!modal || modal.style.display === 'none') return;
    // slideDown animation defined in styless.css via .full-screen-modal.closing
    modal.classList.add('closing');
    setTimeout(() => {
      modal.style.display = 'none';
      modal.classList.remove('closing');
    }, 230);
  }

  function exportAuditLog() {
    const rows = [['Timestamp','User','Action','Details']];
    (state.logs || []).forEach(log => {
      rows.push([new Date(log.ts).toISOString(), log.user, log.action, log.details]);
    });
    generateCsv(rows, 'audit_log');
    toast('Audit log exported');
  }

  function initAuditLogHandlers() {
    const closeAuditBtn = $('closeAuditModalBtn');
    if (closeAuditBtn) closeAuditBtn.addEventListener('click', closeFullAuditLog);
    const exportAuditBtn = $('exportAuditLogBtn');
    if (exportAuditBtn) exportAuditBtn.addEventListener('click', exportAuditLog);
  }

  async function doAddStock(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = (typeof p.qty === 'number' ? p.qty : 0) + qty;
    const change = { type: 'updateProduct', item: p };
    state.changes.push({ type: 'add', productId, qty, ts: Date.now() });
    addActivityLog('Restock', `Added ${qty} to ${p.name}`);
    // Optimistic: render immediately, sync in background
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Added ${qty} to ${p.name}`);
    // Persist to localStorage immediately before async queue
    try {
      const localKey = currentUser ? LOCAL_KEY_PREFIX + currentUser.id : LOCAL_KEY_PREFIX + 'anon';
      localStorage.setItem(localKey, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) { errlog('restock localStorage failed', e); }

    if (window.qsdb && window.qsdb.addPendingChange) {
      try {
        await window.qsdb.addPendingChange(change);
      } catch (e) { errlog('restock queue failed', e); }
    }
    saveState().catch(e => errlog('restock sync', e));
  }

  async function doSell(productId, qty, paymentMethod) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = p.qty - qty;
    const newSale = {
      productId,
      qty,
      price: window.n(p.price),
      cost: window.n(p.cost),
      ts: Date.now(),
      id: uid(),
      productName: p.name || null,
      barcode: p.barcode || null,
      category: p.category || null,
      paymentMethod: paymentMethod || null
    };
    state.sales.push(newSale);
    state.changes.push({ type: 'sell', productId, qty, ts: newSale.ts });
    addActivityLog('Sale', `Sold ${qty} x ${p.name} (${fmt(newSale.price * qty)})`);

    // ── Render immediately — sale is in state, UI must update now ────
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Sold ${qty} × ${p.name}`);

    // ── Persist to localStorage FIRST ────────────────────────────────
    // saveState() writes to localStorage synchronously before any async
    // IndexedDB or Supabase calls. This guarantees the sale survives a
    // reload or pull-to-refresh even if the queue fails.
    try {
      const localKey = currentUser ? LOCAL_KEY_PREFIX + currentUser.id : LOCAL_KEY_PREFIX + 'anon';
      localStorage.setItem(localKey, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) { errlog('sell localStorage failed', e); }

    // ── Queue to IndexedDB for cloud sync (non-blocking) ─────────────
    if (window.qsdb && window.qsdb.addPendingChange) {
      try {
        await window.qsdb.addPendingChange({ type: 'addSale', item: newSale });
        await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
      } catch (e) {
        errlog('sell queue failed', e);
        // Sale is already in localStorage — it will not be lost.
        // syncCloudData will push it when the user is back online
        // via the saveState → Supabase path.
      }
    }

    // Full saveState for notes/logs/categories (non-blocking)
    saveState().catch(e => errlog('sell sync', e));
  }

  async function undoLastFor(productId) {
    for (let i = state.changes.length - 1; i >= 0; i--) {
      const ch = state.changes[i];
      if (ch.productId !== productId) continue;
      if (ch.type === 'add') {
        const p = state.products.find(x => x.id === productId);
        if (p) {
          p.qty = (typeof p.qty === 'number' ? Math.max(0, p.qty - ch.qty) : 0);
          addActivityLog('Undo', `Reverted Restock of ${ch.qty} ${p.name}`);
        }
        state.changes.splice(i,1);
        renderInventory(); renderProducts(); renderDashboard();
        toast(`Reverted add of ${ch.qty}`);
        if (p && window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
        saveState().catch(e => errlog('undo sync', e));
        return;
      }
      if (ch.type === 'sell') {
        for (let j = state.sales.length - 1; j >= 0; j--) {
          const s = state.sales[j];
          if (s.productId === productId && s.qty === ch.qty && Math.abs(s.ts - ch.ts) < 120000) {
            const saleToRemove = state.sales.splice(j,1)[0];
            const p = state.products.find(x => x.id === productId);
            if (p) {
              p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
              addActivityLog('Undo', `Reverted Sale of ${ch.qty} ${p.name}`);
            }
            state.changes.splice(i,1);
            renderInventory(); renderProducts(); renderDashboard();
            toast(`Reverted sale of ${ch.qty}`);
            if (saleToRemove && window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'removeSale', item: saleToRemove });
            if (p && window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
            saveState().catch(e => errlog('undo sync', e));
            return;
          }
        }
        toast('Could not find exact sale to revert.', 'error');
        return;
      }
    }
    toast('No recent changes to undo for this product', 'error');
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §8  INVENTORY — FORMS — imageUpload, clearAddForm, validateProduct,
  //                         initAddProductHandler, renderInventory, CSV import
  // ═══════════════════════════════════════════════════════════════════════════
  function clearInvImage() {
    if (window.__QS_INVENTORY) { /* clearInvImage handled in inventory.js */ }
  }

  function clearInvImage2() {
    if (window.__QS_INVENTORY) { /* clearInvImage2 handled in inventory.js */ }
  }

  function initImageUploadHandler() {
    // Moved to inventory.js — called via initAll()
  }

  function clearAddForm() {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.clearAddForm();
  }

  function populateCategoryDropdown() {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.populateCategoryDropdown();
  }

  function validateProduct(name, price, cost, qty, barcode, currentId = null) {
    // Moved to inventory.js
  }

  function initAddProductHandler() {
    // Moved to inventory.js — called via initAll()
  }

  function renderInventory() {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.renderInventory();
  }

  function initInventoryListHandlers() {
    // Moved to inventory.js — called via initAll()
  }

  function openEditProduct(id) {
    if (window.__QS_INVENTORY) window.__QS_INVENTORY.openEditProduct(id);
  }

  async function removeProduct(id) {
    // Moved to inventory.js
  }



  // ── CSV BULK IMPORT ──────────────────────────────────────────────────────
  function parseCsvRow(row) {
    // Moved to inventory.js
  }

  function parseCsv(text) {
    // Moved to inventory.js
  }

  function downloadCsvTemplate() {
    // Moved to inventory.js
  }

  function showCsvImportModal() {
    // Moved to inventory.js
  }

  function initCsvImportHandler() {
    // Moved to inventory.js — called via initAll()
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §10  DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  function renderDashboard() {
    try {
    const dashRevenueEl = $('dashRevenue'), dashProfitEl = $('dashProfit'), dashTopEl = $('dashTop');
    const now   = Date.now();
    const today = startOfDay(now);
    const yesterday = today - 86400000;

    const salesToday = (state.sales || []).filter(s => s.ts >= today);
    const salesYest  = (state.sales || []).filter(s => s.ts >= yesterday && s.ts < today);

    const revenue  = salesToday.reduce((a,s)=>a+(window.n(s.price)*window.n(s.qty)),0);
    const revYest  = salesYest.reduce((a,s)=>a+(window.n(s.price)*window.n(s.qty)),0);
    const cost     = salesToday.reduce((a,s)=>a+(window.n(s.cost)*window.n(s.qty)),0);
    const profit   = revenue - cost;
    const profYest = salesYest.reduce((a,s)=>a+(window.n(s.price)-window.n(s.cost))*window.n(s.qty),0);

    function trendBadge(cur, prev) {
      if (!prev) return '';
      const pct = ((cur - prev) / prev * 100).toFixed(0);
      const up  = cur >= prev;
      return '<span style="font-size:10px;font-weight:700;color:' + (up ? 'var(--accent-emerald)' : 'var(--danger)') + ';margin-left:4px;">' + (up ? '▲' : '▼') + Math.abs(pct) + '%</span>';
    }

    function animateDashVal(el, text, cardEl) {
      if (!el) return;
      el.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'dash-val-animating';
      span.textContent = text;
      el.appendChild(span);
      if (cardEl) {
        cardEl.classList.remove('dash-card-flash');
        void cardEl.offsetWidth; // reflow to restart animation
        cardEl.classList.add('dash-card-flash');
        setTimeout(function () { cardEl.classList.remove('dash-card-flash'); }, 600);
      }
    }

    if (dashRevenueEl) {
      const cardEl = dashRevenueEl.closest('.dash-card');
      animateDashVal(dashRevenueEl, fmt(revenue), cardEl);
      dashRevenueEl.insertAdjacentHTML('beforeend', trendBadge(revenue, revYest));
    }
    if (dashProfitEl) {
      const cardEl = dashProfitEl.closest('.dash-card');
      animateDashVal(dashProfitEl, fmt(profit), cardEl);
      dashProfitEl.insertAdjacentHTML('beforeend', trendBadge(profit, profYest));
    }

    const overallByProd = {};
    (state.sales||[]).forEach(s => overallByProd[s.productId] = (overallByProd[s.productId]||0)+s.qty);
    const overallArr = Object.entries(overallByProd).sort((a,b)=>b[1]-a[1]);
    let topName = '—';
    if (overallArr.length > 0 && overallArr[0]) {
      const topId = overallArr[0][0];
      const topProd = state.products.find(p => p.id === topId);
      topName = topProd ? topProd.name : 'N/A';
    }
    if (dashTopEl) dashTopEl.textContent = topName;

    // Sub-labels: update dash-small with live context
    const cards = document.querySelectorAll('.dash-card');
    if (cards[0]) cards[0].querySelector('.dash-small').textContent = 'Revenue · ' + salesToday.length + ' sales';
    if (cards[1]) cards[1].querySelector('.dash-small').textContent = 'Profit · ' + (state.products||[]).length + ' products';
    if (cards[2]) cards[2].querySelector('.dash-small').textContent = 'All-time bestseller';
    } catch(e) { errlog('renderDashboard', e); }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §11  NOTES
  // ═══════════════════════════════════════════════════════════════════════════
  function renderNotes() {
    try {
    const notesListEl = $('notesList');
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    const notes = (state.notes || []).slice().sort((a,b)=>b.ts - a.ts);
    if (!notes.length) {
      const no = document.createElement('div');
      no.className = 'small';
      // Empty state — points to the composer below, not "above"
      no.innerHTML = '<div style="font-size:36px;margin-bottom:12px;">📓</div>' +
        '<div style="font-weight:700;font-size:14px;color:var(--text-primary);margin-bottom:6px;">No notes yet</div>' +
        '<div>Tap the compose bar below to write your first note.</div>';
      notesListEl.appendChild(no);
      return;
    }
    for (const note of notes) {
      const item = document.createElement('div');
      // Preserve is-editing highlight if this note is currently being edited
      item.className = 'note-item' + (editingNoteId === note.id ? ' is-editing' : '');
      item.dataset.noteId = note.id;

      if (note.title) {
        const t = document.createElement('div');
        t.className = 'note-item-title';
        t.textContent = note.title;
        item.appendChild(t);
      }

      const c = document.createElement('div');
      c.className = 'note-item-content';
      c.textContent = note.content;
      item.appendChild(c);

      // Footer: timestamp left, icon buttons right
      const footer = document.createElement('div');
      footer.className = 'note-item-footer';

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      meta.textContent = formatDateTime(note.ts);
      footer.appendChild(meta);

      const acts = document.createElement('div');
      acts.className = 'note-item-actions';

      const edit = document.createElement('button');
      edit.className = 'note-icon-btn edit';
      edit.setAttribute('aria-label', 'Edit note');
      edit.dataset.editNote = note.id;
      edit.textContent = '✏️';

      const del = document.createElement('button');
      del.className = 'note-icon-btn delete';
      del.setAttribute('aria-label', 'Delete note');
      del.dataset.deleteNote = note.id;
      del.textContent = '🗑️';

      acts.appendChild(edit);
      acts.appendChild(del);
      footer.appendChild(acts);
      item.appendChild(footer);
      notesListEl.appendChild(item);
    }
    } catch(e) { errlog('renderNotes', e); const el=$('notesList'); if(el){el.innerHTML='';const d=document.createElement('div');d.className='small';d.style.padding='14px';d.textContent='Display error — pull to refresh.';el.appendChild(d);} }
  }

  function initNotesHandlers() {
    // Notes IDs used in the DOM:
    //   noteTitle       → title text 
    //   noteContent → content textarea  (DOM id; NOT "noteContent")
    //   noteSaveBtn     → save / update button
    //   noteCancelBtn   → cancel edit button
    // All references below use noteContent to match the DOM.

    const notesListEl = $('notesList');
    if (notesListEl) {
      notesListEl.addEventListener('click', async function(e) {
        const editBtn = e.target.closest('[data-edit-note]');
        if (editBtn) {
          const id = editBtn.dataset.editNote;
          const note = state.notes.find(n=>n.id===id);
          if (!note) return;
          const noteTitle = $('noteTitleInput');
          const noteContent = $('noteContentInput');  // FIX: was 'noteContent', DOM id is noteContent
          const noteSaveBtn = $('noteSaveBtn');
          if (noteTitle) noteTitle.value = note.title || '';
          if (noteContent) noteContent.value = note.content || '';
          editingNoteId = note.id;
          if (noteSaveBtn) noteSaveBtn.textContent = 'Update Note';
          // Composer is fixed at the bottom — no scroll needed.
          // Focus is handled by _openComposer() in the UI listener below.
          return;
        }
        const delBtn = e.target.closest('[data-delete-note]');
        if (delBtn) {
          const confirmed = await showConfirm({
            title: 'Delete Note?',
            message: 'Are you sure you want to delete this note?',
            okText: 'Delete',
            okDanger: true
          });
          if (!confirmed) return;
          const noteId = delBtn.dataset.deleteNote;
          state.notes = state.notes.filter(n => n.id !== noteId);
          renderNotes();
          toast('Note deleted');
          // Queue removeNote to IndexedDB — handles both online and offline.
          // Prevents zombie resurrection where cloud note overwrites local delete on next sync.
          if (window.qsdb && window.qsdb.addPendingChange) {
            window.qsdb.addPendingChange({ type: 'removeNote', item: { id: noteId } })
              .catch(e => errlog('note delete queue failed', e));
          }
          saveState();
        }
      });
    }

    // Double-save guard: a lock flag prevents re-entry during the async save.
    // The listener is added ONCE at startup (not inside renderNotes), so
    // there is no accumulation of duplicate handlers across re-renders.
    let _noteSaving = false;
    const noteSaveBtn = $('noteSaveBtn');
    if (noteSaveBtn) {
      noteSaveBtn.addEventListener('click', async function () {
        if (_noteSaving) return; // debounce guard

        // FIX: resolve to the correct DOM id 'noteContent'
        const noteTitle = $('noteTitleInput');
        const noteContent = $('noteContentInput');  // FIX: was 'noteContent'

        const title = (noteTitle ? noteTitle.value : '').trim();
        // FIX: guard against null ref — content is empty string when element missing
        const content = (noteContent ? noteContent.value : '').trim();

        if (!content) { toast('Please write something in the note', 'error'); return; }

        _noteSaving = true;
        const originalBtnText = noteSaveBtn.textContent;
        noteSaveBtn.disabled = true;
        noteSaveBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block"></span> Saving…</span>';
        try {
          // ── OPTIMISTIC: mutate state, clear form, render immediately ──
          // Capture editingNoteId BEFORE clearing it.
          // Previously editingNoteId was set to null before the savedNote
          // lookup below, so edited notes were never found and the wrong
          // note (the last one) was queued to IndexedDB.
          const editedNoteId = editingNoteId;
          if (editingNoteId) {
            const note = state.notes.find(n=>n.id===editingNoteId);
            if (note) { note.title = title; note.content = content; note.ts = Date.now(); }
            editingNoteId = null;
            noteSaveBtn.textContent = 'Save Note';
          } else {
            state.notes.push({ id: noteUid(), title, content, ts: Date.now() });
          }
          if (noteTitle) noteTitle.value = '';
          if (noteContent) noteContent.value = '';
          renderNotes(); // instant UI update — don't wait for network
          toast(originalBtnText === 'Update Note' ? '✓ Note updated' : '✓ Note saved');
          // ── BACKGROUND SYNC ──
          // Queue to IndexedDB first — works online AND offline.
          // On reconnect, indexeddb_sync will push to Supabase automatically.
          // Use editedNoteId (captured above) not editingNoteId (now null).
          const savedNote = editedNoteId
            ? state.notes.find(n => n.id === editedNoteId)
            : state.notes[state.notes.length - 1];
          if (savedNote && window.qsdb && window.qsdb.addPendingChange) {
            window.qsdb.addPendingChange({ type: 'addNote', item: savedNote })
              .catch(e => errlog('note queue failed', e));
          }
          saveState().catch(e => { errlog('note sync error', e); toast('Sync failed — changes saved locally', 'error'); });
        } finally {
          _noteSaving = false;
          noteSaveBtn.disabled = false;
          noteSaveBtn.textContent = 'Save Note';
        }
      });
    }

    const noteCancelBtn = $('noteCancelBtn');
    if (noteCancelBtn) {
      noteCancelBtn.addEventListener('click', function () {
        const noteTitle = $('noteTitleInput');
        const noteContent = $('noteContentInput');  // FIX: was 'noteContent'
        const noteSaveBtn = $('noteSaveBtn');
        editingNoteId = null;
        if (noteTitle) noteTitle.value = '';
        if (noteContent) noteContent.value = '';
        if (noteSaveBtn) noteSaveBtn.textContent = 'Save Note';
        // Collapse composer back to trigger bar and clear edit highlight
        _collapseComposer();
        _clearEditHighlight();
      });
    }

    // ── Composer expand / collapse ─────────────────────────────────────
    // The trigger bar expands into the full form. Cancel collapses it back.
    // These are purely UI — no data-path logic touched.
    var _composerOpen = false;

    function _openComposer() {
      var wrap    = document.getElementById('qs-composer-wrap');
      var trigger = document.getElementById('qs-composer-trigger');
      var form    = document.getElementById('qs-composer-form');
      if (!wrap) return;
      _composerOpen = true;
      wrap.classList.add('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      if (form)    form.setAttribute('aria-hidden', 'false');
      // Focus the textarea after the grid-row animation (280 ms)
      setTimeout(function () {
        var ta = $('noteContentInput');
        if (ta) ta.focus();
      }, 290);
    }

    function _collapseComposer() {
      var wrap    = document.getElementById('qs-composer-wrap');
      var trigger = document.getElementById('qs-composer-trigger');
      var form    = document.getElementById('qs-composer-form');
      if (!wrap) return;
      _composerOpen = false;
      wrap.classList.remove('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (form)    form.setAttribute('aria-hidden', 'true');
      // Reset char counter
      var counter = $('qs-char-count');
      if (counter) { counter.textContent = '0 / 500'; counter.className = 'qs-char-count'; }
    }

    // ── Edit highlight helpers ─────────────────────────────────────────
    function _clearEditHighlight() {
      document.querySelectorAll('.note-item.is-editing').forEach(function (el) {
        el.classList.remove('is-editing');
      });
    }

    // Wire trigger bar
    var composerTrigger = document.getElementById('qs-composer-trigger');
    if (composerTrigger) {
      composerTrigger.addEventListener('click', _openComposer);
      composerTrigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _openComposer(); }
      });
    }

    // After save, collapse composer and clear highlight — hook into the
    // existing noteSaveBtn without replacing its listener (which is already
    // added above). We use a second listener that fires after the first.
    var _noteSaveBtnForComposer = $('noteSaveBtn');
    if (_noteSaveBtnForComposer) {
      _noteSaveBtnForComposer.addEventListener('click', function () {
        // Only act after save completes (the existing listener runs first).
        // A short delay lets the save listener finish before we collapse.
        setTimeout(function () {
          if (!editingNoteId) {   // save cleared editingNoteId → success
            _collapseComposer();
            _clearEditHighlight();
          }
        }, 80);
      });
    }

    // When edit is triggered from a note card, open the composer
    // and highlight the source card. We listen at the list level (already
    // done above for data logic) — add a second delegated listener here
    // for UI only.
    var _notesListForComposer = $('notesList');
    if (_notesListForComposer) {
      _notesListForComposer.addEventListener('click', function (e) {
        var editBtn = e.target.closest('[data-edit-note]');
        if (editBtn) {
          var id = editBtn.dataset.editNote;
          _clearEditHighlight();
          var card = _notesListForComposer.querySelector('[data-note-id="' + id + '"]');
          if (card) card.classList.add('is-editing');
          _openComposer();
        }
      });
    }

    // ── Live character counter ─────────────────────────────────────────
    var _noteContentForCounter = $('noteContentInput');
    if (_noteContentForCounter) {
      _noteContentForCounter.addEventListener('input', function () {
        var len     = this.value.length;
        var counter = $('qs-char-count');
        if (!counter) return;
        counter.textContent = len + ' / 500';
        counter.className   = 'qs-char-count' +
          (len >= 480 ? ' danger' : len >= 400 ? ' warn' : '');
      });
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §12  SETTINGS & DEMO — initDemoAndSettingsHandlers, renderCategoryEditor,
  //                        renderSettingsPanel
  // ═══════════════════════════════════════════════════════════════════════════
  function initDemoAndSettingsHandlers() {
    // ── Force sync button ──────────────────────────────────────────
    const btnSyncNow = $('btnSyncNow');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', async function () {
        if (!currentUser) { toast('Please log in first', 'error'); return; }
        btnSyncNow.disabled = true;
        btnSyncNow.textContent = '⏳ Syncing…';
        try {
          // Queue all local products that aren't already queued
          if (window.qsdb && state.products && state.products.length > 0) {
            const pending = await window.qsdb.getAllPending();
            const alreadyQueued = new Set(pending.map(p => p.item && (p.item.id || p.item.productId)).filter(Boolean));
            for (const p of state.products) {
              if (!alreadyQueued.has(p.id)) {
                await window.qsdb.addPendingChange({ type: 'addProduct', item: p });
              }
            }
          }
          // Push everything pending
          if (window.qsdb && window.qsdb.syncPendingToSupabase) await window.qsdb.syncPendingToSupabase();
          // Pull from cloud
          await syncCloudData(currentUser);
          toast('Sync complete — catalog is now live', 'success');
        } catch(e) {
          toast('Sync failed: ' + (e.message || 'check connection'), 'error');
        } finally {
          btnSyncNow.disabled = false;
          btnSyncNow.textContent = '☁️ Sync Now';
        }
      });
    }

    const btnLoadDemo = $('btnLoadDemo');
    if (btnLoadDemo) {
      btnLoadDemo.addEventListener('click', async function () {
        const confirmed = await showConfirm({
          title: 'Load Demo Products?',
          message: 'This will add 4 demo products to your inventory. You can delete them later.',
          okText: 'Load Demo',
          okDanger: false
        });
        if (!confirmed) return;
        const demoProducts = [
          { id: uid(), name: 'Rice (5kg)', price: 2000, cost: 1500, qty: 34, category: 'Groceries', icon: '🍚', barcode: '123456789012' },
          { id: uid(), name: 'Bottled Water', price: 150, cost: 70, qty: 80, category: 'Drinks', icon: '💧', barcode: '234567890123' },
          { id: uid(), name: 'T-Shirt', price: 1200, cost: 600, qty: 50, category: 'Clothing', icon: '👕', barcode: '345678901234' },
          { id: uid(), name: 'Indomie', price: 200, cost: 60, qty: 120, category: 'Snacks', icon: '🍜', barcode: null }
        ];
        for (const p of demoProducts) {
          if (!p.barcode || !state.products.find(prod => prod.barcode === p.barcode)) {
            state.products.push(p);
            if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'addProduct', item: p });
          }
        }
        DEFAULT_CATEGORIES.forEach(cat => { if (!state.categories.includes(cat)) state.categories.push(cat); });
        addActivityLog('Demo', 'Loaded demo products');
        await saveState();
        renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderCategoryEditor();
        toast('Demo loaded');
      });
    }
    const btnClearStore = $('btnClearStore');
    if (btnClearStore) {
      btnClearStore.addEventListener('click', async function () {
        const confirmed = await showConfirm({
          title: 'Clear Store?',
          message: 'This will delete all products, sales, and notes permanently. This action cannot be undone.',
          okText: 'Clear Store',
          okDanger: true
        });
        if (!confirmed) return;
        if (window.qsdb && window.qsdb.addPendingChange) {
          for (const p of state.products) await window.qsdb.addPendingChange({ type: 'removeProduct', item: p });
          for (const s of state.sales) await window.qsdb.addPendingChange({ type: 'removeSale', item: s });
        }
        state.products = []; state.sales = []; state.changes = []; state.notes = [];
        state.categories = [...DEFAULT_CATEGORIES];
        addActivityLog('Reset', 'Store data cleared manually');
        await saveState();
        renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderNotes(); renderCategoryEditor();
        toast('Store cleared');
      });
    }
  }

  function renderCategoryEditor() {
    try {
    const listEl = $('qs-cat-list');
    const addBtn = $('addCategoryBtn');
    if (!listEl) return;

    listEl.innerHTML = '';

    const cats = state.categories.filter(c => c.toLowerCase() !== 'others');

    if (cats.length === 0) {
      listEl.innerHTML = `<div style="padding:14px 16px;font-size:13px;color:var(--text-muted);">No custom categories yet. Add one below.</div>`;
    }

    cats.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'qs-cat-row';
      row.dataset.cat = cat;
      row.innerHTML = `
        <span class="qs-cat-dot"></span>
        <span class="qs-cat-name">${escapeHtml(cat)}</span>
        <button class="qs-cat-icon-btn qs-cat-edit-trigger" title="Rename" aria-label="Rename ${escapeHtml(cat)}">✏️</button>
        <button class="qs-cat-icon-btn danger qs-cat-delete-btn" title="Delete" aria-label="Delete ${escapeHtml(cat)}" data-name="${escapeHtml(cat)}">🗑</button>
      `;

      // Inline rename on pencil click
      row.querySelector('.qs-cat-edit-trigger').addEventListener('click', function () {
        const nameSpan = row.querySelector('.qs-cat-name');
        const currentName = row.dataset.cat;
        row.innerHTML = `
          <span class="qs-cat-dot" style="background:#f59e0b;"></span>
          <input class="qs-cat-edit-input" value="${escapeHtml(currentName)}" maxlength="40" aria-label="Rename ${escapeHtml(currentName)}" />
          <button class="qs-cat-save-btn qs-cat-save-trigger">Save</button>
          <button class="qs-cat-cancel-btn qs-cat-cancel-trigger">Cancel</button>
        `;
        const inp = row.querySelector('.qs-cat-edit-input');
        inp.focus();
        inp.select();

        // Save
        async function doSave() {
          const newName = inp.value.trim();
          const oldName = currentName;
          if (!newName) { toast('Name cannot be empty', 'error'); inp.focus(); return; }
          if (newName.toLowerCase() === oldName.toLowerCase()) {
            renderCategoryEditor(); return;
          }
          if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
            toast('That name already exists', 'error'); inp.focus(); return;
          }
          if (newName.toLowerCase() === 'others') {
            toast('Cannot rename to "Others"', 'error'); inp.focus(); return;
          }
          const idx = state.categories.findIndex(c => c.toLowerCase() === oldName.toLowerCase());
          if (idx > -1) state.categories[idx] = newName;
          state.products.forEach(p => { if (p.category === oldName) p.category = newName; });
          // FIX 7: Sync rename to Supabase — without this, syncCloudData resurrects the old name.
          if (currentUser && getClient() && navigator.onLine) {
            try {
              const supabase = getClient();
              // Rename the categories row
              await supabase.from('categories').update({ name: newName })
                .eq('user_id', currentUser.id).eq('name', oldName);
              // Re-categorise matching products
              await supabase.from('products').update({ category: newName })
                .eq('user_id', currentUser.id).eq('category', oldName);
            } catch(e) { errlog('category rename cloud sync', e); }
          }
          await saveState();
          toast('Category renamed ✓');
          renderCategoryEditor(); renderChips(); renderProducts(); renderInventory();
        }

        row.querySelector('.qs-cat-save-trigger').addEventListener('click', doSave);
        row.querySelector('.qs-cat-cancel-trigger').addEventListener('click', () => renderCategoryEditor());
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') doSave();
          if (e.key === 'Escape') renderCategoryEditor();
        });
      });

      // Delete
      row.querySelector('.qs-cat-delete-btn').addEventListener('click', async function () {
        const name = this.dataset.name;
        const confirmed = await showConfirm({
          title: `Delete "${name}"?`,
          message: `Products in "${name}" will move to "Others". This cannot be undone.`,
          okText: 'Delete',
          okDanger: true
        });
        if (!confirmed) return;
        state.categories = state.categories.filter(c => c.toLowerCase() !== name.toLowerCase());
        state.products.forEach(p => { if (p.category === name) p.category = 'Others'; });
        // FIX 8: Explicit Supabase delete — without this, syncCloudData resurrects the deleted category.
        if (currentUser && getClient() && navigator.onLine) {
          try {
            const supabase = getClient();
            await supabase.from('categories').delete()
              .eq('user_id', currentUser.id).eq('name', name);
            // Move products to Others in Supabase too
            await supabase.from('products').update({ category: 'Others' })
              .eq('user_id', currentUser.id).eq('category', name);
          } catch(e) { errlog('category delete cloud sync', e); }
        }
        await saveState();
        toast('Category deleted');
        renderCategoryEditor(); renderChips(); renderProducts(); renderInventory();
      });

      listEl.appendChild(row);
    });

    // Add new
    if (addBtn) {
      addBtn.onclick = null;
      addBtn.addEventListener('click', handleAddCategory);
    }
    const newCatInput = $('newCategoryName');
    if (newCatInput) {
      newCatInput.onkeydown = null;
      newCatInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddCategory(); });
    }

    renderActivityLog();
    } catch(e) { errlog('renderCategoryEditor', e); }
  }



  async function handleAddCategory() {
    const input = $('newCategoryName');
    const btn = $('addCategoryBtn');
    if (!input) return;
    const newName = input.value.trim().slice(0, 50); // enforce max 50 chars
    if (!newName) { toast('Please enter a category name', 'error'); return; }
    if (newName.length > 50) { toast('Category name too long (max 50 chars)', 'error'); return; }
    // Guard: prevent duplicate creation if user clicks while saveState is in-flight
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
      toast('Category already exists', 'error'); return;
    }
    // Loading state — disable button and swap text so rapid double-clicks are safe
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      state.categories.push(newName);
      await saveState();
      toast('Category added');
      renderCategoryEditor();
      renderChips();
    } catch (e) {
      // Rollback optimistic push on failure
      state.categories = state.categories.filter(c => c !== newName);
      toast('Failed to save category', 'error');
    } finally {
      // Button is re-created by renderCategoryEditor() — no need to re-enable here
      // but guard in case render didn't run (error path)
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Add'; }
    }
  }


  // NOTE: handleRenameCategory and handleDeleteCategory were removed (FIX 12).
  // They were dead code — unreachable because renderCategoryEditor uses inline closures
  // instead. Their presence caused "unexpected token" lint errors and confused tooling.


  // ═══════════════════════════════════════════════════════════════════════════
  // §13  NAVIGATION — cleanupViewState, setActiveView, initNavigationHandlers
  // ═══════════════════════════════════════════════════════════════════════════
  function cleanupViewState() {
    // FIX 9: editingNoteId is intentionally NOT reset here. Resetting it on every tab
    // switch caused note edits to create a NEW note instead of updating the existing one
    // when the user navigated away and returned. It is only nulled after a confirmed save
    // (in noteSaveBtn handler) or an explicit Cancel click (in noteCancelBtn handler).
    editingProductId = null;
    modalContext = null;
    hideModal();
    hideAddForm();
    stopScanner();
    closeInventoryInsight();
    const headerSearch = $('headerSearchInput');
    if (headerSearch) headerSearch.value = '';
  }

  // Tab order matches DOM nav order — used to determine slide direction.
  const _TAB_ORDER = ['home', 'inventory', 'reports', 'notes', 'settings'];
  let _prevViewName = null;

  function setActiveView(view, resetScroll = false) {
    cleanupViewState();

    // ── Direction ─────────────────────────────────────────────────────
    // Compare the incoming tab's index against the outgoing one.
    // Higher index = navigating right → new panel enters from the right.
    // Lower index  = navigating left  → new panel enters from the left.
    // No previous view (first load) = use default panelEnter (up+scale).
    const prevIdx = _prevViewName !== null ? _TAB_ORDER.indexOf(_prevViewName) : -1;
    const nextIdx = _TAB_ORDER.indexOf(view);
    const dir = (prevIdx === -1 || nextIdx === -1) ? ''
              : nextIdx > prevIdx ? 'from-right' : 'from-left';

    // ── View persistence ───────────────────────────────────────────────
    // Persist the active view so a page refresh restores the same panel
    // instead of always landing on Home.
    try { sessionStorage.setItem('qs_active_view', view); } catch(_) {}

    // ── History stack for back-button interception ─────────────────────
    // Push a synthetic entry on every real navigation so the browser has
    // something to pop when the vendor presses the system back button.
    // The popstate handler intercepts the pop and routes within the app.
    if (prevIdx !== -1) {
      try { history.pushState({ qsView: view }, ''); } catch(_) {}
    }

    _prevViewName = view;

    const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
    const headerSearch = $('headerSearchInput'), chipsEl = $('chips');
    navButtons.forEach(b => {
      const isActive = b.dataset.view === view;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true':'false');
    });
    // ── Deactivate all panels ─────────────────────────────────────────
    // Strip active + direction classes from every panel in one pass.
    // The incoming panel is intentionally excluded here — it stays
    // display:none until we're ready to animate it in below.
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('active', 'panel-enter', 'from-right', 'from-left');
    });

    const panel = $(view + 'Panel');

    // ── Two-frame activation sequence ─────────────────────────────────
    // The browser batches classList mutations into one style recalc when
    // they happen synchronously. Splitting across two rAF calls forces the
    // engine to commit each class before computing the next one, so the
    // animation keyframe is in place before display:block fires.
    //
    //   Frame 1 — stamp the enter class (dir OR panel-enter) while the
    //             panel is still display:none. Zero paint cost.
    //   Frame 2 — add .active → display:block fires together with the
    //             already-committed enter class, so the correct animation
    //             plays from its very first painted frame. No flash.
    //
    // After the animation completes the enter class is removed. Because
    // .panel.active carries NO animation of its own (see styless.css),
    // that removal never triggers a repaint or re-animation. This is the
    // root fix for the flicker that persisted after previous attempts.
    if (panel) {
      const enterClass = dir || 'panel-enter';
      // Frame 1: stamp the enter class while still invisible
      requestAnimationFrame(function() {
        panel.classList.add(enterClass);

        // Frame 2: make visible — animation starts with correct keyframe
        requestAnimationFrame(function() {
          panel.classList.add('active');
          // Remove the enter class after the animation completes.
          // Safe: .panel.active alone has no animation so this removal
          // never triggers a re-render or flash.
          setTimeout(function() { panel.classList.remove(enterClass); }, 320);
        });
      });
    }

    const isHome = view === 'home', isInv = view === 'inventory';
    if (headerSearch) {
      headerSearch.style.display = (isHome || isInv) ? 'block' : 'none';
      headerSearch.value = '';
    }
    if (chipsEl) chipsEl.style.display = isHome ? 'flex' : 'none';
    if (view === 'reports') {
      renderReports();
      // Chart.js measures the canvas while the panel is display:none and gets
      // zero dimensions. Trigger a resize after both rAF frames have fired
      // so the chart measures the now-visible container correctly.
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (reportChart) reportChart.resize();
        });
      });
    }
    if (view === 'settings') {
      renderSettingsPanel(); // renderCategoryEditor called inside renderSettingsPanel
      // FIX: removed inline settingsPanel.style.paddingBottom='100px' override —
      // padding is now owned by CSS via #settingsPanel { padding-bottom: 80px } token
    }
    if (view === 'home') { renderDashboard(); renderProducts(); }
    if (view === 'inventory') renderInventory();
    if (view === 'notes') renderNotes();
    if (resetScroll) setTimeout(()=> { try { window.scrollTo(0, 0); } catch(e){} }, 10);
  }

  function initNavigationHandlers() {
    const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
    navButtons.forEach(btn => btn.addEventListener('click', function() { setActiveView(this.dataset.view, true); }));
    const btnSettings = $('btnSettings');
    if (btnSettings) btnSettings.addEventListener('click', function() { setActiveView('settings', true); });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §14  REPORTS — createBuckets, aggregateSales, renderReportsChart,
  //                renderTop3Products, renderReports, initReportsHandlers, generateCsv
  // ═══════════════════════════════════════════════════════════════════════════
  function createBuckets(range) {
    const DAY = 24 * 60 * 60 * 1000, now = Date.now(), buckets = [];
    if (range === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const start = startOfDay(now - i * DAY);
        buckets.push({ start, end: start + DAY, label: formatShortDate(start) });
      }
    } else if (range === 'weekly') {
      const weekEnd = startOfDay(now) + DAY, WEEK = 7 * DAY;
      for (let i = 3; i >= 0; i--) {
        const start = weekEnd - (i+1) * WEEK, end = weekEnd - i * WEEK;
        buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` });
      }
    } else {
      const monthEnd = startOfDay(now) + DAY, MONTH = 30 * DAY;
      for (let i = 5; i >= 0; i--) {
        const start = monthEnd - (i+1) * MONTH, end = monthEnd - i * MONTH;
        buckets.push({ start, end, label: `${new Date(start).toLocaleString('default', { month: 'short', year: 'numeric' })}` });
      }
    }
    return buckets;
  }

  function getSalesInRange(start, end) { return (state.sales || []).filter(s => s.ts >= start && s.ts < end); }

  function aggregateSalesInRange(start, end) {
    const sales = getSalesInRange(start, end);
    const revenue = sales.reduce((a,s)=>a + ((window.n(s.price) || 0) * (window.n(s.qty) || 0)), 0);
    const profit = sales.reduce((a,s)=>a + ((window.n(s.price) - window.n(s.cost)) * (window.n(s.qty) || 0)), 0);
    return { units: sales.reduce((a,s)=>a + (window.n(s.qty) || 0), 0), revenue: revenue, profit: profit };
  }

  let currentReportRange = 'daily';
  let reportChart = null;

  function renderReportsChart(buckets) {
    try {
    const canvas = $('reportChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (reportChart) {
      reportChart.destroy();
      reportChart = null;
    }

    // FIX: Dynamic chart colours based on active theme
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const tickColor   = isLight ? 'rgba(28, 27, 26, 0.65)' : 'rgba(255, 255, 255, 0.7)';
    const gridColor   = isLight ? 'rgba(0, 0, 0, 0.07)'    : 'rgba(255, 255, 255, 0.05)';
    const legendColor = isLight ? '#1c1b1a'                 : '#ffffff';

    const labels = buckets.map(b => b.label);
    const revenueData = buckets.map(b => aggregateSalesInRange(b.start, b.end).revenue);
    const profitData = buckets.map(b => aggregateSalesInRange(b.start, b.end).profit);

    const revenueGradient = ctx.createLinearGradient(0, 0, 0, 220);
    revenueGradient.addColorStop(0, 'rgba(16, 185, 129, 0.5)');
    revenueGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    const profitGradient = ctx.createLinearGradient(0, 0, 0, 220);
    profitGradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)');
    profitGradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    reportChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Revenue',
            data: revenueData,
            borderColor: 'rgba(16, 185, 129, 1)',
            backgroundColor: revenueGradient,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: 'rgba(16, 185, 129, 1)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(16, 185, 129, 1)',
            pointHoverBorderWidth: 3
          },
          {
            label: 'Profit',
            data: profitData,
            borderColor: 'rgba(99, 102, 241, 1)',
            backgroundColor: profitGradient,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: 'rgba(99, 102, 241, 1)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(99, 102, 241, 1)',
            pointHoverBorderWidth: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              padding: 15,
              font: {
                size: 12,
                weight: '600'
              },
              color: legendColor  // FIX: was hardcoded dark rgba
            }
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                label += window.fmt(context.parsed.y);
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false
            },
            ticks: {
              color: tickColor,   // FIX: was hardcoded dark rgba
              font: { size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: gridColor,   // FIX: was hardcoded dark rgba
              drawBorder: false
            },
            ticks: {
              color: tickColor,   // FIX: was hardcoded dark rgba
              font: { size: 11 },
              callback: function(value) {
                return '₦' + (value / 1000).toFixed(0) + 'k';
              }
            }
          }
        }
      }
    });

    const updatedEl = $('reportChartUpdated');
    if (updatedEl) {
      updatedEl.textContent = `Updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
    } catch(e) { errlog('renderReportsChart', e); }
  }

  // FIX 10: Returns a DOM node instead of an HTML string — caller uses appendChild, not innerHTML.
  function renderTop3Products(start, end) {
    const salesInRange = getSalesInRange(start, end);
    const productPerformance = {};
    salesInRange.forEach(s => {
      if (!productPerformance[s.productId]) productPerformance[s.productId] = { qty: 0, revenue: 0, profit: 0 };
      productPerformance[s.productId].qty += s.qty;
      productPerformance[s.productId].revenue += (s.price * s.qty);
      productPerformance[s.productId].profit += ((s.price - s.cost) * s.qty);
    });

    const topPerformers = Object.entries(productPerformance)
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 3);

    const fragment = document.createDocumentFragment();

    if (topPerformers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-muted)';
      empty.textContent = 'No sales in this period';
      fragment.appendChild(empty);
      return fragment;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
    const medals = ['🥇', '🥈', '🥉'];

    topPerformers.forEach(([productId, metrics], idx) => {
      const product = state.products.find(p => p.id === productId);
      const productName = product ? product.name : 'Unknown Product';

      const card = document.createElement('div');
      card.style.cssText = 'padding:12px;background:var(--card-glass);border-radius:8px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border-glass);';

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:12px;';
      const medalSpan = document.createElement('span');
      medalSpan.style.fontSize = '24px';
      medalSpan.textContent = medals[idx] || '🏅';
      const nameBlock = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-weight:600;color:var(--text-primary);';
      nameEl.textContent = productName;
      const unitsEl = document.createElement('div');
      unitsEl.className = 'small';
      unitsEl.style.color = 'var(--text-secondary)';
      unitsEl.textContent = metrics.qty + ' units sold';
      nameBlock.appendChild(nameEl);
      nameBlock.appendChild(unitsEl);
      left.appendChild(medalSpan);
      left.appendChild(nameBlock);

      const right = document.createElement('div');
      right.style.textAlign = 'right';
      const profitEl = document.createElement('div');
      profitEl.style.cssText = 'font-weight:700;color:var(--accent-emerald);font-size:16px;';
      profitEl.textContent = fmt(metrics.profit);
      const profitLbl = document.createElement('div');
      profitLbl.className = 'small';
      profitLbl.style.color = 'var(--text-muted)';
      profitLbl.textContent = 'profit';
      right.appendChild(profitEl);
      right.appendChild(profitLbl);

      card.appendChild(left);
      card.appendChild(right);
      wrap.appendChild(card);
    });

    fragment.appendChild(wrap);
    return fragment;
  }

  function renderReports(range = currentReportRange) {
    try {
    currentReportRange = range;
    const reportRangeButtons = Array.from(document.querySelectorAll('.report-range-btn'));
    const reportMini = $('reportMini'), reportSummary = $('reportSummary'), reportBreakdown = $('reportBreakdown');
    reportRangeButtons.forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const buckets = createBuckets(range);
    const rangeStart = buckets[0].start, rangeEnd = buckets[buckets.length-1].end;
    const totalMetrics = aggregateSalesInRange(rangeStart, rangeEnd);
    if (reportMini) reportMini.textContent = fmt(totalMetrics.revenue);
    if (reportSummary) {
      reportSummary.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'report-summary-stack';

      // Margin multiplier: profit / revenue ratio, clamped to 0–100
      const marginPct = totalMetrics.revenue > 0
        ? Math.min(100, Math.round((totalMetrics.profit / totalMetrics.revenue) * 100))
        : 0;

      const metrics = [
        {
          label: 'Revenue',
          value: fmt(totalMetrics.revenue),
          accent: 'var(--accent-primary)',
          sub: range === 'daily' ? 'Last 7 days' : range === 'weekly' ? 'Last 4 weeks' : 'Last 6 months'
        },
        {
          label: 'Profit',
          value: fmt(totalMetrics.profit),
          accent: 'var(--accent-emerald)',
          sub: marginPct + '% margin'
        },
        {
          label: 'Units Sold',
          value: String(totalMetrics.units),
          accent: 'var(--warn)',
          sub: totalMetrics.units === 1 ? '1 item' : totalMetrics.units + ' items'
        }
      ];

      metrics.forEach(function(m) {
        const row = document.createElement('div');
        row.className = 'report-stat-row';
        // Left accent bar
        const bar = document.createElement('div');
        bar.className = 'report-stat-bar';
        bar.style.background = m.accent;
        // Text block
        const body = document.createElement('div');
        body.className = 'report-stat-body';
        // Label
        const lbl = document.createElement('div');
        lbl.className = 'report-stat-label';
        lbl.textContent = m.label;
        // Sub
        const sub = document.createElement('div');
        sub.className = 'report-stat-sub';
        sub.textContent = m.sub;
        body.appendChild(lbl);
        body.appendChild(sub);
        // Value — textContent only, no interpolation into HTML
        const val = document.createElement('div');
        val.className = 'report-stat-value';
        val.textContent = m.value;
        row.appendChild(bar);
        row.appendChild(body);
        row.appendChild(val);
        wrap.appendChild(row);
      });

      reportSummary.appendChild(wrap);
    }

    const reportChartCard = $('reportChartCard');
    if (reportChartCard && reportChartCard.parentNode) {
      const parent = reportChartCard.parentNode;
      const reportSummaryEl = $('reportSummary');
      if (reportSummaryEl && reportSummaryEl.nextSibling !== reportChartCard) {
        parent.insertBefore(reportChartCard, reportSummaryEl.nextSibling);
      }
    }

    renderReportsChart(buckets);

    const top3Container = $('top3Container');
    if (top3Container) {
      top3Container.remove();
    }
    const newTop3Container = document.createElement('div');
    newTop3Container.id = 'top3Container';
    newTop3Container.style.cssText = 'margin-top:12px;background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass)';
    newTop3Container.innerHTML = '';
    const top3Heading = document.createElement('div');
    top3Heading.style.cssText = 'font-weight:700;margin-bottom:12px;color:var(--text-primary);';
    top3Heading.textContent = '🏆 Top 3 Products (by profit)';
    newTop3Container.appendChild(top3Heading);
    newTop3Container.appendChild(renderTop3Products(rangeStart, rangeEnd));
    
    const reportChartCardEl = $('reportChartCard');
    if (reportChartCardEl && reportChartCardEl.parentNode) {
      reportChartCardEl.parentNode.insertBefore(newTop3Container, reportChartCardEl.nextSibling);
    }

    if (reportBreakdown) {
      reportBreakdown.innerHTML = '';
      const outer = document.createElement('div');
      outer.style.cssText = 'background:var(--card-glass);padding:10px;border-radius:12px;border:1px solid var(--border-glass);margin-top:12px';
      const tbl = document.createElement('table');
      tbl.style.cssText = 'width:100%;border-collapse:collapse';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr style="text-align:left"><th style="padding:8px">Period</th><th style="padding:8px">Units</th><th style="padding:8px">Revenue</th><th style="padding:8px">Profit</th><th style="padding:8px">Margin</th></tr>`;
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const b of buckets) {
        const m = aggregateSalesInRange(b.start, b.end);
        const margin = m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(0) : 0;
              const tr = document.createElement('tr');
      // FIX: Darker border color for dark mode compatibility and tighter padding
      const borderStyle = 'border-top: 1px solid rgba(255,255,255,0.05)';
      tr.innerHTML = `
        <td style="padding:10px 8px; ${borderStyle}; color:var(--text-secondary);">${escapeHtml(b.label)}</td>
        <td style="padding:10px 8px; ${borderStyle};">${m.units}</td>
        <td style="padding:10px 8px; ${borderStyle};">${fmt(m.revenue)}</td>
        <td style="padding:10px 8px; ${borderStyle}; color:var(--accent-emerald);">${fmt(m.profit)}</td>
        <td style="padding:10px 8px; ${borderStyle}; opacity:0.8;">${margin}%</td>
      `;
      tbody.appendChild(tr);

      }
      tbl.appendChild(tbody);
      outer.appendChild(tbl);
      reportBreakdown.appendChild(outer);

      if (range === 'monthly') {
        const notice = document.createElement('div');
        notice.style.cssText = 'margin-top:10px;padding:10px 14px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);border-radius:10px;font-size:11.5px;color:rgba(255,255,255,0.4);line-height:1.55;';
        notice.textContent = '⚠ Data beyond 90 days is stored on this device only. Clearing browser storage will remove it.';
        reportBreakdown.appendChild(notice);
      }

      // Spacer accounts for the fixed navbar height + Android gesture bar safe area.
      // env(safe-area-inset-bottom) is 0 in desktop/Acode, ~34px in installed PWA.
      // env(safe-area-inset-bottom) is 0 in desktop/Acode, ~34px in installed PWA.
      const spacer = document.createElement('div');
      spacer.style.cssText = 'height:calc(var(--nav-h, 68px) + 16px + env(safe-area-inset-bottom));flex-shrink:0;pointer-events:none;';
      reportBreakdown.appendChild(spacer);
    }
    } catch(e) { errlog('renderReports', e); const el=$('reportsPanel'); if(el){const d=document.createElement('div');d.className='small';d.style.cssText='padding:20px;text-align:center;';d.textContent='Display error — pull to refresh.';el.appendChild(d);} }
  }

  function initReportsHandlers() {
    const reportRangeButtons = Array.from(document.querySelectorAll('.report-range-btn'));
    reportRangeButtons.forEach(b => b.addEventListener('click', function () { renderReports(this.dataset.range); }));
    const exportReport = $('exportReport');
    if (exportReport) {
      exportReport.addEventListener('click', function () {
        const header = ['Date','Time','Product','Category','Qty','UnitPrice','Total','Cost','Profit','Payment','Barcode','SaleID'];
        const rows = [header];
        let grandTotal = 0, grandProfit = 0;
        (state.sales || []).slice().sort((a,b) => a.ts - b.ts).forEach(s => {
          const p = state.products.find(x => x.id === s.productId);
          const name    = s.productName || p?.name || s.productId;
          const barcode = s.barcode     || p?.barcode || '';
          const cat     = s.category    || p?.category || '';
          const pay     = s.paymentMethod || '';
          const total   = window.n(s.price) * window.n(s.qty);
          const profit  = (window.n(s.price) - window.n(s.cost)) * window.n(s.qty);
          const dt      = new Date(s.ts);
          const date    = dt.toLocaleDateString('en-GB');
          const time    = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          grandTotal  += total;
          grandProfit += profit;
          rows.push([date, time, name, cat, s.qty, s.price, total, s.cost, profit, pay, barcode, s.id]);
        });
        rows.push(['','','','','','TOTAL','₦'+grandTotal,'','₦'+grandProfit,'','','']);
        generateCsv(rows, 'sales_all');
      });
    }
    const exportCurrentReport = $('exportCurrentReport');
    if (exportCurrentReport) {
      exportCurrentReport.addEventListener('click', function () {
        const buckets = createBuckets(currentReportRange);
        const start = buckets[0].start, end = buckets[buckets.length - 1].end;
        const salesInRange = getSalesInRange(start, end);
        const header = ['Date','Time','Product','Category','Qty','UnitPrice','Total','Cost','Profit','Payment','Barcode','SaleID'];
        const rows = [header];
        let grandTotal = 0, grandProfit = 0;
        salesInRange.slice().sort((a,b) => a.ts - b.ts).forEach(s => {
          const p = state.products.find(x => x.id === s.productId);
          const name    = s.productName || p?.name || s.productId;
          const barcode = s.barcode     || p?.barcode || '';
          const cat     = s.category    || p?.category || '';
          const pay     = s.paymentMethod || '';
          const total   = window.n(s.price) * window.n(s.qty);
          const profit  = (window.n(s.price) - window.n(s.cost)) * window.n(s.qty);
          const dt      = new Date(s.ts);
          const date    = dt.toLocaleDateString('en-GB');
          const time    = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          grandTotal  += total;
          grandProfit += profit;
          rows.push([date, time, name, cat, s.qty, s.price, total, s.cost, profit, pay, barcode, s.id]);
        });
        rows.push(['','','','','','TOTAL','₦'+grandTotal,'','₦'+grandProfit,'','','']);
        generateCsv(rows, `sales_range_${currentReportRange}`);
      });
    }
  }

  function generateCsv(rows, baseFilename = 'report') {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseFilename}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  // ─── §14a  Report Utilities ───────────────────────────────────────────────
  function calculateStockoutPrediction(product) {
    const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentSales = state.sales.filter(s => s.productId === product.id && s.ts >= last30Days);
    if (recentSales.length === 0) return null;
    
    const totalSold = recentSales.reduce((sum, s) => sum + s.qty, 0);
    const dailyRate = totalSold / 30;
    
    if (dailyRate === 0) return null;
    const daysUntilStockout = Math.min(90, Math.floor(product.qty / dailyRate));
    return { daysUntilStockout, dailyRate };
  }

  function calculateMarginOptimization(product) {
    const currentMargin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;
    const suggestedPrice = product.cost * 1.5;
    const potentialMargin = ((suggestedPrice - product.cost) / suggestedPrice) * 100;
    const priceDiff = suggestedPrice - product.price;
    
    return {
      currentMargin: currentMargin.toFixed(1),
      suggestedPrice,
      potentialMargin: potentialMargin.toFixed(1),
      priceDiff
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSIGHTS ENGINE v2
  // ─────────────────────────────────────────────────────────────────────────
  // Two-layer system:
  //   Layer 1 — Local math (instant, offline, always runs).
  //             Computes 6 signals from state.sales + state.products.
  //             Fixed bugs vs v1: minimum data thresholds, separate prev7
  //             window, margin floor adjusted for NG market, cash-trap uses
  //             first-sale date not createdAt, trend card only shown with data.
  //   Layer 2 — Gemini 2.0 Flash (free tier, only on explicit "Ask AI" tap).
  //             Receives a compressed business snapshot (~400 tokens).
  //             Returns a plain-English narrative the vendor can act on.
  //             Key stored in supabase-config.js as window.__QS_GEMINI_KEY.
  //             If key is absent or request fails, falls back to layer 1 only.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── DOM HELPERS (all pure DOM, no innerHTML with user data) ───────────────

  // ═══════════════════════════════════════════════════════════════════════════
  // §15  INSIGHTS & COPILOT — signals, insight DOM, copilot session,
  //                           merchant memory, Gemini AI, generateAdvancedInsights
  // ═══════════════════════════════════════════════════════════════════════════
  function _insCard(borderColor, bg) {
    const el = document.createElement('div');
    el.style.cssText = [
      'border-radius:16px;overflow:hidden;',
      'border:1px solid ' + borderColor + ';',
      'background:' + bg + ';',
      'margin-bottom:2px;',
    ].join('');
    return el;
  }

  function _insCardHead(el, emoji, title, subtitle) {
    const hdr = document.createElement('div');
    hdr.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid var(--border-glass);';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const em = document.createElement('span');
    em.style.cssText = 'font-size:18px;line-height:1;';
    em.textContent = emoji;
    const ttl = document.createElement('span');
    ttl.style.cssText = 'font-weight:700;font-size:15px;color:var(--text-primary);';
    ttl.textContent = title;
    top.appendChild(em); top.appendChild(ttl);
    hdr.appendChild(top);
    if (subtitle) {
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:3px;margin-left:26px;';
      sub.textContent = subtitle;
      hdr.appendChild(sub);
    }
    el.appendChild(hdr);
  }

  function _insRow(parent, nameTxt, subTxt, btnLabel, btnColor, btnData) {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;',
      'padding:9px 14px;margin:0 8px 6px;',
      'background:var(--border-subtle);border-radius:10px;',
    ].join('');
    const left = document.createElement('div');
    left.style.cssText = 'flex:1;min-width:0;margin-right:10px;';
    const nm = document.createElement('div');
    nm.style.cssText = 'font-weight:600;font-size:13.5px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    nm.textContent = nameTxt;
    const sb = document.createElement('div');
    sb.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-top:2px;';
    sb.textContent = subTxt;
    left.appendChild(nm); left.appendChild(sb);
    row.appendChild(left);
    if (btnLabel) {
      const btn = document.createElement('button');
      btn.className = 'ai-action-btn';
      btn.type = 'button';
      btn.style.cssText = [
        'background:' + btnColor + ';border:0;',
        'padding:6px 11px;border-radius:8px;',
        'font-size:12px;font-weight:700;color:#fff;',
        'cursor:pointer;white-space:nowrap;flex-shrink:0;',
        '-webkit-tap-highlight-color:transparent;',
      ].join('');
      btn.textContent = btnLabel;
      Object.entries(btnData).forEach(([k,v]) => btn.dataset[k] = v);
      row.appendChild(btn);
    }
    parent.appendChild(row);
  }

  function _insFootnote(parent, txt) {
    const d = document.createElement('div');
    d.style.cssText = 'padding:2px 16px 12px;font-size:12px;color:var(--text-muted);line-height:1.55;';
    d.textContent = txt;
    parent.appendChild(d);
  }

  function _safeStr(value, fallback) {
    const txt = value == null ? '' : String(value).trim();
    return txt || (fallback || '');
  }

  function _normKey(value) {
    return _safeStr(value).toLowerCase();
  }

  function _completenessScore(product) {
    let score = 0;
    if (product && (product.image || product.image2)) score += 35;
    if (_safeStr(product && product.description).length >= 24) score += 25;
    if (_safeStr(product && product.category)) score += 15;
    if (_safeStr(product && product.barcode)) score += 10;
    if (product && Number(product.price) > 0) score += 10;
    if (product && Number(product.qty) > 0) score += 5;
    return score;
  }

  function _contentHookForProduct(product) {
    const blob = [
      _safeStr(product && product.name),
      _safeStr(product && product.category),
      _safeStr(product && product.description),
    ].join(' ').toLowerCase();

    if (/perfume|fragrance|cologne|scent|edp|edt|eau de|roll.on|body.*mist|mist.*body/.test(blob)) {
      return 'Film the spray, name the mood it creates, and show who it\'s for.';
    }
    if (/shoe|sneaker|sandal|slipper|bag|dress|shirt|top|jean|wear|fashion|cap|jacket/.test(blob)) {
      return 'Try-on clip, outfit pairing, and a close-up of the fit.';
    }
    if (/beauty|skin|hair|cream|soap|lotion|makeup|beard|body.*oil|serum|toner/.test(blob)) {
      return 'Show texture, a before/after result, and the problem it solves in 5 seconds.';
    }
    if (/food|snack|drink|beverage|rice|spice|chocolate|cereal|tea|coffee|bread|chin/.test(blob)) {
      return 'Show the portion size, open pack, and a daily-use or bundle angle.';
    }
    if (/phone|charger|cable|battery|earbud|headphone|power|electronic|tech|speaker/.test(blob)) {
      return 'Show a demo, the key feature, and compatibility in one fast clip.';
    }
    if (/home|kitchen|clean|house|storage|utility|school|baby|office/.test(blob)) {
      return 'Show the item in use, the before state, and the result in one shot.';
    }
    return 'Lead with the problem it solves, then show the product in use.';
  }

  function _buildGrowthBrief(sig) {
    const s = sig.s || { products: [], sales: [] };
    const products = Array.isArray(s.products) ? s.products : [];
    const inStock = products.filter(function(p) { return Number(p.qty) > 0; });
    const total = Math.max(products.length, 1);

    const counts = {
      image: products.filter(function(p) { return !!(p.image || p.image2); }).length,
      description: products.filter(function(p) { return _safeStr(p.description).length >= 24; }).length,
      category: products.filter(function(p) { return !!_safeStr(p.category); }).length,
      barcode: products.filter(function(p) { return !!_safeStr(p.barcode); }).length,
      price: products.filter(function(p) { return Number(p.price) > 0; }).length,
      stock: inStock.length,
    };

    const visibilityScore = Math.max(0, Math.min(100, Math.round(
      (counts.image / total) * 30 +
      (counts.description / total) * 25 +
      (counts.category / total) * 15 +
      (counts.barcode / total) * 10 +
      (counts.price / total) * 10 +
      (counts.stock / total) * 10
    )));

    const ranked = products.map(function(p) {
      const missing = [];
      if (!(p.image || p.image2)) missing.push('image');
      if (_safeStr(p.description).length < 24) missing.push('description');
      if (!_safeStr(p.category)) missing.push('category');
      if (!_safeStr(p.barcode)) missing.push('barcode');
      if (!(Number(p.price) > 0)) missing.push('price');
      return { product: p, score: _completenessScore(p), missing: missing };
    }).sort(function(a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return _safeStr(a.product && a.product.name).localeCompare(_safeStr(b.product && b.product.name));
    });

    const bestSeller = (sig.topByProfit && sig.topByProfit[0] && sig.topByProfit[0].product) || inStock[0] || products[0] || null;
    const promote = [];
    (sig.topByProfit || []).forEach(function(item) {
      if (item && item.product && Number(item.product.qty) > 0 && promote.indexOf(item.product) === -1) {
        promote.push(item.product);
      }
    });
    inStock.sort(function(a, b) {
      return _completenessScore(b) - _completenessScore(a);
    }).forEach(function(p) {
      if (promote.length < 3 && promote.indexOf(p) === -1) promote.push(p);
    });

    const fixNow = ranked.filter(function(item) {
      return item.missing.length > 0 || item.score < 70;
    }).slice(0, 4);

    const lowStockHero = (sig.restockAlerts || []).filter(function(item) {
      return item && item.product && Number(item.product.qty) > 0;
    }).sort(function(a, b) {
      return a.daysLeft - b.daysLeft;
    }).slice(0, 3);

    const weakMarginFastMover = (sig.priceOpps || []).slice(0, 3);
    const deadStock = (sig.cashTraps || []).slice(0, 3);

    return {
      total: products.length,
      visibilityScore: visibilityScore,
      counts: counts,
      bestSeller: bestSeller,
      promote: promote.slice(0, 3),
      fixNow: fixNow,
      lowStockHero: lowStockHero,
      weakMarginFastMover: weakMarginFastMover,
      deadStock: deadStock,
      contentHookForProduct: _contentHookForProduct,
      completenessScore: _completenessScore,
    };
  }

  // ── SIGNAL COMPUTATION ────────────────────────────────────────────────────
  function _computeSignals() {
    // Use the safe frozen copy — never access raw closure state directly.
    const s = window.__QS_APP && window.__QS_APP.getState ? window.__QS_APP.getState() : { products: [], sales: [], notes: [] };
    const now = Date.now();
    const D   = 86400000; // ms per day

    const last7  = now - 7  * D;
    const last14 = now - 14 * D; // start of "previous 7 days" window
    const last30 = now - 30 * D;
    const last60 = now - 60 * D;

    function salesIn(pid, from, to) {
      to = to || now;
      return s.sales.filter(x => x.productId === pid && x.ts >= from && x.ts < to);
    }
    function sumQty(arr)     { return arr.reduce(function(a,x){ return a + x.qty; }, 0); }
    function sumRevenue(arr) { return arr.reduce(function(a,x){ return a + x.price * x.qty; }, 0); }
    function sumProfit(arr)  { return arr.reduce(function(a,x){ return a + (x.price - x.cost) * x.qty; }, 0); }

    const sales7     = s.sales.filter(x => x.ts >= last7);
    const salesPrev7 = s.sales.filter(x => x.ts >= last14 && x.ts < last7);
    const rev7       = sumRevenue(sales7);
    const revPrev7   = sumRevenue(salesPrev7);
    const prof7      = sumProfit(sales7);
    const txCount7   = sales7.length;

    // Trend
    const trendPct = revPrev7 > 0 ? ((rev7 - revPrev7) / revPrev7) * 100 : null;
    const dayTotals = {};
    sales7.forEach(function(sale) {
      const day = new Date(sale.ts).toLocaleDateString('en-NG', { weekday: 'short' });
      dayTotals[day] = (dayTotals[day] || 0) + sale.price * sale.qty;
    });
    const bestDayEntry = Object.entries(dayTotals).sort(function(a,b){ return b[1]-a[1]; })[0] || null;

    // 1. Restock alerts — FIXED: use actual sales days count not fixed 30
    //    to avoid false alerts on intermittently sold products.
    const restockAlerts = [];
    s.products.forEach(function(p) {
      const recent = salesIn(p.id, last30);
      if (recent.length < 2) return; // need at least 2 sales to establish a rate
      const salesDays = new Set(recent.map(x => Math.floor(x.ts / D))).size;
      const dailyRate = sumQty(recent) / Math.max(salesDays, 1);
      if (p.qty === 0) {
        restockAlerts.push({ product: p, daysLeft: 0, dailyRate,
          lostDaily: Math.round(dailyRate * p.price),
          suggest: Math.ceil(dailyRate * 14) });
      } else {
        const daysLeft = Math.floor(p.qty / dailyRate);
        if (daysLeft <= 7) {
          restockAlerts.push({ product: p, daysLeft, dailyRate,
            lostDaily: Math.round(dailyRate * p.price),
            suggest: Math.ceil(dailyRate * 14) });
        }
      }
    });
    restockAlerts.sort(function(a,b){ return a.daysLeft - b.daysLeft; });

    // 2. Profit leak — FIXED: margin floor 10% (realistic for NG market),
    //    minimum 5 sales in 30 days to avoid noise on slow movers.
    const profitLeaks = [];
    s.products.forEach(function(p) {
      if (!p.price || !p.cost || p.price <= p.cost) return;
      const recent = salesIn(p.id, last30);
      const qty30  = sumQty(recent);
      if (qty30 < 5) return;
      const margin = ((p.price - p.cost) / p.price) * 100;
      if (margin < 10) {
        const betterPrice  = Math.ceil(p.cost / 0.78); // target 22% margin
        const gainIfFixed  = (betterPrice - p.price) * qty30;
        const profitMade   = sumProfit(recent);
        const revMade      = sumRevenue(recent);
        profitLeaks.push({ product: p, margin, qty30, profitMade, revMade, betterPrice, gainIfFixed });
      }
    });
    profitLeaks.sort(function(a,b){ return b.revMade - a.revMade; });

    // 3. Bestsellers by profit this week — require at least 2 transactions
    const perfMap = {};
    sales7.forEach(function(sale) {
      if (!perfMap[sale.productId]) perfMap[sale.productId] = { profit:0, qty:0, revenue:0, txCount:0 };
      perfMap[sale.productId].profit  += (sale.price - sale.cost) * sale.qty;
      perfMap[sale.productId].qty     += sale.qty;
      perfMap[sale.productId].revenue += sale.price * sale.qty;
      perfMap[sale.productId].txCount += 1;
    });
    const topByProfit = Object.entries(perfMap)
      .filter(function(e){ return e[1].txCount >= 2; })
      .map(function(e) {
        return Object.assign({ product: s.products.find(function(p){ return p.id === e[0]; }) }, e[1]);
      })
      .filter(function(x){ return x.product; })
      .sort(function(a,b){ return b.profit - a.profit; })
      .slice(0, 3);

    // 4. Cash traps — FIXED: use first-ever sale date to anchor age,
    //    not createdAt (which is when the product was added to the app).
    //    A product with no sales at all uses createdAt as fallback.
    const cashTraps = [];
    s.products.forEach(function(p) {
      if (p.qty <= 0) return;
      const allSales = s.sales.filter(function(x){ return x.productId === p.id; });
      const firstSaleTs = allSales.length
        ? Math.min.apply(null, allSales.map(function(x){ return x.ts; }))
        : (p.createdAt || now);
      const age = now - firstSaleTs;
      if (age < 45 * D) return; // skip genuinely new products
      const hasSalesRecently = allSales.some(function(x){ return x.ts >= last60; });
      if (!hasSalesRecently) {
        const daysIdle    = Math.floor(age / D);
        const trapped    = (p.cost || 0) * p.qty;
        const clearPrice = Math.floor(p.price * 0.80);
        cashTraps.push({ product: p, trapped, clearPrice, qty: p.qty, daysIdle });
      }
    });
    cashTraps.sort(function(a,b){ return b.trapped - a.trapped; });
    const totalTrapped = cashTraps.reduce(function(a,x){ return a + x.trapped; }, 0);

    // 5. Price opportunity — selling fast (≥3 in 7 days) but margin < 20%
    const priceOpps = [];
    s.products.forEach(function(p) {
      if (!p.price || !p.cost || p.price <= p.cost) return;
      const recent = salesIn(p.id, last7);
      const qty7   = sumQty(recent);
      if (qty7 < 3) return;
      const margin = ((p.price - p.cost) / p.price) * 100;
      if (margin < 20) {
        const nudgePrice  = Math.ceil(p.price * 1.08); // conservative 8% nudge
        const extraProfit = (nudgePrice - p.price) * qty7 * 4;
        priceOpps.push({ product: p, margin, qty7, nudgePrice, extraProfit });
      }
    });
    priceOpps.sort(function(a,b){ return b.extraProfit - a.extraProfit; });

    return {
      s, now, rev7, revPrev7, prof7, txCount7, trendPct, bestDayEntry,
      restockAlerts, profitLeaks, topByProfit, cashTraps, totalTrapped, priceOpps
    };
  }

  // ── BUILD LOCAL INSIGHT DOM (Layer 1) ─────────────────────────────────────
  function _buildInsightDom(sig, includeAskAiBtn) {
    const growth = _buildGrowthBrief(sig);
    const { s, rev7, revPrev7, prof7, txCount7, trendPct, bestDayEntry,
            restockAlerts, profitLeaks, topByProfit,
            cashTraps, totalTrapped, priceOpps } = sig;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:4px 0 16px;';

    // ── EMPTY STORE GUARD ─────────────────────────────────────────────────────
    // A store with no products has no signals to analyse. Show a focused
    // onboarding card instead of a misleading 0/100 score.
    if (!s.products || s.products.length === 0) {
      const card = document.createElement('div');
      card.style.cssText = [
        'background:var(--card-glass);border:1px solid var(--border-glass);',
        'border-radius:16px;padding:20px 18px;',
        'display:flex;flex-direction:column;gap:12px;',
      ].join('');

      const title = document.createElement('div');
      title.style.cssText = 'font-size:15px;font-weight:800;color:var(--text-primary);';
      title.textContent = '👋 Welcome — let\'s build your store';

      const body = document.createElement('div');
      body.style.cssText = 'font-size:13px;color:var(--text-secondary);line-height:1.6;';
      body.textContent = 'Your store has no products yet. Insights and growth signals will appear here once you add your first item.';

      const steps = [
        { n: '1', text: 'Add your first product — name, price, and a photo' },
        { n: '2', text: 'Set a category so buyers can filter your catalog' },
        { n: '3', text: 'Write at least one sentence of description per product' },
        { n: '4', text: 'Come back here — the copilot will have real advice' },
      ];

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
      steps.forEach(function(step) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';
        const num = document.createElement('div');
        num.style.cssText = [
          'width:22px;height:22px;border-radius:50%;flex-shrink:0;',
          'background:rgba(124,58,237,0.18);border:1px solid rgba(124,58,237,0.3);',
          'display:flex;align-items:center;justify-content:center;',
          'font-size:11px;font-weight:800;color:#a78bfa;',
        ].join('');
        num.textContent = step.n;
        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:12.5px;color:var(--text-secondary);line-height:1.5;padding-top:2px;';
        txt.textContent = step.text;
        row.appendChild(num);
        row.appendChild(txt);
        list.appendChild(row);
      });

      card.appendChild(title);
      card.appendChild(body);
      card.appendChild(list);
      wrap.appendChild(card);
      return wrap;
    }
    // ── END EMPTY STORE GUARD ─────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────
    // SECTION 1 — STOREFRONT SCORE
    // Visual and direct. Shows vendor what shoppers see. Sets context for
    // everything below. Merges old "Growth Snapshot" + "Visibility & Listing
    // Quality" into one coherent view — no redundancy.
    // ─────────────────────────────────────────────────────────────────────
    {
      const score = growth.visibilityScore;
      const scoreColor = score >= 80 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';
      const scoreBg    = score >= 80 ? 'rgba(16,185,129,0.12)' : score >= 55 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
      const scoreBorder= score >= 80 ? 'rgba(16,185,129,0.3)'  : score >= 55 ? 'rgba(245,158,11,0.3)'  : 'rgba(239,68,68,0.3)';

      const card = document.createElement('div');
      card.style.cssText = [
        'background:var(--card-glass);border:1px solid var(--border-glass);',
        'border-radius:16px;overflow:hidden;',
      ].join('');

      // Score bar header
      const bar = document.createElement('div');
      bar.style.cssText = [
        'display:flex;align-items:center;gap:14px;padding:16px 16px 12px;',
      ].join('');

      const ring = document.createElement('div');
      ring.style.cssText = [
        'width:56px;height:56px;border-radius:50%;flex-shrink:0;',
        'border:3px solid ' + scoreBorder + ';',
        'background:' + scoreBg + ';',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      ].join('');
      const ringVal = document.createElement('div');
      ringVal.style.cssText = 'font-size:16px;font-weight:900;line-height:1;color:' + scoreColor + ';';
      ringVal.textContent = score;
      const ringSub = document.createElement('div');
      ringSub.style.cssText = 'font-size:8px;font-weight:700;color:var(--text-muted);letter-spacing:0.3px;text-transform:uppercase;margin-top:2px;';
      ringSub.textContent = '/100';
      ring.appendChild(ringVal);
      ring.appendChild(ringSub);

      const barRight = document.createElement('div');
      barRight.style.cssText = 'flex:1;min-width:0;';
      const barTitle = document.createElement('div');
      barTitle.style.cssText = 'font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:3px;';
      barTitle.textContent = 'Storefront Rating';
      const barStatus = document.createElement('div');
      barStatus.style.cssText = 'font-size:12px;color:var(--text-secondary);line-height:1.5;';
      barStatus.textContent = score >= 80
        ? 'Strong. Keep listings fresh and push the top item.'
        : score >= 55
          ? 'Good base. A few fixes will lift your marketplace reach.'
          : 'Needs work. Weak listings get skipped before buyers even read the price.';
      // Progress track
      const track = document.createElement('div');
      track.style.cssText = 'height:4px;border-radius:99px;background:var(--border-glass);margin-top:8px;overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;border-radius:99px;background:' + scoreColor + ';width:' + score + '%;transition:width 0.6s ease;';
      track.appendChild(fill);
      barRight.appendChild(barTitle);
      barRight.appendChild(barStatus);
      barRight.appendChild(track);

      bar.appendChild(ring);
      bar.appendChild(barRight);
      card.appendChild(bar);

      // Stats strip
      const strip = document.createElement('div');
      strip.style.cssText = [
        'display:grid;grid-template-columns:repeat(3,1fr);',
        'border-top:1px solid var(--border-glass);',
      ].join('');
      [
        { label: 'With image',       val: growth.counts.image + '/' + growth.total },
        { label: 'With description', val: growth.counts.description + '/' + growth.total },
        { label: 'In marketplace',   val: growth.counts.category + '/' + growth.total },
      ].forEach(function(cell, i) {
        const cell_el = document.createElement('div');
        cell_el.style.cssText = [
          'padding:10px 8px;text-align:center;',
          i < 2 ? 'border-right:1px solid var(--border-glass);' : '',
        ].join('');
        const v = document.createElement('div');
        v.style.cssText = 'font-size:15px;font-weight:800;color:var(--text-primary);';
        v.textContent = cell.val;
        const l = document.createElement('div');
        l.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px;margin-top:2px;';
        l.textContent = cell.label;
        cell_el.appendChild(v);
        cell_el.appendChild(l);
        strip.appendChild(cell_el);
      });
      card.appendChild(strip);

      // Today's move — contextual, one sentence
      if (growth.bestSeller || restockAlerts.length > 0 || growth.fixNow.length > 0) {
        const move = document.createElement('div');
        move.style.cssText = [
          'padding:10px 16px 12px;',
          'border-top:1px solid var(--border-glass);',
          'font-size:12.5px;color:var(--text-secondary);line-height:1.55;',
        ].join('');
        const moveLbl = document.createElement('span');
        moveLbl.style.cssText = 'font-weight:800;color:var(--text-primary);';
        moveLbl.textContent = 'Priority: ';
        let moveText = '';
        if (restockAlerts.length > 0) {
          moveText = restockAlerts.length + ' product' + (restockAlerts.length > 1 ? 's are' : ' is') + ' out or nearly out. Restock before the day is done.';
        } else if (growth.fixNow.length > 0 && growth.fixNow[0].missing.length > 0) {
          moveText = 'Add ' + growth.fixNow[0].missing[0] + ' to "' + _safeStr(growth.fixNow[0].product && growth.fixNow[0].product.name) + '" — it\'s the fastest listing win you have right now.';
        } else if (growth.bestSeller) {
          moveText = 'Make "' + _safeStr(growth.bestSeller.name) + '" the storefront hero. Turn it into a post and a short demo this week.';
        }
        move.appendChild(moveLbl);
        move.appendChild(document.createTextNode(moveText));
        card.appendChild(move);
      }

      wrap.appendChild(card);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────
    // SECTION 2 — URGENT OPS
    // Time-sensitive signals first. Restock = money walking out the door
    // right now. Profit Leak = every sale is quietly bleeding margin.
    // Frozen Cash = working capital locked in unsold stock.
    // Only after those: growth / promotional signals.
    // ─────────────────────────────────────────────────────────────────────

    // ── CARD: RESTOCK NOW ────────────────────────────────────────────────
    if (restockAlerts.length > 0) {
      const rc = _insCard('rgba(239,68,68,0.35)', 'rgba(239,68,68,0.07)');
      _insCardHead(rc, '📦', 'Restock Now',
        restockAlerts.length + ' product' + (restockAlerts.length > 1 ? 's' : '') + ' need attention');
      const outNow = restockAlerts.filter(function(x){ return x.daysLeft === 0; });
      const soon   = restockAlerts.filter(function(x){ return x.daysLeft > 0;  });
      if (outNow.length) {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'padding:8px 14px 4px;font-size:11px;font-weight:700;color:rgba(239,68,68,0.9);letter-spacing:0.5px;text-transform:uppercase';
        lbl.textContent = 'Out now';
        rc.appendChild(lbl);
        outNow.slice(0, 3).forEach(function(a) {
          _insRow(rc, a.product.name, 'Losing ~' + fmt(a.lostDaily) + '/day',
            'Restock ' + a.suggest, '#ef4444',
            { action: 'restock', productId: a.product.id, qty: String(a.suggest) });
        });
      }
      if (soon.length) {
        const lbl = document.createElement('div');
        lbl.style.cssText = 'padding:8px 14px 4px;font-size:11px;font-weight:700;color:rgba(245,158,11,0.9);letter-spacing:0.5px;text-transform:uppercase;';
        lbl.textContent = 'Running low';
        rc.appendChild(lbl);
        soon.slice(0, 3).forEach(function(a) {
          _insRow(rc, a.product.name,
            a.daysLeft + ' day' + (a.daysLeft === 1 ? '' : 's') + ' left · ' + a.product.qty + ' in stock',
            'Order ' + a.suggest, '#f59e0b',
            { action: 'restock', productId: a.product.id, qty: String(a.suggest) });
        });
      }
      const sp = document.createElement('div'); sp.style.height = '6px';
      rc.appendChild(sp);
      wrap.appendChild(rc);
    }

    // ── CARD: PROFIT LEAK ────────────────────────────────────────────────
    if (profitLeaks.length > 0) {
      const plc = _insCard('rgba(239,68,68,0.25)', 'rgba(239,68,68,0.05)');
      _insCardHead(plc, '\u{1F4B8}', 'Profit Leak', 'High volume, low margin — cost is eating your return');
      profitLeaks.slice(0, 3).forEach(function(l) {
        _insRow(plc, l.product.name,
          l.margin.toFixed(0) + '% margin · sold ' + l.qty30 + '\u00D7 · only ' + fmt(l.profitMade) + ' profit kept',
          'Fix Price', '#ef4444',
          { action: 'edit', productId: l.product.id, price: String(l.betterPrice) });
      });
      const totalLeak = profitLeaks.slice(0,3).reduce(function(a,x){ return a + x.gainIfFixed; }, 0);
      _insFootnote(plc, 'A price fix here could recover ~' + fmt(totalLeak) + ' in profit this month without selling a single extra unit.');
      wrap.appendChild(plc);
    }

    // ── CARD: FROZEN CASH ────────────────────────────────────────────────
    // Only products with qty > 0 that haven't sold in 60+ days reach here.
    // Zero-stock items are NOT shown — they block sales, not hold cash.
    if (cashTraps.length > 0) {
      const cc2 = _insCard('rgba(244,114,182,0.22)', 'rgba(244,114,182,0.05)');
      _insCardHead(cc2, '\u2744\uFE0F', 'Frozen Cash', 'Stock sitting for 45+ days with no movement');
      cashTraps.slice(0, 3).forEach(function(c) {
        _insRow(cc2, c.product.name,
          c.daysIdle + ' day' + (c.daysIdle === 1 ? '' : 's') + ' idle · ' + (c.trapped > 0 ? fmt(c.trapped) + ' tied up' : 'add cost price to see value'),
          'Clear it', '#ec4899',
          { action: 'edit', productId: c.product.id, price: String(c.clearPrice || c.product.price || '') });
      });
      const clearHint = cashTraps[0] ? ' Consider ' + fmt(cashTraps[0].clearPrice) + ' or less on the first item.' : '';
      _insFootnote(cc2, 'A clearance price frees up working capital for faster-moving stock.' + clearHint);
      wrap.appendChild(cc2);
    }

    // ── CARD: PRICING OPPORTUNITIES ──────────────────────────────────────
    if (priceOpps.length > 0) {
      const oc = _insCard('rgba(59,130,246,0.24)', 'rgba(59,130,246,0.05)');
      _insCardHead(oc, '\u{1F4CA}', 'Price Up These Movers', 'Fast sellers you can charge more for without slowing demand');
      priceOpps.slice(0, 3).forEach(function(o) {
        _insRow(oc, o.product.name,
          o.qty7 + ' sold this week · ' + Number(o.margin).toFixed(0) + '% margin now',
          'Test price', '#3b82f6',
          { action: 'edit', productId: o.product.id, price: String(o.nudgePrice) });
      });
      _insFootnote(oc, 'Demand is proven. A small price nudge adds profit on every unit already selling.');
      wrap.appendChild(oc);
    }

    // ── CARD: LISTINGS TO FIX ─────────────────────────────────────────────
    if (growth.fixNow.length > 0) {
      const fc = _insCard('rgba(245,158,11,0.28)', 'rgba(245,158,11,0.06)');
      _insCardHead(fc, '\u{1F6E0}\uFE0F', 'Listings to Fix', 'Incomplete details that cost clicks before anyone reads the price');
      growth.fixNow.slice(0, 3).forEach(function(item) {
        const p = item.product;
        const missing = item.missing.length ? item.missing.join(', ') : 'low completeness';
        _insRow(fc, p.name || 'Untitled product',
          'Missing: ' + missing + ' · ' + item.score + '/100',
          'Fix it', '#f59e0b',
          { action: 'edit', productId: p.id, price: String(p.price || '') });
      });
      _insFootnote(fc, 'An image + description is usually enough to double the chance a shopper stops on that listing.');
      wrap.appendChild(fc);
    }

    // ── ALL CLEAR (only when truly nothing to show AND no sales at all) ──
    const hasSignals = restockAlerts.length + profitLeaks.length +
                       cashTraps.length + priceOpps.length + topByProfit.length +
                       growth.promote.length + growth.fixNow.length;
    if (!hasSignals && rev7 === 0) {
      const cl = _insCard('rgba(16,185,129,0.2)', 'rgba(16,185,129,0.05)');
      const inner = document.createElement('div');
      inner.style.cssText = 'padding:24px 16px;text-align:center;';
      const ico = document.createElement('div'); ico.style.fontSize = '32px'; ico.style.marginBottom = '8px'; ico.textContent = '✅';
      const ttl = document.createElement('div'); ttl.style.cssText = 'font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:6px;'; ttl.textContent = 'All good for now';
      const msg = document.createElement('div'); msg.style.cssText = 'font-size:13px;color:var(--text-muted);line-height:1.6;'; msg.textContent = 'No urgent issues. Keep listing products with strong images, descriptions, and categories.';
      inner.appendChild(ico); inner.appendChild(ttl); inner.appendChild(msg);
      cl.appendChild(inner);
      wrap.appendChild(cl);
    }

    // ── ASK AI BUTTON — always rendered, state depends on key presence ──
    const aiRow = document.createElement('div');
    aiRow.style.cssText = 'padding:4px 0 2px;';
    const aiBtn = document.createElement('button');
    aiBtn.id   = 'qs-ask-ai-btn';
    aiBtn.type = 'button';

    const hasKey = !!(window.__QS_GEMINI_KEY);

    aiBtn.style.cssText = [
      'width:100%;padding:14px;border-radius:14px;border:0;',
      hasKey
        ? 'background:linear-gradient(135deg,#7c3aed,#4f46e5);box-shadow:0 6px 20px rgba(124,58,237,0.3);'
        : 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);',
      'color:#fff;font-size:15px;font-weight:800;cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;gap:8px;',
      'letter-spacing:-0.2px;-webkit-tap-highlight-color:transparent;',
      'transition:opacity 0.15s;',
    ].join('');

    const spark = document.createElement('span');
    spark.textContent = hasKey ? '✨' : '🔑';
    const lbl = document.createElement('span');
    lbl.textContent = hasKey
      ? 'Open Growth Copilot Chat'
      : 'Enable Growth Copilot Chat';
    aiBtn.appendChild(spark);
    aiBtn.appendChild(lbl);
    aiRow.appendChild(aiBtn);
    wrap.appendChild(aiRow);

    wrap.addEventListener('click', function(e) {
      if (e.target.closest('#qs-ask-ai-btn')) {
        e.preventDefault();
        _openCopilotOverlay(sig, growth);
        return;
      }
      const btn = e.target.closest('.ai-action-btn');
      if (!btn) return;
      e.preventDefault();
      const action    = btn.dataset.action;
      const productId = btn.dataset.productId;
      const qty       = btn.dataset.qty;
      const price     = btn.dataset.price;
      closeInventoryInsight();
      setTimeout(function() {
        if (action === 'restock') {
          openModalFor('add', productId);
          setTimeout(function() {
            const qtyEl = $('modalQty');
            if (qtyEl && qty) { qtyEl.value = qty; qtyEl.focus(); }
          }, 100);
        } else if (action === 'edit') {
          setActiveView('inventory');
          setTimeout(function() {
            if (window.__QS_INVENTORY) window.__QS_INVENTORY.openEditProduct(productId);
            setTimeout(function() {
              const priceEl = $('invPrice');
              if (priceEl && price) { priceEl.value = price; priceEl.focus(); priceEl.select(); }
            }, 220);
          }, 120);
        }
      }, 120);
    });

    return wrap;
  }


  
  // ── SECURITY: All copilot keys MUST include authenticated user ID.
  // Never fall back to a shared/generic key — if user is unknown, return null
  // and callers must treat null as "no storage available."
  // This prevents cross-account AI session leakage.

  // ─── §15a  Copilot Session & Memory ──────────────────────────────────────
  function _copilotUserId() {
    // currentUser is the authoritative auth source set by handleAuthUser.
    // Do NOT fall back to localStorage or any cached value here.
    return (currentUser && typeof currentUser.id === 'string' && currentUser.id) ? currentUser.id : null;
  }

  function _copilotDailyQuestionKey() {
    const uid = _copilotUserId();
    if (!uid) return null; // no auth — no storage
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return 'qs_copilot_question_v2_' + uid + '_' + y + '-' + m + '-' + day;
  }

  function _copilotHasUsedQuestionToday() {
    try {
      const k = _copilotDailyQuestionKey();
      if (!k) return false;
      return localStorage.getItem(k) === '1';
    } catch (_) {
      return false;
    }
  }

  function _copilotMarkQuestionUsed() {
    try {
      const k = _copilotDailyQuestionKey();
      if (!k) return;
      localStorage.setItem(k, '1');
    } catch (_) {}
  }

  // ── Session persistence helpers (store today's full conversation) ─────────
  function _copilotSessionKey() {
    const uid = _copilotUserId();
    if (!uid) return null; // no auth — no storage
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return 'qs_copilot_session_v2_' + uid + '_' + y + '-' + m + '-' + day;
  }

  // ── Merchant memory: persistent cross-day identity store (per user) ───────
  // Stores what the AI has learned about this merchant across sessions.
  // Keyed by user ID — never shared, never migrated across accounts.
  function _merchantMemoryKey() {
    const uid = _copilotUserId();
    if (!uid) return null;
    return 'qs_merchant_memory_v1_' + uid;
  }

  function _getMerchantMemory() {
    try {
      const k = _merchantMemoryKey();
      if (!k) return null;
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Ownership check: stored uid must match current user
      if (!data || data._uid !== _copilotUserId()) return null;
      return data;
    } catch (_) { return null; }
  }

  function _saveMerchantMemory(patch) {
    try {
      const k = _merchantMemoryKey();
      if (!k) return;
      const uid = _copilotUserId();
      const existing = _getMerchantMemory() || {
        _uid: uid, _v: 1,
        storeCategory: null,
        heroProduct: null,
        merchantGoal: null,
        recurringTheme: null,
        lastReplySummary: null,
        sessionCount: 0,
        updatedAt: null,
      };
      const merged = Object.assign({}, existing, patch, { _uid: uid, updatedAt: new Date().toISOString() });
      localStorage.setItem(k, JSON.stringify(merged));
    } catch (_) {}
  }

  // Extract learnings from a completed merchant reply + followup pair.
  // Called after a successful followup to update long-term memory.
  function _updateMerchantMemoryFromSession(ctx, userReply, questionText) {
    try {
      const mem = _getMerchantMemory() || {};
      const count = (typeof mem.sessionCount === 'number' ? mem.sessionCount : 0) + 1;

      // Infer store category from top product if not yet known
      let storeCategory = mem.storeCategory;
      if (!storeCategory && ctx && ctx.promoted && ctx.promoted[0]) {
        const cat = _safeStr((ctx.promoted[0] || {}).category, '');
        if (cat) storeCategory = cat;
      }

      // Hero product: who is the current star?
      let heroProduct = mem.heroProduct;
      if (ctx && ctx.heroName && ctx.heroName !== 'Choose a hero product') {
        heroProduct = ctx.heroName;
      }

      // Extract what the merchant said about their direction
      const reply = _safeStr(userReply, '').slice(0, 200);
      const question = _safeStr(questionText, '').slice(0, 150);

      _saveMerchantMemory({
        storeCategory: storeCategory || mem.storeCategory,
        heroProduct: heroProduct || mem.heroProduct,
        lastReplySummary: reply ? (question + ' → ' + reply) : mem.lastReplySummary,
        sessionCount: count,
      });
    } catch (_) {}
  }

  // Build the memory context block for injection into prompts.
  // Returns empty string if no memory exists (first-time users).
  function _buildMemoryContext() {
    const mem = _getMerchantMemory();
    if (!mem) return '';
    const lines = [];
    if (mem.heroProduct) lines.push('Known hero product: ' + mem.heroProduct);
    if (mem.storeCategory) lines.push('Primary store category: ' + mem.storeCategory);
    if (mem.lastReplySummary) lines.push('Last session: merchant said "' + mem.lastReplySummary + '"');
    if (typeof mem.sessionCount === 'number' && mem.sessionCount > 1) {
      lines.push('This merchant has used Growth Copilot ' + mem.sessionCount + ' times before.');
    }
    if (!lines.length) return '';
    return 'MERCHANT MEMORY (from previous sessions):\n' + lines.join('\n');
  }

  // Returns {v,insight,userReply,followup} or null if nothing stored today.
  function _copilotGetSession() {
    try {
      const k = _copilotSessionKey();
      if (!k) return null; // no authenticated user — refuse storage access
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.v === 1 && typeof data.insight === 'string' && data.insight) return data;
      return null;
    } catch (_) { return null; }
  }

  // Merge patch into today's stored session (creates it if absent).
  function _copilotSaveSession(patch) {
    try {
      const k = _copilotSessionKey();
      if (!k) return; // no authenticated user — refuse storage write
      const existing = _copilotGetSession() || { v: 1, insight: null, userReply: null, followup: null };
      const merged = Object.assign({}, existing, patch);
      localStorage.setItem(k, JSON.stringify(merged));
    } catch (_) {}
  }

  function _copilotExtractQuestion(rawText) {
    const text = _safeStr(rawText);
    const m = text.match(/(?:^|\n)\s*QUESTION\s*[:：\-–—]\s*([^\n]+)/i);
    if (m && m[1]) return m[1].trim();
    const lines = text.split(/\n+/).map(function(line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return '';
    return lines[lines.length - 1].replace(/^[#>*\-•\s]+/, '').trim();
  }

  function _buildCopilotSnapshot(sig, growth) {
    const safeSig = sig || {};
    const s = safeSig.s || {};
    const restockAlerts = Array.isArray(safeSig.restockAlerts) ? safeSig.restockAlerts : [];
    const profitLeaks = Array.isArray(safeSig.profitLeaks) ? safeSig.profitLeaks : [];
    const cashTraps = Array.isArray(safeSig.cashTraps) ? safeSig.cashTraps : [];
    const priceOpps = Array.isArray(safeSig.priceOpps) ? safeSig.priceOpps : [];
    const trendPct = safeSig.trendPct;

    const products = Array.isArray(s.products) ? s.products : [];
    const promoted = (growth && Array.isArray(growth.promote)) ? growth.promote : [];
    const fixes = (growth && Array.isArray(growth.fixNow)) ? growth.fixNow : [];

    const topProducts = (promoted.length ? promoted : products.slice(0, 3)).map(function(p, idx) {
      return (idx + 1) + '. ' + _safeStr(p.name, 'Untitled product') +
        ' | stock:' + (Number(p.qty) || 0) +
        ' | category:' + _safeStr(p.category, 'none') +
        ' | image:' + ((p.image || p.image2) ? 'yes' : 'no') +
        ' | desc:' + (_safeStr(p.description).length >= 24 ? 'yes' : 'no') +
        ' | hook:' + (growth && growth.contentHookForProduct ? growth.contentHookForProduct(p) : 'n/a');
    }).join('\n');

    const fixLines = (fixes.length ? fixes : products.map(function(p) { return { product: p, score: 0, missing: ['listing'] }; }).slice(0, 3)).map(function(item, idx) {
      const p = item.product || {};
      return (idx + 1) + '. ' + _safeStr(p.name, 'Untitled product') +
        ' | missing:' + (Array.isArray(item.missing) ? item.missing.join(', ') : 'listing') +
        ' | score:' + (typeof item.score === 'number' ? item.score : 0) + '/100';
    }).join('\n');

    const alerts = [
      restockAlerts.length ? restockAlerts.length + ' products are low or out of stock' : '',
      profitLeaks.length ? profitLeaks.length + ' products are selling with weak margin' : '',
      cashTraps.length ? cashTraps.length + ' products are tying up cash' : '',
      priceOpps.length ? priceOpps.length + ' fast movers can likely take a higher price test' : '',
    ].filter(Boolean).join('\n');

    const promoteLines = promoted.slice(0, 3).map(function(p, i) {
      return (i + 1) + '. ' + _safeStr(p.name) + ' | ' + p.qty + ' in stock' +
        (p.price ? ' | ₦' + Number(p.price).toLocaleString() : '') +
        ' | content angle: ' + growth.contentHookForProduct(p);
    }).join('\n');

    const snapshot = [
      'QuickShop merchant in Nigeria. Currency: NGN.',
      products.length === 0
        ? 'STORE STATUS: Brand new — zero products added yet. This merchant needs onboarding guidance, not market analysis. Focus entirely on what to do first: add products, write descriptions, set prices, upload photos. Be direct and practical.'
        : 'Goal: improve visibility, conversion, trust, and social reach; do not repeat raw metrics.',
      'Sales trend: ' + (trendPct !== null ? (trendPct >= 0 ? '+' : '') + Number(trendPct).toFixed(0) + '%' : 'n/a') + ' vs previous 7 days.',
      products.length > 0 ? ('Operational context: ' + (restockAlerts.length ? restockAlerts.length + ' low-stock issue(s).' : 'No urgent stockouts.') + ' ' + (profitLeaks.length ? profitLeaks.length + ' margin issue(s).' : 'No serious margin leak.') +
        ' ' + (fixes.length ? fixes.length + ' listing issue(s) need attention.' : 'Listings are reasonably complete.')) : '',
      products.length > 0 ? ('Products to feature:\n' + topProducts) : '',
      products.length > 0 ? ('Products to fix:\n' + fixLines) : '',
      products.length > 0 && promoteLines ? ('Products ready to promote (with suggested content angle):\n' + promoteLines) : '',
      products.length > 0 && alerts ? ('Alerts:\n' + alerts) : products.length > 0 ? 'Alerts: none.' : '',
    ].filter(Boolean).join('\n');

    return {
      snapshot: snapshot,
      products: products,
      promoted: promoted,
      fixes: fixes,
      topProducts: topProducts,
      fixLines: fixLines,
      alerts: alerts,
      restockAlerts: restockAlerts,
      profitLeaks: profitLeaks,
      cashTraps: cashTraps,
      priceOpps: priceOpps,
      trendPct: trendPct,
      heroName: _safeStr((promoted[0] || growth.bestSeller || {}).name, 'Choose a hero product'),
    };
  }

  function _renderGrowthCopilotNarrative(narrativeZone, rawText, growth, sig, session) {
    narrativeZone.innerHTML = '';
    narrativeZone.style.cssText = 'display:block;';

    const text = _safeStr(rawText);

    // ── Inject dot-bounce animation once ────────────────────────────────────
    if (!document.getElementById('qs-chat-anim')) {
      const st = document.createElement('style');
      st.id = 'qs-chat-anim';
      st.textContent = [
        '@keyframes qsDotBounce{',
        '0%,80%,100%{transform:translateY(0);opacity:0.35}',
        '40%{transform:translateY(-5px);opacity:1}',
        '}',
      ].join('');
      document.head.appendChild(st);
    }

    // ── Thread container ─────────────────────────────────────────────────────
    const thread = document.createElement('div');
    thread.id = 'qs-copilot-thread';
    thread.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding-bottom:4px;';
    narrativeZone.appendChild(thread);
    narrativeZone.__qsCopilotThread = thread;

    // ── Avatar factory ───────────────────────────────────────────────────────
    function _aiAvatar() {
      const av = document.createElement('div');
      av.style.cssText = [
        'width:30px;height:30px;min-width:30px;border-radius:8px;flex-shrink:0;margin-top:2px;',
        'background:linear-gradient(135deg,var(--accent-primary),var(--accent-primary-hover));',
        'display:flex;align-items:center;justify-content:center;',
        'box-shadow:0 2px 8px rgba(99,102,241,0.3);',
      ].join('');
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('width','15'); svg.setAttribute('height','15');
      svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none');
      svg.setAttribute('stroke','#fff'); svg.setAttribute('stroke-width','2');
      svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
      svg.innerHTML = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/><line x1="12" y1="11" x2="12" y2="15"/><line x1="10" y1="13" x2="14" y2="13"/>';
      av.appendChild(svg);
      return av;
    }

    function _userAvatar() {
      const av = document.createElement('div');
      av.style.cssText = 'width:28px;height:28px;border-radius:50%;flex-shrink:0;overflow:hidden;margin-top:2px;';
      const avatarUrl = state && state._avatarUrl;
      if (avatarUrl) {
        const img = document.createElement('img');
        img.src = escapeHtml(avatarUrl);
        img.alt = 'You';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        img.onerror = function() {
          av.removeChild(img);
          av.style.cssText += 'background:linear-gradient(135deg,rgba(99,102,241,0.4),rgba(79,70,229,0.6));display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;font-weight:700;';
          av.textContent = 'Y';
        };
        av.appendChild(img);
      } else {
        av.style.cssText += 'background:rgba(99,102,241,0.25);border:1px solid rgba(99,102,241,0.3);display:flex;align-items:center;justify-content:center;';
        const icon = document.createElement('svg');
        icon.setAttribute('width','14'); icon.setAttribute('height','14'); icon.setAttribute('viewBox','0 0 24 24');
        icon.setAttribute('fill','none'); icon.setAttribute('stroke','rgba(167,139,250,0.9)'); icon.setAttribute('stroke-width','2');
        icon.innerHTML = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
        av.appendChild(icon);
      }
      return av;
    }

    // ── Append AI prose bubble ───────────────────────────────────────────────
    function _appendAiBubble(content) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';
      row.appendChild(_aiAvatar());
      const bubble = document.createElement('div');
      bubble.style.cssText = [
        'flex:1;min-width:0;',
        'background:var(--card-glass);border:1px solid var(--border-glass);',
        'border-radius:4px 18px 18px 18px;padding:14px 16px;',
        'font-size:14px;color:var(--text-primary);line-height:1.78;',
        'box-shadow:var(--shadow-soft);',
      ].join('');
      // Split by newlines first, then further split dense paragraphs at sentence
      // boundaries so each sentence is its own <p> (handles Gemini single-block output).
      var rawChunks = String(content).split(/\n+/).map(function(p){ return p.trim(); }).filter(Boolean);
      var paras = [];
      rawChunks.forEach(function(chunk) {
        var parts = chunk.replace(/([.!])\s+([A-Z])/g, '$1\n$2').split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
        paras = paras.concat(parts);
      });
      var isLastQuestion = paras.length > 0 && paras[paras.length - 1].endsWith('?');
      paras.forEach(function(para, i) {
        var isQuestion = (i === paras.length - 1) && isLastQuestion && paras.length > 1;
        var p = document.createElement('p');
        if (isQuestion) {
          p.style.cssText = 'margin:12px 0 0;padding-top:11px;border-top:1px solid var(--border-glass);font-weight:600;color:var(--text-primary);';
        } else {
          p.style.margin = i < paras.length - 1 ? '0 0 10px' : '0';
        }
        p.textContent = para;
        bubble.appendChild(p);
      });
      row.appendChild(bubble);
      thread.appendChild(row);
      return row;
    }

    // ── Append user reply bubble ─────────────────────────────────────────────
    function _appendUserBubble(content) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;align-items:flex-end;gap:8px;';
      const bubble = document.createElement('div');
      bubble.style.cssText = [
        'max-width:82%;',
        'background:var(--accent-primary);',
        'border-radius:18px 4px 18px 18px;padding:12px 15px;',
        'font-size:14px;color:#fff;line-height:1.7;',
        'box-shadow:0 2px 8px rgba(99,102,241,0.25);',
      ].join('');
      bubble.textContent = content;
      row.appendChild(bubble);
      row.appendChild(_userAvatar());
      thread.appendChild(row);
      return row;
    }

    // ── Append thinking dots bubble ──────────────────────────────────────────
    function _appendThinkingBubble() {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';
      row.appendChild(_aiAvatar());
      const bubble = document.createElement('div');
      bubble.style.cssText = [
        'background:var(--card-glass);border:1px solid var(--border-glass);',
        'border-radius:4px 18px 18px 18px;padding:14px 18px;',
        'display:flex;align-items:center;gap:5px;',
      ].join('');
      [0, 0.18, 0.36].forEach(function(delay) {
        const dot = document.createElement('span');
        dot.style.cssText = [
          'display:inline-block;width:7px;height:7px;border-radius:50%;',
          'background:var(--accent-primary);',
          'animation:qsDotBounce 1.1s ease-in-out infinite;',
          'animation-delay:' + delay + 's;',
        ].join('');
        bubble.appendChild(dot);
      });
      row.appendChild(bubble);
      thread.appendChild(row);
      return row;
    }

    // Store helpers on narrativeZone so _runGeminiFollowup can access them
    narrativeZone.__qsAppendAiBubble       = _appendAiBubble;
    narrativeZone.__qsAppendUserBubble     = _appendUserBubble;
    narrativeZone.__qsAppendThinkingBubble = _appendThinkingBubble;

    // ── Render initial AI message ────────────────────────────────────────────
    // Strip any leaked section labels (VERDICT:, WHY IT MATTERS:, etc.)
    const cleanText = text
      .replace(/^\s*(VERDICT|WHY IT MATTERS|WHAT TO DO TODAY|WHAT TO POST|QUESTION)\s*[:：\-–—]\s*/gim, '')
      .replace(/^\s*#+\s*/gm, '')
      .trim();

    _appendAiBubble(cleanText);

    // Store insight text so the follow-up prompt has full context
    narrativeZone.__qsCopilotInsight = cleanText;

    // Restore stored thread (user reply + AI follow-up) if page was refreshed
    if (session && session.userReply) {
      _appendUserBubble(session.userReply);
      if (session.followup) {
        _appendAiBubble(session.followup);
      }
    }

    // Extract the question text for follow-up prompt context
    const questionText = _copilotExtractQuestion(text) || 'What should this store become known for?';
    narrativeZone.__qsCopilotQuestion = questionText;

    // ── Composer ─────────────────────────────────────────────────────────────
    // Locked if the daily gate is set OR if the stored session already has a reply
    const locked = _copilotHasUsedQuestionToday() || !!(session && session.userReply);
    const composer = document.createElement('div');
    composer.style.cssText = 'margin-top:16px;border-top:1px solid var(--border-glass);padding-top:14px;';

    if (locked) {
      const lockRow = document.createElement('div');
      lockRow.style.cssText = [
        'text-align:center;font-size:12px;color:var(--text-muted);',
        'padding:8px 0 2px;letter-spacing:0.1px;',
      ].join('');
      lockRow.textContent = '\u2713  You replied today. Come back tomorrow for the next question.';
      composer.appendChild(lockRow);
    } else {
      const inputRow = document.createElement('div');
      inputRow.style.cssText = 'display:flex;align-items:flex-end;gap:9px;';

      const reply = document.createElement('textarea');
      reply.rows = 1;
      reply.maxLength = 220;
      reply.placeholder = 'Reply with one sentence\u2026';
      reply.style.cssText = [
        'flex:1;resize:none;box-sizing:border-box;overflow:hidden;',
        'background:var(--card-glass);border:1px solid var(--border-glass);',
        'border-radius:14px;padding:11px 14px;color:var(--text-primary);font-size:14px;line-height:1.55;',
        'outline:none;min-height:44px;max-height:108px;',
        'transition:border-color 0.15s;caret-color:var(--accent-primary);',
      ].join('');

      reply.addEventListener('input', function() {
        reply.style.height = 'auto';
        reply.style.height = Math.min(reply.scrollHeight, 108) + 'px';
      });
      reply.addEventListener('focus', function() {
        reply.style.borderColor = 'var(--accent-primary)';
      });
      reply.addEventListener('blur', function() {
        reply.style.borderColor = 'var(--border-glass)';
      });

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.style.cssText = [
        'width:42px;height:42px;border-radius:13px;border:0;flex-shrink:0;',
        'background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;',
        'cursor:pointer;display:flex;align-items:center;justify-content:center;',
        'box-shadow:0 4px 14px rgba(124,58,237,0.3);',
        'transition:opacity 0.15s;',
      ].join('');
      sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

      const _send = function() {
        if (_copilotHasUsedQuestionToday()) {
          toast('Come back tomorrow for a fresh question.', 'info');
          return;
        }
        const answer = _safeStr(reply.value).trim();
        if (!answer) { toast('Reply with one short sentence.', 'info'); reply.focus(); return; }
        reply.disabled = true;
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.45';
        _runGeminiFollowup(sig, narrativeZone, growth, answer, questionText, composer, reply, sendBtn, null);
      };

      sendBtn.addEventListener('click', _send);
      reply.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
      });

      const hint = document.createElement('div');
      hint.style.cssText = [
        'font-size:11px;color:var(--text-muted);',
        'margin-top:7px;text-align:center;letter-spacing:0.1px;',
      ].join('');
      hint.textContent = 'One reply \u00b7 resets tomorrow';

      inputRow.appendChild(reply);
      inputRow.appendChild(sendBtn);
      composer.appendChild(inputRow);
      composer.appendChild(hint);
    }

    narrativeZone.appendChild(composer);
    narrativeZone.__qsCopilotComposer = composer;
  }

  // ── COPILOT OVERLAY — card that stacks on top of the insight view ─────────
  function _openCopilotOverlay(sig, growth) {
    var overlay = document.getElementById('qs-copilot-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'qs-copilot-overlay';

      // Header
      var hdr = document.createElement('div');
      hdr.className = 'insight-fullscreen-header';

      var backBtn = document.createElement('button');
      backBtn.className = 'insight-back-btn';
      backBtn.setAttribute('aria-label', 'Back to insights');
      backBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
      backBtn.addEventListener('click', function() {
        overlay.classList.add('closing');
        // ── Ghost-click shield ────────────────────────────────────────────
        // Mobile browsers emit a synthetic click ~300ms after a touchend.
        // Once the overlay hides (220ms), that ghost click lands on whatever
        // is at the same screen position — which is the insight's close button.
        // Block pointer events on that button for 420ms so it can't fire.
        var insightCloseBtn = document.getElementById('closeInventoryInsightBtn');
        if (insightCloseBtn) {
          insightCloseBtn.style.pointerEvents = 'none';
          setTimeout(function() { insightCloseBtn.style.pointerEvents = ''; }, 420);
        }
        setTimeout(function() {
          overlay.style.display = 'none';
          overlay.classList.remove('closing');
        }, 220);
      });

      var brand = document.createElement('div');
      brand.className = 'insight-header-brand';

      var logoWrap = document.createElement('div');
      logoWrap.className = 'insight-qs-logo-wrap';
      var logoImg = document.createElement('img');
      logoImg.src = '/pwa-192.png';
      logoImg.alt = 'QuickShop';
      logoImg.style.cssText = 'width:22px;height:22px;object-fit:contain;border-radius:5px;display:block;';
      logoWrap.appendChild(logoImg);

      var titleBlock = document.createElement('div');
      var titleEl = document.createElement('div');
      titleEl.className = 'insight-header-title';
      titleEl.textContent = 'Growth Copilot';
      var subEl = document.createElement('div');
      subEl.className = 'insight-header-sub';
      subEl.textContent = 'Powered by QuickShop AI';
      titleBlock.appendChild(titleEl);
      titleBlock.appendChild(subEl);

      brand.appendChild(logoWrap);
      brand.appendChild(titleBlock);

      var spacer = document.createElement('div');
      spacer.className = 'insight-header-spacer';

      hdr.appendChild(backBtn);
      hdr.appendChild(brand);
      hdr.appendChild(spacer);

      var chatZone = document.createElement('div');
      chatZone.id = 'qs-copilot-chat-zone';

      overlay.appendChild(hdr);
      overlay.appendChild(chatZone);
      document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';
    overlay.classList.remove('closing');

    var chatZone = document.getElementById('qs-copilot-chat-zone');
    if (!chatZone) return;

    if (!window.__QS_GEMINI_KEY) {
      chatZone.innerHTML = '';
      var setupCard = document.createElement('div');
      setupCard.style.cssText = [
        'background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);',
        'border-radius:16px;padding:18px;margin:16px 0;',
      ].join('');
      var steps = [
        { icon: '1.', text: 'Create a Gemini API key in Google AI Studio.' },
        { icon: '2.', text: 'Add it as GEMINI_API_KEY in your hosting environment.' },
        { icon: '3.', text: 'Redeploy and refresh the app.' },
        { icon: '4.', text: 'Growth Copilot will start turning your data into storefront guidance.' },
      ];
      var setupHdr = document.createElement('div');
      setupHdr.style.cssText = 'font-size:14px;font-weight:700;color:#a78bfa;margin-bottom:12px;';
      setupHdr.textContent = 'Enable Growth Copilot Chat';
      setupCard.appendChild(setupHdr);
      steps.forEach(function(step) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;';
        var ic = document.createElement('span');
        ic.style.cssText = 'font-weight:700;color:var(--accent-primary);flex-shrink:0;';
        ic.textContent = step.icon;
        var tx = document.createElement('span');
        tx.style.cssText = 'font-size:13px;color:var(--text-secondary);line-height:1.5;';
        tx.textContent = step.text;
        row.appendChild(ic); row.appendChild(tx);
        setupCard.appendChild(row);
      });
      var note = document.createElement('div');
      note.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.5;';
      note.textContent = 'The local growth cards still work even without AI.';
      setupCard.appendChild(note);
      chatZone.appendChild(setupCard);
      return;
    }

    _runGeminiInsight(sig, chatZone, growth);
  }


  // ── GEMINI LAYER (Layer 2) ────────────────────────────────────────────────
  // Builds a ~400-token business snapshot and calls Gemini 2.0 Flash.
  // Free tier: 15 req/min, 1M tokens/day. More than enough for this use case.

  // ─── §15b  Gemini AI Layer ────────────────────────────────────────────────
  async function _runGeminiInsight(sig, narrativeZone, growth) {
    const key = window.__QS_GEMINI_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY') {
      toast('Growth Copilot key not configured. Add GEMINI_API_KEY to your hosting env.', 'error');
      return;
    }

    // ── Cache-first: restore today's session without an API call ─────────────
    const stored = _copilotGetSession();
    if (stored && stored.insight) {
      narrativeZone.style.display = 'block';
      narrativeZone.innerHTML = '';
      _renderGrowthCopilotNarrative(narrativeZone, stored.insight, growth, sig, stored);
      const aiBtn = document.getElementById('qs-ask-ai-btn');
      if (aiBtn) {
        aiBtn.disabled = false;
        aiBtn.style.opacity = '1';
        const lbl = aiBtn.querySelector('span:last-child');
        if (lbl) lbl.textContent = 'Refresh Chat';
      }
      return;
    }

    // ── No stored session — call Gemini for today's fresh insight ─────────────
    const aiBtn = document.getElementById('qs-ask-ai-btn');
    if (aiBtn) {
      aiBtn.disabled = true;
      aiBtn.style.opacity = '0.6';
      const lbl = aiBtn.querySelector('span:last-child');
      if (lbl) lbl.textContent = 'Thinking like a growth coach\u2026';
    }

    narrativeZone.style.display = 'block';
    narrativeZone.innerHTML = '';
    const skel = document.createElement('div');
    skel.style.cssText = [
      'background:var(--card-glass);border:1px solid var(--border-glass);',
      'border-radius:16px;padding:20px 18px;',
    ].join('');
    const skelLbl = document.createElement('div');
    skelLbl.style.cssText = 'font-size:11px;font-weight:700;color:var(--accent-primary);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px;opacity:0.7;';
    skelLbl.textContent = '\u2728 Growth Copilot is thinking\u2026';
    [92, 78, 88, 66, 82].forEach(function(w) {
      const l = document.createElement('div');
      l.style.cssText = 'height:12px;border-radius:6px;background:var(--border-glass);margin-bottom:8px;width:' + w + '%;';
      skel.appendChild(l);
    });
    skel.appendChild(skelLbl);
    narrativeZone.appendChild(skel);

    const ctx = _buildCopilotSnapshot(sig, growth);
    const snapshot = ctx.snapshot;

    const prompt = [
      'You are QuickShop Growth Copilot.',
      'You are NOT an analytics narrator. The merchant already sees the numbers in the insight panel.',
      'Your job: read what the numbers mean, spot what they miss, and tell the merchant exactly what to do.',
      'Sound like a sharp Nigerian commerce strategist — direct, practical, occasionally surprising.',
      '',
      'RULES:',
      '- Never repeat raw metrics or restate what the insight panel already shows.',
      '- No markdown bullets, tables, numbering, headers, or code fences.',
      '- Mention product names only when strategically necessary.',
      '- Do not give generic marketing advice.',
      '- Be confident and specific. Generic = useless.',
      '',
      'RESPONSE FORMAT — natural prose, this exact structure:',
      '',
      'Paragraph 1 — Strategic read (2-3 sentences):',
      'Open with one sharp sentence: your honest verdict on what is actually happening in this store.',
      'Follow with the hidden pattern or risk the merchant has not noticed.',
      'Then the single highest-leverage operational or positioning move they should make.',
      '',
      'Paragraph 2 — Promote these (2-3 sentences):',
      'Based on the products ready to promote in the snapshot, tell the merchant which product to lead with and exactly how to present it — specific to what the product actually is.',
      'Then name the follow-up product and the angle for it.',
      'One sentence on where to post or how to sequence the content this week.',
      '',
      'Final line — one focused question the merchant should answer today. Nothing else on that line.',
      '',
      'Total response: 5-7 sentences. No greetings, no sign-offs, no encouragement padding.',
      '',
      'SNAPSHOT:',
      snapshot,
      _buildMemoryContext() ? ('\n' + _buildMemoryContext()) : '',
    ].join('\n');

    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + key,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.55, maxOutputTokens: 900 }
          })
        }
      );
      if (!res.ok) {
        const errBody = await res.text().catch(function(){ return ''; });
        throw new Error('Gemini HTTP ' + res.status + ': ' + errBody.slice(0, 120));
      }
      const data = await res.json();
      const text = (data.candidates &&
                    data.candidates[0] &&
                    data.candidates[0].content &&
                    data.candidates[0].content.parts &&
                    data.candidates[0].content.parts[0] &&
                    data.candidates[0].content.parts[0].text) || '';
      if (!text) throw new Error('Empty response from Gemini');

      // Save today's insight — subsequent panel opens restore from here, no API call
      _copilotSaveSession({ v: 1, insight: text, userReply: null, followup: null });

      _renderGrowthCopilotNarrative(narrativeZone, text, growth, sig, null);

      if (aiBtn) {
        aiBtn.disabled = false;
        aiBtn.style.opacity = '1';
        const lbl = aiBtn.querySelector('span:last-child');
        if (lbl) lbl.textContent = 'Refresh Chat';
      }
    } catch (e) {
      errlog('Gemini insight failed', e);
      narrativeZone.innerHTML = '';
      const errCard = document.createElement('div');
      errCard.style.cssText = 'background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:16px;';
      const errTxt = document.createElement('div');
      errTxt.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:8px;';
      errTxt.textContent = 'AI analysis failed. The local growth cards above are still accurate.';
      const errDetail = document.createElement('div');
      errDetail.style.cssText = 'font-size:11px;color:rgba(239,68,68,0.7);font-family:monospace;word-break:break-all;line-height:1.5;';
      errDetail.textContent = 'Error: ' + (e && e.message ? e.message : String(e));
      errCard.appendChild(errTxt);
      errCard.appendChild(errDetail);
      narrativeZone.appendChild(errCard);
      if (aiBtn) {
        aiBtn.disabled = false;
        aiBtn.style.opacity = '1';
        const lbl = aiBtn.querySelector('span:last-child');
        if (lbl) lbl.textContent = 'Try Again';
      }
      toast('AI analysis failed \u2014 check your Gemini key or connection.', 'error');
    }
  }

  async function _runGeminiFollowup(sig, narrativeZone, growth, userReply, questionText, composer, replyEl, sendBtn, statusEl) {
    const key = window.__QS_GEMINI_KEY;
    if (!key || key === 'YOUR_GEMINI_API_KEY') {
      toast('Growth Copilot key not configured. Add GEMINI_API_KEY to your hosting env.', 'error');
      if (replyEl) replyEl.disabled = false;
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; }
      return;
    }

    const thread         = narrativeZone.__qsCopilotThread;
    const appendUser     = narrativeZone.__qsAppendUserBubble;
    const appendAi       = narrativeZone.__qsAppendAiBubble;
    const appendThinking = narrativeZone.__qsAppendThinkingBubble;
    const initialInsight = _safeStr(narrativeZone.__qsCopilotInsight);

    if (!thread || !appendUser || !appendAi || !appendThinking) {
      toast('Follow-up failed — please refresh.', 'error');
      if (replyEl) replyEl.disabled = false;
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; }
      return;
    }

    // Render the merchant's reply as a chat bubble immediately
    appendUser(userReply);

    // Show thinking dots while Gemini works
    const thinkingRow = appendThinking();
    try { thinkingRow.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (_) {}

    const ctx = _buildCopilotSnapshot(sig, growth);
    const snapshot = ctx.snapshot;

    // ── Smart follow-up prompt ────────────────────────────────────────────────
    // Intent-classification model: AI reads what the merchant ACTUALLY said
    // and responds to that — not to what it expected them to say.
    const prompt = [
      'You are QuickShop Growth Copilot giving a follow-up to a Nigerian merchant.',
      '',
      'WHAT YOU TOLD THEM TODAY:',
      initialInsight || '(initial insight not available)',
      '',
      'YOUR QUESTION:',
      questionText,
      '',
      'THE MERCHANT SAID:',
      userReply,
      '',
      '═══ YOUR JOB ═══',
      '',
      'Internally determine the merchant reply type — DO NOT write this determination in your response.',
      'React type A if they made a specific request (post, caption, tweet, WhatsApp status, example, idea, template).',
      'React type B if they gave a real answer about their store, product, or direction.',
      'React type C if they were vague or unhelpful (I do not know, not sure, you tell me).',
      'React type D if they pushed back, redirected, or raised a different concern.',
      '',
      'TYPE A — Specific request:',
      'Write the actual ready-to-copy post/caption text. Keep it under 55 words. Make it feel real, not corporate.',
      'Label it clearly on its own line, e.g. "WhatsApp Status:" or "Try this on Instagram:".',
      'After the post, write ONE sentence of strategic context explaining why this angle works.',
      '',
      'TYPE B — Real answer:',
      'Synthesize what they said into ONE concrete next action. 2-3 sentences.',
      'Do not summarize what they said back at them. Move forward.',
      '',
      'TYPE C — Vague or no answer:',
      'Skip the question. Give them your best judgment as if you know the answer.',
      'Tell them what their store should stand for and what to do about it now. 2-3 sentences.',
      '',
      'TYPE D — Pushback or redirect:',
      'Acknowledge the new direction in one sentence. Then give the sharpest move for where they want to go.',
      '',
      'ALWAYS:',
      '- Use the merchant product names when useful (see snapshot below)',
      '- Sound human, confident, slightly surprising',
      '- No headers, bullets, numbered lists, or markdown',
      '- Do NOT begin your response with any classification label or internal reasoning',
      '- Do NOT ask another question',
      '- Do NOT greet or sign off',
      '- Do NOT repeat what you already said in the initial insight',
      '- Total response: under 5 sentences (or post text + 1 sentence if writing a post)',
      '',
      'MERCHANT SNAPSHOT (for product names and context):',
      snapshot,
      _buildMemoryContext() ? ('\n' + _buildMemoryContext()) : '',
    ].join('\n');

    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + key,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 450 }
          })
        }
      );
      if (!res.ok) {
        const errBody = await res.text().catch(function(){ return ''; });
        throw new Error('Gemini HTTP ' + res.status + ': ' + errBody.slice(0, 120));
      }
      const data = await res.json();
      const text = (data.candidates &&
                    data.candidates[0] &&
                    data.candidates[0].content &&
                    data.candidates[0].content.parts &&
                    data.candidates[0].content.parts[0] &&
                    data.candidates[0].content.parts[0].text) || '';
      if (!text) throw new Error('Empty response from Gemini');

      if (thinkingRow.parentNode) thinkingRow.remove();

      const followupText = text.trim();
      appendAi(followupText);
      try { thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch (_) {}

      // Save the complete conversation to localStorage for same-day restore
      _copilotSaveSession({ userReply: userReply, followup: followupText });
      _copilotMarkQuestionUsed();
      // Update persistent cross-day merchant memory from this session
      _updateMerchantMemoryFromSession(ctx, userReply, questionText);

      // Lock the composer
      if (composer) {
        composer.innerHTML = '';
        const lockRow = document.createElement('div');
        lockRow.style.cssText = [
          'text-align:center;font-size:12px;color:rgba(255,255,255,0.3);',
          'padding:10px 0 2px;letter-spacing:0.1px;',
        ].join('');
        lockRow.textContent = '\u2713  Done for today. Come back tomorrow for the next question.';
        composer.appendChild(lockRow);
      }

      const aiBtn = document.getElementById('qs-ask-ai-btn');
      if (aiBtn) {
        const lbl = aiBtn.querySelector('span:last-child');
        if (lbl) lbl.textContent = 'Refresh Chat';
      }

    } catch (e) {
      if (thinkingRow.parentNode) thinkingRow.remove();
      errlog('Gemini follow-up failed', e);

      const errRow = document.createElement('div');
      errRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';
      const errBubble = document.createElement('div');
      errBubble.style.cssText = [
        'flex:1;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);',
        'border-radius:4px 18px 18px 18px;padding:12px 15px;',
        'font-size:13px;color:var(--text-secondary);line-height:1.55;',
      ].join('');
      errBubble.textContent = 'Follow-up failed. Check your connection and try again.';
      errRow.appendChild(errBubble);
      thread.appendChild(errRow);

      if (replyEl) replyEl.disabled = false;
      if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '1'; }

      toast('Follow-up failed \u2014 check your connection or Gemini key.', 'error');
    }
  }

// ── PUBLIC ENTRY POINT ────────────────────────────────────────────────────

  // ─── §15c  Public Entry Point ─────────────────────────────────────────────
  function generateAdvancedInsights(returnHtml) {
    try {
      const sig = _computeSignals();
      const dom = _buildInsightDom(sig, true);
      if (returnHtml) return dom;
      const aiContent = $('aiContent');
      if (aiContent) { aiContent.innerHTML = ''; aiContent.appendChild(dom); }
    } catch (e) {
      errlog('generateAdvancedInsights failed', e);
      if (returnHtml) {
        const err = document.createElement('div');
        err.style.cssText = 'padding:16px;color:rgba(255,255,255,0.5);font-size:13px;';
        err.textContent = 'Could not load insights right now.';
        return err;
      }
    }
  }

  function initInsightsHandlers() {
    const closeInventoryInsightBtn = $('closeInventoryInsightBtn');
    if (closeInventoryInsightBtn) closeInventoryInsightBtn.addEventListener('click', closeInventoryInsight);

    const insightBtn = $('insightBtn');
    if (insightBtn) {
      insightBtn.addEventListener('click', function () {
        const dom = generateAdvancedInsights(true);
        if (dom) showInventoryInsight(dom);
      });
    }

    const toggleInsightsBtn = $('toggleInsightsBtn');
    if (toggleInsightsBtn) {
      toggleInsightsBtn.addEventListener('click', function () {
        const aiCard = $('aiCard');
        if (!aiCard) return;
        const visible = aiCard.style.display !== 'none' && aiCard.style.display !== '';
        if (visible) {
          aiCard.style.display = 'none';
          toggleInsightsBtn.setAttribute('aria-pressed', 'false');
        } else {
          generateAdvancedInsights();
          aiCard.style.display = 'block';
          toggleInsightsBtn.setAttribute('aria-pressed', 'true');
        }
      });
    }

    const refreshInsightsBtn = $('refreshInsights');
    if (refreshInsightsBtn) {
      refreshInsightsBtn.addEventListener('click', function () {
        generateAdvancedInsights();
        toast('Insights refreshed', 'info', 1500);
      });
    }
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §16  SEARCH & THEME
  // ═══════════════════════════════════════════════════════════════════════════
  function initSearchHandler() {
    const headerSearch = $('headerSearchInput');
    if (headerSearch) {
      headerSearch.addEventListener('input', function() {
        const currentView = document.querySelector('.panel.active')?.id;
        if (currentView === 'inventoryPanel') renderInventory();
        else if (currentView === 'homePanel') scheduleRenderProducts();
      });
    }
  }

  function initToggleAddFormHandler() {
    // Moved to inventory.js — called via initAll()
  }

  function initThemeToggle() {
    const currentTheme = localStorage.getItem('qs_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('qs_theme', newTheme);
    document.querySelectorAll('.qs-theme-toggle-btn').forEach(btn => {
      btn.textContent = newTheme === 'dark' ? '☀️  Light Mode' : '🌙  Dark Mode';
      btn.setAttribute('data-current', newTheme);
    });
    document.querySelectorAll('.qs-theme-sub').forEach(el => {
      el.textContent = 'Currently ' + newTheme + ' mode';
    });
    toast('Switched to ' + newTheme + ' mode', 'info', 1500);
  }

  // Inject settings panel CSS into <head> once — avoids accumulation bug and
  // WebView <style>-in-div reliability issues.
  (function injectSettingsCSS() {
    if (document.getElementById('qs-settings-styles')) return; // already injected
    const s = document.createElement('style');
    s.id = 'qs-settings-styles';
    s.textContent = `

      /* ═══════════════════════════════════════════════════════════════
         SETTINGS PANEL — Redesigned
         Design language: Obsidian Glass · iOS-inspired list rows ·
         Consistent 8-pt spacing grid · Smooth grid-row animations
         All values use the app's existing CSS custom properties.
      ═══════════════════════════════════════════════════════════════ */

      /* ── Panel shell ─────────────────────────────────────────────── */
      #settingsPanel {
        padding: 0 0 calc(var(--nav-h) + 40px + env(safe-area-inset-bottom, 0px)) !important;
        background: var(--bg-obsidian);
      }

      /* ── Sticky profile header ───────────────────────────────────── */
      .qs-sticky-profile {
        position: sticky;
        top: var(--topbar-h);
        z-index: 100;
        background: var(--bg-obsidian);
        margin-left: -12px;
        margin-right: -12px;
        padding: 14px 20px 12px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        gap: 14px;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
      }

      /* Avatar — 52 px, gradient ring, camera pip */
      .qs-sp-avatar {
        position: relative;
        width: 52px; height: 52px;
        border-radius: 50%;
        background: linear-gradient(135deg, #6366f1 0%, #a78bfa 100%);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; font-weight: 800; color: #fff;
        flex-shrink: 0;
        /* Gradient ring */
        box-shadow:
          0 0 0 2px var(--bg-obsidian),
          0 0 0 4px rgba(99,102,241,0.45),
          0 4px 16px rgba(99,102,241,0.2);
        cursor: pointer;
        transition: box-shadow 0.2s, transform 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .qs-sp-avatar:active { transform: scale(0.95); }
      .qs-sp-avatar img {
        width: 100%; height: 100%;
        object-fit: cover; border-radius: 50%;
      }

      /* Camera badge */
      .qs-sp-cam {
        position: absolute;
        bottom: -1px; right: -1px;
        width: 20px; height: 20px;
        background: var(--accent-primary);
        border-radius: 50%;
        border: 2px solid var(--bg-obsidian);
        display: flex; align-items: center; justify-content: center;
        font-size: 9px; line-height: 1;
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(99,102,241,0.4);
      }
      .qs-sp-uploading { opacity: 0.4; pointer-events: none; }

      /* Name / email text block */
      .qs-sp-info { flex: 1; min-width: 0; }
      .qs-sp-name {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.25;
      }
      .qs-sp-email {
        font-size: 11.5px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 3px;
        line-height: 1.3;
      }

      /* Status pill */
      .qs-sp-badge {
        display: inline-flex; align-items: center; gap: 5px;
        border-radius: 100px;
        padding: 4px 10px 4px 8px;
        font-size: 10px; font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap; flex-shrink: 0;
        transition: background 0.4s, border-color 0.4s, color 0.4s;
      }
      .qs-sp-badge.online {
        background: rgba(16,185,129,0.10);
        border: 1px solid rgba(16,185,129,0.25);
        color: #10b981;
      }
      .qs-sp-badge.offline {
        background: rgba(239,68,68,0.10);
        border: 1px solid rgba(239,68,68,0.25);
        color: #ef4444;
      }
      .qs-sp-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        position: relative;
      }
      .qs-sp-badge.online  .qs-sp-dot { background: #10b981; }
      .qs-sp-badge.offline .qs-sp-dot { background: #ef4444; animation: none; }
      .qs-sp-badge.online .qs-sp-dot::after {
        content: '';
        position: absolute; inset: -3px;
        border-radius: 50%;
        background: rgba(16,185,129,0.4);
        animation: qs-dot-pulse 2s ease-out infinite;
      }
      @keyframes qs-dot-pulse {
        0%   { transform: scale(0.8); opacity: 0.9; }
        100% { transform: scale(2.4); opacity: 0;   }
      }

      /* ── Settings body (scrollable region below sticky) ──────────── */
      .qs-settings-body {
        padding: 16px 0 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* ── Section card ────────────────────────────────────────────── */
      .qs-s-section {
        background: var(--card-glass);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius);
        overflow: hidden;
        box-shadow: var(--shadow-soft);
      }

      /* Section label — floating above card */
      .qs-s-section-title {
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: var(--text-muted);
        padding: 0 4px 8px;
      }

      /* ── List row — the core unit ────────────────────────────────── */
      .qs-s-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 16px;
        gap: 12px;
        border-bottom: 1px solid var(--border-subtle);
        transition: background 0.12s;
        -webkit-tap-highlight-color: transparent;
      }
      .qs-s-row:last-child { border-bottom: none; }
      .qs-s-row-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 2px;
        line-height: 1.3;
      }
      .qs-s-row-sub {
        font-size: 11.5px;
        color: var(--text-muted);
        line-height: 1.4;
      }

      /* ── Row icon container (left side of action rows) ───────────── */
      .qs-row-icon {
        width: 34px; height: 34px;
        border-radius: 9px;
        display: flex; align-items: center; justify-content: center;
        font-size: 17px;
        flex-shrink: 0;
        background: rgba(255,255,255,0.06);
      }

      /* ── Right chevron SVG ───────────────────────────────────────── */
      .qs-row-chevron {
        color: var(--text-muted);
        opacity: 0.5;
        flex-shrink: 0;
        transition: opacity 0.2s, transform 0.28s cubic-bezier(0.4,0,0.2,1);
      }
      .qs-row-chevron svg { display: block; }

      /* ── Action rows (Edit Account, Edit Store, Share) ───────────── */
      .qs-action-row {
        display: flex;
        flex-direction: column;
      }
      .qs-action-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px 16px;
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--border-subtle);
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: background 0.12s;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }
      .qs-action-btn:last-child { border-bottom: none; }
      .qs-action-btn:active { background: rgba(255,255,255,0.04); }

      /* Active / expanded state — accent left border */
      .qs-action-btn[aria-expanded="true"] {
        background: rgba(99,102,241,0.06);
        color: var(--accent-primary);
      }
      .qs-action-btn[aria-expanded="true"] .qs-row-chevron {
        opacity: 1;
        transform: rotate(90deg);
        color: var(--accent-primary);
      }
      .qs-action-btn[aria-expanded="true"] .qs-row-icon {
        background: rgba(99,102,241,0.15);
      }

      /* Share button accent variant */
      .qs-action-btn.qs-action-share-btn .qs-row-icon {
        background: rgba(99,102,241,0.12);
        color: var(--accent-primary);
      }
      .qs-action-btn.qs-action-share-btn {
        color: var(--accent-primary);
      }

      .qs-action-icon { font-size: 18px; line-height: 1; }
      .qs-action-label { flex: 1; }
      .qs-action-sub {
        font-size: 11px;
        color: var(--text-muted);
        font-weight: 500;
        margin-top: 1px;
      }

      /* ── Drawers — grid-row animation (true height, no max-height hack) */
      .qs-drawer {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.32s cubic-bezier(0.4,0,0.2,1);
        border-bottom: 1px solid var(--border-subtle);
      }
      .qs-drawer.open {
        grid-template-rows: 1fr;
      }
      .qs-drawer-inner {
        overflow: hidden;
      }
      .qs-drawer-content {
        padding: 16px 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* ── Form fields inside drawers ──────────────────────────────── */
      .qs-field-label {
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.3px;
        color: var(--text-muted);
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .qs-field-sub {
        font-size: 11px;
        color: var(--text-muted);
        margin-bottom: 6px;
        line-height: 1.5;
      }
      .qs-input {
        width: 100%;
        box-sizing: border-box;
        background: var(--bg-glass);
        border: 1.5px solid var(--border-glass);
        border-radius: 10px;
        color: var(--text-primary);
        font-size: 14px;
        font-family: inherit;
        padding: 11px 13px;
        line-height: 1.4;
        outline: none;
        transition: border-color 0.18s, box-shadow 0.18s;
        -webkit-appearance: none;
      }
      .qs-input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 3px rgba(99,102,241,0.14);
      }
      .qs-textarea {
        resize: none;
        line-height: 1.6;
      }

      /* ── Save buttons inside drawers — filled emerald ────────────── */
      .qs-save-btn {
        align-self: flex-end;
        background: rgba(16,185,129,0.12);
        border: 1px solid rgba(16,185,129,0.3);
        border-radius: 10px;
        padding: 9px 18px;
        font-size: 13px;
        font-weight: 700;
        color: #10b981;
        cursor: pointer;
        transition: background 0.15s, transform 0.12s, box-shadow 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .qs-save-btn:active {
        background: rgba(16,185,129,0.22);
        transform: translateY(1px);
        box-shadow: none;
      }
      .qs-save-btn:disabled {
        opacity: 0.45;
        pointer-events: none;
      }

      /* Drawer section divider */
      .qs-drawer-divider {
        height: 1px;
        background: var(--border-subtle);
        margin: 4px 0;
      }

      /* ── Ghost button (secondary actions in rows) ─────────────────── */
      .qs-ghost-btn {
        background: var(--card-glass);
        border: 1px solid var(--border-glass);
        border-radius: 10px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
      }
      .qs-ghost-btn:active {
        background: var(--card-glass-hover);
        transform: translateY(1px);
      }

      /* ── Danger button (Sign Out) ─────────────────────────────────── */
      .qs-danger-btn {
        width: 100%;
        padding: 14px;
        background: transparent;
        border: 1.5px solid rgba(239,68,68,0.25);
        border-radius: 14px;
        color: #ef4444;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
        letter-spacing: 0.01em;
      }
      .qs-danger-btn:active {
        background: rgba(239,68,68,0.08);
        border-color: rgba(239,68,68,0.5);
        transform: scale(0.99);
      }

      /* ── Theme toggle ─────────────────────────────────────────────── */
      .qs-theme-toggle-btn {
        background: var(--card-glass);
        border: 1px solid var(--border-glass);
        border-radius: 10px;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary);
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s, transform 0.12s;
        -webkit-tap-highlight-color: transparent;
      }
      .qs-theme-toggle-btn:active {
        background: var(--card-glass-hover);
        transform: translateY(1px);
      }

      /* ── Category rows ───────────────────────────────────────────── */
      .qs-cat-row {
        display: flex; align-items: center;
        padding: 10px 0;
        gap: 10px;
        border-bottom: 1px solid var(--border-subtle);
        transition: background 0.12s;
      }
      .qs-cat-row:last-child { border-bottom: none; }
      .qs-cat-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--accent-primary);
        flex-shrink: 0;
      }
      .qs-cat-name {
        flex: 1;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .qs-cat-edit-input {
        flex: 1; font-size: 14px; font-weight: 600;
        background: var(--bg-glass) !important;
        border: 1.5px solid var(--accent-primary) !important;
        border-radius: 8px; padding: 5px 10px;
        color: var(--text-primary) !important;
        outline: none; font-family: inherit;
      }
      .qs-cat-icon-btn {
        background: transparent; border: 0;
        padding: 5px 8px; border-radius: 8px;
        font-size: 14px; cursor: pointer;
        color: var(--text-muted);
        transition: color 0.15s, background 0.15s;
      }
      .qs-cat-icon-btn:active { background: var(--card-glass-hover); }
      .qs-cat-icon-btn.danger:active { color: #ef4444; }
      .qs-cat-save-btn {
        background: var(--accent-primary); border: 0;
        padding: 5px 12px; border-radius: 8px;
        font-size: 12px; font-weight: 700;
        color: #fff; cursor: pointer;
        transition: background 0.15s;
      }
      .qs-cat-save-btn:active { background: var(--accent-primary-hover); }
      .qs-cat-cancel-btn {
        background: transparent;
        border: 1px solid var(--border-glass);
        padding: 5px 10px; border-radius: 8px;
        font-size: 12px; font-weight: 600;
        color: var(--text-muted); cursor: pointer;
      }
      .qs-add-cat-row {
        display: flex; gap: 8px; align-items: center;
        padding-top: 12px;
        border-top: 1px solid var(--border-subtle);
        margin-top: 4px;
      }
      .qs-add-cat-input {
        flex: 1; font-size: 13.5px;
        background: var(--bg-glass) !important;
        border: 1.5px solid var(--border-glass);
        border-radius: 10px; padding: 9px 12px;
        color: var(--text-primary) !important;
        outline: none; font-family: inherit;
        transition: border-color 0.18s, box-shadow 0.18s;
      }
      .qs-add-cat-input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 3px rgba(99,102,241,0.14);
      }
      .qs-add-cat-btn {
        background: var(--accent-primary); border: 0;
        padding: 9px 16px; border-radius: 10px;
        font-size: 13px; font-weight: 700;
        color: #fff; cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, transform 0.12s;
      }
      .qs-add-cat-btn:active {
        background: var(--accent-primary-hover);
        transform: translateY(1px);
      }

      /* ── Store sector pill selector ───────────────────────────────── */
      .qs-sector-pill {
        background: var(--bg-glass);
        border: 1.5px solid var(--border-glass);
        border-radius: 20px;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        padding: 6px 14px;
        cursor: pointer;
        transition: background 0.14s, border-color 0.14s, color 0.14s;
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
      }
      .qs-sector-pill:active {
        transform: translateY(1px);
      }
      .qs-sector-pill--active {
        background: rgba(16,185,129,0.14);
        border-color: rgba(16,185,129,0.5);
        color: #10b981;
      }

      /* ── Sign out section spacer ─────────────────────────────────── */
      .qs-signout-wrap {
        padding: 4px 0 8px;
      }
    `;
    document.head.appendChild(s);
  })();

  function renderSettingsPanel() {
    try {
    let user = currentUser;

    // ── Offline cache fallback ───────────────────────────────────────────
    // When the device is offline, onAuthStateChange may not fire and
    // currentUser stays null. Read the slim identity written to localStorage
    // by the last successful handleAuthUser call so Settings renders fully
    // instead of showing "Loading account…" indefinitely.
    if (!user) {
      try {
        const _raw = localStorage.getItem('qs_user_cache');
        if (_raw) {
          const _cached = JSON.parse(_raw);
          if (_cached && _cached.id) user = _cached;
        }
      } catch(_) {}
    }

    if (!user) {
      // Truly no user — first boot, never logged in, or cache cleared.
      const sp = $('settingsPanel');
      if (sp && !sp.querySelector('#qs-sticky-profile')) {
        sp.innerHTML = '<div style="padding:40px 16px;text-align:center;' +
          'color:var(--text-muted);font-size:13px;">Loading account…</div>';
      }
      return;
    }

    const meta = user.user_metadata || {};
    const businessName = meta.business_name || '';
    const fullName = meta.full_name || '';
    const email = user.email || '';
    const initials = (businessName || fullName || email).slice(0,2).toUpperCase();

    const settingsPanel = $('settingsPanel');
    if (!settingsPanel) return;
    settingsPanel.style.background = '';

    // Load avatar + tagline from DB (non-blocking)
    getUserProfile(user.id).then(function(profile) {
      if (!profile) return;
      if (profile.avatar_url && !state._avatarUrl) {
        // Validate https:// scheme before storing or injecting into DOM.
        // escapeHtml() alone does not block javascript: URIs as attribute values.
        // This mirrors the safeImgSrc() pattern in catalog.js.
        const safeAvatarFromDb = (typeof profile.avatar_url === 'string' &&
          profile.avatar_url.startsWith('https://')) ? profile.avatar_url : '';
        if (safeAvatarFromDb) {
          state._avatarUrl = safeAvatarFromDb;
          const avatarEl = settingsPanel.querySelector('#qs-avatar-btn');
          if (avatarEl) {
            avatarEl.innerHTML = `<img src="${escapeHtml(safeAvatarFromDb)}" alt="Profile photo"><div class="qs-sp-cam" aria-hidden="true">📷</div>`;
          }
        }
      }
      // Pre-fill tagline textarea with existing value
      const taglineInput = settingsPanel.querySelector('#qs-tagline-input');
      if (taglineInput && profile.tagline) taglineInput.value = profile.tagline;
      // Pre-fill location
      const locationInput = settingsPanel.querySelector('#qs-location-input');
      if (locationInput && profile.location) locationInput.value = profile.location;
      // Pre-fill delivery radio
      if (typeof profile.delivery_available === 'boolean') {
        const radioId = profile.delivery_available ? '#qs-delivery-yes' : '#qs-delivery-no';
        const radio = settingsPanel.querySelector(radioId);
        if (radio) radio.checked = true;
      }
      // Pre-fill store sector pill selector
      if (profile.store_sector) {
        const activePill = settingsPanel.querySelector(
          '.qs-sector-pill[data-sector="' + escapeHtml(profile.store_sector) + '"]'
        );
        if (activePill) {
          settingsPanel.querySelectorAll('.qs-sector-pill').forEach(function(p) {
            p.classList.remove('qs-sector-pill--active');
            p.setAttribute('aria-pressed', 'false');
          });
          activePill.classList.add('qs-sector-pill--active');
          activePill.setAttribute('aria-pressed', 'true');
        }
      }
    }).catch(function() {});

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    settingsPanel.innerHTML = `

      <!-- ── Sticky profile header ───────────────────────────────── -->
      <div class="qs-sticky-profile" id="qs-sticky-profile">
        <div class="qs-sp-avatar" id="qs-avatar-btn" tabindex="0" role="button"
             aria-label="Change profile photo">
          ${state._avatarUrl
            ? `<img src="${escapeHtml(state._avatarUrl)}" alt="Profile photo">`
            : escapeHtml(initials)}
          <div class="qs-sp-cam" aria-hidden="true">📷</div>
        </div>
        <input type="file" id="qs-avatar-input" accept="image/jpeg,image/png,image/webp"
               style="display:none" aria-hidden="true">
        <div class="qs-sp-info">
          <div class="qs-sp-name">${escapeHtml(businessName || fullName || email)}</div>
          ${(businessName && fullName && fullName !== businessName)
            ? `<div class="qs-sp-email">${escapeHtml(fullName)}</div>`
            : ''}
          <div class="qs-sp-email">${escapeHtml(email)}</div>
        </div>
        <div class="qs-sp-badge online" id="qs-sp-status-badge">
          <span class="qs-sp-dot"></span>
          <span class="qs-sp-badge-text">Online</span>
        </div>
      </div>

      <!-- ── Scrollable settings body ─────────────────────────────── -->
      <div class="qs-settings-body">

        <!-- ── Account & Store actions ────────────────────────────── -->
        <div>
          <div class="qs-s-section-title">Account &amp; Store</div>
          <div class="qs-s-section">
            <div class="qs-action-row">

              <!-- Edit Account row -->
              <button id="qs-btn-edit-account" class="qs-action-btn" aria-expanded="false">
                <div class="qs-row-icon">✏️</div>
                <div class="qs-action-label">
                  <div>Edit Account</div>
                  <div class="qs-action-sub">Name, business name</div>
                </div>
                <div class="qs-row-chevron">
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                    <path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6"
                          stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>

              <!-- Edit Account drawer -->
              <div id="qs-drawer-account" class="qs-drawer" aria-hidden="true">
                <div class="qs-drawer-inner">
                  <div class="qs-drawer-content">
                    <div>
                      <div class="qs-field-label">Full Name</div>
                      <input id="qs-account-name" class="qs-input" type="text" maxlength="80"
                        placeholder="Your full name"
                        value="${escapeHtml(fullName)}" />
                    </div>
                    <div>
                      <div class="qs-field-label">Business Name</div>
                      <div class="qs-field-sub">Shown on your catalog header and share link</div>
                      <input id="qs-account-business" class="qs-input" type="text" maxlength="80"
                        placeholder="Your store or business name"
                        value="${escapeHtml(businessName)}" />
                    </div>
                    <button id="qs-account-save" class="qs-save-btn">Save Changes</button>
                  </div>
                </div>
              </div>

              <!-- Edit Store row -->
              <button id="qs-btn-edit-store" class="qs-action-btn" aria-expanded="false">
                <div class="qs-row-icon">🏪</div>
                <div class="qs-action-label">
                  <div>Edit Store</div>
                  <div class="qs-action-sub">Tagline, location, delivery</div>
                </div>
                <div class="qs-row-chevron">
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                    <path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6"
                          stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>

              <!-- Edit Store drawer -->
              <div id="qs-drawer-store" class="qs-drawer" aria-hidden="true">
                <div class="qs-drawer-inner">
                  <div class="qs-drawer-content">
                    <div>
                      <div class="qs-field-label">Store Tagline</div>
                      <div class="qs-field-sub">Shown on your catalog — max 120 characters</div>
                      <textarea id="qs-tagline-input" class="qs-input qs-textarea"
                        maxlength="120" rows="2"
                        placeholder="e.g. Get confidence in a bottle from ALL'S Signature"></textarea>
                    </div>
                    <button id="qs-tagline-save" class="qs-save-btn">Save Tagline</button>
                    <div class="qs-drawer-divider"></div>
                    <div>
                      <div class="qs-field-label">Location</div>
                      <div class="qs-field-sub">City or area shown on your catalog — e.g. Lagos, Abuja, Ibadan</div>
                      <input id="qs-location-input" class="qs-input" type="text" maxlength="80"
                        placeholder="e.g. Lagos Island, Lagos" />
                    </div>
                    <div style="margin-top:14px;">
                      <div class="qs-field-label">Delivery Available?</div>
                      <div class="qs-field-sub">Customers will see this on your catalog as a trust signal</div>
                      <div style="display:flex;gap:10px;margin-top:8px;">
                        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
                          <input type="radio" id="qs-delivery-yes" name="qs-delivery" value="yes"
                                 style="accent-color:var(--accent-primary);width:16px;height:16px;" />
                          🚚 Yes, I deliver
                        </label>
                        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
                          <input type="radio" id="qs-delivery-no" name="qs-delivery" value="no"
                                 style="accent-color:var(--accent-primary);width:16px;height:16px;" />
                          🏪 Pickup only
                        </label>
                      </div>
                    </div>
                    <button id="qs-store-info-save" class="qs-save-btn" style="margin-top:16px;">Save Location &amp; Delivery</button>
                    <div class="qs-drawer-divider"></div>
                    <div>
                      <div class="qs-field-label" style="margin-bottom:4px;">Store Sector</div>
                      <div class="qs-field-sub">This tells buyers what kind of store you run. It shows you in the right section of the QuickShop marketplace.</div>
                      <div id="qs-sector-pills" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;" role="group" aria-label="Store sector">
                        <button type="button" class="qs-sector-pill" data-sector="Fragrance" aria-pressed="false">Fragrance</button>
                        <button type="button" class="qs-sector-pill" data-sector="Fashion" aria-pressed="false">Fashion</button>
                        <button type="button" class="qs-sector-pill" data-sector="Shoes" aria-pressed="false">Shoes</button>
                        <button type="button" class="qs-sector-pill" data-sector="Bags" aria-pressed="false">Bags</button>
                        <button type="button" class="qs-sector-pill" data-sector="Beauty" aria-pressed="false">Beauty</button>
                        <button type="button" class="qs-sector-pill" data-sector="Electronics" aria-pressed="false">Electronics</button>
                        <button type="button" class="qs-sector-pill" data-sector="Food" aria-pressed="false">Food</button>
                        <button type="button" class="qs-sector-pill" data-sector="Home" aria-pressed="false">Home</button>
                      </div>
                      <button id="qs-sector-save" class="qs-save-btn" style="margin-top:14px;">Save Sector</button>
                    </div>
                    <div class="qs-drawer-divider"></div>
                    <div>
                      <div class="qs-field-label" style="margin-bottom:10px;">Categories</div>
                      <div id="qs-cat-list"></div>
                      <div class="qs-add-cat-row">
                        <input id="newCategoryName" class="qs-add-cat-input"
                               type="text" placeholder="New category name…" />
                        <button id="addCategoryBtn" class="qs-add-cat-btn">+ Add</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Share Catalog row -->
              <button id="qs-action-share" class="qs-action-btn qs-action-share-btn" type="button"
                aria-label="Share your catalog to WhatsApp">
                <div class="qs-row-icon">📤</div>
                <div class="qs-action-label">
                  <div>Share Catalog</div>
                  <div class="qs-action-sub">Send your store link to customers</div>
                </div>
                <div class="qs-row-chevron">
                  <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                    <path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6"
                          stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>

            </div>
          </div>
        </div>

        <!-- ── Appearance ──────────────────────────────────────────── -->
        <div>
          <div class="qs-s-section-title">Appearance</div>
          <div class="qs-s-section">
            <div class="qs-s-row">
              <div>
                <div class="qs-s-row-label">Theme</div>
                <div class="qs-s-row-sub qs-theme-sub">Currently ${currentTheme} mode</div>
              </div>
              <button class="qs-theme-toggle-btn" data-current="${currentTheme}">
                ${currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
            <div class="qs-s-row" id="qs-install-row">
              <div>
                <div class="qs-s-row-label">Install App</div>
                <div class="qs-s-row-sub" id="qs-install-sub">Add QuickShop to your home screen</div>
              </div>
              <button id="qs-install-btn" class="qs-ghost-btn"
                style="color:var(--accent-primary);border-color:rgba(99,102,241,0.3);">
                📲 Install
              </button>
            </div>
          </div>
        </div>

        <!-- ── Store Data ──────────────────────────────────────────── -->
        <div>
          <div class="qs-s-section-title">Store Data</div>
          <div class="qs-s-section">
            <div class="qs-s-row">
              <div>
                <div class="qs-s-row-label">Sync to Cloud</div>
                <div class="qs-s-row-sub">Push all local products to Supabase now</div>
              </div>
              <button id="btnSyncNow" class="qs-ghost-btn"
                style="color:#10b981;border-color:rgba(16,185,129,0.3);">☁️ Sync</button>
            </div>
            <div class="qs-s-row">
              <div>
                <div class="qs-s-row-label">Demo Products</div>
                <div class="qs-s-row-sub">Load 4 sample products to explore the app</div>
              </div>
              <button id="btnLoadDemo" class="qs-ghost-btn">Load Demo</button>
            </div>
            <div class="qs-s-row">
              <div>
                <div class="qs-s-row-label">Clear All Data</div>
                <div class="qs-s-row-sub">Permanently delete all products and sales</div>
              </div>
              <button id="btnClearStore" class="qs-ghost-btn"
                style="color:#ef4444;border-color:rgba(239,68,68,0.25);">Clear</button>
            </div>
          </div>
        </div>

        <!-- ── Activity Log ────────────────────────────────────────── -->
        <div class="qs-s-section">
          <div id="activityLogArea"></div>
        </div>

        <!-- ── Referral Programme ──────────────────────────────────── -->
        <div>
          <div class="qs-s-section-title">Referral Programme</div>
          <div class="qs-s-section" id="qs-referral-section">
            <div id="qs-referral-body" style="padding:16px;">
              <div style="color:var(--text-muted);font-size:13px;">Loading…</div>
            </div>
          </div>
        </div>

        <!-- ── About ──────────────────────────────────────────────── -->
        <div>
          <div class="qs-s-section-title">More</div>
          <div class="qs-s-section">
            <button id="qs-about-btn" class="qs-action-btn"
              style="border-bottom:none;"
              aria-label="About QuickShop">
              <div class="qs-row-icon">⚡</div>
              <div class="qs-action-label">
                <div>About QuickShop</div>
                <div class="qs-action-sub">Version 2.5 · Built for traders</div>
              </div>
              <div class="qs-row-chevron">
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                  <path d="M1 1l5 5-5 5" stroke="currentColor" stroke-width="1.6"
                        stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </button>
          </div>
        </div>

        <!-- ── Sign Out ────────────────────────────────────────────── -->
        <div class="qs-signout-wrap">
          <button id="btnLogout" class="qs-danger-btn">Sign Out</button>
        </div>

      </div><!-- /.qs-settings-body -->

    `;

    // Wire avatar upload
    const avatarBtn   = settingsPanel.querySelector('#qs-avatar-btn');
    const avatarInput = settingsPanel.querySelector('#qs-avatar-input');
    if (avatarBtn && avatarInput) {
      avatarBtn.addEventListener('click', () => avatarInput.click());
      avatarBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatarInput.click(); } });
      avatarInput.addEventListener('change', async function () {
        const file = this.files && this.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { toast('Image too large (max 5 MB)', 'error'); return; }
        const sb = getClient();
        const u  = getUser();
        if (!sb || !u) { toast('Not logged in', 'error'); return; }
        avatarBtn.classList.add('qs-sp-uploading');
        showLoading(true, 'Uploading photo…');
        try {
          const blob     = await compressImage(file, 400, 0.85);
          const fileName = u.id + '/avatar_' + Date.now() + '.jpg';
          const { error: upErr } = await sb.storage.from('user_images').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
          if (upErr) throw upErr;
          const { data: urlData } = sb.storage.from('user_images').getPublicUrl(fileName);
          const avatarUrl = urlData.publicUrl;
          const safeAvatarUrl = (typeof avatarUrl === 'string' && avatarUrl.startsWith('https://')) ? avatarUrl : '';
          if (!safeAvatarUrl) throw new Error('Avatar URL is not a valid https URL');
          await setUserProfile(u.id, {
            name: u.user_metadata?.full_name || '',
            businessName: u.user_metadata?.business_name || '',
            email: u.email || '',
            createdAt: Date.now(),
            avatarUrl: safeAvatarUrl
          });
          state._avatarUrl = safeAvatarUrl;
          const imgEl = avatarBtn.querySelector('img');
          if (imgEl) {
            imgEl.src = safeAvatarUrl;
          } else {
            avatarBtn.innerHTML = `<img src="${escapeHtml(safeAvatarUrl)}" alt="Profile photo"><div class="qs-sp-cam" aria-hidden="true">📷</div>`;
          }
          toast('Profile photo updated ✓');
        } catch (err) {
          errlog('Avatar upload failed', err);
          toast('Upload failed: ' + (err.message || 'unknown'), 'error');
        } finally {
          avatarBtn.classList.remove('qs-sp-uploading');
          showLoading(false);
          avatarInput.value = '';
        }
      });
    }

    // Wire theme toggle
    settingsPanel.querySelectorAll('.qs-theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', toggleTheme);
    });

    // ── Drawer toggle helper ──────────────────────────────────────────────
    // Only one drawer open at a time — opening one closes the other.
    function toggleDrawer(drawerId, btnId) {
      const drawer  = settingsPanel.querySelector('#' + drawerId);
      const btn     = settingsPanel.querySelector('#' + btnId);
      const otherDrawerIds = ['qs-drawer-account', 'qs-drawer-store'].filter(id => id !== drawerId);
      if (!drawer || !btn) return;
      const isOpen = drawer.classList.contains('open');
      // Close all drawers first
      otherDrawerIds.forEach(id => {
        const d = settingsPanel.querySelector('#' + id);
        const otherId = id === 'qs-drawer-account' ? 'qs-btn-edit-account' : 'qs-btn-edit-store';
        const b = settingsPanel.querySelector('#' + otherId);
        if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      // Toggle target
      if (isOpen) {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
      }
    }

    // Wire Edit Account button
    const editAccountBtn = settingsPanel.querySelector('#qs-btn-edit-account');
    if (editAccountBtn) {
      editAccountBtn.addEventListener('click', function () {
        toggleDrawer('qs-drawer-account', 'qs-btn-edit-account');
      });
    }

    // Wire Edit Store button
    const editStoreBtn = settingsPanel.querySelector('#qs-btn-edit-store');
    if (editStoreBtn) {
      editStoreBtn.addEventListener('click', function () {
        toggleDrawer('qs-drawer-store', 'qs-btn-edit-store');
      });
    }

    // Wire tagline save
    const taglineSaveBtn = settingsPanel.querySelector('#qs-tagline-save');
    if (taglineSaveBtn) {
      taglineSaveBtn.addEventListener('click', async function () {
        const taglineInput = settingsPanel.querySelector('#qs-tagline-input');
        const tagline = (taglineInput ? taglineInput.value : '').trim().slice(0, 120);
        const u = getUser();
        const sb = getClient();
        if (!u || !sb) { toast('Not logged in', 'error'); return; }
        taglineSaveBtn.disabled = true;
        taglineSaveBtn.textContent = 'Saving…';
        try {
          const { error } = await sb.from('profiles')
            .update({ tagline: tagline || null })
            .eq('id', u.id);
          if (error) throw error;
          toast('Tagline saved ✓');
        } catch (e) {
          errlog('tagline save', e);
          toast('Failed to save tagline', 'error');
        } finally {
          taglineSaveBtn.disabled = false;
          taglineSaveBtn.textContent = 'Save Tagline';
        }
      });
    }

    // Wire location + delivery save
    const storeInfoSaveBtn = settingsPanel.querySelector('#qs-store-info-save');
    if (storeInfoSaveBtn) {
      storeInfoSaveBtn.addEventListener('click', async function () {
        const locationInput = settingsPanel.querySelector('#qs-location-input');
        const deliveryYes   = settingsPanel.querySelector('#qs-delivery-yes');
        const deliveryNo    = settingsPanel.querySelector('#qs-delivery-no');
        const newLocation   = (locationInput ? locationInput.value : '').trim().slice(0, 80);
        // delivery_available: true if Yes checked, false if No checked, null if neither
        var deliveryAvailable = null;
        if (deliveryYes && deliveryYes.checked) deliveryAvailable = true;
        else if (deliveryNo && deliveryNo.checked) deliveryAvailable = false;
        const u  = getUser();
        const sb = getClient();
        if (!u || !sb) { toast('Not logged in', 'error'); return; }
        storeInfoSaveBtn.disabled = true;
        storeInfoSaveBtn.textContent = 'Saving…';
        try {
          const updatePayload = { location: newLocation || null };
          if (deliveryAvailable !== null) updatePayload.delivery_available = deliveryAvailable;
          const { error } = await sb.from('profiles')
            .update(updatePayload)
            .eq('id', u.id);
          if (error) throw error;
          toast('Location & delivery saved ✓');
        } catch (e) {
          errlog('store info save', e);
          toast('Failed to save: ' + (e.message || 'unknown error'), 'error');
        } finally {
          storeInfoSaveBtn.disabled = false;
          storeInfoSaveBtn.textContent = 'Save Location & Delivery';
        }
      });
    }

    // Wire sector pill toggle
    const sectorPillsContainer = settingsPanel.querySelector('#qs-sector-pills');
    if (sectorPillsContainer) {
      sectorPillsContainer.addEventListener('click', function (e) {
        const pill = e.target.closest('.qs-sector-pill');
        if (!pill) return;
        const alreadyActive = pill.classList.contains('qs-sector-pill--active');
        settingsPanel.querySelectorAll('.qs-sector-pill').forEach(function (p) {
          p.classList.remove('qs-sector-pill--active');
          p.setAttribute('aria-pressed', 'false');
        });
        if (!alreadyActive) {
          pill.classList.add('qs-sector-pill--active');
          pill.setAttribute('aria-pressed', 'true');
        }
      });
    }

    // Wire sector save
    const sectorSaveBtn = settingsPanel.querySelector('#qs-sector-save');
    if (sectorSaveBtn) {
      sectorSaveBtn.addEventListener('click', async function () {
        const activePill = settingsPanel.querySelector('.qs-sector-pill--active');
        const sector = activePill ? activePill.dataset.sector : null;
        const u  = getUser();
        const sb = getClient();
        if (!u || !sb) { toast('Not logged in', 'error'); return; }
        sectorSaveBtn.disabled = true;
        sectorSaveBtn.textContent = 'Saving…';
        try {
          const { error } = await sb.from('profiles')
            .update({ store_sector: sector || null })
            .eq('id', u.id);
          if (error) throw error;
          toast('Store sector saved ✓');
        } catch (e) {
          errlog('sector save', e);
          toast('Failed to save sector: ' + (e.message || 'unknown error'), 'error');
        } finally {
          sectorSaveBtn.disabled = false;
          sectorSaveBtn.textContent = 'Save Sector';
        }
      });
    }

    // Wire account details save
    const accountSaveBtn = settingsPanel.querySelector('#qs-account-save');
    if (accountSaveBtn) {
      accountSaveBtn.addEventListener('click', async function () {
        const nameInput     = settingsPanel.querySelector('#qs-account-name');
        const businessInput = settingsPanel.querySelector('#qs-account-business');
        const newName     = (nameInput     ? nameInput.value     : '').trim().slice(0, 80);
        const newBusiness = (businessInput ? businessInput.value : '').trim().slice(0, 80);
        const u  = getUser();
        const sb = getClient();
        if (!u || !sb) { toast('Not logged in', 'error'); return; }
        if (!newName && !newBusiness) {
          toast('Please enter at least a name or business name', 'error');
          return;
        }
        accountSaveBtn.disabled = true;
        accountSaveBtn.textContent = 'Saving…';
        try {
          const { data: authData, error: authErr } = await sb.auth.updateUser({
            data: { full_name: newName || null, business_name: newBusiness || null }
          });
          if (authErr) throw authErr;
          await setUserProfile(u.id, {
            name: newName || '', businessName: newBusiness || '',
            email: u.email || '', createdAt: Date.now(),
          });
          const oldBusiness = (u.user_metadata && u.user_metadata.business_name) || '';
          if (newBusiness && newBusiness !== oldBusiness) {
            await sb.from('profiles').update({ slug: null }).eq('id', u.id);
          }
          if (authData && authData.user) currentUser = authData.user;
          toast('Account updated ✓', 'success');
          renderSettingsPanel();
        } catch (e) {
          errlog('account save', e);
          toast('Failed to save: ' + (e.message || 'unknown error'), 'error');
        } finally {
          accountSaveBtn.disabled = false;
          accountSaveBtn.textContent = 'Save Changes';
        }
      });
    }

    // Wire About button → overlay
    // Overlay is built once on document.body so position:fixed is never
    // broken by a CSS transform on a parent (.panel.active has panelEnter
    // animation which previously created a stacking context and trapped
    // the fixed overlay inside the panel bounds).
    const aboutBtn = settingsPanel.querySelector('#qs-about-btn');

    function buildAboutOverlay() {
      const existing = document.getElementById('qs-about-overlay');
      if (existing) return existing;

      const ov = document.createElement('div');
      ov.id = 'qs-about-overlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9999;' +
        'background:var(--bg-obsidian);' +
        'transform:translateY(100%);' +
        'transition:transform .32s cubic-bezier(.16,1,.3,1);' +
        'display:flex;flex-direction:column;overflow:hidden;';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 16px;' +
        'border-bottom:1px solid var(--border-glass);flex-shrink:0;';
      const backBtn = document.createElement('button');
      backBtn.id = 'qs-about-back';
      backBtn.type = 'button';
      backBtn.textContent = '\u2190 Back';
      backBtn.style.cssText = 'background:var(--settings-row-icon-bg);border:1px solid var(--border-glass);border-radius:10px;' +
        'color:var(--text-primary);font-size:13px;font-weight:600;cursor:pointer;padding:7px 14px;' +
        '-webkit-tap-highlight-color:transparent;';
      backBtn.addEventListener('click', function () { ov.style.transform = 'translateY(100%)'; });
      const hdrTitle = document.createElement('span');
      hdrTitle.style.cssText = 'font-size:15px;font-weight:700;color:var(--text-primary);';
      hdrTitle.textContent = 'About';
      hdr.appendChild(backBtn);
      hdr.appendChild(hdrTitle);
      ov.appendChild(hdr);

      const body = document.createElement('div');
      body.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:32px 24px 40px;';

      // Hero — all hardcoded copy, no user data
      const hero = document.createElement('div');
      hero.style.cssText = 'text-align:center;margin-bottom:28px;';
      const bolt = document.createElement('div');
      bolt.style.cssText = 'font-size:52px;margin-bottom:10px;';
      bolt.textContent = '\u26A1';
      const appName = document.createElement('div');
      appName.style.cssText = 'font-size:26px;font-weight:900;color:var(--text-primary);letter-spacing:-.5px;margin-bottom:4px;';
      appName.textContent = 'QuickShop';
      const ver = document.createElement('div');
      ver.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:600;letter-spacing:.4px;text-transform:uppercase;';
      ver.textContent = 'Version 2.5';
      hero.appendChild(bolt); hero.appendChild(appName); hero.appendChild(ver);
      body.appendChild(hero);

      const tag = document.createElement('div');
      tag.style.cssText = 'font-size:15px;line-height:1.75;color:var(--text-secondary);margin-bottom:24px;text-align:center;';
      tag.textContent = 'Your shop. Your profits. In your pocket.';
      body.appendChild(tag);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:13.5px;line-height:1.8;color:var(--text-muted);margin-bottom:32px;';
      desc.textContent = 'Built for traders who work in the real world \u2014 market sellers, boutique owners, ' +
        'fragrance vendors. Manage your stock, record your sales, and share a catalog ' +
        'your customers can order from directly on WhatsApp. ' +
        'Works offline. No app install needed. No subscription required.';
      body.appendChild(desc);

      const sup = document.createElement('div');
      sup.style.cssText = 'border-top:1px solid var(--border-glass);padding-top:24px;margin-bottom:24px;';
      const supLabel = document.createElement('div');
      supLabel.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px;';
      supLabel.textContent = 'Support';
      sup.appendChild(supLabel);

      const contactBtn = document.createElement('button');
      contactBtn.id = 'qs-contact-dev-btn';
      contactBtn.type = 'button';
      contactBtn.style.cssText = 'width:100%;display:flex;align-items:center;gap:14px;' +
        'background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.25);' +
        'border-radius:14px;padding:14px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:left;';
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:24px;flex-shrink:0;';
      icon.textContent = '\uD83D\uDCAC'; // 💬
      const ctxt = document.createElement('div');
      const ctitle = document.createElement('div');
      ctitle.style.cssText = 'font-size:14px;font-weight:700;color:#25d366;margin-bottom:2px;';
      ctitle.textContent = 'Contact Developer';
      const csub = document.createElement('div');
      csub.style.cssText = 'font-size:12px;color:var(--text-muted);line-height:1.5;';
      csub.textContent = 'WhatsApp Moses directly for support, feedback, or questions';
      ctxt.appendChild(ctitle); ctxt.appendChild(csub);
      contactBtn.appendChild(icon); contactBtn.appendChild(ctxt);
      contactBtn.addEventListener('click', function () {
        const msg = encodeURIComponent(
          'Hello Moses,' +
          '\n\nI am a QuickShop vendor reaching out for support.' +
          '\n\nMy name: \nMy store: \nIssue / feedback: ' +
          '\n\nThank you.'
        );
        window.open('https://wa.me/2347035023138?text=' + msg, '_blank', 'noopener,noreferrer');
      });
      sup.appendChild(contactBtn);
      body.appendChild(sup);

      const footer = document.createElement('div');
      footer.style.cssText = 'border-top:1px solid var(--border-glass);padding-top:20px;text-align:center;';
      const fcopy = document.createElement('div');
      fcopy.style.cssText = 'font-size:12px;color:var(--text-muted);line-height:1.8;';
      fcopy.textContent = '\u00A9 2026 Moses Olayinka Ogundahunsi';
      const flink = document.createElement('div');
      flink.style.cssText = 'color:var(--accent-primary);font-weight:600;';
      flink.textContent = 'quickshopper.vercel.app';
      footer.appendChild(fcopy); footer.appendChild(flink);
      body.appendChild(footer);
      ov.appendChild(body);

      document.body.appendChild(ov);
      return ov;
    }

    if (aboutBtn) {
      aboutBtn.addEventListener('click', function () {
        const ov = buildAboutOverlay();
        ov.style.transform = 'translateY(0)';
        const back = document.getElementById('qs-about-back');
        if (back) setTimeout(function() { back.focus(); }, 320);
      });
    }
    // Wire install button
    const installBtn = settingsPanel.querySelector('#qs-install-btn');
    const installSub = settingsPanel.querySelector('#qs-install-sub');
    if (installBtn) {
      function updateInstallBtn() {
        if (window.__QS_INSTALL_PROMPT) {
          installBtn.disabled = false;
          installBtn.style.opacity = '1';
          if (installSub) installSub.textContent = 'Add QuickShop to your home screen';
        } else {
          installBtn.disabled = false;
          installBtn.style.opacity = '0.6';
          if (installSub) installSub.textContent = 'Use browser menu → Add to Home Screen';
        }
      }
      updateInstallBtn();
      window.addEventListener('beforeinstallprompt', updateInstallBtn);
      installBtn.addEventListener('click', async function () {
        const prompt = window.__QS_INSTALL_PROMPT;
        if (!prompt) {
          toast('Tap your browser menu → "Add to Home Screen"', 'info', 4000);
          return;
        }
        try {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === 'accepted') {
            window.__QS_INSTALL_PROMPT = null;
            toast('QuickShop installed ✓', 'success');
            renderSettingsPanel();
          }
        } catch (e) { errlog('install prompt failed', e); }
      });
    }

    // Wire demo / clear / logout
    initDemoAndSettingsHandlers();

    // Render categories into the store drawer slot
    renderCategoryEditor();

    // ── Referral dashboard — async, non-blocking ──────────────────────────
    // Queries the referrals and payout_requests tables for the current user.
    // Computes totals from ledger rows — never from stored counters.
    // Renders into #qs-referral-body which is already in the DOM above.
    (async function renderReferralDashboard() {
      const _u  = getUser();
      const _sb = getClient();
      const _body = settingsPanel.querySelector('#qs-referral-body');
      if (!_u || !_sb || !_body) return;

      const MILESTONE = 10;
      const AMOUNT_PER = 500;

      try {
        // Fetch referrals + pending payout requests in parallel
        const [refResult, payResult] = await Promise.all([
          _sb.from('referrals')
            .select('id, status, created_at')
            .eq('referrer_id', _u.id),
          _sb.from('payout_requests')
            .select('id, status')
            .eq('user_id', _u.id)
            .eq('status', 'pending')
        ]);

        const rows       = refResult.data  || [];
        const pendingPay = payResult.data  || [];

        const earned = rows.filter(r => r.status === 'earned').length;
        const paid   = rows.filter(r => r.status === 'paid').length;
        const total  = rows.length;

        const earningsNgn  = earned * AMOUNT_PER;
        const hasPending   = pendingPay.length > 0;
        const canRequest   = total >= MILESTONE && !hasPending;

        // Build UI — Obsidian Glass style, dark, 16px radius, glassmorphism
        _body.innerHTML = '';

        // Stats row
        const stats = document.createElement('div');
        stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;';

        function statCard(label, value, accent) {
          const c = document.createElement('div');
          c.style.cssText = [
            'background:var(--card-glass);',
            'border:1px solid var(--border-glass);',
            'border-radius:16px;padding:14px 16px;',
          ].join('');
          const v = document.createElement('div');
          v.style.cssText = 'font-size:22px;font-weight:800;color:' + accent + ';letter-spacing:-0.5px;margin-bottom:3px;';
          v.textContent = value;
          const l = document.createElement('div');
          l.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;';
          l.textContent = label;
          c.appendChild(v);
          c.appendChild(l);
          return c;
        }

        stats.appendChild(statCard('Referrals', total + ' / ' + MILESTONE, '#a78bfa'));
        stats.appendChild(statCard('Earnings',  '₦' + earningsNgn.toLocaleString('en-NG'), '#10b981'));
        _body.appendChild(stats);

        // Progress bar toward milestone
        const progressWrap = document.createElement('div');
        progressWrap.style.cssText = 'margin-bottom:14px;';
        const progressLbl = document.createElement('div');
        progressLbl.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;';
        const progressLeft = document.createElement('span');
        progressLeft.textContent = total >= MILESTONE
          ? '🎉 Milestone reached!'
          : (MILESTONE - total) + ' more referral' + (MILESTONE - total === 1 ? '' : 's') + ' to unlock payout';
        const progressRight = document.createElement('span');
        progressRight.textContent = total + ' / ' + MILESTONE;
        progressLbl.appendChild(progressLeft);
        progressLbl.appendChild(progressRight);

        const track = document.createElement('div');
        track.style.cssText = 'height:6px;background:var(--border-glass);border-radius:99px;overflow:hidden;';
        const fill = document.createElement('div');
        const fillPct = Math.min(100, Math.round((total / MILESTONE) * 100));
        fill.style.cssText = 'height:100%;width:' + fillPct + '%;border-radius:99px;background:linear-gradient(90deg,#7c3aed,#a78bfa);transition:width 0.4s ease;';
        track.appendChild(fill);
        progressWrap.appendChild(progressLbl);
        progressWrap.appendChild(track);
        _body.appendChild(progressWrap);

        // Referral link row — shows their unique referral URL
        const linkRow = document.createElement('div');
        linkRow.style.cssText = [
          'background:rgba(99,102,241,0.07);',
          'border:1px solid rgba(99,102,241,0.18);',
          'border-radius:12px;padding:12px 14px;',
          'margin-bottom:14px;',
        ].join('');
        const linkLabel = document.createElement('div');
        linkLabel.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
        linkLabel.textContent = 'Your Referral Link';
        const linkVal = document.createElement('div');
        linkVal.style.cssText = 'font-size:12px;color:#a78bfa;word-break:break-all;line-height:1.5;cursor:pointer;';
        const refUrl = window.location.origin + '/?ref=' + encodeURIComponent(_u.id);
        linkVal.textContent = refUrl;
        linkVal.title = 'Tap to copy';
        linkVal.addEventListener('click', function () {
          try {
            navigator.clipboard.writeText(refUrl).then(function () {
              toast('Referral link copied ✓', 'success');
            }).catch(function () {
              toast('Copy failed — long-press to copy manually', 'error');
            });
          } catch (_) { toast('Copy failed — long-press to copy manually', 'error'); }
        });
        linkRow.appendChild(linkLabel);
        linkRow.appendChild(linkVal);
        _body.appendChild(linkRow);

        // Payout button
        const payBtn = document.createElement('button');
        payBtn.type = 'button';
        payBtn.style.cssText = [
          'width:100%;padding:13px;border-radius:16px;border:0;',
          'font-size:14px;font-weight:700;cursor:pointer;',
          'transition:opacity 0.2s,transform 0.1s;',
          canRequest
            ? 'background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;box-shadow:0 6px 20px rgba(124,58,237,0.3);'
            : 'background:var(--card-glass);color:var(--text-muted);cursor:not-allowed;border:1px solid var(--border-glass);',
        ].join('');

        if (hasPending) {
          payBtn.textContent = '⏳ Payout Request Pending';
          payBtn.disabled = true;
        } else if (total < MILESTONE) {
          payBtn.textContent = 'Request Payout (need ' + MILESTONE + ' referrals)';
          payBtn.disabled = true;
        } else {
          payBtn.textContent = '💸 Request Payout — ₦' + (earningsNgn).toLocaleString('en-NG');
          payBtn.disabled = false;
        }

        payBtn.addEventListener('click', async function () {
          if (!canRequest) return;
          payBtn.disabled = true;
          payBtn.textContent = 'Submitting…';
          try {
            // Anti-fraud: check for existing pending request server-side before inserting
            const { data: existingPending } = await _sb
              .from('payout_requests')
              .select('id')
              .eq('user_id', _u.id)
              .eq('status', 'pending');
            if (existingPending && existingPending.length > 0) {
              toast('You already have a pending payout request.', 'warning');
              payBtn.textContent = '⏳ Payout Request Pending';
              return;
            }
            const { error: insErr } = await _sb
              .from('payout_requests')
              .insert({ user_id: _u.id, status: 'pending' });
            if (insErr) throw insErr;
            toast('Payout requested ✓ We\'ll process it shortly.', 'success');
            payBtn.textContent = '⏳ Payout Request Pending';
            payBtn.disabled = true;
            payBtn.style.background = 'var(--card-glass)';
            payBtn.style.color = 'var(--text-muted)';
            payBtn.style.boxShadow = 'none';
            payBtn.style.border = '1px solid var(--border-glass)';
          } catch (e) {
            errlog('payout request failed', e);
            toast('Failed to submit request: ' + (e.message || 'unknown'), 'error');
            payBtn.disabled = false;
            payBtn.textContent = '💸 Request Payout — ₦' + earningsNgn.toLocaleString('en-NG');
          }
        });

        _body.appendChild(payBtn);

        // Sub-note
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px;color:var(--text-muted);text-align:center;margin-top:8px;line-height:1.5;';
        note.textContent = 'Share your referral link. Every vendor who signs up and gets activated earns you ₦500.';
        _body.appendChild(note);

      } catch (e) {
        errlog('renderReferralDashboard', e);
        if (_body) {
          _body.innerHTML = '';
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'font-size:12px;color:var(--text-muted);padding:8px 0;';
          errDiv.textContent = 'Could not load referral data. Check your connection.';
          _body.appendChild(errDiv);
        }
      }
    })();
    // ── End referral dashboard ────────────────────────────────────────────

    // Wire Share Catalog action button — calls share-catalog.js handleShareClick directly
    const actionShareBtn = settingsPanel.querySelector('#qs-action-share');
    if (actionShareBtn) {
      actionShareBtn.addEventListener('click', function () {
        // share-catalog.js exposes window.__QS_SHARE_CLICK for direct invocation
        if (typeof window.__QS_SHARE_CLICK === 'function') {
          window.__QS_SHARE_CLICK();
        } else if (typeof window.renderShareButton === 'function') {
          // Fallback: render the original button into a hidden container and click it
          const tmp = document.createElement('div');
          tmp.style.cssText = 'position:absolute;left:-9999px;pointer-events:none;';
          document.body.appendChild(tmp);
          window.renderShareButton(tmp);
          const btn = tmp.querySelector('button');
          if (btn) btn.click();
          setTimeout(function() { tmp.remove(); }, 5000);
        }
      });
    }

    // Load tagline into textarea (non-blocking)
    const u = getUser();
    if (u) {
      const taglineInput = settingsPanel.querySelector('#qs-tagline-input');
      if (taglineInput && !taglineInput.value) {
        getClient() && getClient().from('profiles')
          .select('tagline').eq('id', u.id).maybeSingle()
          .then(function(r) {
            if (r.data && r.data.tagline && taglineInput) {
              taglineInput.value = r.data.tagline;
            }
          }).catch(function(){});
      }
    }

    // ── Status badge: reflect real network state ──────────────────────
    function updateStatusBadge() {
      const badge = settingsPanel.querySelector('#qs-sp-status-badge');
      if (!badge) return;
      const txtEl = badge.querySelector('.qs-sp-badge-text');
      if (navigator.onLine) {
        badge.className = 'qs-sp-badge online';
        if (txtEl) txtEl.textContent = 'Online';
      } else {
        badge.className = 'qs-sp-badge offline';
        if (txtEl) txtEl.textContent = 'Offline';
      }
    }
    updateStatusBadge();
    // Store references so we can remove listeners if panel re-renders
    if (window._qsBadgeOnline)  window.removeEventListener('online',  window._qsBadgeOnline);
    if (window._qsBadgeOffline) window.removeEventListener('offline', window._qsBadgeOffline);
    window._qsBadgeOnline  = updateStatusBadge;
    window._qsBadgeOffline = updateStatusBadge;
    window.addEventListener('online',  window._qsBadgeOnline);
    window.addEventListener('offline', window._qsBadgeOffline);

    const btnLogout = $('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        const confirmed = await showConfirm({
          title: 'Sign Out',
          message: 'Are you sure you want to sign out?',
          okText: 'Sign Out',
          okDanger: true
        });
        if (!confirmed) return;
        try {
          const supabase = getClient();
          if (supabase) await supabase.auth.signOut();
          localStorage.removeItem('qs_session_active');
          document.body.classList.remove('mode-app');
          toast('Signed out');
          window.location.reload();
        } catch (err) {
          errlog('Logout error', err);
          toast('Sign out failed', 'error');
        }
      });
    }
    } catch(e) { errlog('renderSettingsPanel', e); const el=$('settingsPanel'); if(el){el.innerHTML='';const d=document.createElement('div');d.className='small';d.style.cssText='padding:20px;text-align:center;';d.textContent='Settings failed to load — pull to refresh.';el.appendChild(d);} }
  }




  // ═══════════════════════════════════════════════════════════════════════════
  // §17  APP BOOTSTRAP — initAppUI, boot sequence, visibility, back button
  // ═══════════════════════════════════════════════════════════════════════════
  function initAppUI() {
    try {
      renderChips(); renderProducts(); renderInventory(); renderDashboard(); renderNotes();
      if (!document.querySelector('.panel.active')) {
        // Restore the last active view from sessionStorage so a refresh
        // lands the vendor on the same panel they were on.
        // Fall back to 'home' if nothing is stored or the stored value is invalid.
        const _TAB_VALID = ['home', 'inventory', 'reports', 'notes', 'settings'];
        let restoredView = 'home';
        try {
          const saved = sessionStorage.getItem('qs_active_view');
          if (saved && _TAB_VALID.includes(saved)) restoredView = saved;
        } catch(_) {}
        setActiveView(restoredView, false);
        // Seed the history stack with the restored view so the back button
        // has at least one entry to pop before trying to exit.
        try { history.replaceState({ qsView: restoredView }, ''); } catch(_) {}
      }
      showLoading(false);
      const modalBackdrop = $('modalBackdrop');
      if (modalBackdrop) modalBackdrop.style.display = 'none';
      const barcodeScannerModal = $('barcodeScannerModal');
      if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
      const inventoryInsightView = $('inventoryInsightView');
      if (inventoryInsightView) inventoryInsightView.style.display = 'none';
      const smartScannerModal = $('smartScannerModal');
      if (smartScannerModal) smartScannerModal.style.display = 'none';
      const confirmModalBackdrop = $('confirmModalBackdrop');
      if (confirmModalBackdrop) confirmModalBackdrop.style.display = 'none';
      const fullAuditLogModal = $('fullAuditLogModal');
      if (fullAuditLogModal) fullAuditLogModal.style.display = 'none';
      // FIX 9: applyBottomPadding() call removed — CSS handles it now
    } catch (e) { errlog('initAppUI failed', e); }
  }

  loadLocalData(localStorage.getItem('qs_last_user_id') || null);
  if (localStorage.getItem('qs_session_active') === 'true') document.body.classList.add('mode-app');

  initThemeToggle();
  initPullToRefresh();
  initKeyboardDetection();
  initKeyboardShortcuts();
  initConfirmModal();
  initAuthHandlers();
  initOnlineOfflineHandlers();
  // inventory functions (scanner, form, image, list, CSV) now live in inventory.js
  // inventory.js calls initAll() after window.__QS_APP is ready
  initProductListHandlers();
  initModalHandlers();
  initAuditLogHandlers();
  initNotesHandlers();
  initDemoAndSettingsHandlers();
  initNavigationHandlers();
  initReportsHandlers();
  initInsightsHandlers();
  initSearchHandler();

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });

  // ── Visibility change: suppress full reload UX on short background trips ──
  // When the vendor minimises the app to check WhatsApp and returns, the
  // browser fires visibilitychange. If the last sync was recent (< 5 min)
  // we skip re-syncing — data is fresh and the loading spinner is unnecessary.
  // If the tab was discarded and reloaded (cold resume), _lastSyncAt is 0
  // so the threshold is not met and a normal sync runs.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - _lastSyncAt < SYNC_THROTTLE_MS) return; // recent sync — skip
    const user = currentUser;
    if (user && navigator.onLine) {
      syncCloudData(user).catch(function(e) { errlog('visibilitychange sync failed', e); });
    }
  });

  // ── Back button / system back gesture interception ─────────────────────────
  // Without this, pressing the Android back button or swiping back exits the
  // app immediately because the history stack is empty.
  //
  // Strategy:
  //   • setActiveView() pushes a history entry on every panel navigation so
  //     there is always something to pop before the browser exits.
  //   • When the stack is exhausted (state is null or qsView is 'home' and
  //     we are already on Home), we show a "press back again to exit" toast.
  //     A second back press within 2 seconds exits naturally.
  //   • When a modal or the add-form is open, back closes it instead.
  let _backPressedOnce = false;
  let _backPressTimer  = null;

  window.addEventListener('popstate', function (e) {
    // If a modal is open, close it and re-push the entry so the stack stays intact.
    const modalOpen = document.querySelector('.modal-backdrop[style*="flex"]') ||
                      document.querySelector('#modalBackdrop[style*="flex"]') ||
                      document.querySelector('#confirmModalBackdrop[style*="flex"]');
    if (modalOpen) {
      hideModal();
      try { history.pushState({ qsView: _prevViewName || 'home' }, ''); } catch(_) {}
      return;
    }

    const addFormOpen = document.getElementById('addProductForm') &&
                        document.getElementById('addProductForm').style.display !== 'none';
    if (addFormOpen) {
      hideAddForm();
      try { history.pushState({ qsView: _prevViewName || 'home' }, ''); } catch(_) {}
      return;
    }

    // Navigate within the app if the popped state belongs to us.
    const targetView = e.state && e.state.qsView;
    if (targetView && targetView !== 'home' && _TAB_ORDER.includes(targetView)) {
      // We have a previous app view to return to — go there.
      setActiveView(targetView, false);
      return;
    }

    // Stack exhausted or already on Home — warn before exit.
    const onHome = !_prevViewName || _prevViewName === 'home';
    if (onHome) {
      if (_backPressedOnce) {
        // Second back — allow the browser to exit naturally.
        clearTimeout(_backPressTimer);
        return;
      }
      _backPressedOnce = true;
      toast('Press back again to exit', 'info', 2000);
      // Re-push so the browser has an entry for the second back press.
      try { history.pushState({ qsView: 'home' }, ''); } catch(_) {}
      _backPressTimer = setTimeout(function () { _backPressedOnce = false; }, 2000);
    } else {
      // Not on Home — navigate to Home instead of exiting.
      setActiveView('home', false);
      try { history.pushState({ qsView: 'home' }, ''); } catch(_) {}
    }
  });

  initAuth();

  window.addEventListener('unhandledrejection', function (ev) {
    errlog('Unhandled rejection:', ev.reason);
    // errlog() already forwards to Sentry if available — no double capture needed.
    // Only show toast for unexpected errors, not deliberate AbortController aborts.
    const reason = ev.reason;
    const isAbort = reason && (reason.name === 'AbortError' || String(reason).includes('abort'));
    if (!isAbort) toast('An unexpected error occurred. See console.', 'error');
  });





  // ═══════════════════════════════════════════════════════════════════════════
  // §18  INVENTORY BRIDGE — window.__QS_APP public API for inventory.js
  // ═══════════════════════════════════════════════════════════════════════════
  // ── INVENTORY BRIDGE — exposes everything inventory.js needs ─────────────
  // inventory.js reads window.__QS_APP; appss.js delegates back via __QS_INVENTORY
  let _editingProductId = editingProductId; // mirror - kept in sync

  window.__QS_APP = {
    getClient,
    getUser: () => currentUser,
    get currentUser() { return currentUser; },
    saveState,
    // Returns a frozen shallow copy — callers can read but cannot mutate arrays
    // or replace top-level properties. Use the explicit mutation methods below.
    getState: () => Object.freeze({
      products:   Object.freeze(state.products.map(p => Object.freeze(Object.assign({}, p)))),
      sales:      Object.freeze(state.sales.map(s => Object.freeze(Object.assign({}, s)))),
      notes:      Object.freeze(state.notes.map(n => Object.freeze(Object.assign({}, n)))),
      categories: Object.freeze(state.categories.slice()),
      logs:       Object.freeze(state.logs.map(l => Object.freeze(Object.assign({}, l)))),
      changes:    Object.freeze(state.changes.slice()),
    }),

    // ── State mutation methods ──────────────────────────────────────────────
    // inventory.js must use these instead of mutating the getState() result.
    // They operate on the live closure variable so saves and renders see changes.

    addProduct: function(product) {
      state.products.push(product);
    },

    // Patch an existing product in place by id.
    // patch is a plain object — only keys present in patch are updated.
    updateProduct: function(id, patch) {
      const p = state.products.find(x => x.id === id);
      if (!p) return false;
      Object.assign(p, patch);
      return true;
    },

    // Remove a product and all its local sales/changes by id.
    // Returns { productCopy, orphanedSaleIds } for caller to use in queue.
    deleteProduct: function(id) {
      const p = state.products.find(x => x.id === id);
      if (!p) return null;
      const productCopy    = Object.assign({}, p);
      const orphanedSaleIds = state.sales.filter(s => s.productId === id).map(s => s.id);
      state.products = state.products.filter(x => x.id !== id);
      state.sales    = state.sales.filter(x => x.productId !== id);
      state.changes  = (state.changes || []).filter(x => x.productId !== id);
      return { productCopy, orphanedSaleIds };
    },

    // Add a product and its category from a CSV import row.
    importProduct: function(product, categoryName) {
      state.products.push(product);
      if (categoryName && !state.categories.includes(categoryName)) {
        state.categories.push(categoryName);
      }
    },

    // Add a category only (for manual category creation in settings).
    addCategory: function(name) {
      if (!state.categories.includes(name)) state.categories.push(name);
    },
    // ── End mutation methods ────────────────────────────────────────────────
    syncCloudData,
    showConfirm,
    generateAdvancedInsights,
    toast,
    errlog,
    uid,
    showLoading,
    addActivityLog,
    compressImage,
    createModalBackdrop,
    createModalCloseButton,
    renderProducts,
    renderDashboard,
    renderChips,
    openModalFor,
    getEditingProductId:  () => editingProductId,
    setEditingProductId:  (v) => { editingProductId = v; },
  };
  Object.freeze(window.__QS_APP);

  // Call inventory.js initAll once it has loaded
  if (window.__QS_INVENTORY) {
    window.__QS_INVENTORY.initAll();
  } else {
    // inventory.js loads with defer — wait for it
    document.addEventListener('qs:inventory:ready', function () {
      window.__QS_INVENTORY.initAll();
    });
  }

  log('QuickShop loaded successfully');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

