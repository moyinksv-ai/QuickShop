/* share-catalog.js
 * SECURITY HARDENING:
 *   - prompt() replaced with a custom in-app modal — no native browser dialogs
 *   - Phone number validated as digits-only (7-15 chars) before storage or use
 *   - Stored phone re-validated on every retrieval — rejects previously saved bad values
 *   - btn.innerHTML pattern eliminated: button state changes use textContent only
 *   - window.renderShareButton remains the only public export
 */

(function () {
  'use strict';

  var SHARE_FUNCTION_URL = 'https://wicpvvypqpaljuexmczi.supabase.co/functions/v1/share-products';
  var BUTTON_ID          = 'shareCatalogBtn';
  var PHONE_STORAGE_KEY  = 'qs_seller_phone';

  // ── helpers ────────────────────────────────────────────────────────────────

  function getCurrentUserId() {
    if (window.currentUser && window.currentUser.id) return window.currentUser.id;
    var sb = window.__QS_SUPABASE;
    if (sb && sb.user && sb.user.id) return sb.user.id;
    return null;
  }

  /** Returns true only for strings of 7-15 digits (international phone numbers). */
  function isValidPhone(phone) {
    return typeof phone === 'string' && /^\d{7,15}$/.test(phone);
  }

  /**
   * Shows a custom modal asking for the WhatsApp number.
   * Resolves with a validated digit-only string, or null if the user cancels.
   * Never uses the browser-native prompt() API.
   */
  function requestPhoneViaModal() {
    return new Promise(function(resolve) {
      // Remove any stale modal
      var stale = document.getElementById('qs-phone-modal');
      if (stale) stale.remove();

      // Backdrop
      var backdrop = document.createElement('div');
      backdrop.id = 'qs-phone-modal';
      backdrop.style.cssText = [
        'position:fixed;inset:0;',
        'background:rgba(0,0,0,0.72);',
        'backdrop-filter:blur(8px);',
        '-webkit-backdrop-filter:blur(8px);',
        'z-index:999999;',
        'display:flex;align-items:center;justify-content:center;',
        'padding:20px;'
      ].join('');

      // Modal box
      var box = document.createElement('div');
      box.style.cssText = [
        'background:#18181b;',
        'border:1px solid rgba(255,255,255,0.1);',
        'border-radius:16px;',
        'padding:24px;',
        'width:100%;max-width:360px;',
        'box-shadow:0 24px 60px rgba(0,0,0,0.6);'
      ].join('');

      var title = document.createElement('h3');
      title.style.cssText = 'color:#fff;font-size:17px;font-weight:700;margin:0 0 8px;';
      title.textContent = 'Your WhatsApp Number';

      var sub = document.createElement('p');
      sub.style.cssText = 'color:rgba(255,255,255,0.55);font-size:13px;margin:0 0 16px;line-height:1.5;';
      sub.textContent = 'Customers will tap a WhatsApp button to order from you. Enter your number with country code (e.g. 2348012345678).';

      var input = document.createElement('input');
      input.type = 'tel';
      input.placeholder = '2348012345678';
      input.maxLength = 15;
      input.style.cssText = [
        'width:100%;padding:12px 14px;',
        'background:rgba(255,255,255,0.06);',
        'border:1px solid rgba(255,255,255,0.15);',
        'border-radius:10px;color:#fff;',
        'font-size:15px;outline:none;',
        'box-sizing:border-box;margin-bottom:8px;'
      ].join('');

      var errMsg = document.createElement('div');
      errMsg.style.cssText = 'color:#f87171;font-size:12px;min-height:18px;margin-bottom:10px;';
      errMsg.textContent = '';

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = [
        'flex:1;padding:12px;',
        'background:transparent;',
        'border:1px solid rgba(255,255,255,0.18);',
        'border-radius:10px;color:rgba(255,255,255,0.7);',
        'font-size:14px;font-weight:600;cursor:pointer;'
      ].join('');

      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.textContent = 'Save & Share';
      confirmBtn.style.cssText = [
        'flex:1;padding:12px;',
        'background:#22c55e;border:0;',
        'border-radius:10px;color:#fff;',
        'font-size:14px;font-weight:700;cursor:pointer;'
      ].join('');

      function doConfirm() {
        var raw    = input.value.replace(/\D/g, ''); // strip non-digits
        if (!isValidPhone(raw)) {
          errMsg.textContent = 'Please enter a valid number (7-15 digits, no spaces).';
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

      confirmBtn.addEventListener('click', doConfirm);
      cancelBtn.addEventListener('click', doCancel);
      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) doCancel();
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doConfirm();
        if (e.key === 'Escape') doCancel();
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      box.appendChild(title);
      box.appendChild(sub);
      box.appendChild(input);
      box.appendChild(errMsg);
      box.appendChild(btnRow);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      // Autofocus after paint
      requestAnimationFrame(function() { input.focus(); });
    });
  }

  /**
   * Returns a validated phone number string (digits only), or null.
   * Checks localStorage first; if absent or invalid, shows the custom modal.
   */
  async function getSellerPhone() {
    var stored = null;
    try {
      var raw = localStorage.getItem(PHONE_STORAGE_KEY);
      if (raw && isValidPhone(raw.replace(/\D/g, ''))) {
        stored = raw.replace(/\D/g, '');
      }
    } catch (_) {}

    if (stored) return stored;

    // Nothing valid stored — ask via custom modal
    var phone = await requestPhoneViaModal();
    if (phone) {
      try { localStorage.setItem(PHONE_STORAGE_KEY, phone); } catch (_) {}
    }
    return phone; // null if user cancelled
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

  function openShare(message) {
    if (navigator.share) {
      navigator.share({ text: message }).catch(function(err) {
        window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
      });
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(message), '_blank');
    }
  }

  // ── main action ────────────────────────────────────────────────────────────

  async function handleShareClick(e) {
    if (e) e.preventDefault();

    var userId = getCurrentUserId();
    if (!userId) {
      alert('Please log in first to share your catalog.');
      return;
    }

    var phone = await getSellerPhone();
    if (!phone) return; // user cancelled modal

    var btn           = document.getElementById(BUTTON_ID);
    var originalText  = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = '⏳ Generating link…';
      btn.disabled    = true;
    }

    try {
      var token = await getAccessToken();
      if (!token) throw new Error('No auth token. Please log in again.');

      var response = await fetch(SHARE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ store_id: userId, phone: phone })
      });

      if (!response.ok) {
        var errText = await response.text().catch(function() { return ''; });
        throw new Error('Server returned ' + response.status + ': ' + errText.slice(0, 200));
      }

      var data = await response.json().catch(function() { return {}; });

      // Validate server response — only use share_url if it looks like a real URL
      var appOrigin   = window.location.origin;
      var fallbackUrl = appOrigin + '/?view=catalog&store=' + encodeURIComponent(userId)
        + '&phone=' + encodeURIComponent(phone);

      var candidateUrl = (data && typeof data.share_url === 'string') ? data.share_url
                       : (data && typeof data.url       === 'string') ? data.url
                       : (data && typeof data.link      === 'string') ? data.link
                       : null;

      // Only accept URLs that start with http(s) to block javascript: and data: schemes
      var shareUrl = (candidateUrl && /^https?:\/\//i.test(candidateUrl))
        ? candidateUrl
        : fallbackUrl;

      if (shareUrl && phone && !shareUrl.includes('phone=')) {
        shareUrl += (shareUrl.includes('?') ? '&' : '?') + 'phone=' + encodeURIComponent(phone);
      }

      var message = '\uD83D\uDED2 Check out my product catalog:\n' + shareUrl;
      openShare(message);

    } catch (err) {
      console.error('[ShareCatalog] handleShareClick error', err);
      alert('Failed to generate share link: ' + (err.message || 'Unknown error').slice(0, 200));
    } finally {
      if (btn) {
        btn.textContent = originalText; // restore via textContent — never innerHTML
        btn.disabled    = false;
      }
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  window.renderShareButton = function renderShareButton(container) {
    if (!container) return;

    // Remove any stale share wrapper
    var stale = document.getElementById(BUTTON_ID);
    if (stale) {
      var wrapper = stale.closest('[data-share-wrapper]');
      if (wrapper) wrapper.remove();
    }

    // Build the button via DOM methods — never innerHTML with dynamic content
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-share-wrapper', '1');
    wrapper.style.cssText = 'margin-bottom:12px;';

    var btn = document.createElement('button');
    btn.id   = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'save-btn';
    btn.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:center;gap:8px;';

    // SVG share icon — static markup, no user data involved
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg   = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill',    'none');
    svg.setAttribute('width',   '18');
    svg.setAttribute('height',  '18');
    svg.setAttribute('stroke',  'currentColor');
    svg.setAttribute('stroke-width',   '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin','round');
    var pathEl = document.createElementNS(svgNS, 'path');
    pathEl.setAttribute('d', 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8');
    var poly   = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', '16 6 12 2 8 6');
    var line   = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '2');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '15');
    svg.appendChild(pathEl); svg.appendChild(poly); svg.appendChild(line);

    var label = document.createTextNode('Share Catalog to WhatsApp');

    btn.appendChild(svg);
    btn.appendChild(label);
    wrapper.appendChild(btn);

    // Insert before the Store Data card in the settings panel
    var demoBtn        = container.querySelector('#btnLoadDemo');
    var storeDataCard  = demoBtn ? demoBtn.parentElement : null;
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
