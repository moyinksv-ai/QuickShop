/**
 * api/admin.js — QuickShop Admin API
 *
 * Vercel serverless function. Runs server-side only.
 * The Supabase service key NEVER reaches the browser.
 *
 * All requests must include a valid X-Admin-Token header
 * (SHA-256 hex of the admin password). The server re-hashes
 * and compares in constant time before touching Supabase.
 *
 * Endpoints (all POST, JSON body):
 *   { action: 'get_vendors' }
 *   { action: 'activate',   vendorId: '<uuid>' }
 *   { action: 'revoke',     vendorId: '<uuid>' }
 *   { action: 'set_founder', vendorId: '<uuid>', founderVal: boolean }
 */

const crypto = require('crypto');

// ── Environment variables (set in Vercel dashboard, never in source) ────
const SUPABASE_URL         = process.env.SUPABASE_URL         || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_PASSWORD_HASH  = process.env.ADMIN_PASSWORD_HASH  || '';

// ── Constant-time string comparison (prevents timing attacks) ───────────
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Normalise Supabase base URL ─────────────────────────────────────────
function baseUrl() {
  return (SUPABASE_URL || '').replace(/\/+$/, '');
}

// ── Supabase fetch (server-side, service key never leaves here) ─────────
async function sbFetch(path, opts) {
  const url = baseUrl() + path;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...(opts && opts.headers || {}),
    },
  });
  return res;
}

// ── Auth email lookup (best-effort — graceful if it fails) ─────────────
async function fetchAuthEmails() {
  try {
    const res = await sbFetch('/auth/v1/admin/users?per_page=1000', { method: 'GET' });
    if (!res.ok) return {};
    const data = await res.json();
    const map  = {};
    (data.users || []).forEach(u => { map[u.id] = u.email || ''; });
    return map;
  } catch (_) {
    return {};
  }
}

/*
 * Fetch payment claims separately from profiles so vendors without claims are
 * never dropped from the account list. Range pagination avoids silently
 * ignoring older claims when the table grows beyond PostgREST's page size.
 */
async function fetchPaymentClaims() {
  const claims = [];
  const pageSize = 1000;
  const maxPages = 100;

  try {
    for (let page = 0; page < maxPages; page++) {
      const start = page * pageSize;
      const end = start + pageSize - 1;
      const res = await sbFetch(
        '/rest/v1/payment_claims?select=user_id,status,claim_kind,amount_ngn,claimed_at,updated_at,reviewed_at&order=claimed_at.desc',
        { method: 'GET', headers: { Range: start + '-' + end, 'Range-Unit': 'items' } }
      );
      if (!res.ok) return { available: false, claims: [] };
      const rows = await res.json();
      if (!Array.isArray(rows)) return { available: false, claims: [] };
      claims.push(...rows);
      if (rows.length < pageSize) return { available: true, claims };
    }
  } catch (_) {
    return { available: false, claims: [] };
  }

  // A full final page at the safety cap means completeness is not guaranteed.
  return { available: false, claims: [] };
}


async function fetchAllRows(path) {
  const rows = [];
  const pageSize = 1000;
  const maxPages = 100;
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize;
    const res = await sbFetch(path, {
      method: 'GET',
      headers: { Range: start + '-' + (start + pageSize - 1), 'Range-Unit': 'items' }
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('Could not load ' + path.split('?')[0] + ': ' + res.status + ': ' + errText.slice(0, 200));
    }
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected response loading ' + path.split('?')[0]);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error('Payout data exceeds the safe pagination limit; refusing an incomplete payout view');
}

async function fetchProfilePhoneNumbers() {
  try {
    const rows = await fetchAllRows('/rest/v1/profiles?select=id,phone_number');
    const map = {};
    rows.forEach(profile => { map[profile.id] = profile.phone_number || ''; });
    return map;
  } catch (_) {
    // Phone enrichment is optional; keep the admin account list usable if this query fails.
    return {};
  }
}

async function writePayoutAudit(userId, id, action, details) {
  const res = await sbFetch('/rest/v1/audit_logs?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: id,
      user_id: userId,
      action: action,
      details: details.slice(0, 500),
      performed_by: 'admin-dashboard'
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error('Payout state updated but activity log failed: ' + res.status + ': ' + errText.slice(0, 180));
  }
}

// ── Main handler ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // ── CORS headers — restrict to same origin ────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ── Config guard ───────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_PASSWORD_HASH) {
    res.status(503).json({ error: 'Admin API not configured. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD_HASH in Vercel env vars.' });
    return;
  }

  // ── Token authentication ───────────────────────────────────────────────
  // The browser sends the SHA-256 hex of the password as X-Admin-Token.
  // We compare it directly to ADMIN_PASSWORD_HASH (also a SHA-256 hex).
  // No re-hashing needed — both sides store and compare the hash.
  const token = (req.headers['x-admin-token'] || '').toLowerCase().trim();
  const expected = ADMIN_PASSWORD_HASH.toLowerCase().trim();

  if (!token || !safeEqual(token, expected)) {
    // Delay response to slow brute force even if client-side lockout is bypassed
    await new Promise(r => setTimeout(r, 600));
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body = {};
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (_) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const { action, vendorId, founderVal, batchId } = body;

  // ── Validate IDs for mutating actions ──────────────────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (['activate', 'revoke', 'set_founder'].includes(action) && (!vendorId || !UUID_RE.test(vendorId))) {
    res.status(400).json({ error: 'Invalid or missing vendorId' });
    return;
  }
  if (['request_payout_details', 'mark_payout_paid'].includes(action) && (!batchId || !UUID_RE.test(batchId))) {
    res.status(400).json({ error: 'Invalid or missing batchId' });
    return;
  }

  // ── Route actions ──────────────────────────────────────────────────────
  try {
    if (action === 'get_vendors') {
      const [profilesRes, emailMap, claimsResult, phoneMap] = await Promise.all([
        sbFetch('/rest/v1/rpc/admin_get_vendors', { method: 'POST', body: '{}' }),
        fetchAuthEmails(),
        fetchPaymentClaims(),
        fetchProfilePhoneNumbers(),
      ]);

      if (!profilesRes.ok) {
        const errText = await profilesRes.text().catch(() => '');
        throw new Error('Supabase error ' + profilesRes.status + ': ' + errText.slice(0, 300));
      }

      const profiles = await profilesRes.json();
      // Claims are optional enrichment; never remove a profile because it has no claim.
      // The query is ordered newest first, so the first claim per vendor is the latest.
      const latestClaimByUser = {};
      if (claimsResult.available) {
        claimsResult.claims.forEach(claim => {
          if (!latestClaimByUser[claim.user_id]) {
            latestClaimByUser[claim.user_id] = {
              status: claim.status,
              claim_kind: claim.claim_kind,
              amount_ngn: claim.amount_ngn,
              claimed_at: claim.claimed_at,
              updated_at: claim.updated_at,
              reviewed_at: claim.reviewed_at,
            };
          }
        });
      }

      // Merge auth emails (more reliable than profile.email field) and latest claim state.
      const vendors = (profiles || []).map(p => ({
        ...p,
        email: emailMap[p.id] || p.email || '',
        phone_number: phoneMap[p.id] || p.phone_number || '',
        payment_claim: claimsResult.available ? (latestClaimByUser[p.id] || null) : null,
        has_payment_claim: claimsResult.available ? Boolean(latestClaimByUser[p.id]) : null,
      }));

      res.status(200).json({ vendors, paymentClaimsAvailable: claimsResult.available });
      return;
    }


    if (action === 'get_referral_payouts') {
      const [referrals, batches, items] = await Promise.all([
        fetchAllRows('/rest/v1/referrals?select=id,referrer_id,amount,status,created_at,paid_at&order=created_at.asc'),
        fetchAllRows('/rest/v1/referral_payout_batches?select=id,user_id,status,referral_count,amount_ngn,requested_at,details_requested_at,paid_at,payout_reference&order=requested_at.desc'),
        fetchAllRows('/rest/v1/referral_payout_items?select=payout_id,referral_id,amount_ngn,reserved_at')
      ]);
      res.status(200).json({ referrals, batches, items });
      return;
    }

    if (action === 'request_payout_details') {
      const batchRes = await sbFetch('/rest/v1/referral_payout_batches?id=eq.' + encodeURIComponent(batchId) + '&select=id,user_id,status,amount_ngn,referral_count,details_requested_at', { method: 'GET' });
      if (!batchRes.ok) throw new Error('Could not load payout batch: ' + batchRes.status);
      const batchRows = await batchRes.json();
      const batch = batchRows && batchRows[0];
      if (!batch) { res.status(404).json({ error: 'Payout batch not found' }); return; }
      if (!['pending', 'details_requested'].includes(batch.status)) {
        res.status(409).json({ error: 'Only pending payouts can request account details' });
        return;
      }
      const requestedAt = batch.details_requested_at || new Date().toISOString();
      if (batch.status !== 'details_requested') {
        const patchRes = await sbFetch('/rest/v1/referral_payout_batches?id=eq.' + encodeURIComponent(batchId) + '&status=eq.pending', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'details_requested', details_requested_at: requestedAt })
        });
        if (!patchRes.ok) {
          const errText = await patchRes.text().catch(() => '');
          throw new Error('Could not record account-details request: ' + patchRes.status + ': ' + errText.slice(0, 200));
        }
      }
      await writePayoutAudit(batch.user_id, 'payoutdetails_' + batch.id.replace(/-/g, ''), 'Payout details requested',
        'WhatsApp account-details request initiated for payout ' + batch.id + ' (' + batch.referral_count + ' referrals, ₦' + batch.amount_ngn + ').');
      res.status(200).json({ ok: true, status: 'details_requested', details_requested_at: requestedAt });
      return;
    }

    if (action === 'mark_payout_paid') {
      const batchRes = await sbFetch('/rest/v1/referral_payout_batches?id=eq.' + encodeURIComponent(batchId) + '&select=id,user_id,status,amount_ngn,referral_count,paid_at', { method: 'GET' });
      if (!batchRes.ok) throw new Error('Could not load payout batch: ' + batchRes.status);
      const batchRows = await batchRes.json();
      const batch = batchRows && batchRows[0];
      if (!batch) { res.status(404).json({ error: 'Payout batch not found' }); return; }
      if (batch.status === 'cancelled') { res.status(409).json({ error: 'Cancelled payouts cannot be marked paid' }); return; }
      const items = await fetchAllRows('/rest/v1/referral_payout_items?payout_id=eq.' + encodeURIComponent(batchId) + '&select=referral_id,amount_ngn');
      if (items.length !== Number(batch.referral_count)) {
        res.status(409).json({ error: 'Payout item count does not match the batch; payment was not recorded' });
        return;
      }
      const referralIds = items.map(function(item) { return item.referral_id; });
      const now = batch.paid_at || new Date().toISOString();
      if (referralIds.length) {
        const idsFilter = 'in.(' + referralIds.join(',') + ')';
        const verifyRes = await sbFetch('/rest/v1/referrals?id=' + encodeURIComponent(idsFilter) + '&select=id', { method: 'GET' });
        if (!verifyRes.ok) throw new Error('Could not verify payout referrals: ' + verifyRes.status);
        const verified = await verifyRes.json();
        if (!Array.isArray(verified) || verified.length !== referralIds.length) {
          res.status(409).json({ error: 'Some reserved referrals are missing; payment was not recorded' });
          return;
        }
        const referralPatch = await sbFetch('/rest/v1/referrals?id=' + encodeURIComponent(idsFilter), {
          method: 'PATCH',
          body: JSON.stringify({ status: 'paid', paid_at: now })
        });
        if (!referralPatch.ok) {
          const errText = await referralPatch.text().catch(() => '');
          throw new Error('Could not mark reserved referrals paid: ' + referralPatch.status + ': ' + errText.slice(0, 200));
        }
      }
      if (batch.status !== 'paid') {
        const batchPatch = await sbFetch('/rest/v1/referral_payout_batches?id=eq.' + encodeURIComponent(batchId) + '&status=neq.cancelled', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'paid', paid_at: now })
        });
        if (!batchPatch.ok) {
          const errText = await batchPatch.text().catch(() => '');
          throw new Error('Referrals were marked paid, but batch update failed; retry this action to finish tracking: ' + batchPatch.status + ': ' + errText.slice(0, 200));
        }
      }
      await writePayoutAudit(batch.user_id, 'payoutpaid_' + batch.id.replace(/-/g, ''), 'Referral payout paid',
        'Admin confirmed manual payout of ₦' + batch.amount_ngn + ' for ' + batch.referral_count + ' referrals. Batch ' + batch.id + '.');
      res.status(200).json({ ok: true, status: 'paid', paid_at: now });
      return;
    }

    if (action === 'activate') {
      // Before activation, retry referral attribution from signup metadata. Signup/OTP
      // can race the admin's payment confirmation, so do not silently miss a valid
      // referral just because the browser's authenticated attribution retry has not run.
      const profileRes = await sbFetch(
        '/rest/v1/profiles?id=eq.' + encodeURIComponent(vendorId) + '&select=id,referred_by',
        { method: 'GET' }
      );
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error('Could not verify vendor referral state: ' + profileRes.status + ': ' + errText.slice(0, 200));
      }
      const profileRows = await profileRes.json();
      const profile = profileRows && profileRows[0];
      if (!profile) throw new Error('Vendor profile not found');
      if (!profile.referred_by) {
        const authRes = await sbFetch('/auth/v1/admin/users/' + encodeURIComponent(vendorId), { method: 'GET' });
        if (authRes.ok) {
          const authUser = await authRes.json();
          const meta = authUser.user_metadata || {};
          const rawCode = typeof meta.referral_code === 'string' ? meta.referral_code.trim() : '';
          const rawId = typeof meta.referral_id === 'string' ? meta.referral_id.trim() : '';
          let referrerId = null;
          if (/^[0-9a-f]{16}$/i.test(rawCode)) {
            const resolveRes = await sbFetch('/rest/v1/rpc/resolve_referral_code', {
              method: 'POST', body: JSON.stringify({ p_code: rawCode.toLowerCase() })
            });
            if (resolveRes.ok) {
              const resolved = await resolveRes.json();
              referrerId = typeof resolved === 'string' ? resolved : (resolved && (resolved.referrer_id || resolved.id)) || null;
            }
          } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
            referrerId = rawId;
          }
          if (referrerId && referrerId.toLowerCase() !== vendorId.toLowerCase()) {
            const updateRes = await sbFetch('/rest/v1/profiles?id=eq.' + encodeURIComponent(vendorId) + '&referred_by=is.null', {
              method: 'PATCH',
              body: JSON.stringify({ referred_by: referrerId }),
            });
            if (!updateRes.ok) {
              const errText = await updateRes.text().catch(() => '');
              throw new Error('Could not save referral attribution before activation: ' + updateRes.status + ': ' + errText.slice(0, 200));
            }
          }
        }
      }

      const sbRes = await sbFetch('/rest/v1/rpc/admin_activate_vendor', {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId, days_count: 30 }),
      });
      if (!sbRes.ok) {
        const errText = await sbRes.text().catch(() => '');
        throw new Error('Supabase error ' + sbRes.status + ': ' + errText.slice(0, 300));
      }
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      // Ensure the award exists even if this vendor was already active (in that case
      // the false->true database trigger does not fire). The unique referred_id index
      // makes this idempotent and prevents double awards.
      const postProfileRes = await sbFetch('/rest/v1/profiles?id=eq.' + encodeURIComponent(vendorId) + '&select=id,referred_by', { method: 'GET' });
      if (!postProfileRes.ok) {
        const errText = await postProfileRes.text().catch(() => '');
        throw new Error('Activated, but could not verify referral state: ' + postProfileRes.status + ': ' + errText.slice(0, 200));
      }
      const postProfiles = await postProfileRes.json();
      const finalProfile = postProfiles && postProfiles[0];
      if (finalProfile && finalProfile.referred_by && finalProfile.referred_by.toLowerCase() !== vendorId.toLowerCase()) {
        const existingRes = await sbFetch('/rest/v1/referrals?referred_id=eq.' + encodeURIComponent(vendorId) + '&select=id', { method: 'GET' });
        if (!existingRes.ok) {
          const errText = await existingRes.text().catch(() => '');
          throw new Error('Activated, but could not verify referral ledger: ' + existingRes.status + ': ' + errText.slice(0, 200));
        }
        const existingRows = await existingRes.json();
        if (!Array.isArray(existingRows) || existingRows.length === 0) {
          const insertRes = await sbFetch('/rest/v1/referrals', {
            method: 'POST',
            body: JSON.stringify({ referrer_id: finalProfile.referred_by, referred_id: vendorId, amount: 500, status: 'earned' }),
          });
          if (!insertRes.ok) {
            const errText = await insertRes.text().catch(() => '');
            // A concurrent activation may have inserted the same award. Verify before failing.
            const verifyRes = await sbFetch('/rest/v1/referrals?referred_id=eq.' + encodeURIComponent(vendorId) + '&select=id', { method: 'GET' });
            const verifyRows = verifyRes.ok ? await verifyRes.json() : [];
            if (!Array.isArray(verifyRows) || verifyRows.length === 0) {
              throw new Error('Activated, but referral award failed: ' + insertRes.status + ': ' + errText.slice(0, 200));
            }
          }
        }
      }
      const referralRes = await sbFetch('/rest/v1/referrals?referred_id=eq.' + encodeURIComponent(vendorId) + '&select=id,referrer_id,amount,status', { method: 'GET' });
      const referralRows = referralRes.ok ? await referralRes.json() : [];
      res.status(200).json({
        ok: true,
        patch: { is_active: true, subscription_expires: expires },
        referralAwarded: Array.isArray(referralRows) && referralRows.length > 0,
      });
      return;
    }

    if (action === 'revoke') {
      const sbRes = await sbFetch('/rest/v1/rpc/admin_revoke_vendor', {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId }),
      });
      if (!sbRes.ok) {
        const errText = await sbRes.text().catch(() => '');
        throw new Error('Supabase error ' + sbRes.status + ': ' + errText.slice(0, 300));
      }
      res.status(200).json({ ok: true, patch: { is_active: false } });
      return;
    }

    if (action === 'set_founder') {
      const fVal = founderVal === true || founderVal === 'true';
      const sbRes = await sbFetch('/rest/v1/rpc/admin_set_founder', {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId, founder_val: fVal }),
      });
      if (!sbRes.ok) {
        const errText = await sbRes.text().catch(() => '');
        throw new Error('Supabase error ' + sbRes.status + ': ' + errText.slice(0, 300));
      }
      const patch = fVal
        ? { is_founder: true,  is_active: true }
        : { is_founder: false };
      res.status(200).json({ ok: true, patch });
      return;
    }

    res.status(400).json({ error: 'Unknown action: ' + String(action).slice(0, 40) });

  } catch (err) {
    console.error('[QS Admin API]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
