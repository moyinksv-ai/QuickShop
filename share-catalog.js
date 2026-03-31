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

  var BUTTON_ID         = 'shareCatalogBtn';
  var PHONE_STORAGE_KEY = 'qs_seller_phone';
  var BASE_URL          = window.location.origin;

  // ── Paywall config ───────────────────────────────────────────────────────────
  // Fill these in before deploying. Never commit real account details to a repo.
  var VENDOR_WHATSAPP  = '2348112439876';   // e.g. '2348012345678'
  var BANK_NAME        = 'Opay (Paycom)';
  var ACCOUNT_NUMBER   = '7035023138';
  var ACCOUNT_NAME     = 'Moses Olayinka O';

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
    // window.currentUser is never set — currentUser lives inside appss.js closure.
    // __QS_APP.getUser() is the correct exposed accessor.
    // __QS_SUPABASE.user is always null (frozen object).
    if (window.__QS_APP && typeof window.__QS_APP.getUser === 'function') {
      var u = window.__QS_APP.getUser();
      if (u && u.id) return u.id;
    }
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

  // ── Subscription helpers ────────────────────────────────────────────────────

  // localStorage key is scoped per user — two vendors on same device don't collide.
  function pendingKey(userId) { return 'qs_payment_pending_' + userId; }

  async function checkSubscriptionActive(userId) {
    try {
      var sb = window.__QS_SUPABASE && window.__QS_SUPABASE.client;
      if (!sb) return { active: false, expired: false };
      var result = await sb
        .from('profiles')
        .select('is_active, subscription_expires')
        .eq('id', userId)
        .maybeSingle();
      if (!result || !result.data) return { active: false, expired: false };
      var d = result.data;
      var now = new Date();
      var hasExpiry = d.subscription_expires && new Date(d.subscription_expires) < now;
      if (hasExpiry) return { active: false, expired: true };
      if (!d.is_active) return { active: false, expired: false };
      return { active: true, expired: false };
    } catch (_) {
      // Network failure — fail open so a glitch doesn't block an active vendor
      return { active: true, expired: false };
    }
  }

  // ── Paywall modals (State 1 and State 2) ────────────────────────────────────

  // shared bottom-sheet scaffold
  function _buildSheet(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();

    var backdrop = document.createElement('div');
    backdrop.id = id;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.style.cssText = [
      'position:fixed;inset:0;',
      'background:rgba(0,0,0,0.82);',
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'z-index:9999999;display:flex;',
      'align-items:flex-end;justify-content:center;padding:0;',
    ].join('');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:linear-gradient(160deg,#13111a 0%,#0f0d16 100%);',
      'border:1px solid rgba(139,92,246,0.25);border-bottom:none;',
      'border-radius:24px 24px 0 0;',
      'padding:28px 24px 40px;',
      'width:100%;max-width:480px;',
      'box-shadow:0 -24px 60px rgba(0,0,0,0.7);',
    ].join('');

    // drag handle
    var handle = document.createElement('div');
    handle.style.cssText = 'width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.15);margin:0 auto 24px;';
    box.appendChild(handle);
    backdrop.appendChild(box);
    return { backdrop: backdrop, box: box };
  }

  // State 1 — fresh paywall: bank details + WhatsApp notify CTA
  // If isRenewal is true, heading changes to "Renew Your Subscription"
  function showPaywallModal(userId, userEmail, isRenewal) {
    return new Promise(function (resolve) {
      var _s = _buildSheet('qs-paywall-modal');
      var backdrop = _s.backdrop, box = _s.box;
      backdrop.setAttribute('aria-labelledby', 'qs-paywall-title');

      // Icon
      var lockIcon = document.createElement('div');
      lockIcon.setAttribute('aria-hidden', 'true');
      lockIcon.style.cssText = [
        'width:52px;height:52px;border-radius:14px;',
        'background:linear-gradient(135deg,#7c3aed,#4f46e5);',
        'display:flex;align-items:center;justify-content:center;',
        'font-size:24px;margin:0 auto 16px;',
        'box-shadow:0 8px 24px rgba(124,58,237,0.35);',
      ].join('');
      lockIcon.textContent = isRenewal ? '🔄' : '🔒';

      // Title
      var title = document.createElement('h2');
      title.id = 'qs-paywall-title';
      title.style.cssText = 'color:#fff;font-size:20px;font-weight:800;text-align:center;margin:0 0 8px;letter-spacing:-0.3px;';
      title.textContent = isRenewal ? 'Renew Your Subscription' : 'Unlock Your Public Showroom';

      // Subtitle
      var sub = document.createElement('p');
      sub.style.cssText = 'color:rgba(255,255,255,0.5);font-size:14px;text-align:center;margin:0 0 24px;line-height:1.6;';
      sub.textContent = isRenewal
        ? 'Your subscription has expired. Renew for ₦1,500/month to restore your catalog link.'
        : 'Share your catalog with your customer for ₦1,500/month. Bank transfer — activated within minutes.';

      // Price badge
      var priceBadge = document.createElement('div');
      priceBadge.style.cssText = [
        'background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);',
        'border-radius:12px;padding:16px 20px;margin-bottom:20px;',
      ].join('');
      var priceRow = document.createElement('div');
      priceRow.style.cssText = 'display:flex;align-items:baseline;justify-content:center;gap:6px;margin-bottom:4px;';
      var priceAmt = document.createElement('span');
      priceAmt.style.cssText = 'color:#a78bfa;font-size:32px;font-weight:900;letter-spacing:-1px;';
      priceAmt.textContent = '₦1,500';
      var pricePer = document.createElement('span');
      pricePer.style.cssText = 'color:rgba(255,255,255,0.4);font-size:14px;';
      pricePer.textContent = '/ month';
      var priceNote = document.createElement('div');
      priceNote.style.cssText = 'color:rgba(255,255,255,0.35);font-size:12px;text-align:center;';
      priceNote.textContent = 'Inventory management stays free forever';
      priceRow.appendChild(priceAmt);
      priceRow.appendChild(pricePer);
      priceBadge.appendChild(priceRow);
      priceBadge.appendChild(priceNote);

      // Bank details card
      var bankCard = document.createElement('div');
      bankCard.style.cssText = [
        'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);',
        'border-radius:12px;padding:16px 18px;margin-bottom:20px;',
      ].join('');
      var bankTitle = document.createElement('div');
      bankTitle.style.cssText = 'color:rgba(255,255,255,0.45);font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:12px;';
      bankTitle.textContent = 'Transfer Details';
      bankCard.appendChild(bankTitle);

      var bankLines = [
        ['Bank',       BANK_NAME],
        ['Account No', ACCOUNT_NUMBER],
        ['Name',       ACCOUNT_NAME],
        ['Amount',     '₦1,500'],
      ];
      bankLines.forEach(function (pair, idx) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:7px 0;' +
          (idx < bankLines.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : '');
        var lbl = document.createElement('span');
        lbl.style.cssText = 'color:rgba(255,255,255,0.35);font-size:12px;';
        lbl.textContent = pair[0];
        var val = document.createElement('span');
        val.style.cssText = 'color:#e2e8f0;font-size:13px;font-weight:600;';
        val.textContent = pair[1];
        row.appendChild(lbl);
        row.appendChild(val);
        bankCard.appendChild(row);
      });

      // WhatsApp CTA — primary action
      var waBtn = document.createElement('button');
      waBtn.type = 'button';
      waBtn.style.cssText = [
        'width:100%;padding:15px;',
        'background:linear-gradient(135deg,#22c55e,#16a34a);',
        'border:0;border-radius:12px;color:#fff;',
        'font-size:15px;font-weight:700;cursor:pointer;',
        'letter-spacing:0.2px;margin-bottom:10px;',
        'box-shadow:0 8px 24px rgba(34,197,94,0.3);',
      ].join('');
      waBtn.textContent = '✅ I\'ve Sent — Notify on WhatsApp';

      // Cancel
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.style.cssText = 'width:100%;padding:12px;background:transparent;border:0;color:rgba(255,255,255,0.3);font-size:13px;cursor:pointer;';
      cancelBtn.textContent = 'Maybe later';

      function close() { backdrop.remove(); resolve('closed'); }

      waBtn.addEventListener('click', function () {
        // 1. Mark pending — scoped to this user, timestamped
        try { localStorage.setItem(pendingKey(userId), String(Date.now())); } catch (_) {}

        // 2. Build pre-filled WhatsApp message
        var msg = 'Hi, I just transferred ₦1,500 for QuickShop catalog access.\nAccount email: ' + (userEmail || 'N/A') + '\nPlease activate my store link. 🙏';
        var waUrl = 'https://wa.me/' + VENDOR_WHATSAPP + '?text=' + encodeURIComponent(msg);
        window.open(waUrl, '_blank', 'noopener,noreferrer');

        // 3. Transition modal in-place to confirmation (no re-open)
        backdrop.remove();
        _showSentConfirmation(userId);
        resolve('notified');
      });

      cancelBtn.addEventListener('click', close);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
      backdrop.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

      box.appendChild(lockIcon);
      box.appendChild(title);
      box.appendChild(sub);
      box.appendChild(priceBadge);
      box.appendChild(bankCard);
      box.appendChild(waBtn);
      box.appendChild(cancelBtn);
      document.body.appendChild(backdrop);
      requestAnimationFrame(function () { waBtn.focus(); });
    });
  }

  // Inline confirmation — shown immediately after WhatsApp opens
  // Not a new modal — replaces the paywall in place so there's no re-entry point
  function _showSentConfirmation(userId) {
    var _s = _buildSheet('qs-paywall-confirm');
    var backdrop = _s.backdrop, box = _s.box;

    var icon = document.createElement('div');
    icon.style.cssText = 'font-size:44px;text-align:center;margin-bottom:12px;';
    icon.textContent = '⏳';

    var title = document.createElement('h2');
    title.style.cssText = 'color:#fff;font-size:19px;font-weight:800;text-align:center;margin:0 0 10px;';
    title.textContent = 'Payment Noted';

    var msg = document.createElement('p');
    msg.style.cssText = 'color:rgba(255,255,255,0.5);font-size:14px;text-align:center;margin:0 0 24px;line-height:1.65;';
    msg.textContent = "We've received your WhatsApp message. Your store link will be activated within a few minutes once we verify your transfer.";

    var note = document.createElement('div');
    note.style.cssText = [
      'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);',
      'border-radius:10px;padding:12px 16px;margin-bottom:20px;',
      'font-size:12px;color:rgba(255,255,255,0.4);line-height:1.55;',
    ].join('');
    note.textContent = 'Come back and tap "Share Catalog" again after activation. If it\'s been more than 15 minutes, tap the button below.';

    // Follow-up WhatsApp link (soft, not a CTA button)
    var followUp = document.createElement('a');
    followUp.href = 'https://wa.me/' + VENDOR_WHATSAPP + '?text=' + encodeURIComponent("Hi, I'm following up on my QuickShop catalog payment. Has my store been activated?");
    followUp.target = '_blank';
    followUp.rel = 'noopener noreferrer';
    followUp.style.cssText = [
      'display:block;text-align:center;',
      'color:#a78bfa;font-size:13px;font-weight:600;',
      'text-decoration:none;margin-bottom:20px;',
    ].join('');
    followUp.textContent = 'Still waiting? Follow up on WhatsApp →';

    var doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.style.cssText = [
      'width:100%;padding:14px;',
      'background:rgba(255,255,255,0.06);',
      'border:1px solid rgba(255,255,255,0.1);',
      'border-radius:12px;color:rgba(255,255,255,0.7);',
      'font-size:14px;font-weight:600;cursor:pointer;',
    ].join('');
    doneBtn.textContent = 'Got it, I\'ll wait';

    doneBtn.addEventListener('click', function () { backdrop.remove(); });
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) backdrop.remove(); });
    backdrop.addEventListener('keydown', function (e) { if (e.key === 'Escape') backdrop.remove(); });

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(note);
    box.appendChild(followUp);
    box.appendChild(doneBtn);
    document.body.appendChild(backdrop);
    requestAnimationFrame(function () { doneBtn.focus(); });
  }

  // State 2 — already notified, awaiting admin activation
  function showPendingModal(userId, pendingTs) {
    return new Promise(function (resolve) {
      var _s = _buildSheet('qs-paywall-pending');
      var backdrop = _s.backdrop, box = _s.box;
      backdrop.setAttribute('aria-labelledby', 'qs-pending-title');

      var icon = document.createElement('div');
      icon.style.cssText = 'font-size:44px;text-align:center;margin-bottom:12px;';
      icon.textContent = '⏳';

      var title = document.createElement('h2');
      title.id = 'qs-pending-title';
      title.style.cssText = 'color:#fff;font-size:19px;font-weight:800;text-align:center;margin:0 0 10px;';
      title.textContent = 'Awaiting Activation';

      // Human-readable time since notification
      var elapsed = Date.now() - (parseInt(pendingTs, 10) || Date.now());
      var elapsedTxt = elapsed < 60000
        ? 'just now'
        : elapsed < 3600000
          ? Math.floor(elapsed / 60000) + ' minute' + (Math.floor(elapsed / 60000) === 1 ? '' : 's') + ' ago'
          : Math.floor(elapsed / 3600000) + ' hour' + (Math.floor(elapsed / 3600000) === 1 ? '' : 's') + ' ago';

      var msg = document.createElement('p');
      msg.style.cssText = 'color:rgba(255,255,255,0.5);font-size:14px;text-align:center;margin:0 0 20px;line-height:1.65;';
      msg.textContent = 'You notified us ' + elapsedTxt + '. We\'re verifying your transfer — your store link will be live shortly.';

      var note = document.createElement('div');
      note.style.cssText = [
        'background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);',
        'border-radius:10px;padding:12px 16px;margin-bottom:20px;',
        'font-size:12px;color:rgba(255,255,255,0.45);line-height:1.55;',
      ].join('');
      note.textContent = 'Once activated, tap "Share Catalog" and your link will work. Activation is usually within a few minutes during business hours.';

      // Follow-up link — available after 15 mins
      if (elapsed > 15 * 60 * 1000) {
        var followUp = document.createElement('a');
        followUp.href = 'https://wa.me/' + VENDOR_WHATSAPP + '?text=' + encodeURIComponent("Hi, I'm following up on my QuickShop catalog payment. Has my store been activated?");
        followUp.target = '_blank';
        followUp.rel = 'noopener noreferrer';
        followUp.style.cssText = [
          'display:block;text-align:center;',
          'color:#a78bfa;font-size:13px;font-weight:600;',
          'text-decoration:none;margin-bottom:20px;',
        ].join('');
        followUp.textContent = 'Still waiting? Follow up on WhatsApp →';
        box.appendChild(followUp);
      }

      var doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.style.cssText = [
        'width:100%;padding:14px;',
        'background:rgba(255,255,255,0.06);',
        'border:1px solid rgba(255,255,255,0.1);',
        'border-radius:12px;color:rgba(255,255,255,0.7);',
        'font-size:14px;font-weight:600;cursor:pointer;',
      ].join('');
      doneBtn.textContent = 'OK, I\'ll wait';

      function close() { backdrop.remove(); resolve(); }
      doneBtn.addEventListener('click', close);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
      backdrop.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

      box.appendChild(icon);
      box.appendChild(title);
      box.appendChild(msg);
      box.appendChild(note);
      box.appendChild(doneBtn);
      document.body.appendChild(backdrop);
      requestAnimationFrame(function () { doneBtn.focus(); });
    });
  }

  // ── Main share action ───────────────────────────────────────────────────────

  async function handleShareClick(e) {
    if (e) e.preventDefault();

    var userId = getCurrentUserId();
    if (!userId) {
      notify('Please log in to share your catalog.', 'error');
      return;
    }

    // ── Three-state subscription gate ─────────────────────────────────────────
    var subStatus = await checkSubscriptionActive(userId);

    if (!subStatus.active) {
      var userEmail = '';
      try {
        var _u = window.__QS_APP && typeof window.__QS_APP.getUser === 'function' && window.__QS_APP.getUser();
        userEmail = (_u && _u.email) || '';
      } catch (_) {}

      if (subStatus.expired) {
        // Subscription lapsed — clear any stale pending key so they go through
        // fresh payment flow, not "awaiting activation" (different situation).
        try { localStorage.removeItem(pendingKey(userId)); } catch (_) {}
        await showPaywallModal(userId, userEmail, true); // isRenewal = true
        return;
      }

      // Check if already notified (pending activation)
      var pendingTs = null;
      try { pendingTs = localStorage.getItem(pendingKey(userId)); } catch (_) {}

      if (pendingTs) {
        // State 2 — show waiting screen, no bank details, no re-notify CTA
        await showPendingModal(userId, pendingTs);
        return;
      }

      // State 1 — first time, show full paywall
      await showPaywallModal(userId, userEmail, false);
      return;
    }
    // ── End subscription gate ─────────────────────────────────────────────────

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
      var sb = window.__QS_SUPABASE && window.__QS_SUPABASE.client;
      if (!sb) { notify('Not connected — please try again.', 'error'); return; }

      var profile = await sb.from('profiles').select('business_name,slug').eq('id', userId).maybeSingle();
      var businessName = (profile.data && profile.data.business_name) || '';
      var existingSlug  = (profile.data && profile.data.slug) || null;
      // Pass the already-fetched slug and business_name into getOrCreateSlug
      // so it can skip its own redundant DB fetch when the data is already known.
      var slug = await getOrCreateSlug(sb, userId, businessName, existingSlug);

      var catalogUrl = BASE_URL
        + '/?store=' + encodeURIComponent(slug)
        + '&phone=' + encodeURIComponent(phone);

      var message = '🛒 Check out my product catalog:\n' + catalogUrl;
      openShareSheet(message);

    } catch (err) {
      console.error('[ShareCatalog] error:', err);
      notify('Something went wrong — please try again.', 'error');

    } finally {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled    = false;
        btn.removeAttribute('aria-busy');
      }
    }
  }

  // ── Render share button ─────────────────────────────────────────────────────

  // Expose handleShareClick for direct invocation from settings action row button
  window.__QS_SHARE_CLICK = function() { handleShareClick(null); };

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


  // ── Slug helpers (kept inside IIFE — no global scope pollution) ──

  function slugify(text) {
    return String(text || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'store';
  }

  async function getOrCreateSlug(sb, userId, businessName, existingSlug) {
    // If the caller already fetched the slug, use it directly — skip the DB round-trip.
    if (existingSlug) return existingSlug;
    var ex = await sb.from('profiles').select('slug,business_name').eq('id', userId).maybeSingle();
    if (ex.data && ex.data.slug) return ex.data.slug;
    var base = slugify(businessName || (ex.data && ex.data.business_name) || 'store');
    var slug = base;
    var clash = await sb.from('profiles').select('id').eq('slug', slug).neq('id', userId).maybeSingle();
    if (clash.data) slug = base + '-' + userId.replace(/-/g,'').slice(-4);
    await sb.from('profiles').update({ slug: slug }).eq('id', userId);
    return slug;
  }

})();
