#!/bin/sh
# Runs inside the tools container: copies an allowlisted snapshot of /src into
# the GitHub repo clone and pushes it. Secrets (.env, *.local.sql) never leave the PC.
set -e
MSG="${1:-Update rolling paper}"
cd /work
[ -d test/.git ] || gh repo clone yujusong/test test
gh auth setup-git
cd test
git pull --ff-only -q origin main
rm -rf rolling-paper
mkdir rolling-paper
cd /src
tar -cf - --exclude=.env --exclude='*.local.sql' --exclude=artifacts --exclude=__pycache__ --exclude=.vercel . \
  | tar -xf - -C /work/test/rolling-paper
cd /work/test
if git ls-files --others --cached rolling-paper | grep -E '(^|/)\.env$|\.local\.sql$'; then
  echo 'Refusing to publish secrets' >&2
  exit 1
fi
git add -A rolling-paper
if git diff --cached --quiet; then
  echo 'Nothing to publish.'
else
  git -c user.name=YujuSong -c user.email=yuju.song35@gmail.com commit -q -m "$MSG"
  git push -q origin HEAD:main
  echo "Pushed $(git rev-parse --short HEAD)"
fi
git show --stat --oneline -1 | head -40
