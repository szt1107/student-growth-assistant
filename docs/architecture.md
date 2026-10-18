# 现行架构

本项目是本地单用户的规划、执行与复盘工作台。技术栈保持React/Vite/JavaScript、FastAPI/Python、SQLAlchemy/SQLite、Alembic和原有LLM Provider适配层。

## 分层与入口

前端App提供规划、复盘、我的档案三页，所有HTTP请求经过frontend/src/api.js。routers负责HTTP及契约，services负责业务、排程、统计、Provider和事务，models/schemas定义数据和约束。前端不自行声明候选合法。

正常启动使用真实北京时间与backend/data/app.db；匿名演示必须指定独立库及模拟时钟。启动和scripts/migrate.py共用schema_migrations升级入口，冻结迁移位于backend/alembic。使用说明见[README](../README.md)，数据约束见[数据库说明](database.md)，接口见[API契约](api-contract.md)。

## 规划与确认

assistant_ai调用claude_client适配Anthropic Messages或OpenAI Chat Completions，解析JSON并通过Pydantic校验。AI只有建议/草案能力，没有数据库写工具；Provider等待期间释放数据库事务。无AI时保留手动结构化动作和程序排程。

当前Assistant规划本周剩余时间与下周，以5分钟网格生成候选；默认连续，明确允许才有限分段。均衡(4,3,3)、习惯(6,2,2)、稳定(2,6,2)独立评分。原单周scheduler/API继续保留兼容，不能安全表达已有分段、锁定或历史时明确拒绝并引导工作台。

scoped_replanning根据正式快照、当前任务、时间规则和本轮动作识别受影响任务。未受影响且合法的未来安排只在输入副本中临时冻结，不写回任务锁定。局部失败不会自动扩大；独立preview请求明确授权后才扩大。已开始、锁定及正式历史继续保护，范围摘要防止内部元数据被遗漏或篡改后退回旧行为。

用户采用时再次校验时间、DDL、完整剩余量、网格、课程、保护、锁定、正式历史、来源版本和范围。任务修改、两周正式计划及全局版本在一个SQLite事务中提交；过期候选拒绝，失败整批回滚，重复确认幂等。

assistant_scheduler只在同次搜索中复用相同状态评分，无持久评分缓存。每策略20秒、50,000次扩展、64状态；预处理和分段预算检查是粗粒度的，不构成整个HTTP请求硬超时。SEARCH_LIMIT与数学无解分开说明。

## 任务树与执行

Task支持顶层container及executable子任务两级，每个父任务最多20项，禁止自身引用、循环或第三层，子DDL不得晚于父DDL。父任务保存原始预期并汇总子进度，不直接排程、完成、取消或计时。建议顺序仅供展示。

task_breakdown复用GrowthChangeDraft、AssistantSession和消息JSON保存输入、编辑版本及确认任务ID。生成不创建正式任务；编辑和确认校验草案与全局版本；BEGIN IMMEDIATE使整树创建、目标上下文及applied状态原子提交。再次确认返回同一组ID。已有执行/计划事实的任务不允许直接转换类型。

任务完成来自用户明确反馈。计时只辅助填写，结束计时或日历时间经过不自动完成。反馈保存类别、目标、原始估时及任务标题快照，撤回/更正保留历史；父容器不重复贡献完成或投入。

## 成长统计与个性化

growth_statistics在显式只读SQLite快照内按4/8/12周汇总，最多7次SELECT，无统计表、缓存、AI调用或GET写入。完成按有效completed_at归周，投入按occurred_at归周；任务ID去重并排除撤回和父容器，不叠加计时器。

实际分钟缺失为null，合法历史零值与未知分开。类别使用反馈稳定标识；估时比较原始预计与完成前全部有效投入，包含更早周记录，不能用当前剩余时长代替。更正沿supersedes_id追溯，无法可靠配对时排除；至少3个样本才描述类别规律。缺少不可变周初任务集和取消日志，因此不伪造历史完成率/周取消数。

目标使用有效反馈快照，count/deliverable按完成Task ID，time按实际分钟；偏好是可编辑规则，AI观察需确认才成为长期偏好。Review用原生SVG、CSS和可访问表格展示事实，复盘文字仅辅助解释，不改变正式数据。

## 数据与交付

JSON v2保存26张业务表，严格兼容冻结v1转换。恢复整批校验并在事务内替换，提高版本且使旧候选失效；升级前备份及唯一文件名保护旧副本。

极简release删除测试、CI和一次性验收/基准工具；这些保留在完整开发分支。正常运行不导入测试或Mock。scripts/integration_demo.py只在显式匿名启动时Mock拆解并阻止真实模型请求，作为离线课程演示依赖保留。
