# Design Bridge 包发布指南

本文用于指导发布 npm 包，在 Design Bridge（pnpm monorepo）中安全发布任意 package。

## 1. 先理解仓库发布模型

Design Bridge 是 pnpm monorepo。根目录同时存在两类发布命令：

1. 全量发布（会覆盖 packages 下多个包）
2. 单包发布（只发布指定包）

建议先确认本次目标：

- 发布 tag：`beta` / `alpha` / `latest`
- 新版本号：`x.y.z[-prerelease.n]`

## 2. 环境与权限检查

在仓库根目录执行：

- node -v
- pnpm -v
- npm whoami

命令说明：

- npm whoami：检查当前 npm 登录身份；执行失败通常表示未登录或 token 失效

要求：

- Node.js >= 24
- pnpm >= 10
- npm 账号已登录，且有目标包发布权限

如果未登录：

- pnpm login

发布权限校验（首次）：

- 查看目标包维护者列表：`npm owner ls <target-package>`
- 判断标准：当前用户（npm whoami 输出）应出现在上述命令输出中

如果没有发布权限，需联系包 owner 添加权限

## 3. 发布前校验

建议按照仓库约定顺序执行：

1. pnpm lint
2. pnpm check:ts
3. pnpm test
4. pnpm build

命令说明：

- pnpm lint：执行静态代码风格与规则检查，提前发现明显代码问题
- pnpm check:ts：执行全量 TypeScript 类型检查，确保 API 和类型约束正确
- pnpm test：执行所有 workspace 的测试，包括转换包、工作台和站点，验证功能行为没有回归
- pnpm build：构建 packages 下产物，验证发布前打包链路可用

## 4. 版本号策略

修改目标包的 `package.json` 中 `version` 字段（路径通常是 `packages/<name>/package.json`）。

如果发 beta：

- 例如从 0.0.1-beta.0 升到 0.0.1-beta.1

发布前可检查线上版本：

- npm view <target-package> versions --json

示例（@galacean/shader2ge）：

- npm view @galacean/shader2ge versions --json

### npm Semantic Versioning 2.0.0 语义化版本规范

版本格式：

- `MAJOR.MINOR.PATCH`，例如 `1.4.2`
- 可选预发布后缀：`-<prerelease>`，例如 `1.4.2-beta.1`
- 可选构建元数据：`+<build>`，例如 `1.4.2+20260519`

字段含义：

- MAJOR：不兼容变更（Breaking Change）
- MINOR：向后兼容的新功能
- PATCH：向后兼容的问题修复

预发布版本（prerelease）：

- 常见标识：`alpha`、`beta`、`rc`
- 示例：`1.0.0-alpha.1 < 1.0.0-alpha.2 < 1.0.0-beta.1 < 1.0.0-rc.1 < 1.0.0`
- 预发布版本优先级低于同号正式版本，例如 `1.0.0-beta.2 < 1.0.0`

发布时如何选择升级位：

- 仅修复 bug：`PATCH`，例如 `1.2.3 -> 1.2.4`
- 新增兼容功能：`MINOR`，例如 `1.2.3 -> 1.3.0`
- 引入不兼容改动：`MAJOR`，例如 `1.2.3 -> 2.0.0`
- 灰度验证阶段：使用预发布号，例如 `2.0.0-beta.1`

项目内建议：

- 从 `beta` 转正式时，移除预发布后缀并按语义化规则确认升级位

## 5. 提交版本变更

- git add .
- git commit -m "chore(<scope>): release x.y.z[-tag.n]"

示例（@galacean/shader2ge）：

- git commit -m "chore(shader2ge): release 0.0.1-beta.1"

## 6. 执行发布

在仓库根目录执行：

- pnpm run publish

如果要发布其他 tag，可使用根脚本：

- alpha: `pnpm run publish:alpha`
- beta: `pnpm run publish:beta`

如果 npm 开启了 2FA，按提示输入 OTP 即可。

## 7. 发布后验收（可选）

- npm view <target-package> dist-tags
- npm view <target-package>@<tag> version

验收标准：

- dist-tags 中目标 tag 指向刚发布的版本
- 查询到的版本号与本次发布一致

示例（@galacean/shader2ge）：

- npm view @galacean/shader2ge dist-tags
- npm view @galacean/shader2ge@beta version

## 8. 常见误操作与规避

1. 不要跳过类型检查与测试
- 至少保证 check:ts 和目标包 test/build 通过

2. 不要在版本号未变更时发布
- npm registry 不允许重复发布同版本

3. **‼️重要**：pnpm 执行 publish 时 run 不可缺少

## 9. 发布失败快速排查

如果命令 `pnpm run publish:<tag?>` 失败，优先检查：

1. 是否已经 pnpm login 且账号有权限
2. 版本号是否已递增
3. 本地校验是否失败（check:ts、test、build）
4. 是否触发了 prepublishOnly 构建失败
5. 是否需要输入 OTP（2FA）

## 10. 一页速查

以发布 beta 为例：

```bash
# 1) 环境与登录
node -v
pnpm -v
pnpm whoami || pnpm login

# 2) 校验
pnpm lint
pnpm check:ts
pnpm test
pnpm build

# 3) 发布（beta）
pnpm run publish:beta

# 4) 验收
npm view @galacean/shader2ge dist-tags
npm view @galacean/shader2ge@beta version
```
