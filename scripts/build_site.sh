#!/usr/bin/env bash
# Assemble the deployable static site into _site/ (used by CI and local dev).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site/data
cp -r site/. _site/
cp data/latest.json _site/data/
echo "_site ready: $(du -sh _site | cut -f1)"
