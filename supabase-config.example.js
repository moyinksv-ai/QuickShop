/* supabase-config.js — QuickShop configuration
 *
 * THIS FILE IS THE COMMITTED TEMPLATE — DO NOT PUT REAL KEYS HERE.
 * Real values are injected at build time by Vercel from environment variables.
 *
 * VERCEL ENVIRONMENT VARIABLES REQUIRED:
 * ──────────────────────────────────────────────────────────────────────────
 *   SUPABASE_URL       → Supabase Dashboard > Project Settings > API > Project URL
 *   SUPABASE_ANON_KEY  → Supabase Dashboard > Project Settings > API > anon public
 *   GEMINI_API_KEY     → https://aistudio.google.com/app/apikey (free, no card needed)
 *
 * Free Gemini tier: 15 req/min, 1,000,000 tokens/day — more than enough.
 *
 * SECURITY NOTES
 * ──────────────────────────────────────────────────────────────────────────
 * · Supabase anon key: intentionally public-safe. RLS policies enforce
 *   auth.uid() checks on every table — unauthenticated requests see nothing.
 * · Gemini key: free-tier, rate-limited per project. Rotate at
 *   aistudio.google.com if you ever suspect exposure.
 * · Neither key grants write access to Supabase without a valid user session.
 */

(function () {
  'use strict';

  // ── SUPABASE ─────────────────────────────────────────────────────────────
  // Values below are replaced by Vercel's build step using sed.
  // Locally: copy this file to supabase-config.local.js, fill in real values,
  // and load that instead (or edit directly — it's in .gitignore if named *.local.js).

  const SUPABASE_URL      = '%%SUPABASE_URL%%';
  const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%';

  // ── GEMINI (AI Insights) ─────────────────────────────────────────────────
  const GEMINI_API_KEY = '%%GEMINI_API_KEY%%';

  // ── VALIDATION ───────────────────────────────────────────────────────────

  if (!SUPABASE_URL || SUPABASE_URL.includes('%%') ||
      !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('%%')) {
    console.error('❌ QuickShop: Supabase credentials not injected. Check Vercel env vars.');
    return;
  }

  // ── SUPABASE CLIENT ───────────────────────────────────────────────────────
  // The Supabase JS library is loaded just before this script tag.
  // On very slow connections it may not have parsed yet even though the
  // browser has moved on to this script.  Retry for up to 15s before
  // giving up — this is the fix for "Could not connect to the database"
  // on slow Nigerian 4G connections.

  function _createClient() {
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken:   true,
        persistSession:     true,
        detectSessionInUrl: true,
        storageKey:         'qs_supabase_auth',
        flowType:           'pkce'
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      },
      global: {
        headers: { 'x-application-name': 'QuickShop' }
      }
    });

    window.__QS_SUPABASE = {
      client: supabaseClient,
      url:    SUPABASE_URL,
      user:   null,

      isAuthenticated: async function () {
        try {
          const { data: { user }, error } = await supabaseClient.auth.getUser();
          if (error) throw error;
          return !!user;
        } catch (e) {
          console.error('[QS] Auth check failed:', e);
          return false;
        }
      },

      getCurrentUser: async function () {
        try {
          const { data: { user }, error } = await supabaseClient.auth.getUser();
          if (error) throw error;
          return user;
        } catch (e) {
          console.error('[QS] Get user failed:', e);
          return null;
        }
      }
    };

    Object.freeze(window.__QS_SUPABASE);
  }

  if (typeof window.supabase !== 'undefined') {
    _createClient();
  } else {
    // Library not parsed yet — wait for it (handles very slow CDN loads)
    console.warn('[QS] Supabase library not ready — polling for up to 15s');
    var _waited = 0;
    var _iv = setInterval(function () {
      if (typeof window.supabase !== 'undefined') {
        clearInterval(_iv);
        try { _createClient(); } catch (e) { console.error('[QS] createClient failed:', e); }
        return;
      }
      _waited += 250;
      if (_waited >= 15000) {
        clearInterval(_iv);
        console.error('[QS] Supabase library never loaded after 15s. CDN may be blocked.');
      }
    }, 250);
  }

  // Gemini key exposed separately — appss.js reads it in _runGeminiInsight().
  // null = "Ask AI" button hidden; local math insight cards still work fine.
  window.__QS_GEMINI_KEY = (GEMINI_API_KEY && !GEMINI_API_KEY.includes('%%'))
    ? GEMINI_API_KEY
    : null;

})();
