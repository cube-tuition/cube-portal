#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "→ Cleaning up git lock files..."
rm -f .git/HEAD.lock .git/ORIG_HEAD.lock .git/index.lock
rm -rf .git-rewrite

echo "→ Soft-resetting last 2 commits..."
git reset HEAD~2

echo "→ Re-staging everything except tmp/..."
git add --all
git reset HEAD tmp/ 2>/dev/null || true

echo "→ Committing clean..."
git commit -m "tutor booklet view + remove build output from tracking"

echo "→ Pushing..."
git push

echo "✓ Done!"
