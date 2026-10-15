# Cloudflare Free-Tier Limits (verified 2026-10-15)

All values below were read from official Cloudflare docs on 2026-10-15. Free-plan
limits change; re-verify before relying on a number for a design decision.

## Workers

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Requests | 100,000 / day | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Not the bottleneck |
| CPU per invocation | 10 ms | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | The binding constraint; spike threshold is 7 ms/step |
| CPU per Cron trigger | 10 ms | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Reconciler must stay trivial |
| Subrequests per invocation | 50 external / 1,000 to Cloudflare services | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | GitHub + LLM calls share the 50 external cap; D1/KV/DO calls do not. Fan-out per chunk is what keeps us under it |
| Memory | 128 MB | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Patches live in one message at a time |
| Env vars | 64 / Worker, 5 KB each | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Secrets count against this; fine for our count |
| Worker size | 64 MiB | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Plenty |
| Workers per account | 100 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Fine |
| Cron triggers | 5 per account | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Plan uses 2–3 (reconciler, redelivery, feedback) |

## Queues

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Available on free plan | Yes (since 2026-02-04) | [Changelog](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/) | Design holds on free |
| Standard operations | 10,000 / day | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) | ~3 ops per delivered message ⇒ ~3k messages/day ⇒ several hundred reviews/day |
| Message retention | 24 h, non-configurable | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) | Requeue delays must stay well under 24 h; capacity waits >30 min post a "skipped" note instead |
| Message size | 128 KB, ~100 B internal metadata | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | Each 64 KB chunk bills one op; the 60 KB chunk cap keeps 1 op/message |
| Max retries | 100 | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | Plan uses max_retries = 3 then DLQ |
| Batch size | 100 messages max | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | Config uses 10 |
| `delaySeconds` | Up to 24 h | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | Enough for retry-after backoff, but retention caps effective delay |
| Consumer CPU | Configurable to 5 min (wall clock 15 min) | [Queues limits](https://developers.cloudflare.com/queues/platform/limits/) | Queue consumers are NOT held to the 10 ms HTTP CPU limit — heavy work belongs in the consumer, not the webhook |

## Durable Objects

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Requests | 100,000 / day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | QuotaLedger + ReviewRun DOs fit |
| Duration | 13,000 GB-s / day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Single global ledger instance fits easily |
| Storage backend | SQLite only on free | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | `new_sqlite_classes` migration is the only option — as configured |
| SQLite rows read | 5M / day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Reservation/commit ledger is small per run |
| SQLite rows written | 100k / day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Delete per-run DO state at the end of a run |
| SQLite stored data | 5 GB total | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Transient run data only |

## D1

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Rows read | 5M / day | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Dedupe + run metadata fit |
| Rows written | 100k / day | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Fine; indexes keep scans cheap |
| Storage | 5 GB account total | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Metadata + fingerprints only — no source at rest |
| Databases per account | 10 (free) | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | We use one per environment (dev/prod) |
| Max database size | 500 MB | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | Fine |
| Queries per Worker invocation | 50 (free) | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | Keep webhook path to a single dedupe insert |

## Workers KV

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Reads | 100,000 / day | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) | Read-heavy cache is the only sanctioned use |
| Writes | 1,000 / day | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) | No counters, no frequent writes — matches design |
| Storage | 1 GB | [KV limits](https://developers.cloudflare.com/kv/platform/limits/) | Config cache only |

## Workers Logs

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Log events | 200,000 / day | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Plenty for our volume |
| Retention | 3 days (free) | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | **CPU spike results must be read within 3 days**; use `wrangler tail` during the benchmark run |
| Max log size | 256 KB | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Never log patch content |

## Cloudflare Access (Zero Trust)

| Limit | Free value | Source | Design consequence |
|---|---|---|---|
| Users | 50 | [Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/) | Enough for the `/admin/*` gate |

## Design check

Nothing above contradicts `build-plan.md`. The closest calls:

- **CPU (10 ms/invocation):** still the main risk. The plan's 7 ms threshold stands.
- **Queues consumers get 5 min CPU**, not 10 ms — the plan/chunk/publish work correctly belongs in queue consumers, not the webhook handler.
- **Queues retention is a fixed 24 h on free** — requeue-based retry must respect it; long capacity waits should end in a "skipped" note, as the plan states.
- **Workers Logs retention is 3 days on free** (plan did not specify); record spike results in `docs/spike-results.md` the same day they are measured.

## Watch items

- Queues moved onto the free plan in Feb 2026; limits could tighten again.
- Workers Logs moves to Observability pricing on 2026-12-01 (free: 0.5 GB/day ingestion, 7-day retention).
- D1 free-tier daily limits are enforced since 2026-09-01 (queries fail after the cap, resets 00:00 UTC).
