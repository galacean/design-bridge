# Design Bridge Site

[English](./README.md) | 简体中文

Design Bridge 的双语文档与 API 参考站点。

## 本地开发

需要 Node.js 24+、pnpm 10+ 和 GNU Make。以下命令均从仓库根目录执行。

### 首次检出

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 确认 `site/data/api/` 中有 API manifest 和快照。
   如果缺少文件，运行 `make api-docs` 生成当前源码对应的数据。
   如果要保留已发布的历史版本或译文，请先准备现有 API 数据。
   不要用当前源码重新生成的数据替代。
3. 生成本地预览所需的手册、包 README 数据和搜索索引：

   ```bash
   make site-data
   ```

### 每次启动

```bash
pnpm dev:site
```

站点运行在 `http://localhost:8081`。当手册源文件、包 README 或 API 数据发生变化时，先运行
`make site-data` 刷新生成数据，再启动或刷新预览。`make site-data` 不会生成 API 快照；API
源码或文档注释变化时，先运行 `make api-docs`。

## 配置流转

`docs.config.json` 声明文档来源、支持语言、页面元数据及生产数据前缀。`site.config.ts` 导出类型明确、可直接消费的 `DocsSiteOptions`，集中选择开发/生产数据 URL、解析品牌 URL、合并文案和组装 API 配置。`src/app.tsx` 仅绑定页面声明与 React renderer，并挂载 `<DocsSite config={siteConfig} pages={pages} />`。

`docs.config.json` 中的 `homeHref` 配置为 `/`，运行时使用此配置统一首页和品牌链接，包括应用内的未找到页面；路由路径会添加站点 base 前缀。

`docs.config.json` 只声明 `dataBaseUrls.production`，开发使用本地数据。两个环境地址都可省略；省略生产地址时读取站点 base 下的数据，部署时需将 `data/` 包含在产物中或由宿主在对应路径提供。配置模块直接选择环境地址，缺省时使用应用 base。

应用按页面声明绑定 renderer。每个页面必须有 renderer，`home` 对应 null-slug 首页。文档源语言 `sourceLocale` 为 `en`，访问兜底语言 `defaultLocale` 为 `zh-CN`，两者独立。路由 base 与数据发布前缀也各自独立，后者是 `data/` 之前的前缀。

## 站点数据

- `data/api/`：API manifest 与多语言 TypeDoc 快照。
- `manual-source/`：受版本管理的导航和双语 Markdown 源文件。
- `data/manual/`：由 `make site-data` 生成的手册。
- `data/package-readmes/` 和 `data/search/`：由 `make site-data` 生成的 README 数据与搜索索引。

`make site-data` 依次同步手册、生成 README 数据和搜索索引。只需单独刷新手册时可运行
`make manual-sync`。

## 每次部署

以下命令均从仓库根目录执行。

1. 只有 API 源码或文档注释变化时，才运行以下命令更新 API 快照；否则跳过此步。
   若要保留已有历史版本或译文，请先准备 `site/data/api/` 中的现有数据。
   不要用当前源码生成的数据替代它们。

   ```bash
   make api-docs
   ```

2. 生成站点数据：

   ```bash
   make site-data
   ```

3. 单独发布 `site/data/` 到 CDN。部署工作流构建单页站点，不需要本地 `site/data/` 或路由清单。
   普通 CI 只执行代码检查与测试，不构建站点。

需要在本地构建可部署站点时，运行 `SITE_BASE_PATH=/design-bridge/ make build-site`。
此命令将仓库中的 `site/index.html` 和 `site/404.html` 作为 Vite HTML 入口构建；部署产物为 `site/dist/`。
两个入口加载同一应用，由 Vite 处理资源引用。
`DocsSite` 使用浏览器路由，GitHub Pages 在直达或刷新子路径时通过自定义 404 页面加载应用。
这些路径首次响应的 HTTP 状态仍为 404。
`SITE_BASE_PATH` 必须以 `/` 开始和结束；运行时需要显式站点 origin 时，
可在构建命令前设置 `VITE_SITE_ORIGIN`，例如：

```bash
VITE_SITE_ORIGIN=https://example.com \
SITE_BASE_PATH=/design-bridge/ make build-site
```

## API 文档翻译

`make api-docs` 从源码生成 TypeDoc API 快照，不负责翻译。翻译现有快照时使用
`api-documentation-translation` skill：

1. 从 `site/data/api/manifest.json` 选择包、版本和目标语言对应的快照文件。
2. 运行以下命令提取翻译任务：

   ```bash
   pnpm exec galacean-docs api extract --config site/docs.config.json <snapshot-path>
   ```

3. 按 skill 指引翻译任务中的注释字段，保留字段 key、代码 token 和其他 JSON 数据，
   并生成对应的 translation JSON。
4. 运行以下命令应用翻译结果，再运行 `make site-data` 刷新搜索索引：

   ```bash
   pnpm exec galacean-docs api apply --config site/docs.config.json <task-path> <translation-path>
   ```

`api extract` 使用 manifest 指向的包/版本/语言 wrapper 文件，不要编辑快照或
`api/snapshots/` 中的内容寻址文件。API 源码或注释变化时先运行 `make api-docs`；只更新译文时
不必重生成快照。翻译任务默认写入被忽略的 `tmp/docs-tools/api-translation/`。

## 许可证

[MIT](../LICENSE) © 2019-present Ant Group Co., Ltd.
内嵌的 Remix Icon SVG 路径保留其 [Apache 2.0 许可证](./public/licenses/remix-icon.txt)。
