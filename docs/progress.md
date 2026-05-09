# Progress

## 2026-05-09
- Current focus: implement backend processor for UI data marts.
- Decisions:
  - Daily calendar ends at last transaction date (per account; total uses global last date).
  - Monthly outflow may be negative.
  - Include accounts even if they have no transactions.
  - Logs write to data/logs.

## Plan
- [x] Implement src/backend/processor.py to generate UI JSON files.
- [x] Create data/ui output directory.
- [ ] Validate outputs using sample data in data/database.

## Notes
- Processor implementation complete; ready to run against sample data.
