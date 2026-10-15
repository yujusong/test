#!/bin/sh
# Shows non-secret Vercel project settings and recent deployments.
vercel api /v9/projects/rolling-paper --raw > /tmp/p.json 2>/dev/null
vercel api "/v6/deployments?projectId=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/p.json","utf8")).id)')&limit=5" --raw > /tmp/d.json 2>/dev/null
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("/tmp/p.json", "utf8"));
const d = JSON.parse(fs.readFileSync("/tmp/d.json", "utf8"));
console.log(JSON.stringify({ id: p.id, name: p.name, root: p.rootDirectory, framework: p.framework, node: p.nodeVersion,
  link: p.link && { type: p.link.type, org: p.link.org, repo: p.link.repo, branch: p.link.productionBranch },
  env: (p.env || []).map(e => `${e.key}:${e.type}:${e.target}`),
  protection: p.ssoProtection, domains: (p.targets && p.targets.production && p.targets.production.alias) || [] }, null, 1));
for (const x of d.deployments || []) console.log(x.uid, x.state, x.target, x.url, x.meta && x.meta.githubCommitSha && x.meta.githubCommitSha.slice(0, 7), new Date(x.created).toISOString());
'
