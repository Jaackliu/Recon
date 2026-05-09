# Finance Dashboard

## 1. 项目定位
这是一个纯本地运行的轻量级个人记账与资产展示网站。你（AI Agent）将负责整个应用的前后端设计、代码实现、文档编写与状态追踪。全程使用 `fina-dashboard` conda 环境。

核心工作流：
- 我会不定期将银行账单（PDF）增量放入指定本地文件夹。
- `parser.py` 读取这些 PDF，然后调用 AI API 进行解析，所有增量更新到包含所有历史交易记录的 `transactions.json`，并维护记录 PDF 解析状态的 `parsed.json`。
- 后端 JSON 数据由 `processor.py` 处理计算，维护前端友好的 JSON 文件。
- 前端（HTML+CSS+JS）读取这些 JSON，进行图表渲染和交互。

## 2. 关键设计原则
- **文档驱动开发**：在修改或添加核心逻辑前，必须先阅读并更新 `docs/` 目录下的文档。
- **职责解耦**：
  - 后端 (Python)：只负责取数据、调用大模型 API 解析数据、执行计算，并生成纯净的 JSON 供前端使用。
  - 前端 (HTML/JS/CSS)：只负责读取生成好的 JSON 并进行可视化呈现，图表时间跨度调节等交互全部在纯前端完成。

## 3. 上下文索引
finance-dashboard/
├── .claude/
│   ├── skills/
│   └── claude.md
├── docs/
│   ├── progress.md      # 更新或查阅项目进度与待办事项
│   ├── schema.md        # 查阅项目后端数据架构与契约
│   ├── process.md       # 查阅项目后端数据处理用于前端显示的架构与契约
│   └── frontend.md      # 查阅项目前端设计架构与契约
├── src/
│   ├── backend/
│   └── frontend/
├── data/
│   ├── raw_input/       # 存放银行账单 PDF
│   ├── database/        # 存放 accounts/parsed/transactions.json 文件
│   ├── ui/              # 存放前端显示相关 JSON 文件
│   └── logs/
├── .gitignore
└── .env

请必须在需要时主动读取文件，严禁凭空猜测。

## 4. 行动准则
在每次收到我的新需求时：
1. 查看 `docs/progress.md` 确认当前状态，需要时查阅 `docs/` 文档。
2. 提出修改或开发计划；如果需求有任何不清楚或矛盾点，需要与我确认；得到我的批准后执行下一步。
3. 需要时，在 `docs/` 进行文档修改或编写。
4. 执行代码编写与重构，确保无误。
5. 更新 `progress.md`。