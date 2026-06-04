/* ═══════════════════════════════════════════════════════════════════════════
   QUICKSHOP — canonical.js
   Canonical product identity: fuzzy-match suggestions on the add-product form.

   Responsibilities:
     • Debounced input listener on #invName → calls qs_find_canonical RPC
     • Renders suggestion strip below the name field
     • Tracks vendor's canonical selection (or "new product" choice)
     • Fire-and-forget registerListing() after each product save

   Exposes: window.__QS_CANONICAL
     .getSelectedId()           → UUID | null  (read by inventory.js save hook)
     .registerListing(product)  → Promise<void> (called by inventory.js after save)
     .reset()                   → void          (called by inventory.js on clearAddForm)

   Talks to Supabase via window.__QS_APP.getClient() — same bridge as all modules.
   Must load BEFORE inventory.js (enforced in qs-init.js load order).
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Bridge ─────────────────────────────────────────────────────────────────
  function client() {
    return window.__QS_APP && window.__QS_APP.getClient
      ? window.__QS_APP.getClient()
      : null;
  }
  function currentUser() {
    return window.__QS_APP && window.__QS_APP.currentUser
      ? window.__QS_APP.currentUser
      : null;
  }
  function errlog(...a) {
    if (window.__QS_APP && window.__QS_APP.errlog) window.__QS_APP.errlog(...a);
    else console.error('[canonical]', ...a);
  }

  // ── State ───────────────────────────────────────────────────────────────────
  // Null  = no suggestion chosen yet (vendor will create a new canonical on save)
  // UUID  = vendor clicked a suggestion (link to that canonical on save)
  // false = vendor explicitly clicked "List as new" (create fresh canonical on save)
  let _selectedId = null;
  let _debounceTimer = null;
  let _attached = false;
  let _stripEl = null;

  // ── CSS (injected once) ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('qs-canonical-styles')) return;
    const style = document.createElement('style');
    style.id = 'qs-canonical-styles';
    style.textContent = `
      #qs-canon-strip {
        display: none;
        flex-direction: column;
        gap: 6px;
        margin-top: -4px;
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        padding: 10px 12px;
        font-size: 12px;
        animation: qs-canon-in 0.18s ease;
      }
      @keyframes qs-canon-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      #qs-canon-strip .qs-canon-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.8px;
        text-transform: uppercase;
        color: var(--text-muted, #888);
        margin-bottom: 2px;
      }
      .qs-canon-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: background 0.12s, border-color 0.12s;
        background: transparent;
        width: 100%;
        text-align: left;
      }
      .qs-canon-row:hover {
        background: rgba(255,255,255,0.05);
      }
      .qs-canon-row.selected {
        background: rgba(0,200,150,0.08);
        border-color: rgba(0,200,150,0.35);
      }
      .qs-canon-row .qs-canon-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 2px solid var(--text-muted, #888);
        flex-shrink: 0;
        transition: background 0.12s, border-color 0.12s;
      }
      .qs-canon-row.selected .qs-canon-dot {
        background: #00c896;
        border-color: #00c896;
      }
      .qs-canon-row .qs-canon-name {
        flex: 1;
        font-size: 13px;
        font-weight: 600;
        color: var(--text, #f0f0f0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .qs-canon-row .qs-canon-badge {
        font-size: 11px;
        font-weight: 700;
        color: #00c896;
        background: rgba(0,200,150,0.1);
        padding: 2px 7px;
        border-radius: 99px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .qs-canon-row.qs-canon-new .qs-canon-name {
        color: var(--text-muted, #888);
        font-weight: 500;
      }
      .qs-canon-row.qs-canon-new .qs-canon-dot {
        border-style: dashed;
      }
      .qs-canon-row.qs-canon-new.selected .qs-canon-dot {
        background: var(--text-muted, #888);
        border-color: var(--text-muted, #888);
      }
    `;
    document.head.appendChild(style);
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  function getNameInput() {
    return document.getElementById('invName');
  }

  function ensureStrip() {
    if (_stripEl && _stripEl.isConnected) return _stripEl;

    const existing = document.getElementById('qs-canon-strip');
    if (existing) { _stripEl = existing; return _stripEl; }

    const strip = document.createElement('div');
    strip.id = 'qs-canon-strip';

    const nameInput = getNameInput();
    if (!nameInput) return null;

    nameInput.parentNode.insertBefore(strip, nameInput.nextSibling);
    _stripEl = strip;
    return strip;
  }

  function showStrip(candidates) {
    const strip = ensureStrip();
    if (!strip) return;

    strip.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'qs-canon-label';
    label.textContent = candidates.length
      ? 'Similar products in QuickShop network'
      : '';
    strip.appendChild(label);

    // Render each candidate
    candidates.forEach(c => {
      const row = buildRow(c.id, c.display_name, c.vendor_count, false);
      strip.appendChild(row);
    });

    // Always append "List as new product" option
    const newRow = buildRow(false, '+ List as a new product', null, true);
    strip.appendChild(newRow);

    strip.style.display = 'flex';

    // Auto-select first match if similarity is very high (≥ 0.75)
    if (candidates.length && candidates[0].sim >= 0.75) {
      selectRow(strip, candidates[0].id);
    }
  }

  function hideStrip() {
    const strip = document.getElementById('qs-canon-strip');
    if (strip) strip.style.display = 'none';
  }

  function buildRow(id, name, vendorCount, isNew) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'qs-canon-row' + (isNew ? ' qs-canon-new' : '');
    row.dataset.canonicalId = id === false ? '__new__' : (id || '__new__');

    const dot = document.createElement('span');
    dot.className = 'qs-canon-dot';

    const nameEl = document.createElement('span');
    nameEl.className = 'qs-canon-name';
    nameEl.textContent = name;

    row.appendChild(dot);
    row.appendChild(nameEl);

    if (vendorCount && vendorCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'qs-canon-badge';
      badge.textContent = vendorCount === 1
        ? '1 store'
        : vendorCount + ' stores';
      row.appendChild(badge);
    }

    row.addEventListener('click', function () {
      const strip = document.getElementById('qs-canon-strip');
      if (!strip) return;
      const chosen = row.dataset.canonicalId;
      if (chosen === '__new__') {
        _selectedId = false; // explicit "new product"
      } else {
        _selectedId = chosen;
      }
      selectRow(strip, _selectedId);
    });

    return row;
  }

  function selectRow(strip, id) {
    const rows = strip.querySelectorAll('.qs-canon-row');
    rows.forEach(r => {
      const isThis = (id === false || id === null)
        ? r.dataset.canonicalId === '__new__'
        : r.dataset.canonicalId === id;
      r.classList.toggle('selected', isThis);
    });
  }

  // ── Core search ─────────────────────────────────────────────────────────────
  async function search(name) {
    const sb = client();
    if (!sb || !name || name.length < 3) {
      hideStrip();
      return;
    }

    try {
      const { data, error } = await sb.rpc('qs_find_canonical', {
        p_name: name,
        p_threshold: 0.30
      });

      if (error) {
        // Silent fail — canonical is additive, not blocking
        errlog('canonical search error', error);
        hideStrip();
        return;
      }

      if (!data || data.length === 0) {
        // No matches — don't show anything, vendor is adding a genuinely new product
        hideStrip();
        _selectedId = null;
        return;
      }

      showStrip(data);
    } catch (e) {
      errlog('canonical search exception', e);
      hideStrip();
    }
  }

  // ── Attach input listener ───────────────────────────────────────────────────
  function attach() {
    if (_attached) return;

    injectStyles();

    const nameInput = getNameInput();
    if (!nameInput) return;

    nameInput.addEventListener('input', function () {
      const val = nameInput.value.trim();

      // Reset selection when vendor types (they're reconsidering)
      _selectedId = null;

      clearTimeout(_debounceTimer);

      if (val.length < 3) {
        hideStrip();
        return;
      }

      _debounceTimer = setTimeout(function () {
        search(val);
      }, 550); // 550ms: fast enough to feel live, not so fast it hammers the DB
    });

    _attached = true;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  async function registerListing(product) {
    // Fire-and-forget. Never blocks the UI or throws to caller.
    const sb = client();
    const u  = currentUser();
    if (!sb || !u) return;

    // Resolve what canonical to register:
    // _selectedId = UUID  → link to that canonical
    // _selectedId = false → vendor said "new product", force fresh canonical
    // _selectedId = null  → no suggestion was interacted with, create canonical from name
    const canonicalId = (typeof _selectedId === 'string') ? _selectedId : null;

    try {
      const { error } = await sb.rpc('qs_register_listing', {
        p_vendor_id:        u.id,
        p_vendor_store_id:  u.id,          // one store per vendor; refine later
        p_local_product_id: product.id,
        p_name:             product.name,
        p_price:            product.price,
        p_category:         product.category || null,
        p_canonical_id:     canonicalId
      });

      if (error) errlog('canonical registerListing error', error);

      // ── Pipe image_url into the listing ─────────────────────────────────
      // The RPC doesn't accept image_url (to avoid schema coupling), so we
      // update it separately. The DB trigger then propagates it to the
      // canonical product when canonical.image_url is still null.
      // product.image is the internal field name; image_url is the DB column.
      const imageVal = product.image || null;
      if (!error && imageVal) {
        await sb
          .from('qs_vendor_listings')
          .update({ image_url: imageVal })
          .eq('vendor_store_id', u.id)
          .eq('local_product_id', product.id);
      }
    } catch (e) {
      errlog('canonical registerListing exception', e);
    }
  }

  function getSelectedId() {
    return _selectedId; // UUID | false | null
  }

  function reset() {
    _selectedId = null;
    clearTimeout(_debounceTimer);
    hideStrip();
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  // Attach on DOMContentLoaded. #invName is a static element — always in DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  // Also attach when the add form becomes visible (belt-and-suspenders for
  // any re-render that might replace the input element).
  document.addEventListener('click', function (e) {
    const addBtn = e.target && (
      e.target.id === 'addItemBtn' ||
      e.target.closest && e.target.closest('#addItemBtn')
    );
    if (addBtn) {
      // Small delay so inventory.js showAddForm() finishes first
      setTimeout(attach, 100);
    }
  });

  // ── Export ──────────────────────────────────────────────────────────────────
  window.__QS_CANONICAL = Object.freeze({
    getSelectedId,
    registerListing,
    reset
  });

})();
