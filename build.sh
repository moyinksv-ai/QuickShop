#!/bin/bash
# build.sh — QuickShop Vercel build script
#
# Called by vercel.json buildCommand: "bash build.sh"
# Copies the committed template and injects all three credentials via sed.
#
# VERCEL ENVIRONMENT VARIABLES REQUIRED:
#   SUPABASE_URL       → Supabase Dashboard > Settings > API > Project URL
#   SUPABASE_ANON_KEY  → Supabase Dashboard > Settings > API > anon/public key
#   GEMINI_API_KEY     → https://aistudio.google.com/app/apikey (free, no card)

set -e  # exit immediately on any error

echo "[build] Copying config template..."
cp supabase-config.example.js supabase-config.js

echo "[build] Injecting SUPABASE_URL..."
sed -i "s|%%SUPABASE_URL%%|${SUPABASE_URL}|g" supabase-config.js

echo "[build] Injecting SUPABASE_ANON_KEY..."
sed -i "s|%%SUPABASE_ANON_KEY%%|${SUPABASE_ANON_KEY}|g" supabase-config.js

echo "[build] Injecting GEMINI_API_KEY..."
sed -i "s|%%GEMINI_API_KEY%%|${GEMINI_API_KEY}|g" supabase-config.js

echo "[build] Done."
