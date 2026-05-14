# Personal Finance Dashboard 数据架构与契约设计

本文档定义了 Personal Finance Dashboard 项目的后端数据模型、核心文件契约以及关键业务处理逻辑。本文件是项目后端数据架构的**唯一真理来源 (Single Source of Truth)**，后续所有的数据解析、清洗和前端 API 生成均需严格遵循此规范。

---

## 一、 核心数据模型 (Schemas)

所有 JSON 数据文件均要求严格的格式规范，**任何字段都不允许出现空值 (null/undefined)**。系统支持的币种以 `data/config/currency.json` 为准，交易与账户字段只使用货币代码。

### 1. `currency.json` (货币配置)
本文件位于 `data/config/currency.json`，由人工手动维护（后端手动新增，前端与 AI API 无权新增），记录系统支持的所有货币类型。

结构为 JSON 数组，每个对象包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 说明 / 约束 |
| :--- | :--- | :--- | :--- |
| **货币代码** | `currency_code` | String | **主键**。两位数字字符串（例："01"），全系统唯一。 |
| **ISO 货币代码** | `currency_iso` | String | ISO 4217 三位大写字母（例："CNY"），用于汇率获取与跨系统对接。 |
| **货币名称** | `currency_name` | String | 用于 AI API 识别（例："人民币"、"美元"、"港币"）。 |
| **货币符号** | `currency_symbol` | String | 用于前端显示（例："￥"、"$"、"HK$"）。 |

### 1.1 `fx_rate.json` (汇率矩阵)
本文件由 `fetch_fx.py` 生成，记录 `data/config/currency.json` 中所有币种之间的全量汇率矩阵，便于后续跨币种计算。

结构为 JSON 对象，包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 说明 / 约束 |
| :--- | :--- | :--- | :--- |
| **数据日期** | `as_of` | String | 汇率日期，格式 `YYYY-MM-DD`。 |
| **数据来源** | `source` | String | 数据源名称（例："Frankfurter (ECB)"）。 |
| **查询基准币种** | `base_iso` | String | 请求第三方汇率接口时所用的 ISO 基准币种。 |
| **货币清单** | `currencies` | Array[Object] | 与 `currency.json` 一致的币种清单，每个对象必须包含 `currency_code`、`currency_iso`、`currency_name`、`currency_symbol`。 |
| **汇率矩阵** | `rates` | Object | 以 `currency_code` 为键的嵌套对象。`rates[A][B]` 表示 A→B 的汇率，**必须包含所有币种两两组合**，同币种汇率为 `1.0`，数值为四舍五入保留 6 位小数的 Float。 |

### 1.2 `settings.json` (全局设置)
本文件由人工手动维护，用于保存全局级别的配置。当前仅用于定义全局默认币种。

结构为 JSON 对象，包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 说明 / 约束 |
| :--- | :--- | :--- | :--- |
| **全局默认币种** | `global_default_currency` | String | 取值必须为 `data/config/currency.json` 中已定义的 `currency_code`。当选择”总资产 + 默认币种”时，使用该币种作为统一显示币种。 |

### 2. `accounts.json` (银行账户配置)
本文件位于 `data/config/accounts.json`，由人工手动维护（后端手动新增，前端与 AI API 无权新增）。AI API 解析账单时必须引入此文件作为 Prompt 上下文，以确保识别出的账户代码完全合法。

结构为 JSON 数组，每个对象包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 说明 / 约束 |
| :--- | :--- | :--- | :--- |
| **银行账户代码** | `account_code` | String | **主键**。手动规定的三位数字符串（例："001"），全系统唯一。 |
| **备注名** | `alias` | String | 仅用于前端展示的易读名称（例："招行主卡"）。 |
| **账户名称** | `account_name` | String | 账户正式名称（例："招商银行借记卡"）。 |
| **发行银行** | `bank_name` | String | 发卡行名称（例："招商银行"）。 |
| **账号** | `account_number` | String | 银行卡号或统一账号。 |
| **持有人名称** | `holder_name` | String | 账户持有人姓名。 |
| **默认币种代码** | `default_currency` | String | `data/config/currency.json` 中已定义的 `currency_code`。 |
| **支持币种代码** | `supported_currencies`| Array[String] | 包含支持的币种代码数组，元素必须为 `data/config/currency.json` 中已定义的 `currency_code`。 |

### 3. `transactions.json` (交易记录流水)
本文件存储所有的历史交易明细。由 AI API 解析账单生成初始数据，再由后端 Python 脚本（`parser.py`）清洗、拼接和重写字段后追加保存。

结构为 JSON 数组，每个对象包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 来源 | 说明 / 约束 |
| :--- | :--- | :--- | :--- | :--- |
| **交易 ID** | `transaction_id` | String | Python | **主键**。格式：`TX-{银行账户代码}-{YYYYMMDD}-{当日三位交易序数}`。 |
| **交易日期** | `date` | String | AI API | 格式约定为 `YYYY-MM-DD`。 |
| **银行账户代码** | `account_code` | String | AI API | 必须是 `data/config/accounts.json` 中已存在的代码。 |
| **交易类型代码** | `type_code` | Integer | AI / Python | **1**: 收入, **2**: 支出 (AI 初始识别仅限 1 和 2)。<br>**3**: 撤销/报销, **4**: 内部转账 (由 Python 后期逻辑覆写)。 |
| **现金流方向** | `cashflow_direction` | Integer | Python | **1**: 流入, **2**: 流出。由 AI 初始 `type_code` 在解析完成后立即写入，后续撤销/报销与内部转账识别 **只改 `type_code` 不改此字段**。现金流所有计算以此字段为准。 |
| **货币代码** | `currency` | String | AI API | 必须为 `data/config/currency.json` 中已定义的 `currency_code`，且必须在对应账户的 `supported_currencies` 中。 |
| **金额** | `amount` | Float | AI API | 交易绝对值金额（正数）。 |
| **帐户余额** | `balance` | Float | AI API | 交易后的账户余额。 |
| **收支类别** | `category` | String | AI API | **必须严格匹配系统设定的枚举值**（详见下文枚举规范），不可无类别。 |
| **具体内容** | `description` | String | AI API | 简短总结条目名、备注、对方收款人等关键信息。 |
| **原始条目** | `raw_text` | String | AI API | 提取自 PDF 的原始文本片段（去除日期等已提取信息）。 |
| **处理日期** | `processed_at` | String | Python | 记录写入 JSON 的系统时间 (ISO 8601 格式)。 |
| **源文件哈希** | `source_hash` | String | Python | 来源 PDF 文件的 SHA-256 哈希值。 |

#### 2.1 收支类别 (Category) 枚举限定
AI API 分类时只能输出以下确切的字符串之一：
*   **支出类别枚举**：`交通`, `餐饮`, `生活`, `购物`, `居住`, `文娱旅游`, `订阅`, `通讯`, `行政`, `外部转账`, `其他`
*   **收入类别枚举**：`外部转账`, `工资`, `奖学金`, `补助`, `税息`, `其他`

### 4. `parsed.json` (解析历史记录)
用于记录已经处理过的银行账单 PDF，防止重复调用 AI API。所有字段均由 Python 维护。

结构为 JSON 数组（或以 `file_hash` 为 Key 的 Object），每个条目包含以下字段：

| 字段名 | 键名 (Key) | 数据类型 | 说明 / 约束 |
| :--- | :--- | :--- | :--- |
| **文件哈希** | `file_hash` | String | **主键**。PDF 文件的 SHA-256 哈希值。 |
| **文件名称** | `file_name` | String | 原始文件名。 |
| **处理时间** | `processed_at` | String | 文件成功解析并入库的时间 (ISO 8601 格式)。 |
| **银行账户代码** | `account_code` | String | 从 AI 识别结果提取。**一个 PDF 只允许出现一个账户代码，若出现多个需触发错误拦截**。 |

---

## 二、 后端核心数据处理逻辑 (Business Logic)

后端的 `parser.py` 在接收到 AI API 返回的中间 JSON 后，必须执行以下数据清洗与校验逻辑，才能最终写入 `transactions.json`。其中第 3、4 节的检测逻辑由 `detect_reclassify.py` 实现，既可由 `parser.py` 调用，也可独立运行。

### 1. 基于日期的防重机制 (Deduplication)
由于银行账单按日结算，单日账单数据具备完整性，但不同 PDF 之间可能有日期重叠。
*   **逻辑**：如果新解析的 PDF 中，包含了 `transactions.json` 内对应 `account_code` 已经存在的日期的记录，必须**丢弃**新解析结果中该重叠日期的所有交易记录。
*   **原则**：仅**增量更新**该账户以往未记录的新日期的交易，历史记录（已存入 `transactions.json` 的数据）保持不变。跨账户之间无需校验去重。

### 2. 现金流方向写入 (Cashflow Direction)
AI 提取交易并完成字段校验后，Python 必须为每条交易写入 `cashflow_direction`。
*   **规则**：`type_code: 1` → `cashflow_direction: 1` (流入)，`type_code: 2` → `cashflow_direction: 2` (流出)。
*   **约束**：后续撤销/报销与内部转账识别只能修改 `type_code`，不得修改 `cashflow_direction`。所有现金流计算均以 `cashflow_direction` 为准。

### 3. 跨账户内部转账识别 (Internal Transfer)
该逻辑旨在将用户自己名下账户间的转账从”收入/支出”修改为”内部转账”，避免虚增总收支。

*   **币种约束**：仅在**同一货币代码**内进行匹配与识别，不跨币种配对。

*   **条件判定**（基于 `cashflow_direction` 匹配，`type_code` 仅作为结果标记）：
    1.  账户 A 出现一笔 `cashflow_direction: 2` (流出)。
    2.  在支出发生后的 **3天内**，账户 B (B != A) 出现一笔 `cashflow_direction: 1` (流入)。
    3.  金额匹配约束：`流出金额 * 97% <= 流入金额 <= 流出金额` (考虑潜在的手续费磨损)。
*   **执行动作**：
    1.  将上述两笔记录的 `type_code` 修改为 `4` (内部转账)。
    2.  计算差值：`手续费 = 流出金额 - 流入金额`。
    3.  若 `手续费 > 0`，则由 Python 生成一条新的交易记录归属于账户 A（类型：`2` 支出，类别：`其他` 或专属手续费类别），与这笔转账记录绑定。

### 4. 撤销/报销识别 (Refund / Reimbursement)
该逻辑旨在识别同一账户内，被退回或报销的款项。

*   **币种约束**：仅在**同一货币代码**内进行匹配与识别，不跨币种配对。

*   **匹配基准**：基于 `cashflow_direction` 判定资金流向，`type_code` 仅作为结果标记。
*   **条件判定 1 (带小数金额)**：账户内存在一笔 `cashflow_direction: 2` (流出) 且带小数的记录，且在 **60天内** 同一账户出现一笔 `cashflow_direction: 1` (流入) 且金额完全相等的记录。
*   **条件判定 2 (大额整数金额)**：账户内存在一笔 `cashflow_direction: 2` (流出) 且为整数且金额 `> 5` 的记录，且在 **30天内** 同一账户出现一笔 `cashflow_direction: 1` (流入) 且金额完全相等的记录。
*   **时序要求**：流入记录必须发生在流出记录之后。
*   **执行动作**：将这两笔对应的交易记录的 `type_code` 修改为 `3` (撤销/报销)。

### 5. 余额一致性校验 (Balance Consistency Check)
该逻辑用于确保 AI 识别的金额方向与余额变化一致，防止错误入库。
*   **校验维度**：以 `source_hash` + `currency` 为单位，每个 PDF 的每种币种独立校验。
*   **校验规则**：按同一账户、同一币种内 `date` + `transaction_id` 顺序，使用 `cashflow_direction` 与 `amount` 计算上一笔余额到当前余额的变动是否一致。
*   **异常处理 (check_transactions.py)**：若发现不一致，记录 PDF 文件名/哈希与出错交易明细，并将该 PDF 对应交易从 `transactions.json` 与 `parsed.json` 删除，便于重跑。
*   **parser 集成**：在撤销/报销与内部转账识别之前执行校验；若发现不一致，自动重跑该 PDF 的 AI 解析并复检，最多 3 次；连续失败则记录问题并移除该 PDF 数据，继续其他流程。

---

## 三、 架构分工与工程约束

### 1. 模块职责
*   **AI API 交互层**：通过单一的 TXT Prompt（包含业务说明、`data/config/accounts.json` 与 `data/config/currency.json` 货币图例），让 AI 同时完成 PDF 读取和中间 JSON 提取。
*   **`parser.py` (数据入库引擎)**：
    *   调用 AI API 并接收初步解析结果。
    *   校验单 PDF 单账户原则。
    *   执行防重去重逻辑。
    *   生成 `transaction_id`、写入 `source_hash` 和 `processed_at`。
    *   基于 AI 初始 `type_code` 写入 `cashflow_direction`。
    *   执行多帐户内部转账与撤销/报销的二次逻辑判定与数据修改。
    *   更新 `transactions.json` 和 `parsed.json`。
*   **`processor.py` (数据聚合引擎)**：
    *   读取 `transactions.json`。
    *   计算每日余额、每日收支聚合、资金流向等汇总数据。
    *   输出专供前端图表（折线图、桑基图、饼状图等）使用的高效聚合 JSON 数据集，确保前端“零计算，只渲染”。

### 2. 日志规范 (Logging)
系统必须部署完善的日志记录 (Logger)。以下关键节点需在 Log 中明确输出，以便审计与排错：
*   AI API 调用时间、消耗 Token 预估、返回状态码及原始响应截取。
*   PDF 处理流程启停与哈希校验结果。
*   单 PDF 多账户异常拦截报警。
*   防重机制触发详情（过滤了哪些账户的哪几天的记录）。
*   内部转账及撤销/报销判定触发日志（包括被修改的 `transaction_id` 及其关联关系）。