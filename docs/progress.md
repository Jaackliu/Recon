# Progress

## 2026-05-09
- Current focus: implement backend processor for UI data marts.
- Decisions:
  - Daily calendar ends at last transaction date (per account; total uses global last date).
  - Monthly outflow may be negative.
  - Include accounts even if they have no transactions.
  - Logs write to data/logs.

## 2026-05-10
- Current focus: build frontend dashboard and transactions view.
- Plan:
  - Create src/frontend with index, styles, and app logic.
  - Implement layout per docs/frontend.md and draft.png.
  - Bind data from data/ui and data/database JSON files.
  - Implement time range, account, sort, and filter interactions.
  - Apply Airbnb-inspired visual system (Rausch accent, soft radii, single shadow tier).
- Status:
  - Frontend scaffold and data bindings completed.
  - UI sizing and chart axis/legend tweaks applied.
  - Processor extends per-account series to global end date for total asset ffill.

## 2026-05-10 (parser)
- Current focus: implement parser.py for PDF transaction extraction.
- Created `src/backend/prompts/parse_transactions.txt` — AI prompt template with account injection.
- Created `src/backend/parser.py` — full pipeline:
  - PDF → image rendering via PyMuPDF (`get_pixmap` at 200 DPI)
  - Multimodal API call to mimo-v2.5 via Anthropic SDK (Mimo proxy)
  - JSON response parsing with markdown fence stripping
  - Transaction ID generation (`TX-{code}-{YYYYMMDD}-{seq}`)
  - Deduplication: drop new txns whose (account_code, date) already exist
  - Refund detection: same-account amount match (decimal 60d / integer>5 30d) → type_code 3
  - Internal transfer detection: cross-account 3-day window, 97% amount tolerance → type_code 4
  - Auto-runs processor.py after writing transactions.json
- Test run results:
  - 3 PDFs processed (2 for account 001, 1 for account 002)
  - 219 transactions extracted (176 for 001, 43 for 002)
  - 8 refund pairs detected (16 txns set to type_code 3)
  - 0 internal transfers detected (expected — single-account statements)
  - UI data marts regenerated successfully

## Plan

- [x] Implement src/backend/processor.py to generate UI JSON files.
- [x] Create data/ui output directory.
- [x] Implement src/backend/parser.py for PDF parsing and transaction extraction.
- [x] Validate outputs using real bank statement PDFs.

## Notes
- Processor implementation complete; ready to run against sample data.
- Parser implementation complete; processes PDFs via multimodal AI API.
