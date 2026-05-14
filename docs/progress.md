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

## 2026-05-14 (交易显示优化)
- 前端交易显示优化：
  - 删除交易ID的显示
  - 添加账户别名（alias）显示（替代原 account_number）
  - 添加帐户余额（balance）显示
  - 收支类别放大到和交易类型一样大小（使用 `.tag.category` 样式）
  - 所有列居中对齐（第一列描述保持左对齐）
- 后端 processor.py 修改：
  - `serialize_transaction` 函数添加 `alias`、`balance`、`account_code`、`account_number`、`type_code`、`currency`、`raw_text`、`processed_at`、`source_hash` 字段
  - `build_transactions_output` 和 `build_dataset` 函数接收 `accounts_by_code` 参数
- 前端样式修改：
  - 更新交易列表和详情列表网格布局为6列
  - 添加 `.tag.category`、`.transaction-balance`、`.detail-account`、`.detail-balance` 样式
- 文档更新：
  - 更新 `docs/process.md` 中的 JSON schema 和示例
  - 更新 `docs/frontend.md` 中的展示字段和交互说明

## 2026-05-14 (AI API Prompt 清理与字段重命名)
- `currency.json` 字段重命名：`currency_name` → `alias`，与 `accounts.json` 的 `alias` 语义对齐（均为前端展示别名）。
- AI API Prompt 精简：
  - `accounts.json`：不再传入 `alias`（仅前端使用，AI 无需知晓）。
  - `currency.json`：不再传入 `alias`（仅前端使用，AI 无需知晓）。
- 代码更新：`parser.py`（prompt 构建）、`fetch_fx.py`（字段读取）、`app.js`（4 处 `currency_name` → `alias`）。
- 文档更新：`schema.md`、`frontend.md` 同步字段名变更。
- `fx_rate.json` 需重新生成（`fetch_fx.py` 输出的 currencies 数组字段已变更）。

## 2026-05-14 (Transaction Hover Tooltip)
- 前端：所有 transaction 行（交易列表页 + 详情弹窗）hover 高亮，光标旁浮窗显示 `transactions.json` 全部字段
  - 事件委托绑定在 `#transactionsList` 和 `#detailList` 容器上
  - 浮窗 `#txTooltip` 跟随鼠标定位，自动避让视口边缘
- 后端：`serialize_transaction` 追加 `account_code`、`account_number`、`type_code`、`currency`、`raw_text`、`processed_at`、`source_hash`
- 样式：`.transaction-row:hover` / `.detail-row:hover` 高亮 + `#txTooltip` 浮窗
- 文档：更新 `process.md` schema、`frontend.md` 各模块交互说明

## 2026-05-14 (多语言支持 i18n)
- 新增 `src/frontend/multi-lang.json`：包含 zh/en/fr 三种语言的完整翻译字典
- 前端 i18n 系统：
  - `app.js` 新增 `t()`、`getAlias()`、`translateCategory()`、`untranslateCategory()`、`getDirectionLabel()` 辅助函数
  - 所有 UI 文本通过 `data-i18n` 属性标记，语言切换时即时更新
  - Settings 弹窗新增语言选择器（中文/English/Français）
  - 语言设置保存到 `localStorage` 的 `language` 键，默认 `"zh"`
  - 桑基图、甜甜圈图等图表的标签和类别名称支持翻译
  - Tooltip 字段标签支持翻译
  - 日历热力图月份名称跟随语言设置
- 后端类别迁移：
  - `parse_transactions.txt`：类别枚举从中文改为英文（Food, Transportation 等）
  - `parser.py`：默认类别从 `"其他"` 改为 `"Other"`
  - `detect_reclassify.py`：手续费交易类别从 `"其他"` 改为 `"Other"`
  - 新增 `migrate_categories.py`：一次性迁移脚本，将 transactions.json 中的中文类别转为英文
- 配置文件多语言别名：
  - `accounts.json`：`alias` 从字符串改为 `{zh, en, fr}` 对象
  - `currency.json`：`alias` 从字符串改为 `{zh, en, fr}` 对象
  - `fetch_fx.py`：适配对象格式的 alias（直接传递）
  - `processor.py`：alias 对象直接传递到 UI JSON，前端通过 `getAlias()` 提取
- 样式：新增 `.language-selector`、`.language-option`、`.lang-icon` 样式，CJK 字体回退
- 文档：更新 `schema.md`（alias 类型、类别枚举）、`process.md`（JSON 示例）、`frontend.md`（语言选择器）

## 2026-05-14 (多用户支持 Multi-User)

- 新增多用户支持：每个用户拥有完全隔离的数据目录
- 后端架构：
  - 新增 `src/backend/path_config.py`：通过 `FINANCE_DATA_DIR` 环境变量解析用户数据路径
  - 所有后端脚本（parser.py, processor.py, fetch_fx.py, check_transactions.py, detect_reclassify.py, migrate_categories.py）重构为使用 `path_config` 代替硬编码路径
  - `api_server.py` 重构：合并静态文件服务，所有路由按用户隔离（`/<user_id>/...`），子进程通过环境变量传递用户数据目录
  - 每用户独立的 4:00 AM 定时刷新调度
- 前端架构：
  - 新增 `src/frontend/landing.html`：用户选择页面
  - `app.js` 从 URL 提取 `USER_ID`，数据路径改为相对路径，API 路径改为用户隔离
- 数据目录结构：
  - 新增 `users.json`：用户注册表
  - 新增 `data_users/<user_id>/`：每用户独立的 data 目录（config, database, ui, logs, raw_input）
  - 新增 `scripts/migrate_to_multiuser.sh`：数据迁移脚本
- 服务器变更：
  - 合并为单一 Flask 服务器（端口 8000），同时提供 API 和静态文件服务
  - 绑定 `0.0.0.0` 支持局域网访问
  - `load.sh` 简化为单进程启动
- 文档：更新 `progress.md`、`CLAUDE.md` 目录结构

## Plan

- [x] Implement src/backend/processor.py to generate UI JSON files.
- [x] Create data/ui output directory.
- [x] Implement src/backend/parser.py for PDF parsing and transaction extraction.
- [x] Validate outputs using real bank statement PDFs.

## Notes
- Processor implementation complete; ready to run against sample data.
- Parser implementation complete; processes PDFs via multimodal AI API.
