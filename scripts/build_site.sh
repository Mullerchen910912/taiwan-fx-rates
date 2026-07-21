#!/usr/bin/env bash
# Assemble the deployable static site into _site/ (used by CI and local dev).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/data
cp -r site/. _site/
cp data/latest.json _site/data/
[ -f data/promos.json ] && cp data/promos.json _site/data/  # optional curated overlay

# Cache-bust app.js/style.css with a content hash so returning visitors always
# run the deployed JS/CSS instead of a stale cached copy.
VER=$(cat site/app.js site/style.css | shasum | cut -c1-8)
sed -i '' -e "s|href=\"style.css\"|href=\"style.css?v=$VER\"|" \
          -e "s|src=\"app.js\"|src=\"app.js?v=$VER\"|" _site/index.html

echo "_site ready: $(du -sh _site | cut -f1) (asset v=$VER)"
