#!/bin/sh
# Creates the git-linked Vercel project (once). Prints only non-secret fields.
set -e
node /src/tools/vercel_project.js > /tmp/project.json
vercel api /v11/projects -X POST --input /tmp/project.json --raw > /tmp/created.json 2>/tmp/err.txt || true
rm -f /tmp/project.json
node -e '
const p = JSON.parse(require("fs").readFileSync("/tmp/created.json", "utf8") || "{}");
console.log(JSON.stringify({ id: p.id, name: p.name, root: p.rootDirectory, framework: p.framework,
  link: p.link && { type: p.link.type, org: p.link.org, repo: p.link.repo, branch: p.link.productionBranch },
  env: (p.env || []).map(e => e.key), error: p.error }));
' || cat /tmp/err.txt
