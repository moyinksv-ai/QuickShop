/* share-catalog.js
 * Fixed: 401 auth error, fragile MutationObserver injection replaced
 * with explicit renderShareButton() called by renderSettingsPanel().
 * Share flow: fetch edge function with Bearer token → get public URL → share that.
 */

(function () {
  'use strict';

  var SHARE_FUNCTION_URL = 'https://wicpvvypqpaljuexmczi.supabase.co/functions/v1/share-products';
  var BUTTON_ID = 'shareCatalogBtn';

  // ── helpers ────────────────────────────────────────────────────────────────

  function getCurrentUserId() {
    if (window.currentUser && window.currentUser.id) return window.currentUser.id;
    var sb = window.__QS_SUPABASE;
    if (sb && sb.user && sb.user.id) return sb.user.id;
    return null;
  }

  function getSellerPhone() {
    var phone = localStorage.getItem('qs_seller_phone');
    if (!phone) {
      phone = prompt('Enter your WhatsApp number (e.g. 2348012345678)');
      if (phone) localStorage.setItem('qs_seller_phone', phone.trim());
    }
    return phone ? phone.trim() : null;
  }

  async function getAccessToken() {
    try {
      var sb = window.__QS_SUPABASE;
      if (!sb || !sb.client) return null;
      var result = await sb.client.auth.getSession();
      var session = result && result.data && result.data.session;
      return session ? session.access_token : null;
    } catch (e) {
      console.error('[ShareCatalog] getAccessToken failed', e);
      return null;
    }
  }

  function openShare(message) {
    if (navigator.share) {
      navigator.share({ text: message }).catch(function (err) {
        console.log('[ShareCatalog] Web Share API failed, falling back to WhatsApp URL', err);
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
      alert('Please login first to share your catalog.');
      return;
    }

    var phone = getSellerPhone();
    if (!phone) return;

    var btn = document.getElementById(BUTTON_ID);
    var originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '⏳ Generating link...';
      btn.disabled = true;
    }

    try {
      // FIX: Fetch the edge function server-side with Authorization header.
      // Never send the raw edge function URL to WhatsApp — that causes 401.
      var token = await getAccessToken();
      if (!token) throw new Error('No auth token. Please log in again.');

      // FIX: Edge function expects POST with a JSON body, not GET with query params.
      // Sending GET caused 405 "Method not allowed" (see screenshot 2026-03-03).
      var response = await fetch(SHARE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ store_id: userId, phone: phone })
      });

      if (!response.ok) {
        var errText = await response.text().catch(function () { return ''; });
        throw new Error('Server returned ' + response.status + ': ' + errText);
      }

      var data = await response.json().catch(async function () {
        // Edge function might return a plain URL or HTML — handle gracefully
        return { share_url: fetchUrl };
      });

      // The edge function returns { share_url, business_name }
      // Fall back to a locally-constructed catalog URL if the shape differs
      var appOrigin = window.location.origin;
      var fallbackUrl = appOrigin + '/?view=catalog&store=' + encodeURIComponent(userId)
        + '&phone=' + encodeURIComponent(phone);
      var shareUrl = (data && (data.share_url || data.url || data.link)) || fallbackUrl;
      // Always inject phone into share_url so the catalog page can open WhatsApp directly
      if (shareUrl && phone && !shareUrl.includes('phone=')) {
        shareUrl += (shareUrl.includes('?') ? '&' : '?') + 'phone=' + encodeURIComponent(phone);
      }

      var message = '\uD83D\uDED2 Check out my product catalog:\n' + shareUrl;
      openShare(message);

    } catch (err) {
      console.error('[ShareCatalog] handleShareClick error', err);
      alert('Failed to generate share link: ' + (err.message || 'Unknown error'));
    } finally {
      if (btn) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /**
   * renderShareButton(container)
   * Called explicitly by renderSettingsPanel() in appss.js after it
   * rebuilds the settings DOM. No MutationObserver, no insertBefore guesswork.
   *
   * @param {HTMLElement} container  The settings panel element.
   */
  window.renderShareButton = function renderShareButton(container) {
    if (!container) return;

    // Remove any stale instance (e.g. from a previous panel render)
    var stale = document.getElementById(BUTTON_ID);
    if (stale) stale.closest('div[data-share-wrapper]') && stale.closest('div[data-share-wrapper]').remove();

    // Find the "Store Data" card — it contains #btnLoadDemo
    var demoBtn = container.querySelector('#btnLoadDemo');
    if (!demoBtn) return;

    // Walk up to the card wrapper (direct child of settingsPanel)
    var storeDataCard = demoBtn.closest('[data-section="store-data"]') || demoBtn.parentElement;
    while (storeDataCard && storeDataCard.parentElement !== container) {
      storeDataCard = storeDataCard.parentElement;
    }
    if (!storeDataCard) return;

    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-share-wrapper', '1');
    wrapper.style.cssText = 'margin-bottom:12px;';
    wrapper.innerHTML =
      '<button id="' + BUTTON_ID + '" class="save-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;">' +
        '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>' +
          '<polyline points="16 6 12 2 8 6"/>' +
          '<line x1="12" y1="2" x2="12" y2="15"/>' +
        '</svg>' +
        'Share Catalog to WhatsApp' +
      '</button>';

    // Insert the share button card BEFORE the Store Data card
    container.insertBefore(wrapper, storeDataCard);

    document.getElementById(BUTTON_ID).addEventListener('click', handleShareClick);
  };

})();
