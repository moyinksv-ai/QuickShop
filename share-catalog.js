/* share-catalog.js
 * SECURITY HARDENING (cumulative — all previous + new):
 *   - No store_id in POST body — server derives it exclusively from JWT
 *   - No phone sent to server — phone appended client-side to catalog URL only
 *   - No alert() / prompt() / confirm() — uses window.toast() or built-in non-blocking toast
 *   - Phone modal has role=dialog, aria-modal, aria-labelledby, and Tab focus trap
 *   - Server URL validated: accepts https?:// or root-relative / only; rejects javascript:, data:, etc.
 *   - Fetch has 10 s timeout via AbortController; button always re-enabled via finally
 *   - Handles { success, data: { share_url, business_name } } response envelope
 *   - All DOM mutations use textContent / createElement — no innerHTML with dynamic data
 *   - SVG icon is aria-hidden and focusable=false
 *   - navigator.share / wa.me opened with noopener,noreferrer
 */

(function () {
  'use strict';

  var SHARE_FUNCTION_URL = 'https://wicpvvypqpaljuexmczi.supabase.co/functions/v1/share-products';
  var BUTTON_ID          = 'shareCatalogBtn';
  var PHONE_STORAGE_KEY  = 'qs_seller_phone';
  var FETCH_TIMEOUT_MS   = 10000;

  // ── Non-blocking toast ──────────────────────────────────────────────────────

  function notify(msg, type) {
    if (typeof window.toast === 'function') {
      window.toast(msg, type === 'error' ? 'error' : 'success');
      return;
    }
    if (!document.getElementById('qs-toast-kf')) {
      var s = document.createElement('style');
      s.id = 'qs-toast-kf';
      s.textContent = '@keyframes qs-fadein{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
      document.head.appendChild(s);
    }
    var el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.style.cssText = [
      'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);',
      'padding:10px 18px;border-radius:10px;font-family:inherit;',
      'font-size:14px;font-weight:600;color:#fff;z-index:9999999;',
      'pointer-events:none;max-width:320px;text-align:center;',
      'box-shadow:0 4px 20px rgba(0,0,0,0.35);',
      'animation:qs-fadein 0.2s ease;',
      'background:' + (type === 'error' ? '#ef4444' : '#22c55e') + ';',
    ].join('');
    el.textContent = String(msg).slice(0, 200);
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 3500);
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  function isValidPhone(phone) {
    return typeof phone === 'string' && /^\d{7,15}$/.test(phone);
  }

  function validateServerUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 2000) return null;
    if (url.startsWith('/')) return window.location.origin + url;
    try {
      var parsed = new URL(url);
      if (!/^https?:$/i.test(parsed.protocol)) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  // ── Auth helpers ────────────────────────────────────────────────────────────

  function getCurrentUserId() {
    if (window.currentUser && window.currentUser.id) return window.currentUser.id;
    var sb = window.__QS_SUPABASE;
    if (sb && sb.user && sb.user.id) return sb.user.id;
    return null;
  }

  async function getAccessToken() {
    try {
      var sb = window.__QS_SUPABASE;
      if (!sb || !sb.client) return null;
      var result  = await sb.client.auth.getSession();
      var session = result && result.data && result.data.session;
      return session ? session.access_token : null;
    } catch (e) {
      console.error('[ShareCatalog] getAccessToken failed', e);
      return null;
    }
  }

  // ── Share sheet ─────────────────────────────────────────────────────────────

  function openShareSheet(message) {
    if (navigator.share) {
      navigator.share({ text: message }).catch(function () {
        window.open(
          'https://wa.me/?text=' + encodeURIComponent(message),
          '_blank',
          'noopener,noreferrer'
        );
      });
    } else {
      window.open(
        'https://wa.me/?text=' + encodeURIComponent(message),
        '_blank',
        'noopener,noreferrer'
      );
    }
  }

  // ── Phone modal (ARIA + focus trap) ────────────────────────────────────────

  function requestPhoneViaModal() {
    return new Promise(function (resolve) {
      var stale = document.getElementById('qs-phone-modal');
      if (stale) stale.remove();

      var backdrop = document.createElement('div');
      backdrop.id = 'qs-phone-modal';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', 'qs-phone-modal-title');
      backdrop.style.cssText = [
        'position:fixed;inset:0;',
        'background:rgba(0,0,0,0.72);',
        'backdrop-filter:blur(8px);',
        '-webkit-backdrop-filter:blur(8px);',
        'z-index:999999;',
        'display:flex;align-items:center;justify-content:center;',
        'padding:20px;',
      ].join('');

      var box = document.createElement('div');
      box.style.cssText = [
        'background:#18181b;',
        'border:1px solid rgba(255,255,255,0.1);',
        'border-radius:16px;padding:24px;',
        'width:100%;max-width:360px;',
        'box-shadow:0 24px 60px rgba(0,0,0,0.6);',
      ].join('');

      var title = document.createElement('h3');
      title.id = 'qs-phone-modal-title';
      title.style.cssText = 'color:#fff;font-size:17px;font-weight:700;margin:0 0 8px;';
      title.textContent = 'Your WhatsApp Number';

      var sub = document.createElement('p');
      sub.style.cssText = 'color:rgba(255,255,255,0.55);font-size:13px;margin:0 0 16px;line-height:1.5;';
      sub.textContent = 'Customers will tap a WhatsApp button to order from you. Enter your number with country code (e.g. 2348012345678).';

      var input = document.createElement('input');
      input.type = 'tel';
      input.placeholder = '2348012345678';
      input.maxLength = 15;
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('autocomplete', 'tel');
      input.setAttribute('aria-label', 'WhatsApp phone number');
      input.style.cssText = [
        'width:100%;padding:12px 14px;',
        'background:rgba(255,255,255,0.06);',
        'border:1px solid rgba(255,255,255,0.15);',
        'border-radius:10px;color:#fff;',
        'font-size:16px;outline:none;',
        'box-sizing:border-box;margin-bottom:8px;',
      ].join('');

      var errEl = document.createElement('div');
      errEl.setAttribute('role', 'alert');
      errEl.setAttribute('aria-live', 'polite');
      errEl.style.cssText = 'color:#f87171;font-size:12px;min-height:18px;margin-bottom:10px;';

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = [
        'flex:1;padding:12px;background:transparent;',
        'border:1px solid rgba(255,255,255,0.18);',
        'border-radius:10px;color:rgba(255,255,255,0.7);',
        'font-size:14px;font-weight:600;cursor:pointer;',
      ].join('');

      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.textContent = 'Save & Share';
      confirmBtn.style.cssText = [
        'flex:1;padding:12px;background:#22c55e;border:0;',
        'border-radius:10px;color:#fff;',
        'font-size:14px;font-weight:700;cursor:pointer;',
      ].join('');

      var focusable = [input, cancelBtn, confirmBtn];

      function doConfirm() {
        var raw = input.value.replace(/\D/g, '');
        if (!isValidPhone(raw)) {
          errEl.textContent = 'Please enter a valid number (7\u201315 digits, no spaces).';
          input.focus();
          return;
        }
        backdrop.remove();
        resolve(raw);
      }

      function doCancel() {
        backdrop.remove();
        resolve(null);
      }

      backdrop.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { doCancel(); return; }
        if (e.key !== 'Tab') return;
        var first = focusable[0];
        var last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
      });

      confirmBtn.addEventListener('click', doConfirm);
      cancelBtn.addEventListener('click',  doCancel);
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) doCancel();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doConfirm();
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      box.appendChild(title);
      box.appendChild(sub);
      box.appendChild(input);
      box.appendChild(errEl);
      box.appendChild(btnRow);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      requestAnimationFrame(function () { input.focus(); });
    });
  }

  async function getSellerPhone() {
    try {
      var raw = localStorage.getItem(PHONE_STORAGE_KEY);
      if (raw) {
        var digits = raw.replace(/\D/g, '');
        if (isValidPhone(digits)) return digits;
      }
    } catch (_) {}

    var phone = await requestPhoneViaModal();
    if (phone) {
      try { localStorage.setItem(PHONE_STORAGE_KEY, phone); } catch (_) {}
    }
    return phone;
  }

  // ── Main share action ───────────────────────────────────────────────────────

  async function handleShareClick(e) {
    if (e) e.preventDefault();

    var userId = getCurrentUserId();
    if (!userId) {
      notify('Please log in to share your catalog.', 'error');
      return;
    }

    var phone = await getSellerPhone();
    if (!phone) return;

    var btn          = document.getElementById(BUTTON_ID);
    var originalText = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = '\u23F3 Generating link\u2026';
      btn.disabled    = true;
      btn.setAttribute('aria-busy', 'true');
    }

    try {
      var token = await getAccessToken();
      if (!token) {
        notify('Session expired \u2014 please log in again.', 'error');
        return;
      }

      var controller = new AbortController();
      var timeoutId  = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

      var response;
      try {
        response = await fetch(SHARE_FUNCTION_URL, {
          method:  'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type':  'application/json',
          },
          body:   JSON.stringify({ client_hint: 'share_request' }),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') {
          notify('Request timed out \u2014 please try again.', 'error');
        } else {
          notify('Network error \u2014 check your connection.', 'error');
        }
        return;
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status === 429) {
        notify('Too many requests \u2014 please wait before generating another link.', 'error');
        return;
      }

      if (!response.ok) {
        var errBody = {};
        try { errBody = await response.json(); } catch (_) {}
        var errText = (errBody.error && errBody.error.message)
          ? String(errBody.error.message).slice(0, 200)
          : 'Server error ' + response.status;
        notify(errText, 'error');
        return;
      }

      var data = {};
      try { data = await response.json(); } catch (_) {}

      if (!data.success || !data.data || typeof data.data.share_url !== 'string') {
        notify('Unexpected response from server.', 'error');
        return;
      }

      var safeUrl = validateServerUrl(data.data.share_url);
      if (!safeUrl) {
        console.error('[ShareCatalog] rejected unsafe URL from server:', data.data.share_url);
        notify('Received an invalid link \u2014 please try again.', 'error');
        return;
      }

      var catalogUrl = safeUrl
        + (safeUrl.includes('?') ? '&' : '?')
        + 'phone=' + encodeURIComponent(phone);

      var message = '\uD83D\uDED2 Check out my product catalog:\n' + catalogUrl;
      openShareSheet(message);

    } finally {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled    = false;
        btn.removeAttribute('aria-busy');
      }
    }
  }

  // ── Render share button ─────────────────────────────────────────────────────

  window.renderShareButton = function renderShareButton(container) {
    if (!container) return;

    var stale = document.getElementById(BUTTON_ID);
    if (stale) {
      var w = stale.closest('[data-share-wrapper]');
      if (w) w.remove();
    }

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-share-wrapper', '1');
    wrapper.style.cssText = 'margin-bottom:12px;';

    var btn = document.createElement('button');
    btn.id        = BUTTON_ID;
    btn.type      = 'button';
    btn.className = 'save-btn';
    btn.setAttribute('aria-label', 'Share your product catalog to WhatsApp');
    btn.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:center;gap:8px;';

    var svgNS  = 'http://www.w3.org/2000/svg';
    var svg    = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox',         '0 0 24 24');
    svg.setAttribute('fill',            'none');
    svg.setAttribute('width',           '18');
    svg.setAttribute('height',          '18');
    svg.setAttribute('stroke',          'currentColor');
    svg.setAttribute('stroke-width',    '2.5');
    svg.setAttribute('stroke-linecap',  'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden',     'true');
    svg.setAttribute('focusable',       'false');

    var pathEl = document.createElementNS(svgNS, 'path');
    pathEl.setAttribute('d', 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8');
    var poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', '16 6 12 2 8 6');
    var line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '2');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '15');
    svg.appendChild(pathEl);
    svg.appendChild(poly);
    svg.appendChild(line);

    btn.appendChild(svg);
    btn.appendChild(document.createTextNode('Share Catalog to WhatsApp'));
    wrapper.appendChild(btn);

    var demoBtn       = container.querySelector('#btnLoadDemo');
    var storeDataCard = demoBtn ? demoBtn.parentElement : null;
    if (storeDataCard) {
      while (storeDataCard && storeDataCard.parentElement !== container) {
        storeDataCard = storeDataCard.parentElement;
      }
    }
    if (storeDataCard) {
      container.insertBefore(wrapper, storeDataCard);
    } else {
      container.appendChild(wrapper);
    }

    btn.addEventListener('click', handleShareClick);
  };

})();
