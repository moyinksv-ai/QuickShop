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

  // ── PUBLIC CATALOG ROUTING ─────────────────────────────────────────
  // Branch point: if ?view=catalog&store=USER_ID is present, render
  // a read-only customer storefront and skip all admin/auth setup.
  const _qs = new URLSearchParams(window.location.search);
  const isCatalogMode = _qs.get('view') === 'catalog' && !!_qs.get('store');
  const catalogStoreId = _qs.get('store') || null;

  if (isCatalogMode) {
    document.body.classList.add('customer-mode');
    initPublicCatalog(catalogStoreId);
    return; // ← hard branch: everything below is admin-only
  }
  // ── END CATALOG ROUTING ────────────────────────────────────────────

  const IS_PROD = window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');
  const log = IS_PROD ? () => {} : (...a) => console.log('[QS]', ...a);
  const errlog = (...a) => console.error('[QS Error]', ...a);
  
  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function uid() { return 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
  window.n = function(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; }
  window.fmt = function(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month:'short', day:'numeric' }); }
  function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  
  let toastTimer = null;
  function toast(message, type = 'info', ms = 2800) {
    try {
      let t = document.getElementById('appToast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'appToast';
        Object.assign(t.style, {
          position: 'fixed', left: '14px', right: '14px',
          bottom: 'calc(var(--nav-h) + 10px + env(safe-area-inset-bottom))',
          maxWidth: '480px', margin: '0 auto', padding: '12px 16px',
          borderRadius: '10px', fontWeight: 700, fontSize: '14px',
          background: '#18181b', border: '1px solid rgba(255, 255, 255, 0.1)',
          color: type === 'error' ? '#f87171' : type === 'warning' ? '#fbbf24' : '#6ee7b7',
          boxShadow: '0 8px 24px rgba(2,6,23,0.2)', opacity: 0,
          transform: 'translateY(20px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 99999, textAlign: 'center'
        });
        document.body.appendChild(t);
      }
      if (toastTimer) clearTimeout(toastTimer);
      t.textContent = message;
      t.style.color = type === 'error' ? '#f87171' : type === 'warning' ? '#fbbf24' : '#6ee7b7';
      requestAnimationFrame(()=> {
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
      });
      toastTimer = setTimeout(()=> {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
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
  const getUser = () => (getSupabase().user || null);

  const LOCAL_KEY_PREFIX = 'quickshop_stable_v1_';
  let currentUser = null;
  let state = { products: [], sales: [], changes: [], notes: [], categories: [], logs: [] };
  let isSyncing = false;
  let isSyncInProgress = false;
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

  // If user scrolls up or isn't at the top, reset and bail
  if (delta < 0 || window.scrollY > 5) {
    pullToRefresh.state = 'IDLE';
    updatePullToRefreshUI();
    return;
  }

  // Sync delta to distance so handleTouchEnd can see it
  pullToRefresh.distance = delta;
  updatePullToRefreshUI();
  
  // Prevent the whole page from bouncing (optional but smoother)
  if (delta > 10 && e.cancelable) e.preventDefault();
}

function handleTouchEnd() {
  if (pullToRefresh.state === 'PULLING') {
    // Now 'distance' actually has the value from the move event!
    if (pullToRefresh.distance > 70) {
      pullToRefresh.state = 'REFRESHING';
      updatePullToRefreshUI();
      setTimeout(() => location.reload(), 500);
    } else {
      // If pull was too short, reset state to IDLE immediately
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
    populateCategoryDropdown();
    const addForm = $('addForm');
    if (!addForm) return;
    if (asModal) {
      const backdrop = createModalBackdrop('addFormBackdrop', 99998);
      if (addForm.parentElement !== document.body) document.body.appendChild(addForm);
      addForm.style.cssText = `position:fixed;left:50%;top:15vh;transform:translateX(-50%);z-index:99999;max-width:720px;width:calc(100% - 32px);max-height:80vh;overflow-y:auto;border-radius:var(--radius);box-shadow:var(--shadow-glass-lg);background:var(--bg-glass);border:1px solid var(--border-glass);padding:20px;display:flex;flex-direction:column;gap:12px;transition:top 0.3s ease;will-change:transform;`;
      
      let existingCloseBtn = addForm.querySelector('.modal-close-x');
      if (existingCloseBtn) existingCloseBtn.remove();
      const closeBtn = createModalCloseButton(hideAddForm);
      addForm.insertBefore(closeBtn, addForm.firstChild);
      
      backdrop.style.display = 'flex';
      addForm.style.display = 'flex';
      backdrop.onclick = (e) => { if (e.target === backdrop) hideAddForm(); };
      document.body.classList.add('modal-open');
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const invName = $('invName');
          if (invName) invName.focus();
        });
      });
    } else {
      addForm.style.display = 'flex';
    }
  }

  function hideAddForm() {
    clearAddForm();
    const addForm = $('addForm'), backdrop = document.getElementById('addFormBackdrop');
    if (addForm) addForm.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
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
        const qtyInput = $('modalQty');
        if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
      });
    });
  }

  function hideModal() {
    const mb = $('modalBackdrop');
    if (mb) mb.style.display = 'none';
    modalContext = null;
    const errEl = $('modalError');
    if (errEl) errEl.textContent = '';
  }

  function initKeyboardDetection() {
    document.addEventListener('focusin', (e) => {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) document.body.classList.add('keyboard-open');
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || !['INPUT','TEXTAREA','SELECT'].includes(active.tagName)) document.body.classList.remove('keyboard-open');
      }, 50);
    });
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Escape') { hideModal(); hideAddForm(); stopScanner(); closeFullAuditLog(); closeInventoryInsight(); return; }
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
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
    okBtn.addEventListener('click', () => { if (confirmResolve) confirmResolve(true); backdrop.style.display = 'none'; });
    cancelBtn.addEventListener('click', () => { if (confirmResolve) confirmResolve(false); backdrop.style.display = 'none'; });
    backdrop.addEventListener('click', (e) => {
      if (e.target.id === 'confirmModalBackdrop') { if (confirmResolve) confirmResolve(false); backdrop.style.display = 'none'; }
    });
  }

  function showConfirm({ title = 'Are you sure?', message, okText = 'OK', okDanger = false }) {
    return new Promise((resolve) => {
      const backdrop = $('confirmModalBackdrop'), titleEl = $('confirmModalTitle');
      const messageEl = $('confirmModalMessage'), okBtn = $('confirmModalOK');
      if (!backdrop || !titleEl || !messageEl || !okBtn) return resolve(window.confirm(title + '\n' + message));
      confirmResolve = resolve;
      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.textContent = okText;
      okBtn.style.background = okDanger ? 'var(--danger)' : 'var(--accent-emerald)';
      backdrop.style.display = 'flex';
    });
  }

  function setBottomNavVisible(v) { const bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = v ? 'flex' : 'none'; }
  function hideAllAuthForms() {
    ['loginForm','signupForm','resetForm','verificationNotice','authLoading'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  }
  function showLoginForm() { hideAllAuthForms(); const el = $('loginForm'); if (el) el.style.display = 'flex'; clearAuthInputs(); }
  function showSignupForm() { hideAllAuthForms(); const el = $('signupForm'); if (el) el.style.display = 'flex'; clearAuthInputs(); }
  function showResetForm() { hideAllAuthForms(); const el = $('resetForm'); if (el) el.style.display = 'flex'; clearAuthInputs(); }
  function showVerificationNotice(email) {
    hideAllAuthForms();
    const el = $('verificationNotice');
    if (el) el.style.display = 'flex';
    const emailEl = $('verificationEmail');
    if (emailEl) emailEl.textContent = email || (getUser() && getUser().email) || '';
  }
  function showAuthLoading() { hideAllAuthForms(); const el = $('authLoading'); if (el) el.style.display = 'flex'; }
  function clearAuthInputs() {
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

  function showInventoryInsight(html) {
  const view = $('inventoryInsightView');
  const content = $('inventoryInsightsContent');
  if (!view || !content) return;

  // 1. Reset the text inside
  content.innerHTML = html;

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
    if (view) {
      view.style.display = 'none';
      view.removeAttribute('aria-modal');
      document.body.classList.remove('modal-open');
      const scrollY = view.dataset.scrollY;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY));
    }
  }

  async function setUserProfile(uid, profile) {
    const supabase = getClient();
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: uid, name: profile.name, business_name: profile.businessName,
        email: profile.email, created_at: profile.createdAt ? new Date(profile.createdAt).toISOString() : new Date().toISOString()
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
    if (isSyncing) return;
    isSyncing = true;
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
    finally { isSyncing = false; }
  }

  function loadLocalData(uid = null) {
    const localKey = uid ? LOCAL_KEY_PREFIX + uid : LOCAL_KEY_PREFIX + 'anon';
    let localState = { products: [], sales: [], changes: [], notes: [], categories: [], logs: [] };
    try {
      const localRaw = localStorage.getItem(localKey);
      if (localRaw) localState = JSON.parse(localRaw);
    } catch (e) { errlog('Failed to parse local data', e); }
    state = {
      products: localState.products || [],
      sales: localState.sales || [],
      changes: localState.changes || [],
      notes: localState.notes || [],
      categories: (localState.categories && localState.categories.length > 0) ? localState.categories : [...DEFAULT_CATEGORIES],
      logs: localState.logs || []
    };
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
        supabase.from('sales').select('*').eq('user_id', user.id),
        supabase.from('notes').select('*').eq('user_id', user.id),
        supabase.from('categories').select('*').eq('user_id', user.id),
        supabase.from('audit_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200)
      ]);
      const cloudProducts = (productsRes.data || []).map(p => ({
        id: p.id, name: p.name, barcode: p.barcode, price: p.price, cost: p.cost, qty: p.qty,
        category: p.category || 'Others', image: p.image_url, icon: p.icon,
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
      state.products = Array.from(productMap.values()).filter(p => cloudProductIds.has(p.id));
      const salesMap = new Map((state.sales || []).map(s => [s.id, s]));
      cloudSales.forEach(s => salesMap.set(s.id, s));
      state.sales = Array.from(salesMap.values());
      state.notes = cloudNotes.length > 0 ? cloudNotes : state.notes;
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
          if (data.user && !data.user.email_confirmed_at) {
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
    }

    // FIX 8: Duplicate btnLogin click handler removed.
    // The loginForm 'submit' listener above (handleLoginSubmit) covers button clicks
    // because btnLogin is type="submit" inside the form (or the Enter-key listeners handle it).
    // Adding a second identical click listener caused double-submission on every Enter key press.

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
      const signupInputs = ['signupName', 'signupBusiness', 'signupEmail', 'signupPass', 'signupPassConfirm'];
      signupInputs.forEach(inputId => {
        const input = $(inputId);
        if (input) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSignupSubmit();
            }
          });
        }
      });
    }

    const btnSignup = $('btnSignup');
    if (btnSignup) {
      btnSignup.addEventListener('click', async function () {
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
          showAuthLoading(); disableBtn(btnSignup, true);
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
          disableBtn(btnSignup, false);
          const authLoading = $('authLoading');
          if (authLoading) authLoading.style.display = 'none';
        }
      });
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
      initAppUI();
      return;
    }
    const supabase = sb.client;
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) handleAuthUser(session.user);
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session && session.user) handleAuthUser(session.user);
      else if (event === 'SIGNED_OUT' || !session) handleAuthLogout();
      else if (event === 'USER_UPDATED' && session && session.user) handleAuthUser(session.user);
    });
  }

  async function handleAuthUser(user) {
    currentUser = user;
    if (window.__QS_SUPABASE) window.__QS_SUPABASE.user = user;
    if (!user.email_confirmed_at) {
      localStorage.removeItem('qs_session_active');
      document.body.classList.remove('mode-app');
      const loginScreen = $('loginScreen'), appScreen = document.querySelector('.app');
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appScreen) appScreen.style.display = 'none';
      showVerificationNotice(user.email);
      return;
    }
    localStorage.setItem('qs_session_active', 'true');
    document.body.classList.add('mode-app');
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
    document.dispatchEvent(new Event('qs:user:auth'));
  }

  function handleAuthLogout() {
    currentUser = null;
    if (window.__QS_SUPABASE) window.__QS_SUPABASE.user = null;
    localStorage.removeItem('qs_session_active');
    document.body.classList.remove('mode-app');
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
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch(e){} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch(e){} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    const barcodeScanLine = $('barcodeScanLine'), barcodeScannerModal = $('barcodeScannerModal');
    const barcodeResult = $('barcodeResult'), barcodeUseBtn = $('barcodeUseBtn');
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
    if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
    if (barcodeResult) barcodeResult.style.display = 'none';
    if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
    lastScannedBarcode = null;
    smartScanProduct = null;
  }

  function handleScanResult(result) {
    if (!result || !result.text) return;
    const scannedText = result.text;
    if (scannedText === lastScannedBarcode) return;
    lastScannedBarcode = scannedText;
    if(navigator.vibrate) navigator.vibrate(200);
    try {
      if (codeReader && codeReader.reset) codeReader.reset();
      if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
    } catch(e) { console.warn('Reset error', e); }
    const barcodeScanLine = $('barcodeScanLine');
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
    toast('Barcode scanned!', 'info', 900);
    const scannedStr = String(scannedText).trim();
    if (currentScanMode === 'form') {
      const invBarcode = $('invBarcode');
      if (invBarcode) { invBarcode.value = scannedStr; invBarcode.focus(); }
      stopScanner();
    } else if (currentScanMode === 'smart') {
      stopScanner();
      const product = state.products.find(p => p.barcode && String(p.barcode).trim() === scannedStr);
      if (product) {
        smartScanProduct = product;
        const smartModalItem = $('smartModalItem'), smartModalStock = $('smartModalStock');
        const smartScannerModal = $('smartScannerModal'), smartModalSellBtn = $('smartModalSellBtn');
        if (smartModalItem) smartModalItem.textContent = product.name;
        if (smartModalStock) smartModalStock.textContent = `${product.qty} in stock`;
        if (smartScannerModal) {
          smartScannerModal.style.display = 'flex';
          const modalEl = smartScannerModal.querySelector('.modal');
          if (modalEl) {
            let existingCloseBtn = modalEl.querySelector('.modal-close-x');
            if (!existingCloseBtn) {
              const closeBtn = createModalCloseButton(hideSmartModal);
              modalEl.insertBefore(closeBtn, modalEl.firstChild);
            }
          }
          if (smartModalSellBtn) smartModalSellBtn.textContent = 'Sell';
        }
      } else {
        toast('New barcode found. Add product.', 'info');
        showAddForm(true);
        const invBarcode = $('invBarcode');
        if (invBarcode) invBarcode.value = scannedText;
        setTimeout(()=> { const invName = $('invName'); if (invName) invName.focus(); }, 220);
      }
    }
  }

  async function startScanner(mode = 'form') {
    if (scannerActive) return;
    if (typeof window.ZXing === 'undefined') { toast('Barcode library not loaded.', 'error'); return; }
    currentScanMode = mode;
    lastScannedBarcode = null;
    smartScanProduct = null;
    try {
      const barcodeScannerModal = $('barcodeScannerModal'), barcodeResult = $('barcodeResult');
      const barcodeUseBtn = $('barcodeUseBtn'), barcodeScanLine = $('barcodeScanLine'), barcodeVideo = $('barcodeVideo');
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      
      const modalEl = barcodeScannerModal.querySelector('.modal');
      if (modalEl) {
        let existingCloseBtn = modalEl.querySelector('.modal-close-x');
        if (!existingCloseBtn) {
          const closeBtn = createModalCloseButton(stopScanner);
          modalEl.insertBefore(closeBtn, modalEl.firstChild);
        }
      }
      
      if (barcodeResult) barcodeResult.style.display = 'none';
      if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
      if (barcodeScanLine) barcodeScanLine.style.display = 'block';
      scannerActive = true;
      const hints = new Map();
      const formats = [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      codeReader = new ZXing.BrowserMultiFormatReader(hints);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(()=>{}); }
      if (codeReader.decodeFromVideoDevice) {
        try { codeReader.decodeFromVideoDevice(null, barcodeVideo, (result, err) => { if (result) handleScanResult(result); }); }
        catch (e) { try { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); }); } catch (ex) { throw ex; } }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); });
      } else { toast('Barcode scanner not supported', 'error'); stopScanner(); }
    } catch (e) { errlog('Barcode Scanner Error:', e); toast('Failed to start camera. Check permissions.', 'error'); stopScanner(); }
  }

  function initBarcodeScannerHandlers() {
    const primaryScanBtn = $('primaryScanBtn');
    if (primaryScanBtn) primaryScanBtn.addEventListener('click', () => startScanner('smart'));
    const scanBarcodeBtn = $('scanBarcodeBtn');
    if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', () => startScanner('form'));
    const barcodeCancelBtn = $('barcodeCancelBtn');
    if (barcodeCancelBtn) barcodeCancelBtn.addEventListener('click', stopScanner);
    const barcodeUseBtn = $('barcodeUseBtn');
    if (barcodeUseBtn) {
      barcodeUseBtn.addEventListener('click', function () {
        const invBarcode = $('invBarcode');
        if (lastScannedBarcode && invBarcode) invBarcode.value = lastScannedBarcode;
        stopScanner();
      });
    }
    const barcodeScannerModal = $('barcodeScannerModal');
    if (barcodeScannerModal) {
      barcodeScannerModal.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'barcodeScannerModal') stopScanner();
      });
    }
  }

  function hideSmartModal() {
    const smartScannerModal = $('smartScannerModal');
    if (smartScannerModal) smartScannerModal.style.display = 'none';
    smartScanProduct = null;
  }

  function initSmartScannerHandlers() {
    const smartModalCancel = $('smartModalCancel');
    if (smartModalCancel) smartModalCancel.addEventListener('click', hideSmartModal);
    const smartModalSellBtn = $('smartModalSellBtn');
    if (smartModalSellBtn) {
      smartModalSellBtn.addEventListener('click', () => {
        if (!smartScanProduct) return;
        const idToSell = smartScanProduct.id;
        hideSmartModal();
        openModalFor('sell', idToSell);
      });
    }
    const smartModalRestockBtn = $('smartModalRestockBtn');
    if (smartModalRestockBtn) {
      smartModalRestockBtn.addEventListener('click', () => {
        if (!smartScanProduct) return;
        const idToRestock = smartScanProduct.id;
        hideSmartModal();
        openModalFor('add', idToRestock);
      });
    }
  }

  function renderChips() {
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
  }

  let searchTimer = null;
  function scheduleRenderProducts() { clearTimeout(searchTimer); searchTimer = setTimeout(renderProducts, 120); }

  function renderProducts() {
    const productListEl = $('productList'), headerSearchInput = $('headerSearchInput');
    if (!productListEl) return;
    productListEl.innerHTML = '';
    const q = (headerSearchInput && headerSearchInput.value.trim().toLowerCase()) || '';
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
      modalConfirm.addEventListener('click', function () {
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

  function renderActivityLog() {
    const container = $('activityLogArea');
    if (!container) return;
    container.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; margin-top: 24px; color: var(--text-primary);">Activity History (Audit Log)</div>
      <div class="small" style="margin-bottom: 12px; color: var(--text-secondary);">Review recent actions. Click to view full log.</div>
      <div id="activityLogList" style="display: flex; flex-direction: column; gap: 0px; max-height: 300px; overflow-y: auto; border: 1px solid var(--border-glass); padding: 0; border-radius: var(--radius); background: var(--card-glass);"></div>
    `;
    const listEl = $('activityLogList'), logs = (state.logs || []).slice(0, 5);
    if (logs.length === 0) {
      listEl.innerHTML = '<div class="small" style="color: var(--text-muted); text-align: center; padding: 20px;">No activity recorded yet.</div>';
      return;
    }
    logs.forEach(log => {
      const row = document.createElement('div');
      row.style.cssText = "padding: 12px; background: var(--card-glass); border-bottom: 1px solid var(--border-glass); font-size: 13px; cursor: pointer; transition: background 0.2s;";
      const isSuspicious = log.action === 'Delete' || log.action === 'Undo';
      const color = isSuspicious ? '#ef4444' : 'var(--text-primary)';
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">
          <span>${formatDateTime(log.ts)}</span>
          <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(log.user)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <span style="font-weight: 600; color: ${color}">${escapeHtml(log.action)}</span>
          <span style="color: var(--text-secondary); font-size: 13px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(log.details)}</span>
        </div>
      `;
      listEl.appendChild(row);
    });
    setupActivityLogClick();
  }

  function openFullAuditLog() {
  const modal = $('fullAuditLogModal'), list = $('fullAuditLogList');
  if (!modal || !list) return;
  
  // FIX: Reset list styles to prevent border artifacts
  list.innerHTML = '';
  list.style.border = 'none'; 
  list.style.background = 'transparent';

  const logs = state.logs || [];
  if (logs.length === 0) {
      list.innerHTML = '<div class="small" style="padding:40px;text-align:center;color:var(--text-muted)">No activity recorded yet.</div>';
    } else {
      logs.forEach(log => {
        const row = document.createElement('div');
        row.className = 'full-log-row';
        const isSuspicious = log.action === 'Delete' || log.action === 'Undo';
        const actionColor = isSuspicious ? '#ef4444' : 'var(--text-primary)';
        row.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--text-muted)">${formatDateTime(log.ts)}</span>
            <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(log.user)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-weight:700;color:${actionColor}">${escapeHtml(log.action)}</span>
            <span style="color:var(--text-secondary);font-size:13px">${escapeHtml(log.details)}</span>
          </div>
        `;
        list.appendChild(row);
      });
    }
    modal.style.display = 'flex';
  }

  function closeFullAuditLog() {
    const modal = $('fullAuditLogModal');
    if (modal) modal.style.display = 'none';
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
    if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange(change);
    state.changes.push({ type: 'add', productId, qty, ts: Date.now() });
    addActivityLog('Restock', `Added ${qty} to ${p.name}`);
    await saveState();
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Added ${qty} to ${p.name}`);
  }

  async function doSell(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = p.qty - qty;
    const newSale = { productId, qty, price: window.n(p.price), cost: window.n(p.cost), ts: Date.now(), id: uid() };
    state.sales.push(newSale);
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: 'addSale', item: newSale });
      await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
    }
    state.changes.push({ type: 'sell', productId, qty, ts: newSale.ts });
    addActivityLog('Sale', `Sold ${qty} x ${p.name} (${fmt(newSale.price * qty)})`);
    await saveState();
    renderInventory(); renderProducts(); renderDashboard();
    toast(`Sold ${qty} × ${p.name}`);
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
        if (p && window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
        await saveState();
        renderInventory(); renderProducts(); renderDashboard();
        toast(`Reverted add of ${ch.qty}`);
        return;
      }
      if (ch.type === 'sell') {
        for (let j = state.sales.length - 1; j >= 0; j--) {
          const s = state.sales[j];
          if (s.productId === productId && s.qty === ch.qty && Math.abs(s.ts - ch.ts) < 120000) {
            const saleToRemove = state.sales.splice(j,1)[0];
            if (saleToRemove && window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'removeSale', item: saleToRemove });
            const p = state.products.find(x => x.id === productId);
            if (p) {
              p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
              addActivityLog('Undo', `Reverted Sale of ${ch.qty} ${p.name}`);
              if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
            }
            state.changes.splice(i,1);
            await saveState();
            renderInventory(); renderProducts(); renderDashboard();
            toast(`Reverted sale of ${ch.qty}`);
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
    const invImgInput = $('invImg'), invImgPreview = $('invImgPreview'), invImgPreviewImg = $('invImgPreviewImg');
    try { if (invImgInput) invImgInput.value = ''; } catch(e) {}
    if (invImgPreview) invImgPreview.style.display = 'none';
    if (invImgPreviewImg) invImgPreviewImg.src = '';
  }

  function initImageUploadHandler() {
    const invImgInput = $('invImg');
    if (!invImgInput) return;
    invImgInput.addEventListener('change', async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) { clearInvImage(); return; }
      const MAX_IMG_SIZE = 5 * 1024 * 1024;
      if (file.size > MAX_IMG_SIZE) { toast('Image too large (max 5MB).', 'error'); e.target.value = ''; return; }
      const supabase = getClient();
      if (!supabase || !currentUser) { toast('Storage not ready or user not logged in.', 'error'); return; }
      showLoading(true, 'Compressing & Uploading...');
      try {
        const compressedBlob = await compressImage(file);
        const fileName = `${currentUser.id}/${Date.now()}.jpg`;
        const { data, error } = await supabase.storage.from('user_images').upload(fileName, compressedBlob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('user_images').getPublicUrl(fileName);
        const downloadURL = urlData.publicUrl;
        showLoading(false);
        const invImgPreviewImg = $('invImgPreviewImg'), invImgPreview = $('invImgPreview');
        if (invImgPreviewImg) invImgPreviewImg.src = downloadURL;
        if (invImgPreview) invImgPreview.style.display = 'flex';
        toast('Image uploaded');
      } catch (err) { errlog('Image upload failed', err); toast('Image upload failed: ' + err.message, 'error'); showLoading(false); clearInvImage(); }
    });
    const invImgClear = $('invImgClear');
    if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });
  }

  function clearAddForm() {
    const invId = $('invId'), invName = $('invName'), invBarcode = $('invBarcode');
    const invPrice = $('invPrice'), invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory');
    const addProductBtn = $('addProductBtn'), cancelProductBtn = $('cancelProductBtn');
    if (invId) invId.value = '';
    if (invName) invName.value = '';
    if (invBarcode) invBarcode.value = '';
    if (invPrice) invPrice.value = '';
    if (invCost) invCost.value = '';
    if (invQty) invQty.value = '';
    if (invCategory) invCategory.value = 'Others';
    clearInvImage();
    editingProductId = null;
    if (addProductBtn) addProductBtn.textContent = 'Save Product';
    if (cancelProductBtn) cancelProductBtn.style.display = 'none';
  }

  function populateCategoryDropdown() {
    const invCategory = $('invCategory');
    if (!invCategory) return;
    invCategory.innerHTML = '';
    state.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      invCategory.appendChild(option);
    });
    if (!state.categories.includes('Others')) {
      const option = document.createElement('option');
      option.value = 'Others';
      option.textContent = 'Others';
      invCategory.appendChild(option);
    }
  }

  function validateProduct(name, price, cost, qty, barcode, currentId = null) {
    if (!name || name.trim().length === 0) return { valid: false, error: 'Product name is required' };
    if (price <= 0) return { valid: false, error: 'Price must be greater than 0' };
    if (cost < 0) return { valid: false, error: 'Cost cannot be negative' };
    if (qty < 0) return { valid: false, error: 'Stock cannot be negative' };
    if (barcode) {
      const checkBc = String(barcode).trim();
      const existing = state.products.find(p => p.barcode && String(p.barcode).trim() === checkBc && p.id !== currentId);
      if (existing) return { valid: false, error: `Barcode already used for "${existing.name}".` };
    }
    return { valid: true };
  }

  function initAddProductHandler() {
    const addProductBtn = $('addProductBtn'), cancelProductBtn = $('cancelProductBtn');
    if (addProductBtn) {
      addProductBtn.addEventListener('click', async function () {
        const invName = $('invName'), invBarcode = $('invBarcode'), invPrice = $('invPrice');
        const invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory'), invImgPreviewImg = $('invImgPreviewImg');
        const name = (invName && invName.value || '').trim();
        const barcode = (invBarcode && invBarcode.value || '').trim();
        const price = window.n(invPrice && invPrice.value);
        const cost = window.n(invCost && invCost.value);
        const qty = window.n(invQty && invQty.value);
        const category = (invCategory && invCategory.value) || 'Others';
        const image = (invImgPreviewImg && invImgPreviewImg.src) || null;
        const valid = validateProduct(name, price, cost, qty, barcode, editingProductId);
        if (!valid.valid) {
          const modal = addProductBtn.closest('.modal') || addProductBtn.closest('.add-card');
          toast(valid.error, 'error');
          if (modal) {
            modal.style.animation = 'shake 0.3s ease';
            setTimeout(() => { modal.style.animation = ''; }, 300);
          }
          return;
        }
        let product, syncType;
        if (editingProductId) {
          product = state.products.find(p => p.id === editingProductId);
          if (!product) { toast('Product to update not found', 'error'); return; }
          product.name = name;
          product.barcode = barcode;
          product.price = price;
          product.cost = cost;
          product.qty = qty;
          product.category = category;
          product.image = image;
          product.updatedAt = Date.now();
          syncType = 'updateProduct';
          addActivityLog('Edit', `Updated product: ${name}`);
          toast('Product updated');
        } else {
          product = { id: uid(), name, price, cost, qty: qty || 0, category, image: image, icon: null, barcode: barcode || null, createdAt: Date.now() };
          state.products.push(product);
          syncType = 'addProduct';
          addActivityLog('Create', `Created product: ${name}`);
          toast('Product saved');
        }
        if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: syncType, item: product });
        await saveState();
        hideAddForm();
        renderInventory(); renderProducts(); renderDashboard(); renderChips();
      });
    }
    if (cancelProductBtn) cancelProductBtn.addEventListener('click', hideAddForm);
  }

  function renderInventory() {
    const inventoryListEl = $('inventoryList'), headerSearchInput = $('headerSearchInput');
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    const q = (headerSearchInput && headerSearchInput.value.trim().toLowerCase()) || '';
    const items = (state.products || []).filter(p => {
      if (q && !(((p.name || '').toLowerCase().includes(q)) || ((p.barcode || '') + '').includes(q))) return false;
      return true;
    });
    if (!items || items.length === 0) {
      const no = document.createElement('div');
      no.className = 'small';
      no.style.padding = '12px';
      no.style.background = 'var(--card-glass)';
      no.style.borderRadius = '12px';
      no.style.border = '1px solid var(--border-glass)';
      no.textContent = 'No products in inventory';
      inventoryListEl.appendChild(no);
      return;
    }
    for (const p of items) {
      const el = document.createElement('div');
      el.className = 'inventory-card';
      const top = document.createElement('div');
      top.className = 'inventory-top';
      const thumb = document.createElement('div');
      thumb.className = 'p-thumb';
      if (p.image) {
        const img = document.createElement('img');
        img.src = p.image;
        img.alt = p.name || '';
        img.crossOrigin = 'anonymous';
        thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase());
      }
      const info = document.createElement('div');
      info.className = 'inventory-info';
      const nme = document.createElement('div');
      nme.className = 'inventory-name';
      nme.textContent = p.name || 'Unnamed';
      const meta = document.createElement('div');
      meta.className = 'inventory-meta';
      meta.textContent = `${p.qty || 0} in stock • ${fmt(p.price)}`;
      info.appendChild(nme);
      info.appendChild(meta);
      if (p.barcode) {
        const bc = document.createElement('div');
        bc.className = 'small';
        bc.style.marginTop = '4px';
        bc.style.color = 'var(--muted)';
        bc.textContent = 'Barcode: ' + p.barcode;
        info.appendChild(bc);
      }
      top.appendChild(thumb);
      top.appendChild(info);
      const actions = document.createElement('div');
      actions.className = 'inventory-actions';
      const restock = document.createElement('button');
      restock.className = 'btn-restock';
      restock.type = 'button';
      restock.textContent = 'Restock';
      restock.dataset.restock = p.id;
      const edit = document.createElement('button');
      edit.className = 'btn-edit';
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.dataset.edit = p.id;
      const del = document.createElement('button');
      del.className = 'btn-delete';
      del.type = 'button';
      del.textContent = 'Delete';
      del.dataset.delete = p.id;
      actions.appendChild(restock);
      actions.appendChild(edit);
      actions.appendChild(del);
      el.appendChild(top);
      el.appendChild(actions);
      inventoryListEl.appendChild(el);
    }
  }

  function initInventoryListHandlers() {
    const inventoryListEl = $('inventoryList');
    if (inventoryListEl) {
      inventoryListEl.addEventListener('click', function (ev) {
        const restock = ev.target.closest('[data-restock]');
        if (restock) { openModalFor('add', restock.dataset.restock); return; }
        const edit = ev.target.closest('[data-edit]');
        if (edit) { openEditProduct(edit.dataset.edit); return; }
        const del = ev.target.closest('[data-delete]');
        if (del) { removeProduct(del.dataset.delete); return; }
      });
    }
  }

  function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) { toast('Product not found', 'error'); return; }
    editingProductId = p.id;
    populateCategoryDropdown();
    const invId = $('invId'), invName = $('invName'), invBarcode = $('invBarcode');
    const invPrice = $('invPrice'), invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory');
    const invImgPreviewImg = $('invImgPreviewImg'), invImgPreview = $('invImgPreview');
    const addProductBtn = $('addProductBtn'), cancelProductBtn = $('cancelProductBtn');
    if (invId) invId.value = p.id;
    if (invName) invName.value = p.name || '';
    if (invBarcode) invBarcode.value = p.barcode || '';
    if (invPrice) invPrice.value = p.price || '';
    if (invCost) invCost.value = p.cost || '';
    if (invQty) invQty.value = p.qty || 0;
    if (invCategory) invCategory.value = p.category || 'Others';
    if (p.image) {
      if (invImgPreviewImg) invImgPreviewImg.src = p.image;
      if (invImgPreview) invImgPreview.style.display = 'flex';
    } else {
      clearInvImage();
    }
    if (addProductBtn) addProductBtn.textContent = 'Update Product';
    if (cancelProductBtn) cancelProductBtn.style.display = 'block';
    showAddForm(true);
    setTimeout(()=> { try { if (invName) invName.focus(); } catch(e) {} }, 220);
  }

  async function removeProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    const confirmed = await showConfirm({
      title: `Delete ${p.name}?`,
      message: 'This will permanently remove the product and all its sales history. This action cannot be undone.',
      okText: 'Delete Product',
      okDanger: true
    });
    if (!confirmed) return;
    const productToRemove = { ...p };
    state.products = state.products.filter(x => x.id !== id);
    state.sales = state.sales.filter(s => s.productId !== id);
    state.changes = state.changes.filter(c => c.productId !== id);
    if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'removeProduct', item: productToRemove });
    addActivityLog('Delete', `Deleted product: ${p.name}`);
    await saveState();
    renderInventory(); renderProducts(); renderDashboard(); renderChips();
    toast('Product deleted');
  }

  function renderDashboard() {
    const dashRevenueEl = $('dashRevenue'), dashProfitEl = $('dashProfit'), dashTopEl = $('dashTop');
    const since = startOfDay(Date.now());
    const salesToday = (state.sales || []).filter(s => s.ts >= since);
    const revenue = salesToday.reduce((a,s)=>a + (window.n(s.price) * window.n(s.qty)), 0);
    const cost = salesToday.reduce((a,s)=>a + (window.n(s.cost) * window.n(s.qty)), 0);
    const profit = revenue - cost;
    if (dashRevenueEl) dashRevenueEl.textContent = fmt(revenue);
    if (dashProfitEl) dashProfitEl.textContent = fmt(profit);
    const overallByProd = {};
    (state.sales||[]).forEach(s => overallByProd[s.productId] = (overallByProd[s.productId]||0) + s.qty);
    const overallArr = Object.entries(overallByProd).sort((a,b)=>b[1]-a[1]);
    let topName = '—';
    if (overallArr.length > 0 && overallArr[0]) {
      const topId = overallArr[0][0];
      const topProd = state.products.find(p => p.id === topId);
      if (topProd) topName = topProd.name;
      else topName = 'N/A (Deleted)';
    }
    if (dashTopEl) dashTopEl.textContent = topName;
  }

  function renderNotes() {
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
  }

  function initNotesHandlers() {
    // Notes IDs used in the DOM:
    //   noteTitle       → title text input
    //   noteContentInput → content textarea  (DOM id; NOT "noteContent")
    //   noteSaveBtn     → save / update button
    //   noteCancelBtn   → cancel edit button
    // All references below use noteContentInput to match the DOM.

    const notesListEl = $('notesList');
    if (notesListEl) {
      notesListEl.addEventListener('click', async function(e) {
        const editBtn = e.target.closest('[data-edit-note]');
        if (editBtn) {
          const id = editBtn.dataset.editNote;
          const note = state.notes.find(n=>n.id===id);
          if (!note) return;
          const noteTitle = $('noteTitleInput');
          const noteContent = $('noteContentInput');  // FIX: was 'noteContent', DOM id is noteContentInput
          const noteSaveBtn = $('noteSaveBtn');
          if (noteTitle) noteTitle.value = note.title || '';
          if (noteContent) noteContent.value = note.content || '';  // FIX: was null-ref crash when element not found
          editingNoteId = note.id;
          if (noteSaveBtn) noteSaveBtn.textContent = 'Update Note';
          setActiveView('notes', true);
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
          state.notes = state.notes.filter(n => n.id !== delBtn.dataset.deleteNote);
          saveState();
          renderNotes();
          toast('Note deleted');
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

        // FIX: resolve to the correct DOM id 'noteContentInput'
        const noteTitle = $('noteTitleInput');
        const noteContent = $('noteContentInput');  // FIX: was 'noteContent'

        const title = (noteTitle ? noteTitle.value : '').trim();
        // FIX: guard against null ref — content is empty string when element missing
        const content = (noteContent ? noteContent.value : '').trim();

        if (!content) { toast('Please write something in the note', 'error'); return; }

        _noteSaving = true;
        noteSaveBtn.disabled = true;
        try {
          if (editingNoteId) {
            const note = state.notes.find(n=>n.id===editingNoteId);
            if (note) { note.title = title; note.content = content; note.ts = Date.now(); }
            editingNoteId = null;
            noteSaveBtn.textContent = 'Save Note';
            toast('Note updated');
          } else {
            state.notes.push({ id: uid(), title, content, ts: Date.now() });
            toast('Note saved');
          }
          if (noteTitle) noteTitle.value = '';
          if (noteContent) noteContent.value = '';
          await saveState();
          renderNotes();
        } finally {
          _noteSaving = false;
          noteSaveBtn.disabled = false;
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
    const container = $('categoryEditorArea');
    if (!container) return;
    container.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Manage Categories</div>
      <div class="small" style="margin-bottom: 12px; color: var(--text-secondary);">Add, rename, or delete categories. Deleting a category will move its products to "Others".</div>
      <div id="categoryList" style="display: flex; flex-direction: column; gap: 8px;"></div>
      <div class="add-row" style="margin-top: 16px;">
        <input id="newCategoryName" type="text" placeholder="New category name" style="flex: 1;" class="auth-input" />
        <button id="addCategoryBtn" class="save-btn">Add</button>
      </div>
    `;
    const listEl = $('categoryList');
    const categoriesToEdit = state.categories.filter(c => c.toLowerCase() !== 'others');
    categoriesToEdit.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'add-row';
      row.innerHTML = `
        <input type="text" class="auth-input category-name-input" data-original-name="${escapeHtml(cat)}" value="${escapeHtml(cat)}" style="flex: 1;" />
        <button class="btn-undo category-rename-btn" data-original-name="${escapeHtml(cat)}">Rename</button>
        <button class="btn-delete category-delete-btn" data-name="${escapeHtml(cat)}">Delete</button>
      `;
      listEl.appendChild(row);
    });
    const addCategoryBtn = $('addCategoryBtn');
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', handleAddCategory);
    container.querySelectorAll('.category-rename-btn').forEach(btn => btn.addEventListener('click', handleRenameCategory));
    container.querySelectorAll('.category-delete-btn').forEach(btn => btn.addEventListener('click', handleDeleteCategory));
    renderActivityLog();
  }

  async function handleAddCategory() {
    const input = $('newCategoryName');
    const btn = $('addCategoryBtn');
    if (!input) return;
    const newName = input.value.trim();
    if (!newName) { toast('Please enter a category name', 'error'); return; }
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

  async function handleRenameCategory(e) {
    const oldName = e.target.dataset.originalName;
    const input = e.target.closest('.add-row').querySelector('.category-name-input');
    const newName = input.value.trim();
    if (!newName) { toast('Category name cannot be empty', 'error'); input.value = oldName; return; }
    if (newName.toLowerCase() === oldName.toLowerCase()) return;
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) { toast('Category name already exists', 'error'); input.value = oldName; return; }
    if (newName.toLowerCase() === 'others') { toast('Cannot rename to "Others"', 'error'); input.value = oldName; return; }
    const index = state.categories.findIndex(c => c.toLowerCase() === oldName.toLowerCase());
    if (index > -1) state.categories[index] = newName;
    state.products.forEach(p => { if (p.category === oldName) p.category = newName; });
    await saveState();
    toast('Category renamed');
    renderCategoryEditor(); renderChips(); renderProducts(); renderInventory();
  }

  async function handleDeleteCategory(e) {
    const name = e.target.dataset.name;
    const confirmed = await showConfirm({
      title: `Delete ${name}?`,
      message: `All products in "${name}" will be moved to "Others". This cannot be undone.`,
      okText: 'Delete Category',
      okDanger: true
    });
    if (!confirmed) return;
    state.categories = state.categories.filter(c => c.toLowerCase() !== name.toLowerCase());
    state.products.forEach(p => { if (p.category === name) p.category = 'Others'; });
    await saveState();
    toast('Category deleted');
    renderCategoryEditor(); renderChips(); renderProducts(); renderInventory();
  }

  function cleanupViewState() {
    editingNoteId = null;
    editingProductId = null;
    modalContext = null;
    hideModal();
    hideAddForm();
    stopScanner();
    closeInventoryInsight();
    const headerSearchInput = $('headerSearchInput');
    if (headerSearchInput) headerSearchInput.value = '';
  }

  function setActiveView(view, resetScroll = false) {
    cleanupViewState();
    const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
    const headerSearchInput = $('headerSearchInput'), chipsEl = $('chips');
    navButtons.forEach(b => {
      const isActive = b.dataset.view === view;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true':'false');
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $(view + 'Panel');
    if (panel) panel.classList.add('active');
    const isHome = view === 'home', isInv = view === 'inventory';
    if (headerSearchInput) {
      headerSearchInput.style.display = (isHome || isInv) ? 'block' : 'none';
      headerSearchInput.value = '';
    }
    if (chipsEl) chipsEl.style.display = isHome ? 'flex' : 'none';
    if (view === 'reports') renderReports();
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
  }

  function renderTop3Products(start, end) {
    const salesInRange = getSalesInRange(start, end);
    const productPerformance = {};
    salesInRange.forEach(s => {
      if (!productPerformance[s.productId]) {
        productPerformance[s.productId] = { qty: 0, revenue: 0, profit: 0 };
      }
      productPerformance[s.productId].qty += s.qty;
      productPerformance[s.productId].revenue += (s.price * s.qty);
      productPerformance[s.productId].profit += ((s.price - s.cost) * s.qty);
    });

    const topPerformers = Object.entries(productPerformance)
      .sort((a, b) => b[1].profit - a[1].profit)
      .slice(0, 3);

    if (topPerformers.length === 0) {
      return '<div class="small" style="padding:20px;text-align:center;color:var(--text-muted)">No sales in this period</div>';
    }

    let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
    topPerformers.forEach((entry, idx) => {
      const [productId, metrics] = entry;
      const product = state.products.find(p => p.id === productId);
      const productName = product ? product.name : 'Unknown Product';
      const medal = ['🥇', '🥈', '🥉'][idx];

      html += `
        <div style="padding:12px;background:var(--card-glass);border-radius:8px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border-glass);">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">${medal}</span>
            <div>
              <div style="font-weight:600;color:var(--text-primary);">${escapeHtml(productName)}</div>
              <div class="small" style="color:var(--text-secondary);">${metrics.qty} units sold</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;color:var(--accent-emerald);font-size:16px;">${fmt(metrics.profit)}</div>
            <div class="small" style="color:var(--text-muted);">profit</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    return html;
  }

  function renderReports(range = currentReportRange) {
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
      wrap.className = 'report-summary-cards';
      const cardR = document.createElement('div');
      cardR.className = 'report-card';
      cardR.innerHTML = `<div class="small">Revenue (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.revenue)}</div>`;
      const cardP = document.createElement('div');
      cardP.className = 'report-card';
      cardP.innerHTML = `<div class="small">Profit (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.profit)}</div>`;
      const cardU = document.createElement('div');
      cardU.className = 'report-card';
      cardU.innerHTML = `<div class="small">Units (range)</div><div style="font-weight:700;margin-top:6px">${totalMetrics.units}</div>`;
      wrap.appendChild(cardR); wrap.appendChild(cardP); wrap.appendChild(cardU);
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
    newTop3Container.innerHTML = '<div style="font-weight:700;margin-bottom:12px;color:var(--text-primary);">🏆 Top 3 Products (by profit)</div>' + renderTop3Products(rangeStart, rangeEnd);
    
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
      const reportsPanel = $('reportsPanel');
      if (reportsPanel) reportsPanel.style.paddingBottom = '100px';
      reportBreakdown.style.paddingBottom = '24px';
    }
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

// FIND THIS FUNCTION (around line 1650-2100) and REPLACE IT COMPLETELY:

function generateAdvancedInsights(returnHtml = false) {
  try {
    const s = state || { products: [], sales: [], notes: [] };
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:20px 0;';

    const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const last60Days = Date.now() - (60 * 24 * 60 * 60 * 1000);
    const salesLast30 = s.sales.filter(sale => sale.ts >= last30Days);
    const revenueLast30 = salesLast30.reduce((sum, sale) => sum + (sale.price * sale.qty), 0);
    const profitLast30 = salesLast30.reduce((sum, sale) => sum + ((sale.price - sale.cost) * sale.qty), 0);

    // EXECUTIVE SUMMARY
    const criticalIssues = [];
    const highPriority = [];
    const opportunities = [];

    // Collect all issues
    s.products.forEach(p => {
      if (p.qty === 0) {
        const last30Sales = s.sales.filter(sale => sale.productId === p.id && sale.ts >= last30Days);
        const dailyVelocity = last30Sales.length > 0 ? last30Sales.reduce((sum, sale) => sum + sale.qty, 0) / 30 : 0;
        const lostPerDay = Math.round(dailyVelocity * p.price);
        const reorderQty = Math.ceil(dailyVelocity * 14);
        criticalIssues.push({ type: 'outofstock', product: p, lostPerDay, reorderQty, dailyVelocity });
      } else {
        const pred = calculateStockoutPrediction(p);
        if (pred && pred.daysUntilStockout <= 2) {
          const lostPerDay = Math.round(pred.dailyRate * p.price);
          const reorderQty = Math.ceil(pred.dailyRate * 14);
          criticalIssues.push({ type: 'stockout48', product: p, pred, lostPerDay, reorderQty });
        } else if (pred && pred.daysUntilStockout <= 7) {
          const reorderQty = Math.ceil(pred.dailyRate * 14);
          highPriority.push({ type: 'stockout7', product: p, pred, reorderQty });
        }
      }

      const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
      if (margin < 0) {
        const lossPerUnit = p.cost - p.price;
        const monthlySales = s.sales.filter(sale => sale.productId === p.id && sale.ts >= last30Days).reduce((sum, sale) => sum + sale.qty, 0);
        const monthlyLoss = lossPerUnit * monthlySales;
        const suggestedPrice = Math.ceil(p.cost * 1.3);
        criticalIssues.push({ type: 'negativemargin', product: p, lossPerUnit, monthlyLoss, suggestedPrice });
      }

      const hasSales = s.sales.some(sale => sale.productId === p.id && sale.ts >= last60Days);
      if (!hasSales && p.qty > 0) {
        const tiedCapital = p.cost * p.qty;
        const opportunityCost = Math.round((tiedCapital * 0.15) / 365 * 60);
        const discountPrice = Math.floor(p.price * 0.85);
        highPriority.push({ type: 'deadstock', product: p, tiedCapital, opportunityCost, discountPrice });
      }

      const industryBenchmarks = { Groceries: 35, Drinks: 40, Clothing: 50, Snacks: 30, Others: 30 };
      const benchmark = industryBenchmarks[p.category] || 30;
      if (margin > 0 && margin < benchmark - 5) {
        const suggestedPrice = Math.ceil(p.cost / (1 - benchmark / 100));
        const priceIncrease = suggestedPrice - p.price;
        const monthlySales = s.sales.filter(sale => sale.productId === p.id && sale.ts >= last30Days).reduce((sum, sale) => sum + sale.qty, 0);
        const monthlyImpact = priceIncrease * monthlySales;
        highPriority.push({ type: 'lowmargin', product: p, margin, benchmark, suggestedPrice, monthlyImpact });
      }
    });

    const deadStockValue = highPriority.filter(i => i.type === 'deadstock').reduce((sum, i) => sum + i.tiedCapital, 0);
    const projectedRevenue = revenueLast30 * 1.0;

    const execSection = document.createElement('div');
    execSection.style.cssText = 'background:linear-gradient(135deg,rgba(16,185,129,0.15),rgba(99,102,241,0.15));padding:16px;border-radius:10px;border:2px solid var(--accent-emerald);';
    execSection.innerHTML = `
      <div style="font-size:20px;font-weight:700;margin-bottom:12px;color:#fff;">📋 Executive Summary</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;">
          <div class="small" style="color:rgba(255,255,255,0.7);">Critical Issues</div>
          <div style="font-size:24px;font-weight:700;color:#ef4444;">${criticalIssues.length}</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;">
          <div class="small" style="color:rgba(255,255,255,0.7);">High Priority</div>
          <div style="font-size:24px;font-weight:700;color:#f59e0b;">${highPriority.length}</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;">
          <div class="small" style="color:rgba(255,255,255,0.7);">30-Day Revenue</div>
          <div style="font-size:18px;font-weight:700;color:#10b981;">${fmt(revenueLast30)}</div>
        </div>
        <div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;">
          <div class="small" style="color:rgba(255,255,255,0.7);">Capital at Risk</div>
          <div style="font-size:18px;font-weight:700;color:#f59e0b;">${fmt(deadStockValue)}</div>
        </div>
      </div>
    `;
    wrap.appendChild(execSection);

    // CRITICAL ACTIONS - GROUPED
    if (criticalIssues.length > 0) {
      const criticalSection = document.createElement('div');
      criticalSection.style.cssText = 'background:rgba(239,68,68,0.1);padding:16px;border-radius:10px;border-left:4px solid #ef4444;';
      criticalSection.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><span style="font-size:18px;">🔴</span><span style="font-size:18px;font-weight:700;color:#fff;">Critical Actions (24-48hrs)</span></div>';

      const outOfStock = criticalIssues.filter(i => i.type === 'outofstock');
      const stockout48 = criticalIssues.filter(i => i.type === 'stockout48');
      const negativeMargin = criticalIssues.filter(i => i.type === 'negativemargin');

      if (outOfStock.length > 0) {
        const totalLoss = outOfStock.reduce((sum, i) => sum + i.lostPerDay, 0);
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(239,68,68,0.3);';
        box.innerHTML = `
          <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">⛔ Out of Stock Now (${outOfStock.length} items)</div>
          <div class="small" style="color:rgba(255,255,255,0.8);margin-bottom:10px;">Combined revenue loss: <strong>${fmt(totalLoss)}/day</strong></div>
        `;
        
        outOfStock.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(239,68,68,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">Loss: ${fmt(item.lostPerDay)}/day • Reorder: ${item.reorderQty} units</div>
            </div>
            <button class="ai-action-btn" data-action="restock" data-product-id="${item.product.id}" data-qty="${item.reorderQty}" style="background:#10b981;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              📦 ${item.reorderQty}
            </button>
          `;
          box.appendChild(row);
        });

        criticalSection.appendChild(box);
      }

      if (stockout48.length > 0) {
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(239,68,68,0.3);';
        box.innerHTML = `<div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:10px;">🔴 Stockout in 48hrs (${stockout48.length} items)</div>`;
        
        stockout48.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(239,68,68,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">${item.pred.daysUntilStockout} days left • ${item.pred.dailyRate.toFixed(1)}/day • ${item.product.qty} in stock</div>
            </div>
            <button class="ai-action-btn" data-action="restock" data-product-id="${item.product.id}" data-qty="${item.reorderQty}" style="background:#10b981;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              📦 ${item.reorderQty}
            </button>
          `;
          box.appendChild(row);
        });

        criticalSection.appendChild(box);
      }

      if (negativeMargin.length > 0) {
        const totalLoss = negativeMargin.reduce((sum, i) => sum + i.monthlyLoss, 0);
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(239,68,68,0.3);';
        box.innerHTML = `
          <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">💸 Negative Margins (${negativeMargin.length} items)</div>
          <div class="small" style="color:rgba(255,255,255,0.8);margin-bottom:10px;">Monthly loss: <strong>${fmt(totalLoss)}</strong></div>
        `;
        
        negativeMargin.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(239,68,68,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">Cost: ${fmt(item.product.cost)} > Price: ${fmt(item.product.price)} • Fix: ${fmt(item.suggestedPrice)}</div>
            </div>
            <button class="ai-action-btn" data-action="edit" data-product-id="${item.product.id}" data-price="${item.suggestedPrice}" style="background:#10b981;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              💰 Fix
            </button>
          `;
          box.appendChild(row);
        });

        criticalSection.appendChild(box);
      }

      wrap.appendChild(criticalSection);
    }

    // HIGH PRIORITY - GROUPED
    if (highPriority.length > 0) {
      const highSection = document.createElement('div');
      highSection.style.cssText = 'background:rgba(245,158,11,0.1);padding:16px;border-radius:10px;border-left:4px solid #f59e0b;';
      highSection.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><span style="font-size:18px;">🟡</span><span style="font-size:18px;font-weight:700;color:#fff;">High Priority (This Week)</span></div>';

      const stockout7 = highPriority.filter(i => i.type === 'stockout7');
      const deadStock = highPriority.filter(i => i.type === 'deadstock');
      const lowMargin = highPriority.filter(i => i.type === 'lowmargin');

      if (stockout7.length > 0) {
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(245,158,11,0.3);';
        box.innerHTML = `<div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:10px;">⚠️ Stockout in 3-7 days (${stockout7.length} items)</div>`;
        
        stockout7.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(245,158,11,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">${item.pred.daysUntilStockout} days • ${item.pred.dailyRate.toFixed(1)}/day • ${item.product.qty} stock</div>
            </div>
            <button class="ai-action-btn" data-action="restock" data-product-id="${item.product.id}" data-qty="${item.reorderQty}" style="background:#f59e0b;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              📦 ${item.reorderQty}
            </button>
          `;
          box.appendChild(row);
        });

        highSection.appendChild(box);
      }

      if (deadStock.length > 0) {
        const totalTied = deadStock.reduce((sum, i) => sum + i.tiedCapital, 0);
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(245,158,11,0.3);';
        box.innerHTML = `
          <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">💤 Dead Stock 60+ days (${deadStock.length} items)</div>
          <div class="small" style="color:rgba(255,255,255,0.8);margin-bottom:10px;">Capital tied up: <strong>${fmt(totalTied)}</strong></div>
        `;
        
        deadStock.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(245,158,11,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">${fmt(item.tiedCapital)} locked • Flash sale: ${fmt(item.discountPrice)} (15% off)</div>
            </div>
            <button class="ai-action-btn" data-action="edit" data-product-id="${item.product.id}" data-price="${item.discountPrice}" style="background:#f59e0b;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              🏷️ Discount
            </button>
          `;
          box.appendChild(row);
        });

        highSection.appendChild(box);
      }

      if (lowMargin.length > 0) {
        const totalImpact = lowMargin.reduce((sum, i) => sum + i.monthlyImpact, 0);
        const box = document.createElement('div');
        box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(245,158,11,0.3);';
        box.innerHTML = `
          <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">📊 Below Industry Margin (${lowMargin.length} items)</div>
          <div class="small" style="color:rgba(255,255,255,0.8);margin-bottom:10px;">Potential monthly gain: <strong>${fmt(totalImpact)}</strong></div>
        `;
        
        lowMargin.forEach(item => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(245,158,11,0.15);border-radius:6px;margin-bottom:6px;';
          row.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:600;color:#fff;font-size:14px;">${escapeHtml(item.product.name)}</div>
              <div class="small" style="color:rgba(255,255,255,0.7);">${item.margin.toFixed(1)}% vs ${item.benchmark}% industry • Optimize: ${fmt(item.suggestedPrice)}</div>
            </div>
            <button class="ai-action-btn" data-action="edit" data-product-id="${item.product.id}" data-price="${item.suggestedPrice}" style="background:#f59e0b;border:0;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;white-space:nowrap;">
              💰 Optimize
            </button>
          `;
          box.appendChild(row);
        });

        highSection.appendChild(box);
      }

      wrap.appendChild(highSection);
    }

    // OPPORTUNITIES - COMPACT
    const oppSection = document.createElement('div');
    oppSection.style.cssText = 'background:rgba(16,185,129,0.1);padding:16px;border-radius:10px;border-left:4px solid #10b981;';
    oppSection.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><span style="font-size:18px;">🟢</span><span style="font-size:18px;font-weight:700;color:#fff;">Growth Opportunities</span></div>';
    
    const productPerformance = {};
    s.sales.forEach(sale => {
      if (!productPerformance[sale.productId]) {
        productPerformance[sale.productId] = { qty: 0, profit: 0 };
      }
      productPerformance[sale.productId].qty += sale.qty;
      productPerformance[sale.productId].profit += ((sale.price - sale.cost) * sale.qty);
    });
    
    const topPerformers = Object.entries(productPerformance).sort((a, b) => b[1].profit - a[1].profit).slice(0, 3);
    
    if (topPerformers.length > 0) {
      const box = document.createElement('div');
      box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(16,185,129,0.3);';
      box.innerHTML = '<div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:8px;">🏆 Top 3 Profit Drivers</div>';
      
      topPerformers.forEach((entry, idx) => {
        const [productId, metrics] = entry;
        const product = s.products.find(p => p.id === productId);
        const productName = product ? product.name : 'Unknown';
        const medal = ['🥇', '🥈', '🥉'][idx];
        
        box.innerHTML += `
          <div style="display:flex;justify-content:space-between;padding:6px 8px;background:rgba(16,185,129,0.1);border-radius:6px;margin-bottom:4px;">
            <span style="font-size:14px;color:#fff;">${medal} ${escapeHtml(productName)}</span>
            <span style="font-weight:700;color:#10b981;font-size:14px;">${fmt(metrics.profit)}</span>
          </div>
        `;
      });
      
      oppSection.appendChild(box);
    }

    const avgTransactionValue = s.sales.length > 0 ? s.sales.reduce((sum, sale) => sum + (sale.price * sale.qty), 0) / s.sales.length : 0;
    if (avgTransactionValue > 0) {
      const targetValue = Math.ceil(avgTransactionValue * 1.2);
      const monthlyImpact = (targetValue - avgTransactionValue) * salesLast30.length;
      
      const box = document.createElement('div');
      box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;margin-bottom:10px;border:1px solid rgba(16,185,129,0.3);';
      box.innerHTML = `
        <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">🛒 Transaction Value Opportunity</div>
        <div class="small" style="color:rgba(255,255,255,0.9);line-height:1.5;">
          Current avg: ${fmt(avgTransactionValue)} → Target: ${fmt(targetValue)} (+20%)<br>
          Monthly impact: <strong>${fmt(monthlyImpact)}</strong> via bundling & upselling
        </div>
      `;
      oppSection.appendChild(box);
    }

    const hoursAnalysis = {};
    s.sales.forEach(sale => {
      const hour = new Date(sale.ts).getHours();
      if (!hoursAnalysis[hour]) hoursAnalysis[hour] = 0;
      hoursAnalysis[hour]++;
    });
    
    const hourEntries = Object.entries(hoursAnalysis).sort((a, b) => b[1] - a[1]);
    if (hourEntries.length > 0) {
      const peakHour = parseInt(hourEntries[0][0]);
      const peakPercentage = ((hourEntries[0][1] / s.sales.length) * 100).toFixed(0);
      const formatHour = (h) => `${h % 12 || 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;
      
      const box = document.createElement('div');
      box.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;border:1px solid rgba(16,185,129,0.3);';
      box.innerHTML = `
        <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:6px;">🕐 Peak Hour: ${formatHour(peakHour)}</div>
        <div class="small" style="color:rgba(255,255,255,0.9);">
          ${peakPercentage}% of sales happen here. Staff up ${formatHour(peakHour-1)}-${formatHour(peakHour+2)}
        </div>
      `;
      oppSection.appendChild(box);
    }

    wrap.appendChild(oppSection);

    // FINANCIAL SNAPSHOT - COMPACT
    const salesLast60 = s.sales.filter(sale => sale.ts >= last60Days && sale.ts < last30Days);
    const revenueLast60 = salesLast60.reduce((sum, sale) => sum + (sale.price * sale.qty), 0);
    const growthRate = revenueLast60 > 0 ? ((revenueLast30 - revenueLast60) / revenueLast60) * 100 : 0;
    const avgMargin = revenueLast30 > 0 ? ((profitLast30 / revenueLast30) * 100).toFixed(1) : 0;

    const finSection = document.createElement('div');
    finSection.style.cssText = 'background:rgba(99,102,241,0.1);padding:16px;border-radius:10px;border-left:4px solid #6366f1;';
    finSection.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><span style="font-size:18px;">💰</span><span style="font-size:18px;font-weight:700;color:#fff;">Financial Snapshot (30 days)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;text-align:center;">
          <div class="small" style="color:rgba(255,255,255,0.7);margin-bottom:4px;">Revenue</div>
          <div style="font-size:18px;font-weight:700;color:#10b981;">${fmt(revenueLast30)}</div>
        </div>
        <div style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;text-align:center;">
          <div class="small" style="color:rgba(255,255,255,0.7);margin-bottom:4px;">Profit</div>
          <div style="font-size:18px;font-weight:700;color:#6366f1;">${fmt(profitLast30)}</div>
        </div>
        <div style="background:rgba(0,0,0,0.4);padding:10px;border-radius:6px;text-align:center;">
          <div class="small" style="color:rgba(255,255,255,0.7);margin-bottom:4px;">Margin</div>
          <div style="font-size:18px;font-weight:700;color:#f59e0b;">${avgMargin}%</div>
        </div>
      </div>
      <div style="background:rgba(99,102,241,0.15);padding:10px;border-radius:6px;margin-top:10px;text-align:center;">
        <div class="small" style="color:rgba(255,255,255,0.9);">
          Growth: <strong style="color:${growthRate >= 0 ? '#10b981' : '#ef4444'};">${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%</strong> vs previous period
        </div>
      </div>
    `;
    
    wrap.appendChild(finSection);

    if (returnHtml) {
      return wrap.outerHTML;
    }
    
    const aiContent = $('aiContent');
    if (aiContent) {
      aiContent.innerHTML = '';
      aiContent.appendChild(wrap);
      
      setTimeout(() => {
        const actionButtons = aiContent.querySelectorAll('.ai-action-btn');
        actionButtons.forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            const action = this.dataset.action;
            const productId = this.dataset.productId;
            const qty = this.dataset.qty;
            const price = this.dataset.price;
            
            closeInventoryInsight();
            
            setTimeout(() => {
              if (action === 'restock') {
                openModalFor('add', productId);
                setTimeout(() => {
                  const qtyInput = $('modalQty');
                  if (qtyInput) {
                    qtyInput.value = qty;
                    qtyInput.focus();
                  }
                }, 100);
              } else if (action === 'edit') {
                openEditProduct(productId);
                setTimeout(() => {
                  const priceInput = $('invPrice');
                  if (priceInput && price) {
                    priceInput.value = price;
                    priceInput.focus();
                    priceInput.select();
                  }
                }, 200);
              }
            }, 100);
          });
        });
      }, 100);
    }

  } catch (e) {
    errlog('generateAdvancedInsights failed', e);
    toast('Failed to generate insights', 'error');
    if (returnHtml) {
      const errEl = document.createElement('div');
      errEl.className = 'small error-text';
      errEl.textContent = 'Failed to generate insights.';
      return errEl.outerHTML;
    }
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
    const headerSearchInput = $('headerSearchInput');
    if (headerSearchInput) {
      headerSearchInput.addEventListener('input', function() {
        const currentView = document.querySelector('.panel.active')?.id;
        if (currentView === 'inventoryPanel') renderInventory();
        else if (currentView === 'homePanel') scheduleRenderProducts();
      });
    }
  }

  function initToggleAddFormHandler() {
    const toggleAddFormBtn = $('toggleAddFormBtn');
    if (toggleAddFormBtn) {
      toggleAddFormBtn.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          editingProductId = null;
          clearAddForm();
          showAddForm(true);
          setTimeout(()=> { try { const invName = $('invName'); if (invName && typeof invName.focus === 'function') invName.focus(); } catch(e) {} }, 220);
        } catch (err) { console.warn('toggleAddFormBtn handler error', err); }
      });
    }
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
    toast(`Theme: ${newTheme}`, 'info', 1500);
  }

  function renderSettingsPanel() {
    const user = currentUser;
    if (!user) return;

    const meta = user.user_metadata || {};
    const businessName = meta.business_name || '';
    const fullName = meta.full_name || '';
    const email = user.email || '';

    const settingsPanel = $('settingsPanel');
    if (!settingsPanel) return;

    // FIX 10: --card-bg was undefined, causing a white band on every settings card.
    // Replaced with var(--card-glass) throughout this function's innerHTML.
    settingsPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:700; font-size: 18px; color: white;">Settings</div>
      </div>
      
      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:10px">Account</div>
        ${businessName ? `<div style="font-weight:700;margin-bottom:4px;font-size:16px">${escapeHtml(businessName)}</div>` : ''}
        ${fullName ? `<div style="margin-bottom:4px;color:var(--text-secondary)">${escapeHtml(fullName)}</div>` : ''}
        <div class="small" style="margin-bottom:12px;color:var(--text-muted)">${escapeHtml(email)}</div>
      </div>

      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:10px">Appearance</div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600;margin-bottom:2px">Theme</div>
            <div class="small" style="color:var(--text-muted)">Switch between light and dark mode</div>
          </div>
          <button id="themeToggleBtn" class="save-btn" style="min-width:100px">
            ${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>

      <div data-section="store-data" style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom: 12px;">
          <div style="font-weight:700">Store Data</div>
          <div style="display:flex;gap:8px">
            <button id="btnLoadDemo" class="save-btn">Load Demo</button>
            <button id="btnClearStore" class="btn-undo">Clear Store</button>
          </div>
        </div>
      </div>

      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div id="categoryEditorArea"></div>
      </div>

      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div id="activityLogArea"></div>
      </div>

      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:12px">
        <div style="font-weight:700">About</div>
        <div class="small" style="margin-top:6px">QuickShop — offline-first inventory & sales. v2.5 (Supabase)</div>
      </div>

      <div style="background:var(--card-glass);padding:12px;border-radius:12px;border:1px solid var(--border-glass);margin-bottom:16px">
        <button id="btnLogout" class="save-btn" style="width:100%;background:#ef4444">Sign Out</button>
      </div>
    `;

    const themeToggleBtn = $('themeToggleBtn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', toggleTheme);
    }

    initDemoAndSettingsHandlers();
    renderCategoryEditor();

    // FIX 11: Call renderShareButton() explicitly here instead of relying on
    // MutationObserver injection in share-catalog.js. The observer was firing
    // BEFORE the innerHTML rewrite completed, inserting into a node that was
    // then immediately destroyed. Explicit call after innerHTML is safe.
    if (typeof window.renderShareButton === 'function') {
      window.renderShareButton(settingsPanel);
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

  loadLocalData(null);
  if (localStorage.getItem('qs_session_active') === 'true') document.body.classList.add('mode-app');

  initThemeToggle();
  initPullToRefresh();
  initKeyboardDetection();
  initKeyboardShortcuts();
  initConfirmModal();
  initAuthHandlers();
  initOnlineOfflineHandlers();
  initBarcodeScannerHandlers();
  initSmartScannerHandlers();
  initProductListHandlers();
  initModalHandlers();
  initAuditLogHandlers();
  initInventoryListHandlers();
  initImageUploadHandler();
  initAddProductHandler();
  initNotesHandlers();
  initDemoAndSettingsHandlers();
  initNavigationHandlers();
  initReportsHandlers();
  initInsightsHandlers();
  initSearchHandler();
  initToggleAddFormHandler();

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });

  initAuth();

  window.addEventListener('unhandledrejection', function (ev) {
    errlog('Unhandled rejection:', ev.reason);
    toast('An unexpected error occurred. See console.', 'error');
  });

  window.__QS_APP = {
    getClient, getUser, saveState,
    getState: () => state,
    startScanner, stopScanner,
    syncCloudData, showConfirm,
    generateAdvancedInsights
  };

  log('QuickShop loaded successfully');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC CATALOG MODE — Customer Storefront
// Entry: initApp() detects ?view=catalog&store=USER_ID and calls here.
// Everything in this function is intentionally self-contained and does
// NOT share any admin-mode state, handlers, or auth requirements.
// ══════════════════════════════════════════════════════════════════════
async function initPublicCatalog(storeId) {
  'use strict';

  // ── Minimal helpers ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(v) { return '₦' + Number(v||0).toLocaleString('en-NG'); }

  function setStatus(html) {
    const el = $('catalogStatus');
    if (el) el.innerHTML = html;
  }

  // ── Inject the catalog shell into <body> ─────────────────────────
  // Replaces whatever admin HTML was in body — catalog is fully separate.
  document.body.innerHTML = `
    <div id="catalogApp" style="max-width:600px;margin:0 auto;padding:16px 16px calc(env(safe-area-inset-bottom) + 80px);">
      <div id="catalogHeader" style="margin-bottom:20px;">
        <div id="catalogBusiness" class="title" style="font-size:22px;font-weight:800;color:var(--text-primary);">Loading store…</div>
        <div id="catalogSubtitle" class="subtitle"></div>
      </div>
      <div id="catalogStatus" style="padding:40px 0;text-align:center;color:var(--text-muted);">Fetching products…</div>
      <div id="catalogList" class="list"></div>
    </div>
  `;

  // ── Fetch public store profile + products via Supabase REST ─────
  // Uses the same project URL / anon key as admin mode.
  // Row-level security on the products table must allow:
  //   FOR SELECT USING (auth.uid() = user_id OR true)  ← public read
  // The profiles table is read to get business name + phone.
  let supabase;
  try {
    await waitForSupabaseReady(5000);
    supabase = window.__QS_SUPABASE && window.__QS_SUPABASE.client;
    if (!supabase) throw new Error('Supabase client unavailable');
  } catch (e) {
    setStatus('<span style="color:var(--danger)">Could not connect to store. Please try again.</span>');
    return;
  }

  // Fetch business profile (name, seller_phone) — no auth required
  let businessName = 'Store', sellerPhone = '';
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, seller_phone')
      .eq('id', storeId)
      .single();
    if (profile) {
      businessName = profile.business_name || 'Store';
      sellerPhone  = (profile.seller_phone || '').replace(/\D/g, '');
    }
  } catch (_) { /* non-fatal — business name stays as fallback */ }

  const bizEl = $('catalogBusiness');
  if (bizEl) bizEl.textContent = businessName;
  const subEl = $('catalogSubtitle');
  if (subEl) subEl.textContent = 'Browse and order via WhatsApp';

  // Fetch products for this store — public read
  let products = [];
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, qty, category, icon, barcode')
      .eq('user_id', storeId)
      .order('name', { ascending: true });
    if (error) throw error;
    products = data || [];
  } catch (e) {
    setStatus('<span style="color:var(--danger)">Failed to load products: ' + escapeHtml(e.message) + '</span>');
    return;
  }

  const listEl = $('catalogList');
  if (!listEl) return;
  listEl.innerHTML = '';
  setStatus('');

  if (!products.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text-muted);">No products available right now.</div>`;
    return;
  }

  // ── Render each product with WhatsApp CTA ────────────────────────
  for (const p of products) {
    if (typeof p.qty === 'number' && p.qty <= 0) continue; // hide out-of-stock

    const card = document.createElement('div');
    card.className = 'product-card';

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'p-thumb';
    if (p.image) {
      const img = document.createElement('img');
      img.src = p.image;
      img.alt = p.name || '';
      img.crossOrigin = 'anonymous';
      thumb.appendChild(img);
    } else {
      thumb.textContent = (p.icon && p.icon.length)
        ? p.icon
        : (p.name || '').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
    }

    // Info
    const info = document.createElement('div');
    info.className = 'p-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'p-name';
    nameEl.textContent = p.name || 'Unnamed';
    const priceEl = document.createElement('div');
    priceEl.className = 'p-sub';
    priceEl.textContent = fmt(p.price || 0) + (p.qty != null ? ` • ${p.qty} in stock` : '');
    info.appendChild(nameEl);
    info.appendChild(priceEl);

    // WhatsApp CTA — replaces the admin "Sell" button
    const actions = document.createElement('div');
    actions.className = 'p-actions';
    const waBtn = document.createElement('a');
    waBtn.className = 'btn-sell';
    waBtn.style.cssText = 'text-decoration:none;display:inline-flex;align-items:center;gap:6px;';
    // Encode message: "I want to order Product Name (₦price)"
    const waText = encodeURIComponent(`I want to order ${p.name} (${fmt(p.price || 0)})`);
    waBtn.href = sellerPhone
      ? `https://wa.me/${sellerPhone}?text=${waText}`
      : `https://wa.me/?text=${waText}`;
    waBtn.target = '_blank';
    waBtn.rel = 'noopener noreferrer';
    waBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Order`;
    actions.appendChild(waBtn);

    card.appendChild(thumb);
    card.appendChild(info);
    card.appendChild(actions);
    listEl.appendChild(card);
  }
}