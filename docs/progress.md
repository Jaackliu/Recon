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

  ## 2026-05-11
  - Added `cashflow_direction` to transactions schema and processing contract.
  - Parser now writes `cashflow_direction` from initial `type_code`; refund/transfer detection only mutates `type_code`.
  - Processor cashflow aggregation now uses `cashflow_direction` for all inflow/outflow calculations.
  - Transactions list displays signed amounts based on `cashflow_direction`.
    - Added balance consistency checks by PDF in `check_transactions.py` with auto-removal of invalid PDF records.
    - Parser runs balance check before refund/transfer detection and reparses failing PDFs up to 3 times.
  - Frontend: added chart click interactions for C/D (auto custom range) and modal detail cards for E/F/G.
  - Frontend: detail cards support sorting by transaction ID or amount; daily detail supports type filtering.
  - Docs: updated frontend interaction specs for modules C-G.
  - Frontend: monthly/daily charts accept axisPointer line clicks for drill-down actions.
  - Frontend fix: Module D (monthly) and Module E (daily) chart click zones now cover the entire vertical strip of each x-axis category, not just the narrow bar elements. Uses `chart.getZr().on('click')` + `containPixel` + `convertFromPixel({gridIndex:0})` for reliable full-area click detection.
  - Parser: refund/transfer detection now always runs even when no new PDFs are processed.
  - Parser: `detect_refunds` and `detect_transfers` matching logic changed from `type_code` to `cashflow_direction` (2=outflow for expense, 1=inflow for income). `type_code` is only mutated as the result marker.
  - Extracted refund/transfer detection into `src/backend/detect_reclassify.py` — runnable standalone (`python detect_reclassify.py`) or importable by `parser.py`. Logs to `data/logs/detect_reclassify.log`.

## 2026-05-12
- Multi-currency schema introduced in [docs/schema.md](docs/schema.md): added `currency.json`, and switched account/transaction currency fields to currency codes.
- Created `data/database/currency.json` with CNY/USD/HKD/EUR/JPY definitions.
- Updated `data/database/accounts.json` to use currency codes and expanded supported currencies.
- Parser prompt now includes currency legend and enforces supported currency selection; default currency is not passed to AI.
- Balance checks and refund/transfer detection updated to run per PDF per currency.

## 2026-05-13
- Added `currency_iso` to `currency.json` for ISO 4217 mapping.
- Added `fx_rate.json` schema to [docs/schema.md](docs/schema.md).
- Created `src/backend/fetch_fx.py` to fetch Frankfurter rates and build full FX matrix.
- Added `settings.json` with `global_default_currency` for total-asset default display.
- Processor now outputs currency-scoped UI datasets (`default`, `default_local`, and currency codes) with FX conversion and currency filtering.
- Frontend now supports a currency selector and renders amounts using the active currency symbol.
- Fixed default-currency aggregation to sum balances and cashflow across all supported currencies per account before total-asset rollup.
- **Bug fix**: Changing the default currency in settings now correctly converts all amounts using FX rates, not just the display symbol. The frontend loads `fx_rate.json` and applies runtime conversion to the `"default"` dataset when the user's selected currency differs from the processor's `global_default_currency` (written as `_meta.processor_default_currency` in UI JSON files). Also fixed currency breakdown display to use each currency's native symbol.
- **Bug fix 2**: Fixed two issues in the FX conversion: (1) the conversion cache used a single global key that didn't distinguish between different collections (dailySeries/staticCharts/transactions), causing modules C-G to show wrong data; replaced with per-collection WeakMap cache. (2) `convertItem` didn't recursively convert nested arrays/objects (e.g., `heatmap[].net_inflow`, `monthly_combo[].end_balance`); replaced with `convertValue` that recursively traverses all nested structures.

## 2026-05-14
- Moved `accounts.json` and `currency.json` from `data/database/` to `data/config/` to separate hand-maintained config files from generated data files.
- Updated all code path references: `parser.py`, `fetch_fx.py`, `processor.py`, `app.js`.
- Updated documentation references in `schema.md`, `process.md`, `frontend.md`.
- Updated `.claude/settings.local.json` permission allowlists.

## Plan

- [x] Implement src/backend/processor.py to generate UI JSON files.
- [x] Create data/ui output directory.
- [x] Implement src/backend/parser.py for PDF parsing and transaction extraction.
- [x] Validate outputs using real bank statement PDFs.

## Notes
- Processor implementation complete; ready to run against sample data.
- Parser implementation complete; processes PDFs via multimodal AI API.
