# 聊天模式

在聊天框左下角选择计划、复盘或档案，再输入需求并发送。点击标签上的 × 恢复普通聊天。选择保持到手动取消或切换会话；本轮重试沿用原模式。

前端仅发送 `mode: plan | review | profile | null`，不拼接提示词，也不改变可见消息正文。首页第一条消息与已有会话都支持。

后端标准提示词集中在 `backend/app/codex/composer_modes.py`，在工具决策和最终回复两个模型调用处追加。模式参与相关资料筛选，但不扩大工具权限，也不会自动保存正式资料。实际修改仍走原有草案确认流程。

请求模式存入原有 run payload，无需数据库迁移；同一发送标识不得用于不同模式。重试读取原 run 的模式。取消只影响之后发送的消息。

测试：`backend/tests/codex/test_composer_modes.py`（HTTP、提示词注入、非法模式、幂等冲突、重试、可见消息正文、工具权限），`codex/composer-mode-delivery-browser.cjs`（浏览器发送及取消），`codex/composer-equal-height-browser.cjs`（桌面与小屏稳定布局）。
