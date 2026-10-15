# Phase 0 Spikes

Throwaway verification code. Not shipped with the Worker: these scripts run under
plain Node (Node >= 22.6 with type stripping), not in the Workers runtime.

## worker-bench.ts — CPU benchmarks

One route per step, so each request invocation isolates a step's CPU cost. Steps:
`hmac`, `jwt`, `parse`, `hunk`, `chunk` (each with `?size=small|medium|large`),
`queue`, `d1`, `do`, `zod`.

To measure (bench code is intentionally NOT wired into `src/index.ts`):

```bash
# 1. temporarily mount it
#    in src/index.ts:  import benchApp from '../spikes/worker-bench';
#                      app.route('/bench', benchApp);
# 2. deploy and capture CPU per invocation from tail
npx wrangler deploy --env dev
npx wrangler tail --env dev --format json > C:/Temp/kilo/tail.jsonl   # keep running
for i in $(seq 30); do curl -s -o /dev/null https://pr-review-agent-dev.<subdomain>.workers.dev/bench/hunk?size=medium; done
# 3. remove the mount from src/index.ts and redeploy
```

Each tail event's `cpuTime` field (ms) is that invocation's CPU. Results are
recorded in `docs/spike-results.md`.

Note: `wrangler tail` redirected via PowerShell `>` is UTF-16; decode before
parsing (the run used a UTF-16 → UTF-8 conversion step).

## auth-smoke.ts

Proves the GitHub App auth chain end to end: PKCS#8 key → RS256 JWT → installation
token → (optionally) PR files.

```bash
# Required: a registered GitHub App (dev) with its PKCS#8 PEM and numeric App ID
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY_FILE="/path/to/github-app-key-pkcs8.pem"

# Optional: also fetch a real PR's file list
export GITHUB_TEST_REPO="owner/repo"
export GITHUB_TEST_PR="1"

node spikes/auth-smoke.ts
```

Exit code 0 prints `SMOKE TEST OK`. Any failure prints the failing step, the HTTP
status and the response body.

Last local verification (2026-10-15): JWT signing and the GitHub API request path
were exercised with a throwaway key; GitHub correctly rejected it with 401, proving
signing and error surfacing work. The real run still requires the dev App
credentials (GITHUB_APP_ID, PKCS#8 key, an installed repo,
GITHUB_TEST_REPO/GITHUB_TEST_PR) — that completes Phase 0 exit criterion 4.
