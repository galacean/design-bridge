# Web Packages Design System

Web Packages 使用柔和的 Lab Theme 工作台。视觉基线为 `/ge2dsl-bundle` 的 DSL 编辑页。

## 页面与任务

| 任务 | 页面 | 编排方式 |
| --- | --- | --- |
| 工具入口 | `/` | 居中限宽的格式转换、编辑与重组、验证与回归三列；分区内纵向排列入口，窄屏依次堆叠 |
| 转换与导出 | `/dsl2ge`、`/lottie2ge` | 文件列表、输入与操作、预览与导出 |
| Shader 编辑 | `/shader2ge` | 参数与代码、播放预览；示例库按需展开 |
| DSL 编辑 | `/ge2dsl-bundle` | 文件列表、源 GE / DSL / 保真数据页签、原始与编辑后预览 |
| IR 编辑 | `/ir-editing` | 文件列表、源 GE / IR / 只读保真数据页签、原始与编辑后预览 |
| 转换验证 | `/ge2ir`、`/ge2dsl` | 输入与验证模式、双侧预览、诊断与统计 |
| 格式校验 | `/dsl-validator` | 筛选与执行、统计、文件结果与问题详情；版本信息按需展开 |
| 帧对比 | `/frame-test`、`/svg-frame-test` | 文件列表、输入、原始 / 转换 / Diff、时间轴与报告 |
| 批量回归 | `/auto-frame-test`、`/ge-auto-frame-test`、`/svg-auto-frame-test` | 执行状态、Mocha 报告、按文件分组的帧画廊 |

`/html2figma` 与 `/figma2ge` 使用各自现有布局。柔和主题限定在 `.ui-soft-workbench` 内。

## 共享实现

- 视觉变量与语义类：`src/styles/lab-theme-shared.css`。
- 通用页头：`src/components/workbench-header.tsx`，展示任务名称、说明、首页入口与主题选择。
- 主题状态：`src/theme/theme-mode.tsx`；System / Light / Dark，通过根节点 `data-theme` 应用并本地持久化。
- 共享样式实现：`src/styles/lab-theme-shared.css`；页面级约束以本文件和组件源码为准。

## 视觉规范

- 使用系统字体。页面标题约 20px，正文 13px，辅助信息 12px。
- 背景、面板、预览区域使用 `--workbench-bg`、`--workbench-surface` 与 `--s1` 分层。
- 边框使用 `--workbench-border`，面板圆角 12px，输入、按钮与页签圆角 6px。
- 主操作使用 `--workbench-accent`；次操作保持中性。错误、警告和通过状态保留语义色。
- 页面外边距 16px，小屏 12px；工作区域间距 12px。减少重复标题与说明，保留一个清晰主操作。
- `ui-soft-panel`、`ui-card`、`ui-callout`、`ui-btn`、`ui-soft-tabs`、`ui-soft-file` 为共享配方。
- 播放器空状态使用柔和背景。已加载场景及帧对比图片的背景保留渲染要求，避免影响像素判断。
- 格式校验的版本信息和 Shader 示例库按需展开。业务逻辑与转换契约由原功能模块负责。

## 布局与可访问性

- 首页最大宽度 1440px，桌面两侧留白 32px；Figma 入口归入格式转换，GE 往返对比归入验证与回归。
- 首页在 1100px 以下按分区堆叠、区内双列排列，640px 以下入口单列排列。
- `.ui-workspace` 在桌面使用 200px 文件栏与可伸缩工作区；列表、编辑和结果有独立滚动反馈。
- DSL 输入与预览在宽屏并排；双链路验证保留两侧结果。窄屏按阅读顺序纵向排列。
- SVG 单案例页并排展示 SVG、GE 和差异图预览。
- SVG 批量回归支持筛选案例、查看结果和导出报告。
- 小于 768px 时文件列表最多 220px 高，仍可搜索与选择；页面主内容不产生横向滚动。
- 长 JSON、表格和帧画廊在各自区域滚动。
- 页签使用 tablist / tab / tabpanel，支持 Left / Right / Home / End；选项组使用 `aria-pressed`。
- 文件选中状态使用 `aria-current`；无可见标签的控件提供可访问名称，焦点使用强调色轮廓。
- 小屏按钮与页签最小 40px；默认输入、选择框与按钮保持同高。

## 验收

- 检查 Light / Dark / System 切换和持久化。
- 使用代表性样例检查桌面与 390px 小屏，保存前后截图、样例名称及差异说明。
- 样式修改执行定向静态检查与交互验收；模块签名或共享组件变更增加前端 TypeScript 检查。
