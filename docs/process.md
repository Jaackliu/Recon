# Personal Finance Dashboard 数据流转与预计算契约

本文档详细定义了后端 `processor.py` 的数据处理逻辑以及产出的中间层 JSON 规范。
为严格贯彻**“前端零计算，纯粹重渲染”**的架构思想，并在同时满足**“前端支持自定义任意时间范围”**的需求下，前后端的职责边界划定如下：
*   **后端 (`processor.py`)**：负责所有的业务逻辑解析（如过滤撤销/转账、补全无交易日的余额、汇算总资产、分类聚合）。将离散的交易日志转换为**高密度的连续时间序列数据 (Time-Series)** 和**静态视图数据**。
*   **前端**：对于不受时间控制的图表，直接绑定静态数据；对于受时间控制的面板，仅根据用户选择的日期进行数组的 `slice()` (截取) 和简单的 `reduce()` (累加求和)，绝对不包含任何 `if/else` 的业务过滤逻辑。

---

## 一、 `processor.py` 处理管线 (Processing Pipeline)

`processor.py` 在每次 `parser.py` 更新 `transactions.json` 后手动运行，执行以下四个核心阶段：

### 1. 时间轴对齐与状态前向填充 (Forward-Fill)
银行交易是不连续的（某天可能无交易），但前端曲线图要求每日都有数据。
*   **逻辑**：遍历 `transactions.json`，按日期升序排列。为每个 `account_code` 构建从第一笔交易日到系统当天的**连续每日历 (Dense Calendar)**。
*   **余额推算**：如果某天某账户无交易，则该日 `end_balance` 继承前一天的余额（前向填充）。
*   **全局结束日**：所有账户的日历必须延伸到全体账户的最后交易日（全局最大日期），以保证总资产汇算时不会因单一账户缺少当日记录而被当作 0。

### 2. 总资产虚拟账本汇算 (Total Asset Aggregation)
*   **逻辑**：在连续每日历的基础上，按每一天，将所有 `account_code` 的 `end_balance` 累加，生成一条 `account_code: "total"` 的虚拟记录。
*   **收支汇算**：每日的总收入/总支出为各账户对应项的加和。内部转账（`type_code: 4`）在此过程中的正负差额将被计算并保留，但总余额天然由于一进一出而保持平衡。

### 3. 双轨计算 (Dual-Track Calculation)
为了满足前端不同面板对“交易类型”的不同过滤要求（Cash Flow 包含所有，图表排除 3/4），在遍历计算每日数据时，必须维护两套指标：
*   **全量指标 (All)**：累加所有 `type_code`，流入/流出方向统一由 `cashflow_direction` 决定。用于“B. 现金流”以及所有现金流类图表。
*   **净指标 (Filtered)**：严格排除 `type_code: 3` (撤销/报销) 和 `4` (内部转账)，但流入/流出方向仍以 `cashflow_direction` 为准。用于“F/G 分类类图表”。

### 4. 数据集市生成 (Data Mart Generation)
将计算结果分拆并输出为以下三个高度优化的 JSON 文件，直接供前端 Fetch。

---

## 二、 核心中间 JSON 数据模型 (Intermediate Schemas)

所有由 `processor.py` 生成的 JSON 文件均放在 `data/ui/` 目录下。

### 1. `ui_static_charts.json` (静态全局视图)
专供不受前端时间范围调节器影响的 **C (每日热力图)** 和 **D (月度余额组合图)** 使用。现金流相关金额基于 `all_inflow` / `all_outflow` 计算，包含所有 `type_code`。

```json
{
  "total": {
    "heatmap": [
      { "date": "2023-10-01", "net_inflow": 1500.00 },
      // ... 近 90 天数据，前端直接映射至 7x13 热力图网格
    ],
    "monthly_combo": [
      { "month": "2023-10", "end_balance": 54000.00, "inflow": 12000.00, "outflow": 8000.00 },
      // ... 近 12 个月数据
    ]
  },
  "001": {
    // 结构同上，特定账户 001 的近90天热力与近12个月度数据
  }
}

```

### 2. `ui_daily_series.json` (高密度每日动态序列)

专供 **A (余额概览)**、**B (现金流)**、**E (每日双轴图)** 使用。该文件包含每一天的快照，前端仅需根据时间范围进行 `slice()` 即可获得所需周期的数组。

结构为按账户分组的字典（包含 `"total"`），值为按日期升序的数组：

```json
{
  "total": [
    {
      "date": "2023-10-01",
      "start_balance": 50000.00,       // 当日初余额 (用于计算 B 的比例)
      "end_balance": 50500.00,         // 当日末余额 (用于 A 当前余额、E 的折线)
      
      // --- 全量指标 (用于 B 现金流计算) ---
      "all_inflow": 2000.00,           // 包含撤销与转账在内的所有流入 (方向以 cashflow_direction 为准)
      "all_outflow": -1500.00,         // 包含撤销与转账在内的所有流出 (方向以 cashflow_direction 为准)
      "net_internal_transfer": 500.00, // 仅类型 4 的流入 - 类型 4 的流出 (方向以 cashflow_direction 为准)

      // --- 净指标 (用于 E 的柱状图) ---
      "filtered_inflow": 1000.00,      // 排除类型 3、4 的流入 (方向以 cashflow_direction 为准)
      "filtered_outflow": -500.00      // 排除类型 3、4 的流出 (方向以 cashflow_direction 为准)
    },
    // ... 一直到系统当天
  ]
}

```

**前端使用契约示例**：

* **计算期初余额**：选取截取后数组的第一个元素 `start_balance`。
* **计算当前余额**：选取截取后数组的最后一个元素 `end_balance`。
* **计算环比**：依据当期 `end_balance` 与往前推同等天数位置的 `end_balance` 相比。

### 3. `ui_transactions_and_categories.json` (明细与分类池)

专供 **F (桑基图)**、**G (分类占比与排行)** 以及 **Transactions 列表页** 使用。由于分类的图表必须依据自定义时间范围实时重绘，后端需提供一个清洗后、附带所属类别的列表，以便前端极速求和聚合。
*   **现金流方向**：每条交易必须包含 `cashflow_direction`，供 Transactions 列表页决定金额正负。

```json
{
  "total": {
    "transactions": [
      {
        "id": "TX-001-20231001-001",
        "date": "2023-10-01",
        "type": "expense",             // 映射后的直观文本 (income/expense/refund/transfer)
        "is_filtered": true,           // true 表示类型为 1 或 2，前端画图只统计为 true 的条目
        "category": "餐饮",
        "amount": 45.50,
        "cashflow_direction": 2,
        "description": "麦当劳"
      }
      // ...
    ]
  }
}

```

---

## 三、 前端渲染逻辑契约 (针对 F 桑基图的动态平衡)

对于最为复杂的 **F 资金流向桑基图**，虽然规定前端不进行业务计算，但为了实现桑基图的物理闭环，前端在拿到 `ui_transactions_and_categories.json` 中选定日期范围的 `is_filtered: true` 数组后，需要执行以下基础的图形节点构建逻辑（纯展现逻辑，无业务判断）：

1. 对选中时间段内 `type: "income"` 的条目按 `category` 累加求和，得到**总收入 (Sum_Income)**。
2. 对选中时间段内 `type: "expense"` 的条目按 `category` 累加求和，得到**总支出 (Sum_Expense)**。
3. **动态平衡计算 (图形渲染必需)**：
* 若 `Sum_Expense > Sum_Income`：生成一条流向总支出的连线，连线名称为 `动用余额`，流量大小 = `Sum_Expense - Sum_Income`。
* 若 `Sum_Income > Sum_Expense`：生成一条承接自总收入的连线，连线名称为 `结余留存`，流量大小 = `Sum_Income - Sum_Expense`。


4. 将以上聚合得到的各类目节点、总计节点和平衡节点送入图表组件渲染。

通过以上 `processor.py` 的管线设计，前端被彻底解放为一个纯粹的“数据绑定与筛选呈现层”，所有繁杂的填充、去重、类型分发与账户累加统统锁定在 Python 后端的数据集市生成阶段。
