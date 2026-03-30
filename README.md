# WTF LivePulse

## Quick Start

Run:

```bash
docker compose up
```

Prerequisite: Docker Desktop installed and running.

## Architecture Decisions

- PostgreSQL is the source of truth. Seed data is loaded automatically through `backend/src/db/migrations`.
- Partial indexes are used for active anomalies and churn-risk scans because those are selective queries with clear filtered predicates.
- BRIN on `checkins.checked_in` keeps long-range time-series scans efficient for historical analytics.
- Composite index on `(gym_id, paid_at DESC)` supports per-gym revenue reads.
- A materialized view `gym_hourly_stats` precomputes the 7-day heatmap so the dashboard does not run large `GROUP BY` queries repeatedly.
- WebSockets are used for live occupancy, payments, and anomaly updates. No polling fallback is used for real-time widgets.

## AI Tools Used

- OpenAI Codex: repo audit, backend/frontend scaffolding, schema design, Docker alignment, and cleanup.
- ChatGPT-style prompting workflow: converting the assignment and data specification into implementation tasks and review checklist items.
- AI was used heavily for speed, but schema decisions, anomaly logic mapping, and submission packaging were manually directed.

## Query Benchmarks

Benchmarks intended for reviewer verification:

- Live occupancy query
- Today's revenue query
- Churn risk query
- Heatmap materialized view query
- Cross-gym revenue query
- Active anomalies query

Add `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` screenshots into `/benchmarks` before final submission for full assignment fidelity.

## Known Limitations

- Benchmark screenshots are not yet included in `/benchmarks`.
- Test coverage is scaffolded but not yet expanded to the full assignment target.
- The frontend is intentionally lightweight and custom-built without an external charting dependency to reduce setup friction.
