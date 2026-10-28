# QuickShop Regression Check — 2026-10-28

## Release decision

**Hold merge to `main` until the release-blocking checks below are completed.** The feature branch is 114 commits ahead of `main` and changes authentication/session routing, signup, referral attribution, admin UI/API, payout flows, database grants, and Vercel routing. A passing source-pattern suite and a READY preview are not enough evidence to safely merge this entire accumulated diff into production.

## Baseline and rollback safety

- Production baseline branch: `main`
- Baseline SHA observed during this review: `fd20d2f5352b96b4282680a032decb116ecc0e23`
- Feature branch: `feat/integrated-referrals-otp`
- Feature branch comparison: 114 commits ahead, 0 behind at review time.
- No merge, push to `main`, or production deployment was performed during this check.
- Before any eventual merge, create a durable backup branch pointing to the then-current `main` SHA (for example `backup/main-before-quickshop-release-2026-10-28`) and record the merge commit SHA. A rollback should revert the merge commit or redeploy the backup SHA; do not reset or force-push `main`.

## Checks confirmed from repository/CI metadata

- The regression-guard workflow is configured to run `node --test tests/regression-guards.test.js` on pushes and pull requests using Node.js 20.
- GitHub Actions run #122 for commit `15cd711ad9fe68da566f099b803ca8c162d49a7f` reported **success**.
- The most recent Vercel deployment returned by the branch deployment list was **READY** for feature commit `bf03a9832549e987afc975998a51074c1d38ac18` (preview URL: https://quickshopper-rn90oxarc-moyinks-projects-5a3815db.vercel.app/).
- The user manually confirmed the landing/auth fix worked, and confirmed the Browse Market button beside the hero CTA is visible and working.
- Static regression guards cover landing/auth visibility, delegated Home and sign-out behavior, cold-start routing, signup duplicate-submission and already-verified-email response guards, top Marketplace visibility, admin vendor filtering, admin API response behavior under payment-claim success/failure, and referral payout request protections.

## Last-pass risk review

### Landing, auth, and signup

- Keep the CSS invariant that landing and auth screens cannot be displayed simultaneously.
- Keep one canonical Home-to-landing transition and delegated handling for nested Home button targets.
- Treat an unauthenticated `INITIAL_SESSION` separately from explicit sign-out; preserve pending verification/reset restoration.
- Signup UI is a `div`, not a native form. Click and Enter must call the same guarded handler; validation must happen before the in-flight lock.
- Empty Supabase `user.identities`, `email_confirmed_at`, and `confirmed_at` responses are guarded to avoid showing a new-account/OTP-success state for an existing verified email. This is a client-side response guard; it does not prove that Supabase never attempts email delivery under every project configuration.

### Marketplace navigation

- Preserve the top `Market →` link targeting `search.html`; do not hide it at narrow widths or add a duplicate.
- The user confirms the Browse Market CTA next to the hero CTA is visible and works.
- Automated source assertions check for visibility/layout rules, but an actual 360–390 CSS-pixel visual check and desktop check still need to be recorded against the newest preview.

### Admin/API, payouts, and RLS

- The branch contains meaningful changes to `admin.html`, `api/admin.js`, payout workflows, and the referral payout read-grant migration.
- Automated tests exercise mocked vendor/claim responses and assert some payout transition guards. They do not establish that production Supabase RLS, live grants, admin credentials, concurrent payout requests, and actual paid-state transitions all work together.
- Before release, verify admin access with a valid token and rejection without/with an invalid token; verify the service-role key never reaches the browser; exercise payout detail requests and mark-paid against safe test data; confirm audit logging and idempotency under retry; verify referral payout RLS/grants against the actual target database.
- Never test a real payout or create production test accounts without explicit safe test instructions.

### Referral attribution and OTP persistence

- The feature includes persistent referral capture, short referral URLs, attribution after verified authentication, and pending OTP/reset state restoration.
- CI/source checks do not replace a controlled end-to-end test for new email signup → verification → reload/resume → attribution, existing verified email signup, invalid/self referral, and password reset/reload.
- The preview is configured around the production Supabase project according to prior project notes; avoid creating test accounts or modifying live referral data without a deliberate test plan.

### Routing and deployment

- Review the changed `vercel.json` redirects/rewrites and confirm preview routes do not unexpectedly canonicalize users to the production domain.
- Confirm latest preview routes and assets return expected responses; verify console/network behavior in a real browser.
- No production deploy or main-branch mutation is authorized until the checks above are completed.

## Required release gate

- [ ] Re-run CI on the exact final feature commit and verify it is green.
- [ ] Open latest preview on narrow mobile and desktop; test landing refresh, Sign In, Sign Up, Home, verified-email duplicate signup, sign-in, sign-out, verification/reset restoration, Marketplace top link, and Browse Market CTA.
- [ ] Check browser console/network for new errors.
- [ ] Complete safe admin authorization and payout/RLS smoke tests.
- [ ] Complete controlled referral attribution test without accidentally writing unwanted production data.
- [ ] Recompare exact final feature HEAD to current `main` and review all changed files.
- [ ] Create backup branch from current `main` and record its SHA before merging.
- [ ] Merge only if all applicable checks pass; record merge SHA and deployment URL. If any check is unavailable or fails, keep the branch unmerged and report the blocker.

**Status:** Automated source-level checks have passed on a prior commit and the latest preview deployment is READY. Browser-level, live admin/payout/RLS, and controlled end-to-end signup/referral checks are not fully evidenced here. Therefore this is not yet a clean release sign-off.
