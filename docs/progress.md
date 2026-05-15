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
  - Multimodal API call via Anthropic SDK (model/base_url configured in `.env`)
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

## 2026-05-14 (Parse + Auto-Refresh Pipeline)

- Parse PDF 按钮现在自动触发完整数据管线：`parser.py` → `fetch_fx.py` → `processor.py`。
- 后端 `api_server.py` 修改：
  - `_parse_watcher` 在 `parser.py` 成功后自动调用 `_do_refresh()`。
  - 管线完成后添加 `msg.parse_refresh_done` 消息。
  - 整个管线在服务器后台线程运行，不受前端页面关闭影响。
- 前端 `app.js` 修改：
  - `pollParseStatus` 检测 `msg.parse_refresh_done` 后自动刷新页面。
  - 如果解析失败（`msg.parse_error`），显示错误提示。
- 多语言：新增 `msg.parse_refresh_done` 翻译（zh/en/fr）。
- 文档：更新 `docs/process.md` 中 `processor.py` 运行方式说明。

## 2026-05-15 (Bug Fix: 模块G饼状图详情弹窗)

- **问题**：模块G（分类占比）饼状图点击扇区后，详情弹窗始终显示"暂无交易记录"。
- **根因**：甜甜圈图的 `params.name` 是翻译后的类别名称（如"食品"），但 `getDetailTransactions` 函数中比较的是英文类别键（如"Food"），导致匹配失败返回空数组。桑基图已正确使用 `untranslateCategory` 处理，但甜甜圈图遗漏了。
- **修复**：在 `bindChartInteractions` 中甜甜圈图点击事件添加 `untranslateCategory(params.name)` 转换，与桑基图保持一致。

## 2026-05-15 (模块F/G交易类型过滤优化)

- **需求**：模块F（桑基图）和模块G（甜甜圈图）点击类别时，需要基于交易类型进行精确过滤。
- **修改内容**：
  - `updateSankey()` 函数：添加过滤条件排除 `refund`(3) 和 `transfer`(4) 类型交易，这些交易不参与桑基图计算。
  - `updateCategoryPanel()` 函数：添加过滤条件排除 `refund`(3) 和 `transfer`(4) 类型交易，这些交易不参与甜甜圈图计算。
  - `getDetailTransactions()` 函数：
    - 日详情模式：排除 `refund` 和 `transfer` 类型，保留用户选择的过滤器。
    - 类别详情模式：排除 `refund` 和 `transfer` 类型，强制只保留与 `state.detail.categoryType` 匹配的交易类型（income 或 expense）。
- **效果**：
  - 桑基图点击收入类别或甜甜圈图选择收入类型时，只显示该类别的收入交易。
  - 桑基图点击支出类别或甜甜圈图选择支出类型时，只显示该类别的支出交易。
  - 退款和内部转账记录完全从模块F和G的计算和显示中排除。

## 2026-05-15 (模块F/G详情弹窗移除过滤器)

- **修改**：`openCategoryDetail()` 函数中移除交易类型过滤器显示（`dom.detailFilters.style.display = "none"`）。
- **原因**：模块F和G的类别详情弹窗已强制按 `categoryType` 过滤，无需用户手动切换过滤器。

## 2026-05-15 (Bug Fix: 模块E日详情弹窗)

- **问题**：模块E（日详情）弹窗也错误地排除了交易类型3（refund）和4（transfer）。
- **根因**：在 `getDetailTransactions()` 的 day 模式下错误添加了排除 refund 和 transfer 的过滤条件。
- **修复**：移除 day 模式下的排除过滤条件，只在 category 模式下排除。模块E应显示所有交易类型，模块F/G才禁止显示类型3、4。

## 2026-05-15 (模块B现金流概况修改)

- **需求1**：删除流入金额和流出金额右侧附属显示的百分比 `(本期流入金额 / 本期期初余额) * 100%`。
- **需求2**：将"净内部转账"改为"内部转账"，计算方式改为：交易类型为 4（内部转账）的所有交易的金额绝对值相加。总资产视图下除以 2（同一笔转账在两个账户各记一次），特定账户视图不除以 2。
- **需求3**：新增"撤销/报销"行，位于流出与内部转账之间。交易类型为 3（撤销/报销）的所有交易的金额绝对值相加后除以 2，不论账户选择。
- **前端修改**：
  - `index.html`：移除 `inflowRatio`、`outflowRatio` 元素；新增撤销/报销行（`refundValue`）；`data-multi-lang` 从 `cashflow.netTransfer` 改为 `cashflow.transfer`。
  - `app.js`：移除 `dom.inflowRatio`、`dom.outflowRatio` 及 `formatRatio`；新增 `dom.refundValue`；`updateCashflow` 中 refund 计算 `sumBy(slice, "refund") / 2`，transfer 仅总资产视图除以 2；`AMOUNT_KEYS` 新增 `refund`。
  - `multi-lang.json`：新增 `cashflow.refund`（zh: 撤销/报销, en: Refund/Reimbursement, fr: Remboursement）；`cashflow.netTransfer` 重命名为 `cashflow.transfer`。
- **后端修改**：
  - `processor.py`：新增 `REFUND_CODE = 3` 常量；`build_daily_series` 新增 `refund` 字段（`abs(refund_inflow) + abs(refund_outflow)`）；`build_total_series` 同步新增。
- **文档更新**：`frontend.md`（模块B指标描述）、`process.md`（ui_daily_series.json schema 示例字段名）。

## Plan

- [x] Implement src/backend/processor.py to generate UI JSON files.
- [x] Create data/ui output directory.
- [x] Implement src/backend/parser.py for PDF parsing and transaction extraction.
- [x] Validate outputs using real bank statement PDFs.

## 2026-05-15 (Docker Compose 部署)

- 新增 Docker Compose 部署方案，支持开机自动运行和崩溃自动重启。
- 新增文件：
  - `Dockerfile`：基于 `python:3.12-slim`，Gunicorn 作为生产级 WSGI 服务器。
  - `docker-compose.yml`：挂载 `data_users/`、`users.json`、`.env`，`restart: unless-stopped` 策略。
  - `.dockerignore`：排除 `.git`、`__pycache__`、`data_users/` 等非必要文件。
- `requirements.txt` 补充缺失依赖：`python-dotenv`、`gunicorn`、`apscheduler`。
- `api_server.py` 修改：
  - 新增 `/health` 健康检查端点（返回 `{"status": "ok"}`）。
  - 新增 Gunicorn hooks：`on_starting` 创建日志目录，`post_fork` 启动定时调度。
  - 保留 `__main__` 块支持直接 `python api_server.py` 运行。
- Gunicorn 配置：1 worker + `--preload`，timeout 1800 秒（30 分钟）。
- Docker 健康检查：每 30 秒访问 `/health`，连续 3 次失败标记不健康。

## Notes
- Processor implementation complete; ready to run against sample data.
- Parser implementation complete; processes PDFs via multimodal AI API.
