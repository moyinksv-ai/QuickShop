/*
* QuickShop - Complete Production Build with All Fixes
* Fixed: Pull-to-refresh spinner, Report charts, AI insights, Modal close buttons, Keyboard flicker
* Author: Claude (Anthropic)
* Date: 2025-01-22
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

  const IS_PROD = window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');
  const log = IS_PROD ? () => {} : (...a) => console.log('[QS]', ...a);

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

  // 1. Safely replace content using DOM node — never innerHTML with a string
  while (content.firstChild) content.removeChild(content.firstChild);
  if (node instanceof Node) {
    content.appendChild(node);
  } else {
    // Safety fallback: node arrived as unexpected type, show plain text only
    const fallback = document.createElement('div');
    fallback.style.cssText = 'padding:16px;color:rgba(255,255,255,0.5);font-size:13px;';
    fallback.textContent = 'Insights could not be displayed.';
    content.appendChild(fallback);
  }

  // 2. Make the background SOLID Obsidian (No transparency)
  view.style.cssText = `
    display: block;
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background-color: #0d0d12 !important; 
    z-index: 200000; 
    overflow-y: auto;
    padding: 20px;
    padding-top: 80px;
    padding-bottom: 120px;
  `;

  // 3. Ensure the Close Buttons are visible and work
  // We look for the X button that's already in your HTML or create one if missing
  let topBtn = view.querySelector('.modal-close-x');
  if (topBtn) {
    topBtn.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 200001;
      display: flex; background: #ef4444; color: white; border-radius: 50%;
      width: 44px; height: 44px; align-items: center; justify-content: center;
      font-size: 28px; border: none; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    topBtn.onclick = closeInventoryInsight;
  }

  // 4. Add/Update the bottom button
  let bottomBtn = $('aiBottomClose');
  if (!bottomBtn) {
    bottomBtn = document.createElement('button');
    bottomBtn.id = 'aiBottomClose';
    content.appendChild(bottomBtn);
  }
  bottomBtn.textContent = 'Close Insights';
  bottomBtn.className = 'save-btn';
  bottomBtn.style.cssText = 'width:100%; margin-top:40px; background:#1f1f27; color:white; border:1px solid rgba(255,255,255,0.1); padding:16px; border-radius:12px; font-weight:bold;';
  bottomBtn.onclick = closeInventoryInsight;

  // 5. App Logic: Prevent background scrolling
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
    // Drive animation inline — view uses cssText so no CSS class available.
    // Snap transition onto the properties we're changing, then clean up.
    view.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    view.style.opacity    = '0';
    view.style.transform  = 'translateY(16px)';
    setTimeout(() => {
      view.style.display    = 'none';
      view.style.transition = '';
      view.style.opacity    = '';
      view.style.transform  = '';
      view.removeAttribute('aria-modal');
      document.body.classList.remove('modal-open');
      const scrollY = view.dataset.scrollY;
      document.body.style.position = '';
      document.body.style.top      = '';
      document.body.style.width    = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY));
    }, 190);
  }

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
      for (const note of state.notes) {
        await supabase.from('notes').upsert({
          id: note.id, user_id: currentUser.id, title: note.title || null,
          content: note.content, created_at: note.ts ? new Date(note.ts).toISOString() : new Date().toISOString()
        });
      }
      const existingCategories = await supabase.from('categories').select('name').eq('user_id', currentUser.id);
      const existingNames = new Set((existingCategories.data || []).map(c => c.name));
      for (const cat of state.categories) {
        if (!existingNames.has(cat)) await supabase.from('categories').insert({ user_id: currentUser.id, name: cat });
      }
      for (const log of state.logs.slice(0, 50)) {
        await supabase.from('audit_logs').upsert({
          id: log.id, user_id: currentUser.id, action: log.action, details: log.details,
          performed_by: log.user, created_at: log.ts ? new Date(log.ts).toISOString() : new Date().toISOString()
        });
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
        ts: new Date(s.sale_date).getTime()
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
      state.logs = cloudLogs.length > 0 ? cloudLogs : state.logs;
      toast('Data synced from cloud', 'info', 1500);
    } catch (e) { errlog('syncCloudData failed', e); toast('Failed to sync cloud data', 'error'); }
    finally {
      showLoading(false);
      isSyncInProgress = false;
    }
    initAppUI();
    await saveState();
  }

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
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) handleAuthUser(session.user);
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
  if (session && session.user) {
    handleAuthUser(session.user);
  } else {
    handleAuthLogout();
  }
  return;
}
      if (event === 'SIGNED_IN' && session && session.user) {
        handleAuthUser(session.user);
      } else if (event === 'USER_UPDATED' && session && session.user) {
        handleAuthUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        handleAuthLogout();
      } else if (event === 'TOKEN_REFRESH_ERROR') {
        console.warn('[QS] Token refresh failed — forcing logout.');
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
    modalContext = { mode, productId };
    const titleEl = $('modalTitle'), itemEl = $('modalItem'), qtyEl = $('modalQty');
    if (titleEl) titleEl.textContent = mode === 'sell' ? 'Sell items' : 'Add stock';
    if (itemEl) itemEl.textContent = `${p.name} — ${typeof p.qty === 'number' ? p.qty + ' in stock' : 'stock unknown'}`;
    if (qtyEl) qtyEl.value = 1;
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
            doSell(modalContext.productId, q);
          } else {
            doAddStock(modalContext.productId, q);
          }
          hideModal();
        } finally {
          _modalConfirmLock = false;
          modalConfirm.disabled = false;
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

  async function doSell(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = p.qty - qty;
    const newSale = { productId, qty, price: window.n(p.price), cost: window.n(p.cost), ts: Date.now(), id: uid() };
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

    if (dashRevenueEl) {
      dashRevenueEl.innerHTML = '';
      const val = document.createElement('span');
      val.textContent = fmt(revenue);
      dashRevenueEl.appendChild(val);
      dashRevenueEl.insertAdjacentHTML('beforeend', trendBadge(revenue, revYest));
    }
    if (dashProfitEl) {
      dashProfitEl.innerHTML = '';
      const val = document.createElement('span');
      val.textContent = fmt(profit);
      dashProfitEl.appendChild(val);
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

  function renderNotes() {
    try {
    const notesListEl = $('notesList');
    if (!notesListEl) return;
    notesListEl.innerHTML = '';
    const notes = (state.notes || []).slice().sort((a,b)=>b.ts - a.ts);
    if (!notes.length) {
      const no = document.createElement('div');
      no.className = 'small';
      no.textContent = 'No notes yet — add one above.';
      notesListEl.appendChild(no);
      return;
    }
    for (const note of notes) {
      const item = document.createElement('div');
      item.className = 'note-item';
      if (note.title) {
        const t = document.createElement('div');
        t.style.fontWeight = '700';
        t.textContent = note.title;
        item.appendChild(t);
      }
      const c = document.createElement('div');
      c.style.marginTop = '6px';
      c.style.whiteSpace = 'pre-wrap';
      c.textContent = note.content;
      item.appendChild(c);
      const meta = document.createElement('div');
      meta.className = 'note-meta';
      meta.textContent = formatDateTime(note.ts);
      item.appendChild(meta);
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.justifyContent = 'flex-end';
      actions.style.marginTop = '8px';
      const edit = document.createElement('button');
      edit.className = 'btn-edit';
      edit.textContent = 'Edit';
      edit.dataset.editNote = note.id;
      const del = document.createElement('button');
      del.className = 'btn-delete';
      del.textContent = 'Delete';
      del.dataset.deleteNote = note.id;
      actions.appendChild(edit);
      actions.appendChild(del);
      item.appendChild(actions);
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
          // Scroll the input into view so the user sees the form is ready
          const noteForm = noteTitle ? noteTitle.closest('.note-form') : null;
          const scrollTarget = noteForm || noteTitle;
          if (scrollTarget) {
            setTimeout(() => {
              scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
              if (noteContent) noteContent.focus();
            }, 50);
          }
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
      });
    }
  }

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
    _prevViewName = view;

    const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
    const headerSearch = $('headerSearchInput'), chipsEl = $('chips');
    navButtons.forEach(b => {
      const isActive = b.dataset.view === view;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true':'false');
    });
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('active', 'from-right', 'from-left');
    });
    const panel = $(view + 'Panel');
    if (panel) {
      if (dir) panel.classList.add(dir);
      panel.classList.add('active');
      // Remove direction class after animation so it doesn't persist
      if (dir) setTimeout(() => { panel.classList.remove(dir); }, 320);
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
      // zero dimensions. Trigger a resize on the next frame, after the panel
      // is visible, so the chart fills its container correctly.
      requestAnimationFrame(function() {
        if (reportChart) reportChart.resize();
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
      // Spacer accounts for the fixed navbar height + Android gesture bar safe area.
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
        const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode','SaleID']];
        (state.sales || []).forEach(s => {
          const p = state.products.find(x=>x.id===s.productId);
          const total = (window.n(s.price) * window.n(s.qty));
          const profit = (window.n(s.price) - window.n(s.cost)) * window.n(s.qty);
          rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '', s.id]);
        });
        generateCsv(rows, 'sales_all');
      });
    }
    const exportCurrentReport = $('exportCurrentReport');
    if (exportCurrentReport) {
      exportCurrentReport.addEventListener('click', function () {
        const buckets = createBuckets(currentReportRange);
        const start = buckets[0].start, end = buckets[buckets.length - 1].end;
        const salesInRange = getSalesInRange(start, end);
        const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode','SaleID']];
        salesInRange.forEach(s => {
          const p = state.products.find(x=>x.id===s.productId);
          const total = (window.n(s.price) * window.n(s.qty));
          const profit = (window.n(s.price) - window.n(s.cost)) * window.n(s.qty);
          rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '', s.id]);
        });
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

  function calculateStockoutPrediction(product) {
    const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentSales = state.sales.filter(s => s.productId === product.id && s.ts >= last30Days);
    if (recentSales.length === 0) return null;
    
    const totalSold = recentSales.reduce((sum, s) => sum + s.qty, 0);
    const dailyRate = totalSold / 30;
    
    if (dailyRate === 0) return null;
    const daysUntilStockout = Math.floor(product.qty / dailyRate);
    
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

  function generateAdvancedInsights(returnHtml = false) {
  try {
    const s = state || { products: [], sales: [], notes: [] };

    // ── TIME WINDOWS ────────────────────────────────────────────────
    const now = Date.now();
    const D = 24 * 60 * 60 * 1000;
    const last7   = now - 7  * D;
    const last14  = now - 14 * D;
    const last30  = now - 30 * D;
    const last60  = now - 60 * D;
    const prev7   = now - 14 * D; // window: prev7 → last7

    // ── HELPERS ─────────────────────────────────────────────────────
    function salesInWindow(productId, from, to = now) {
      return s.sales.filter(x => x.productId === productId && x.ts >= from && x.ts < to);
    }
    function totalQty(sales)    { return sales.reduce((a,x) => a + x.qty, 0); }
    function totalProfit(sales) { return sales.reduce((a,x) => a + ((x.price - x.cost) * x.qty), 0); }
    function totalRevenue(sales){ return sales.reduce((a,x) => a + (x.price * x.qty), 0); }

    const allSales7   = s.sales.filter(x => x.ts >= last7);
    const allSalesPrev7 = s.sales.filter(x => x.ts >= prev7 && x.ts < last7);
    const rev7   = totalRevenue(allSales7);
    const rev7p  = totalRevenue(allSalesPrev7);
    const prof7  = totalProfit(allSales7);
    const txCount7 = allSales7.length;

    // ── COMPUTE 6 SIGNALS ───────────────────────────────────────────

    // 1. RESTOCK NOW — products about to run dry
    const restockAlerts = [];
    s.products.forEach(p => {
      const recent = salesInWindow(p.id, last30);
      const qty30 = totalQty(recent);
      if (qty30 === 0) return;
      const dailyRate = qty30 / 30;
      if (p.qty === 0) {
        const lostDaily = Math.round(dailyRate * p.price);
        restockAlerts.push({ product: p, daysLeft: 0, dailyRate, lostDaily, suggest: Math.ceil(dailyRate * 14) });
      } else {
        const daysLeft = Math.floor(p.qty / dailyRate);
        if (daysLeft <= 7) {
          restockAlerts.push({ product: p, daysLeft, dailyRate, lostDaily: Math.round(dailyRate * p.price), suggest: Math.ceil(dailyRate * 14) });
        }
      }
    });
    restockAlerts.sort((a,b) => a.daysLeft - b.daysLeft);

    // 2. PROFIT LEAK — selling a lot but making little
    const profitLeaks = [];
    s.products.forEach(p => {
      if (p.price <= 0 || p.cost <= 0) return;
      const recent = salesInWindow(p.id, last30);
      const qty30 = totalQty(recent);
      if (qty30 < 3) return; // ignore rarely sold items
      const margin = ((p.price - p.cost) / p.price) * 100;
      const totalProfitMade = totalProfit(recent);
      const totalRevMade = totalRevenue(recent);
      if (margin < 15 && totalRevMade > 0) {
        const betterPrice = Math.ceil(p.cost / 0.75); // targets 25% margin
        const gainIfFixed = (betterPrice - p.price) * qty30;
        profitLeaks.push({ product: p, margin, qty30, totalProfitMade, totalRevMade, betterPrice, gainIfFixed });
      }
    });
    profitLeaks.sort((a,b) => b.totalRevMade - a.totalRevMade); // worst leak by revenue first

    // 3. SILENT BESTSELLER — most profitable product this week
    const perfMap = {};
    s.sales.filter(x => x.ts >= last7).forEach(sale => {
      if (!perfMap[sale.productId]) perfMap[sale.productId] = { profit: 0, qty: 0, revenue: 0 };
      perfMap[sale.productId].profit  += (sale.price - sale.cost) * sale.qty;
      perfMap[sale.productId].qty     += sale.qty;
      perfMap[sale.productId].revenue += sale.price * sale.qty;
    });
    const topByProfit = Object.entries(perfMap)
      .map(([id, m]) => ({ product: s.products.find(p => p.id === id), ...m }))
      .filter(x => x.product)
      .sort((a,b) => b.profit - a.profit)
      .slice(0, 3);

    // 4. CASH TRAP — dead stock, money sitting idle
    const cashTraps = [];
    s.products.forEach(p => {
      if (p.qty <= 0) return;
      const age = now - (p.createdAt || now);
      if (age < 60 * D) return; // skip new products
      const hasSales = s.sales.some(x => x.productId === p.id && x.ts >= last60);
      if (!hasSales) {
        const trapped = p.cost * p.qty;
        const clearPrice = Math.floor(p.price * 0.82);
        cashTraps.push({ product: p, trapped, clearPrice, qty: p.qty });
      }
    });
    cashTraps.sort((a,b) => b.trapped - a.trapped);
    const totalTrapped = cashTraps.reduce((a,x) => a + x.trapped, 0);

    // 5. REVENUE TREND — this week vs last week
    const trendPct = rev7p > 0 ? ((rev7 - rev7p) / rev7p) * 100 : null;
    const trendUp = trendPct !== null && trendPct >= 0;
    // Best day this week
    const dayTotals = {};
    allSales7.forEach(sale => {
      const day = new Date(sale.ts).toLocaleDateString('en-NG', { weekday: 'short' });
      dayTotals[day] = (dayTotals[day] || 0) + (sale.price * sale.qty);
    });
    const bestDay = Object.entries(dayTotals).sort((a,b) => b[1]-a[1])[0];

    // 6. PRICE OPPORTUNITY — fast-selling but low margin
    const priceOpps = [];
    s.products.forEach(p => {
      if (p.price <= 0 || p.cost <= 0) return;
      const recent = salesInWindow(p.id, last7);
      const qty7 = totalQty(recent);
      if (qty7 < 2) return; // must be selling fast enough
      const margin = ((p.price - p.cost) / p.price) * 100;
      if (margin < 25) {
        const nudgePrice = Math.ceil(p.price * 1.10); // +10% nudge
        const extraProfit = (nudgePrice - p.price) * qty7 * 4; // projected monthly
        priceOpps.push({ product: p, margin, qty7, nudgePrice, extraProfit });
      }
    });
    priceOpps.sort((a,b) => b.extraProfit - a.extraProfit);

    // ── BUILD UI ────────────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 0 16px;';

    function card(borderColor, bg) {
      const el = document.createElement('div');
      el.style.cssText = `border-radius:14px;overflow:hidden;border:1px solid ${borderColor};background:${bg};`;
      return el;
    }
    function cardHeader(emoji, title, subtitle, color) {
      return `<div style="padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${subtitle ? 2 : 0}px;">
          <span style="font-size:18px;line-height:1;">${emoji}</span>
          <span style="font-weight:700;font-size:15px;color:#fff;">${title}</span>
        </div>
        ${subtitle ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-left:26px;">${subtitle}</div>` : ''}
      </div>`;
    }
    function row(left, right, bg = 'rgba(255,255,255,0.04)') {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 16px;background:${bg};border-radius:8px;margin:0 10px 6px;">
        <div style="flex:1;min-width:0;">${left}</div>
        <div style="flex-shrink:0;margin-left:10px;">${right}</div>
      </div>`;
    }
    function actionBtn(label, color, dataAttrs) {
      return `<button class="ai-action-btn" ${dataAttrs} style="background:${color};border:0;padding:6px 13px;border-radius:8px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap;letter-spacing:0.2px;">${label}</button>`;
    }
    function productLine(name, sub) {
      return `<div style="font-weight:600;font-size:13.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${escapeHtml(name)}</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.5);margin-top:1px;">${sub}</div>`;
    }

    // ── CARD 1: REVENUE TREND ───────────────────────────────────────
    const trendCard = card('rgba(99,102,241,0.35)', 'rgba(99,102,241,0.08)');
    let trendBody = '';
    if (trendPct !== null) {
      const arrow = trendUp ? '↑' : '↓';
      const trendColor = trendUp ? '#10b981' : '#ef4444';
      trendBody = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:12px 14px 14px;">
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 8px;text-align:center;">
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:4px;">This week</div>
            <div style="font-size:16px;font-weight:700;color:#10b981;">${fmt(rev7)}</div>
          </div>
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 8px;text-align:center;">
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:4px;">Profit</div>
            <div style="font-size:16px;font-weight:700;color:#6366f1;">${fmt(prof7)}</div>
          </div>
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px 8px;text-align:center;">
            <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-bottom:4px;">vs last week</div>
            <div style="font-size:16px;font-weight:700;color:${trendColor};">${arrow}${Math.abs(trendPct).toFixed(0)}%</div>
          </div>
        </div>
        ${bestDay ? `<div style="padding:0 14px 12px;font-size:12px;color:rgba(255,255,255,0.5);">Best day: <span style="color:#fff;font-weight:600;">${bestDay[0]} — ${fmt(bestDay[1])}</span> &nbsp;·&nbsp; ${txCount7} sales this week</div>` : ''}
      `;
    } else if (rev7 > 0) {
      trendBody = `<div style="padding:12px 16px 14px;font-size:13px;color:rgba(255,255,255,0.7);">Revenue this week: <strong style="color:#10b981;">${fmt(rev7)}</strong>. Keep recording sales to unlock trend comparison.</div>`;
    } else {
      trendBody = `<div style="padding:12px 16px 14px;font-size:13px;color:rgba(255,255,255,0.5);">No sales recorded yet this week. Tap the sell button when you make a sale.</div>`;
    }
    trendCard.innerHTML = cardHeader('📈', 'This week', null, '#6366f1') + trendBody;
    wrap.appendChild(trendCard);

    // ── CARD 2: RESTOCK NOW ─────────────────────────────────────────
    if (restockAlerts.length > 0) {
      const rc = card('rgba(239,68,68,0.35)', 'rgba(239,68,68,0.07)');
      const outNow = restockAlerts.filter(x => x.daysLeft === 0);
      const soon   = restockAlerts.filter(x => x.daysLeft > 0);
      let rbody = '';
      if (outNow.length) {
        rbody += `<div style="padding:8px 14px 4px;font-size:11px;font-weight:700;color:rgba(239,68,68,0.9);letter-spacing:0.5px;text-transform:uppercase;">Out now</div>`;
        outNow.slice(0,3).forEach(a => {
          rbody += row(
            productLine(a.product.name, `Losing ~${fmt(a.lostDaily)}/day`),
            actionBtn(`Restock ${a.suggest}`, '#ef4444', `data-action="restock" data-product-id="${escapeHtml(a.product.id)}" data-qty="${a.suggest}"`)
          );
        });
      }
      if (soon.length) {
        rbody += `<div style="padding:8px 14px 4px;font-size:11px;font-weight:700;color:rgba(245,158,11,0.9);letter-spacing:0.5px;text-transform:uppercase;">Running low</div>`;
        soon.slice(0,3).forEach(a => {
          rbody += row(
            productLine(a.product.name, `${a.daysLeft} day${a.daysLeft===1?'':'s'} left · ${a.product.qty} in stock`),
            actionBtn(`Order ${a.suggest}`, '#f59e0b', `data-action="restock" data-product-id="${escapeHtml(a.product.id)}" data-qty="${a.suggest}"`)
          );
        });
      }
      rbody += '<div style="height:6px;"></div>';
      rc.innerHTML = cardHeader('📦', 'Restock Now', `${restockAlerts.length} product${restockAlerts.length>1?'s':''} need attention`, '#ef4444') + rbody;
      wrap.appendChild(rc);
    }

    // ── CARD 3: PROFIT LEAK ─────────────────────────────────────────
    if (profitLeaks.length > 0) {
      const pc = card('rgba(239,68,68,0.25)', 'rgba(239,68,68,0.05)');
      let pbody = '';
      profitLeaks.slice(0,3).forEach(l => {
        pbody += row(
          productLine(l.product.name, `${l.margin.toFixed(0)}% margin · sold ${l.qty30}× · only ${fmt(l.totalProfitMade)} profit`),
          actionBtn('Fix Price', '#ef4444', `data-action="edit" data-product-id="${escapeHtml(l.product.id)}" data-price="${l.betterPrice}"`)
        );
      });
      const totalLeak = profitLeaks.slice(0,3).reduce((a,x) => a + (x.gainIfFixed), 0);
      pbody += `<div style="padding:6px 16px 12px;font-size:12px;color:rgba(255,255,255,0.45);">Fixing these could add ~${fmt(totalLeak)} profit this month</div>`;
      pc.innerHTML = cardHeader('💸', 'Profit Leak', 'High sales, low margin — cost is eating your money', '#ef4444') + pbody;
      wrap.appendChild(pc);
    }

    // ── CARD 4: SILENT BESTSELLER ───────────────────────────────────
    if (topByProfit.length > 0) {
      const bc = card('rgba(16,185,129,0.3)', 'rgba(16,185,129,0.07)');
      let bbody = `<div style="padding:8px 14px 6px;font-size:11px;font-weight:700;color:rgba(16,185,129,0.8);letter-spacing:0.5px;text-transform:uppercase;">Most profitable this week</div>`;
      const medals = ['🥇','🥈','🥉'];
      topByProfit.forEach((x, i) => {
        bbody += row(
          `<div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">${medals[i]}</span>
            <div>
              <div style="font-weight:600;font-size:13.5px;color:#fff;">${escapeHtml(x.product.name)}</div>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.45);">${x.qty} sold · ${fmt(x.revenue)} revenue</div>
            </div>
          </div>`,
          `<span style="font-weight:700;font-size:14px;color:#10b981;">${fmt(x.profit)}</span>`,
          'transparent'
        );
      });
      const top1 = topByProfit[0];
      bbody += `<div style="padding:2px 16px 12px;font-size:12px;color:rgba(255,255,255,0.45);">${escapeHtml(top1.product.name)} is your best earner. Make sure you never run out.</div>`;
      bc.innerHTML = cardHeader('🏆', 'Best Sellers', null, '#10b981') + bbody;
      wrap.appendChild(bc);
    }

    // ── CARD 5: PRICE OPPORTUNITY ───────────────────────────────────
    if (priceOpps.length > 0) {
      const oc = card('rgba(99,102,241,0.3)', 'rgba(99,102,241,0.06)');
      let obody = '';
      priceOpps.slice(0,3).forEach(o => {
        obody += row(
          productLine(o.product.name, `Selling fast (${o.qty7}× this week) but only ${o.margin.toFixed(0)}% margin`),
          actionBtn(`Try ${fmt(o.nudgePrice)}`, '#6366f1', `data-action="edit" data-product-id="${escapeHtml(o.product.id)}" data-price="${o.nudgePrice}"`)
        );
      });
      const topOpp = priceOpps[0];
      obody += `<div style="padding:4px 16px 12px;font-size:12px;color:rgba(255,255,255,0.45);">A small price nudge on fast movers can add ${fmt(topOpp.extraProfit)}/month with no extra effort</div>`;
      oc.innerHTML = cardHeader('💡', 'Price Opportunity', 'These sell fast — a small price nudge earns more with no effort', '#6366f1') + obody;
      wrap.appendChild(oc);
    }

    // ── CARD 6: CASH TRAP ───────────────────────────────────────────
    if (cashTraps.length > 0) {
      const cc = card('rgba(245,158,11,0.3)', 'rgba(245,158,11,0.06)');
      let cbody = '';
      cashTraps.slice(0,3).forEach(t => {
        cbody += row(
          productLine(t.product.name, `${t.qty} units · ${fmt(t.trapped)} sitting idle for 60+ days`),
          actionBtn(`Sell at ${fmt(t.clearPrice)}`, '#f59e0b', `data-action="edit" data-product-id="${escapeHtml(t.product.id)}" data-price="${t.clearPrice}"`)
        );
      });
      cbody += `<div style="padding:4px 16px 12px;font-size:12px;color:rgba(255,255,255,0.45);">${fmt(totalTrapped)} total cash is locked in unsold stock. A discount frees it up.</div>`;
      cc.innerHTML = cardHeader('💤', 'Cash Trap', "These haven't sold in 60+ days — your money is stuck", '#f59e0b') + cbody;
      wrap.appendChild(cc);
    }

    // ── ALL CLEAR ───────────────────────────────────────────────────
    const hasIssues = restockAlerts.length + profitLeaks.length + cashTraps.length + priceOpps.length;
    if (!hasIssues && topByProfit.length === 0 && !rev7) {
      const cl = card('rgba(16,185,129,0.2)', 'rgba(16,185,129,0.05)');
      cl.innerHTML = `<div style="padding:20px 16px;text-align:center;">
        <div style="font-size:32px;margin-bottom:8px;">✅</div>
        <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">All good for now</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">No urgent issues found. Keep recording sales and your insights will get sharper over time.</div>
      </div>`;
      wrap.appendChild(cl);
    }

    // ── ACTION BUTTON HANDLER — delegated on wrap, works in any context ──
    wrap.addEventListener('click', function(e) {
      const btn = e.target.closest('.ai-action-btn');
      if (!btn) return;
      e.preventDefault();
      const action    = btn.dataset.action;
      const productId = btn.dataset.productId;
      const qty       = btn.dataset.qty;
      const price     = btn.dataset.price;
      // Close whichever view is showing insights
      closeInventoryInsight();
      setTimeout(() => {
        if (action === 'restock') {
          openModalFor('add', productId);
          setTimeout(() => {
            const qtyEl = $('modalQty');
            if (qtyEl && qty) { qtyEl.value = qty; qtyEl.focus(); }
          }, 100);
        } else if (action === 'edit') {
          setActiveView('inventory');
          setTimeout(() => {
            openEditProduct(productId);
            setTimeout(() => {
              const priceEl = $('invPrice');
              if (priceEl && price) { priceEl.value = price; priceEl.focus(); priceEl.select(); }
            }, 200);
          }, 100);
        }
      }, 100);
    });

    // ── ATTACH OR RETURN ─────────────────────────────────────────────
    if (returnHtml) return wrap; // Return the live DOM node — caller uses appendChild, never innerHTML

    const aiContent = $('aiContent');
    if (aiContent) {
      aiContent.innerHTML = '';
      aiContent.appendChild(wrap);
    }

  } catch(e) {
    errlog('generateAdvancedInsights failed', e);
    if (returnHtml) { const err = document.createElement('div'); err.style.cssText = 'padding:16px;color:rgba(255,255,255,0.5);font-size:13px;'; err.textContent = 'Could not load insights right now.'; return err; }
  }
}

  function initInsightsHandlers() {
    const closeInventoryInsightBtn = $('closeInventoryInsightBtn');
    if (closeInventoryInsightBtn) closeInventoryInsightBtn.addEventListener('click', closeInventoryInsight);
    
    const insightBtn = $('insightBtn');
    if (insightBtn) {
      insightBtn.addEventListener('click', function () {
        const html = generateAdvancedInsights(true);
        showInventoryInsight(html);
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
      refreshInsightsBtn.addEventListener('click', function() {
        generateAdvancedInsights();
        toast('Insights refreshed', 'info', 1500);
      });
    }
  }

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
        .qs-s-section {
          background: var(--card-glass);
          border: 1px solid var(--border-glass);
          border-radius: 16px;
          margin-bottom: 12px;
          overflow: hidden;
        }
        .qs-s-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          gap: 12px;
          border-bottom: 1px solid var(--border-glass);
        }
        .qs-s-row:last-child { border-bottom: none; }
        .qs-s-row-label { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
        .qs-s-row-sub { font-size: 12px; color: var(--text-muted); }
        .qs-s-section-title {
          font-size: 11px; font-weight: 700; letter-spacing: 0.8px;
          text-transform: uppercase; color: var(--text-muted);
          padding: 14px 16px 8px;
        }
        .qs-avatar {
          width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #a78bfa);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; font-weight: 800; color: #fff;
          flex-shrink: 0; letter-spacing: -0.5px;
          overflow: hidden; cursor: pointer; position: relative;
          border: 2px solid rgba(124,58,237,0.5);
          box-shadow: 0 0 0 3px rgba(124,58,237,0.12);
        }
        .qs-avatar img {
          width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
        }
        .qs-avatar-overlay {
          position: absolute; inset: 0; border-radius: 50%;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity .18s;
          font-size: 18px;
        }
        .qs-avatar:hover .qs-avatar-overlay,
        .qs-avatar:focus .qs-avatar-overlay { opacity: 1; }
        .qs-avatar-uploading { opacity: 0.5; pointer-events: none; }
        .qs-theme-toggle-btn {
          background: var(--card-glass);
          border: 1px solid var(--border-glass);
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 13px; font-weight: 700;
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
          white-space: nowrap;
        }
        .qs-theme-toggle-btn:hover { background: var(--card-glass-hover); border-color: var(--accent-primary); }
        .qs-danger-btn {
          width: 100%; padding: 13px;
          background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 12px;
          color: #ef4444; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.2s;
        }
        .qs-danger-btn:hover { background: rgba(239,68,68,0.15); border-color: #ef4444; }
        .qs-ghost-btn {
          background: var(--card-glass);
          border: 1px solid var(--border-glass);
          border-radius: 10px; padding: 8px 14px;
          font-size: 13px; font-weight: 600;
          color: var(--text-secondary); cursor: pointer;
          transition: all 0.2s;
        }
        .qs-ghost-btn:hover { background: var(--card-glass-hover); color: var(--text-primary); }
        /* Category row */
        .qs-cat-row {
          display: flex; align-items: center;
          padding: 10px 16px; gap: 10px;
          border-bottom: 1px solid var(--border-glass);
          transition: background 0.15s;
        }
        .qs-cat-row:last-child { border-bottom: none; }
        .qs-cat-row:hover { background: var(--card-glass-hover); }
        .qs-cat-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--accent-primary); flex-shrink: 0;
        }
        .qs-cat-name {
          flex: 1; font-size: 14px; font-weight: 600; color: var(--text-primary);
        }
        .qs-cat-edit-input {
          flex: 1; font-size: 14px; font-weight: 600;
          background: var(--bg-glass) !important;
          border: 1.5px solid var(--accent-primary) !important;
          border-radius: 8px; padding: 5px 10px;
          color: var(--text-primary) !important;
          outline: none;
        }
        .qs-cat-icon-btn {
          background: transparent; border: 0;
          padding: 5px 8px; border-radius: 8px;
          font-size: 14px; cursor: pointer;
          color: var(--text-muted); transition: all 0.2s;
        }
        .qs-cat-icon-btn:hover { background: var(--card-glass-hover); color: var(--text-primary); }
        .qs-cat-icon-btn.danger:hover { color: #ef4444; }
        .qs-cat-save-btn {
          background: var(--accent-primary); border: 0;
          padding: 5px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 700;
          color: #fff; cursor: pointer; transition: background 0.2s;
        }
        .qs-cat-save-btn:hover { background: #4f52e0; }
        .qs-cat-cancel-btn {
          background: transparent; border: 1px solid var(--border-glass);
          padding: 5px 10px; border-radius: 8px;
          font-size: 12px; font-weight: 600;
          color: var(--text-muted); cursor: pointer;
        }
        .qs-add-cat-row {
          display: flex; gap: 8px; align-items: center;
          padding: 12px 16px;
          border-top: 1px solid var(--border-glass);
        }
        .qs-add-cat-input {
          flex: 1; font-size: 13.5px;
          background: var(--bg-glass) !important;
          border: 1.5px solid var(--border-glass);
          border-radius: 10px; padding: 8px 12px;
          color: var(--text-primary) !important; outline: none;
          transition: border-color 0.2s;
        }
        .qs-add-cat-input:focus { border-color: var(--accent-primary); }
        .qs-add-cat-btn {
          background: var(--accent-primary); border: 0;
          padding: 8px 16px; border-radius: 10px;
          font-size: 13px; font-weight: 700;
          color: #fff; cursor: pointer; transition: background 0.2s;
          white-space: nowrap;
        }
        .qs-add-cat-btn:hover { background: #4f52e0; }

        /* ── Sticky profile header ── */
        .qs-sticky-profile {
          position: sticky;
          top: var(--topbar-h);
          z-index: 100;
          background: var(--bg-obsidian);
          margin-left: -12px;
          margin-right: -12px;
          padding: 10px 12px 10px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        /* Avatar — compact 44px with camera badge */
        .qs-sp-avatar {
          position: relative;
          width: 44px; height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #a78bfa);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 800; color: #fff;
          flex-shrink: 0; overflow: visible;
          border: 2px solid rgba(124,58,237,0.45);
          box-shadow: 0 0 0 3px rgba(124,58,237,0.10);
          cursor: pointer;
        }
        .qs-sp-avatar img {
          width: 100%; height: 100%;
          object-fit: cover; border-radius: 50%;
        }
        /* Camera badge — bottom-right pip */
        .qs-sp-cam {
          position: absolute;
          bottom: -2px; right: -2px;
          width: 18px; height: 18px;
          background: var(--accent-primary);
          border-radius: 50%;
          border: 2px solid var(--bg-obsidian);
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; line-height: 1;
          pointer-events: none;
        }
        .qs-sp-uploading { opacity: 0.5; pointer-events: none; }
        /* Text block */
        .qs-sp-info {
          flex: 1; min-width: 0;
        }
        .qs-sp-name {
          font-size: 14px; font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.3;
          letter-spacing: -0.01em;
        }
        .qs-sp-email {
          font-size: 11.5px;
          color: var(--text-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-top: 1px;
        }
        /* Status badge pill — online/offline */
        .qs-sp-badge {
          display: inline-flex; align-items: center; gap: 5px;
          border-radius: 100px;
          padding: 3px 9px 3px 7px;
          font-size: 10px; font-weight: 700;
          white-space: nowrap; flex-shrink: 0;
          letter-spacing: 0.02em;
          transition: background 0.4s, border-color 0.4s, color 0.4s;
        }
        .qs-sp-badge.online {
          background: rgba(16,185,129,0.10);
          border: 1px solid rgba(16,185,129,0.22);
          color: #10b981;
        }
        .qs-sp-badge.offline {
          background: rgba(239,68,68,0.10);
          border: 1px solid rgba(239,68,68,0.22);
          color: #ef4444;
        }
        /* Animated status dot */
        .qs-sp-dot {
          width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
          position: relative;
        }
        .qs-sp-badge.online  .qs-sp-dot { background: #10b981; }
        .qs-sp-badge.offline .qs-sp-dot { background: #ef4444; }
        /* Pulse ring — online only */
        .qs-sp-badge.online .qs-sp-dot::after {
          content: '';
          position: absolute; inset: -3px;
          border-radius: 50%;
          background: rgba(16,185,129,0.35);
          animation: qs-dot-pulse 2s ease-out infinite;
        }
        @keyframes qs-dot-pulse {
          0%   { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        /* Scrollable body below sticky */
        /* Action row */
        .qs-action-row {
          display: flex;
          gap: 8px;
          padding: 12px 16px 4px;
          align-items: stretch;
        }
        .qs-action-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 11px 6px;
          background: var(--card-glass);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: .2px;
          transition: background .15s, border-color .15s;
          -webkit-tap-highlight-color: transparent;
          position: relative;
        }
        .qs-action-btn:active { background: rgba(255,255,255,0.1); }
        .qs-action-btn[aria-expanded="true"] {
          border-color: rgba(99,102,241,0.5);
          background: rgba(99,102,241,0.1);
          color: var(--accent-primary);
        }
        .qs-action-icon { font-size: 18px; line-height: 1; }
        .qs-action-arrow {
          font-size: 13px;
          color: var(--text-muted);
          transition: transform .28s cubic-bezier(.4,0,.2,1);
          display: inline-block;
        }
        .qs-action-btn[aria-expanded="true"] .qs-action-arrow {
          transform: rotate(90deg);
        }
        /* Share button rendered inside action row — inherit sizing */

        /* Slide-down drawers */
        .qs-drawer {
          overflow: hidden;
          max-height: 0;
          transition: max-height .32s cubic-bezier(.4,0,.2,1);
        }
        .qs-drawer.open { max-height: 700px; }
        .qs-drawer-inner {
          padding: 0 16px 4px;
          border-bottom: 1px solid var(--border-glass);
        }

        .qs-settings-body {
          padding-top: 12px;
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
    }).catch(function() {});

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    settingsPanel.innerHTML = `

      <!-- Sticky profile header -->
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

      <!-- Scrollable settings body -->
      <div class="qs-settings-body">

      <!-- ── Action row: 3 top-level buttons ───────────────────────── -->
      <div class="qs-action-row">
        <button id="qs-btn-edit-account" class="qs-action-btn" aria-expanded="false">
          <span class="qs-action-icon">✏️</span>
          <span>Edit Account</span>
          <span class="qs-action-arrow">›</span>
        </button>
        <button id="qs-btn-edit-store" class="qs-action-btn" aria-expanded="false">
          <span class="qs-action-icon">🏪</span>
          <span>Edit Store</span>
          <span class="qs-action-arrow">›</span>
        </button>
        <button id="qs-action-share" class="qs-action-btn" type="button"
          aria-label="Share your catalog to WhatsApp"
          style="background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.4);color:var(--accent-primary);">
          <span class="qs-action-icon">📤</span>
          <span>Share Catalog</span>
        </button>
      </div>

      <!-- ── Edit Account drawer (hidden by default) ────────────────── -->
      <div id="qs-drawer-account" class="qs-drawer" aria-hidden="true">
        <div class="qs-drawer-inner">
          <div class="qs-s-section" style="margin:0;border-radius:0;border-top:none;">
            <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0 8px;">
              <div>
                <div class="qs-s-row-label" style="margin-bottom:6px;">Full Name</div>
                <input id="qs-account-name" type="text" maxlength="80"
                  placeholder="Your full name"
                  value="${escapeHtml(fullName)}"
                  style="width:100%;box-sizing:border-box;
                         background:var(--card-glass);border:1px solid var(--border-glass);
                         border-radius:var(--radius-sm);color:var(--text-primary);
                         font-size:13px;padding:10px 12px;font-family:inherit;
                         transition:border-color .2s;" />
              </div>
              <div>
                <div class="qs-s-row-label" style="margin-bottom:4px;">Business Name</div>
                <div class="qs-s-row-sub" style="margin-bottom:6px;">Shown on your catalog header and share link</div>
                <input id="qs-account-business" type="text" maxlength="80"
                  placeholder="Your store or business name"
                  value="${escapeHtml(businessName)}"
                  style="width:100%;box-sizing:border-box;
                         background:var(--card-glass);border:1px solid var(--border-glass);
                         border-radius:var(--radius-sm);color:var(--text-primary);
                         font-size:13px;padding:10px 12px;font-family:inherit;
                         transition:border-color .2s;" />
              </div>
              <div style="display:flex;justify-content:flex-end;">
                <button id="qs-account-save" class="qs-ghost-btn"
                  style="color:#10b981;border-color:rgba(16,185,129,0.3);">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Edit Store drawer (hidden by default) ──────────────────── -->
      <div id="qs-drawer-store" class="qs-drawer" aria-hidden="true">
        <div class="qs-drawer-inner">
          <div class="qs-s-section" style="margin:0;border-radius:0;border-top:none;">
            <!-- Tagline -->
            <div style="display:flex;flex-direction:column;gap:6px;padding-bottom:14px;border-bottom:1px solid var(--border-glass);">
              <div class="qs-s-row-label">Store Tagline</div>
              <div class="qs-s-row-sub">Shown on your catalog — max 120 characters</div>
              <textarea id="qs-tagline-input" maxlength="120" rows="2"
                placeholder="e.g. Get confidence in a bottle from ALL'S Signature"
                style="width:100%;box-sizing:border-box;resize:none;
                       background:var(--card-glass);border:1px solid var(--border-glass);
                       border-radius:var(--radius-sm);color:var(--text-primary);
                       font-size:13px;line-height:1.55;padding:10px 12px;
                       font-family:inherit;transition:border-color .2s;"></textarea>
              <div style="display:flex;justify-content:flex-end;">
                <button id="qs-tagline-save" class="qs-ghost-btn"
                  style="color:#10b981;border-color:rgba(16,185,129,0.3);">Save Tagline</button>
              </div>
            </div>
            <!-- Categories -->
            <div style="padding-top:14px;">
              <div class="qs-s-row-label" style="margin-bottom:10px;">Categories</div>
              <div id="qs-cat-list"></div>
              <div class="qs-add-cat-row">
                <input id="newCategoryName" class="qs-add-cat-input" type="text" placeholder="New category name…" />
                <button id="addCategoryBtn" class="qs-add-cat-btn">+ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Appearance ─────────────────────────────────────────────── -->
      <div class="qs-s-section">
        <div class="qs-s-section-title">Appearance</div>
        <div class="qs-s-row">
          <div>
            <div class="qs-s-row-label">Theme</div>
            <div class="qs-s-row-sub qs-theme-sub">Currently ${currentTheme} mode</div>
          </div>
          <button class="qs-theme-toggle-btn" data-current="${currentTheme}">
            ${currentTheme === 'dark' ? '☀️  Light Mode' : '🌙  Dark Mode'}
          </button>
        </div>
        <div class="qs-s-row" id="qs-install-row">
          <div>
            <div class="qs-s-row-label">Install App</div>
            <div class="qs-s-row-sub" id="qs-install-sub">Add QuickShop to your home screen</div>
          </div>
          <button id="qs-install-btn" class="qs-ghost-btn" style="color:var(--accent-primary);border-color:rgba(99,102,241,0.3);">📲 Install</button>
        </div>
      </div>

      <!-- ── Store Data ─────────────────────────────────────────────── -->
      <div class="qs-s-section">
        <div class="qs-s-section-title">Store Data</div>
        <div class="qs-s-row">
          <div>
            <div class="qs-s-row-label">Sync to Cloud</div>
            <div class="qs-s-row-sub">Push all local products to Supabase now</div>
          </div>
          <button id="btnSyncNow" class="qs-ghost-btn" style="color:#10b981;border-color:rgba(16,185,129,0.3);">☁️ Sync Now</button>
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
          <button id="btnClearStore" class="qs-ghost-btn" style="color:#ef4444;border-color:rgba(239,68,68,0.25);">Clear</button>
        </div>
      </div>

      <!-- ── Activity Log (always visible) ─────────────────────────── -->
      <div class="qs-s-section">
        <div id="activityLogArea"></div>
      </div>

      <!-- ── About (tappable → full overlay) ───────────────────────── -->
      <div class="qs-s-section">
        <button id="qs-about-btn" class="qs-s-row"
          style="width:100%;background:none;border:none;cursor:pointer;text-align:left;
                 -webkit-tap-highlight-color:transparent;"
          aria-label="About QuickShop">
          <div>
            <div class="qs-s-row-label">About QuickShop</div>
            <div class="qs-s-row-sub">Version 2.5 · Built for traders</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:18px;">⚡</span>
            <span style="font-size:16px;color:var(--text-muted);opacity:0.6;">›</span>
          </div>
        </button>
      </div>

      <!-- ── Sign out ───────────────────────────────────────────────── -->
      <div style="padding:4px 0 20px;">
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
        'background:var(--bg-primary,#09090b);' +
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
      backBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:none;border-radius:10px;' +
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



  function initAppUI() {
    try {
      renderChips(); renderProducts(); renderInventory(); renderDashboard(); renderNotes();
      if (!document.querySelector('.panel.active')) setActiveView('home', false);
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

  initAuth();

  window.addEventListener('unhandledrejection', function (ev) {
    errlog('Unhandled rejection:', ev.reason);
    // errlog() already forwards to Sentry if available — no double capture needed.
    // Only show toast for unexpected errors, not deliberate AbortController aborts.
    const reason = ev.reason;
    const isAbort = reason && (reason.name === 'AbortError' || String(reason).includes('abort'));
    if (!isAbort) toast('An unexpected error occurred. See console.', 'error');
  });




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
    getState: () => Object.freeze(Object.assign({}, state)),

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

