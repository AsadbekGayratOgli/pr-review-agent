# Phase 0 Spikes

Throwaway verification code. Not shipped with the Worker: these scripts run under
plain Node (Node >= 22.6 with type stripping), not in the Workers runtime.

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
