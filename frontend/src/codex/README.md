# ChatGPT 示例界面适配

基于 [assistant-ui ChatGPT 示例](https://www.assistant-ui.com/examples/chatgpt) 的界面结构和视觉规范适配。

- 上游：[assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui)
- 固定版本：`3fa379f814dadb02b9f9ad04e31c2d2ba92df094`
- 原文件：`apps/docs/components/pages/examples/chatgpt.tsx`
- 上游版本与原文件路径用于追溯适配来源。
- 许可：MIT，完整声明见同目录 `LICENSE.assistant-ui.txt`。

`ChatComposer.jsx` 和 `chatgpt.css` 复用示例的欢迎页、28px 圆角输入区、固定底部与圆形发送按钮，适配现有 React 状态和 Python 后端。颜色、字体和边框复用系统的 `--ink`、`--muted`、`--accent`、`--line`、`--soft`、`--surface`，用户消息使用浅绿色，发送按钮使用系统主绿色。没有引入 assistant-ui 的 Runtime 或示例演示后端。

现有会话、模型配置、流式回复、停止/重试、编辑缓存及草案确认流程继续使用原接口。发送仅限 Enter，Shift+Enter 保留原生换行；中文输入法组合事件、229 键码和长按重复事件不会触发发送。输入框按内容增高，上限 180px。

## v2.2 语音输入

`useDictation.js` 采集麦克风音频，由 `pcm-worklet.js` 处理后经 WebSocket 发送到后端。界面展示实时波形，识别内容写入输入框，由用户检查后发送。配置见 [v2.2 版本指南](../../../docs/v2.2/README.md#语音配置)。
