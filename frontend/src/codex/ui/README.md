# 全站共享 UI

基于 shadcn/ui 的 new-york-v4 / Radix 组件结构，移植为现有 React 19 JavaScript 应用可用的本地源码。MIT 许可见本目录 LICENSE.shadcn-ui.txt。参考源码于 2026-10-31 读取，不宣称兼容所有未来上游版本。

参考：[Button](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/button.tsx)、[Input](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/input.tsx)、[Dialog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dialog.tsx)。

修改内容：保留原浅绿配色、原生输入事件与日期控件；将 TypeScript 转为 JavaScript；以 radix-ui 组合处理菜单/弹窗/标签页，使用 Tailwind 4 和 CVA 管理样式变体。旧按钮 className 的 primary/secondary/subtle 映射为对应变体，布局类保留，避免旧 .button 规则与新控件叠加。旧页面中的隐式表单提交语义保留，新动作显式声明 type="button"。

| 实际使用区域 | 组件 |
| --- | --- |
| 导航、聊天、日历、任务、复盘、档案 | Button、Input、Textarea、NativeSelect、Label |
| 会话更多操作 | DropdownMenu / ConversationActions |
| 草案、表单与页面错误 | Alert，字段旁持续显示错误 |
| 复盘草案状态 | Badge |
| 档案、复盘分区 | Tabs / TabsList / TabsTrigger；原面板挂载与恢复逻辑保留 |
| 日历查看/编辑 | Dialog，提交中不能关闭，失败保留字段 |
| 丢弃编辑、读取远端版本、移除记忆、导入确认 | ConfirmationProvider / AlertDialog |
| 需要等待操作结束的独立确认 | ConfirmAction，锁定重复提交 |

Tooltip 用于两侧的图标按钮；Card、Separator、Skeleton 提供基础实现。复盘图表沿用原 SVG 与统计定义，日程主页面和右侧日历共用 DayFlowWorkspace，分别保留日期和视图状态。

主题入口：../theme.css。旧 styles.css、compact.css、chatgpt.css 通过 legacy CSS layer 导入；规划/统计和自有 DayFlow 样式也在 legacy layer 内。calendar-surface.css 对 DayFlow 的无层级库样式作局部覆盖，移除重复月历并适配容器高度。没有引入全站 Tailwind preflight。语义颜色在 :root 定义，Portal 可以直接继承。文本输入、文本域与选择框使用 16px 圆角、1px 边框，聚焦时切换到原主绿色；复选框保留键盘焦点提示。

原浅绿：选中 #d5e8df、导航 #edf3ef、导航选中 #dbe9df、会话背景 #f5f8f5、主操作 #176e58。新样式与平台默认字体兼容，不下载在线字体。

业务页面从 controls.js 或单个组件导入。新组件代码保持在 src/codex/ui/，用户要求的新文件路径约定继续适用。

工作台布局见 ../layout.css：时间与侧栏按钮使用单个共用顶部工具栏，日历根据实际容器宽度切换一行/两行布局。顶栏使用真实当前时刻，ClockBadge 保留 +08:00 的时间含义，隐藏演示/时区文案，时间计算仍使用 Asia/Shanghai。已有消息的聊天布局见 ../chat-layout.css。

测试：node --test frontend/tests/codex/ui-controls.test.js；完整浏览器脚本位于项目 codex/shadcn-ui-browser.cjs。测试专用 harness 位于 frontend/codex/ui-harness.html，不作为生产入口构建。
