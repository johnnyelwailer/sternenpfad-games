#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-johnnyelwailer/sternenpfad-games}"
ref="${1:-main}"

npm run build:pages
gh workflow run deploy-pages.yml --repo "$repo" --ref "$ref"
echo "GitHub Pages deployment requested for $repo@$ref"
