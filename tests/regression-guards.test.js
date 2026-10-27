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
  assert.match(appSource, /localStorage\.removeItem\('qs_session_active'\)/);
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
  assert.match(adminHtml, /created\.getFullYear\(\)/);
  assert.equal(countMatches(adminHtml, /addMeta\('Created '/g), 1, 'creation timestamp should appear once per card');
});

test('admin API keeps profiles visible when payment claims are absent or unavailable', () => {
  assert.match(adminApiSource, /async function fetchPaymentClaims\(\)/);
  assert.match(adminApiSource, /const vendors = \(profiles \|\| \[\]\)\.map\(p => \(\{/);
  assert.match(adminApiSource, /has_payment_claim: claimsResult\.available \? Boolean\(latestClaimByUser\[p\.id\]\) : null/);
  assert.match(adminApiSource, /paymentClaimsAvailable: claimsResult\.available/);
});
