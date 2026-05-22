# Personal Finance Dashboard 系统架构与流程详解

本文档是项目的**全景架构参考**，旨在让读者从零开始完整理解整个系统的运行流程、模块职责、数据流转与代码组织。配合 [schema.md](schema.md)（数据契约）、[process.md](process.md)（处理器管线）、[frontend.md](frontend.md)（前端规范）阅读效果更佳。

---

## 一、系统总体架构

### 1.1 技术栈

| 层级 | 技术 | 说明 |
| :--- | :--- | :--- |
| **Web 服务器** | Flask (Python) | 单一入口，同时提供 REST API 与静态文件服务 |
| **PDF 解析** | PyMuPDF + Anthropic SDK | PDF 渲染为图片，调用 AI API（模型见 `.env`）提取交易 |
| **汇率获取** | httpx → Frankfurter API (ECB) | 获取实时汇率，构建跨币种汇率矩阵 |
| **数据存储** | JSON 文件（无数据库） | 所有数据以 JSON 文件形式存储在用户独立目录中 |
| **前端渲染** | 原生 HTML/CSS/JS + ECharts 5 | 纯前端渲染，零业务计算，仅做数据绑定与图表展示 |
| **国际化** | multi-lang.json | 支持中文、英文、法文三种语言 |

### 1.2 核心设计原则

- **前端零计算**：所有业务逻辑（过滤、聚合、前向填充、汇率转换）由后端 `processor.py` 预计算完成，前端仅做 `slice()` 截取和 `reduce()` 累加。
- **用户数据隔离**：每个用户拥有独立的 `data_users/<user_id>/` 目录，通过 `FINANCE_DATA_DIR` 环境变量传递给后端脚本。
- **职责解耦**：后端只产数据（JSON），前端只渲染（ECharts），两者通过 JSON 文件契约通信。
- **增量更新**：解析器基于 PDF 文件哈希和日期去重，仅处理新数据。

### 1.3 项目目录结构

```
finance-dashboard/
├── .claude/                        # Claude Code 配置
├── .env                            # AI API 密钥与模型配置
├── docs/                           # 项目文档
│   ├── structure.md                # 本文档：系统架构与流程
│   ├── schema.md                   # 数据模型与契约
│   ├── process.md                  # 处理器管线与输出 JSON 规范
│   ├── frontend.md                 # 前端架构与交互规范
│   └── progress.md                 # 开发进度日志
├── src/
│   ├── backend/                    # 后端 Python 代码
│   │   ├── path_config.py          # 共享路径解析
│   │   ├── api_server.py           # Flask 服务器（API + 静态文件）
│   │   ├── parser.py               # PDF 解析引擎（核心）
│   │   ├── check_transactions.py   # 余额一致性校验
│   │   ├── detect_reclassify.py    # 退款/转账检测
│   │   ├── fetch_fx.py             # 汇率获取与矩阵构建
│   │   ├── processor.py            # 数据聚合引擎
│   │   ├── migrate_categories.py   # 类别迁移脚本（一次性）
│   │   └── prompts/
│   │       └── parse_transactions.txt  # AI 提示词模板
│   └── frontend/                   # 前端代码
│       ├── landing.html            # 用户选择页面
│       ├── index.html              # Dashboard 主页面
│       ├── app.js                  # 应用逻辑
│       ├── styles.css              # 样式
│       └── multi-lang.json         # 多语言翻译字典
├── users.json                      # 用户注册表
├── data_users/                     # 每用户独立数据目录
│   └── <user_id>/
│       ├── config/                 # 手动维护的配置文件
│       │   ├── accounts.json       # 银行账户配置
│       │   └── currency.json       # 货币配置
│       ├── database/               # 后端生成的数据文件
│       │   ├── transactions.json   # 交易记录流水
│       │   ├── parsed.json         # 解析历史记录
│       │   └── fx_rate.json        # 汇率矩阵
│       ├── ui/                     # 后端生成的前端数据文件
│       │   ├── ui_daily_series.json
│       │   ├── ui_static_charts.json
│       │   ├── ui_transactions_and_categories.json
│       │   └── ui_currency_breakdown.json
│       ├── raw_input/              # 用户上传的银行账单 PDF
│       ├── logs/                   # 运行日志
│       └── settings.json           # 用户设置
└── load.sh                         # 服务器启动脚本
```

---

## 二、完整系统管线图

整个系统可以抽象为 **六条核心管线**，它们串联起从用户注册到数据展示的完整生命周期。

### 2.1 管线总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Finance Dashboard 系统管线                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ 用户管理  │───▶│ 原始数据  │───▶│ 后端解析  │───▶│ 后端计算  │───▶│前端显示│ │
│  │ 管线     │    │ 管线     │    │ 管线     │    │ 管线     │    │管线   │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│       │                                   │                       │        │
│       │                                   │               ┌───────┘        │
│       │                                   ▼               ▼                │
│       │                            ┌──────────┐    ┌──────────┐            │
│       │                            │ 自动定时  │    │ 前端反馈  │            │
│       │                            │ 刷新管线  │    │ 管线     │            │
│       │                            └──────────┘    └──────────┘            │
│       │                                                          │         │
│       └──────────────────────────────────────────────────────────┘         │
│                        （反馈操作触发新一轮管线执行）                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 管线 1：用户管理

**触发时机**：用户首次访问系统

**流程**：

```
用户浏览器
    │
    ▼
GET /                           → landing.html
    │                              (加载 users.json，渲染用户卡片)
    ▼
用户点击某用户卡片
    │
    ▼
GET /<user_id>/                 → 检查 accounts.json 是否存在
    │                              ├─ 存在 → index.html（进入 Dashboard）
    │                              └─ 不存在 → index.html + 引导 Onboarding
    ▼
Onboarding 引导流程（3 步）：
    Step 1: 选择默认货币 → 写入临时状态
    Step 2: 添加银行账户 → 写入临时状态
    Step 3: 上传 PDF（可选）
    │
    ▼
POST /<user_id>/api/setup       → 创建 config/currency.json
                                  → 创建 config/accounts.json
                                  → 创建空 database/transactions.json
                                  → 创建空 database/parsed.json
    │
    ▼
POST /<user_id>/api/upload      → 上传 PDF 到 raw_input/
    │
    ▼
POST /<user_id>/api/parse       → 触发解析管线（管线 3）
```

**涉及文件**：

| 文件 | 角色 |
| :--- | :--- |
| `users.json` | 用户注册表，存储所有用户的 id、name、data_dir |
| `landing.html` | 用户选择页面，读取 `/api/users` 渲染卡片 |
| `index.html` | Dashboard 主页，检测 Onboarding 状态 |
| `app.js` | `showOnboarding()`、`obFinish()` 函数处理引导流程 |
| `api_server.py` | `setup_user()` 创建初始配置文件 |

### 2.3 管线 2：原始数据上传

**触发时机**：用户通过前端上传 PDF 银行账单

**流程**：

```
用户在 Settings 弹窗中选择 PDF 文件
    │
    ▼
app.js: handleFileUpload()
    │   构造 FormData，POST 到 /<user_id>/api/upload
    ▼
api_server.py: upload_files()
    │   保存文件到 data_users/<user_id>/raw_input/
    │   写入通知消息（msg.upload_success）
    ▼
前端显示 Toast 提示
```

**数据流向**：

```
用户本地 PDF 文件  ──HTTP POST──▶  data_users/<user_id>/raw_input/*.pdf
```

### 2.4 管线 3：后端解析（PDF → 交易记录）

**触发时机**：用户点击"Parse PDF"按钮，或通过 Onboarding 流程触发

**流程**：

```
前端 POST /<user_id>/api/parse
    │
    ▼
api_server.py: parse_pdfs()
    │   检查是否已在运行（409 防重复）
    │   启动后台线程 _parse_watcher()
    ▼
_parse_watcher() 后台线程
    │
    ▼
运行 parser.py（子进程，FINANCE_DATA_DIR=<用户数据目录>）
    │
    ├── 阶段 1: 加载配置
    │   ├── 读取 config/accounts.json（账户信息）
    │   └── 读取 config/currency.json（货币信息）
    │
    ├── 阶段 2: 扫描 PDF
    │   ├── 扫描 raw_input/*.pdf
    │   ├── 读取 database/parsed.json（已处理文件哈希）
    │   └── 过滤已处理的 PDF（基于 SHA-256 哈希）
    │
    ├── 阶段 3: AI 解析（对每个新 PDF）
    │   ├── render_pdf_to_images() → PyMuPDF 渲染每页为 PNG（200 DPI）
    │   ├── split_images_into_groups() → 每 2 页分一组
    │   ├── call_ai_grouped() → 多进程并行调用 AI API
    │   │   ├── 构建 system_prompt（注入账户和货币信息）
    │   │   ├── 调用 Anthropic SDK（模型见 `.env` AI_MODEL）
    │   │   │   - 输入: system prompt + PNG 图片（base64）
    │   │   │   - 输出: JSON 数组（交易记录）
    │   │   └── parse_ai_response() → 提取 JSON（去除 markdown 围栏）
    │   ├── validate_transactions() → 校验必要字段
    │   └── validate_single_account() → 确保单 PDF 单账户
    │
    ├── 阶段 4: 数据入库
    │   ├── assign_transaction_ids() → 生成 TX-{code}-{YYYYMMDD}-{seq}
    │   ├── 写入 cashflow_direction（type_code 1→方向 1，2→方向 2）
    │   └── apply_dedup() → 基于 (account_code, date) 去重
    │
    ├── 阶段 5: 余额校验与重解析
    │   ├── check_transactions.check_transactions_by_pdf()
    │   │   ├── 按 source_hash + currency 分组
    │   │   ├── 验证余额链：prev_balance ± amount = curr_balance
    │   │   └── 标记不一致的 PDF
    │   └── run_balance_check_and_reparse() → 最多重试 3 次
    │
    ├── 阶段 6: 退款/转账检测
    │   ├── detect_reclassify.detect_refunds()
    │   │   ├── 同账户、同币种
    │   │   ├── 流出→流入，金额匹配（±0.005）
    │   │   ├── 小数金额：60 天窗口
    │   │   ├── 整数金额 > 5：30 天窗口
    │   │   └── 匹配成功 → 两笔均标记 type_code = 3
    │   └── detect_reclassify.detect_transfers()
    │       ├── 不同账户、同币种
    │       ├── 流出（账户 A）→ 流入（账户 B），3 天窗口
    │       ├── 金额匹配：流出 × 97% ≤ 流入 ≤ 流出
    │       ├── 匹配成功 → 两笔均标记 type_code = 4
    │       └── 若有差额 → 生成手续费交易（type_code 2，category "Other"）
    │
    └── 阶段 7: 写入结果
        ├── 更新 database/transactions.json（追加新交易）
        └── 更新 database/parsed.json（追加已处理文件记录）

    │
    ▼（parser.py 成功后自动触发）
_do_refresh()
    │   运行 fetch_fx.py → 更新汇率
    │   运行 processor.py → 重新生成 UI 数据
    ▼
前端 pollParseStatus() 检测完成 → 自动刷新页面
```

**涉及文件**：

| 文件 | 角色 |
| :--- | :--- |
| `parser.py` | 主解析引擎（737 行） |
| `prompts/parse_transactions.txt` | AI 提示词模板 |
| `check_transactions.py` | 余额一致性校验 |
| `detect_reclassify.py` | 退款/转账检测 |
| `path_config.py` | 路径解析 |

**AI API 调用细节**：

| 参数 | 值 |
| :--- | :--- |
| 模型 | 通过 .env 配置 |
| SDK | `anthropic.Anthropic` |
| Base URL | 通过 .env 配置 |
| Max Tokens | 20,480 |
| 输入 | System prompt + PNG 图片（base64），每组最多 2 页 |
| 输出 | JSON 数组，每个元素为一条交易记录 |
| 重试 | 最多 3 次，间隔 5 秒 |
| 并行 | 最多 10 个 worker 进程（ProcessPoolExecutor） |

### 2.5 管线 4：后端计算（交易记录 → 前端数据）

**触发时机**：解析完成后自动触发，或用户手动点击"Refresh Data"

**流程**：

```
api_server.py: _do_refresh()
    │
    ├── 运行 fetch_fx.py
    │   ├── 读取 config/currency.json
    │   ├── 构建 code_to_iso / iso_to_code 映射
    │   ├── GET https://api.frankfurter.app/latest（基准币种 USD）
    │   ├── build_fx_matrix() → 构建 N×N 汇率矩阵
    │   └── 写入 database/fx_rate.json
    │
    └── 运行 processor.py
        ├── 加载数据
        │   ├── config/accounts.json
        │   ├── config/currency.json
        │   ├── database/transactions.json
        │   ├── database/parsed.json
        │   └── database/fx_rate.json
        │
        ├── 生成三种货币视角
        │   ├── "default"：所有账户转换为全局默认币种
        │   ├── "default_local"：每个账户转换为自身默认币种
        │   └── 具体币种代码（如 "01"、"02"）：仅保留该币种交易，不做转换
        │
        ├── 对每种视角执行 build_dataset()
        │   ├── prepare_transactions() → 汇率转换或币种过滤
        │   ├── normalize_transactions() → 添加 _date、_seq 内部字段
        │   ├── group_by_account() → 按 account_code 分组
        │   ├── build_daily_series() → 构建连续每日历 + 前向填充
        │   │   ├── 生成 start_balance / end_balance
        │   │   ├── 生成 all_inflow / all_outflow（全量）
        │   │   ├── 生成 refund / internal_transfer
        │   │   └── 生成 filtered_inflow / filtered_outflow（排除 type 3/4）
        │   ├── build_total_series() → 汇总所有账户为 "total"
        │   ├── build_heatmap() → 最近 90 天净流入热力图数据
        │   ├── build_monthly_combo() → 最近 12 个月余额/收支柱状图数据
        │   └── build_transactions_output() → 序列化交易记录（附带别名等元数据）
        │
        └── 写入 4 个 UI JSON 文件
            ├── ui/ui_daily_series.json
            ├── ui/ui_static_charts.json
            ├── ui/ui_transactions_and_categories.json
            └── ui/ui_currency_breakdown.json
```

**涉及文件**：

| 文件 | 角色 |
| :--- | :--- |
| `fetch_fx.py` | 汇率获取（178 行） |
| `processor.py` | 数据聚合引擎（747 行） |
| `path_config.py` | 路径解析 |

### 2.6 管线 5：前端显示（JSON → 可视化）

**触发时机**：用户打开 Dashboard 页面，或切换账户/货币/时间范围

**流程**：

```
用户访问 /<user_id>/
    │
    ▼
app.js: init()
    │
    ├── 加载翻译 → multi-lang.json
    ├── 检测用户状态（新用户 vs 已有用户）
    │   └── 新用户 → showOnboarding()
    ├── 并行加载所有 JSON 数据
    │   ├── data/config/accounts.json
    │   ├── data/config/currency.json
    │   ├── data/ui/ui_daily_series.json
    │   ├── data/ui/ui_static_charts.json
    │   ├── data/ui/ui_transactions_and_categories.json
    │   ├── data/ui/ui_currency_breakdown.json
    │   ├── data/database/fx_rate.json
    │   └── multi-lang.json
    │
    ├── 构建 UI
    │   ├── applyLanguage() → 应用语言设置
    │   ├── applyTheme() → 应用主题设置
    │   ├── buildAccountList() → 渲染账户选择器
    │   └── initCharts() → 创建 5 个 ECharts 实例
    │
    └── updateAll() → 主刷新函数
        │
        ├── 确定数据集
        │   ├── getActiveDatasetKey() → "default" / "default_local" / 具体币种
        │   ├── getDataset() → 从对应数据集中取出数据
        │   └── applyGlobalCurrencyConversion() → 运行时汇率转换（若用户默认币种 ≠ 处理器默认币种）
        │
        ├── 计算时间范围
        │   ├── rangeMode: "7"/"30"/"90"/"180"/"365"/"all"/"custom"
        │   └── 对 daily_series 进行 slice() 截取
        │
        ├── 更新 Dashboard 视图
        │   ├── updateBalanceOverview() → A. 余额概览卡片
        │   ├── updateCashflow() → B. 现金流概况卡片
        │   ├── updateHeatmap() → C. 每日热力图（ECharts calendar）
        │   ├── updateMonthlyChart() → D. 月度组合图（ECharts bar+line）
        │   ├── updateDailyChart() → E. 每日组合图（ECharts bar+line）
        │   ├── updateSankey() → F. 资金流向桑基图（ECharts sankey）
        │   └── updateCategoryPanel() → G. 分类占比环形图（ECharts pie）
        │
        └── 更新 Transactions 视图
            └── updateTransactionsView() → 交易列表（带排序和筛选）
```

**ECharts 图表清单**：

| 模块 | 图表类型 | 数据来源 | 时间联动 |
| :--- | :--- | :--- | :--- |
| A. 余额概览 | 数字卡片 | `ui_daily_series.json` | 是 |
| B. 现金流概况 | 数字卡片 | `ui_daily_series.json` | 是 |
| C. 每日热力图 | Calendar Heatmap | `ui_static_charts.json` | 否（固定 90 天） |
| D. 月度组合图 | Bar + Line | `ui_static_charts.json` | 否（固定 12 个月） |
| E. 每日组合图 | Bar + Line | `ui_daily_series.json` | 是 |
| F. 桑基图 | Sankey | `ui_transactions_and_categories.json` | 是 |
| G. 分类占比 | Pie (Donut) | `ui_transactions_and_categories.json` | 是 |

### 2.7 管线 6：前端反馈功能

前端提供多种用户交互反馈机制，部分交互会触发后端管线的重新执行。

#### 2.7.1 文件上传反馈

```
用户选择文件 → handleFileUpload()
    │
    ▼
POST /<user_id>/api/upload
    │
    ▼
Toast: "文件上传成功"
```

#### 2.7.2 解析进度反馈

```
用户点击 Parse PDF → handleParsePdf()
    │
    ▼
POST /<user_id>/api/parse
    │
    ▼
启动 pollParseStatus()（每 5 秒轮询）
    │
    ├── GET /<user_id>/api/parse/status → {running: true}
    │   └── 按钮显示加载动画
    │
    └── GET /<user_id>/api/parse/status → {running: false, ok: true}
        └── 自动刷新页面，加载新数据
```

#### 2.7.3 通知系统

```
后端 _add_message() 写入消息
    │
    ├── 内存存储（_messages dict）
    └── 持久化到 logs/notifications.jsonl
    │
    ▼
前端 Notifications 弹窗
    │
    └── GET /<user_id>/api/messages → 消息列表（最新在前）
```

消息类型：

| 消息 key | 触发时机 | 参数 |
| :--- | :--- | :--- |
| `msg.upload_success` | 文件上传成功 | `count`, `files` |
| `msg.parse_started` | 解析开始 | 无 |
| `msg.parse_done` | 解析完成 | `detail`（INFO 摘要） |
| `msg.parse_error` | 解析失败 | `error` |
| `msg.fx_error` | [manual] 汇率更新失败 | `error` |
| `msg.auto_fx_error` | [auto] 汇率自动刷新失败 | `error` |
| `msg.processor_error` | 处理器失败 | `error` |
| `msg.manual_refresh` | [manual] 手动刷新完成 | `fx_detail` |
| `msg.auto_refresh` | [auto] 自动刷新完成 | `fx_detail` |
| `msg.setup_complete` | 用户初始化完成 | 无 |
| `msg.accounts_updated` | 账户配置更新 | `count` |
| `msg.currencies_updated` | 货币配置更新 | `count` |

#### 2.7.4 图表交互反馈

| 交互 | 触发位置 | 行为 |
| :--- | :--- | :--- |
| 点击热力图日期方格 | 模块 C | 设置自定义时间范围为该日 |
| 点击月度图月份 | 模块 D | 设置自定义时间范围为该月 |
| 点击每日图日期 | 模块 E | 弹出日详情卡片（当日所有交易） |
| 点击桑基图类别节点 | 模块 F | 弹出类别详情卡片（该类别所有交易） |
| 点击甜甜圈图扇区 | 模块 G | 弹出类别详情卡片 |
| Hover 交易行 | 列表/详情 | 高亮行 + 浮窗显示全部字段 |

#### 2.7.5 配置管理反馈

```
用户在 Settings 弹窗中编辑账户/货币
    │
    ▼
app.js: saveEditConfig()
    │
    ├── PUT /<user_id>/api/config/accounts → 更新 accounts.json
    └── PUT /<user_id>/api/config/currencies → 更新 currency.json
    │
    ▼
Toast: "配置已更新"
```

#### 2.7.6 定时自动刷新

```
api_server.py 启动时
    │
    ▼
checkAndAutoRefreshFx() (前端页面加载时)
    │
    ├── GET /<user_id>/api/fx_status
    │   └── _check_fx_stale(user_id)
    │       ├── 检查 fx_rate.json 的 updated_at
    │       ├── 检查 fx_auto_refresh_failed 标记
    │       └── 返回 { stale: bool, ... }
    │
    ▼ (if stale)
POST /<user_id>/api/auto_refresh
    │
    └── _do_auto_refresh(user_id)
        ├── fetch_fx.py → 更新汇率
        ├── processor.py → 重新生成 UI 数据
        └── 失败时写入 fx_auto_refresh_failed 标记
    │
    ▼
手动刷新 POST /<user_id>/api/refresh
    │
    └── _do_refresh(user_id, auto=False)
        ├── fetch_fx.py → 更新汇率
        ├── processor.py → 重新生成 UI 数据
        └── 清除 fx_auto_refresh_failed 标记
```

---

## 三、所有前后端代码功能与调用关系

### 3.1 后端代码清单

#### 3.1.1 `path_config.py` — 共享路径解析

**职责**：通过 `FINANCE_DATA_DIR` 环境变量确定当前用户的数据目录，为所有后端脚本提供统一的路径常量。

**导出常量**：

| 常量 | 值 | 说明 |
| :--- | :--- | :--- |
| `ROOT` | 项目根目录 | `Path(__file__).resolve().parents[2]` |
| `DATA_DIR` | 用户数据根目录 | 读取 `FINANCE_DATA_DIR` 环境变量 |
| `DB_DIR` | `DATA_DIR / "database"` | 数据库目录 |
| `LOG_DIR` | `DATA_DIR / "logs"` | 日志目录 |
| `CONFIG_DIR` | `DATA_DIR / "config"` | 配置目录 |
| `RAW_INPUT_DIR` | `DATA_DIR / "raw_input"` | 原始 PDF 目录 |
| `UI_DIR` | `DATA_DIR / "ui"` | 前端数据目录 |

**被调用方**：`parser.py`、`processor.py`、`fetch_fx.py`、`check_transactions.py`、`detect_reclassify.py`

#### 3.1.2 `api_server.py` — Flask 服务器

**职责**：应用的唯一入口点。提供 REST API 端点、静态文件服务、FX 自动刷新检查。

**函数清单**：

| 函数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `load_users()` | 工具 | 读取 `users.json`，返回用户列表 |
| `get_user(user_id)` | 工具 | 按 ID 查找单个用户 |
| `user_data_dir(user_id)` | 工具 | 返回用户数据目录的绝对路径 |
| `_add_message(user_id, key, params)` | 工具 | 添加通知消息（JSONL 持久化） |
| `_extract_info(stdout)` | 工具 | 从子进程输出提取最后的 `[INFO]` 行 |
| `_run_script(script, user_id)` | 工具 | 以子进程方式运行后端脚本，设置 `FINANCE_DATA_DIR` |
| `_parse_watcher(user_id)` | 后台 | 解析监视器：运行 parser.py，成功后自动触发刷新 |
| `_do_refresh(user_id, auto)` | 核心 | 运行 fetch_fx.py + processor.py，手动刷新时清除失败标记 |
| `_check_fx_stale(user_id)` | 核心 | 检查 FX 是否过期（>24h），返回 stale/failed 状态 |
| `_do_auto_refresh(user_id)` | 核心 | 执行自动刷新，失败时写入 `fx_auto_refresh_failed` 标记 |
| `landing_page()` | 路由 | `GET /` → landing.html |
| `list_users()` | 路由 | `GET /api/users` → users.json |
| `user_dashboard(user_id)` | 路由 | `GET /<user_id>/` → index.html |
| `serve_app_js(user_id)` | 路由 | `GET /<user_id>/app.js` |
| `serve_styles(user_id)` | 路由 | `GET /<user_id>/styles.css` |
| `serve_multi_lang(user_id)` | 路由 | `GET /<user_id>/multi-lang.json` |
| `serve_user_data(user_id, subpath)` | 路由 | `GET /<user_id>/data/<path>` → 用户数据目录文件 |
| `upload_files(user_id)` | 路由 | `POST /<user_id>/api/upload` → 保存 PDF |
| `parse_pdfs(user_id)` | 路由 | `POST /<user_id>/api/parse` → 启动解析 |
| `parse_status(user_id)` | 路由 | `GET /<user_id>/api/parse/status` → 解析状态 |
| `refresh_data(user_id)` | 路由 | `POST /<user_id>/api/refresh` → 手动刷新 |
| `fx_status(user_id)` | 路由 | `GET /<user_id>/api/fx_status` → FX 是否过期 |
| `auto_refresh(user_id)` | 路由 | `POST /<user_id>/api/auto_refresh` → 触发自动刷新 |
| `get_messages(user_id)` | 路由 | `GET /<user_id>/api/messages` → 通知列表 |
| `setup_user(user_id)` | 路由 | `POST /<user_id>/api/setup` → 初始化用户 |
| `get_accounts(user_id)` | 路由 | `GET /<user_id>/api/config/accounts` |
| `put_accounts(user_id)` | 路由 | `PUT /<user_id>/api/config/accounts` |
| `get_currencies(user_id)` | 路由 | `GET /<user_id>/api/config/currencies` |
| `put_currencies(user_id)` | 路由 | `PUT /<user_id>/api/config/currencies` |

**API 端点汇总**：

| 方法 | 路由 | 用途 |
| :--- | :--- | :--- |
| GET | `/` | 用户选择页面 |
| GET | `/api/users` | 获取用户列表 |
| GET | `/<user_id>/` | Dashboard 页面 |
| GET | `/<user_id>/app.js` | 前端 JS |
| GET | `/<user_id>/styles.css` | 前端 CSS |
| GET | `/<user_id>/multi-lang.json` | 翻译字典 |
| GET | `/<user_id>/data/<subpath>` | 用户数据文件 |
| POST | `/<user_id>/api/upload` | 上传 PDF |
| POST | `/<user_id>/api/parse` | 启动解析 |
| GET | `/<user_id>/api/parse/status` | 解析状态 |
| POST | `/<user_id>/api/refresh` | 手动刷新数据 |
| GET | `/<user_id>/api/fx_status` | 检查 FX 是否过期 |
| POST | `/<user_id>/api/auto_refresh` | 触发自动刷新 |
| GET | `/<user_id>/api/messages` | 通知消息 |
| POST | `/<user_id>/api/setup` | 初始化用户 |
| GET | `/<user_id>/api/config/accounts` | 获取账户配置 |
| PUT | `/<user_id>/api/config/accounts` | 更新账户配置 |
| GET | `/<user_id>/api/config/currencies` | 获取货币配置 |
| PUT | `/<user_id>/api/config/currencies` | 更新货币配置 |

#### 3.1.3 `parser.py` — PDF 解析引擎

**职责**：将 PDF 银行账单转换为结构化的交易记录。是整个系统的核心模块。

**函数清单**：

| 函数 | 说明 |
| :--- | :--- |
| `compute_file_hash(file_path)` | 计算文件 SHA-256 哈希 |
| `render_pdf_to_images(pdf_path)` | PyMuPDF 渲染 PDF 每页为 PNG base64 |
| `split_images_into_groups(images, group_size)` | 按组大小分割图片列表 |
| `load_prompt_template()` | 读取 `prompts/parse_transactions.txt` |
| `build_system_prompt(accounts, currencies)` | 注入账户和货币信息到提示词模板 |
| `call_ai(client, system_prompt, images, logger, model)` | 单次 AI API 调用 |
| `_call_ai_with_retry(...)` | 带重试的 AI 调用（最多 3 次） |
| `_call_ai_worker(args)` | ProcessPoolExecutor worker 函数 |
| `call_ai_grouped(...)` | 多进程并行 AI 调用编排 |
| `parse_ai_response(response_text)` | 解析 AI 响应，提取 JSON 数组 |
| `build_seq_map(transactions)` | 构建 `{(account_code, date): max_seq}` 映射 |
| `assign_transaction_ids(...)` | 分配 TX-IDs，写入 cashflow_direction |
| `apply_dedup(new_txns, existing_txns, logger)` | 基于 (account_code, date) 去重 |
| `validate_transactions(raw_txns, logger)` | 校验必要字段 |
| `validate_single_account(raw_txns, logger)` | 确保单 PDF 单账户 |
| `parse_pdf(...)` | 单个 PDF 完整解析管线 |
| `run_balance_check_and_reparse(...)` | 余额校验 + 自动重解析 |
| `main()` | 入口函数 |

#### 3.1.4 `check_transactions.py` — 余额一致性校验

**职责**：验证同一 PDF 内的交易余额链是否连续一致。

| 函数 | 说明 |
| :--- | :--- |
| `infer_signed_amount(tx, logger)` | 根据 cashflow_direction 推断带符号金额 |
| `normalize_parsed_entries(parsed_entries)` | 兼容 dict/list 格式的 parsed.json |
| `build_pdf_name_map(parsed_entries)` | 构建 hash→filename 映射 |
| `check_transactions_by_pdf(...)` | 核心校验：按 source_hash + currency 分组验证余额链 |
| `remove_pdf_records(...)` | 移除校验失败的 PDF 相关记录 |
| `main()` | 独立运行入口 |

#### 3.1.5 `detect_reclassify.py` — 退款/转账检测

**职责**：通过匹配交易对，识别退款（type_code 3）和内部转账（type_code 4）。

| 函数 | 说明 |
| :--- | :--- |
| `detect_refunds(transactions, logger)` | 退款检测：同账户、同币种、金额匹配 |
| `detect_transfers(transactions, logger, processed_at)` | 转账检测：跨账户、同币种、3 天窗口、97% 容差 |

#### 3.1.6 `fetch_fx.py` — 汇率获取

**职责**：从 Frankfurter API (ECB) 获取汇率，构建全量跨币种汇率矩阵。

| 函数 | 说明 |
| :--- | :--- |
| `load_currencies()` | 读取 currency.json |
| `build_iso_maps(currencies)` | 构建 code↔ISO 映射 |
| `fetch_from_frankfurter(iso_codes)` | 调用 Frankfurter API 获取基准汇率 |
| `build_fx_matrix(base_rates, iso_codes)` | 构建 N×N 汇率矩阵 |
| `build_fx_payload(currencies, fx_snapshot)` | 组装最终输出结构 |
| `run()` | 入口函数 |

#### 3.1.7 `processor.py` — 数据聚合引擎

**职责**：将离散的交易记录转换为前端可直接使用的预计算数据。实现"前端零计算"架构。

| 函数 | 说明 |
| :--- | :--- |
| `round_money(value)` | 四舍五入到 2 位小数 |
| `get_fx_rate(rates, source, target)` | 查询汇率 |
| `infer_signed_amount(tx)` | 推断带符号金额 |
| `normalize_transactions(transactions)` | 添加 _date、_seq 内部字段 |
| `prepare_transactions(...)` | 汇率转换或币种过滤 |
| `group_by_account(transactions)` | 按 account_code 分组 |
| `build_daily_series(...)` | 构建连续每日历 + 前向填充 |
| `build_total_series(account_series)` | 汇总所有账户为 "total" |
| `build_converted_daily_series(...)` | 带汇率转换的每日序列构建 |
| `build_heatmap(series, days)` | 热力图数据（最近 N 天） |
| `build_monthly_combo(series, months)` | 月度组合图数据（最近 N 月） |
| `build_transactions_output(...)` | 交易列表序列化 |
| `serialize_transaction(...)` | 单条交易序列化（附带别名等元数据） |
| `build_dataset(...)` | 数据集构建编排 |
| `main()` | 入口函数 |

### 3.2 前端代码清单

#### 3.2.1 `landing.html` — 用户选择页面

**职责**：展示所有注册用户，点击进入各自的 Dashboard。

**功能**：
- 调用 `GET /api/users` 获取用户列表
- 渲染用户卡片网格（Airtable 风格设计）
- 点击卡片跳转到 `/<user_id>/`

#### 3.2.2 `index.html` — Dashboard 主页面

**职责**：主应用页面，包含所有 UI 组件和模态框。

**页面结构**：

| 区域 | 包含元素 |
| :--- | :--- |
| 顶部导航栏 | 品牌标题、Dashboard/Transactions 标签切换、日期范围显示 |
| 左侧栏 | 账户选择器、货币选择器、时间范围按钮（1W/1M/3M/6M/1Y/All/Customize）、设置按钮、通知按钮 |
| 主内容区 - Dashboard | A. 余额概览、B. 现金流、C. 热力图、D. 月度图、E. 每日图、F. 桑基图、G. 分类占比 |
| 主内容区 - Transactions | 排序控制、过滤器（收入/支出/退款/转账）、交易列表 |
| 模态框 | 自定义范围选择器、详情卡片、设置、通知、账户/货币配置编辑器、Onboarding 引导 |

#### 3.2.3 `app.js` — 应用逻辑（2385 行）

**职责**：所有前端逻辑的唯一载体。包括状态管理、数据获取、图表渲染、用户交互、国际化。

**全局状态对象 `state`**：

```javascript
state = {
    view: "dashboard" | "transactions",    // 当前视图
    account: "total" | account_code,        // 选中账户
    currency: "default" | currency_code,    // 选中币种
    language: "zh" | "en" | "fr",           // 语言
    theme: "system" | "light" | "dark",     // 主题
    rangeMode: "7" | "30" | "90" | ... | "custom",
    customRange: { start, end },            // 自定义日期范围
    categoryType: "expense" | "income",     // 分类图类型
    transactionSort: "date" | "amount",     // 交易排序
    transactionFilters: { income, expense, refund, transfer },
    detail: { mode, date, category, filters },  // 详情弹窗状态
    data: { ... },                          // 所有加载的 JSON 数据
    charts: { ... }                         // ECharts 实例
}
```

**核心函数分类**：

| 分类 | 函数 | 说明 |
| :--- | :--- | :--- |
| **初始化** | `init()` | 入口：加载翻译、检测用户状态、加载数据、构建 UI |
| **国际化** | `t(key)` | 翻译查找（带回退） |
| | `getAlias(obj)` | 从多语言对象提取当前语言别名 |
| | `translateCategory(key)` | 英文类别名→当前语言 |
| | `untranslateCategory(name)` | 当前语言→英文类别名 |
| | `applyLanguage()` | 更新所有 `[data-multi-lang]` 元素 |
| **主题** | `applyTheme(mode)` | 设置 `data-theme` 属性 |
| **账户/币种** | `buildAccountList()` | 渲染账户选择器药丸按钮 |
| | `updateCurrencyOptions()` | 更新可用币种选项 |
| | `getActiveDatasetKey()` | 确定当前数据集键 |
| | `getDataset(collection)` | 获取对应数据集 |
| | `applyGlobalCurrencyConversion(...)` | 运行时汇率转换 |
| **主刷新** | `updateAll()` | 主刷新：更新范围摘要、Dashboard、Transactions |
| | `updateDashboard()` | 编排所有 Dashboard 面板更新 |
| **模块 A** | `updateBalanceOverview(...)` | 余额概览：期末余额、环比变化 |
| **模块 B** | `updateCashflow(slice)` | 现金流：净流入、流入、流出、退款、转账 |
| **模块 C** | `updateHeatmap()` | ECharts 日历热力图 |
| **模块 D** | `updateMonthlyChart()` | ECharts 月度组合图 |
| **模块 E** | `updateDailyChart(slice)` | ECharts 每日组合图 |
| **模块 F** | `updateSankey()` | ECharts 桑基图 |
| **模块 G** | `updateCategoryPanel()` | ECharts 环形图 |
| **交易列表** | `updateTransactionsView()` | 渲染交易列表（排序+筛选） |
| **图表初始化** | `initCharts()` | 创建 5 个 ECharts 实例 |
| **图表交互** | `bindChartInteractions()` | 绑定所有图表点击事件 |
| **详情弹窗** | `openDayDetail(date)` | 打开日详情 |
| | `openCategoryDetail(category, type)` | 打开类别详情 |
| **时间范围** | `setCustomRange(start, end)` | 设置自定义范围 |
| **货币格式** | `formatMoney(value, currencyCode)` | 格式化金额显示 |
| **Onboarding** | `showOnboarding(currencies)` | 渲染引导流程 |
| | `obFinish()` | 完成引导，调用 setup API |
| **文件操作** | `handleFileUpload()` | 上传 PDF |
| | `handleParsePdf()` | 触发解析 |
| | `pollParseStatus()` | 轮询解析状态 |
| | `handleRefreshData()` | 手动刷新 |
| **配置管理** | `renderAccountsList()` | 渲染账户配置列表 |
| | `renderCurrenciesList()` | 渲染货币配置列表 |
| | `saveEditConfig()` | 保存配置变更 |
| **Tooltip** | `createTxTooltip()` | 创建交易浮窗 |
| | `showTxTooltip(...)` | 显示交易浮窗 |

#### 3.2.4 `styles.css` — 样式表（1899 行）

**职责**：完整的 Dashboard 样式系统。

**设计系统**：

| 特性 | 实现 |
| :--- | :--- |
| 设计风格 | Airtable 风格（Coral 强调色 #aa2d00） |
| 字体 | Plus Jakarta Sans（Google Fonts） |
| 主题 | CSS 自定义属性，支持 light/dark/system |
| 布局 | 12 列网格，响应式断点 1200px/900px/640px |
| 卡片 | 圆角 14px，统一阴影层级 |
| 交易列表 | 6 列网格 |
| 模态框 | `.modal.is-open` + 遮罩层 |
| 热力图 | GitHub 风格色块 + 图例 |

#### 3.2.5 `multi-lang.json` — 多语言翻译字典

**职责**：存储 zh/en/fr 三种语言的完整翻译。

**覆盖范围**：品牌名称、导航标签、侧边栏、余额/现金流指标、图表标签、状态消息、Toast 消息、通知消息、交易类别名称、Onboarding 流程、配置管理。

### 3.3 模块间调用关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         api_server.py                            │
│                     （Flask 服务器，唯一入口）                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HTTP 请求                                                       │
│    │                                                            │
│    ├─ GET /                  → landing.html                      │
│    ├─ GET /api/users         → users.json                       │
│    ├─ GET /<uid>/            → index.html                       │
│    ├─ GET /<uid>/app.js      → app.js                           │
│    ├─ GET /<uid>/styles.css  → styles.css                       │
│    ├─ GET /<uid>/multi-lang  → multi-lang.json                  │
│    ├─ GET /<uid>/data/*      → data_users/<uid>/*               │
│    │                                                            │
│    ├─ POST /<uid>/api/upload ──────────────────────────────┐    │
│    │                                                       │    │
│    ├─ POST /<uid>/api/parse ───▶ _parse_watcher() ─────────┤    │
│    │                                  │                    │    │
│    │                                  ▼                    │    │
│    │                          ┌──────────────┐             │    │
│    │                          │  parser.py   │             │    │
│    │                          │  (子进程)     │             │    │
│    │                          ├──────────────┤             │    │
│    │                          │              │             │    │
│    │                          │  ┌────────────────────┐   │    │
│    │                          │  │ Anthropic SDK      │   │    │
│    │                          │  │ (AI API, 见 .env)  │   │    │
│    │                          │  └────────────────────┘   │    │
│    │                          │              │             │    │
│    │                          │  ┌────────────────────┐   │    │
│    │                          │  │ check_transactions │   │    │
│    │                          │  │ detect_reclassify  │   │    │
│    │                          │  └────────────────────┘   │    │
│    │                          │              │             │    │
│    │                          └──────────────┘             │    │
│    │                                  │                    │    │
│    │                                  ▼ (成功后自动)        │    │
│    │                          _do_refresh()                │    │
│    │                                  │                    │    │
│    │                          ┌───────┴───────┐            │    │
│    │                          ▼               ▼            │    │
│    │                  ┌──────────┐    ┌──────────┐         │    │
│    │                  │fetch_fx  │    │processor │         │    │
│    │                  │  .py     │    │  .py     │         │    │
│    │                  │ (子进程)  │    │ (子进程)  │         │    │
│    │                  ├──────────┤    ├──────────┤         │    │
│    │                  │Frankfurter│   │ 读取:    │         │    │
│    │                  │ API      │    │  txn.json│         │    │
│    │                  │          │    │  fx.json │         │    │
│    │                  │ 写入:    │    │  cfg     │         │    │
│    │                  │ fx.json  │    │ 写入:    │         │    │
│    │                  └──────────┘    │ ui/*.json│         │    │
│    │                                  └──────────┘         │    │
│    │                                                       │    │
│    ├─ POST /<uid>/api/refresh ──▶ _do_refresh() ───────────┘    │
│    ├─ GET /<uid>/api/fx_status ──▶ _check_fx_stale()            │
│    ├─ POST /<uid>/api/auto_refresh ──▶ _do_auto_refresh()       │
│    ├─ GET /<uid>/api/parse/status                               │
│    ├─ GET /<uid>/api/messages                                   │
│    ├─ POST /<uid>/api/setup                                     │
│    ├─ GET/PUT /<uid>/api/config/accounts                        │
│    └─ GET/PUT /<uid>/api/config/currencies                      │
│                                                                 │
│  FX 自动刷新: 前端页面加载时检查 >24h 则自动触发                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        前端 (app.js)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  fetch JSON                                                     │
│    ├─ data/config/accounts.json                                 │
│    ├─ data/config/currency.json                                 │
│    ├─ data/ui/ui_daily_series.json                              │
│    ├─ data/ui/ui_static_charts.json                             │
│    ├─ data/ui/ui_transactions_and_categories.json               │
│    ├─ data/ui/ui_currency_breakdown.json                        │
│    ├─ data/database/fx_rate.json                                │
│    └─ multi-lang.json                                           │
│                                                                 │
│  渲染                                                          │
│    ├─ ECharts: heatmap, monthly, daily, sankey, donut           │
│    ├─ DOM: balance, cashflow, transaction list, modals          │
│    └─ i18n: data-multi-lang 属性驱动                            │
│                                                                 │
│  用户操作 → API 调用                                             │
│    ├─ handleFileUpload()   → POST /<uid>/api/upload             │
│    ├─ handleParsePdf()     → POST /<uid>/api/parse              │
│    ├─ pollParseStatus()    → GET /<uid>/api/parse/status        │
│    ├─ handleRefreshData()  → POST /<uid>/api/refresh            │
│    ├─ obFinish()           → POST /<uid>/api/setup              │
│    └─ saveEditConfig()     → PUT /<uid>/api/config/*            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、Python 数据使用与产出明细

本章详细列出每个 Python 脚本读取和写入的所有数据文件，以及 AI API 的输入输出格式。

### 4.1 `parser.py` — 数据读写明细

#### 读取的数据

| 文件 | 路径 | 用途 |
| :--- | :--- | :--- |
| `accounts.json` | `config/accounts.json` | 注入 AI prompt，提供账户代码和名称 |
| `currency.json` | `config/currency.json` | 注入 AI prompt，提供币种代码和 ISO 映射 |
| `parsed.json` | `database/parsed.json` | 读取已处理文件哈希，跳过重复 PDF |
| `transactions.json` | `database/transactions.json` | 读取已有交易，用于去重和序号映射 |
| `parse_transactions.txt` | `prompts/parse_transactions.txt` | AI 提示词模板 |
| `*.pdf` | `raw_input/*.pdf` | 待解析的银行账单 PDF |

#### 写出的数据

| 文件 | 路径 | 内容 |
| :--- | :--- | :--- |
| `transactions.json` | `database/transactions.json` | 追加新解析的交易记录（含退款/转账标记） |
| `parsed.json` | `database/parsed.json` | 追加已处理文件的哈希、文件名、时间、账户代码 |
| `parser.log` | `logs/parser.log` | 解析过程日志 |

#### AI API 调用详情

**输入格式**（Anthropic Messages API）：

```json
{
    "model": "<AI_MODEL from .env>",
    "max_tokens": 20480,
    "system": "<系统提示词，包含账户和货币信息>",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "[Page 1]"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "<base64>"}},
                {"type": "text", "text": "[Page 2]"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "<base64>"}}
            ]
        }
    ]
}
```

**系统提示词结构**（`parse_transactions.txt`）：

```
你是一个银行账单解析助手。请从图片中提取所有交易记录。

账户信息：
{accounts_json}

货币信息：
{currency_json}

输出要求：
- 输出纯 JSON 数组，不要 markdown 围栏
- 每条交易包含：date, account_code, type_code, currency, amount, balance, category, description, raw_text
- type_code 只能为 1（收入）或 2（支出）
- category 必须为指定枚举值之一
- description 语言必须与账单语言一致
```

**AI 输出格式**：

```json
[
    {
        "date": "2026-05-01",
        "account_code": "001",
        "type_code": 2,
        "currency": "01",
        "amount": 45.50,
        "balance": 9550.50,
        "category": "Food",
        "description": "麦当劳",
        "raw_text": "消费 支付宝-麦当劳"
    }
]
```

**AI 输出经 Python 处理后的最终交易记录**：

```json
{
    "transaction_id": "TX-001-20260501-001",
    "date": "2026-05-01",
    "account_code": "001",
    "type_code": 2,
    "cashflow_direction": 2,
    "currency": "01",
    "amount": 45.50,
    "balance": 9550.50,
    "category": "Food",
    "description": "麦当劳",
    "raw_text": "消费 支付宝-麦当劳",
    "processed_at": "2026-05-15T10:30:00+08:00",
    "source_hash": "ff9e1399..."
}
```

### 4.2 `check_transactions.py` — 数据读写明细

#### 读取的数据

| 文件 | 路径 | 用途 |
| :--- | :--- | :--- |
| `transactions.json` | `database/transactions.json` | 读取所有交易记录 |
| `parsed.json` | `database/parsed.json` | 读取解析历史（获取文件名映射） |

#### 写出的数据

| 文件 | 路径 | 内容 |
| :--- | :--- | :--- |
| `transactions.json` | `database/transactions.json` | 移除校验失败的 PDF 对应交易 |
| `parsed.json` | `database/parsed.json` | 移除校验失败的 PDF 记录 |
| `processor.log` | `logs/processor.log` | 校验日志（独立运行时） |

#### 校验逻辑

按 `source_hash` + `currency` 分组，验证余额链：

```
对于同一组内的交易（按 date + transaction_id 排序）：
    expected_balance = prev_balance + signed_amount
    actual_balance = tx.balance
    if |expected_balance - actual_balance| > 0.01:
        标记该校验失败
```

### 4.3 `detect_reclassify.py` — 数据读写明细

#### 读取的数据

| 文件 | 路径 | 用途 |
| :--- | :--- | :--- |
| `transactions.json` | `database/transactions.json` | 读取所有交易记录进行匹配 |

#### 写出的数据

| 文件 | 路径 | 内容 |
| :--- | :--- | :--- |
| `transactions.json` | `database/transactions.json` | 更新匹配成功的交易的 type_code |
| `detect_reclassify.log` | `logs/detect_reclassify.log` | 检测日志 |

#### 退款检测逻辑（`detect_refunds`）

```
输入: transactions 列表
遍历每笔 cashflow_direction=2（流出）的交易 tx_out:
    遍历每笔 cashflow_direction=1（流入）的交易 tx_in:
        if 同账户 AND 同币种 AND tx_in.date > tx_out.date:
            if 金额为小数:
                窗口 = 60 天
            elif 金额为整数 AND 金额 <= 5:
                跳过
            else:
                窗口 = 30 天
            if tx_in.date - tx_out.date <= 窗口:
                if |tx_in.amount - tx_out.amount| <= 0.005:
                    tx_out.type_code = 3  // 退款
                    tx_in.type_code = 3   // 退款
```

#### 转账检测逻辑（`detect_transfers`）

```
输入: transactions 列表
遍历每笔 cashflow_direction=2（流出）的交易 tx_out:
    遍历每笔 cashflow_direction=1（流入）的交易 tx_in:
        if 不同账户 AND 同币种:
            if tx_in.date - tx_out.date <= 3 天:
                if tx_out.amount * 0.97 <= tx_in.amount <= tx_out.amount:
                    tx_out.type_code = 4  // 内部转账
                    tx_in.type_code = 4   // 内部转账
                    if tx_out.amount > tx_in.amount:
                        生成手续费交易（type_code=2, category="Other"）
```

### 4.4 `fetch_fx.py` — 数据读写明细

#### 读取的数据

| 文件 | 路径 | 用途 |
| :--- | :--- | :--- |
| `currency.json` | `config/currency.json` | 获取币种列表和 ISO 代码 |

#### 写出的数据

| 文件 | 路径 | 内容 |
| :--- | :--- | :--- |
| `fx_rate.json` | `database/fx_rate.json` | 全量汇率矩阵 |
| `fetch_fx.log` | `logs/fetch_fx.log` | 获取日志 |

#### 外部 API 调用

| API | URL | 参数 | 返回 |
| :--- | :--- | :--- | :--- |
| Frankfurter | `https://api.frankfurter.app/latest` | `from=USD&to=CNY,HKD,EUR,JPY` | `{date, rates}` |

#### 汇率矩阵构建逻辑

```
输入: base_rates = {USD: 1.0, CNY: 7.25, HKD: 7.82, EUR: 0.92, JPY: 150.5}

对于每对币种 (A, B):
    rates[A][B] = base_rates[B] / base_rates[A]

示例:
    rates["CNY"]["USD"] = 1.0 / 7.25 = 0.137931
    rates["CNY"]["HKD"] = 7.82 / 7.25 = 1.078621
    rates["USD"]["CNY"] = 7.25 / 1.0 = 7.25
```

### 4.5 `processor.py` — 数据读写明细

#### 读取的数据

| 文件 | 路径 | 用途 |
| :--- | :--- | :--- |
| `accounts.json` | `config/accounts.json` | 获取账户配置（别名、默认币种等） |
| `currency.json` | `config/currency.json` | 获取币种配置（符号、别名等） |
| `transactions.json` | `database/transactions.json` | 获取所有交易记录 |
| `parsed.json` | `database/parsed.json` | 获取文件名映射（用于交易记录的 file_name 字段） |
| `fx_rate.json` | `database/fx_rate.json` | 获取汇率矩阵（用于跨币种转换） |

#### 写出的数据

| 文件 | 路径 | 内容 | 大小量级 |
| :--- | :--- | :--- | :--- |
| `ui_daily_series.json` | `ui/ui_daily_series.json` | 每日时间序列 | ~730KB |
| `ui_static_charts.json` | `ui/ui_static_charts.json` | 热力图 + 月度图数据 | ~107KB |
| `ui_transactions_and_categories.json` | `ui/ui_transactions_and_categories.json` | 完整交易列表 + 分类数据 | ~6.2MB |
| `ui_currency_breakdown.json` | `ui/ui_currency_breakdown.json` | 账户多币种余额明细 | ~1KB |
| `processor.log` | `logs/processor.log` | 处理日志 | - |

#### 数据转换管线详解

**阶段 1：准备交易数据 (`prepare_transactions`)**

```
输入: transactions 列表, 目标币种, 汇率矩阵, 转换模式

"转换" 模式（default / default_local）:
    对每笔交易:
        if 交易币种 ≠ 目标币种:
            amount = amount * rates[交易币种][目标币种]
            balance = balance * rates[交易币种][目标币种]
        保留原始 currency 字段

"过滤" 模式（具体币种代码）:
    仅保留 currency == 目标币种的交易
```

**阶段 2：构建每日序列 (`build_daily_series`)**

```
输入: 交易列表（已按 account_code 分组）

对每个账户:
    1. 找到第一笔交易日期 → 起始日
    2. 找到全局最后交易日期 → 结束日
    3. 构建从起始日到结束日的连续日期列表
    4. 遍历每一天:
        if 当天有交易:
            end_balance = 最后一笔交易的 balance
            all_inflow = sum(所有 cashflow_direction=1 的 amount)
            all_outflow = sum(所有 cashflow_direction=2 的 amount)  // 负数
            refund = sum(所有 type_code=3 的 |amount|) / 2
            internal_transfer = sum(所有 type_code=4 的 |amount|)
            filtered_inflow = sum(所有 type_code in {1,2} AND direction=1 的 amount)
            filtered_outflow = sum(所有 type_code in {1,2} AND direction=2 的 amount)
        else:
            end_balance = 前一天的 end_balance  // 前向填充
            所有流量字段 = 0

        start_balance = 前一天的 end_balance（第一天为当天 end_balance - 当天净流量）
```

**阶段 3：汇总总资产 (`build_total_series`)**

```
对每一天:
    total.end_balance = sum(所有账户的 end_balance)
    total.all_inflow = sum(所有账户的 all_inflow)
    total.all_outflow = sum(所有账户的 all_outflow)
    total.refund = sum(所有账户的 refund)
    total.internal_transfer = sum(所有账户的 internal_transfer)
    total.filtered_inflow = sum(所有账户的 filtered_inflow)
    total.filtered_outflow = sum(所有账户的 filtered_outflow)
```

**阶段 4：生成静态图表数据**

```
build_heatmap(series, days=90):
    取最后 90 天数据
    输出: [{date, net_inflow}, ...]
    其中 net_inflow = all_inflow + all_outflow

build_monthly_combo(series, months=12):
    按月分组
    输出: [{month, end_balance, inflow, outflow}, ...]
    end_balance = 月末最后一天的 end_balance
    inflow/outflow = 该月所有天的 all_inflow/all_outflow 之和
```

**阶段 5：序列化交易记录 (`build_transactions_output`)**

```
对每笔交易:
    添加字段:
        alias: accounts[account_code].alias      // 多语言别名
        balance: tx.balance                        // 交易后余额
        account_code: tx.account_code
        account_number: accounts[account_code].account_number
        type_code: tx.type_code
        currency: tx.currency
        raw_text: tx.raw_text
        processed_at: tx.processed_at
        source_hash: tx.source_hash
        file_name: parsed[source_hash].file_name   // 来源文件名
```

### 4.6 数据文件流转全景图

```
                    ┌─────────────────────────────────────────┐
                    │           用户手动维护的配置              │
                    ├─────────────────────────────────────────┤
                    │  config/accounts.json                   │
                    │  config/currency.json                   │
                    └──────┬──────────────┬───────────────────┘
                           │              │
              ┌────────────┘              └────────────┐
              ▼                                        ▼
    ┌─────────────────┐                      ┌─────────────────┐
    │   parser.py     │                      │   fetch_fx.py   │
    │                 │                      │                 │
    │ 读取:           │                      │ 读取:           │
    │  accounts.json  │                      │  currency.json  │
    │  currency.json  │                      │                 │
    │  parsed.json    │                      │ 外部调用:       │
    │  transactions   │                      │  Frankfurter API│
    │  *.pdf          │                      │                 │
    │                 │                      │ 写出:           │
    │ AI API 调用:    │                      │  fx_rate.json   │
    │  AI API         │                      └─────────────────┘
    │                 │                               │
    │ 写出:           │                               │
    │  transactions   │                               │
    │  parsed.json    │                               │
    └────────┬────────┘                               │
             │                                        │
             ▼                                        │
    ┌─────────────────┐                               │
    │check_transactions│                              │
    │detect_reclassify │                              │
    │                 │                               │
    │ 读写:           │                               │
    │  transactions   │                               │
    │  parsed.json    │                               │
    └────────┬────────┘                               │
             │                                        │
             ▼                                        ▼
    ┌──────────────────────────────────────────────────────────┐
    │                     processor.py                          │
    │                                                          │
    │  读取:                                                    │
    │   accounts.json, currency.json                           │
    │   transactions.json, parsed.json                         │
    │   fx_rate.json                                           │
    │                                                          │
    │  生成三种货币视角:                                         │
    │   "default"     → 全局默认币种（汇率转换）                 │
    │   "default_local" → 各账户默认币种（汇率转换）             │
    │   "01"/"02"/... → 指定币种（仅过滤，不转换）              │
    │                                                          │
    │  写出:                                                    │
    │   ui/ui_daily_series.json          (每日时间序列)          │
    │   ui/ui_static_charts.json         (热力图+月度图)        │
    │   ui/ui_transactions_and_categories.json (交易+分类)      │
    │   ui/ui_currency_breakdown.json    (多币种余额明细)       │
    └──────────────────────────────────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────────────────────────┐
    │                    前端 (app.js)                          │
    │                                                          │
    │  通过 HTTP 读取所有 JSON 文件                              │
    │  渲染 ECharts 图表 + DOM 组件                             │
    │  用户交互 → 调用 API → 触发后端管线                        │
    └──────────────────────────────────────────────────────────┘
```

---

## 五、关键业务逻辑详解

### 5.1 多币种处理架构

系统支持多币种的核心在于**三重视角**设计：

```
processor.py 为每个视角生成独立的数据集：

视角 1: "default"（全局默认币种）
    用途: 总资产视图，将所有币种转换为全局默认币种
    逻辑: 所有交易金额 × 汇率矩阵 → 统一币种
    包含: "total" + 所有账户

视角 2: "default_local"（各账户默认币种）
    用途: 单账户视图，每个账户使用自己的默认币种
    逻辑: 每个账户内的其他币种交易 × 汇率 → 账户默认币种
    包含: 仅各账户（不含 "total"）

视角 3: 具体币种代码（如 "01"、"02"）
    用途: 纯币种视图，只看特定币种的交易
    逻辑: 仅保留 currency == 目标币种的交易，不做转换
    包含: "total" + 所有账户
```

**前端币种选择逻辑**：

```
用户选择:
    账户 = "total" + 币种 = "default"
        → 使用 "default" 数据集

    账户 = "001" + 币种 = "default"
        → 使用 "default_local" 数据集中的 "001"

    账户 = "001" + 币种 = "02"
        → 使用 "02" 数据集中的 "001"

    用户设置的默认币种 ≠ 处理器默认币种:
        → 对 "default" 数据集应用运行时汇率转换
```

### 5.2 前向填充 (Forward-Fill) 机制

银行交易是稀疏的（某天可能无交易），但图表需要连续数据。

```
原始交易数据:
    2026-05-01: balance = 10000
    2026-05-03: balance = 9500
    2026-05-07: balance = 11000

前向填充后的每日序列:
    2026-05-01: end_balance = 10000, inflow = 0, outflow = -500
    2026-05-02: end_balance = 10000, inflow = 0, outflow = 0    ← 填充
    2026-05-03: end_balance = 9500,  inflow = 0, outflow = -500
    2026-05-04: end_balance = 9500,  inflow = 0, outflow = 0    ← 填充
    2026-05-05: end_balance = 9500,  inflow = 0, outflow = 0    ← 填充
    2026-05-06: end_balance = 9500,  inflow = 0, outflow = 0    ← 填充
    2026-05-07: end_balance = 11000, inflow = 2000, outflow = -500
```

### 5.3 双轨计算（全量 vs 过滤）

不同面板对交易类型的过滤要求不同：

| 面板 | 使用的指标 | 是否排除 type 3/4 |
| :--- | :--- | :--- |
| B. 现金流概况 | `all_inflow` / `all_outflow` | 否（如实反映） |
| C. 热力图 | `all_inflow` / `all_outflow` | 否 |
| D. 月度图 | `all_inflow` / `all_outflow` | 否 |
| E. 每日图 | `all_inflow` / `all_outflow` | 否 |
| F. 桑基图 | `filtered_inflow` / `filtered_outflow` | 是 |
| G. 分类占比 | `filtered_inflow` / `filtered_outflow` | 是 |

### 5.4 余额一致性校验

校验维度：`source_hash`（同一 PDF）+ `currency`（同一币种）

```
校验规则:
    对于同一组内按 date + transaction_id 排序的交易:
        signed_amount = +amount (direction=1) 或 -amount (direction=2)
        expected_balance[i] = balance[i-1] + signed_amount[i]
        actual_balance[i] = tx.balance

        if |expected - actual| > 0.01:
            标记该校验失败

失败处理:
    1. 从 transactions.json 中移除该 PDF 的所有交易
    2. 从 parsed.json 中移除该 PDF 的记录
    3. 重新解析该 PDF（最多重试 3 次）
    4. 连续 3 次失败则记录日志并跳过
```

---

## 六、系统启动与运行

### 6.1 启动流程

```bash
# 使用 conda 环境
conda activate fina-dashboard

# 启动服务器
bash load.sh
# 或直接运行
python src/backend/api_server.py
```

`api_server.py` 启动时执行：

1. 为所有用户创建 `logs/` 目录
2. 启动 Flask 服务器，监听 `0.0.0.0:8000`

FX 自动刷新机制：

- 前端页面加载时调用 `GET /<user_id>/api/fx_status` 检查 FX 是否过期（>24h）
- 若过期则调用 `POST /<user_id>/api/auto_refresh` 触发自动刷新
- 自动刷新失败时写入 `fx_auto_refresh_failed` 标记，阻止重复尝试
- 用户手动刷新后清除标记，恢复自动刷新能力

### 6.2 访问方式

| 地址 | 页面 |
| :--- | :--- |
| `http://<host>:8000/` | 用户选择页面 |
| `http://<host>:8000/<user_id>/` | 用户 Dashboard |
| `http://<host>:8000/api/users` | 用户列表 API |

### 6.3 环境变量

| 变量 | 来源 | 用途 |
| :--- | :--- | :--- |
| `FINANCE_DATA_DIR` | api_server.py 设置 | 指定当前用户的数据目录 |
| `AI_MODEL` | .env | AI 模型名称 |
| `AI_BASE_URL` | .env | AI API 地址 |
| `AI_API_KEY` | .env | AI API 密钥 |

---

## 七、相关文档索引

| 文档 | 内容 |
| :--- | :--- |
| [schema.md](schema.md) | 数据模型定义、字段契约、业务逻辑规则 |
| [process.md](process.md) | processor.py 处理管线、输出 JSON schema |
| [frontend.md](frontend.md) | 前端页面结构、组件布局、交互规范 |
| [progress.md](progress.md) | 开发进度日志、决策记录 |
