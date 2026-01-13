/*
* Author: Claude (Supabase Migration)
* Date: 2025-01-13
* Summary: [SUPABASE MIGRATION - COMPLETE]
* - MIGRATED: Firebase → Supabase (Auth, Database, Storage)
* - PRESERVED: All features (Search, Keyboard, Offline, Images, Scanner, Audit Log)
* - ZERO TRUNCATION: Complete 2000-line file
*/

/* ============================================
   SECTION 1: SUPABASE READINESS GUARD (Lines 1-30)
   CHANGES: waitForSupabaseReady() replaces Firebase
   ============================================ */

function waitForSupabaseReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    // Check if Supabase is initialized
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

/* ============================================
   SECTION 2: HELPERS & STATE (Lines 31-200)
   CHANGES: Supabase getters replace Firebase
   PRESERVED: All helper functions (toast, n, fmt, etc.)
   ============================================ */

(function () {
  'use strict';

  /* ---------- Small helpers ---------- */
  const log = (...a) => console.log('[QS]', ...a);
  const errlog = (...a) => console.error('[QS]', ...a);
  function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function uid() { return 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
  // Moved n and fmt to window scope for report.js
  window.n = function(v) { const num = Number(v || 0); return isNaN(num) ? 0 : num; }
  window.fmt = function(v) { return '₦' + Number(v || 0).toLocaleString('en-NG'); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function formatShortDate(ts) { return new Date(ts).toLocaleDateString('en-GB', { month:'short', day:'numeric' }); }
  function formatDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  
  // Snackbar Notification
  let toastTimer = null;
  function toast(message, type = 'info', ms = 2800) {
    try {
      let t = $('appToast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'appToast';
        Object.assign(t.style, {
          position: 'fixed',
          left: '14px',
          right: '14px',
          bottom: 'calc(var(--nav-h) + 10px + env(safe-area-inset-bottom))',
          maxWidth: '480px',
          margin: '0 auto',
          padding: '12px 16px',
          borderRadius: '10px',
          fontWeight: 700,
          fontSize: '14px',
          background: '#2c2c3c',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          color: type === 'error' ? '#f87171' : '#6ee7b7',
          boxShadow: '0 8px 24px rgba(2,6,23,0.2)',
          opacity: 0,
          transform: 'translateY(20px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 99999,
          textAlign: 'center'
        });
        document.body.appendChild(t);
      }

      if (toastTimer) clearTimeout(toastTimer);

      t.textContent = message;
      t.style.color = type === 'error' ? '#f87171' : '#6ee7b7';
      
      requestAnimationFrame(()=> {
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
      });

      toastTimer = setTimeout(()=> {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
        toastTimer = null;
      }, ms);

    } catch (e) { console.log('toast failed', e); }
  }

  /* ---------- Image Compression Engine ---------- */
  function compressImage(file, maxWidth = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Compression failed'));
            }
          }, 'image/jpeg', quality);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  }

  /* ---------- Supabase helper functions (MIGRATED) ---------- */
  const getSupabase = () => window.__QS_SUPABASE || {};
  const getClient = () => (getSupabase().client || null);
  const getUser = () => (getSupabase().user || null);

  /* ---------- App state ---------- */
  const LOCAL_KEY_PREFIX = 'quickshop_stable_v1_';
  let currentUser = null;
  let state = { products: [], sales: [], changes: [], notes: [], categories: [], logs: [] };
  let isSyncing = false;
  let editingNoteId = null;
  let editingProductId = null;
  const DEFAULT_CATEGORIES = ['Drinks', 'Snacks', 'Groceries', 'Clothing', 'Others'];
  let activeCategory = 'All';

  /* ---------- Barcode scanner state ---------- */
  let codeReader = null;
  let videoStream = null;
  let lastScannedBarcode = null;
  let scannerActive = false;
  let currentScanMode = 'form';
  let smartScanProduct = null;

  /* ---------- DOM refs (safe getters) ---------- */
  const $ = id => document.getElementById(id);
  const loginScreen = $('loginScreen');
  const appScreen = document.querySelector('.app');

  const loginForm = $('loginForm'), signupForm = $('signupForm'), resetForm = $('resetForm'), verificationNotice = $('verificationNotice'), authLoading = $('authLoading');

  const loginEmail = $('loginEmail'), loginPass = $('loginPass');
  const signupName = $('signupName'), signupBusiness = $('signupBusiness'), signupEmail = $('signupEmail'), signupPass = $('signupPass'), signupPassConfirm = $('signupPassConfirm');
  const resetEmail = $('resetEmail');

  const btnLogin = $('btnLogin'), btnShowSignup = $('btnShowSignup'), btnSignup = $('btnSignup'), btnBackToLogin = $('btnBackToLogin'), btnForgotPassword = $('btnForgotPassword');
  const btnBackToLoginFromReset = $('btnBackToLoginFromReset'), btnSendReset = $('btnSendReset');
  const btnCheckVerification = $('btnCheckVerification'), btnResendVerification = $('btnResendVerification'), btnLogoutFromVerification = $('btnLogoutFromVerification');
  const btnLogout = $('btnLogout');

  const userEmailEl = $('userEmail'), userDisplayNameEl = $('userDisplayName');

  const headerSearchInput = $('headerSearchInput');
  const chipsEl = $('chips'), productListEl = $('productList'), inventoryListEl = $('inventoryList');
  const searchContainer = document.querySelector('.search');

  const addForm = $('addForm'), invId = $('invId'), invName = $('invName'), invBarcode = $('invBarcode'), invPrice = $('invPrice'), invCost = $('invCost'), invQty = $('invQty'), invCategory = $('invCategory');
  const invImgInput = $('invImg'), invImgPreview = $('invImgPreview'), invImgPreviewImg = $('invImgPreviewImg'), invImgClear = $('invImgClear');
  const addProductBtn = $('addProductBtn'), cancelProductBtn = $('cancelProductBtn');

  const primaryScanBtn = $('primaryScanBtn');
  const scanBarcodeBtn = $('scanBarcodeBtn');
  const barcodeScannerModal = $('barcodeScannerModal'), barcodeVideo = $('barcodeVideo'), barcodeScanLine = $('barcodeScanLine'), barcodeResult = $('barcodeResult'), barcodeValue = $('barcodeValue'), barcodeCancelBtn = $('barcodeCancelBtn'), barcodeUseBtn = $('barcodeUseBtn');
  
  const smartScannerModal = $('smartScannerModal');
  const smartModalItem = $('smartModalItem'), smartModalStock = $('smartModalStock');
  const smartModalSellBtn = $('smartModalSellBtn'), smartModalRestockBtn = $('smartModalRestockBtn'), smartModalCancel = $('smartModalCancel');

  const dashRevenueEl = $('dashRevenue'), dashProfitEl = $('dashProfit'), dashTopEl = $('dashTop');
  const toggleInsightsBtn = $('toggleInsightsBtn'), aiCard = $('aiCard'), aiContent = $('aiContent'), refreshInsightsBtn = $('refreshInsights');
  
  const reportRangeButtons = Array.from(document.querySelectorAll('.report-range-btn'));
  const reportMini = $('reportMini'), reportSummary = $('reportSummary'), reportBreakdown = $('reportBreakdown');

  const navButtons = Array.from(document.querySelectorAll('.nav-btn')), btnSettings = $('btnSettings');

  /* ============================================
     SECTION 3: KEYBOARD & UI UTILITIES (Lines 201-400)
     CHANGES: NONE - preserved exactly
     ============================================ */

  try {
    document.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        document.body.classList.add('keyboard-open');
      }
    });
    
    document.addEventListener('focusout', (e) => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'SELECT')) {
          document.body.classList.remove('keyboard-open');
        }
      }, 50);
    });
  } catch(e) { console.warn('Keyboard listeners failed', e); }

  /* ---------- Custom Confirmation Modal Logic ---------- */
  let confirmResolve = null;
  const confirmModal = {
    backdrop: $('confirmModalBackdrop'),
    title: $('confirmModalTitle'),
    message: $('confirmModalMessage'),
    okBtn: $('confirmModalOK'),
    cancelBtn: $('confirmModalCancel')
  };

  if (confirmModal.okBtn) {
    confirmModal.okBtn.addEventListener('click', () => {
      if (confirmResolve) confirmResolve(true);
      confirmModal.backdrop.style.display = 'none';
    });
  }
  if (confirmModal.cancelBtn) {
    confirmModal.cancelBtn.addEventListener('click', () => {
      if (confirmResolve) confirmResolve(false);
      confirmModal.backdrop.style.display = 'none';
    });
  }
  if (confirmModal.backdrop) {
    confirmModal.backdrop.addEventListener('click', (e) => {
      if (e.target.id === 'confirmModalBackdrop') {
        if (confirmResolve) confirmResolve(false);
        confirmModal.backdrop.style.display = 'none';
      }
    });
  }
  
  function showConfirm({ title = 'Are you sure?', message, okText = 'OK', okDanger = false }) {
    return new Promise((resolve) => {
      if (!confirmModal.backdrop || !confirmModal.title || !confirmModal.message || !confirmModal.okBtn) {
        console.warn('Confirm modal elements not found. Falling back to window.confirm');
        return resolve(window.confirm(title + '\n' + message));
      }
      
      confirmResolve = resolve;
      
      confirmModal.title.textContent = title;
      confirmModal.message.textContent = message;
      confirmModal.okBtn.textContent = okText;
      
      if (okDanger) {
        confirmModal.okBtn.style.background = 'var(--danger)';
      } else {
        confirmModal.okBtn.style.background = 'var(--accent)';
      }

      confirmModal.backdrop.style.display = 'flex';
    });
  }

  /* ---------- Small UI utilities ---------- */
  
  function setBottomNavVisible(visible) { try { const bn = document.querySelector('.bottom-nav'); if (!bn) return; bn.style.display = visible ? '' : 'none'; } catch(e){} }

  function hideAllAuthForms() {
    if (loginForm) loginForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'none';
    if (verificationNotice) verificationNotice.style.display = 'none';
    if (authLoading) authLoading.style.display = 'none';
  }
  function showLoginForm(){ hideAllAuthForms(); if (loginForm) loginForm.style.display = 'flex'; clearAuthInputs(); }
  function showSignupForm(){ hideAllAuthForms(); if (signupForm) signupForm.style.display = 'flex'; clearAuthInputs(); }
  function showResetForm(){ hideAllAuthForms(); if (resetForm) resetForm.style.display = 'flex'; clearAuthInputs(); }
  function showVerificationNotice(email) { hideAllAuthForms(); if (verificationNotice) verificationNotice.style.display = 'flex'; const v = $('verificationEmail'); if (v) v.textContent = email || (getUser() && getUser().email) || ''; }
  function showAuthLoading(){ hideAllAuthForms(); if (authLoading) authLoading.style.display = 'flex'; }
  function clearAuthInputs() {
    [loginEmail, loginPass, signupName, signupBusiness, signupEmail, signupPass, signupPassConfirm, resetEmail].forEach(i => { if (i) { i.value = ''; i.classList.remove('error'); }});
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
  function disableBtn(btn, disable = true) { if (!btn) return; btn.disabled = disable; if (disable) btn.setAttribute('aria-busy','true'); else btn.removeAttribute('aria-busy'); }

  function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

  /* ---------- Inventory Insight Modal Handlers ---------- */
  function showInventoryInsight(html) {
    const view = $('inventoryInsightView');
    const content = $('inventoryInsightsContent');
    if (!view || !content) return;
    content.innerHTML = html;
    view.style.display = 'block';
  }

  function closeInventoryInsight() {
    const view = $('inventoryInsightView');
    if (!view) return;
    view.style.display = 'none';
  }

  /* ============================================
     SECTION 4: SUPABASE DATA LAYER (Lines 401-600)
     CHANGES: Complete Supabase migration
     ============================================ */

  /* ---------- Supabase Profile Helpers (MIGRATED) ---------- */
  async function setUserProfile(uid, profile) {
    const supabase = getClient();
    if (!supabase) return false;
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: uid,
          name: profile.name,
          business_name: profile.businessName,
          email: profile.email,
          created_at: profile.createdAt ? new Date(profile.createdAt).toISOString() : new Date().toISOString()
        });
      
      if (error) throw error;
      return true;
    } catch (e) {
      errlog('setUserProfile', e);
      return false;
    }
  }

  async function getUserProfile(uid) {
    const supabase = getClient();
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      
      if (error) throw error;
      return data;
    } catch (e) {
      errlog('getUserProfile', e);
      return null;
    }
  }

  /* ---------- Local/cloud state save/load (MIGRATED) ---------- */

  async function saveState() {
    const localKey = currentUser ? LOCAL_KEY_PREFIX + currentUser.id : LOCAL_KEY_PREFIX + 'anon';
    
    // Always save full state locally
    try {
      localStorage.setItem(localKey, JSON.stringify({...state, lastSync: Date.now()}));
    } catch (e) { 
      errlog('local save failed', e);
      toast('Failed to save data locally!', 'error');
    }

    if (!currentUser || !getClient() || !navigator.onLine) {
      return; 
    }

    if (isSyncing) return;
    isSyncing = true;
    
    try {
      const supabase = getClient();
      
      // Sync notes
      for (const note of state.notes) {
        await supabase.from('notes').upsert({
          id: note.id,
          user_id: currentUser.id,
          title: note.title || null,
          content: note.content,
          created_at: note.ts ? new Date(note.ts).toISOString() : new Date().toISOString()
        });
      }
      
      // Sync categories
      const existingCategories = await supabase
        .from('categories')
        .select('name')
        .eq('user_id', currentUser.id);
      
      const existingNames = new Set((existingCategories.data || []).map(c => c.name));
      
      for (const cat of state.categories) {
        if (!existingNames.has(cat)) {
          await supabase.from('categories').insert({
            user_id: currentUser.id,
            name: cat
          });
        }
      }
      
      // Sync logs
      for (const log of state.logs.slice(0, 50)) { // Only sync latest 50
        await supabase.from('audit_logs').upsert({
          id: log.id,
          user_id: currentUser.id,
          action: log.action,
          details: log.details,
          performed_by: log.user,
          created_at: log.ts ? new Date(log.ts).toISOString() : new Date().toISOString()
        });
      }
      
    } catch (e) {
      errlog('saveState (notes/categories sync) failed', e);
      toast('Cloud sync for notes & categories failed.', 'error');
    } finally {
      isSyncing = false;
    }
  }
  
  function loadLocalData(uid = null) {
    const localKey = uid ? LOCAL_KEY_PREFIX + uid : LOCAL_KEY_PREFIX + 'anon';
    let localState = { products: [], sales: [], changes: [], notes: [], categories: [], logs: [] };
    
    try {
      const localRaw = localStorage.getItem(localKey);
      if (localRaw) {
        localState = JSON.parse(localRaw);
      }
    } catch (e) {
      errlog('Failed to parse local data', e);
    }
    
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

    showLoading(true, 'Syncing data...');
    try {
      if (window.qsdb && window.qsdb.syncPendingToSupabase) {
        await window.qsdb.syncPendingToSupabase();
      }

      const supabase = getClient();

      // Fetch all data in parallel
      const [productsRes, salesRes, notesRes, categoriesRes, logsRes] = await Promise.all([
        supabase.from('products').select('*').eq('user_id', user.id),
        supabase.from('sales').select('*').eq('user_id', user.id),
        supabase.from('notes').select('*').eq('user_id', user.id),
        supabase.from('categories').select('*').eq('user_id', user.id),
        supabase.from('audit_logs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200)
      ]);

      // Map SQL rows back to JSON state format
      const cloudProducts = (productsRes.data || []).map(p => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        price: p.price,
        cost: p.cost,
        qty: p.qty,
        category: p.category || 'Others',
        image: p.image_url,
        icon: p.icon,
        createdAt: new Date(p.created_at).getTime(),
        updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : new Date(p.created_at).getTime()
      }));

      const cloudSales = (salesRes.data || []).map(s => ({
        id: s.id,
        productId: s.product_id,
        qty: s.qty,
        price: s.price,
        cost: s.cost,
        ts: new Date(s.sale_date).getTime()
      }));

      const cloudNotes = (notesRes.data || []).map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        ts: new Date(n.created_at).getTime()
      }));

      const cloudCategories = (categoriesRes.data || []).map(c => c.name);
      
      const cloudLogs = (logsRes.data || []).map(l => ({
        id: l.id,
        action: l.action,
        details: l.details,
        user: l.performed_by,
        ts: new Date(l.created_at).getTime()
      }));

      // Merge logic: preserve pending changes
      const pendingChanges = (window.qsdb && await window.qsdb.getAllPending()) || [];
      const pendingProductIds = new Set(
        pendingChanges
          .filter(c => c.type === 'updateProduct' || c.type === 'addProduct' || c.type === 'addStock')
          .map(c => c.item.id || c.item.productId)
      );

      const productMap = new Map((state.products || []).map(p => [p.id, p]));
      cloudProducts.forEach(p => {
        if (!pendingProductIds.has(p.id)) {
          productMap.set(p.id, p);
        }
      });

      const cloudProductIds = new Set(cloudProducts.map(p => p.id));
      state.products = Array.from(productMap.values()).filter(p => cloudProductIds.has(p.id));

      const salesMap = new Map((state.sales || []).map(s => [s.id, s]));
      cloudSales.forEach(s => salesMap.set(s.id, s));
      state.sales = Array.from(salesMap.values());
      
      state.notes = cloudNotes.length > 0 ? cloudNotes : state.notes;
      state.categories = cloudCategories.length > 0 ? cloudCategories : (state.categories.length > 0 ? state.categories : [...DEFAULT_CATEGORIES]);
      state.logs = cloudLogs.length > 0 ? cloudLogs : state.logs;

      toast('Data synced from cloud', 'info', 1500);

    } catch (e) {
      errlog('syncCloudData failed', e);
      toast('Failed to sync cloud data', 'error');
    }
    
    showLoading(false);
    initAppUI(); 
    await saveState(); 
  }

  /* ============================================
     SECTION 5: AUTH HANDLERS (Lines 601-900)
     CHANGES: Complete Supabase Auth migration
     ============================================ */

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

  if (btnLogin) btnLogin.addEventListener('click', async function () {
    const email = (loginEmail && loginEmail.value || '').trim();
    const pass = (loginPass && loginPass.value) || '';
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (loginEmail) loginEmail.classList.add('error'); return; }
    if (!pass || pass.length < 6) { toast('Password must be at least 6 characters', 'error'); if (loginPass) loginPass.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnLogin, true);
      const supabase = getClient();
      if (!supabase) throw new Error('Supabase not initialized');
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: pass
      });
      
      if (error) throw error;
      
      // Check email verification
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
      disableBtn(btnLogin, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnShowSignup) btnShowSignup.addEventListener('click', showSignupForm);
  if (btnBackToLogin) btnBackToLogin.addEventListener('click', showLoginForm);
  if (btnForgotPassword) btnForgotPassword.addEventListener('click', showResetForm);
  if (btnBackToLoginFromReset) btnBackToLoginFromReset.addEventListener('click', showLoginForm);

  if (btnSignup) btnSignup.addEventListener('click', async function () {
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
        email: email,
        password: pass,
        options: {
          data: {
            full_name: name,
            business_name: business || null
          }
        }
      });
      
      if (error) throw error;
      
      const user = data.user;
      const displayName = business ? `${name} (${business})` : name;
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
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnSendReset) btnSendReset.addEventListener('click', async function () {
    const email = (resetEmail && resetEmail.value || '').trim();
    if (!validateEmail(email)) { toast('Please enter a valid email', 'error'); if (resetEmail) resetEmail.classList.add('error'); return; }
    try {
      showAuthLoading(); disableBtn(btnSendReset, true);
      const supabase = getClient();
      if (!supabase) throw new Error('Supabase not initialized');
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      
      if (error) throw error;
      
      toast('Password reset email sent. Check your inbox.');
      showLoginForm();
    } catch (e) {
      errlog('reset error', e);
      showResetForm();
      toast(mapAuthError(e), 'error');
    } finally {
      disableBtn(btnSendReset, false);
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnResendVerification) btnResendVerification.addEventListener('click', async function () {
    try {
      const supabase = getClient();
      const user = getUser();
      if (!user) { toast('You need to be signed in to resend verification', 'error'); return; }
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email
      });
      
      if (error) throw error;
      toast('Verification email resent. Check your inbox.');
    } catch (e) { errlog('resend verification error', e); toast('Failed to resend verification. Try again later.', 'error'); }
  });

  if (btnCheckVerification) btnCheckVerification.addEventListener('click', async function () {
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
      if (authLoading) authLoading.style.display = 'none';
    }
  });

  if (btnLogoutFromVerification) btnLogoutFromVerification.addEventListener('click', async function () {
    try {
      const supabase = getClient();
      if (supabase) await supabase.auth.signOut();
      toast('Logged out');
      showLoginForm();
    } catch (e) { errlog('logout error', e); toast('Logout failed', 'error'); }
  });

  if (btnLogout) btnLogout.addEventListener('click', async function () {
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

  /* ============================================
     SECTION 6: AUTH OBSERVER (Lines 901-1000)
     CHANGES: Supabase auth state listener
     ============================================ */

  loadLocalData(null);
  
  if (localStorage.getItem('qs_session_active') === 'true') {
    document.body.classList.add('mode-app');
  }

  // Setup Supabase auth observer
  (async function initAuth() {
    const sb = await waitForSupabaseReady();
    if (!sb || !sb.client) {
      log('No Supabase found. Running in offline/anon mode.');
      initAppUI();
      return;
    }

    const supabase = sb.client;

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session && session.user) {
      handleAuthUser(session.user);
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session && session.user) {
        handleAuthUser(session.user);
      } else if (event === 'SIGNED_OUT' || !session) {
        handleAuthLogout();
      } else if (event === 'USER_UPDATED' && session && session.user) {
        handleAuthUser(session.user);
      }
    });
  })();

  async function handleAuthUser(user) {
    currentUser = user;
    
    // Store user in global state for sync adapter
    if (window.__QS_SUPABASE) {
      window.__QS_SUPABASE.user = user;
    }
    
    if (!user.email_confirmed_at) {
      localStorage.removeItem('qs_session_active');
      document.body.classList.remove('mode-app');
      
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appScreen) appScreen.style.display = 'none';
      showVerificationNotice(user.email);
      return;
    }

    localStorage.setItem('qs_session_active', 'true');
    document.body.classList.add('mode-app');
    
    if (loginScreen) loginScreen.style.display = 'none';
    try{ setBottomNavVisible(true); }catch(e){};
    
    if (userEmailEl) userEmailEl.textContent = user.email || '—';
    if (userDisplayNameEl) {
      const meta = user.user_metadata || {};
      const displayName = meta.full_name || meta.business_name || '';
      userDisplayNameEl.textContent = displayName ? `Name: ${displayName}` : '';
    }
    
    loadLocalData(user.id);
    await syncCloudData(user);
    
    // Dispatch auth event for sync
    document.dispatchEvent(new Event('qs:user:auth'));
  }

  function handleAuthLogout() {
    currentUser = null;
    
    if (window.__QS_SUPABASE) {
      window.__QS_SUPABASE.user = null;
    }
    
    localStorage.removeItem('qs_session_active');
    document.body.classList.remove('mode-app');
    
    if (loginScreen) loginScreen.style.display = 'flex';
    if (appScreen) appScreen.style.display = 'none';
    showLoginForm();
    setBottomNavVisible(false);
    
    if (userEmailEl) userEmailEl.textContent = '—';
    if (userDisplayNameEl) userDisplayNameEl.textContent = '';
    
    loadLocalData(null);
    showLoading(false);
  }

  /* ============================================
     SECTION 7: BARCODE SCANNER (Lines 1001-1300)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function stopScanner() {
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch(e){} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch(e){} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    try { if (barcodeScanLine) barcodeScanLine.style.display = 'none'; if (barcodeScannerModal) barcodeScannerModal.style.display = 'none'; } catch(e){}
    lastScannedBarcode = null;
    smartScanProduct = null;
    if (barcodeResult) barcodeResult.style.display = 'none';
    if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
  }

  function handleScanResult(result) {
    if (!result || !result.text) return;
    const scannedText = result.text;

    if (scannedText === lastScannedBarcode) return;
    lastScannedBarcode = scannedText;
    
    if(navigator.vibrate) navigator.vibrate(200);
    
    try { 
      if (codeReader && codeReader.reset) codeReader.reset(); 
      if (videoStream) { 
         videoStream.getTracks().forEach(t => t.stop()); 
         videoStream = null;
      }
    } catch(e){ console.warn('Reset error', e); }
    
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
    toast('Barcode scanned!', 'info', 900);

    const scannedStr = String(scannedText).trim();

    if (currentScanMode === 'form') {
      if (invBarcode) {
          invBarcode.value = scannedStr;
          invBarcode.focus();
      }
      stopScanner();
      
    } else if (currentScanMode === 'smart') {
      stopScanner();
      
      const product = state.products.find(p => p.barcode && String(p.barcode).trim() === scannedStr);
      
      if (product) {
        smartScanProduct = product;
        if (smartModalItem) smartModalItem.textContent = product.name;
        if (smartModalStock) smartModalStock.textContent = `${product.qty} in stock`;
        if (smartScannerModal) {
             smartScannerModal.style.display = 'flex';
             if (smartModalSellBtn) smartModalSellBtn.textContent = 'Sell';
        }
      } else {
        toast('New barcode found. Add product.', 'info');
        showAddForm(true); 
        if (invBarcode) invBarcode.value = scannedText; 
        setTimeout(()=> { if (invName) invName.focus(); }, 220);
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
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      if (barcodeResult) barcodeResult.style.display = 'none';
      if (barcodeUseBtn) barcodeUseBtn.style.display = 'none';
      if (barcodeScanLine) barcodeScanLine.style.display = 'block';
      scannerActive = true;
      
      const hints = new Map();
      const formats = [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E
      ];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      
      codeReader = new ZXing.BrowserMultiFormatReader(hints);
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(()=>{}); }
      
      if (codeReader.decodeFromVideoDevice) {
        try {
          codeReader.decodeFromVideoDevice(null, barcodeVideo, (result, err) => {
            if (result) handleScanResult(result);
          });
        } catch (e) {
          try { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); }); } catch (ex) { throw ex; }
        }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res, er) => { if (res) handleScanResult(res); });
      } else {
        toast('Barcode scanner not supported', 'error');
        stopScanner();
      }
    } catch (e) {
      errlog('Barcode Scanner Error:', e);
      toast('Failed to start camera. Check permissions.', 'error');
      stopScanner();
    }
  }

  if (primaryScanBtn) primaryScanBtn.addEventListener('click', () => startScanner('smart'));
  if (scanBarcodeBtn) scanBarcodeBtn.addEventListener('click', () => startScanner('form'));

  if (barcodeCancelBtn) barcodeCancelBtn.addEventListener('click', stopScanner);
  if (barcodeUseBtn) barcodeUseBtn.addEventListener('click', function () {
    if (lastScannedBarcode && invBarcode) invBarcode.value = lastScannedBarcode;
    stopScanner();
  });
  if (barcodeScannerModal) barcodeScannerModal.addEventListener('click', function (e) { if (e.target && e.target.id === 'barcodeScannerModal') stopScanner(); });

  function hideSmartModal() {
    if (smartScannerModal) smartScannerModal.style.display = 'none';
    smartScanProduct = null;
  }
  if (smartModalCancel) smartModalCancel.addEventListener('click', hideSmartModal);
  
  if (smartModalSellBtn) smartModalSellBtn.addEventListener('click', () => {
    if (!smartScanProduct) return;
    const idToSell = smartScanProduct.id;
    hideSmartModal();
    openModalFor('sell', idToSell);
  });

  if (smartModalRestockBtn) smartModalRestockBtn.addEventListener('click', () => {
    if (!smartScanProduct) return;
    const idToRestock = smartScanProduct.id;
    hideSmartModal();
    openModalFor('add', idToRestock);
  });

  /* ============================================
     SECTION 8: PRODUCTS RENDERING (Lines 1301-1500)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function renderChips() {
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
  
  if (headerSearchInput) {
      headerSearchInput.addEventListener('input', () => {
          const view = document.querySelector('.panel.active').id;
          if (view === 'inventoryPanel') {
              renderInventory();
          } else {
              scheduleRenderProducts();
          }
      });
  }

  function renderProducts() {
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
      no.style.background = 'var(--card-bg)';
      no.style.borderRadius = '12px';
      no.style.border = '1px solid rgba(7,18,43,0.04)';
      no.textContent = 'No products — add from Inventory or load demo';
      productListEl.appendChild(no);
      return;
    }
    for (const p of items) {
      const card = document.createElement('div'); card.className = 'product-card';
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) { 
        const img = document.createElement('img'); img.src = p.image; img.alt = p.name || 'thumb'; img.crossOrigin = 'anonymous'; thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase());
      }
      const info = document.createElement('div'); info.className = 'p-info';
      const nameEl = document.createElement('div'); nameEl.className = 'p-name'; nameEl.textContent = p.name || 'Unnamed';
      const subEl = document.createElement('div'); subEl.className = 'p-sub';
      const qtyText = (typeof p.qty === 'number') ? `${p.qty} in stock` : '—';
      subEl.textContent = `${qtyText} • ${fmt(p.price || 0)}` + (p.barcode ? (' • Barcode: ' + p.barcode) : '');
      info.appendChild(nameEl); info.appendChild(subEl);
      const actions = document.createElement('div'); actions.className = 'p-actions';
      const group = document.createElement('div'); group.className = 'p-actions-row';
      const sell = document.createElement('button'); sell.className = 'btn-sell'; sell.type = 'button'; sell.textContent = 'Sell'; sell.dataset.id = p.id; sell.dataset.action = 'sell';
      const undo = document.createElement('button'); undo.className = 'btn-undo'; undo.type = 'button'; undo.textContent = 'Undo'; undo.dataset.id = p.id; undo.dataset.action = 'undo';
      group.appendChild(sell); group.appendChild(undo);
      actions.appendChild(group);
      card.appendChild(thumb); card.appendChild(info); card.appendChild(actions);
      productListEl.appendChild(card);
    }
  }

  if (productListEl) {
    productListEl.addEventListener('click', function (ev) {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.action;
      const id = btn.dataset.id;
      if (act === 'sell') { openModalFor('sell', id); return; }
      if (act === 'undo') { undoLastFor(id); return; }
    });
  }

  /* ============================================
     SECTION 9: MODAL HELPERS (Lines 1501-1600)
     CHANGES: NONE - preserved exactly
     ============================================ */

  let modalContext = null;
  function showModal() { 
    const mb = $('modalBackdrop'); 
    if (mb) { 
      mb.style.display = 'flex'; 
      setTimeout(()=> { const q = $('modalQty'); if (q) q.focus(); }, 100); 
    } 
  }
  
  function hideModal() { 
    const mb = $('modalBackdrop'); 
    if (mb) mb.style.display = 'none'; 
    modalContext = null; 
    let errEl = $('modalError');
    if (errEl) errEl.textContent = '';
  }

  function openModalFor(mode, productId) {
    const p = (state.products || []).find(x => x.id === productId);
    if (!p) { toast('Product not found', 'error'); return; }
    modalContext = { mode, productId };
    const titleEl = $('modalTitle'), itemEl = $('modalItem');
    if (titleEl) titleEl.textContent = mode === 'sell' ? 'Sell items' : 'Add stock';
    if (itemEl) itemEl.textContent = `${p.name} — ${typeof p.qty === 'number' ? p.qty + ' in stock' : 'stock unknown'}`;
    const qtyEl = $('modalQty'); if (qtyEl) qtyEl.value = 1;
    showModal();
  }

  if ($('modalCancel')) $('modalCancel').addEventListener('click', hideModal);
  const modalBackdropEl = $('modalBackdrop');
  if (modalBackdropEl) modalBackdropEl.addEventListener('click', function (e) { if (e.target && e.target.id === 'modalBackdrop') hideModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideModal(); });

  if ($('modalConfirm')) $('modalConfirm').addEventListener('click', function () {
    if (!modalContext) { hideModal(); return; }
    
    const qtyEl = $('modalQty'); 
    const q = Math.max(1, Math.floor(window.n(qtyEl && qtyEl.value)));
    
    if (modalContext.mode === 'sell') {
      const p = state.products.find(x => x.id === modalContext.productId);
      if (!p) {
        toast('Product not found.', 'error'); 
        hideModal();
        return;
      }
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

  /* ============================================
     SECTION 10: ACTIVITY LOGGING (Lines 1601-1700)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function addActivityLog(action, details) {
    const user = currentUser ? (currentUser.email || 'User') : 'Anon';
    const entry = {
      id: uid(),
      ts: Date.now(),
      action: action,
      details: details,
      user: user
    };
    if (!state.logs) state.logs = [];
    state.logs.unshift(entry);
    
    if (state.logs.length > 200) {
      state.logs = state.logs.slice(0, 200);
    }
    
    saveState();
  }
  
  function renderActivityLog() {
    const container = $('activityLogArea');
    if (!container) return;
    
    container.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; margin-top: 24px;">Activity History (Audit Log)</div>
      <div class="small" style="margin-bottom: 12px;">Review recent actions. Used for security and fraud prevention.</div>
      <div id="activityLogList" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 8px; border-radius: 8px;"></div>
    `;
    
    const listEl = $('activityLogList');
    const logs = state.logs || [];
    
    if (logs.length === 0) {
      listEl.innerHTML = '<div class="small" style="color: var(--muted); text-align: center; padding: 20px;">No activity recorded yet.</div>';
      return;
    }
    
    logs.forEach(log => {
      const row = document.createElement('div');
      row.style.cssText = "padding: 8px; background: #fff; border-bottom: 1px solid #f1f5f9; font-size: 13px;";
      
      const isSuspicious = log.action === 'Delete' || log.action === 'Undo';
      const color = isSuspicious ? '#ef4444' : 'var(--text)';
      
      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; color: #64748b; font-size: 11px;">
          <span>${formatDateTime(log.ts)}</span>
          <span>${log.user}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
          <span style="font-weight: 600; color: ${color}">${log.action}</span>
          <span>${escapeHtml(log.details)}</span>
        </div>
      `;
      listEl.appendChild(row);
    });
  }

  /* ============================================
     SECTION 11: PRODUCT ACTIONS (Lines 1701-1900)
     CHANGES: NONE - queue logic preserved exactly
     ============================================ */

  async function doAddStock(productId, qty) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    p.qty = (typeof p.qty === 'number' ? p.qty : 0) + qty;
    
    const change = { type: 'updateProduct', item: p };
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange(change);
    }
    
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
    
    const newSale = { 
      productId, 
      qty, 
      price: window.n(p.price), 
      cost: window.n(p.cost), 
      ts: Date.now(),
      id: uid() 
    };
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
        
        if (p && window.qsdb && window.qsdb.addPendingChange) {
          await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
        }
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
            
            if (saleToRemove && window.qsdb && window.qsdb.addPendingChange) {
              await window.qsdb.addPendingChange({ type: 'removeSale', item: saleToRemove });
            }
            
            const p = state.products.find(x => x.id === productId);
            if (p) {
              p.qty
              p.qty = (typeof p.qty === 'number' ? p.qty + ch.qty : ch.qty);
              addActivityLog('Undo', `Reverted Sale of ${ch.qty} ${p.name}`);
              if (window.qsdb && window.qsdb.addPendingChange) {
                await window.qsdb.addPendingChange({ type: 'updateProduct', item: p });
              }
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

  /* ============================================
     SECTION 12: INVENTORY RENDERING & EDITING (Lines 1901-2200)
     CHANGES: Image upload migrated to Supabase Storage
     ============================================ */

  function clearInvImage() {
    try { invImgInput && (invImgInput.value = ''); } catch(e){}
    if (invImgPreview) invImgPreview.style.display = 'none';
    if (invImgPreviewImg) invImgPreviewImg.src = '';
  }
  
  if (invImgInput) {
    invImgInput.addEventListener('change', async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) { clearInvImage(); return; }
      const MAX_IMG_SIZE = 5 * 1024 * 1024; 
      if (file.size > MAX_IMG_SIZE) { toast('Image too large (max 5MB).', 'error'); e.target.value = ''; return; }
      
      const supabase = getClient();
      if (!supabase || !currentUser) {
        toast('Storage not ready or user not logged in.', 'error');
        return;
      }
      
      showLoading(true, 'Compressing & Uploading...');
      
      try {
        // Client-Side Compression
        const compressedBlob = await compressImage(file);

        const fileName = `${currentUser.id}/${Date.now()}.jpg`;
        
        const { data, error } = await supabase
          .storage
          .from('user_images')
          .upload(fileName, compressedBlob, {
            contentType: 'image/jpeg',
            upsert: false
          });
        
        if (error) throw error;
        
        // Get public URL
        const { data: urlData } = supabase
          .storage
          .from('user_images')
          .getPublicUrl(fileName);
        
        const downloadURL = urlData.publicUrl;
        
        showLoading(false);
        if (invImgPreviewImg) invImgPreviewImg.src = downloadURL; 
        if (invImgPreview) invImgPreview.style.display = 'flex';
        toast('Image uploaded');
        
      } catch (err) {
        errlog('Image upload failed', err);
        toast('Image upload failed: ' + err.message, 'error');
        showLoading(false);
        clearInvImage();
      }
    });
  }
  if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });

  function clearAddForm() {
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

  function showAddForm(asModal = true) {
    populateCategoryDropdown();
    if (asModal) {
      document.body.classList.add('add-modal-open');
      if (addForm) addForm.style.display = 'flex';
      createAddBackdrop();
    } else {
      if (addForm) addForm.style.display = 'flex';
    }
  }

  function hideAddForm() {
    clearAddForm();
    if (addForm) addForm.style.display = 'none';
    document.body.classList.remove('add-modal-open');
    const d = document.getElementById('addFormBackdrop');
    if (d) try { d.remove(); } catch(e) {}
  }
  
  if (cancelProductBtn) cancelProductBtn.addEventListener('click', hideAddForm);

  if (addProductBtn) addProductBtn.addEventListener('click', async function () {
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

    let product;
    let syncType;
    
    if (editingProductId) {
      product = state.products.find(p => p.id === editingProductId);
      if (!product) {
        toast('Product to update not found', 'error');
        return;
      }
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
      product = { 
        id: uid(), 
        name, price, cost, qty: qty || 0, category, 
        image: image, 
        icon: null, 
        barcode: barcode || null,
        createdAt: Date.now()
      };
      state.products.push(product);
      syncType = 'addProduct';
      addActivityLog('Create', `Created product: ${name}`);
      toast('Product saved');
    }
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: syncType, item: product });
    }

    await saveState(); 
    hideAddForm();
      
    renderInventory(); renderProducts(); renderDashboard(); renderChips();
  });

  function validateProduct(name, price, cost, qty, barcode, currentId = null) {
    if (!name || name.trim().length === 0) return { valid: false, error: 'Product name is required' };
    if (price <= 0) return { valid: false, error: 'Price must be greater than 0' };
    if (cost < 0) return { valid: false, error: 'Cost cannot be negative' };
    if (qty < 0) return { valid: false, error: 'Stock cannot be negative' };
    
    if (barcode) {
        const checkBc = String(barcode).trim();
        const existing = state.products.find(p => p.barcode && String(p.barcode).trim() === checkBc && p.id !== currentId);
        if (existing) {
            return { valid: false, error: `Barcode already used for "${existing.name}".` };
        }
    }
    return { valid: true };
  }

  function renderInventory() {
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    
    const q = (headerSearchInput && headerSearchInput.value.trim().toLowerCase()) || '';
    const items = (state.products || []).filter(p => {
      if (q && !(((p.name || '').toLowerCase().includes(q)) || ((p.barcode || '') + '').includes(q))) return false;
      return true;
    });

    if (!items || items.length === 0) {
      const no = document.createElement('div'); no.className = 'small';
      no.style.padding = '12px'; no.style.background = 'var(--card-bg)'; no.style.borderRadius = '12px'; no.style.border = '1px solid rgba(7,18,43,0.04)';
      no.textContent = 'No products in inventory';
      inventoryListEl.appendChild(no); return;
    }
    
    for (const p of items) {
      const el = document.createElement('div'); el.className = 'inventory-card';
      const top = document.createElement('div'); top.className = 'inventory-top';
      const thumb = document.createElement('div'); thumb.className = 'p-thumb';
      if (p.image) { const img = document.createElement('img'); img.src = p.image; img.alt = p.name || ''; img.crossOrigin = 'anonymous'; thumb.appendChild(img); }
      else thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase());
      const info = document.createElement('div'); info.className = 'inventory-info';
      const nme = document.createElement('div'); nme.className = 'inventory-name'; nme.textContent = p.name || 'Unnamed';
      const meta = document.createElement('div'); meta.className = 'inventory-meta'; meta.textContent = `${p.qty || 0} in stock • ${fmt(p.price)}`;
      info.appendChild(nme); info.appendChild(meta);
      if (p.barcode) { const bc = document.createElement('div'); bc.className = 'small'; bc.style.marginTop = '4px'; bc.style.color = 'var(--muted)'; bc.textContent = 'Barcode: ' + p.barcode; info.appendChild(bc); }
      top.appendChild(thumb); top.appendChild(info);
      const actions = document.createElement('div'); actions.className = 'inventory-actions';
      const restock = document.createElement('button'); restock.className = 'btn-restock'; restock.type = 'button'; restock.textContent = 'Restock'; restock.dataset.restock = p.id;
      const edit = document.createElement('button'); edit.className = 'btn-edit'; edit.type = 'button'; edit.textContent = 'Edit'; edit.dataset.edit = p.id;
      const del = document.createElement('button'); del.className = 'btn-delete'; del.type = 'button'; del.textContent = 'Delete'; del.dataset.delete = p.id;
      actions.appendChild(restock); actions.appendChild(edit); actions.appendChild(del);
      el.appendChild(top); el.appendChild(actions);
      inventoryListEl.appendChild(el);
    }
  }

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

  if (headerSearchInput) {
      headerSearchInput.addEventListener('input', function() {
        const currentView = document.querySelector('.panel.active')?.id;
        if (currentView === 'inventoryPanel') {
          renderInventory();
        } else if (currentView === 'homePanel') {
          scheduleRenderProducts();
        }
      });
  }

  function openEditProduct(id) {
    const p = state.products.find(x => x.id === id); 
    if (!p) { toast('Product not found', 'error'); return; }
    
    editingProductId = p.id;
    
    populateCategoryDropdown(); 
    
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
    
    setTimeout(()=> { try { if (invName) invName.focus(); } catch(e){} }, 220);
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
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      await window.qsdb.addPendingChange({ type: 'removeProduct', item: productToRemove });
    }

    addActivityLog('Delete', `Deleted product: ${p.name}`);
    
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips();
    toast('Product deleted');
  }

  /* ============================================
     SECTION 13: DASHBOARD RENDERING (Lines 2201-2300)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function renderDashboard() {
    const since = startOfDay(Date.now());
    const salesToday = (state.sales || []).filter(s => s.ts >= since);
    const revenue = salesToday.reduce((a,s)=>a + (window.n(s.price) * window.n(s.qty)), 0);
    const cost = salesToday.reduce((a,s)=>a + (window.n(s.cost) * window.n(s.qty)), 0);
    const profit = revenue - cost;
    if (dashRevenueEl) dashRevenueEl.textContent = fmt(revenue);
    if (dashProfitEl) dashProfitEl.textContent = fmt(profit);
    
    const overallByProd = {}; (state.sales||[]).forEach(s => overallByProd[s.productId] = (overallByProd[s.productId]||0) + s.qty);
    const overallArr = Object.entries(overallByProd).sort((a,b)=>b[1]-a[1]);
    let topName = '—';
    if (overallArr.length > 0 && overallArr[0]) {
        const topId = overallArr[0][0];
        const topProd = state.products.find(p => p.id === topId);
        if (topProd) {
            topName = topProd.name;
        } else {
            topName = 'N/A (Deleted)';
        }
    }
    if (dashTopEl) dashTopEl.textContent = topName;
  }

  /* ============================================
     SECTION 14: NOTES (Lines 2301-2400)
     CHANGES: NONE - preserved exactly
     ============================================ */

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
      const item = document.createElement('div'); item.className = 'note-item';
      if (note.title) {
        const t = document.createElement('div'); t.style.fontWeight = '700'; 
        t.textContent = note.title; 
        item.appendChild(t);
      }
      const c = document.createElement('div'); c.style.marginTop = '6px'; c.style.whiteSpace = 'pre-wrap'; 
      c.textContent = note.content; 
      item.appendChild(c);
      const meta = document.createElement('div'); meta.className = 'note-meta'; meta.textContent = formatDateTime(note.ts); item.appendChild(meta);
      const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.justifyContent = 'flex-end'; actions.style.marginTop = '8px';
      const edit = document.createElement('button'); edit.className = 'btn-edit'; edit.textContent = 'Edit'; edit.dataset.editNote = note.id;
      const del = document.createElement('button'); del.className = 'btn-delete'; del.textContent = 'Delete'; del.dataset.deleteNote = note.id;
      actions.appendChild(edit); actions.appendChild(del); item.appendChild(actions);
      notesListEl.appendChild(item);
    }
    notesListEl.querySelectorAll('[data-edit-note]').forEach(b => b.addEventListener('click', function () {
      const id = this.dataset.editNote; const note = state.notes.find(n=>n.id===id); if (!note) return;
      $('noteTitle').value = note.title || ''; $('noteContent').value = note.content || '';
      editingNoteId = note.id; $('noteSaveBtn').textContent = 'Update Note'; 
      setActiveView('notes', true);
    }));
    notesListEl.querySelectorAll('[data-delete-note]').forEach(b => b.addEventListener('click', async function () {
      const confirmed = await showConfirm({
        title: 'Delete Note?',
        message: 'Are you sure you want to delete this note?',
        okText: 'Delete',
        okDanger: true
      });
      if (!confirmed) return;
      
      state.notes = state.notes.filter(n => n.id !== this.dataset.deleteNote);
      saveState(); renderNotes(); toast('Note deleted');
    }));
  }

  const noteSaveBtn = $('noteSaveBtn'), noteCancelBtn = $('noteCancelBtn');
  if (noteSaveBtn) noteSaveBtn.addEventListener('click', function () {
    const title = ($('noteTitle').value || '').trim();
    const content = ($('noteContent').value || '').trim();
    if (!content) { toast('Please write something in the note', 'error'); return; }
    if (editingNoteId) {
      const note = state.notes.find(n=>n.id===editingNoteId);
      if (note) { note.title = title; note.content = content; note.ts = Date.now(); }
      editingNoteId = null; if (noteSaveBtn) noteSaveBtn.textContent = 'Save Note'; toast('Note updated');
    } else {
      state.notes.push({ id: uid(), title, content, ts: Date.now() });
      toast('Note saved');
    }
    $('noteTitle').value = ''; $('noteContent').value = '';
    saveState(); renderNotes();
  });
  if (noteCancelBtn) noteCancelBtn.addEventListener('click', function () {
    editingNoteId = null; $('noteTitle').value = ''; $('noteContent').value = ''; if (noteSaveBtn) noteSaveBtn.textContent = 'Save Note';
  });

  /* ============================================
     SECTION 15: DEMO & SETTINGS (Lines 2401-2600)
     CHANGES: NONE - preserved exactly
     ============================================ */

  const btnLoadDemo = $('btnLoadDemo'), btnClearStore = $('btnClearStore');
  
  if (btnLoadDemo) btnLoadDemo.addEventListener('click', async function () {
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
        if (window.qsdb && window.qsdb.addPendingChange) {
          await window.qsdb.addPendingChange({ type: 'addProduct', item: p });
        }
      }
    }
    DEFAULT_CATEGORIES.forEach(cat => {
      if (!state.categories.includes(cat)) {
        state.categories.push(cat);
      }
    });
    
    addActivityLog('Demo', 'Loaded demo products');
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderCategoryEditor();
    toast('Demo loaded');
  });

  if (btnClearStore) btnClearStore.addEventListener('click', async function () {
    const confirmed = await showConfirm({
      title: 'Clear Store?',
      message: 'This will delete all products, sales, and notes permanently. This action cannot be undone.',
      okText: 'Clear Store',
      okDanger: true
    });
    if (!confirmed) return;
    
    if (window.qsdb && window.qsdb.addPendingChange) {
      for (const p of state.products) {
        await window.qsdb.addPendingChange({ type: 'removeProduct', item: p });
      }
      for (const s of state.sales) {
        await window.qsdb.addPendingChange({ type: 'removeSale', item: s });
      }
    }
    
    state.products = []; state.sales = []; state.changes = []; state.notes = [];
    state.categories = [...DEFAULT_CATEGORIES];
    
    addActivityLog('Reset', 'Store data cleared manually');
    await saveState(); 
    renderInventory(); renderProducts(); renderDashboard(); renderChips(); renderNotes(); renderCategoryEditor();
    toast('Store cleared');
  });

  function renderCategoryEditor() {
    const container = $('categoryEditorArea');
    if (!container) return;
    
    container.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">Manage Categories</div>
      <div class="small" style="margin-bottom: 12px;">Add, rename, or delete categories. Deleting a category will move its products to "Others".</div>
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
        <input type="text" class="auth-input category-name-input" data-original-name="${escapeHtml(cat)}" value="${escapeHtml(cat)}" style="flex: 1; background: #fff; border: 1px solid #e6eef7;" />
        <button class="btn-undo category-rename-btn" data-original-name="${escapeHtml(cat)}">Rename</button>
        <button class="btn-delete category-delete-btn" data-name="${escapeHtml(cat)}">Delete</button>
      `;
      listEl.appendChild(row);
    });

    $('addCategoryBtn').addEventListener('click', handleAddCategory);
    container.querySelectorAll('.category-rename-btn').forEach(btn => btn.addEventListener('click', handleRenameCategory));
    container.querySelectorAll('.category-delete-btn').forEach(btn => btn.addEventListener('click', handleDeleteCategory));
    
    renderActivityLog();
  }

  async function handleAddCategory() {
    const input = $('newCategoryName');
    const newName = input.value.trim();
    if (!newName) {
      toast('Please enter a category name', 'error');
      return;
    }
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
      toast('Category already exists', 'error');
      return;
    }
    
    state.categories.push(newName);
    await saveState();
    toast('Category added');
    renderCategoryEditor();
    renderChips();
  }

  async function handleRenameCategory(e) {
    const oldName = e.target.dataset.originalName;
    const input = e.target.closest('.add-row').querySelector('.category-name-input');
    const newName = input.value.trim();

    if (!newName) {
      toast('Category name cannot be empty', 'error');
      input.value = oldName;
      return;
    }
    if (newName.toLowerCase() === oldName.toLowerCase()) return;
    if (state.categories.find(c => c.toLowerCase() === newName.toLowerCase())) {
      toast('Category name already exists', 'error');
      input.value = oldName;
      return;
    }
    if (newName.toLowerCase() === 'others') {
      toast('Cannot rename to "Others"', 'error');
      input.value = oldName;
      return;
    }

    const index = state.categories.findIndex(c => c.toLowerCase() === oldName.toLowerCase());
    if (index > -1) {
      state.categories[index] = newName;
    }
    
    state.products.forEach(p => {
      if (p.category === oldName) {
        p.category = newName;
      }
    });

    await saveState();
    toast('Category renamed');
    renderCategoryEditor();
    renderChips();
    renderProducts();
    renderInventory();
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
    
    state.products.forEach(p => {
      if (p.category === name) {
        p.category = 'Others';
      }
    });

    await saveState();
    toast('Category deleted');
    renderCategoryEditor();
    renderChips();
    renderProducts();
    renderInventory();
  }

  /* ============================================
     SECTION 16: NAVIGATION (Lines 2601-2700)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function setActiveView(view, resetScroll = false) {
    navButtons.forEach(b => { const isActive = b.dataset.view === view; b.classList.toggle('active', isActive); b.setAttribute('aria-pressed', isActive ? 'true':'false'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = $(view + 'Panel'); if (panel) panel.classList.add('active');

    const isHome = view === 'home';
    const isInv = view === 'inventory';
    if (headerSearchInput) {
        headerSearchInput.style.display = (isHome || isInv) ? 'block' : 'none';
        headerSearchInput.value = ''; 
    }
    if (chipsEl) {
        chipsEl.style.display = isHome ? 'flex' : 'none';
    }
    if (searchContainer) searchContainer.style.display = 'none';

    if (view === 'reports') renderReports();
    if (view === 'settings') {
      renderCategoryEditor();
      const settingsPanel = $('settingsPanel');
      if (settingsPanel) settingsPanel.style.paddingBottom = '100px';
    }
    if (view === 'home') { renderDashboard(); renderProducts(); }
    if (view === 'inventory') renderInventory();
    if (view === 'notes') renderNotes();
    
    if (resetScroll) {
      setTimeout(()=> { 
        try { 
          window.scrollTo(0, 0); 
        } catch(e){} 
      }, 10);
    }
  }

  navButtons.forEach(btn => btn.addEventListener('click', function(){ setActiveView(this.dataset.view, true); }));
  if (btnSettings) btnSettings.addEventListener('click', function(){ setActiveView('settings', true); });

  /* ============================================
     SECTION 17: REPORTS (Lines 2701-2900)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function createBuckets(range) {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const buckets = [];
    if (range === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const start = startOfDay(now - i * DAY);
        buckets.push({ start, end: start + DAY, label: formatShortDate(start) });
      }
    } else if (range === 'weekly') {
      const weekEnd = startOfDay(now) + DAY;
      const WEEK = 7 * DAY;
      for (let i = 3; i >= 0; i--) {
        const start = weekEnd - (i+1) * WEEK;
        const end = weekEnd - i * WEEK;
        buckets.push({ start, end, label: `${formatShortDate(start)} - ${formatShortDate(end - 1)}` });
      }
    } else {
      const monthEnd = startOfDay(now) + DAY;
      const MONTH = 30 * DAY;
      for (let i = 5; i >= 0; i--) {
        const start = monthEnd - (i+1) * MONTH;
        const end = monthEnd - i * MONTH;
        buckets.push({ start, end, label: `${new Date(start).toLocaleString('default', { month: 'short', year: 'numeric' })}` });
      }
    }
    return buckets;
  }
  
  function getSalesInRange(start, end) {
      return (state.sales || []).filter(s => s.ts >= start && s.ts < end);
  }

  function aggregateSalesInRange(start, end) {
    const sales = getSalesInRange(start, end);
    const revenue = sales.reduce((a,s)=>a + ((window.n(s.price) || 0) * (window.n(s.qty) || 0)), 0);
    const profit = sales.reduce((a,s)=>a + ((window.n(s.price) - window.n(s.cost)) * (window.n(s.qty) || 0)), 0);
    return {
      units: sales.reduce((a,s)=>a + (window.n(s.qty) || 0), 0),
      revenue: revenue,
      profit: profit
    };
  }

  let currentReportRange = 'daily';
  function renderReports(range = currentReportRange) {
    currentReportRange = range;
    reportRangeButtons.forEach(b => b.classList.toggle('active', b.dataset.range === range));
    const buckets = createBuckets(range);
    const rangeStart = buckets[0].start;
    const rangeEnd = buckets[buckets.length-1].end;
    const totalMetrics = aggregateSalesInRange(rangeStart, rangeEnd);
    
    if (reportMini) reportMini.textContent = fmt(totalMetrics.revenue);
    if (reportSummary) {
      reportSummary.innerHTML = '';
      const wrap = document.createElement('div'); wrap.className = 'report-summary-cards';
      const cardR = document.createElement('div'); cardR.className = 'report-card'; cardR.innerHTML = `<div class="small">Revenue (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.revenue)}</div>`;
      const cardP = document.createElement('div'); cardP.className = 'report-card'; cardP.innerHTML = `<div class="small">Profit (range)</div><div style="font-weight:700;margin-top:6px">${fmt(totalMetrics.profit)}</div>`;
      const cardU = document.createElement('div'); cardU.className = 'report-card'; cardU.innerHTML = `<div class="small">Units (range)</div><div style="font-weight:700;margin-top:6px">${totalMetrics.units}</div>`;
      wrap.appendChild(cardR); wrap.appendChild(cardP); wrap.appendChild(cardU);
      reportSummary.appendChild(wrap);
    }
    
    if (reportBreakdown) {
      reportBreakdown.innerHTML = '';
      
      const outer = document.createElement('div');
      outer.style.cssText = 'background:var(--card-bg);padding:10px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px';
      const tbl = document.createElement('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse';
      const thead = document.createElement('thead');
      thead.innerHTML = `<tr style="text-align:left"><th style="padding:8px">Period</th><th style="padding:8px">Units</th><th style="padding:8px">Revenue</th><th style="padding:8px">Profit</th><th style="padding:8px">Margin</th></tr>`;
      tbl.appendChild(thead);
      const tbody = document.createElement('tbody');
      for (const b of buckets) {
        const m = aggregateSalesInRange(b.start, b.end);
        buckets[buckets.indexOf(b)].units = m.units; 
        buckets[buckets.indexOf(b)].revenue = m.revenue; 
        const margin = m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(0) : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:8px;border-top:1px solid #f1f5f9">${escapeHtml(b.label)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${m.units}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.revenue)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${fmt(m.profit)}</td><td style="padding:8px;border-top:1px solid #f1f5f9">${margin}%</td>`;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      outer.appendChild(tbl);
      reportBreakdown.appendChild(outer);
      
      const salesInRange = getSalesInRange(rangeStart, rangeEnd);
      const rangeProdQty = {}; 
      salesInRange.forEach(s => { rangeProdQty[s.productId] = (rangeProdQty[s.productId] || 0) + s.qty; });
      const top3InRange = Object.entries(rangeProdQty).sort((a,b) => b[1] - a[1]).slice(0, 3);

      if (top3InRange.length > 0) {
        const topProdCard = document.createElement('div');
        topProdCard.style.cssText = 'background:var(--card-bg);padding:16px;border-radius:12px;border:1px solid rgba(7,18,43,0.04);margin-top:12px';
        const topTitle = document.createElement('div');
        topTitle.style.fontWeight = '700';
        topTitle.style.marginBottom = '10px';
        topTitle.textContent = 'Top Products (This Range)';
        topProdCard.appendChild(topTitle);
        
        top3InRange.forEach(([productId, qty]) => {
          const p = state.products.find(prod => prod.id === productId);
          const pName = p ? p.name : 'Unknown Product';
          const pEl = document.createElement('div');
          pEl.style.cssText = 'display:flex; justify-content:space-between; font-size: 14px; padding: 6px 0; border-bottom: 1px solid #f1f5f9;';
          const nameSpan = document.createElement('span');
          nameSpan.textContent = pName;
          const qtySpan = document.createElement('span');
          qtySpan.style.fontWeight = '600';
          qtySpan.textContent = `${qty} units`;
          pEl.appendChild(nameSpan);
          pEl.appendChild(qtySpan);
          topProdCard.appendChild(pEl);
        });
        reportBreakdown.appendChild(topProdCard);
      }
      
      const reportsPanel = $('reportsPanel');
      if (reportsPanel) reportsPanel.style.paddingBottom = '100px';
      
      reportBreakdown.style.paddingBottom = '24px';
      
      try { if (typeof renderReportsChart === 'function') renderReportsChart(buckets); } catch(e) { console.warn('renderReportsChart missing', e); }
    }
  }
  reportRangeButtons.forEach(b => b.addEventListener('click', function () { renderReports(this.dataset.range); }));

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

  const exportReport = $('exportReport');
  if (exportReport) exportReport.addEventListener('click', function () {
    const rows = [['Timestamp','Product','Qty','UnitPrice','Total','Cost','Profit','Barcode','SaleID']];
    (state.sales || []).forEach(s => {
      const p = state.products.find(x=>x.id===s.productId);
      const total = (window.n(s.price) * window.n(s.qty));
      const profit = (window.n(s.price) - window.n(s.cost)) * window.n(s.qty);
      rows.push([new Date(s.ts).toISOString(), p?.name || s.productId, s.qty, s.price, total, s.cost, profit, p?.barcode || '', s.id]);
    });
    generateCsv(rows, 'sales_all');
  });
  
  const exportCurrentReport = $('exportCurrentReport');
  if (exportCurrentReport) exportCurrentReport.addEventListener('click', function () {
    const buckets = createBuckets(currentReportRange);
    const start = buckets[0].start;
    const end = buckets[buckets.length - 1].end;
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

  /* ============================================
     SECTION 18: INSIGHTS GENERATION (Lines 2901-3050)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function createInsightStat(label, value) {
      const el = document.createElement('div');
      const labelEl = document.createElement('div');
      labelEl.className = 'small';
      labelEl.textContent = label;
      const valueEl = document.createElement('div');
      valueEl.style.fontWeight = '700';
      valueEl.textContent = value;
      el.appendChild(labelEl);
      el.appendChild(valueEl);
      return el;
  }
  
  function generateInsights(returnHtml = false) {
    try {
      const s = state || { products: [], sales: [], notes: [] };
      const wrap = document.createElement('div');
      
      const totalProducts = (s.products || []).length;
      const totalStockUnits = (s.products || []).reduce((a,p)=>a + (window.n(p.qty)), 0);
      const inventoryValue = (s.products || []).reduce((a,p)=>a + (window.n(p.qty) * window.n(p.cost)), 0);
      const salesAll = s.sales || [];
      const totalRevenue = salesAll.reduce((a,sale)=>a + (window.n(sale.price) * window.n(sale.qty)), 0);
      
      const top = document.createElement('div'); 
      top.style.display = 'grid'; 
      top.style.gridTemplateColumns = '1fr 1fr'; 
      top.style.gap = '10px';
      top.appendChild(createInsightStat('Products', totalProducts));
      top.appendChild(createInsightStat('Inventory units', totalStockUnits));
      wrap.appendChild(top);
      const r3 = createInsightStat('Inventory value', fmt(inventoryValue));
      r3.style.marginTop = '10px';
      wrap.appendChild(r3);
      const r4 = createInsightStat('Total revenue (all time)', fmt(totalRevenue));
      r4.style.marginTop = '10px';
      wrap.appendChild(r4);

      const byProd = {};
      salesAll.forEach(sale => byProd[sale.productId] = (byProd[sale.productId] || 0) + window.n(sale.qty));
      const topEntry = Object.entries(byProd).sort((a,b)=>b[1]-a[1])[0];
      const topSellerProd = topEntry ? state.products.find(p => p.id === topEntry[0]) : null;
      const topSellerName = topSellerProd ? topSellerProd.name : '—';

      const block = document.createElement('div'); 
      block.style.marginTop = '12px';
      block.appendChild(createInsightStat('Top seller (all time)', topSellerName));
      wrap.appendChild(block);
      
      if (topSellerProd && window.n(topSellerProd.qty) <= 5) {
        const alertEl = document.createElement('div');
        alertEl.style.cssText = 'background: #fffbeB; color: #b45309; padding: 10px; border-radius: 8px; margin-top: 12px; font-weight: 600;';
        alertEl.textContent = `🚨 Restock Alert: You are low on ${topSellerProd.name} (${topSellerProd.qty} left). This is your #1 top-selling product!`;
        wrap.appendChild(alertEl);
      }

      const now = Date.now();
      const salesLast30d = s.sales.filter(sale => sale.ts > now - 30 * 24 * 60 * 60 * 1000);
      const soldProductIds = new Set(salesLast30d.map(sale => sale.productId));
      const slowMover = s.products.find(p => !soldProductIds.has(p.id) && window.n(p.qty) > 0);

      if (slowMover) {
        const tipEl = document.createElement('div');
        tipEl.style.cssText = 'background: #eff6ff; color: #1e40af; padding: 10px; border-radius: 8px; margin-top: 12px; font-weight: 600;';
        tipEl.textContent = `💡 Slow Mover: ${slowMover.name} hasn't sold in over 30 days. Consider a promotion.`;
        wrap.appendChild(tipEl);
      }
      
      const lowStock = (s.products || []).filter(p => window.n(p.qty) <= 5 && p.id !== (topSellerProd ? topSellerProd.id : '')).slice(0, 3); 
      if (lowStock && lowStock.length) {
        const lowBlock = document.createElement('div'); 
        lowBlock.style.marginTop = '12px';
        const lowTitle = document.createElement('div');
        lowTitle.style.fontWeight = '700';
        lowTitle.textContent = 'Other Low Stock Items';
        lowBlock.appendChild(lowTitle);
        
        const ul = document.createElement('ul'); 
        ul.style.marginTop = '6px';
        lowStock.forEach(p=> {
          const li = document.createElement('li'); 
          li.textContent = `${p.name} — ${window.n(p.qty)} left`;
          ul.appendChild(li);
        });
        lowBlock.appendChild(ul);
        wrap.appendChild(lowBlock);
      }

      if (returnHtml) {
        return wrap.innerHTML; 
      }
      
      if (aiContent && aiCard) {
        aiContent.innerHTML = '';
        aiContent.appendChild(wrap);
        aiCard.style.display = 'block';
        if (toggleInsightsBtn) toggleInsightsBtn.setAttribute('aria-pressed','true');
      }

    } catch (e) {
      errlog('generateInsights failed', e);
      toast('Failed to generate insights', 'error');
      if (returnHtml) {
          const errEl = document.createElement('div');
          errEl.className = 'small error-text';
          errEl.textContent = 'Failed to generate insights.';
          return errEl.outerHTML;
      }
    }
  }

  if (toggleInsightsBtn) toggleInsightsBtn.addEventListener('click', function () {
    try {
      if (!aiCard) return;
      const visible = aiCard.style.display !== 'none' && aiCard.style.display !== '';
      if (visible) { aiCard.style.display = 'none'; toggleInsightsBtn.setAttribute('aria-pressed','false'); }
      else { generateInsights(); aiCard.style.display = 'block'; toggleInsightsBtn.setAttribute('aria-pressed','true'); }
    } catch (e) { errlog(e); }
  });
  if (refreshInsightsBtn) refreshInsightsBtn.addEventListener('click', generateInsights);
  
  const insightBtn = $('insightBtn');
  if (insightBtn) insightBtn.addEventListener('click', function () {
    const html = generateInsights(true); 
    showInventoryInsight(html); 
  });

  /* ============================================
     SECTION 19: UI INITIALIZATION (Lines 3051-3150)
     CHANGES: NONE - preserved exactly
     ============================================ */

  function initAppUI() {
    try {
      renderChips(); 
      renderProducts(); 
      renderInventory(); 
      renderDashboard(); 
      renderNotes();
      
      if (!document.querySelector('.panel.active')) {
          setActiveView('home', false);
      }
      showLoading(false);
      if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
      if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
      if ($('inventoryInsightView')) $('inventoryInsightView').style.display = 'none';
      if ($('smartScannerModal')) $('smartScannerModal').style.display = 'none';
      if (reportBreakdown) reportBreakdown.style.paddingBottom = '24px';
      
      if ($('confirmModalBackdrop')) $('confirmModalBackdrop').style.display = 'none';

    } catch (e) { errlog('initAppUI failed', e); }
  }

  let addFormBackdrop = null;
  function createAddBackdrop() {
    if (document.getElementById('addFormBackdrop')) return document.getElementById('addFormBackdrop');
    const d = document.createElement('div');
    d.id = 'addFormBackdrop';
    d.addEventListener('click', hideAddForm); 
    document.body.appendChild(d);
    return d;
  }

  /* ============================================
     SECTION 20: FINAL INITIALIZATION (Lines 3151-3200)
     CHANGES: NONE - preserved exactly
     ============================================ */

  document.addEventListener('DOMContentLoaded', function () {
    
    const insightBtn = $('insightBtn');
    if (insightBtn) {
      insightBtn.innerHTML = '💡 Insight';
      insightBtn.style.padding = "8px 12px";
    }
    const primaryScanBtn = $('primaryScanBtn');
    if (primaryScanBtn) {
        primaryScanBtn.style.padding = "8px 12px";
    }
    const toggleAddFormBtn = $('toggleAddFormBtn');
    if (toggleAddFormBtn) {
        toggleAddFormBtn.style.padding = "8px 12px";
    }

    try {
      if (toggleAddFormBtn && addForm) {
        toggleAddFormBtn.addEventListener('click', function (e) {
          e.preventDefault();
          try {
              editingProductId = null; 
              clearAddForm(); 
              showAddForm(true);
              setTimeout(()=>{ try { const invNameEl = $('invName'); if (invNameEl && typeof invNameEl.focus === 'function') invNameEl.focus(); }catch(e){} }, 220);
              
          } catch (err) { console.warn('toggleAddFormBtn handler error', err); }
        });
      }
    } catch(e) { console.warn('Failed to init add-form enhancements', e); }

    try {
      document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          document.body.classList.add('keyboard-open');
        }
      });
      
      document.addEventListener('focusout', (e) => {
        setTimeout(() => {
          if (!document.activeElement || (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT')) {
            document.body.classList.remove('keyboard-open');
          }
        }, 50);
      });
    } catch(e) { console.warn('keyboard detection init failed', e); }
    
    hideAllAuthForms();
    showLoginForm();
    if ($('modalBackdrop')) $('modalBackdrop').style.display = 'none';
    if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
    if ($('smartScannerModal')) $('smartScannerModal').style.display = 'none';
    if ($('confirmModalBackdrop')) $('confirmModalBackdrop').style.display = 'none';
    
    try {
      const closeInvBtn = $('closeInventoryInsightBtn');
      if (closeInvBtn) {
        closeInvBtn.addEventListener('click', closeInventoryInsight);
      }
    } catch(e) { errlog("Failed to attach insight close handler", e); }
  });

  window.__QS_APP = {
    getClient, getUser, saveState, getState: () => state, startScanner, stopScanner, generateInsights, syncCloudData, showConfirm
  };

  window.addEventListener('unhandledrejection', function (ev) { console.error('Unhandled rejection:', ev.reason); toast('An unexpected error occurred. See console.', 'error'); });
  
  log('app.js loaded (Supabase version)');
})();