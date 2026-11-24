# docs-tools 使用的共享文档数据配置，可通过命令行覆盖。
DOCS_CONFIG ?= site/docs.config.json
TOKEN_ENV_FILE ?= .env

-include $(TOKEN_ENV_FILE)
export YUQUE_EXTERNAL_TOKEN

# 声明本文件中的目标都是命令入口，不对应同名磁盘文件。
.PHONY: manual-sync api-docs site-data build-site version verify-fig

# 将 docs-tools 内置 Skills 同步到当前仓库。
sync-skills:
	pnpm exec galacean-docs skills sync

# 根据 DOCS_CONFIG 指定的配置同步手册内容。
manual-sync:
	pnpm exec galacean-docs manual sync --config "$(DOCS_CONFIG)"

# 根据 DOCS_CONFIG 指定的配置和 TypeDoc 设置生成各包的 API 文档数据。
api-docs:
	pnpm exec galacean-docs api generate --config "$(DOCS_CONFIG)"

# 根据 DOCS_CONFIG 指定的配置，从各 package README 构建文档站可读取的 README 数据。
package-readmes:
	pnpm exec galacean-docs package-readmes build --config "$(DOCS_CONFIG)"

# 根据 DOCS_CONFIG 指定的配置、当前手册与 API 数据构建全文搜索索引。
search-index:
	pnpm exec galacean-docs search build --config "$(DOCS_CONFIG)"

# 生成站点所需的 README 数据和搜索索引。
site-data:
	$(MAKE) package-readmes
	$(MAKE) search-index

# 构建单页站点，使用 GitHub Pages 的 404 页面加载前端路由。
build-site:
	pnpm --filter site build

# 更新仓库中各 package 的版本号。
version:
	pnpm exec update-version

# 验证指定的 .fig 文件，并输出文件信息和校验结果 JSON。
# 用法：make verify-fig FILE=/absolute/path/to/file.fig
verify-fig:
	node scripts/verify-fig-file.mjs "$$FILE"
