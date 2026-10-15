# CPU Spike Results (measured 2026-10-15)

Phase 0 exit criterion: every step fits the CPU budget on a **medium** PR
(~25 files, ~1,500 changed lines), or a mitigation is chosen and recorded.

## Method

- Benchmarks ran on the **deployed dev Worker**
  (`pr-review-agent-dev`, version `c60b420c`), not local `wrangler dev`.
- Each step is a separate route, so each request invocation isolates one
  step's cost. CPU time per invocation was read from `wrangler tail
  --env dev --format json` (`cpuTime` field, ms).
- 30 samples per step/size; the first 3 (cold isolate) are discarded.
- Inputs are synthetic PR-files payloads in `spikes/fixtures/pr-files.ts`,
  shaped like `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`:
  small = 5 files/200 lines (~11 KB), medium = 25 files/1,500 lines
  (~85 KB), large = 100 files/10,000 lines (~556 KB).
- Decision rule: a step passes on medium at ≤ **7 ms**.

## Results (CPU ms, warm samples)

| Step (per invocation) | small p50 / max | medium p50 / max | large p50 / max | ≤7 ms on medium? |
|---|---|---|---|---|
| HMAC verify ×10 (1.5 KB body) | — | 0 / 0 | — | PASS |
| RS256 JWT sign | — | 1 / 2 | — | PASS |
| `JSON.parse` PR files | 0 / 0 | 0 / 2 | 1 / 2 | PASS |
| Hunk parse + line map (incl. parse) | 0 / 1 | 0 / 8 | 2 / 4 | PASS (one 8 ms outlier; p90 = 1) |
| Chunking (incl. parse + hunk) | 0 / 0 | 2 / 2 | 7 / 12 | PASS on medium |
| Queue `send` | — | 1 / 1 | — | PASS |
| D1 `INSERT` (deliveries) | — | 0 / 1 | — | PASS |
| Durable Object round trip | — | 0 / 1 | — | PASS |
| Zod validation (100 parses of a 15-finding chunk) | — | 3 / 9 | — | PASS |

Derived step-only costs on large: hunk parsing ≈ 1 ms, chunking ≈ 5 ms.
Workers CPU is reported at 1 ms granularity, so sub-millisecond steps
read as 0.

## Decision

**The Worker-only design survives: every step is within budget on a
medium PR.** Outcome of the four riskiest steps:

1. Webhook path (HMAC + D1 insert + enqueue): ~2 ms total — the webhook
   handler can do admission control, dedupe and enqueue inline.
2. Plan step (parse + hunk + chunk on medium): ~2 ms — but on a **large
   PR (100 files, 10k lines)** the chunk step reaches p50 7 ms / p90 10
   ms / max 12 ms, which would break the 10 ms invocation limit on its
   own. The design's `max_files` cap (default 40) is confirmed necessary,
   not optional.
3. Chunk step (Zod + post-processing): ~3 ms for 100 parses; one parse is
   ~0.03 ms — validation is cheap.
4. Auth (JWT) and DO round trips: ~1 ms — negligible.

## Caveats and follow-ups

- **First-invocation (cold) cost** is not included: the discarded warm-up
  samples are where module init and the Zod first-parse live. Treat the
  webhook's cold start as the risk to watch when the real handler lands;
  the numbers above are steady-state.
- **Chunker is O(n²) per chunk**: the benchmark chunker re-encodes the
  accumulated patch for every file (`TextEncoder.encode` in the size
  check). That is most of the 5 ms large-PR cost. The Phase 2 chunker
  should count bytes incrementally instead.
- **Queue sends and D1 inserts consumed real quota** during this run
  (~30 queue messages ≈ 90 ops, 30 D1 writes) — negligible against the
  10k ops/day and 100k writes/day free caps.

## Reproduce

See `spikes/README.md`. Bench routes live in `spikes/worker-bench.ts`;
wire them temporarily into `src/index.ts` (`app.route('/bench', benchApp)`),
deploy to dev, run `npx wrangler tail --env dev --format json > tail.jsonl`
while hitting `https://pr-review-agent-dev.<subdomain>.workers.dev/bench/<step>`,
then remove the mount again.
