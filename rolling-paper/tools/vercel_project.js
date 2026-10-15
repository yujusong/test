// Builds the Vercel project-creation body from /src/.env without printing secrets.
// Usage (tools container): node /src/tools/vercel_project.js > /tmp/project.json
const fs = require('fs');

const env = Object.fromEntries(fs.readFileSync('/src/.env', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Supabase values missing in .env');

process.stdout.write(JSON.stringify({
  name: 'rolling-paper',
  framework: null,
  rootDirectory: 'rolling-paper/cloud',
  gitRepository: { type: 'github', repo: 'yujusong/test' },
  environmentVariables: [
    { key: 'RP_SUPABASE_URL', value: env.SUPABASE_URL, target: ['production', 'preview'], type: 'plain' },
    { key: 'RP_SUPABASE_KEY', value: env.SUPABASE_PUBLISHABLE_KEY, target: ['production', 'preview'], type: 'encrypted' },
  ],
}));
