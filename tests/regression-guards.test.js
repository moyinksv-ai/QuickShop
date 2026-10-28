'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'appss.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminApiSource = fs.readFileSync(path.join(root, 'api/admin.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const qsInitSource = fs.readFileSync(path.join(root, 'qs-init.js'), 'utf8');

function countMatches(source, regex) {
  return Array.from(source.matchAll(regex)).length;
}

test('vendor sign-out supports the Settings button being rendered after startup', () => {
  assert.match(
    appSource,
    /document\.addEventListener\('click', async function \(event\) \{[\s\S]*?target\.closest\('#btnLogout'\)/,
    'Sign Out must use delegated click handling for its dynamically rendered button'
  );
  assert.doesNotMatch(
    appSource,
    /const btnLogout = \$\('btnLogout'\);\s*if \(btnLogout\)\s*\{\s*btnLogout\.addEventListener/,
    'Do not bind the vendor Sign Out handler only during startup before Settings exists'
  );
  assert.match(appSource, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(appSource, /\['qs_session_active', 'qs_last_user_id', 'qs_user_cache'\]/);
  assert.match(appSource, /window\.location\.replace\(window\.location\.pathname\)/);
  assert.doesNotMatch(appSource, /btnBackToLanding\.addEventListener\('click'/, 'Home navigation must not have a competing appss.js handler');
  assert.match(qsInitSource, /window\.__qs_showLanding\(\)/, 'the canonical delegated handler must call the shared landing transition');
});

test('landing and auth visibility are mutually exclusive, with one canonical Home transition', () => {
  assert.match(indexHtml, /body:not\(\.qs-show-auth\) #btnBackToLanding \{ display: none !important; \}/);
  assert.match(indexHtml, /body\.qs-show-auth #loginScreen #btnBackToLanding/);
  assert.match(
    indexHtml,
    /body:not\(\.qs-show-auth\):not\(\.mode-app\):not\(\.qs-cat-early\):not\(\.qs-auth-pending\) #qs-landing:not\(\.qs-hidden\) \{ display: block !important; \}/,
    'landing must never be force-shown while auth is active'
  );
  assert.doesNotMatch(
    indexHtml,
    /@media\s*\(max-width:\s*370px\)[\s\S]{0,180}\.ql-nav-browse\s*\{\s*display:\s*none/,
    'the top Marketplace link must remain available on narrow mobile screens'
  );
  assert.doesNotMatch(appSource, /btnBackToLanding\.addEventListener\('click'/, 'avoid competing Home click handlers');
  assert.match(qsInitSource, /body\.classList\.remove\('qs-show-auth', 'qs-auth-pending', 'mode-app', 'qs-cat-early'\)/);
  assert.match(qsInitSource, /landing\.classList\.remove\('qs-hidden', 'qs-navigating'\)/);
  assert.match(qsInitSource, /target\.closest\('#btnBackToLanding'\)/, 'delegation should support nested button content');
  assert.match(qsInitSource, /window\.matchMedia && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(appSource, /handleAuthLogout\(\{ initialLoad: true \}\)/, 'an unauthenticated cold visit must not be treated as an explicit sign-out');
  assert.match(appSource, /if \(options\.initialLoad && !_explicitSignOut && !_pendingVerificationEmail && !_savedResetEmail &&\s+typeof window\.__qs_showLanding === 'function'\)\s*\{\s*window\.__qs_showLanding\(\);/,
    'cold visits should return to landing unless an interrupted verification/reset flow must resume');
});

test('signup sends at most one request and does not fake OTP success for existing accounts', () => {
  assert.match(appSource, /let signupInFlight = false;/);
  assert.match(appSource, /if \(signupInFlight\) return;/);
  const signupStart = appSource.indexOf("const signupForm = $('signupForm');");
  const signupEnd = appSource.indexOf("const btnSendReset = $('btnSendReset');", signupStart);
  const signupHandler = appSource.slice(signupStart, signupEnd);
  assert.ok(signupHandler.indexOf("if (!name)") < signupHandler.indexOf("signupInFlight = true;"),
    'invalid name must not permanently lock the signup submit guard');
  assert.ok(signupHandler.indexOf("if (!validateEmail(email))") < signupHandler.indexOf("signupInFlight = true;"),
    'invalid email must remain correctable and retryable');
  assert.ok(signupHandler.indexOf("if (pass !== passConfirm)") < signupHandler.indexOf("signupInFlight = true;"),
    'password validation must run before locking signup submission');
  assert.match(appSource, /signupForm\.addEventListener\('submit', handleSignupSubmit\);/);
  assert.doesNotMatch(appSource, /_btnSignupEl\.addEventListener\('click', handleSignupSubmit\)/,
    'the signup button must not register a second submit path');
  assert.doesNotMatch(appSource, /el\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key === 'Enter'\)[\s\S]{0,100}handleSignupSubmit\(\)/,
    'Enter must use native form submission rather than a parallel handler');
  assert.match(appSource, /Array\.isArray\(data\.user\.identities\) && data\.user\.identities\.length === 0/,
    'Supabase empty identities response must not be treated as a new account');
  assert.match(appSource, /Try signing in or resetting your password/);
});

test('admin account filters use unique DOM IDs and do not mislabel unknown payments', () => {
  assert.equal(countMatches(adminHtml, /id="filters"/g), 1, 'there must be one filter section');
  for (const id of ['status-filter', 'created-from', 'created-to', 'account-search', 'filter-summary']) {
    assert.equal(countMatches(adminHtml, new RegExp('id="' + id + '"', 'g')), 1, id + ' must be unique');
  }
  assert.match(adminHtml, /placeholder="Search store, owner, email, phone or ID/);
  assert.match(adminHtml, /id="filters" aria-label="Filter accounts" hidden/);
  assert.match(adminHtml, /\[v\.business_name, v\.name, v\.email, v\.phone_number, v\.id\]/);
  assert.doesNotMatch(adminHtml, /Never paid/);
  assert.match(adminHtml, /v\.has_payment_claim !== false/);
  assert.match(adminHtml, /Object\.assign\(vendor, data\.patch \|\| \{\}\);[\s\S]*?applyFilters\(\);[\s\S]*?updateStats\(\);/);
  assert.match(adminHtml, /created\.getFullYear\(\)/);
  assert.equal(countMatches(adminHtml, /addMeta\('Created '/g), 1, 'creation timestamp should appear once per card');
});

test('admin API keeps profiles visible when payment claims are absent or unavailable', () => {
  assert.match(adminApiSource, /async function fetchPaymentClaims\(\)/);
  assert.match(adminApiSource, /const vendors = \(profiles \|\| \[\]\)\.map\(p => \(\{/);
  assert.match(adminApiSource, /has_payment_claim: claimsResult\.available \? Boolean\(latestClaimByUser\[p\.id\]\) : null/);
  assert.match(adminApiSource, /fetchProfilePhoneNumbers\(\)/);
  assert.match(adminApiSource, /phone_number: phoneMap\[p\.id\] \|\| p\.phone_number \|\| ''/);
  assert.match(adminApiSource, /paymentClaimsAvailable: claimsResult\.available/);
});


test('application and admin scripts parse without syntax errors', () => {
  const vm = require('node:vm');
  new vm.Script(appSource, { filename: 'appss.js' });
  new vm.Script(qsInitSource, { filename: 'qs-init.js' });
  assert.doesNotThrow(() => new vm.Script(adminApiSource), 'api/admin.js syntax');
  const inlineScripts = Array.from(adminHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());
  assert.equal(inlineScripts.length, 1, 'expected one inline admin script');
  assert.doesNotThrow(() => new vm.Script(inlineScripts[0][2]), 'admin.html inline script syntax');
});

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.test';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || 'regression-test-token';
const adminHandler = require('../api/admin.js');

function fakeResponse(statusCode, payload) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json: async () => payload,
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload)
  };
}

async function invokeGetVendors(claimsResponse) {
  const originalFetch = global.fetch;
  const profiles = [
    { id: 'vendor-with-claim', business_name: 'Claim Store', name: 'Claim Owner', is_active: false, is_founder: false, created_at: '2026-10-01T10:00:00Z' },
    { id: 'vendor-without-claim', business_name: 'No Claim Store', name: 'No Claim Owner', is_active: false, is_founder: false, created_at: '2026-10-02T10:00:00Z' }
  ];
  global.fetch = async url => {
    if (url.includes('/rest/v1/rpc/admin_get_vendors')) return fakeResponse(200, profiles);
    if (url.includes('/auth/v1/admin/users')) return fakeResponse(200, { users: [] });
    if (url.includes('/rest/v1/payment_claims')) return claimsResponse;
    throw new Error('Unexpected mocked URL: ' + url);
  };

  const response = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
  try {
    await adminHandler({
      method: 'POST',
      headers: { origin: 'https://quickshop.test', 'x-admin-token': process.env.ADMIN_PASSWORD_HASH },
      body: { action: 'get_vendors' }
    }, response);
    return response;
  } finally {
    global.fetch = originalFetch;
  }
}

test('admin API preserves vendors with no payment claim', async () => {
  const claims = [
    { user_id: 'vendor-with-claim', status: 'pending', claim_kind: 'activation', amount_ngn: 1500, claimed_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z', reviewed_at: null }
  ];
  const response = await invokeGetVendors(fakeResponse(200, claims));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.paymentClaimsAvailable, true);
  assert.equal(response.body.vendors.length, 2);
  assert.equal(response.body.vendors.find(v => v.id === 'vendor-with-claim').payment_claim.status, 'pending');
  assert.equal(response.body.vendors.find(v => v.id === 'vendor-without-claim').has_payment_claim, false);
});

test('admin API keeps all vendors visible and marks claim state unavailable on claim-query failure', async () => {
  const response = await invokeGetVendors(fakeResponse(503, { message: 'claims temporarily unavailable' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.paymentClaimsAvailable, false);
  assert.equal(response.body.vendors.length, 2);
  assert.equal(response.body.vendors.find(v => v.id === 'vendor-without-claim').has_payment_claim, null);
});


test('referral payout cycles exclude reserved and paid referrals and use the atomic payout RPC', () => {
  const start = appSource.indexOf('// ── Referral dashboard — async, non-blocking');
  const end = appSource.indexOf('// ── End referral dashboard', start);
  assert.ok(start >= 0 && end > start, 'referral dashboard boundaries must exist');
  const dashboard = appSource.slice(start, end);

  assert.match(dashboard, /from\('referral_payout_items'\)[\s\S]*?select\('referral_id'\)/);
  assert.match(dashboard, /r\.status === 'earned' && !reservedIds\.has\(r\.id\)/);
  assert.match(dashboard, /const cycleCount = Math\.min\(eligibleCount, MILESTONE\)/);
  assert.match(dashboard, /nextBatchAmount === 5000/);
  assert.match(dashboard, /Request Payout — ₦5,000/);
  assert.match(dashboard, /rpc\('qs_request_referral_payout_v2'/);
  assert.match(dashboard, /p_client_request_id: clientRequestId/);
  assert.doesNotMatch(dashboard, /from\('payout_requests'\)/, 'do not use the legacy payout table for new referral requests');
  assert.doesNotMatch(dashboard, /\.from\('referrals'\)\s*\.insert/, 'referrals must not be recreated or deleted to reset a cycle');
});

test('payout request activity is idempotent and survives a temporary cloud-log failure', () => {
  const start = appSource.indexOf('// ── Referral dashboard — async, non-blocking');
  const end = appSource.indexOf('// ── End referral dashboard', start);
  const dashboard = appSource.slice(start, end);
  assert.match(dashboard, /const logId = 'payoutreq_' \+ String\(batch\.id\)\.replace\(\/-\/g, ''\)/);
  assert.match(dashboard, /action: 'Payout requested'/);
  assert.match(dashboard, /from\('audit_logs'\)\.upsert\(logRow/);
  assert.match(dashboard, /state\.logs\.unshift\(\{/);
  assert.match(dashboard, /for \(const batch of batches\)[\s\S]*?ensurePayoutActivityLog\(batch\)/,
    'dashboard should retry missing activity-log writes from payout history');
  assert.match(dashboard, /Referrals included in a payout request are reserved and do not count toward your next cycle/);
});


test('referral payout dashboard reports database permission failures accurately and retains read grants', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027174600_grant_vendor_referral_payout_reads.sql'), 'utf8');
  assert.match(appSource, /e\.code === '42501'/);
  assert.match(appSource, /Referral payout access is not configured correctly/);
  assert.doesNotMatch(appSource, /Could not load referral data\. Check your connection/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.referral_payout_items TO authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.referral_payout_batches TO authenticated/i);
});
 
test('admin referral payout dashboard prioritizes active stores and provides independent queue filters', () => {
  assert.match(adminHtml, /id="payout-section"/);
  assert.match(adminHtml, /id="payout-view-filter"/);
  assert.doesNotMatch(adminHtml, /id="payout-search"/);
  assert.match(adminHtml, /option value="priority">Priority queue/);
  assert.match(adminHtml, /option value="outstanding">Outstanding requests/);
  assert.match(adminHtml, /v\.is_active === true/);
  assert.match(adminHtml, /if \(v\.activeBatch\) return 0/);
  assert.match(adminHtml, /Outstanding requests remain visible until resolved/);
  assert.match(adminHtml, /payout-view-filter'\)\.addEventListener\('change',\s*renderReferralPayouts/);
  assert.match(adminHtml, /account-search'\)\.addEventListener\('input'/);
  assert.doesNotMatch(adminHtml, /id="payout-search"/);
  assert.match(adminHtml, /id="payout-overlay"/);
  assert.match(adminHtml, /if\(e\.key==='Tab'\)/);
  assert.match(adminHtml, /window\.addEventListener\('popstate'/);
  assert.match(adminHtml, /history\.pushState\(\{qsReferralQueue:true\}/);
  assert.match(adminHtml, /function renderActivationAttention/);
  assert.match(adminHtml, /id="payout-open-btn"/);
  assert.match(adminHtml, /pending-activation/);
  assert.match(adminHtml, /updateAttentionBadge/);
  assert.match(adminHtml, /vendor-referral-summary/);
  assert.match(adminHtml, /Approaching \(7–9\)/);
  assert.match(adminHtml, /Request account details · WhatsApp/);
  assert.match(adminHtml, /Please reply with your bank name, account name, and account number/);
  assert.match(adminHtml, /apiCall\('request_payout_details'/);
  assert.match(adminHtml, /apiCall\('request_vendor_payout_details'/);
  assert.match(adminHtml, /v\.eligibleCount >= 7/);
  assert.match(adminHtml, /latestDetailsRequest/);
  assert.match(adminHtml, /apiCall\('mark_payout_paid'/);
    assert.match(adminHtml, /eligibleCount >= 10 && counts.eligibleAmount === 5000 && !activeBatch/);
  assert.match(adminHtml, /items\.forEach\(function\(item\) \{ reserved\[item\.referral_id\] = true; \}\)/);
});

test('admin payout API protects state transitions and records activity', () => {
  assert.match(adminApiSource, /action === 'get_referral_payouts'/);
  assert.match(adminApiSource, /action === 'request_vendor_payout_details'/);
  assert.match(adminApiSource, /WhatsApp account-details request initiated before payout batch existed/);
  assert.match(adminApiSource, /action === 'request_payout_details'/);
  assert.match(adminApiSource, /status: 'details_requested', details_requested_at: requestedAt/);
  assert.match(adminApiSource, /action === 'mark_payout_paid'/);
  assert.match(adminApiSource, /status: 'paid', paid_at: now/);
  assert.match(adminApiSource, /Payout details requested/);
  assert.match(adminApiSource, /Referral payout paid/);
  assert.match(adminApiSource, /batch\.status === 'cancelled'/);
  assert.match(adminApiSource, /items\.length !== Number\(batch\.referral_count\)/);
  assert.match(adminApiSource, /fetchAllRows\(path\)/);
});
