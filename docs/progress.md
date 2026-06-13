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
  - Apply Airtable-inspired visual system (coral accent #aa2d00, near-black primary #181d26, white canvas).
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
- Processor now determines `global_default_currency` from the first account's `default_currency` in `accounts.json` (stored as `_meta.processor_default_currency` in UI JSON files).
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

## 2026-05-19 (汇率更新时间显示)

- 新增汇率更新时间显示功能：在 Settings 弹窗第一行显示汇率数据的最后更新时间。
- 后端修改：
  - `fetch_fx.py`：`build_fx_payload` 函数新增 `updated_at` 字段，格式为 `YYYY-MM-DDTHH:MM:SE`（24小时制），记录汇率数据的本地生成时间。
- 前端修改：
  - `index.html`：Settings 弹窗内容区第一行新增 `settings-info` 区块，包含 `fxUpdatedAt` 和 `fxUpdatedTime` 元素。
  - `app.js`：新增 `dom.fxUpdatedTime` 引用；`state.data` 新增 `fxUpdatedAt` 字段；`init` 函数中从 `fx_rate.json` 读取 `updated_at`；`openSettingsModal` 函数中更新显示。
  - `styles.css`：新增 `.settings-info`、`.settings-fx-updated`、`.settings-fx-time` 样式，使用 12px 字体和 `var(--muted)` 深灰色，保持设计语言一致。
  - `multi-lang.json`：新增 `modal.fxRateUpdated` 翻译（zh: 汇率更新时间：, en: FX rates updated:, fr: Taux de change mis à jour :）。
- 文档更新：`frontend.md` 设置弹窗内容说明。

## 2026-05-19 (日期格式设置)

- 新增日期格式设置功能：用户可在 Settings 中选择日期显示方式。
- 支持四种格式：`YYYY-MM-DD`（默认）、`YYYY/MM/DD`、`DD/MM/YYYY`、`MM/DD/YYYY`。
- 前端修改：
  - `app.js`：新增 `state.dateFormat`（从 `localStorage` 读取）；新增 `formatDate()` 辅助函数，将 ISO 日期转为目标格式；新增 `setActiveDateFormatOption()` 函数。所有日期显示位置均已使用 `formatDate()` 包裹：交易列表行、详情列表行、余额概览、时间范围摘要、详情弹窗标题与指标、Tooltip、热力图 Tooltip、每日图表 Tooltip。日期格式切换点击事件写入 `localStorage` 并触发 `updateAll()` 全量刷新。
  - `index.html`：Settings 弹窗新增 Date Format 设置区块，含四个药丸按钮。
  - `styles.css`：新增 `.date-format-selector` 和 `.date-format-option` 样式，与语言选择器风格一致。
  - `multi-lang.json`：新增 `modal.dateFormat`（zh: 日期格式, en: Date Format, fr: Format de date）和 `toast.dateFormatUpdated` 翻译。
- 文档更新：`frontend.md` 设置弹窗内容说明和数据持久化说明。

## 2026-05-19 (双配色方案：现代 / 复古)

- 新增双配色方案系统，用户可在 Settings 中选择"现代"或"复古"风格。
- CSS 变量重命名：`--rausch` / `--rausch-active` → `--accent` / `--accent-active`（全局替换）。
- 两个配色方案独立于 light/dark 主题，通过 `data-scheme` 属性控制：
  - **现代 (modern)**：Airbnb 风格，accent #ff385c，ink #222222，暖色系标签和热力图。
  - **复古 (retro)**：Airtable 风格，accent #aa2d00（signature-coral），ink #181d26，冷暖结合标签。
- CSS 选择器架构：
  - `:root` — 浅色现代（默认）
  - `:root[data-scheme="retro"]` — 浅色复古
  - `[data-theme="dark"]` — 深色现代
  - `[data-theme="dark"][data-scheme="retro"]` — 深色复古
- 新增 `--palette-0` ~ `--palette-6` CSS 变量，图表调色板改为从 CSS 动态读取。
- Settings 弹窗新增"配色方案"选择区域，含两个药丸按钮（现代 swatch #ff385c / 复古 swatch #aa2d00）。
- 新增翻译键：`modal.colorScheme`、`modal.modern`、`modal.retro`（zh/en/fr）。
- 新增函数：`applyScheme()`、`setActiveSchemeOption()`。
- 状态持久化：`localStorage("scheme")`，默认 `"modern"`。
- 修改文件：`styles.css`、`index.html`、`app.js`、`landing.html`、`multi-lang.json`、`progress.md`、`structure.md`

## 2026-05-21 (前端样式微调)

- **模块A账户列表收窄**：`.account-breakdown` gap 从 8px 减至 4px，`.account-row` padding 从 8px 10px 减至 4px 8px，font-size 从 13px 减至 12px，使列表行更紧凑。
- **模块A移除期末余额日期行**：删除余额概览卡片中 `balanceMeta`（"期末余额 {日期}"）元素及相关代码、翻译键和 CSS。
- **Retro 配色 refund 颜色调整**：浅色 retro 方案 `--tag-refund-fg` 从 `#0a2e0e`（极深绿，近黑灰）调整为 `#2d6a3e`（中绿色），`--tag-refund-bg` 从 `rgba(10,46,14,0.12)` 调整为 `rgba(45,106,62,0.14)`，使 refund 标签与灰色系更易区分。深色 retro 方案不变（`#a8d8c4` 已足够明亮）。

## 2026-05-21 (修复每日4点自动刷新)

- **问题**：每日凌晨 4 点的自动刷新从未成功执行。日志中无任何 `msg.auto_refresh` 记录。
- **根因**：`threading.Timer` 是纯内存定时器，Docker 容器重启后丢失；且 `_on_daily_tick` 中未捕获异常会导致定时链永久断裂。
- **修复**：用 APScheduler (`BackgroundScheduler`) 替代 `threading.Timer`，使用 cron trigger 注册每天 4:00 任务。
  - `misfire_grace_time=3600`：容器在 4:00-5:00 之间恢复时补执行。
  - APScheduler 内置异常隔离，job 异常不影响调度器。
  - 已安装 `apscheduler==3.11.2` 到 conda 环境。
- 修改文件：`src/backend/api_server.py`

## 2026-05-21 (PDF 解析失败详细通知 + 重试机制)

- **需求**：当 parser.py 中 PDF 解析失败时（包括所有 check_transaction 失败的情况），必须在 notification 中明确说明失败原因和失败文件。所有可重试的失败场景必须允许 3 次重试。
- **问题**：之前 parser.py 遇到解析失败的 PDF 时只在日志中记录，前端通知只显示最后一行 INFO 消息，用户无法得知哪些 PDF 失败以及失败原因。且 `ai_parse_error`、`no_valid_transactions`、`multi_account` 三种失败无重试机制。
- **修改内容**：
  - `parser.py`：
    - 新增 `failed_pdfs` 和 `success_pdfs` 跟踪列表
    - 新增 `_record_failure()` 辅助函数，在每个失败点记录详细信息
    - main() 循环中，渲染 PDF 只做一次；AI 调用 + 校验部分加 `for attempt in range(1, MAX_RETRIES + 1)` 重试循环
    - `ai_parse_error` / `no_valid_transactions` / `multi_account`：重试 3 次，每次重新调用 AI
    - `render_error`：不重试（文件损坏）
    - `ai_no_response`：不重试外层（`call_ai_grouped` 内部已有 3 次重试）
    - `balance_check_failed`：已有 3 次重试（`run_balance_check_and_reparse`）
    - 重试过程中若 AI 调用失败（`ai_no_response`），立即跳出重试循环
    - 余额校验失败通过比对 `parsed_entries` 哈希集合检测
    - 每次运行结束写入 `parse_summary.json` 到 `data/database/`
    - 最终日志行包含成功/失败计数
  - `api_server.py`：
    - 新增 `_read_parse_summary()` 函数读取 `parse_summary.json`
    - `_parse_watcher` 在 parser 成功后检查摘要：若有失败 PDF 则发送 `msg.parse_done_with_failures` 通知（包含成功数、新增交易数、失败数、失败文件名、失败原因详情）
    - 若无失败则仍发送原来的 `msg.parse_done`
  - `multi-lang.json`：新增 `msg.parse_done_with_failures` 翻译键（zh/en/fr）
  - `app.js`：轮询逻辑增加对 `msg.parse_done_with_failures` 的处理，弹出警告 toast

## 2026-05-21 (Customize 日历动效优化)

- 优化左侧时间选择自定义日历动效：打开面板时输入框与日历更柔和的入场动画，月份切换新增左右滑入效果，完成范围选择时起止日期增加轻微脉冲反馈。
- 增强交互平滑度：日历卡片/日期单元过渡更细腻，保留 `prefers-reduced-motion` 降级支持。
  - `docs/schema.md`：新增 `parse_summary.json` schema 文档，包含失败原因枚举及重试说明
- **失败原因枚举与重试策略**：
  - `render_error`：不重试
  - `ai_no_response`：不重试外层（内部已有 3 次）
  - `ai_parse_error`：重试 3 次
  - `no_valid_transactions`：重试 3 次
  - `multi_account`：重试 3 次
  - `balance_check_failed`：重试 3 次（已有机制）

## 2026-05-21 (修复 Retro 深色按钮高亮)

- **问题**：选择 Retro 配色时，深色模式按钮高亮/点击颜色被现代配色覆盖。
- **根因**：暗色主题 CSS 变量定义使用 `[data-theme="dark"]`，按钮元素本身含 `data-theme="dark"` 时会被误命中，导致变量落回 modern。
- **修复**：将暗色主题变量选择器收窄为 `:root[data-theme="dark"]` 与 `:root[data-theme="dark"][data-scheme="retro"]`，并同步修正暗色表单选择器范围。
- 修改文件：`src/frontend/styles.css`

## 2026-05-21 (支持倒序银行账单 PDF)

- **问题**：用户 lijiayi 的银行账单 `交易流水明细20260521153638.pdf` 无法通过 balance check，被反复重试 3 次后移除。
- **根因**：该 PDF 的交易是严格倒序的（日期从近到远，每天的交易从晚上到白天）。AI 按 PDF 原始顺序返回交易，导致 `assign_transaction_ids` 按倒序分配序列号（最晚的交易得到 001），balance check 期望正序（从早到晚），因此全部失败。
- **修复**：在 `parser.py` 中新增 `normalize_transaction_order` 函数，在分配 `transaction_id` 前检测并修正同一天内交易的顺序。
  - `_check_balance_order(txns)`：检查交易列表的余额算术是否成立（`balance[i+1] == balance[i] + signed_amount[i+1]`）
  - `normalize_transaction_order(raw_txns, logger)`：按 `(account, date, currency)` 分组，若当前顺序不满足余额算术但反转后满足，则反转该组交易
  - 在 `parse_pdf` 函数中，`validate_single_account` 之后、`assign_transaction_ids` 之前调用
- **修改文件**：
  - `src/backend/parser.py`：新增两个函数，在 `parse_pdf` 中插入调用
  - `src/backend/prompts/parse_transactions.txt`：添加注释说明系统会自动处理倒序
  - `docs/schema.md`：更新余额一致性校验说明
- **效果**：支持正序和倒序的银行账单 PDF，确保 `transaction_id` 序列号始终按时间正序分配

## 2026-05-21 (修复交易金额换行问题)

- **问题**：Transactions 视图中，当交易金额超过4位数（含小数点共6位以上，如 `+1,234.56`）时，`+/-` 符号和金额数字被拆成两行显示。
- **根因**：`.transaction-amount`、`.transaction-balance`、`.detail-amount`、`.detail-balance` 四个 CSS 类缺少 `white-space: nowrap`，导致长文本在 grid 单元格内自动换行。
- **修复**：为上述四个 CSS 类添加 `white-space: nowrap`，确保符号与金额始终在同一行显示。
- 修改文件：`src/frontend/styles.css`

## 2026-05-21 (修复 Landing 页面深色模式 + Retro 配色文字不可见)

- **问题**：深色模式 + Retro 配色下，Landing 页面文字颜色极深，与深色背景融合，几乎不可见。
- **根因**：Landing 页面仅读取 `scheme`（配色）但未读取 `theme`（深色/浅色模式），深色模式 CSS 依赖 `@media (prefers-color-scheme: dark)` 而非 `data-theme="dark"` 属性。当用户在主应用手动选择深色模式时，Landing 页面无法感知，Retro 浅色模式的深色文字（`--ink: #181d26`）直接渲染在深色背景上。
- **修复**：
  - Script 块新增读取 `localStorage.theme`，解析 "system" 为实际偏好，设置 `data-theme` 属性。
  - 添加 `prefers-color-scheme` 变化监听器，system 模式下自动响应系统主题切换。
  - CSS 深色模式选择器从 `@media (prefers-color-scheme: dark)` 改为 `[data-theme="dark"]`，与主应用一致。
- 修改文件：`src/frontend/landing.html`

## 2026-05-21 (自定义时间范围体验升级)

- 侧边栏 Customize 改为内联展开双日历（上下排列），支持点击选择起止日期。
- 自定义范围支持手动输入，输入格式与 Date Format 同步（显示/解析均一致）。
- 移除旧的自定义范围弹窗，时间范围摘要与日历状态保持联动更新。
- 修改文件：`src/frontend/index.html`、`src/frontend/app.js`、`src/frontend/styles.css`、`docs/frontend.md`

## 2026-05-21 (日历导航按钮样式优化)

- **需求**：将日历选择中的左右箭头改成横向小药丸样式（高度收窄），放置在两个日历的竖向中间位置，偏外侧，日历宽度保持不变。
- **修改内容**：
  - `styles.css`：修改 `.calendar-nav-btn` 样式，从 32x32 方形按钮改为 48x20 横向小药丸，添加 `border-radius: var(--radius-full)`、`border`、`background` 等样式，添加 hover 效果。
  - `app.js`：修改 `renderRangeCalendars` 函数，在两个日历之间动态插入导航按钮，移除原来从 HTML 读取按钮的逻辑，改为动态创建按钮并更新 `dom.calendarPrev` 和 `dom.calendarNext` 引用。
  - `index.html`：移除原来在 `.custom-range-panel` 中的 `.calendar-nav` 静态按钮。
  - `docs/frontend.md`：更新时间范围调节器交互说明，描述新的日历导航按钮设计。
- **效果**：日历导航按钮现在为横向小药丸样式，位于两个日历之间，偏外侧，日历宽度保持不变。

## 2026-05-21 (自定义日历动效优化)

- Customize 面板改为平滑展开收起，增加淡入与上移动效。
- 日历卡片与导航按钮增加分层进入动效与阴影，选中日期提供轻量弹性反馈。
- 日期输入框新增聚焦高亮，Customize 按钮在展开时显示激活状态。
- 修改文件：`src/frontend/styles.css`、`src/frontend/app.js`

## 2026-05-22 (日历动效精简重设计)

- **问题**：日历动效过于跳脱混乱——月份切换时 scale+translate 叠加产生跳跃感，日期选中时 `dayPop`（0.94→1.06→1）弹跳过猛叠加 `rangePulse` 盒影脉冲，视觉噪音过大。
- **修改内容**：
  - **面板展开**：缓动曲线从 `ease` 改为 `cubic-bezier(0.22, 1, 0.36, 1)`（decelerate），时长 0.4s，位移 8px，无缩放。
  - **月份切换**：移除 `scale(0.98)`，改为纯水平位移 20px + 淡入（0.36s），方向与导航一致。
  - **日期选中**：移除 `dayPop` + `rangePulse` 双重动画，替换为单一 `daySettle` 弹性落位动画（0.35s，scale 0.92→1.04→1，配合 opacity 渐入）。
  - **起止日期样式**：背景从纯色 `var(--accent)` 改为 `linear-gradient(135deg, accent → accent-active)`，双环盒影改为柔和阴影 + canvas 边框，文字改为白色加粗。
  - **区间日期样式**：移除 `inset` 盒影，简化为纯背景色 `var(--delta-positive-bg)`。
  - **日历卡片阴影**：从单层改为双层（8px 扩散 + 1px 扩散），更精致。
  - **导航按钮 hover**：新增 `background: var(--surface-soft)` 微填充，阴影收小。
- 修改文件：`src/frontend/styles.css`、`src/frontend/app.js`、`docs/frontend.md`

## 2026-05-22 (长按上传按钮打开 raw_input 文件夹)

- **需求**：允许长按上传文件按钮，打开对应用户的 raw_input 文件夹进行文件管理。
- **架构**：
  - 新增 `scripts/host_bridge.py`：宿主机 HTTP 桥接服务（监听 `127.0.0.1:18923`），Docker 通过 `host.docker.internal:18923` 调用。跨平台支持：macOS 调用 `open`、Windows 调用 `os.startfile`、Linux 调用 `xdg-open`。Docker Desktop for Mac / Docker Desktop for Windows 均内置支持 `host.docker.internal`。
  - 桥接服务未运行时，前端自动降级为复制路径到剪贴板。
- **后端修改**：
  - 新增 `POST /<user_id>/api/open_raw_input` API 端点：
    - 非 Docker 环境（macOS/Linux/Windows）：直接调用 `open` / `xdg-open` / `os.startfile`。
    - Docker 环境：通过 `HOST_PWD` 环境变量计算 Host 端真实路径，向 `host.docker.internal:18923` 发送 GET 请求，由桥接服务打开 Finder。
  - 若 raw_input/ 目录不存在，自动创建。
  - `docker-compose.yml` 新增 `HOST_PWD=${PWD}` 环境变量。
- **前端修改**：
  - `app.js`：为 `#uploadFileBtn` 添加长按检测逻辑（mousedown/touchstart 启动 600ms 计时器，mouseup/mouseleave/touchend/touchcancel 取消）。
    - 长按触发 API 调用；API 返回 `opened: true` 则显示"已打开文件夹"。
    - API 返回 `opened: false`（桥接服务未运行）则复制路径到剪贴板，Toast 提示"路径已复制，在 Finder 中使用 Cmd+Shift+G 前往"。
    - 短按仍触发文件上传。
  - `multi-lang.json`：新增 `toast.folderOpened`、`toast.folderPathCopied`、`toast.folderOpenFailed` 翻译键（zh/en/fr）。
- **文档更新**：
  - `docs/frontend.md`：更新设置弹窗"上传 PDF"按钮说明，添加长按行为描述。
  - `docs/progress.md`：记录完整实现细节。
  - `README.md`：交互功能列表新增文件管理快捷入口；Docker 部署新增步骤 3（启动桥接服务）。

## 2026-05-22 (FX 自动刷新改为 24 小时阈值)

- **需求**：删除原有的凌晨 4 点定时刷新，改为距离用户上次 FX 更新时间超过 24 小时就自动刷新。如果自动刷新失败，则报错并提醒用户手动刷新，直到下一次手动刷新后才重新开始自动刷新。
- **Notification 改进**：手动/自动刷新的 notification 需要明确标注 [manual] 或 [auto]。

- **后端修改** (`src/backend/api_server.py`)：
  - 删除 `_start_scheduler()` 函数及 APScheduler 依赖
  - 新增 `_check_fx_stale(user_id)` 函数：检查 `fx_rate.json` 的 `updated_at` 是否超过 24 小时
  - 新增 `_do_auto_refresh(user_id)` 函数：执行自动刷新，失败时写入 `fx_auto_refresh_failed` 标记文件
  - `_do_refresh()` 函数：手动刷新时清除 `fx_auto_refresh_failed` 标记，notification 改为 `msg.manual_refresh`
  - 新增 `/api/fx_status` 端点：返回 FX 是否过期
  - 新增 `/api/auto_refresh` 端点：触发自动刷新
  - 删除 `post_fork` 中的 `_start_scheduler()` 调用

- **前端修改** (`src/frontend/app.js`)：
  - 新增 `checkAndAutoRefreshFx()` 函数：页面加载时检查 FX 状态，若过期则自动触发刷新
  - 自动刷新成功后自动重载页面，失败时显示 toast 提示

- **翻译更新** (`src/frontend/multi-lang.json`)：
  - 新增 `msg.manual_refresh`：手动刷新通知（zh/en/fr）
  - 新增 `msg.auto_fx_error`：自动刷新失败通知（zh/en/fr）
  - 修改 `msg.refresh_done` 为 `msg.manual_refresh`
  - 修改 `msg.auto_refresh`：标注 [auto]
  - 修改 `msg.fx_error`：标注 [manual]
  - 新增 `toast.autoRefreshFailed`：自动刷新失败 toast（zh/en/fr）

- **依赖更新** (`requirements.txt`)：
  - 移除 `apscheduler>=3.10`

- **失败恢复机制**：
  - 自动刷新失败时写入 `data_users/<user_id>/logs/fx_auto_refresh_failed` 标记文件
  - 标记文件存在时，`_check_fx_stale()` 返回 `stale: false`，阻止重复自动刷新
  - 用户手动刷新时删除标记文件，恢复自动刷新能力

## 2026-05-22 (长按中止解析功能)

- **需求**：解析 PDF 正在运行时，允许长按"解析 PDF"按钮（依旧不允许重复单击），按钮逐渐变红弹出确认窗口，确认后中止所有解析进程，发消息提醒用户。
- **后端修改** (`src/backend/api_server.py`)：
  - 新增 `_parse_processes` 字典：跟踪正在运行的 parser 子进程（`subprocess.Popen`）
  - `_parse_watcher` 函数改为使用 `Popen` 替代 `_run_script`，存储进程引用供后续中止
  - 新增 `POST /<user_id>/api/parse/abort` API 端点：
    - 向 parser 子进程发送 `SIGTERM`，5 秒内未退出则强制 `SIGKILL`
    - 清理 `_parse_status` 和 `_parse_processes` 状态
    - 写入 `msg.parse_aborted` 通知消息
- **前端修改** (`src/frontend/app.js`)：
  - `setParseLoading` 函数：移除 `disabled` 设置，仅保留 `.is-loading` 视觉状态，确保按钮始终可接收长按事件
  - Parse 按钮点击逻辑修改：解析中单击显示"解析正在进行中"提示，长按 600ms 后触发中止流程
  - 长按检测：mousedown/touchstart 启动 600ms 计时器（仅 `.is-loading` 状态时生效），触发后按钮添加 `.is-aborting` 类
  - 新增 `showAbortConfirmModal()` / `closeAbortConfirmModal()` / `handleAbortParse()` 函数
  - 新增 `dom.abortOverlay`、`dom.abortCancel`、`dom.abortConfirm` DOM 引用
- **HTML 修改** (`src/frontend/index.html`)：
  - 新增中止确认弹窗（`#abortOverlay`），包含确认文本、取消和中止按钮
- **样式修改** (`src/frontend/styles.css`)：
  - `.data-action-btn.is-loading`：移除 `pointer-events: none`，允许接收长按事件
  - 新增 `.data-action-btn.is-aborting`：红色背景（#dc3545）+ 白色文字，0.6s 渐变动效
  - 新增 `.abort-overlay`、`.abort-dialog`、`.abort-actions` 样式
  - 新增 `.pill-danger` 样式（红色危险按钮）
- **多语言** (`src/frontend/multi-lang.json`)：
  - 新增 `modal.confirmAbort`（zh: 中止解析, en: Abort parsing, fr: Interrompre l'analyse）
  - 新增 `modal.abortParseConfirm`（确认提示文本）
  - 新增 `toast.parseAborted`（zh: 解析已中止, en: Parsing aborted, fr: Analyse interrompue）
  - 新增 `toast.abortParseFailed`（中止失败提示）
  - 新增 `msg.parse_aborted`（通知消息：解析已被用户手动中止）
- **文档更新**：
  - `docs/schema.md`：新增"解析中止 API"章节，描述 abort 端点行为与状态清理
  - `docs/frontend.md`：更新"解析 PDF"按钮描述，添加长按中止行为说明
  - `docs/process.md`：更新处理管线说明，添加中止机制注释
  - `README.md`：交互功能列表和解析管线章节添加中止功能说明

## 2026-05-23 (交易日期显示星期几)

- **需求**：在所有交易的小日期显示旁边加上星期几，包括交易页面、每日详情弹窗、类别详情弹窗、Tooltip 等。
- **修改内容**：
  - `multi-lang.json`：新增 `weekday.0` ~ `weekday.6` 翻译键（zh: 周日~周六, en: Sun~Sat, fr: dim.~sam.）。
  - `app.js`：新增 `getWeekdayName(isoDate)` 和 `formatDateWithWeekday(isoDate)` 辅助函数；所有交易日期显示处改用 `formatDateWithWeekday`：
    - `updateTransactionsView()`：交易行 `.meta` 日期
    - `renderDetailList()`：详情行 `.meta` 日期
    - `showTxTooltip()`：Tooltip 日期行
    - `openDayDetail()`：弹窗副标题和指标日期
    - `openCategoryDetail()`：弹窗副标题和指标范围日期
    - `updateDailyChart()`：每日图表 Tooltip 日期
    - `updateHeatmap()`：热力图 Tooltip 日期
  - `frontend.md`：更新交易列表日期字段和模块 E 弹窗描述。
- **效果**：所有交易日期显示格式为 `2026-05-23 周五`，星期跟随语言设置。

## 2026-05-23 (修复热力图月份和日历星期多语言)

- **问题**：热力图（模块C）月份标签和自定义日历的星期标签未随语言切换而更新。
- **根因**：
  - 热力图使用 ECharts 内置 `nameMap: state.language`，但传递的是 `"zh"` 而 ECharts 期望 `"zh-cn"`，导致中文月份名回退为英文。
  - 日历 `getWeekdayLabels()` 硬编码返回英文缩写 `["S","M","T","W","T","F","S"]`。
- **修复**：
  - `multi-lang.json`：新增 `cal.day.0`~`cal.day.6`（日历星期缩写）和 `month.short.0`~`month.short.11`（月份缩写）翻译键（zh/en/fr）。
  - `app.js`：`getWeekdayLabels()` 改为从 `t("cal.day.X")` 动态获取；热力图 `monthLabel.nameMap` 改为自定义翻译数组。
- 修改文件：`multi-lang.json`、`app.js`

## 2026-05-23 (刷新消息标签分类与翻译)

- **需求**：将数据刷新通知消息的标签分为 `[manual]`（仅手动点击刷新按钮）和 `[system]`（其余所有自动刷新等），两种标签均需翻译。
- **修改内容**：
  - `multi-lang.json`：新增 `msg.tag.manual` 和 `msg.tag.system` 翻译键（zh: 手动/系统, en: manual/system, fr: manuel/système）。
  - `msg.auto_fx_error` 和 `msg.auto_refresh` 标签从 `[auto]` 改为 `[system]`（及其翻译）。
  - `msg.fx_error` 和 `msg.manual_refresh` 保持 `[manual]` 不变（均为手动触发）。
- 修改文件：`multi-lang.json`

## 2026-06-12 (修复 balance 为 null 导致的解析崩溃)

- **问题**：6.12 解析 fail，`msg.parse_error` 通知显示 `TypeError: float() argument must be a string or a real number, not 'NoneType'`，发生在 `assign_transaction_ids` 第 355 行。
- **代码层根因**：AI 大模型对部分交易返回 `"balance": null`（即 Python `None`）。Python `dict.get("balance", 0)` 的默认值仅在 key 不存在时生效，当 key 存在但值为 `None` 时，`.get()` 返回 `None` 而非默认值 `0`，导致 `float(None)` 抛出 `TypeError`。
- **AI 返回 null 的根因**：HSBC 账单采用「同一天交易共享一行余额」的格式——只有当日最后一条（或支出条目）才打印余额，入账条目（如 CASH REBATE）的余额列为空白。AI 面对空列不知道能否自行推算，Prompt 也缺少「余额缺失时请推算」的指令，于是保守返回 `null`。
- **为什么验证没拦住**：`validate_transactions()` 只检查 balance key 是否存在（`REQUIRED_FIELDS - set(raw.keys())`），不像 amount 那样用 `float()` 验证值是否合法。`{"balance": None}` 的 key 存在，直接通过验证。
- **修复（三层加固）**：
  - `validate_transactions()` 行 421-425：新增 `float(raw["balance"])` 值校验，拒绝 balance 为 null/invalid 的交易（类似已有的 amount 校验）。
  - `assign_transaction_ids()` 行 354-355：`raw.get("balance", 0)` → `raw.get("balance") or 0`（`amount` 同理），防御性处理 `None` 值。Python `or` 运算符对 `None`、空字符串、缺失 key（返回 `None`）均正确处理。
  - `parse_transactions.txt` prompt：新增余额推断规则——当余额列为空白时，根据上一条交易的余额推算（收入: prev + amount, 支出: prev - amount）；明确禁止输出 null；B/F BALANCE 仅作推算基准不提取为交易。
  - `check_transactions.py` 的 `parse_float()` 已正确使用 try/except 返回 `None`，无需修改。
- 修改文件：`src/backend/parser.py`、`src/backend/prompts/parse_transactions.txt`

## Notes
- Processor implementation complete; ready to run against sample data.
- Parser implementation complete; processes PDFs via multimodal AI API.
