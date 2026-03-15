/* supabase-config.js - QuickShop Supabase Configuration */

(function () {
  'use strict';

  // ============================================
  // CRITICAL: Replace these with your actual Supabase credentials
  // Find these in: Supabase Dashboard > Project Settings > API
  // ============================================
  
  const SUPABASE_URL = '%%SUPABASE_URL%%';
  const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%';

  // ============================================
  // VALIDATION: Ensure credentials are set
  // ============================================
  
  if (SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_ANON_PUBLIC_KEY')) {
    console.error('❌ QuickShop: Supabase credentials not configured!');
    console.error('📝 Edit supabase-config.js and add your Project URL and Anon Key');
    console.error('🔗 Find them at: Supabase Dashboard > Settings > API');
    return;
  }

  // ============================================
  // INITIALIZE SUPABASE CLIENT
  // ============================================
  
  if (typeof window.supabase === 'undefined') {
    console.error('❌ Supabase JS library not loaded. Include it before this script.');
    return;
  }

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Auto-refresh tokens
      autoRefreshToken: true,
      // Persist session in localStorage
      persistSession: true,
      // Detect session from URL (for email verification links)
      detectSessionInUrl: true,
      // Storage key prefix
      storageKey: 'qs_supabase_auth',
      // Flow type for authentication
      flowType: 'pkce'
    },
    // Real-time subscriptions (optional, can be disabled for performance)
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    },
    // Global headers (optional)
    global: {
      headers: {
        'x-application-name': 'QuickShop'
      }
    }
  });

  // ============================================
  // EXPOSE TO GLOBAL SCOPE (for app.js and indexeddb_sync.js)
  // ============================================
  
  window.__QS_SUPABASE = {
    client: supabaseClient,
    url: SUPABASE_URL,
    user: null // Will be populated by auth state listener in app.js
  };

  // Initialisation confirmed — URL not logged to avoid info disclosure in production

  // ============================================
  // HELPER: Check if user is authenticated
  // ============================================
  
  window.__QS_SUPABASE.isAuthenticated = async function() {
    try {
      // getUser() verifies the JWT with Supabase servers — getSession() only reads
      // localStorage and can return true for revoked sessions. Use getUser() here.
      const { data: { user }, error } = await supabaseClient.auth.getUser();
      if (error) throw error;
      return !!user;
    } catch (e) {
      console.error('Auth check failed:', e);
      return false;
    }
  };

  // ============================================
  // HELPER: Get current user
  // ============================================
  
  window.__QS_SUPABASE.getCurrentUser = async function() {
    try {
      const { data: { user }, error } = await supabaseClient.auth.getUser();
      if (error) throw error;
      return user;
    } catch (e) {
      console.error('Get user failed:', e);
      return null;
    }
  };

  // Freeze after all helpers are attached.  Prevents any later script
  // (including a compromised CDN) from swapping client or user references.
  // NOTE: Object.freeze is shallow — nested objects (client, etc.) are not
  // frozen, but replacing the top-level reference is now impossible.
  Object.freeze(window.__QS_SUPABASE);

  // ============================================
  // DEBUG MODE: Log auth state changes (disable in production)
  // ============================================
  
  const DEBUG_MODE = false; // Set to true for debugging
  
  if (DEBUG_MODE) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log('🔐 Auth event:', event);
      console.log('👤 Session:', session ? 'Active' : 'None');
      if (session && session.user) {
        console.log('📧 User email:', session.user.email);
        console.log('✅ Email verified:', !!session.user.email_confirmed_at);
      }
    });
  }

})();