# Developing Design Bridge

Repository setup, local development, validation, and maintenance commands. Run commands from the repository root.
Contribution policies are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Setup

Use Node.js 24+, pnpm 10+, and GNU Make. The root `packageManager` field pins the development pnpm version.

```bash
pnpm install --frozen-lockfile
```

HTML integration tests require Chromium from the package's Playwright version:

```bash
pnpm --filter @galacean/html2figma exec playwright install chromium
```

Run the self-contained HTML-to-FIG corpus, including attributed upstream HTML/CSS inputs and regression cases:

```bash
pnpm --filter @galacean/html2figma test:html
HTML2FIGMA_TEST_ARTIFACTS="$PWD/.plans/html-corpus" pnpm --filter @galacean/html2figma test:html
```

The optional output includes Chromium reference PNGs and generated FIG files. It does not imply native Figma visual
acceptance. Input provenance, local resource handling, and validation limits are documented in the
[HTML corpus guide](../packages/html2figma/tests/fixtures/html/README.md).

The workspace includes conversion packages under `packages/`, the `web-packages` workbench, and the `site`
documentation frontend. Package READMEs describe public APIs and runtime requirements.

## Local Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the conversion workbench at `http://localhost:8080` |
| `pnpm dev:site` | Start the documentation site at `http://localhost:8081` |

The documentation site runs independently of conversion package builds.
See the [workbench README](../web-packages/README.md) and [site README](../site/README.md) for frontend-specific details.

Export a targeted frame comparison, including full-resolution source and difference images:

```bash
node web-packages/scripts/frame-test-runner.mjs --fixture=example --output=web-packages/tmp/frame-comparison/example
```

## Validation

Choose the smallest checks that cover the change:

```bash
pnpm exec eslint packages/dsl-ir/src/dsl2ir/convert.ts
pnpm --filter @galacean/dsl-ir test
pnpm --filter @galacean/dsl-ir exec vitest run tests/dsl2ir/convert.test.ts
```

| Command | Scope |
| --- | --- |
| `pnpm lint` | Repository ESLint checks |
| `pnpm check:ts` | Root TypeScript configuration, including package, frontend, and test sources |
| `pnpm test` | Recursively run every child workspace's `test` script |
| `pnpm --filter site check` | Type-check the site with its own TypeScript configuration |

The root TypeScript check uses `tsconfig.check.json`, not each package's build configuration. It excludes `dist/`,
`node_modules/`, `site/data/`, and `tmp/`; JavaScript checking is not enabled. The site's separate check can require
built package declarations because its TypeScript configuration resolves public package entries.

Documentation-only changes normally need link, anchor, and formatting checks rather than tests or builds.
Changes to exports, bundling, dependencies, or published resources require the affected package build and its
generated output to be checked. Record checks actually run and their results; do not run global checks by default.

## Builds

| Command | Output |
| --- | --- |
| `pnpm build` | Build all conversion packages under `packages/` |
| `make manual-sync` | Optional: refresh only manuals under `site/data/manual/` from `site/manual-source/` |
| `make site-data` | Sync manuals and generate package README data and search indexes under `site/data/` |
| `make build-site` | Build all conversion packages, then the static site in `site/dist/` |

The workbench is a local development tool and has no production build command. Use `pnpm dev` to run it and
`pnpm --filter web-packages test` to validate its workflows.

`pnpm dev:site` reads data from local `site/data/` through Vite's `/data/` route; no CDN upload is needed for local
preview. A fresh checkout must first provide API snapshots from the CDN or generate them with `make api-docs`.

Production site builds use package build outputs rather than development source aliases.
The site build checks types, bundles with Vite, and generates static route entries. Run `make site-data` to sync manuals
and generate package README data and search indexes; API snapshots must already be present in `site/data/` for data
generation and static routes. Upload the prepared data to the CDN separately.
Site builds do not extract APIs, import translations, or download history.

## API Documentation

API documentation is prepared manually with the shared `@galacean/docs-tools` CLI, independently of site development,
builds, and Actions:

```text
Configured source-locale comments -> shared TypeDoc model -> other configured locales -> localized snapshots
```

| Command | Purpose |
| --- | --- |
| `make api-docs` | Build TypeDoc, validate configured exports, and archive package-version snapshots |

Package names, directories, tsconfigs, entry points, TypeDoc options, repository links, and source locale are explicit in
`site/site.config.ts`; package versions are independent. Unchanged translations are reused only when source text and
token contracts still match. Missing translations fall back to the configured source locale and emit warnings. Prepare
API snapshots when updating their source, then upload them to the CDN. Package README JSON and search indexes are
generated under `site/data/` by `make site-data` and are not generated by `make build-site`. When `make api-docs`
encounters flat `<SemVer>` history, it initializes the new manifest from current
source and package versions without importing old versions or translations. Existing flat snapshot files are left on
disk but become unreferenced; missing translations fall back to the configured source locale.

See [API documentation translation](../site/README.md#api-documentation-translation) for the snapshot translation workflow.
The [site README](../site/README.md) describes site data and deployment. Manual sources are maintained under
`site/manual-source/`; `make site-data` invokes `make manual-sync` to write the CDN-ready files to `site/data/manual/`.

## Cleaning

Clean commands discover pnpm workspaces automatically, covering conversion packages, both frontends, and the root.

| Command | Removes |
| --- | --- |
| `pnpm clean:dist` | Each workspace's `dist/` output |
| `pnpm clean:artifacts` | Source-adjacent `src/**/*.js.map` files |
| `pnpm clean:declaration` | Workspace-root `*.tsbuildinfo` incremental caches |
| `pnpm clean:nm` | Child workspace `node_modules/`, then root `node_modules/` |
| `pnpm clean:all` | All of the above, with dependencies removed last |

Handwritten source declarations (`.d.ts`) are preserved. Generated declarations in `dist/` are removed with that
directory. After `clean:nm` or `clean:all`, run `pnpm install` before other development commands.

## Maintenance

| Command | Purpose |
| --- | --- |
| `make version` | Interactively select packages and update their version numbers |
| `make verify-fig FILE="/path/to/file.fig"` | Validate a Figma `.fig` file and print a JSON report |

Make targets are defined in the root `Makefile`. Version updates use the `update-version` CLI from `@galacean/release-tools`.
Other executable tools live under `scripts/` without separate READMEs.
The file validation command accepts quoted paths containing spaces and does not require a browser.
Version updates do not publish packages. Follow the [publishing guide](./publish-guide.md) for explicit release steps.
