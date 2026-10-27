'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'appss.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminApiSource = fs.readFileSync(path.join(root, 'api/admin.js'), 'utf8');

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
});

test('admin account filters use unique DOM IDs and do not mislabel unknown payments', () => {
  assert.equal(countMatches(adminHtml, /id="filters"/g), 1, 'there must be one filter section');
  for (const id of ['status-filter', 'created-from', 'created-to', 'account-search', 'filter-summary']) {
    assert.equal(countMatches(adminHtml, new RegExp('id="' + id + '"', 'g')), 1, id + ' must be unique');
  }
  assert.match(adminHtml, /placeholder="Email, store name, or name"/);
  assert.match(adminHtml, /\[v\.business_name, v\.name, v\.email, v\.id\]/);
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
  assert.match(adminApiSource, /paymentClaimsAvailable: claimsResult\.available/);
});


test('application and admin scripts parse without syntax errors', () => {
  const vm = require('node:vm');
  new vm.Script(appSource, { filename: 'appss.js' });
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
