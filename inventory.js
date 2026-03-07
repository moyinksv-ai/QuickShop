/* ═══════════════════════════════════════════════════════════════════════════
   QUICKSHOP — INVENTORY MODULE
   Owns: product list, add/edit form, image upload, barcode scanner,
         smart scan, category dropdown, toggle-add-form button.

   Communicates with appss.js ONLY via:
     window.__QS_INV_BRIDGE  — set by appss.js (state, helpers, cross-renders)
     window.__QS_INVENTORY   — set here (public API appss.js calls back)

   Load order: appss.js first, then inventory.js.
   appss.js calls window.__QS_INVENTORY.initAll() during its init sequence.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Bridge helpers — always read lazily, never cached at module load ────────
  function bridge()    { return window.__QS_INV_BRIDGE || {}; }
  function getState()  { return bridge().state  || { products: [], categories: [], sales: [] }; }
  function getUser()   { return bridge().currentUser || null; }
  function getClient() { return (typeof bridge().getClient === 'function') ? bridge().getClient() : null; }

  // Shorthand helpers that defer to the bridge
  function toast(msg, type)   { if (typeof bridge().toast === 'function') bridge().toast(msg, type); }
  function errlog(...a)        { if (typeof bridge().errlog === 'function') bridge().errlog(...a); }
  function uid()               { return (typeof bridge().uid === 'function') ? bridge().uid() : crypto.randomUUID().replace(/-/g,'').slice(0,20); }
  function showLoading(v, t)   { if (typeof bridge().showLoading === 'function') bridge().showLoading(v, t); }
  function showConfirm(opts)   { return (typeof bridge().showConfirm === 'function') ? bridge().showConfirm(opts) : Promise.resolve(false); }
  function addActivityLog(a,d) { if (typeof bridge().addActivityLog === 'function') bridge().addActivityLog(a, d); }
  function saveState()         { return (typeof bridge().saveState === 'function') ? bridge().saveState() : Promise.resolve(); }
  function compressImage(f)    { return (typeof bridge().compressImage === 'function') ? bridge().compressImage(f) : Promise.resolve(f); }
  function showAddForm(m)      { if (typeof bridge().showAddForm === 'function') bridge().showAddForm(m); }
  function hideAddForm()       { if (typeof bridge().hideAddForm === 'function') bridge().hideAddForm(); }
  function openModalFor(m, id) { if (typeof bridge().openModalFor === 'function') bridge().openModalFor(m, id); }
  function createModalCloseButton(fn) { return (typeof bridge().createModalCloseButton === 'function') ? bridge().createModalCloseButton(fn) : document.createElement('button'); }

  // Cross-renders — trigger appss.js UI updates after inventory mutations
  function renderProducts()  { if (typeof bridge().renderProducts  === 'function') bridge().renderProducts(); }
  function renderDashboard() { if (typeof bridge().renderDashboard === 'function') bridge().renderDashboard(); }
  function renderChips()     { if (typeof bridge().renderChips     === 'function') bridge().renderChips(); }

  // editingProductId lives in appss.js scope; accessed via bridge getter/setter
  function getEditingId() { return bridge().editingProductId ?? null; }
  function setEditingId(v){ if (bridge()) bridge().editingProductId = v; }

  const $ = id => document.getElementById(id);
  const fmt = v => '₦' + Number(v || 0).toLocaleString('en-NG');

  // ── SCANNER STATE ──────────────────────────────────────────────────────────
  let codeReader        = null;
  let videoStream       = null;
  let lastScannedBarcode = null;
  let scannerActive     = false;
  let currentScanMode   = 'form';
  let smartScanProduct  = null;

  // ══════════════════════════════════════════════════════════════════════════
  // SCANNER
  // ══════════════════════════════════════════════════════════════════════════

  function stopScanner() {
    try {
      if (codeReader && codeReader.reset) { try { codeReader.reset(); } catch (e) {} }
      if (videoStream) { try { videoStream.getTracks().forEach(t => t.stop()); } catch (e) {} videoStream = null; }
    } catch (e) { console.warn('stopScanner err', e); }
    scannerActive = false;
    const barcodeScanLine    = $('barcodeScanLine');
    const barcodeScannerModal = $('barcodeScannerModal');
    const barcodeResult      = $('barcodeResult');
    const barcodeUseBtn      = $('barcodeUseBtn');
    if (barcodeScanLine)    barcodeScanLine.style.display   = 'none';
    if (barcodeScannerModal) barcodeScannerModal.style.display = 'none';
    if (barcodeResult)      barcodeResult.style.display     = 'none';
    if (barcodeUseBtn)      barcodeUseBtn.style.display     = 'none';
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
    } catch (e) { console.warn('Reset error', e); }
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
      const product = getState().products.find(p => p.barcode && String(p.barcode).trim() === scannedStr);
      if (product) {
        smartScanProduct = product;
        const smartModalItem  = $('smartModalItem');
        const smartModalStock = $('smartModalStock');
        const smartScannerModal = $('smartScannerModal');
        const smartModalSellBtn = $('smartModalSellBtn');
        if (smartModalItem)  smartModalItem.textContent  = product.name;
        if (smartModalStock) smartModalStock.textContent = product.qty + ' in stock';
        if (smartScannerModal) {
          smartScannerModal.style.display = 'flex';
          const modalEl = smartScannerModal.querySelector('.modal');
          if (modalEl && !modalEl.querySelector('.modal-close-x')) {
            const closeBtn = createModalCloseButton(hideSmartModal);
            modalEl.insertBefore(closeBtn, modalEl.firstChild);
          }
          if (smartModalSellBtn) smartModalSellBtn.textContent = 'Sell';
        }
      } else {
        toast('New barcode found. Add product.', 'info');
        showAddForm(true);
        const invBarcode = $('invBarcode');
        if (invBarcode) invBarcode.value = scannedText;
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
      const barcodeResult      = $('barcodeResult');
      const barcodeUseBtn      = $('barcodeUseBtn');
      const barcodeScanLine    = $('barcodeScanLine');
      const barcodeVideo       = $('barcodeVideo');
      if (!barcodeScannerModal) return;
      barcodeScannerModal.style.display = 'flex';
      const modalEl = barcodeScannerModal.querySelector('.modal');
      if (modalEl && !modalEl.querySelector('.modal-close-x')) {
        const closeBtn = createModalCloseButton(stopScanner);
        modalEl.insertBefore(closeBtn, modalEl.firstChild);
      }
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
      codeReader = new ZXing.BrowserMultiFormatReader(hints);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoStream = stream;
      if (barcodeVideo) { barcodeVideo.srcObject = stream; barcodeVideo.play().catch(() => {}); }
      if (codeReader.decodeFromVideoDevice) {
        try { codeReader.decodeFromVideoDevice(null, barcodeVideo, (res) => { if (res) handleScanResult(res); }); }
        catch (e) { try { if (codeReader.decodeContinuously) codeReader.decodeContinuously(barcodeVideo, (res) => { if (res) handleScanResult(res); }); } catch (ex) { throw ex; } }
      } else if (codeReader.decodeContinuously) {
        codeReader.decodeContinuously(barcodeVideo, (res) => { if (res) handleScanResult(res); });
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

  // ══════════════════════════════════════════════════════════════════════════
  // FORM — IMAGE UPLOAD
  // ══════════════════════════════════════════════════════════════════════════

  function clearInvImage() {
    const invImg          = $('invImg');
    const invImgPreview   = $('invImgPreview');
    const invImgPreviewImg = $('invImgPreviewImg');
    try { if (invImg) invImg.value = ''; } catch (e) {}
    if (invImgPreview)    invImgPreview.style.display    = 'none';
    if (invImgPreviewImg) invImgPreviewImg.src = '';
  }

  function initImageUploadHandler() {
    const invImg = $('invImg');
    if (!invImg) return;
    invImg.addEventListener('change', async function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) { clearInvImage(); return; }
      const MAX_IMG_SIZE = 5 * 1024 * 1024;
      if (file.size > MAX_IMG_SIZE) { toast('Image too large (max 5 MB).', 'error'); e.target.value = ''; return; }
      const supabase = getClient();
      if (!supabase || !getUser()) { toast('Storage not ready or user not logged in.', 'error'); return; }
      showLoading(true, 'Compressing & Uploading…');
      try {
        const compressedBlob = await compressImage(file);
        const fileName = getUser().id + '/' + Date.now() + '.jpg';
        const { error } = await supabase.storage.from('user_images').upload(fileName, compressedBlob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('user_images').getPublicUrl(fileName);
        const downloadURL = urlData.publicUrl;
        showLoading(false);
        const invImgPreviewImg = $('invImgPreviewImg');
        const invImgPreview    = $('invImgPreview');
        if (invImgPreviewImg) invImgPreviewImg.src = downloadURL;
        if (invImgPreview)    invImgPreview.style.display = 'flex';
        toast('Image uploaded');
      } catch (err) {
        errlog('Image upload failed', err);
        toast('Image upload failed: ' + err.message, 'error');
        showLoading(false);
        clearInvImage();
      }
    });
    const invImgClear = $('invImgClear');
    if (invImgClear) invImgClear.addEventListener('click', function (e) { e.preventDefault(); clearInvImage(); });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FORM — ADD / EDIT PRODUCT
  // ══════════════════════════════════════════════════════════════════════════

  function clearAddForm() {
    const invId          = $('invId');
    const invName        = $('invName');
    const invBarcode     = $('invBarcode');
    const invPrice       = $('invPrice');
    const invCost        = $('invCost');
    const invQty         = $('invQty');
    const invCategory    = $('invCategory');
    const addProductBtn  = $('addProductBtn');
    const cancelProductBtn = $('cancelProductBtn');
    if (invId)       invId.value       = '';
    if (invName)     invName.value     = '';
    if (invBarcode)  invBarcode.value  = '';
    if (invPrice)    invPrice.value    = '';
    if (invCost)     invCost.value     = '';
    if (invQty)      invQty.value      = '';
    if (invCategory) invCategory.value = 'Others';
    clearInvImage();
    setEditingId(null);
    if (addProductBtn)  addProductBtn.textContent       = 'Save Product';
    if (cancelProductBtn) cancelProductBtn.style.display = 'none';
  }

  function populateCategoryDropdown() {
    const invCategory = $('invCategory');
    if (!invCategory) return;
    invCategory.innerHTML = '';
    const state = getState();
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
    if (!name || name.trim().length === 0)  return { valid: false, error: 'Product name is required' };
    if (price <= 0)  return { valid: false, error: 'Price must be greater than 0' };
    if (cost  < 0)   return { valid: false, error: 'Cost cannot be negative' };
    if (qty   < 0)   return { valid: false, error: 'Stock cannot be negative' };
    if (barcode) {
      const checkBc  = String(barcode).trim();
      const existing = getState().products.find(p => p.barcode && String(p.barcode).trim() === checkBc && p.id !== currentId);
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
        const invImgPreviewImg = $('invImgPreviewImg');

        const name     = ((invName     && invName.value)     || '').trim();
        const barcode  = ((invBarcode  && invBarcode.value)  || '').trim();
        const price    = window.n(invPrice    && invPrice.value);
        const cost     = window.n(invCost     && invCost.value);
        const qty      = window.n(invQty      && invQty.value);
        const category = (invCategory && invCategory.value) || 'Others';
        const image    = (invImgPreviewImg && invImgPreviewImg.src && invImgPreviewImg.src !== window.location.href) ? invImgPreviewImg.src : null;

        const editingId = getEditingId();
        const valid     = validateProduct(name, price, cost, qty, barcode, editingId);
        if (!valid.valid) {
          const modal = addProductBtn.closest('.modal') || addProductBtn.closest('.add-card');
          toast(valid.error, 'error');
          if (modal) { modal.style.animation = 'shake 0.3s ease'; setTimeout(() => { modal.style.animation = ''; }, 300); }
          return;
        }

        const origBtnText = addProductBtn.textContent;
        addProductBtn.disabled = true;
        addProductBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block"></span> Saving…</span>';

        try {
          const state = getState();
          let product, syncType;
          if (editingId) {
            product = state.products.find(p => p.id === editingId);
            if (!product) { toast('Product to update not found', 'error'); return; }
            product.name      = name;
            product.barcode   = barcode;
            product.price     = price;
            product.cost      = cost;
            product.qty       = qty;
            product.category  = category;
            product.image     = image;
            product.updatedAt = Date.now();
            syncType = 'updateProduct';
            addActivityLog('Edit', 'Updated product: ' + name);
            toast('Product updated');
          } else {
            product = { id: uid(), name, price, cost, qty: qty || 0, category, image, icon: null, barcode: barcode || null, createdAt: Date.now() };
            state.products.push(product);
            syncType = 'addProduct';
            addActivityLog('Create', 'Created product: ' + name);
            toast('Product saved');
          }
          hideAddForm();
          renderInventory();
          renderProducts();
          renderDashboard();
          renderChips();
          if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: syncType, item: product });
          saveState().catch(e => errlog('addProduct sync', e));
        } finally {
          addProductBtn.disabled  = false;
          addProductBtn.textContent = origBtnText;
        }
      });
    }
    if (cancelProductBtn) cancelProductBtn.addEventListener('click', hideAddForm);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INVENTORY LIST RENDER
  // ══════════════════════════════════════════════════════════════════════════

  function renderInventory() {
    const inventoryListEl = $('inventoryList');
    if (!inventoryListEl) return;
    inventoryListEl.innerHTML = '';
    const headerSearch = $('headerSearch');
    const q = (headerSearch && headerSearch.value.trim().toLowerCase()) || '';
    const items = (getState().products || []).filter(p => {
      if (q && !((p.name || '').toLowerCase().includes(q)) && !((p.barcode || '') + '').includes(q)) return false;
      return true;
    });

    if (!items.length) {
      const no = document.createElement('div');
      no.className = 'small';
      no.style.cssText = 'padding:14px;background:var(--card-glass);border-radius:var(--radius);border:1px solid var(--border-glass);text-align:center;';
      no.textContent = 'No products in inventory';
      inventoryListEl.appendChild(no);
      return;
    }

    for (const p of items) {
      const el  = document.createElement('div');
      el.className = 'inventory-card';

      const top   = document.createElement('div');
      top.className = 'inventory-top';

      const thumb = document.createElement('div');
      thumb.className = 'p-thumb';
      if (p.image) {
        const img = document.createElement('img');
        img.src         = p.image;
        img.alt         = p.name || '';
        img.crossOrigin = 'anonymous';
        thumb.appendChild(img);
      } else {
        thumb.textContent = (p.icon && p.icon.length) ? p.icon : ((p.name || '').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase());
      }

      const info = document.createElement('div');
      info.className = 'inventory-info';
      const nme  = document.createElement('div');
      nme.className   = 'inventory-name';
      nme.textContent = p.name || 'Unnamed';
      const meta = document.createElement('div');
      meta.className   = 'inventory-meta';
      meta.textContent = (p.qty || 0) + ' in stock · ' + fmt(p.price);
      info.appendChild(nme);
      info.appendChild(meta);

      if (p.barcode) {
        const bc = document.createElement('div');
        bc.className = 'small';
        bc.style.marginTop = '4px';
        bc.textContent     = 'Barcode: ' + p.barcode;
        info.appendChild(bc);
      }
      top.appendChild(thumb);
      top.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'inventory-actions';

      const restock = document.createElement('button');
      restock.className       = 'btn-restock';
      restock.type            = 'button';
      restock.textContent     = 'Restock';
      restock.dataset.restock = p.id;

      const edit = document.createElement('button');
      edit.className   = 'btn-edit';
      edit.type        = 'button';
      edit.textContent = 'Edit';
      edit.dataset.edit = p.id;

      const del = document.createElement('button');
      del.className    = 'btn-delete';
      del.type         = 'button';
      del.textContent  = 'Delete';
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
    if (!inventoryListEl) return;
    inventoryListEl.addEventListener('click', function (ev) {
      const restock = ev.target.closest('[data-restock]');
      if (restock) { openModalFor('add', restock.dataset.restock); return; }
      const edit = ev.target.closest('[data-edit]');
      if (edit) { openEditProduct(edit.dataset.edit); return; }
      const del = ev.target.closest('[data-delete]');
      if (del) { removeProduct(del.dataset.delete); return; }
    });
  }

  function openEditProduct(id) {
    const state   = getState();
    const p       = state.products.find(x => x.id === id);
    if (!p) { toast('Product not found', 'error'); return; }
    setEditingId(p.id);
    populateCategoryDropdown();
    const invId            = $('invId');
    const invName          = $('invName');
    const invBarcode       = $('invBarcode');
    const invPrice         = $('invPrice');
    const invCost          = $('invCost');
    const invQty           = $('invQty');
    const invCategory      = $('invCategory');
    const invImgPreviewImg = $('invImgPreviewImg');
    const invImgPreview    = $('invImgPreview');
    const addProductBtn    = $('addProductBtn');
    const cancelProductBtn = $('cancelProductBtn');
    if (invId)       invId.value       = p.id;
    if (invName)     invName.value     = p.name    || '';
    if (invBarcode)  invBarcode.value  = p.barcode || '';
    if (invPrice)    invPrice.value    = p.price   || '';
    if (invCost)     invCost.value     = p.cost    || '';
    if (invQty)      invQty.value      = p.qty     || 0;
    if (invCategory) invCategory.value = p.category || 'Others';
    if (p.image) {
      if (invImgPreviewImg) invImgPreviewImg.src = p.image;
      if (invImgPreview)    invImgPreview.style.display = 'flex';
    } else {
      clearInvImage();
    }
    if (addProductBtn)    addProductBtn.textContent         = 'Update Product';
    if (cancelProductBtn) cancelProductBtn.style.display    = 'block';
    showAddForm(true);
    setTimeout(() => { try { if (invName) invName.focus(); } catch (e) {} }, 220);
  }

  async function removeProduct(id) {
    const state = getState();
    const p     = state.products.find(x => x.id === id);
    if (!p) return;
    const confirmed = await showConfirm({
      title:   'Delete ' + p.name + '?',
      message: 'This will permanently remove the product and all its sales history. This action cannot be undone.',
      okText:  'Delete Product',
      okDanger: true,
    });
    if (!confirmed) return;
    const productToRemove = Object.assign({}, p);
    state.products = state.products.filter(x => x.id !== id);
    state.sales    = state.sales.filter(s => s.productId !== id);
    state.changes  = (state.changes || []).filter(c => c.productId !== id);
    if (window.qsdb && window.qsdb.addPendingChange) await window.qsdb.addPendingChange({ type: 'removeProduct', item: productToRemove });
    addActivityLog('Delete', 'Deleted product: ' + p.name);
    renderInventory();
    renderProducts();
    renderDashboard();
    renderChips();
    toast('Product deleted');
    saveState().catch(e => errlog('delete sync', e));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TOGGLE-ADD-FORM BUTTON
  // ══════════════════════════════════════════════════════════════════════════

  function initToggleAddFormHandler() {
    const toggleAddFormBtn = $('toggleAddFormBtn');
    if (!toggleAddFormBtn) return;
    toggleAddFormBtn.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        setEditingId(null);
        clearAddForm();
        showAddForm(true);
        setTimeout(() => { try { const invName = $('invName'); if (invName && typeof invName.focus === 'function') invName.focus(); } catch (e) {} }, 220);
      } catch (err) { console.warn('toggleAddFormBtn handler error', err); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════

  function initAll() {
    initBarcodeScannerHandlers();
    initSmartScannerHandlers();
    initInventoryListHandlers();
    initImageUploadHandler();
    initAddProductHandler();
    initToggleAddFormHandler();
  }

  window.__QS_INVENTORY = {
    initAll,
    renderInventory,
    clearAddForm,
    populateCategoryDropdown,
    openEditProduct,
    startScanner,
    stopScanner,
  };

})();
