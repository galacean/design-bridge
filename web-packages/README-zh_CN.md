# web-packages

[English](./README.md) | 简体中文

Design Bridge 的本地 Vite + React 工作台，用于开发与验证，不作为 npm 库发布。

## 目录

- [本地运行](#本地运行)
- [页面](#页面)
- [本地文件与 API](#本地文件与-api)
- [转换边界](#转换边界)
- [项目结构](#项目结构)

## 本地运行

开发环境需要 Node.js 24+ 和 pnpm 10+。在仓库根目录运行：

```bash
pnpm install
pnpm dev
```

工作台默认地址为 `http://localhost:8080`，仅通过开发服务使用，不提供生产构建命令。运行测试：

```bash
pnpm --filter web-packages test
```

帧回归 CLI 需要本机 Chrome、Chromium 或 Edge；未自动检测到时，可用 `CHROME_EXECUTABLE` 指定可执行文件。

界面规范见 [Design.md](./Design.md)。

## 页面

首页按“格式转换、编辑与重组、验证与回归”三列组织工具，Figma 工具归入格式转换。

| 路由 | 用途 |
| --- | --- |
| `/` | 工具导航 |
| `/lottie2ge` | Lottie 转换、GE 渲染验证与视频导出 |
| `/dsl2ge` | DSL 转 GE、在线预览与 JSON 导出 |
| `/shader2ge` | Shader 编辑、参数调整与 GE 预览 |
| `/ge2dsl-bundle` | DSL 编辑：GE 拆分为 DSL 与保真数据、编辑与重新合成 |
| `/ir-editing` | IR 编辑：GE 拆分为 IR 与保真数据、编辑 IR、生成 GE 与预览对比 |
| `/ge2ir` | GE → IR → GE 的保真与标准化往返验证 |
| `/ge2dsl` | GE 输入，经 GE → IR → DSL → IR → GE 的保真往返手动对比；帧率由用户指定 |
| `/dsl-validator` | 批量检测配置的 DSL 输入的格式与语义 |
| `/frame-test` | Lottie 与 GE 的单文件逐帧对比 |
| `/svg-frame-test` | SVG 与 GE 的单案例逐帧对比、预览与导出 |
| `/auto-frame-test` | Lottie → GE 批量帧回归 |
| `/ge-auto-frame-test` | GE 往返转换批量帧回归 |
| `/svg-auto-frame-test` | SVG → GE 批量帧回归 |
| `/figma2ge` | Figma 文件导入、转换与场景预览 |
| `/html2figma` | Browser 本地或 Playwright 兼容模式将 ZIP / HTML 转为 Figma Scene 与剪贴板数据 |

工作台支持 System / Light / Dark 三态主题，主题选择在本地保存。

### 视频导出与场景保存

视频导出默认沿用 GE 主合成的 `previewSize`，通过 `saveToVideo` 的 `width` / `height` 可指定输出尺寸。
渲染采用双倍采样，超出 GPU 最大纹理尺寸时等比缩小，再合成为目标尺寸的视频帧。
MP4 使用 H.264、`yuv420p` 和 CRF 18 编码；奇数宽高补齐为偶数，日志显示实际渲染与输出尺寸。
编码前会将每帧合成为不透明画面，保留半透明边缘的平滑过渡。背景留空时使用黑色；自定义背景色
覆盖在黑底上，透明或半透明颜色也会先合成，不会输出透明 MP4。
视频导出标签页按需加载。导出支持取消，离开标签页会停止当前任务，并释放播放器、编码器和临时 URL。
视频导出依赖浏览器 Canvas / WebGL 与 Worker，请使用 `/lottie2ge` 的视频导出入口。

“保存场景与图片”会将关联图片和 `result.json` 写入 `tmp/output` 的独立目录；
图片保存失败时不会生成清单，页面会显示失败原因。
该入口支持 HTTP(S) 与内嵌图片；无法复制的相对路径或临时 URL 会直接报告失败。

## 本地文件与 API

- 本地文件 API 由 `server/` 实现，通过 `vite.config.js` 注册的 Vite 插件提供
- GE、DSL、Lottie 输入统一读取 `tests/fixtures/<format>/urls.txt`（`ge`、`dsl`、`lottie`）。
  每行一个 HTTP(S) JSON 地址，忽略空行和重复地址。空清单表示无输入；清单缺失或地址无效时明确报错。
  切换输入、修改源文本或清空会取消旧读取。
- 转换与帧对比页面由浏览器直接请求输入 URL，CDN 需允许跨域请求；JSON 中的关联资源应使用公网地址或内嵌数据。
- GE→DSL 批处理：`POST /api/ge2dsl/batch-validate` 使用配置的 GE 输入，输出到本地 `tmp/dsl-input/*.dsl.json`。
  输入以 URL 的稳定哈希命名输出，并以原 URL 作为资源基址；`GET` 查询进度和逐项结果。输出文件不会自动加入 DSL 输入列表。
- DSL 检测器：Vite/浏览器共用 `@galacean/dsl-ir` 的 TypeScript `validateDSL`
- DSL 检测 API：`GET /api/dsl-validator/check` 检测配置的 DSL 输入；`POST /api/dsl-validator/check` 直接检测原始 JSON 文本
- 检测器回归：`pnpm --filter web-packages test:dsl-validator`

SVG 测试从 `tmp/svg_input` 和 `tmp/svg_dynamic_tests/` 读取本地案例，分类和备注保存在 `tmp/svg2ge-case-tags.json`。
批量结果可筛选和导出；确认后可用完整静态回归更新 `tmp/fail-list.txt`。旧 `/svg2ge?fixture=…` 和
`/svg-auto-frame-test.html` 链接仍可使用。

### 输入清单与输出目录

以下路径相对于 `web-packages`。GE、DSL、Lottie 使用 URL 清单，转换结果保存在本地：

| 路径 | 使用方 |
| --- | --- |
| `tests/fixtures/lottie/urls.txt` | Lottie 转换、单文件帧对比与批量帧回归 |
| `tests/fixtures/ge/urls.txt` | GE 往返对比、编辑和回归使用的共享输入 |
| `tests/fixtures/dsl/urls.txt` | DSL 转换与校验使用的共享输入 |
| `tmp/dsl-input` | GE→DSL 批处理输出 |
| `tmp/output` | Lottie 转换输出的 GE 场景及图片资源，供页面预览 |
| `tmp/html-input` | HTML 转 Figma 的临时上传文件，由接口自动清理 |

Lottie 命令行脚本同样读取 `tests/fixtures/lottie/urls.txt`：

- `node scripts/batch-convert.js [--limit 10] [--filter URL-substring]` 输出 `tmp/output/<URL 哈希>.json`。
- `node scripts/local-convert.js` 输出 `tmp/output/<URL 哈希>/result.json`，并将图片保存到 `images/`。

通过修改清单或批处理筛选参数选择输入。脚本参数和输入 API 不接受本地文件路径；
`/api/{ge2ir,dsl2ge,lottie2ge}/read-input/` 接口已移除，调用方直接请求 URL。
浏览器文件选择器仍可用于显式导入单个文件。

Shader 示例由页面提供，Figma 文件由用户导入，不需要固定输入目录。
历史截图、帧报告、诊断脚本与浏览器缓存应保存到系统临时目录，不放入这些数据目录。

仓库环境与验证命令见[开发指南](../docs/developing.md)。

## 转换边界

应用层的 `src/features/dsl-conversion/ge-dsl-workflow.ts` 显式组合两个 adapter：

- `convertGEToDSL`：返回 DSL、`GEDSLPreservedData` 和 diagnostics。
- `convertDSLToGE`：不传 `preservedData` 时从普通 DSL 新建 GE；传入时保真写回 GE。

Web 管理来源选择、编辑状态与保真数据配对。`dsl-ir` 负责 DSL 格式、校验和
来源实例布局和参数重组；`ge-ir` 负责 GE ↔ IR，以及基于源 sidecar 的 GE 资源重组。两个生产包不相互依赖。

运行 `pnpm --filter web-packages test` 验证应用编排。

`GEDSLPreservedData` 由两个 adapter sidecar 组成：

```ts
interface GEDSLPreservedData {
  ir: IRToDSLPreservedData;
  ge: GEToIRPreservedData;
}
```

DSL 编辑页更换源 GE 或导入帧率后，会同时清空旧 DSL、保真数据和转换结果；需要重新生成编辑基准。
上传的 DSL 与保真数据必须来自同一份基准，两份文件可分别读取。

### IR 编辑

`/ir-editing` 使用原始 GE 生成可编辑的 Animation IR。应用修改时，先调用
`updateGEToIRPreservedData` 对照原始 IR 更新保真数据，再通过 `convertIRToGE` 生成 GE。
页面展示转换诊断，并支持原始与编辑后预览及 GE 导出；编辑能力以 `ge-ir` 当前支持范围为准。

保存时同时下载 `ir.json` 与 `preserved-data.json`。后者包含源 GE、原始 IR 和 GE 保真数据，
由页面维护、只读展示。恢复时先导入保真数据，再导入修改后的 IR；每次应用均从原始基准重新计算，
不会覆盖基准或累积清除保真字段。更换源 GE 或导入帧率会清空旧编辑状态。

## 项目结构

```text
web-packages/
├── src/
│   ├── app.tsx          # 按需加载的页面路由与主题入口
│   ├── components/      # 不含转换业务的控件、JSON 编辑器与页头
│   ├── features/        # URL 输入、GE 预览、转换、视频与帧对比能力
│   ├── pages/           # 页面视图、页面专属状态与流程
│   ├── styles/          # Lab Theme 变量与共享样式
│   └── theme/           # 主题状态与持久化
├── server/              # Vite 本地文件 API；只运行在 Node.js
├── scripts/             # 独立运行的命令行工具
├── tests/               # 应用编排回归测试
├── index.html
└── vite.config.js       # 别名、开发配置与本地 API 插件注册
```

### 模块边界

页面负责布局与交互。IR / DSL 编辑页各自通过 `use-ir-editing.ts` / `use-dsl-editing.ts`
管理导入、编辑、保真数据和转换状态，共用文件列表、JSON 编辑器和场景对比视图。
两条编辑链路保留各自的数据规则，不使用通用转换管线。

`features/` 按实际复用能力组织：

- `local-inputs`：URL 清单 API、输入加载与取消、JSON 下载和列表视图。
- `ge-runtime`：GE Runtime 插件注册；播放器与渲染器直接声明依赖，不依赖其他页面先打开。
- `ge-preview`：共享 GE 播放器、主合成元信息与编辑前后预览。
- `dsl-conversion`：显式组合 GE ↔ IR ↔ DSL 的应用流程。
- `frame-comparison`：指标计算、渲染、预览和批量回归报告。
- `ge-video`：视频渲染和编码。

页面不能导入其他页面；多处使用的能力应归入 `features/` 或 `components/`。
共享能力不能反向导入 `pages/`，浏览器代码不能导入 `server/`、`scripts/` 或跨包源码路径。
这些导入边界由 ESLint 检查，TS 和 TSX 都纳入检查。

`server/vite-file-api-plugin.js` 只注册接口，各接口放在 `server/file-api/`。
需要转换能力时通过 Vite 的模块加载器调用公开包入口或明确的应用流程模块，保持开发期源码解析一致。
该目录服务于本地开发，不作为生产后端部署。

全局样式保留主题变量与共享控件；首页、编辑工作台和回归报告的样式由对应入口加载。
新增页面保持独立路由，避免在首页同步加载渲染、转换和视频依赖。

Vitest 收集 `tests/**/*.test.ts`、`src/**/*.test.{ts,tsx}` 与 `server/**/*.test.js`。
浏览器内 Mocha 帧回归保留在各回归页的 `frame-regression.spec.ts`，通过页面运行。
本地 API 集成测试使用临时目录和自包含输入，不读取用户的 `tmp/` 素材。

### 帧对比

GE 帧对比在每次同步 seek 时重置固定随机序列，使两侧粒子使用一致的随机输入。
随机函数在 seek 结束或抛错时立即恢复，不覆盖异步资源加载。像素及轮廓阈值不因粒子而放宽。
SSIM 使用黑底合成后的可见颜色；像素差异同时比较可见 RGB 与 alpha 幅度，
避免透明度变化被忽略，也不把完全透明像素中不可见的 RGB 当作差异。
热力图包含颜色与 alpha 差异。两侧继续经 PNG 与统一的 Canvas 2D 管线读取像素，
避免 WebGL 预乘 alpha 差异；GE 顺序往返对比用 PNG 保存原始帧，避免长期保留大量未压缩帧。
