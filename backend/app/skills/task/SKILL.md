---
name: task
version: 1
---
# 任务与资料办事

用途：明确创建/修改任务、拆解大任务、记录执行反馈，或通过既有目标/偏好工具管理资料。仅查询任务不生成草案。

先用tasks/goals/preferences精确读取已有资源，不重复创建已有任务。拆解使用breakdown_draft，名称从用户本轮和前文继承，预计时长缺失采用集中默认值60分钟；deadline未指定保持空值，不要求先编一个精确DDL。缺非关键字段也先给初稿；无法可靠拆解时保留可编辑空任务树，不虚构完成结果。原服务校验最多两级、子任务时长及父子DDL，正式创建前必须补齐真实截止，不复制Task表或自建算法。联合安排请求先拆解并确认任务，再单独安排；不能把未确认子任务当正式任务。

简单创建或修改任务复用planning_draft的可编辑任务与候选方案；明确告知采用内容，不能只聊一个时间表。沿用已有task:id/draft引用，避免重复。ready草案更改仅用已协调的edit_draft。

目标/偏好使用profile_draft；执行记录使用feedback_draft及对应业务schema。名称、时长、反馈、任务引用都必须来自真实输入/读取，不能编造完成。资料调整不自动重排，反馈不自动生成复盘。工具可用范围由当前服务端operation限制，技能文字不授予全部工具。

回复先给待审核任务树/变更和查看入口，审核后由用户保存。禁止直接新增Task、改变正式状态或把草案说成已完成。

正例：“报告拆成三个步骤”→读取已有任务并生成拆解草案。反例：“看看今天任务”→只查询。测试：重复任务、缺字段、父子DDL、未确认无写入、资料/反馈版本冲突。

课程和保护时间使用time_rules读取真实规则，profile_draft的create_time_rule/update_time_rule新增、修改或停用。课程kind=course，午休等硬占用kind=protected；每周用weekly+weekday（周一1，周日7），单次用once+date。每天重复须列出7条，不把硬占用降为ai_note或长期记忆。缺上下课时间时只补必要问题；不要猜具体钟点。调整已有周期规则须先读ID，active:false表示停用，保留历史。

“作业做完了花了60分钟”“只做一半还剩90分钟”读取tasks确定真实ID，必要时task_execution核对执行记录，用feedback_draft record_feedback，outcome=completed/partial/postponed；partial必须有剩余分钟，未提供实际耗时保持空值。不要将聊天讨论或计时结束当作完成。

计时使用feedback_draft work_timer，action=start/pause/resume/finish，先用task_execution读取任务和计时。非start须带真实session_id与其updated_at作为expected_updated_at；重复开始已有计时应解释或询问，不另开计时。确认后才变更计时，停止仍须用户另行确认完成反馈。查询进度、耗时或计时状态只读即可。结果和卡片都留在首页聊天，不要求进入已移除的任务与执行入口。

“暂停/结束刚才的计时”未说明任务名时，可先调用无id的task_execution读取真实活动计时；多个暂停计时无法确定时再问具体任务，不把查询当作修改。
