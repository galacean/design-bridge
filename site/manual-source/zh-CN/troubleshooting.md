# 常见问题与排查

按现象查找原因。遇到问题时先读诊断：它们是转换器对“哪里被改了、为什么”的第一手说明。

## 诊断速查

| 来源 | 位置 | 要看什么 |
| --- | --- | --- |
| `lottie2ir`、`ge-ir`、`dsl-ir` | `diagnostics[]` | `severity`、`action`（`normalized` / `approximated` / `dropped` / `unsupported`）、`path` |
| `svg2ir` | `warnings[]` | 被降级或丢弃的 SVG 特性 |
| `shader2ge` | `diagnostics[]` | `code` 与 `severity`；**error 必须先处理** |
| `figma2ge` | `issues[]` | warning 与 error，另有 `debugMap` 用于定位节点 |
| `html2figma` | `diagnostics`、`validation` | 资源缺失；文件结构校验 |
| `animation-ir` | `validateIRScene` 的 `errors` / `warnings` | 稳定 `code`、`path`、`layerId` |
| `dsl-ir` | `validateDSL` 的 `errors` / `warnings` | `code`、`path`、`layerId` |

## 转换失败（抛出异常）

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `LottieConverterError` | `INVALID_LOTTIE_JSON`、`ZIP_PARSE_FAILED`、`ZIP_JSON_NOT_FOUND`、`IR_VALIDATION_FAILED`、`CONVERT_PIPELINE_FAILED` | 按 `error.code` 区分，并读取 `details`；ZIP 需包含 Lottie JSON |
| DSL → IR 抛出异常 | DSL 无效、保真数据不匹配 | 先 `validateDSL`；确认 `preservedData` 来自同一场景 |
| IR → GE 抛出异常（粒子） | 缺少可信的 GE 保真数据 | 传回配对的 `preservedData`，或通过 `sources` 提供原始来源导入结果与实例 ID 映射 |
| `particleSources` 放置抛出异常 | 目标几何或来源绑定不合法 | 使用根级粒子叶节点、静态放置、XY 等比缩放，并绑定单个系统或完整耦合来源组 |
| GE → IR 抛出异常 | 入口合成缺失、必要数据非法 | 检查 JSONScene 的 `compositions` |
| `.fig` 解码失败 | 不是 Figma ZIP，或压缩数据损坏 | 确认含 `canvas.fig`；用 `make verify-fig` 检查 |

## 转换成功但结果不对

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| IR/GE 结果中图片或字体不显示 | 相对路径未解析；IR/GE 转换不读取资源 | 传绝对 `resourceBaseUrl`，或使用 ZIP / Data URL，并安排运行时资源加载 |
| 字体与设计稿不同 | 系统字体依赖运行环境 | 提供字体资源；校验会给出 `IR_ASSET_FONT_SYSTEM_PORTABILITY` 警告 |
| 效果缺失或变形 | 出现 `dropped` / `approximated` / `unsupported` 诊断 | 按 `path` 定位，在设计端改写，或接受近似 |
| GE 往返后部分属性丢失 | 没有传回 GE 保真数据，或 IR 编辑后没协调 sidecar | 传 `preservedData`；IR 被改过则先 `updateGEToIRPreservedData` |
| DSL 编辑未生效 | 属于保真写回不支持的编辑（新增图层、改类型） | 看 `onWarning`；在 IR 一侧处理 |
| 图层顺序不对 | 把数组顺序当遮挡顺序 | IR 以数组为 painter order；DSL 用初始 `position.z` |
| 时间不对 | 混淆秒与帧 | IR 用帧（每个合成独立帧率），DSL 与 GE 用秒 |
| 动画比预期长或短 | 合成与图层的 `endBehavior` 不同 | 明确设置 `loop` / `freeze` / `destroy` |
| 校验通过仍渲染不同 | 结构合法不等于像素一致 | 在目标播放器里检查字体、资源和版本 |
| Node 导出的 SVG 静态形状缺失 | 图形烘焙需要浏览器 SVG 与 Canvas 支持 | 在浏览器导出，检查烘焙警告与 `rasterScale` 工作尺寸上限 |
| Lottie 文字不可编辑 | 支持的内嵌字形被转成形状 | 需要可编辑文字时保留字体文本来源，并检查字形回退诊断 |

## Shader

| 现象 | 处理 |
| --- | --- |
| `SHADER_VERSION_UNSUPPORTED` | 改用 GLSL ES 1.0：`varying`、`gl_FragColor`、`texture2D` |
| `SHADER_MAIN_MISSING` / `SHADER_OUTPUT_MISSING` | 提供 `main()` 并写入 `gl_FragColor`，或提供 `mainImage` |
| 播放时 shader 编译报错 | 转换器不做完整 GLSL 编译；在目标设备上排查语法与精度 |
| 外部赋值无效 | 检查 `UNIFORM_OVERRIDE_*` 诊断；`vec2`/`vec3` 改用 `vec4` |
| 纹理变白 | `TEXTURE_FALLBACK_USED`：检查 URL、跨域和输入形态 |

## HTML → Figma

| 现象 | 处理 |
| --- | --- |
| Node 端提取失败 | 确认已安装 Playwright Chromium，并检查 `timeoutMs`、`maxInputBytes` |
| 资源缺失 | 查看 `RESOURCE_NOT_FOUND`；用 ZIP / VirtualProject 带上本地资源 |
| 浏览器 `.fig` 导出提示缺字 | 提供匹配的 `fonts` 字节或授权 Local Font Access，浏览器默认检查字形覆盖 |
| 两端文字度量不同 | 两端都支持字形路径；匹配家族、字重、样式、字体字节与整形，并检查校验警告 |
| 文字变成图片 | 查看 `TEXT_RASTERIZED`，彩色 emoji 和主动启用的合成字体样式会失去文字可编辑性 |
| 导入后布局变化 | `.fig` 默认使用 `snapshot`，需要推断流式布局时才启用 `auto-layout` |
| 动画没有出现 | 本包只做页面快照，不还原动画与交互 |

## 环境与构建

| 现象 | 处理 |
| --- | --- |
| 安装被拒绝 | 仓库强制 pnpm；Node 需 24 以上，pnpm 需 10 以上 |
| 工作台无法列出 GE/DSL/Lottie 素材 | 在对应 `web-packages/tests/fixtures/<format>/urls.txt` 填写 HTTP(S) JSON URL，检查 CORS 和清单错误 |
| 浏览器里引入了 Node 专属 API | 使用各包的 browser 子入口，不要引入 Playwright 链路 |

仍无法定位时：保存最小输入、诊断输出和包版本，在工作台复现，再[提交 issue](https://github.com/galacean/design-bridge/issues)。
也可以回顾[运行环境与限制](../runtime-and-limits/)。
