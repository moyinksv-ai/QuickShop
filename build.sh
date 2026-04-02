#!/bin/bash
# build.sh — QuickShop Vercel build script
#
# Called by vercel.json buildCommand: "bash build.sh"
# Copies the committed template and injects all three credentials via sed.
#
# VERCEL ENVIRONMENT VARIABLES REQUIRED:
#   SUPABASE_URL       → Supabase Dashboard > Settings > API > Project URL
#   SUPABASE_ANON_KEY  → Supabase Dashboard > Settings > API > anon/public key
#
# VERCEL ENVIRONMENT VARIABLES OPTIONAL:
#   GEMINI_API_KEY     → https://aistudio.google.com/app/apikey (free, no card)
#                        If absent, the "Ask AI" button is hidden in the app.
#                        The build still succeeds without it.

set -e          # exit immediately on any command error
set -u          # treat unset variables as errors — catches missing required vars
set -o pipefail # a pipe fails if any command in it fails

# ── Required variable guard ───────────────────────────────────────────────────
# set -u handles unset, but gives an ugly "unbound variable" message.
# Check explicitly so the error output is actionable for the developer.
if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "[build] ERROR: SUPABASE_URL is not set or is empty." >&2
  echo "[build]        Add it in Vercel: Project Settings → Environment Variables" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ANON_KEY:-}" ]]; then
  echo "[build] ERROR: SUPABASE_ANON_KEY is not set or is empty." >&2
  echo "[build]        Add it in Vercel: Project Settings → Environment Variables" >&2
  exit 1
fi

# ── sed delimiter safety check ────────────────────────────────────────────────
# The sed substitution uses | as a delimiter. If any value contains a literal |
# the substitution will break. Reject early with a clear message.
if [[ "${SUPABASE_URL}" == *"|"* ]]; then
  echo "[build] ERROR: SUPABASE_URL contains a pipe character, which is incompatible with the sed delimiter." >&2
  exit 1
fi

if [[ "${SUPABASE_ANON_KEY}" == *"|"* ]]; then
  echo "[build] ERROR: SUPABASE_ANON_KEY contains a pipe character, which is incompatible with the sed delimiter." >&2
  exit 1
fi

if [[ -n "${GEMINI_API_KEY:-}" && "${GEMINI_API_KEY}" == *"|"* ]]; then
  echo "[build] ERROR: GEMINI_API_KEY contains a pipe character, which is incompatible with the sed delimiter." >&2
  exit 1
fi

# ── Copy template ─────────────────────────────────────────────────────────────
echo "[build] Copying config template..."
cp supabase-config.example.js supabase-config.js

# ── Inject required credentials ───────────────────────────────────────────────
echo "[build] Injecting SUPABASE_URL..."
sed -i "s|%%SUPABASE_URL%%|${SUPABASE_URL}|g" supabase-config.js

echo "[build] Injecting SUPABASE_ANON_KEY..."
sed -i "s|%%SUPABASE_ANON_KEY%%|${SUPABASE_ANON_KEY}|g" supabase-config.js

# ── Inject optional GEMINI_API_KEY ────────────────────────────────────────────
# If absent, the placeholder is replaced with an empty string. The template
# already handles this: window.__QS_GEMINI_KEY is set to null when the value
# is empty or still contains %%, which hides the "Ask AI" button gracefully.
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  echo "[build] Injecting GEMINI_API_KEY..."
  sed -i "s|%%GEMINI_API_KEY%%|${GEMINI_API_KEY}|g" supabase-config.js
else
  echo "[build] GEMINI_API_KEY not set — AI insights will be disabled in the app."
  sed -i "s|%%GEMINI_API_KEY%%||g" supabase-config.js
fi

# ── Verification ──────────────────────────────────────────────────────────────
# Match only %%PLACEHOLDER%% patterns (uppercase + underscores between %%).
# This avoids false positives from literal '%%' strings in JS validation code.
if grep -qE '%%[A-Z_]+%%' supabase-config.js; then
  echo "[build] ERROR: supabase-config.js still contains unreplaced placeholders:" >&2
  grep -nE '%%[A-Z_]+%%' supabase-config.js >&2
  exit 1
fi

echo "[build] Verification passed — no unreplaced placeholders."
echo "[build] Done."
