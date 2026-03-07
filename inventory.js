/* ═══════════════════════════════════════════════════════════════════════════
   QUICKSHOP — INVENTORY MODULE  (inventory.js)
   Owns: scanner, image upload, add/edit form, product list, CSV import.

   Talks to appss.js ONLY via window.__QS_APP:
     state, currentUser, getClient, saveState, toast, errlog, showConfirm,
     showLoading, addActivityLog, uid, renderProducts, renderDashboard,
     renderChips, openModalFor, compressImage, createModalBackdrop,
     createModalCloseButton, setEditingProductId, getEditingProductId

   Load order in index.html: appss.js (defer) → inventory.js (defer)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Bridge helpers (always read lazily) ────────────────────────────────────
  function app()    { return window.__QS_APP || {}; }
  function state()  { return app().getState ? app().getState() : { products: [], categories: [], sales: [] }; }
  function user()   { return app().currentUser || null; }
  function client() { return app().getClient ? app().getClient() : null; }

  function toast(msg, type)        { if (app().toast)            app().toast(msg, type); }
  function errlog(...a)             { if (app().errlog)           app().errlog(...a); }
  function uid()                    { return app().uid ? app().uid() : crypto.randomUUID().replace(/-/g,'').slice(0,20); }
  function showLoading(v, t)        { if (app().showLoading)      app().showLoading(v, t); }
  function showConfirm(opts)        { return app().showConfirm ? app().showConfirm(opts) : Promise.resolve(false); }
  function addActivityLog(a, d)     { if (app().addActivityLog)   app().addActivityLog(a, d); }
  function saveState()              { return app().saveState ? app().saveState() : Promise.resolve(); }
  function renderProducts()         { if (app().renderProducts)   app().renderProducts(); }
  function renderDashboard()        { if (app().renderDashboard)  app().renderDashboard(); }
  function renderChips()            { if (app().renderChips)      app().renderChips(); }
  function openModalFor(m, id)      { if (app().openModalFor)     app().openModalFor(m, id); }
  function compressImage(f, w, q)   { return app().compressImage ? app().compressImage(f, w, q) : Promise.reject(new Error('compressImage not ready')); }
  function createModalBackdrop(id, z) { return app().createModalBackdrop ? app().createModalBackdrop(id, z) : null; }
  function createModalCloseButton(fn) { return app().createModalCloseButton ? app().createModalCloseButton(fn) : null; }

  function getEditingProductId()    { return app().getEditingProductId ? app().getEditingProductId() : null; }
  function setEditingProductId(v)   { if (app().setEditingProductId) app().setEditingProductId(v); }

  const $ = id => document.getElementById(id);

  // ── Scanner state ──────────────────────────────────────────────────────────
  let codeReader = null, videoStream = null, lastScannedBarcode = null;
  let scannerActive = false, currentScanMode = 'form', smartScanProduct = null;

  // ══════════════════════════════════════════════════════════════════════════
  // SCANNER
  // ══════════════════════════════════════════════════════════════════════════
  function stopScanner() {
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch (e) {} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch (e) {} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    const barcodeScanLine     = $('barcodeScanLine');
    const barcodeScannerModal = $('barcodeScannerModal');
    const barcodeResult       = $('barcodeResult');
    const barcodeUseBtn       = $('barcodeUseBtn');
    if (barcodeScanLine)      barcodeScanLine.style.display    = 'none';
    if (barcodeScannerModal)  barcodeScannerModal.style.display = 'none';
    if (barcodeResult)        barcodeResult.style.display      = 'none';
    if (barcodeUseBtn)        barcodeUseBtn.style.display      = 'none';
    lastScannedBarcode = null;
    smartScanProduct   = null;
  }

  function handleScanResult(result) {
    if (!result || !result.text) return;
    const scannedText = result.text;
    if (scannedText === lastScannedBarcode) return;
    lastScannedBarcode = scannedText;
    if (navigator.vibrate) navigator.vibrate(200);
    try {
      if (codeReader && codeReader.reset) codeReader.reset();
      if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
    } catch (e) {}
    const barcodeScanLine = $('barcodeScanLine');
    if (barcodeScanLine) barcodeScanLine.style.display = 'none';
    toast('Barcode scanned!', 'info');
    const scannedStr = String(scannedText).trim();

    if (currentScanMode === 'form') {
      const invBarcode = $('invBarcode');
      if (invBarcode) { invBarcode.value = scannedStr; invBarcode.focus(); }
      stopScanner();
    } else if (currentScanMode === 'smart') {
      stopScanner();
      const product = state().products.find(p => p.barcode && String(p.barcode).trim() === scannedStr);
      if (product) {
        smartScanProduct = product;
        const smartModalItem    = $('smartModalItem');
        const smartModalStock   = $('smartModalStock');
        const smartScannerModal = $('smartScannerModal');
        if (smartModalItem)  smartModalItem.textContent  = product.name;
        if (smartModalStock) smartModalStock.textContent = product.qty + ' in stock';
        if (smartScannerModal) {
          smartScannerModal.style.display = 'flex';
          const modalEl = smartScannerModal.querySelector('.modal');
          if (modalEl && !modalEl.querySelector('.modal-close-x')) {
            const closeBtn = createModalCloseButton(hideSmartModal);
            if (closeBtn) modalEl.insertBefore(closeBtn, modalEl.firstChild);
          }
        }
      } else {
        toast('New barcode — fill in the product details.', 'info');
        showAddForm();
        const invBarcode = $('invBarcode');
        if (invBarcode) { invBarcode.value = scannedText; }
        setTimeout(() => { const invName = $('invName'); if (invName) invName.focus(); }, 220);
      }
    }
  }

  async function startScanner(mode = 'form') {
    if (scannerActive) return;
    if (typeof window.ZXing === 'undefined') { toast('Barcode library not loaded.', 'error'); return; }
    currentScanMode    = mode;
    lastScannedBarcode = null;
    smartScanProduct   = null;
    try {
      const barcodeScannerModal = $('barcodeScannerModal');
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      const modalEl = barcodeScannerModal.querySelector('.modal');
      if (modalEl && !modalEl.querySelector('.modal-close-x')) {
        const closeBtn = createModalCloseButton(stopScanner);
        if (closeBtn) modalEl.insertBefore(closeBtn, modalEl.firstChild);
      }
      const barcodeResult   = $('barcodeResult');
      const barcodeUseBtn   = $('barcodeUseBtn');
      const barcodeScanLine = $('barcodeScanLine');
      const barcodeVideo    = $('barcodeVideo');
      if (barcodeResult)   barcodeResult.style.display   = 'none';
      if (barcodeUseBtn)   barcodeUseBtn.style.display   = 'none';
      if (barcodeScanLine) barcodeScanLine.style.display  = 'block';
      scannerActive = true;
      const hints   = new Map();
      const formats = [
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.UPC_A,   ZXing.BarcodeFormat.UPC_E,
      ];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      codeReader  = new ZXing.BrowserMultiFormatReader(hints);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(() => {}); }
      if (codeReader.decodeFromVideoDevice) {
        try { codeReader.decodeFromVideoDevice(null, barcodeVideo, (res) => { if (res) handleScanResult(res); }); }
        catch (e) { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res) => { if (res) handleScanResult(res); }); else throw e; }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res) => { if (res) handleScanResult(res); });
      } else { toast('Barcode scanner not supported', 'error'); stopScanner(); }
    } catch (e) { errlog('Scanner error:', e); toast('Failed to start camera. Check permissions.', 'error'); stopScanner(); }
  }

  function initBarcodeScannerHandlers() {
    const primaryScanBtn = $('primaryScanBtn');
    if (primaryScanBtn) primaryScanBtn.addEventListener('click', () => startScanner('smart'));
    const scanBarcodeBtn = $('scanBarcodeBtn');
    if (scanBarcodeBtn)  scanBarcodeBtn.addEventListener('click', () => startScanner('form'));
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
    const m = $('smartScannerModal');
    if (m) m.style.display = 'none';
    smartScanProduct = null;
  }

  function initSmartScannerHandlers() {
    const smartModalCancel = $('smartModalCancel');
    if (smartModalCancel) smartModalCancel.addEventListener('click', hideSmartModal);
    const smartModalSellBtn = $('smartModalSellBtn');
    if (smartModalSellBtn) {
      smartModalSellBtn.addEventListener('click', () => {
        if (!smartScanProduct) return;
        const id = smartScanProduct.id;
        hideSmartModal();
        openModalFor('sell', id);
      });
    }
    const smartModalRestockBtn = $('smartModalRestockBtn');
    if (smartModalRestockBtn) {
      smartModalRestockBtn.addEventListener('click', () => {
        if (!smartScanProduct) return;
        const id = smartScanProduct.id;
        hideSmartModal();
        openModalFor('add', id);
      });
    }
    const smartScannerModal = $('smartScannerModal');
    if (smartScannerModal) {
      smartScannerModal.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'smartScannerModal') hideSmartModal();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE UPLOAD
  // ══════════════════════════════════════════════════════════════════════════
  function clearInvImage() {
    const invImg           = $('invImg');
    const invImgPreview    = $('invImgPreview');
    const invImgPreviewImg = $('invImgPreviewImg');
    try { if (invImg) invImg.value = ''; } catch (e) {}
    if (invImgPreview)    invImgPreview.style.display    = 'none';
    if (invImgPreviewImg) invImgPreviewImg.src            = '';
  }

  function clearInvImage2() {
    const invImg2           = $('invImg2');
    const invImgPreview2    = $('invImgPreview2');
    const invImgPreviewImg2 = $('invImgPreviewImg2');
    try { if (invImg2) invImg2.value = ''; } catch (e) {}
    if (invImgPreview2)    invImgPreview2.style.display    = 'none';
    if (invImgPreviewImg2) invImgPreviewImg2.src            = '';
  }

  function initImageUploadHandler() {
    // ── Image 1 ──────────────────────────────────────────────────────────────
    const invImg = $('invImg');
    if (invImg) {
      invImg.addEventListener('change', async function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) { clearInvImage(); return; }
        if (file.size > 5 * 1024 * 1024) { toast('Image too large (max 5 MB).', 'error'); e.target.value = ''; return; }
        const sb = client();
        const u  = user();
        if (!sb || !u) { toast('Not logged in.', 'error'); return; }
        showLoading(true, 'Uploading image…');
        try {
          const blob     = await compressImage(file);
          const fileName = u.id + '/' + Date.now() + '.jpg';
          const { error } = await sb.storage.from('user_images').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
          if (error) throw error;
          const { data: urlData } = sb.storage.from('user_images').getPublicUrl(fileName);
          const invImgPreviewImg = $('invImgPreviewImg');
          const invImgPreview    = $('invImgPreview');
          if (invImgPreviewImg) invImgPreviewImg.src          = urlData.publicUrl;
          if (invImgPreview)    invImgPreview.style.display   = 'flex';
          toast('Image uploaded ✓');
        } catch (err) {
          errlog('Image upload failed', err);
          toast('Upload failed: ' + (err.message || 'unknown'), 'error');
          clearInvImage();
        } finally { showLoading(false); }
      });
    }
    const invImgClear = $('invImgClear');
    if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });

    // ── Image 2 ──────────────────────────────────────────────────────────────
    const invImg2 = $('invImg2');
    if (invImg2) {
      invImg2.addEventListener('change', async function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) { clearInvImage2(); return; }
        if (file.size > 5 * 1024 * 1024) { toast('Image too large (max 5 MB).', 'error'); e.target.value = ''; return; }
        const sb = client();
        const u  = user();
        if (!sb || !u) { toast('Not logged in.', 'error'); return; }
        showLoading(true, 'Uploading image 2…');
        try {
          const blob     = await compressImage(file);
          const fileName = u.id + '/2_' + Date.now() + '.jpg';
          const { error } = await sb.storage.from('user_images').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
          if (error) throw error;
          const { data: urlData } = sb.storage.from('user_images').getPublicUrl(fileName);
          const invImgPreviewImg2 = $('invImgPreviewImg2');
          const invImgPreview2    = $('invImgPreview2');
          if (invImgPreviewImg2) invImgPreviewImg2.src        = urlData.publicUrl;
          if (invImgPreview2)    invImgPreview2.style.display = 'flex';
          toast('Second image uploaded ✓');
        } catch (err) {
          errlog('Image2 upload failed', err);
          toast('Upload failed: ' + (err.message || 'unknown'), 'error');
          clearInvImage2();
        } finally { showLoading(false); }
      });
    }
    const invImgClear2 = $('invImgClear2');
    if (invImgClear2) invImgClear2.addEventListener('click', function (e) { e.preventDefault(); clearInvImage2(); });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADD / EDIT FORM
  // ══════════════════════════════════════════════════════════════════════════
  function clearAddForm() {
    ['invId','invName','invBarcode','invPrice','invCost','invQty'].forEach(id => {
      const el = $(id); if (el) el.value = '';
    });
    const invCategory = $('invCategory');
    if (invCategory) invCategory.value = state().categories[0] || 'Others';
    clearInvImage();
    clearInvImage2();
    setEditingProductId(null);
    const addProductBtn    = $('addProductBtn');
    const cancelProductBtn = $('cancelProductBtn');
    if (addProductBtn)    addProductBtn.textContent           = 'Save Product';
    if (cancelProductBtn) cancelProductBtn.style.display      = 'none';
  }

  function showAddForm() {
    populateCategoryDropdown();
    const addForm = $('addForm');
    if (!addForm) return;
    const backdrop = createModalBackdrop('addFormBackdrop', 99998);
    if (addForm.parentElement !== document.body) document.body.appendChild(addForm);
    addForm.style.cssText = `position:fixed;left:50%;top:15vh;transform:translateX(-50%);z-index:99999;max-width:720px;width:calc(100% - 32px);max-height:80vh;overflow-y:auto;border-radius:var(--radius);box-shadow:var(--shadow-glass-lg);background:var(--bg-glass);border:1px solid var(--border-glass);padding:20px;display:flex;flex-direction:column;gap:12px;transition:top 0.3s ease;will-change:transform;`;
    // Only add close button once
    let closeBtn = addForm.querySelector('.modal-close-x');
    if (closeBtn) closeBtn.remove();
    closeBtn = createModalCloseButton(hideAddForm);
    if (closeBtn) addForm.insertBefore(closeBtn, addForm.firstChild);
    if (backdrop) { backdrop.style.display = 'flex'; backdrop.onclick = (e) => { if (e.target === backdrop) hideAddForm(); }; }
    addForm.style.display = 'flex';
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const invName = $('invName');
        if (invName) invName.focus();
      });
    });
  }

  function hideAddForm() {
    clearAddForm();
    const addForm  = $('addForm');
    const backdrop = $('addFormBackdrop');
    if (addForm)  addForm.style.display  = 'none';
    if (backdrop) backdrop.style.display = 'none';
    document.body.classList.remove('modal-open');
  }

  function populateCategoryDropdown() {
    const invCategory = $('invCategory');
    if (!invCategory) return;
    invCategory.innerHTML = '';
    const cats = state().categories || [];
    cats.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat; o.textContent = cat;
      invCategory.appendChild(o);
    });
    if (!cats.includes('Others')) {
      const o = document.createElement('option');
      o.value = 'Others'; o.textContent = 'Others';
      invCategory.appendChild(o);
    }
  }

  function validateProduct(name, price, cost, qty, barcode, currentId = null) {
    if (!name || !name.trim()) return { valid: false, error: 'Product name is required' };
    if (price <= 0)            return { valid: false, error: 'Price must be greater than 0' };
    if (cost  < 0)             return { valid: false, error: 'Cost cannot be negative' };
    if (qty   < 0)             return { valid: false, error: 'Stock cannot be negative' };
    if (barcode) {
      const bc = String(barcode).trim();
      const existing = state().products.find(p => p.barcode && String(p.barcode).trim() === bc && p.id !== currentId);
      if (existing) return { valid: false, error: 'Barcode already used for "' + existing.name + '".' };
    }
    return { valid: true };
  }

  function initAddProductHandler() {
    const addProductBtn    = $('addProductBtn');
    const cancelProductBtn = $('cancelProductBtn');

    if (addProductBtn) {
      addProductBtn.addEventListener('click', async function () {
        const invName          = $('invName');
        const invBarcode       = $('invBarcode');
        const invPrice         = $('invPrice');
        const invCost          = $('invCost');
        const invQty           = $('invQty');
        const invCategory      = $('invCategory');
        const invImgPreviewImg  = $('invImgPreviewImg');
        const invImgPreviewImg2 = $('invImgPreviewImg2');

        const name     = ((invName     && invName.value)    || '').trim();
        const barcode  = ((invBarcode  && invBarcode.value) || '').trim();
        const price    = window.n(invPrice    && invPrice.value);
        const cost     = window.n(invCost     && invCost.value);
        const qty      = window.n(invQty      && invQty.value);
        const category = (invCategory && invCategory.value) || 'Others';
        const image    = (invImgPreviewImg  && invImgPreviewImg.src  && invImgPreviewImg.src  !== window.location.href) ? invImgPreviewImg.src  : null;
        const image2   = (invImgPreviewImg2 && invImgPreviewImg2.src && invImgPreviewImg2.src !== window.location.href) ? invImgPreviewImg2.src : null;

        const editingId = getEditingProductId();
        const valid = validateProduct(name, price, cost, qty, barcode, editingId);
        if (!valid.valid) { toast(valid.error, 'error'); return; }

        const origText = addProductBtn.textContent;
        addProductBtn.disabled = true;
        addProductBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block"></span> Saving…</span>';

        try {
          const s = state();
          let product, syncType;

          if (editingId) {
            // ── EDIT MODE — update in place then CLOSE modal ───────────────
            product = s.products.find(p => p.id === editingId);
            if (!product) { toast('Product not found', 'error'); return; }
            product.name      = name;
            product.barcode   = barcode || null;
            product.price     = price;
            product.cost      = cost;
            product.qty       = qty;
            product.category  = category;
            product.image     = image;
            product.image2    = image2 || null;
            product.updatedAt = Date.now();
            syncType = 'updateProduct';
            addActivityLog('Edit', 'Updated product: ' + name);
            toast('Product updated ✓');
            // Close after edit — one shot operation
            hideAddForm();
          } else {
            // ── ADD MODE — save, clear form, STAY OPEN for next product ───
            product = {
              id: uid(), name, price, cost, qty: qty || 0, category,
              image, image2: image2 || null, icon: null,
              barcode: barcode || null, createdAt: Date.now(), updatedAt: Date.now()
            };
            s.products.push(product);
            syncType = 'addProduct';
            addActivityLog('Create', 'Created product: ' + name);
            toast('Product saved — add another or tap × to close', 'success');
            // Clear form but KEEP modal open
            clearAddForm();
            populateCategoryDropdown();
            requestAnimationFrame(() => {
              const invName = $('invName');
              if (invName) invName.focus();
            });
          }

          renderInventory();
          renderProducts();
          renderDashboard();
          renderChips();
          if (window.qsdb && window.qsdb.addPendingChange) {
            await window.qsdb.addPendingChange({ type: syncType, item: product });
          }
          saveState().catch(e => errlog('addProduct sync', e));
        } finally {
          addProductBtn.disabled     = false;
          addProductBtn.textContent  = origText;
        }
      });
    }

    // Cancel button closes the modal
    if (cancelProductBtn) cancelProductBtn.addEventListener('click', hideAddForm);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INVENTORY LIST
  // ══════════════════════════════════════════════════════════════════════════
  function renderInventory() {
    const inventoryListEl = $('inventoryList');
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    const headerSearch = $('headerSearchInput');
    const q = (headerSearch && headerSearch.value.trim().toLowerCase()) || '';
    const items = (state().products || []).filter(p => {
      if (!q) return true;
      return ((p.name || '').toLowerCase().includes(q)) || (String(p.barcode || '').includes(q));
    });

    if (!items.length) {
      const no = document.createElement('div');
      no.className = 'small';
      no.style.cssText = 'padding:14px;background:var(--card-glass);border-radius:var(--radius);border:1px solid var(--border-glass);text-align:center;';
      no.textContent = q ? 'No products match your search' : 'No products in inventory';
      inventoryListEl.appendChild(no);
      return;
    }

    for (const p of items) {
      const el = document.createElement('div');
      el.className = 'inventory-card';

      const top   = document.createElement('div');
      top.className = 'inventory-top';

      const thumb = document.createElement('div');
      thumb.className = 'p-thumb';
      if (p.image) {
        const img = document.createElement('img');
        img.src = p.image; img.alt = p.name || ''; img.crossOrigin = 'anonymous';
        thumb.appendChild(img);
      } else {
        thumb.textContent = p.icon || ((p.name || '').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase());
      }

      const info = document.createElement('div');
      info.className = 'inventory-info';

      const nme = document.createElement('div');
      nme.className = 'inventory-name'; nme.textContent = p.name || 'Unnamed';

      const meta = document.createElement('div');
      meta.className = 'inventory-meta';
      meta.textContent = (p.qty || 0) + ' in stock · ' + window.fmt(p.price);

      info.appendChild(nme);
      info.appendChild(meta);

      if (p.barcode) {
        const bc = document.createElement('div');
        bc.className = 'small'; bc.style.marginTop = '4px';
        bc.textContent = 'Barcode: ' + p.barcode;
        info.appendChild(bc);
      }
      top.appendChild(thumb);
      top.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'inventory-actions';

      const restock = document.createElement('button');
      restock.className = 'btn-restock'; restock.type = 'button';
      restock.textContent = 'Restock'; restock.dataset.restock = p.id;

      const edit = document.createElement('button');
      edit.className = 'btn-edit'; edit.type = 'button';
      edit.textContent = 'Edit'; edit.dataset.edit = p.id;

      const del = document.createElement('button');
      del.className = 'btn-delete'; del.type = 'button';
      del.textContent = 'Delete'; del.dataset.delete = p.id;

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
    if (!inventoryListEl) return;
    inventoryListEl.addEventListener('click', function (ev) {
      const restock = ev.target.closest('[data-restock]');
      if (restock) { openModalFor('add', restock.dataset.restock); return; }
      const edit = ev.target.closest('[data-edit]');
      if (edit) { openEditProduct(edit.dataset.edit); return; }
      const del = ev.target.closest('[data-delete]');
      if (del) { removeProduct(del.dataset.delete); }
    });
  }

  function openEditProduct(id) {
    const p = state().products.find(x => x.id === id);
    if (!p) { toast('Product not found', 'error'); return; }
    setEditingProductId(p.id);
    populateCategoryDropdown();

    const fields = { invId: p.id, invName: p.name || '', invBarcode: p.barcode || '',
      invPrice: p.price || '', invCost: p.cost || '', invQty: p.qty || 0 };
    Object.entries(fields).forEach(([id, val]) => { const el = $(id); if (el) el.value = val; });

    const invCategory = $('invCategory');
    if (invCategory) invCategory.value = p.category || 'Others';

    if (p.image) {
      const img = $('invImgPreviewImg'), prev = $('invImgPreview');
      if (img)  img.src                = p.image;
      if (prev) prev.style.display     = 'flex';
    } else { clearInvImage(); }

    if (p.image2) {
      const img2 = $('invImgPreviewImg2'), prev2 = $('invImgPreview2');
      if (img2)  img2.src              = p.image2;
      if (prev2) prev2.style.display   = 'flex';
    } else { clearInvImage2(); }

    const addProductBtn    = $('addProductBtn');
    const cancelProductBtn = $('cancelProductBtn');
    if (addProductBtn)    addProductBtn.textContent        = 'Update Product';
    if (cancelProductBtn) cancelProductBtn.style.display   = 'block';

    showAddForm();
    setTimeout(() => { try { const invName = $('invName'); if (invName) invName.focus(); } catch (e) {} }, 220);
  }

  async function removeProduct(id) {
    const s = state();
    const p = s.products.find(x => x.id === id);
    if (!p) return;
    const confirmed = await showConfirm({
      title:    'Delete ' + p.name + '?',
      message:  'This will permanently remove the product and all its sales history.',
      okText:   'Delete Product',
      okDanger: true,
    });
    if (!confirmed) return;
    const productToRemove  = Object.assign({}, p);
    s.products = s.products.filter(x => x.id !== id);
    s.sales    = s.sales.filter(x => x.productId !== id);
    s.changes  = (s.changes || []).filter(x => x.productId !== id);
    if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'removeProduct', item: productToRemove });
    addActivityLog('Delete', 'Deleted product: ' + p.name);
    renderInventory(); renderProducts(); renderDashboard(); renderChips();
    toast('Product deleted');
    saveState().catch(e => errlog('delete sync', e));
  }

  function initToggleAddFormHandler() {
    const toggleAddFormBtn = $('toggleAddFormBtn');
    if (!toggleAddFormBtn) return;
    toggleAddFormBtn.addEventListener('click', function (e) {
      e.preventDefault();
      setEditingProductId(null);
      clearAddForm();
      showAddForm();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CSV BULK IMPORT
  // ══════════════════════════════════════════════════════════════════════════
  function parseCsvRow(row) {
    const result = []; let cur = ''; let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvRow(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
      rows.push(row);
    }
    return rows;
  }

  function downloadCsvTemplate() {
    const csv = 'Name,Price,Cost,Stock,Category,Barcode\nExample Product,1500,900,20,Drinks,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quickshop_import_template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function showCsvImportModal() {
    // Remove any existing modal
    const existing = $('csvImportModal');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'csvImportModal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:999999;display:flex;align-items:flex-end;justify-content:center;animation:fadeIn 0.2s ease;';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--bg-glass,#13132a);border:1px solid var(--border-glass,rgba(255,255,255,0.1));border-radius:20px 20px 0 0;padding:24px 20px 40px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;';

    // Header row
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:18px;font-weight:700;color:var(--text-primary,#f0f0f6);';
    title.textContent = 'Bulk Import Products';
    const closeX = document.createElement('button');
    closeX.innerHTML = '&times;';
    closeX.style.cssText = 'background:none;border:0;font-size:28px;color:var(--text-muted);cursor:pointer;padding:0 4px;line-height:1;';
    closeX.onclick = () => backdrop.remove();
    hdr.appendChild(title);
    hdr.appendChild(closeX);
    panel.appendChild(hdr);

    // Template download
    const tplRow = document.createElement('div');
    tplRow.style.cssText = 'margin-bottom:14px;';
    const tplBtn = document.createElement('button');
    tplBtn.textContent = '⬇ Download Template CSV';
    tplBtn.style.cssText = 'background:none;border:1px solid var(--border-glass,rgba(255,255,255,0.15));color:var(--text-secondary,rgba(240,240,246,0.7));padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;';
    tplBtn.onclick = downloadCsvTemplate;
    const tplHint = document.createElement('div');
    tplHint.style.cssText = 'font-size:12px;color:var(--text-muted,rgba(240,240,246,0.45));margin-top:6px;';
    tplHint.textContent = 'Columns: Name, Price, Cost, Stock, Category, Barcode';
    tplRow.appendChild(tplBtn);
    tplRow.appendChild(tplHint);
    panel.appendChild(tplRow);

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.style.cssText = 'border:2px dashed var(--border-glass,rgba(255,255,255,0.15));border-radius:12px;padding:28px 20px;text-align:center;cursor:pointer;transition:border-color 0.2s;margin-bottom:12px;';
    const dropLabel = document.createElement('div');
    dropLabel.style.cssText = 'font-size:14px;color:var(--text-secondary);';
    dropLabel.innerHTML = '📂 Tap to choose CSV or drag &amp; drop here';
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.csv,text/csv';
    fileInput.style.display = 'none';
    dropZone.appendChild(dropLabel);
    dropZone.appendChild(fileInput);
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent,#7c3aed)'; };
    dropZone.ondragleave = () => { dropZone.style.borderColor = ''; };
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.style.borderColor = ''; handleFile(e.dataTransfer.files[0]); };
    panel.appendChild(dropZone);

    // Preview table container
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'display:none;margin-bottom:14px;overflow-x:auto;';
    panel.appendChild(previewWrap);

    // Import button
    const importBtn = document.createElement('button');
    importBtn.style.cssText = 'display:none;width:100%;padding:14px;background:var(--accent,#7c3aed);color:#fff;border:0;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;';
    importBtn.textContent = 'Import Products';
    panel.appendChild(importBtn);

    let parsedRows = [];

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        parsedRows = [];
        previewWrap.innerHTML = '';
        previewWrap.style.display = 'none';
        importBtn.style.display = 'none';

        const rows = parseCsv(e.target.result);
        if (!rows.length) { toast('CSV appears empty or unreadable', 'error'); return; }

        const existingBarcodes = new Set(state().products.filter(p => p.barcode).map(p => String(p.barcode).trim()));

        // Build preview table
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr style="border-bottom:1px solid rgba(255,255,255,0.1);">' +
          ['Name','Price','Cost','Stock','Category','Status'].map(h =>
            `<th style="padding:6px 8px;text-align:left;color:var(--text-muted);font-weight:600;">${h}</th>`
          ).join('') + '</tr>';
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        rows.forEach((row, idx) => {
          const name     = (row.name || row['productname'] || '').trim();
          const price    = parseFloat(row.price || 0);
          const cost     = parseFloat(row.cost || 0);
          const stock    = parseInt(row.stock || row.qty || row.quantity || 0, 10);
          const category = (row.category || 'Others').trim();
          const barcode  = (row.barcode || '').trim();

          let status = '✓ Ready'; let statusColor = '#10b981'; let valid = true;
          if (!name) { status = '✗ Name missing'; statusColor = '#ef4444'; valid = false; }
          else if (price <= 0) { status = '✗ Price invalid'; statusColor = '#ef4444'; valid = false; }
          else if (barcode && existingBarcodes.has(barcode)) { status = '⚠ Barcode exists'; statusColor = '#f59e0b'; valid = false; }

          if (valid) parsedRows.push({ name, price, cost, qty: stock, category, barcode: barcode || null });

          const tr = document.createElement('tr');
          tr.style.cssText = `border-bottom:1px solid rgba(255,255,255,0.05);background:${!valid ? 'rgba(239,68,68,0.06)' : ''};`;
          [name||'—', price||'—', cost||'—', stock, category, status].forEach((val, i) => {
            const td = document.createElement('td');
            td.style.cssText = `padding:6px 8px;${i === 5 ? 'color:' + statusColor + ';font-weight:600;' : 'color:var(--text-secondary);'}`;
            td.textContent = val;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:13px;color:var(--text-secondary);margin-bottom:10px;';
        summary.textContent = parsedRows.length + ' of ' + rows.length + ' rows ready to import';
        previewWrap.appendChild(summary);
        previewWrap.appendChild(table);
        previewWrap.style.display = 'block';

        if (parsedRows.length > 0) {
          importBtn.textContent   = 'Import ' + parsedRows.length + ' Products';
          importBtn.style.display = 'block';
        }
      };
      reader.readAsText(file);
    }

    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    importBtn.addEventListener('click', async function () {
      if (!parsedRows.length) return;
      importBtn.disabled   = true;
      importBtn.textContent = '⏳ Importing…';
      try {
        const s = state();
        for (const row of parsedRows) {
          const product = {
            id: uid(), name: row.name, price: row.price, cost: row.cost,
            qty: row.qty, category: row.category, barcode: row.barcode,
            image: null, image2: null, icon: null, createdAt: Date.now(), updatedAt: Date.now()
          };
          s.products.push(product);
          if (!s.categories.includes(row.category)) s.categories.push(row.category);
          if (window.qsdb && window.qsdb.addPendingChange) {
            await window.qsdb.addPendingChange({ type: 'addProduct', item: product });
          }
        }
        addActivityLog('Import', 'CSV bulk imported ' + parsedRows.length + ' products');
        await saveState();
        renderInventory(); renderProducts(); renderDashboard(); renderChips();
        toast(parsedRows.length + ' products imported ✓', 'success');
        backdrop.remove();
        if (window.qsdb && window.qsdb.syncPendingToSupabase) {
          window.qsdb.syncPendingToSupabase().catch(() => {});
        }
      } catch (e) {
        errlog('CSV import failed', e);
        toast('Import failed: ' + (e.message || 'unknown'), 'error');
        importBtn.disabled   = false;
        importBtn.textContent = 'Import Products';
      }
    });

    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  function initCsvImportHandler() {
    const csvImportBtn = $('csvImportBtn2') || $('csvImportBtn');
    if (csvImportBtn) csvImportBtn.addEventListener('click', showCsvImportModal);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — called by appss.js
  // ══════════════════════════════════════════════════════════════════════════
  function initAll() {
    initBarcodeScannerHandlers();
    initSmartScannerHandlers();
    initImageUploadHandler();
    initAddProductHandler();
    initInventoryListHandlers();
    initToggleAddFormHandler();
    initCsvImportHandler();
  }

  window.__QS_INVENTORY = Object.freeze({
    initAll,
    renderInventory,
    showAddForm,
    hideAddForm,
    clearAddForm,
    openEditProduct,
    populateCategoryDropdown,
    stopScanner,
    startScanner,
    showCsvImportModal,
  });

  // Signal appss.js that we're ready (in case appss.js loaded first and we weren't ready yet)
  document.dispatchEvent(new Event('qs:inventory:ready'));

})();
