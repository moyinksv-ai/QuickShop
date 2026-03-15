#!/bin/bash
set -e
cp supabase-config.example.js supabase-config.js
sed -i "s|%%SUPABASE_URL%%|${SUPABASE_URL}|g" supabase-config.js
sed -i "s|%%SUPABASE_ANON_KEY%%|${SUPABASE_ANON_KEY}|g" supabase-config.js
echo "Build done."
