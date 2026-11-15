# 个人成长助手 v2.2

v2.2 将规划、执行反馈和计时集中到首页聊天，日历用于查看及调整正式安排，复盘与档案分别提供执行回顾和长期资料管理。启动、迁移及测试命令见[项目 README](../../README.md)。

## 功能与入口

| 功能 | 使用方式 | 代码入口 |
| --- | --- | --- |
| 首页聊天 | 输入待拆解的任务、课程规则、执行反馈或计时请求。建议在会话中显示，正式修改通过草案卡片确认。 | `frontend/src/components/ConversationChat.jsx`、`backend/app/codex/chat_capabilities.py` |
| 聊天模式 | 在输入框选择计划、复盘或档案，使回复聚焦当前场景。 | [聊天模式](chat-modes.md) |
| 日历 | 在 DayFlow 查看课程、任务和事项，打开事项进行编辑；时刻以北京时间展示。 | `frontend/src/codex/DayFlowWorkspace.jsx`、`backend/app/codex/calendar_api.py` |
| 复盘 | 选择统计区间，查看投入、完成趋势、分类和执行明细。 | `frontend/src/codex/ReviewDashboard.jsx`、`backend/app/services/growth_data.py` |
| 个人档案 | 管理目标、偏好、类别、课程和保护时间，导出或恢复备份。 | `frontend/src/pages/MyProfilePage.jsx`、[数据与迁移](../database.md) |
| 语音输入 | 在聊天框开启麦克风，语音转成输入框文字，由用户检查并发送。 | [界面与语音适配](../../frontend/src/codex/README.md) |

## 日程时间与活动名称

- 未给出时段或钟点时默认08:00；具体说“七点半开始”就保留07:30，冲突或已过时说明原因，不自动改时间。明确允许灵活调整时才避让。
- 支持全天24小时、凌晨和深夜的手动编辑，以及指定跨午夜安排；保留5分钟网格、截止与占用检查。
- “我今天早上要进行升旗仪式，七点半开始，预计半个小时，请你帮我规划草案”会生成“升旗仪式，07:30–08:00，30分钟”。
- 旧草案出现重新计算提示时，点击“保存草案编辑”。缺真实截止时可补填，或主动选择“以安排结束时间作为截止”；正式写入仍须确认。

环境与启动见[美化版说明](../../美化版说明.md)，实现与验证见[修复记录](../beautification/scheduling-fixes-2026-11-16.md)。

## 语音配置

实时听写由后端通过 WebSocket 转接通义千问。启动后端前，在其进程环境中设置 `QWEN_ASR_API_KEY`，也可使用 `DASHSCOPE_API_KEY`。实时模型默认是 `qwen3-asr-flash-realtime`，可通过 `QWEN_ASR_REALTIME_MODEL` 指定。首次使用需允许浏览器访问麦克风。语音服务与聊天模型分别配置，手动输入可独立使用。

## 阅读顺序

- 运行和演示见[项目 README](../../README.md)及[匿名演示](../demo.md)。
- 开发与维护见[架构](../architecture.md)、[API 契约](../api-contract.md)及[数据库迁移](../database.md)。
- 设计背景见 [V2 产品框架](../v2/产品框架设计.md)和 [V2 架构基线](../v2/v2-architecture-proposal.md)。历史验收保存在 `docs/archive/`。
