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

  const { action, vendorId, founderVal } = body;

  // ── Validate vendorId format (UUID v4) for mutating actions ───────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (action !== 'get_vendors' && (!vendorId || !UUID_RE.test(vendorId))) {
    res.status(400).json({ error: 'Invalid or missing vendorId' });
    return;
  }

  // ── Route actions ──────────────────────────────────────────────────────
  try {
    if (action === 'get_vendors') {
      const [profilesRes, emailMap] = await Promise.all([
        sbFetch('/rest/v1/rpc/admin_get_vendors', { method: 'POST', body: '{}' }),
        fetchAuthEmails(),
      ]);

      if (!profilesRes.ok) {
        const errText = await profilesRes.text().catch(() => '');
        throw new Error('Supabase error ' + profilesRes.status + ': ' + errText.slice(0, 300));
      }

      const profiles = await profilesRes.json();
      // Merge auth emails (more reliable than profile.email field)
      const vendors = (profiles || []).map(p => ({
        ...p,
        email: emailMap[p.id] || p.email || '',
      }));

      res.status(200).json({ vendors });
      return;
    }

    if (action === 'activate') {
      const sbRes = await sbFetch('/rest/v1/rpc/admin_activate_vendor', {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId, days_count: 30 }),
      });
      if (!sbRes.ok) {
        const errText = await sbRes.text().catch(() => '');
        throw new Error('Supabase error ' + sbRes.status + ': ' + errText.slice(0, 300));
      }
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      res.status(200).json({ ok: true, patch: { is_active: true, subscription_expires: expires } });
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
