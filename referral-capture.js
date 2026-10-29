/* QuickShop referral click persistence.
 * Captures only syntactically valid legacy UUIDs or 16-hex short codes.
 * A valid newer click replaces the pending click; invalid parameters do not.
 */
(function () {
  'use strict';
  try {
    var params = new URLSearchParams(window.location.search);
    var candidate = params.get('ref') || '';
    var route = window.location.pathname.match(/^\/r\/([0-9a-f]{16})\/?$/i);
    if (route) candidate = route[1];
    var validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
    var validCode = /^[0-9a-f]{16}$/i.test(candidate);
    if (!validUuid && !validCode) return;
    localStorage.setItem('qs_pending_referral', candidate);
    try { sessionStorage.setItem('qs_referrer_id', candidate); } catch (_) {}
  } catch (_) {}
})();
