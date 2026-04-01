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

  if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase JS library not loaded. Load it before supabase-config.js.');
    return;
  }

  // ── SUPABASE CLIENT ───────────────────────────────────────────────────────

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

  // ── GLOBAL EXPOSURE ───────────────────────────────────────────────────────

  window.__QS_SUPABASE = {
    client: supabaseClient,
    url:    SUPABASE_URL,
    user:   null, // populated by handleAuthUser in appss.js — never set here

    isAuthenticated: async function () {
      try {
        // getUser() verifies the JWT server-side — getSession() only reads
        // localStorage and can return stale/revoked sessions.
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

  // Freeze prevents any later script from replacing client or user references.
  Object.freeze(window.__QS_SUPABASE);

  // Gemini key exposed separately — appss.js reads it in _runGeminiInsight().
  // null = "Ask AI" button hidden; local math insight cards still work fine.
  window.__QS_GEMINI_KEY = (GEMINI_API_KEY && !GEMINI_API_KEY.includes('%%'))
    ? GEMINI_API_KEY
    : null;

})();
