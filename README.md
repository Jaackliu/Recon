# Recon

本地运行的轻量级记账与资产可视化平台。上传银行账单 PDF，AI 自动解析交易记录，生成交互式仪表盘。

> **网络要求**：虽然所有数据均存储在本地，但前端页面依赖 CDN 加载第三方库（如 ECharts），因此使用时需要联网。此外，AI 解析 PDF 和汇率获取功能也需要网络连接。

---

## 功能概览

### 数据解析

- **PDF 银行账单解析**：上传 PDF 后，系统将每页渲染为 PNG 图片，发送给**支持多模态（图片输入）的 AI API** 进行识别，自动提取所有交易（日期、金额、类别、余额等），结构化存储。支持任何地区、任何语言的银行账单、电子结单、交易流水等，只要文件中包含交易明细和余额信息即可
- **多账户多币种**：支持同时管理多个银行账户，每个账户可持有多种货币（目前仅支持储蓄卡账户）
- **退款/转账自动识别**：自动检测同一账户内的退款（30/60 天窗口）和跨账户内部转账（3 天窗口、97% 容差），避免虚增收支
- **余额一致性校验**：自动验证每笔交易的余额链是否连续，发现异常自动重试解析（最多 3 次）
- **实时汇率转换**：从 Frankfurter API（ECB 数据）获取汇率，构建全量跨币种汇率矩阵

### 前端仪表盘

| 模块 | 展示内容 | 是否受时间范围控制 |
| :--- | :--- | :--- |
| **A. 余额概览** | 当前总余额、环比变化、各账户余额分布 | 是 |
| **B. 现金流概况** | 净流入、流入、流出、退款、内部转账 | 是 |
| **C. 每日热力图** | 近 90 天每日净流入热力图（GitHub 风格） | 否（固定 90 天） |
| **D. 月度组合图** | 近 12 个月月末余额折线 + 月度收支柱状图 | 否（固定 12 个月） |
| **E. 每日组合图** | 所选时间段内每日余额折线 + 收支柱状图 | 是 |
| **F. 资金流向桑基图** | 收入类别 → 总收入 → 总支出 → 支出类别，含动态平衡节点 | 是 |
| **G. 分类占比** | 支出/收入各类别金额占比环形图 | 是 |

### 交互功能

- **账户切换**：侧边栏选择"总资产"或任意单个银行账户
- **货币切换**：选择"默认"（自动转换）或任意具体币种
- **时间范围**：1W / 1M / 3M / 6M / 1Y / All / 自定义日期
- **图表钻取**：点击热力图/月度图/每日图日期跳转，点击桑基图/甜甜圈图类别弹出交易详情
- **交易列表**：支持按时间/金额排序，按收入/支出/退款/转账筛选；hover 显示全部字段元数据
- **交易编辑**：双击任意交易行打开编辑弹窗，可修改类别（下拉选项）和描述（文本字段），其余字段只读，保存后自动刷新
- **主题切换**：浅色 / 深色 / 跟随系统；两种图表配色方案可选
- **设置管理**：在线编辑账户配置和货币配置
- **解析中止**：解析进行中长按"解析 PDF"按钮（600ms），按钮逐渐变红并弹出确认窗口，确认后中止所有解析进程
- **文件管理快捷入口**：长按"上传文件"按钮可直接打开对应操作系统的文件管理器（macOS Finder / Windows 资源管理器），定位到用户的 `raw_input/` 文件夹
- **多用户支持**：每个用户拥有完全隔离的数据目录，通过 Landing Page 选择身份进入
- **三语支持**：界面支持简体中文、English、Français

### 局域网与远程访问

服务默认绑定 `0.0.0.0:8000`，同一局域网内的设备可直接通过 `http://<服务器IP>:8000/` 访问。

如果需要从外网访问（如出差时查看），需要自行配置内网穿透方案（如 frp、Tailscale、Cloudflare Tunnel 等），本项目不提供此功能。

> **数据安全提示**：本项目以纯 JSON 文件存储所有数据（含银行账单解析结果），无内置身份认证和 HTTPS 加密。请确保：
>
> - 仅在可信网络环境中运行
> - 不要将服务暴露到公网（除非已配置认证和 HTTPS）
> - 定期备份 `data_users/` 目录
> - `.env` 文件包含 AI API 密钥，已在 `.gitignore` 中排除，请勿泄露

---

## 配置指南

部署前需要准备以下配置文件。项目提供了模板文件在 `templates/` 目录下，复制后按说明填写即可。

### 配置文件一览

| 文件 | 位置 | 作用 | 是否必须 |
| :--- | :--- | :--- | :--- |
| `.env` | 项目根目录 | AI API 密钥、模型配置和时区设置 | 是 |
| `users.json` | 项目根目录 | 用户注册表（定义所有用户及其数据目录） | 是 |
| `config/accounts.json` | 每个用户的数据目录内 | 银行账户配置（账户代码、银行名称、币种等） | 是（首次使用可由引导页自动创建） |
| `config/currency.json` | 每个用户的数据目录内 | 货币配置（币种代码、ISO 代码、符号等） | 是（首次使用可由引导页自动创建） |

### 方案一：手动配置 JSON（推荐）

适合熟悉命令行的用户，直接编辑 JSON 文件完成所有配置。

#### 步骤 1：配置 AI API

从模板复制并编辑 `.env`：

```bash
cp templates/.env.example .env
```

编辑 `.env`，填入你的 AI API 信息：

```text
AI_MODEL=your-model-name          # 必须支持多模态图片输入
AI_BASE_URL=https://your-api-endpoint/anthropic
AI_API_KEY=sk-your-api-key

TIMEZONE=Asia/Shanghai            # 时区（影响日志时间戳）
```

> 系统使用 Anthropic SDK 调用 AI API，支持任何兼容 Anthropic Messages API 的端点。**所选模型必须支持多模态输入（图片）**，因为系统会将 PDF 页面渲染为 PNG 图片发送给 AI 进行识别。

#### 步骤 2：注册用户

从模板复制并编辑 `users.json`：

```bash
cp templates/users.json.example users.json
```

编辑 `users.json`，为每个用户填写：

```json
[
  {
    "id": "alice",
    "name": "Alice",
    "data_dir": "data_users/alice"
  }
]
```

| 字段 | 说明 |
| :--- | :--- |
| `id` | 用户 ID，用于 URL 路径（如 `http://localhost:8000/alice/`），只允许小写字母、数字、连字符 |
| `name` | 显示名称 |
| `data_dir` | 数据目录路径（相对于项目根目录） |

> **JSON 格式提示**：编辑 JSON 文件时请注意——整个文件用方括号 `[ ]` 包裹，每个账户/货币对象用花括号 `{ }` 包裹，字段之间用逗号 `,` 分隔。最后一个字段后面（结尾的 `]` 前）**不要**加逗号，否则会导致解析报错。

#### 步骤 3：配置银行账户和货币

为每个用户创建数据目录和配置文件（将 `alice` 替换为你在 `users.json` 中设定的用户 ID）：

```bash
# 创建配置目录（其余子目录如 database/、ui/、raw_input/、logs/ 会在首次运行时自动生成）
mkdir -p data_users/alice/config

# 复制配置模板
cp templates/accounts.json.example data_users/alice/config/accounts.json
cp templates/currency.json.example data_users/alice/config/currency.json
```

编辑 `data_users/alice/config/accounts.json`：

```json
[
  {
    "account_code": "001",
    "alias": { "zh": "建行储蓄卡", "en": "CCB Card", "fr": "Carte CCB" },
    "account_name": "中国建设银行储蓄卡",
    "bank_name": "中国建设银行",
    "account_number": "1234567",
    "default_currency": "01",
    "supported_currencies": ["01", "02"]
  }
]
```

| 字段 | 说明 |
| :--- | :--- |
| `account_code` | 账户代码（三位数字字符串，全系统唯一） |
| `alias` | 多语言显示别名（zh/en/fr） |
| `account_name` | 账户全名（作为 AI 解析账单时的上下文参考，建议填写，不填可写 `""`） |
| `bank_name` | 银行名称（作为 AI 解析账单时的上下文参考，建议填写，不填可写 `""`） |
| `account_number` | 账号（AI 解析账单时的核心匹配依据，强烈建议填写）。中国内地银行一般以卡为单位出流水单，此处填写**卡号**；境外部分银行（如汇丰）以账户为单位出流水单，此处填写**账户号码**。请按照你实际流水单/银行账单上显示的信息填写 |
| `default_currency` | 该账户的默认币种代码 |
| `supported_currencies` | 该账户支持的币种代码列表 |

编辑 `data_users/alice/config/currency.json`，一般不需要修改，使用模版即可；需要支持更多货币需自行新增：

```json
[
  {
    "currency_code": "01",
    "currency_iso": "CNY",
    "alias": {"zh": "人民币", "en": "RMB", "fr": "RMB"},
    "currency_symbol": "¥"
  }
]
```

| 字段 | 说明 |
| :--- | :--- |
| `currency_code` | 货币代码（两位数字字符串，全系统唯一） |
| `currency_iso` | ISO 4217 三位字母代码（用于汇率获取） |
| `alias` | 多语言显示别名，建议使用简短名称（如 "RMB"、"HKD"、"USD"），避免冗长的全称 |
| `currency_symbol` | 货币符号（用于前端显示） |

> 模板文件位于 `templates/` 目录，仅作为参考模板，不会被系统加载。系统只读取项目根目录的 `users.json` 和 `data_users/<user_id>/config/` 下的配置文件。

### 方案二：新用户注册页面（不推荐）

> 此方案仅适用于完全不熟悉命令行操作的用户。**推荐使用方案一**，更灵活且不易出错。

如果跳过步骤 2 和步骤 3，直接启动服务后访问 Dashboard，系统会自动弹出 **Onboarding 引导页面**：

1. **选择默认货币**：从预设列表中选择（如人民币、美元、港币等）
2. **添加银行账户**：填写账户代码、银行名称、账号、持有人等
3. **上传 PDF**（可选）：直接上传银行账单 PDF

引导完成后，系统会自动创建 `config/accounts.json` 和 `config/currency.json`。

> 注意：此方案仍需手动完成**步骤 1**（配置 `.env` 和 `users.json`），因为这两个文件是服务启动的前提。

---

## 部署指南

### 方案一：Docker 部署（推荐）

Docker 方案无需手动安装 Python 环境，一键构建部署，支持后台持久运行和自动重启。

#### 1. 安装 Docker

| 平台 | 安装方式 |
| :--- | :--- |
| **macOS** | 下载 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)，安装后启动 |
| **Windows** | 下载 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)，安装后启动（需开启 WSL 2） |
| **Linux** | 参考 [Docker 官方安装文档](https://docs.docker.com/engine/install/)，安装后运行 `sudo usermod -aG docker $USER` 并重新登录 |

安装完成后验证：

```bash
docker --version
docker compose version
```

#### 2. 配置文件

按上方「配置指南」完成以下文件的配置：

- `.env`（AI API 配置）
- `users.json`（用户注册表）
- `data_users/<user_id>/config/`（账户和货币配置，可选——首次使用时通过引导页创建）

#### 3. 启动宿主机桥接服务（可选，允许跳过）

长按"上传文件"按钮可打开操作系统的文件管理器（macOS Finder / Windows 资源管理器 / Linux 文件管理器），定位到 `raw_input/` 文件夹。该功能需要宿主机运行桥接服务：

```bash
python scripts/host_bridge.py &
```

> 桥接服务监听 `127.0.0.1:18923`，仅本机可访问，Docker 通过 `host.docker.internal` 调用（Docker Desktop for Mac / Docker Desktop for Windows 均内置支持）。不启动桥接服务时，长按按钮会改为复制路径到剪贴板。

#### 4. 构建并启动

```bash
docker compose up -d --build
```

首次运行会下载 Python 基础镜像并安装依赖，耗时较长。构建完成后服务自动启动。

访问 **`http://localhost:8000/`** ，选择用户身份进入 Dashboard。建议将此地址保存为浏览器书签，方便日后快速访问。

#### 5. 常用命令

| 操作 | 命令 |
| :--- | :--- |
| 查看日志 | `docker compose logs -f` |
| 停止服务 | `docker compose down` |
| 启动服务 | `docker compose up -d` |
| 重启服务 | `docker compose restart` |
| 更新后重新构建 | `docker compose up -d --build` |

#### 6. 停止所有服务

```bash
# 停止 Docker 容器
docker compose down

# 停止桥接服务（如果启动了）
pkill -f host_bridge.py
```

#### 7. 数据持久化

容器通过挂载宿主机目录实现数据持久化：

| 宿主机路径 | 容器路径 | 说明 |
| :--- | :--- | :--- |
| `./data_users` | `/app/data_users` | 用户数据（账单、配置、日志等） |
| `./users.json` | `/app/users.json` | 用户注册表 |
| `./.env` | `/app/.env` | AI API 配置（只读） |

> 容器时区通过 `.env` 中的 `TIMEZONE` 变量控制，默认为 `Asia/Shanghai`。如需更改，编辑 `.env` 中的 `TIMEZONE` 值并重启容器（`docker compose restart`）。
>
> 容器配置了 `restart: unless-stopped` 策略：宿主机重启后容器会自动启动，运行中崩溃也会自动恢复。如需完全停止，使用 `docker compose down`。

---

### 方案二：Python 直接运行（调试用）

此方案适合开发调试场景，需要手动管理 Python 环境。

#### 1. 配置 Python 环境

```bash
# 创建 conda 环境（推荐）
conda create -n recon python=3.12 -y
conda activate recon

# 安装依赖
pip install -r requirements.txt
```

#### 2. 准备配置文件

同 Docker 方案，按「配置指南」完成 `.env`、`users.json` 和用户数据目录的配置。

#### 3. 启动服务

```bash
bash load.sh
```

服务启动后访问 **`http://localhost:8000/`** 。建议将此地址保存为浏览器书签，方便日后快速访问。按 `Ctrl+C` 停止服务。

---

## 后端运行逻辑

### 数据处理管线

```text
PDF 银行账单
    │
    ▼ parser.py（AI 解析）
交易记录 (transactions.json)
    │
    ├──▶ fetch_fx.py（获取汇率）
    │         │
    │         ▼
    │    汇率矩阵 (fx_rate.json)
    │
    └──▶ processor.py（数据聚合）
              │
              ▼
         前端数据 (ui/*.json)
              │
              ▼
         前端渲染（ECharts 图表）
```

### parser.py — 解析引擎

1. **PDF → 图片**：使用 PyMuPDF 将每页渲染为 200 DPI 的 PNG 图片
2. **图片 → AI**：每 2 页为一组，多进程并行调用 AI API（最多 10 个 worker）
3. **AI → 交易**：AI 返回 JSON 数组，Python 校验字段、分配交易 ID、去重
4. **校验 → 入库**：余额一致性校验，失败则自动重解析（最多 3 次）
5. **后处理**：自动识别退款（type_code 3）和内部转账（type_code 4）
6. **可中止**：解析进行中可通过长按按钮中止进程，发送 SIGTERM 信号终止子进程

### processor.py — 聚合引擎

读取 `transactions.json`，为前端预计算三类数据：

- **每日时间序列**：连续日历 + 前向填充余额 + 双轨流量（全量 vs 过滤）
- **静态图表数据**：热力图（90 天）+ 月度图（12 个月）
- **交易明细**：附带账户别名、来源文件名等元数据

生成三种货币视角：全局默认币种（汇率转换）、各账户默认币种、指定币种（仅过滤）。

### FX 自动刷新

用户访问 Dashboard 时，系统自动检查汇率数据是否过期（超过 24 小时）。若过期则自动触发 `fetch_fx.py` + `processor.py` 刷新汇率和前端数据。

- 自动刷新失败时，系统会提示用户手动刷新，且不会重复尝试
- 用户手动刷新后，自动刷新功能恢复
- 所有刷新通知会标注 `[manual]`（手动）或 `[auto]`（自动）

---

## 用户数据目录结构

每个用户的数据目录按以下结构组织：

```text
data_users/<user_id>/
├── config/                          # [手动] 配置文件
│   ├── accounts.json                # 银行账户配置
│   └── currency.json                # 货币配置
├── database/                        # [自动生成] 核心数据
│   ├── transactions.json            # 交易记录流水
│   ├── parsed.json                  # 已解析文件记录
│   └── fx_rate.json                 # 汇率矩阵
├── ui/                              # [自动生成] 前端数据
│   ├── ui_daily_series.json         # 每日时间序列
│   ├── ui_static_charts.json        # 热力图 + 月度图
│   ├── ui_transactions_and_categories.json  # 交易列表 + 分类
│   └── ui_currency_breakdown.json   # 多币种余额明细
├── raw_input/                       # [用户上传] 银行账单 PDF
└── logs/                            # [自动生成] 运行日志
```

---

## 问题排查

### 解析失败

**症状**：点击"Parse PDF"后显示错误，或通知中出现 `msg.parse_error`。

1. 检查 `data_users/<user_id>/logs/parser.log` 中的详细错误信息
2. 确认 `.env` 中的 AI API 配置正确（模型名、端点地址、密钥）
3. 确认 PDF 文件未损坏且为可读取的银行账单格式
4. 如果是余额校验失败，系统会自动重试 3 次；连续失败的 PDF 会被跳过并记录日志

### 汇率获取失败

**症状**：通知中出现 `msg.fx_error`。

1. 检查 `data_users/<user_id>/logs/fetch_fx.log`
2. 确认网络可访问 `api.frankfurter.app`
3. 确认 `config/currency.json` 中的 `currency_iso` 值为有效的 ISO 4217 代码
4. 可手动触发刷新：前端 Settings → Refresh Data，或重启服务

### 前端数据不更新

**症状**：上传 PDF 后页面数据未变化。

1. 确认解析已完成：通知中应出现 `msg.parse_refresh_done`
2. 刷新浏览器页面（Ctrl/Cmd + R）
3. 如果问题持续，手动触发：前端 Settings → Refresh Data
4. 检查 `data_users/<user_id>/ui/` 目录下是否有生成的 JSON 文件

### 服务无法启动

**症状**：运行 `bash load.sh` 或 `docker compose up` 后服务未启动。

1. 确认 `.env` 文件存在且格式正确
2. 确认 `users.json` 文件存在且为合法 JSON 数组
3. 确认端口 8000 未被占用：`lsof -i :8000`
4. Python 部署：确认依赖已安装（`pip list | grep -E "flask|anthropic|httpx|PyMuPDF"`）
5. Docker 部署：查看容器日志（`docker compose logs`）

### 常见日志文件位置

| 日志 | 路径 | 内容 |
| :--- | :--- | :--- |
| 解析日志 | `data_users/<id>/logs/parser.log` | AI 调用、交易校验、退款/转账检测 |
| 处理器日志 | `data_users/<id>/logs/processor.log` | 数据聚合过程 |
| 汇率日志 | `data_users/<id>/logs/fetch_fx.log` | 汇率获取与矩阵构建 |
| 通知日志 | `data_users/<id>/logs/notifications.jsonl` | 所有操作的通知记录 |

---

## 技术架构

```text
                    ┌──────────────────────────────────┐
                    │         用户浏览器                 │
                    │  (HTML + CSS + JS + ECharts 5)    │
                    └───────────┬──────────────────────┘
                                │ HTTP
                    ┌───────────▼──────────────────────┐
                    │      Flask 服务器 (端口 8000)       │
                    │  api_server.py — REST API + 静态文件 │
                    └──┬─────────┬──────────┬──────────┘
                       │         │          │
              子进程调用 ▼         ▼          ▼
         ┌──────────────┐ ┌────────────┐ ┌──────────────┐
         │  parser.py   │ │ fetch_fx.py│ │ processor.py │
         │  PDF→AI→交易  │ │ 汇率矩阵   │ │ 数据聚合     │
         └──────┬───────┘ └─────┬──────┘ └──────┬───────┘
                │               │               │
         AI API ▼        Frankfurter ▼          │
         ┌──────────┐    ┌──────────┐          │
         │ AI API   │    │ ECB 汇率  │          │
         └──────────┘    └──────────┘          │
                │               │               │
                ▼               ▼               ▼
         ┌──────────────────────────────────────────┐
         │         JSON 文件（用户独立数据目录）        │
         │  config/  database/  ui/  raw_input/  logs/│
         └──────────────────────────────────────────┘
```

### 设计原则

- **前端零计算**：所有业务逻辑在 `processor.py` 中预计算完成，前端仅做数据绑定和图表渲染
- **用户数据隔离**：每个用户的数据目录完全独立，通过环境变量 `FINANCE_DATA_DIR` 传递
- **增量更新**：基于 PDF 文件哈希去重，仅处理新上传的文件
- **无数据库依赖**：所有数据以 JSON 文件存储，零运维成本

---

## 文档索引

| 文档 | 内容 |
| :--- | :--- |
| [docs/structure.md](docs/structure.md) | 系统架构与流程详解（管线图、模块调用、数据流转） |
| [docs/schema.md](docs/schema.md) | 数据模型与字段契约 |
| [docs/process.md](docs/process.md) | 处理器管线与输出 JSON 规范 |
| [docs/frontend.md](docs/frontend.md) | 前端页面结构与交互规范 |
| [docs/progress.md](docs/progress.md) | 开发进度日志 |
