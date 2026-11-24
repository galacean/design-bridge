# AGENTS.md

本文件是 Codex 及其他代码代理在本仓库中的持久执行约束。对外项目说明以
`README.md` 为准；包级行为以对应 `packages/*/README.md`、源码和测试为准。

## 项目概述

Design Bridge 是一个使用 pnpm 管理的 TypeScript monorepo，提供设计与动画数据转换能力，
以及用于本地调试的 Vite + React 前端。仓库没有独立服务端；`web-packages` 通过 Vite
中间件提供少量本地文件 API。

主要工作区：

- `packages/animation-ir`：来源无关的二维动画 IR、类型和校验；IR 数据模型的唯一真源。
- `packages/ge-ir`：Galacean Effects JSONScene 与 Animation IR 的双向转换。
- `packages/dsl-ir`：可编辑 DSL 与 Animation IR 之间的转换、校验和保真重组。
- `packages/figma2ge`：Figma `.fig` 解码及 GE 场景转换。
- `packages/html2figma`：HTML/CSS 到 Figma Scene/剪贴板数据的转换。
- `packages/lottie2ir`：Lottie JSON/ZIP 到 Animation IR 的转换。
- `packages/shader2ge`：GLSL Fragment Shader 到 GE JSONScene 的转换。
- `packages/svg2ir`：SVG 到 Animation IR、GE 场景或静态图层的转换。
- `web-packages`：Vite + React 演示、批处理和验证页面。
- `site`：双语手册、API 参考和浏览器 Demo 文档站。
- `docs`：开发指南和发布等长期维护文档。

## 环境与包管理

- Node.js `>= 24`。
- pnpm `>= 10`，不得使用 npm 或 yarn 安装依赖；仓库通过 `only-allow` 强制 pnpm。
- 从仓库根目录执行安装和全局命令。
- 多个 workspace 共用的第三方版本统一在 `pnpm-workspace.yaml` 的 `catalog` 声明，并在 manifest 中使用 `catalog:`；同一运行时/插件家族应按兼容版本统一。
- 根 `package.json` 只放跨 workspace 共用的开发工具和维护 CLI；运行时依赖声明在实际使用它的包中，包专属测试、构建或脚本依赖放在该包的 `devDependencies`。
- 不要手工修改 `node_modules/`、`dist/` 或 `*.tsbuildinfo`。`tmp/` 和 `web-packages/tmp/`
  是被忽略的本地输入/输出目录，只有任务明确涉及具体素材时才修改对应文件，不得将其当作源码或测试依赖。
- 除非任务明确要求，不要升级依赖、改 lockfile 或运行发布命令。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm dev:site
pnpm lint
pnpm check:ts
pnpm test
pnpm build
make build-site
```

- `pnpm dev` 启动 `web-packages`，默认地址为 `http://localhost:8080`。
- `pnpm dev:site` 启动 `site`，默认地址为 `http://localhost:8081`，开发时使用 workspace 依赖源码。
- `pnpm check:ts` 使用根 `tsconfig.check.json` 检查包、前端和测试，不逐包执行独立配置。
- `pnpm test` 递归执行所有子 workspace 的 `test` 脚本，包含转换包、工作台和站点。
- `pnpm build` 构建所有包；仅在需要验证发布产物时运行。
- `make site-data` 经共享 docs-tools 同步手册并生成 package README JSON 和搜索索引；API 快照须另行准备，生成的数据发布到 CDN。
- `make build-site` 通过 Vite 构建 `site/index.html` 和 `site/404.html`，由前端处理路由，不需要本地 `site/data/`。
- 环境、清理和维护命令见 `docs/developing.md`。
- 优先运行最小相关验证，例如：

  ```bash
  pnpm exec eslint packages/dsl-ir/src/dsl2ir/convert.ts
  pnpm --filter @galacean/dsl-ir test
  pnpm --filter @galacean/dsl-ir exec vitest run tests/dsl2ir/convert.test.ts
  pnpm --filter web-packages test
  ```

## 修改原则

- 阅读范围应与任务匹配。行为、架构或公共 API 改动先阅读目标包 `README.md`（如存在）、
  公开入口、相邻实现和相关测试；局部低风险修改只需检查直接相关代码和调用方。
- 保持修改边界最小；不要顺手重构不相关模块。
- 修复应建立在格式规范和通用语义上，先区分输入数据错误与转换器缺陷，不为单个 fixture
  添加特例；确认根因后再检查同类字段和相邻链路是否受影响。
- 不要覆盖、回退或整理用户已有的未提交改动。
- 结构重构和行为改写不要混在同一次变更中。
- 修改公开行为时同步更新类型、根入口导出、测试和相关包文档。
- 未经用户明确要求，不创建 commit、不 push，也不修改发布状态。

## TypeScript 与代码格式

`eslint.config.mjs` 和 `.editorconfig` 是当前代码规范的实现基准。仓库不使用 Prettier，也没有全局
`format` 命令；不要新增格式化器或对无关文件做批量格式化。修改代码时保持以下约定：

### 基础格式

- 文件使用 UTF-8、LF 换行和 2 个空格缩进，不使用 Tab；保留文件末尾换行，删除行尾空格，
  单行不超过 120 个字符。
- TypeScript 字符串使用单引号，JSX 属性使用双引号；语句保留分号。多行数组、对象、
  参数、import 和 export 在语法允许时保留尾随逗号。
- 运行时对象属性、数组元素、函数参数/实参、import、export 和 enum 成员使用逗号分隔；
  `interface` 和多行 type literal 的成员使用分号。单行 type literal 的成员之间使用分号，
  最后一个成员可以省略结束符；type alias 声明本身仍以分号结束。
- 函数、方法和调用名称与左括号之间不留空格，例如 `function parseValue(value: unknown)`；
  括号内部不添加空格，数组字面量内部也不添加空格。
- 单个简单参数的箭头函数省略参数括号，例如 `value => value`；无参数、多参数、解构参数、
  带类型标注或语法要求的参数保留括号。该约定由 ESLint 的 `arrow-parens: as-needed` 执行。
- 使用 1TBS 大括号风格，控制流必须写大括号；同一文件最多保留一个连续空行。
  变量声明组与后续非声明语句之间、`return` 或 `break` 之前保留一个空行，
  `case`/`default` 前不额外插入空行。
- 短 named import、named export、联合类型和短类型声明优先横向排列。完整结构
  不超过五个成员且不超过行宽时保持单行；需要换行时每个物理行最多五个成员，
  使用 2 个空格缩进，不要机械地让每个成员独占一行。
- named import 直接使用模块导出的名称，不使用 `{ Foo as Bar }` 给单个成员设置本地别名；
  出现本地重名时优先重命名本地符号。`import * as namespace` 是命名空间导入语法，不受此限制。
- 只对本次修改涉及的文件运行 `eslint --fix`；执行后必须检查 diff，确认没有
  改写无关代码或改变已有格式。

### 类型、安全与控制流

- 保持 TypeScript strict；生产源码不得使用显式 `any`、不安全的赋值/调用/成员访问、
  冗余类型、无检查断言或吞掉错误来绕过类型问题。外部动态数据先以 `unknown` 接收，
  再通过类型守卫收窄。
- 仅作为类型使用的符号通过 `import type` 导入。不要保留未使用变量；确需占位的
  局部变量以 `_` 开头，捕获后明确忽略的错误以 `ignore` 开头。
- nullable string、number、boolean 或 unknown 值用于条件判断时，应明确区分 nullish、空字符串、
  `0`、`NaN` 和 `false`，不要依赖含糊的 truthiness。`strict-boolean-expressions` 在生产源码中至少
  以 warning 级别执行。
- 异步逻辑优先使用 `async`/`await`；Promise 必须被 `await`、返回、显式捕获，
  或在确认无需等待时以 `void` 标记。不要通过空的 `catch` 隐藏失败。
- 生产包避免使用 `console.log`；确有必要时仅使用配置允许的 `info`、`warn`、
  `error`、`debug` 或 `trace`。测试和 `web-packages` 虽放宽 console 与部分 unsafe
  规则，也不得借此绕过可表达的类型。
- 保留浏览器可运行链路的兼容性；除明确的 Node.js 工具脚本外，不要在核心转换
  代码中引入 Node.js 专属 API。新增 Web API 时同步检查 `compat/compat` 及目标运行环境。

## 命名与代码结构

本节是代理必须遵守的通用规则：

- 函数和变量使用 camelCase，类型使用 PascalCase，文件和目录使用 kebab-case；`GE`、`IR`、
  `DSL`、`JSON` 等正式缩写保持标准大小写。
- 完整路径应能直接说明转换方向、处理阶段和职责。优先使用 `parser`、`converter`、
  `generator`、`mapping`、`post-process`、`assemble` 等常见阶段名。
- 文件名应描述动作或阶段，避免仅以对象命名的 `layers.ts`、`data.ts`，以及需要额外解释的
  `emit`、`planning`、`engine` 等抽象词。
- `parse...` 负责解释输入，`map...` 负责纯值映射，`convert...` 负责语义转换，
  `build...` 创建局部实体，`assemble...` 组装最终顶层产物；名称必须与真实副作用一致。
- `index.ts` 只允许导出，不编写函数实现、主流程调度或类型定义；实现和类型放在对应职责模块中。
  不要为单个简单函数机械拆文件；同一职责的小函数应放在一个名称清晰的模块中。
- 只有被多个方向或领域共同使用的能力才放入 `common/`。内部实现直接导入职责所有者，
  不增加无意义的 re-export 包装层。
- 公共 API 保持精简。简单工具函数和仅供包内使用的类型不要导出；新增导出前先确认真实外部用例。
- 开源代码注释应专业、精简、准确，只解释必要的约束和原因，不记录临时排查过程、内部对话或
  已废弃系统。

## 包与导入边界

- 跨包生产代码和集成测试只从 `@galacean/<package>` 的公开入口导入，不要通过 `../src`、未声明的
  实现子路径或 `dist` 绕过边界。
- 包内单元测试可以直接导入内部职责所有者，用于验证非公开逻辑；面向使用方行为的测试必须走
  公开入口。
- `packages/*/src/index.ts` 是对应包的稳定公开入口；新增公共能力时显式维护 barrel 导出。
- `@galacean/animation-ir` 是规范化 IR 类型与校验逻辑的唯一真源，不要在其他包复制 IR 模型。
- `@galacean/ge-ir` 负责 IR 与 GE JSONScene 的公共双向转换；共享转换逻辑应放在职责所属包中。
- `@galacean/dsl-ir` 的稳定入口为 `validateDSL`、`convertDSLToIR` 和 `convertIRToDSL`。
  保真编辑链路中的 `dsl` 与 `IRToDSLPreservedData` 必须成对保存和使用。
- GE 与 DSL 的完整链路由调用方显式组合 `@galacean/dsl-ir` 和 `@galacean/ge-ir`。两个包的生产代码不得
  相互依赖；GE 解析、生成及 `GEToIRPreservedData` 处理归 `ge-ir`，DSL 格式、校验和编辑重组归
  `dsl-ir`。配对 sidecar、模型请求、初始布局和业务编辑策略由应用层管理。
- 当前公开数据契约是实现基准；除非任务明确要求，不为旧 DSL、旧保真数据契约
  或历史内部 API 增加隐式迁移和兼容分支。
- GE 标准类型应尽量从真实定义包（如 `@galacean/effects-specification`）导入，但仅在语义与
  wire value 完全一致时替换。历史格式与当前枚举含义不同时，应保留明确命名的兼容常量并说明原因。
- 转换链路应在目录和主流程中显式体现中间格式，例如 `GE -> IR -> DSL` 和
  `DSL -> IR -> GE`，不要把跨阶段逻辑隐藏在含糊的单个转换文件中。

## 测试与验证

验证目标是用最小成本覆盖本次风险，不是机械运行尽可能多的命令。根据影响范围选择验证等级：

- 仅文档、注释、文案或无语义格式调整：通常不运行测试；检查 diff、链接、格式或对应静态规则即可。
- 局部低风险实现修改：运行受影响文件的 ESLint，逻辑变化时再运行最近的单个测试文件或用例；
  不默认执行全仓 TypeScript、整包测试或构建。
- 包内行为修改或缺陷修复：运行直接相关测试；只有影响共享类型、模块签名或多个调用方时才增加
  目标包或全仓 TypeScript 检查。
- 公共 API、共享转换核心、跨包调用、构建配置、依赖或发布产物变更：运行受影响包测试和类型检查，
  并按需构建相关包；修改入口、`exports`、Rollup 或公共运行时 API 时，应构建目标包并检查发布产物。
- 只有改动横跨多个包、影响全局基础设施、准备发布，或用户明确要求时，才运行完整
  `pnpm test` / `pnpm build`。

验证停止规则：

- 最近的定向验证已经覆盖改动且没有新的跨模块风险时应停止，不要为了“更保险”自动扩大到全套。
- 同一轮工作中已通过的验证可以复用；后续只改注释或文档时，不重复运行无关测试。
- `pnpm build` 仅用于入口、exports、声明、Rollup、依赖、资源路径或发布产物相关改动。
- 如果没有运行测试，交付时如实说明“未运行（改动无需测试）”，不要用无关全套测试制造虚假信心。

补充要求：

- 新增或改变行为必须添加或更新回归测试。
- 修复缺陷时，优先先写能复现问题的测试。
- 测试数据默认使用仓库内自包含的最小 fixture；不要让标准测试依赖 `tmp/`、个人本地文件、
  临时下载 URL 或其他不稳定真实素材。
- 重复验证同一无分支路径的测试应合并或参数化；保留测试必须有独立、可说明的回归价值。
- 修改 `web-packages` 时也按上述风险分级；简单文案或样式修改不要求全仓 TypeScript 检查，
  涉及模块签名或资源路径时再运行类型检查和开发服务验证；工作台不提供生产构建命令。
- 渲染结果发生变化时，需要提供代表性样例的前后截图、样例标识和差异说明。
- 不要声称未实际运行的检查已经通过；交付时列出已运行命令和结果。

## 文档与已知约束

- AI 辅助编码过程中创建的方案、实施计划、任务拆解、调研和临时分析文档统一放在根目录 `.plans/`，
  按任务命名；不要放入 `docs/`、`scripts/`、包目录或公开 README。
- `docs/` 仅保留需要长期维护的开发、发布等正式文档；根 README 聚焦项目使用，开发命令集中在
  `docs/developing.md`，站点和包的专项使用说明保留在对应 README 或 `site/manual-source/`。
- 不为已经删除的文档创建占位文件或恢复副本；修正文档入口及引用，确保指向现存资料。
- 文档与实现不一致时，先根据源码、`package.json` 和测试确认事实，再同步修正文档。
- DSL 字段定义以 `packages/dsl-ir/src/dsl/schema.ts` 及对应校验为准；使用与能力说明见包 README 和站点手册。
- `html2figma` 已有实际转换实现；不要沿用其仍为占位包的旧描述。
- `figma2ge` 的 `.fig` 解码链路需要兼容浏览器环境及 zstd/deflate 数据。
- `shader2ge` 面向 WebGL 1.0；保持固定 vertex shader、全屏 Quad 和 GE Runtime attribute 约定。
- Lottie、GE 或 DSL 的保真转换涉及语义变化时，除单元测试外还应检查代表性渲染结果。

处理专门任务时可按需参考仓库内的公开资料：

- 目标包的 `README.md` 或 `README-zh_CN.md`
- `docs/developing.md` 和 `docs/publish-guide.md`
- `site/manual-source/` 中与转换和保真编辑相关的手册源文件
- `web-packages/README.md` 和 `site/README.md`

公开 README 使用 `README.md` 保存英文、`README-zh_CN.md` 保存简体中文。这些资料是项目参考，
不替代本文件、源码和当前测试；不要引用已删除的本地代理配置或个人环境文件。

## 完成标准

交付前应：

1. 确认修改仅覆盖任务要求。
2. 检查本次涉及的公开 API、类型、实现、测试和文档是否一致。
3. 运行足以覆盖风险的最小验证并记录结果；不要机械追加全套检查。
4. 总结改动边界、已运行的验证、剩余风险和未验证事项。
5. 对破坏性变更提供迁移说明；对高风险改动说明可执行的回滚方式。
