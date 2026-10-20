# 个人成长助手 · Student Growth Assistant

软件工程课程项目：在本地完成“规划—执行—复盘—改进”。采用 React + Vite + JavaScript、FastAPI + Python、SQLAlchemy + SQLite、Alembic 及可选 LLM Provider。

## 主要功能

- 两周排程、5分钟网格、允许后分段、三种策略比较与局部重规划；扩大调整范围须明确同意。
- AI或手动任务拆解，审核后创建父子任务；仅可执行子任务参与排程，父任务汇总进度。
- 课程、保护时间、锁定、历史和截止时间保护；确认时后端独立校验并原子保存两周日程。
- 执行反馈、可选计时、长期目标、最近4/8/12周投入及完成趋势、类别与原始估时比较。
- 目标、类别、偏好、课表管理，完整JSON导出/恢复与SQLite备份。

AI只提供建议或草案，未经用户确认不写正式任务和日程；计时或日程结束不代表完成。没有AI配置仍可手动使用核心功能。

## 安装环境与依赖

需要Python 3.11、Node.js 22（本机Node24亦验证过）和npm。在仓库根目录执行。新组员可自行选择环境名称，例如：

```powershell
conda create -n sga_dev python=3.11 pip
conda activate sga_dev
python -m pip install -r backend/requirements.txt -c backend/constraints.txt
python -m pip check
npm --prefix frontend ci
```

维护者继续使用已有`app_env`，不必重建环境；后端命令可改用`conda run -n app_env python ...`。不向base安装依赖，不必创建.venv。已有环境先检查兼容性再安装，避免无关升级。

## 数据库初始化和升级

先备份已有数据、停止其他写入同库的服务，再从根目录执行：

```powershell
conda run -n app_env python scripts/migrate.py
# 其他已激活的Python项目环境：python scripts/migrate.py
```

默认库为`backend/data/app.db`，首次启动会新建；现有库增量升级到`0002_task_hierarchy`。不要删除旧数据库或修改历史revision来消除迁移错误。详见[数据库与恢复](docs/database.md)。

## 配置可选LLM

只在首次配置时复制模板，不覆盖已有文件：

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

编辑本地`backend/.env`，选择一种服务格式，填写该服务支持的模型与自己的Key：

```dotenv
# OpenAI Chat Completions兼容格式
AI_API_FORMAT=openai
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=服务支持的模型名称
OPENAI_API_KEY=自己的密钥
AI_TIMEOUT_SECONDS=120
```

Anthropic Messages兼容服务使用`AI_API_FORMAT=anthropic`及模板中的`CLAUDE_BASE_URL`、`CLAUDE_MODEL`、`CLAUDE_API_KEY`，两组密钥不混用。Base URL填写服务origin或/v1，不附加/messages或/chat/completions。进程环境变量优先于.env；修改后重启后端。超时范围1–120秒。真实调用可能收费，不在业务文本中填写密钥或私人身份资料。

## 启动

打开两个终端，从根目录运行：

```powershell
# 后端；其他已激活的项目环境可将conda前缀替换为python
conda run -n app_env --no-capture-output python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# 前端，另一个终端
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

页面：[http://127.0.0.1:5173](http://127.0.0.1:5173/)，API：[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)。正常模式使用真实北京时间。前端默认请求8000；其他端口须在启动前设置`VITE_API_BASE_URL`，并使用后端允许的本机来源。

生产前端构建：`npm --prefix frontend run build`。本项目没有生产部署、云端同步或多用户认证配置。

## 匿名课程演示

维护者使用已有app_env及已安装的前端依赖：

```powershell
& .\scripts\启动演示版.ps1 -Reset
& .\scripts\停止演示版.ps1
# 从空匿名库开始，只Mock拆解建议并禁止真实模型请求
& .\scripts\启动演示版.ps1 -MockIntegration
& .\scripts\停止演示版.ps1
```

默认前端5174、后端8001，固定北京时间2026-10-14 18:00；-Reset新建UUID匿名库，不删除旧演示库。停止脚本只结束PID、启动时间、执行路径匹配的记录进程，保留数据。普通演示的AI操作仍可能调用实际Provider；离线展示拆解时使用-MockIntegration。只有显式传入-CourseSource才读取指定课表文件。

其他Python环境可手动运行：

```powershell
python scripts/integration_demo.py --serve --port 8001
# 第二个终端
$env:VITE_API_BASE_URL='http://127.0.0.1:8001'
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

手动启动的两个终端分别Ctrl+C停止。演示顺序：在档案创建目标→生成/编辑拆解草案→确认父子任务→局部重规划并采用→添加与未来任务冲突的课程→查看保留/移动与冲突说明→采用→保存子任务实际耗时→Review核对统计→刷新。已开始或锁定的任务不能借扩大范围移动。课表批量导入保留`scripts/import_timetable.py`，默认只预览；显式--apply才写正常库，应先审核输入并备份。

## 目录与交付模式

```text
backend/app/             业务代码、HTTP路由、服务、数据契约
backend/alembic/         冻结基线和有效迁移
backend/requirements.txt Python运行依赖；constraints.txt固定版本约束
frontend/src/            规划、复盘、档案三页与公共组件
frontend/                入口、npm锁文件及Vite配置
scripts/                 迁移、课表导入、匿名演示及其依赖
scripts/.runtime/        本地演示/备份/日志（Git忽略）
docs/                    架构、数据库、API三份统一说明
```

这是`release/course-submission`极简运行版：移除了正式测试、fixtures、CI及开发过程报告，不会在本分支自动执行PR回归。完整测试、CI和开发记录保留于`feat/planning-growth-upgrade`及Git历史；交付前该开发分支678项后端、89项前端测试和构建通过。后续修改应先在完整开发分支补充并执行回归，不把精简版没有测试当成“测试通过”。

[架构](docs/architecture.md) · [数据库](docs/database.md) · [API](docs/api-contract.md)

## 常见问题与限制

- AI不可用：检查格式、模型、Base URL及对应Key，重启后端；手动任务、排程和统计继续使用。日期未明确到钟点时应审核模型建议，不能把自然语言解析视为最终截止时间。
- 页面连不上：检查后端端口、VITE_API_BASE_URL和本机来源；已有服务占端口时不应结束未知进程。
- 排程无完整方案：检查课程、保护、锁定、DDL和时段；30/100任务可能达到搜索预算。每策略20秒不等于整个HTTP请求20秒硬超时。
- 数据恢复：从“我的档案”导出/导入；JSON v2严格兼容v1，恢复后旧候选失效，不直接覆盖运行中的SQLite文件。
- 任务仅两级、每个父任务最多20项；建议顺序不是依赖网络。缺少可靠历史分母时不显示历史完成率，缺失耗时不当作零。

.env、Key、个人课表、数据库、备份、模型日志、node_modules和dist均不提交。项目保留原小组提交历史与作者贡献；本次没有新增许可证，公开仓库不等于额外授权。
