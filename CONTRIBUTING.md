# Contributing to Design Bridge

Questions and reproducible bug reports belong in [GitHub Issues](https://github.com/galacean/design-bridge/issues).
Pull requests are welcome. Report security concerns through [SECURITY.md](./SECURITY.md), and follow the
[code of conduct](./CODE_OF_CONDUCT.md).

## Setup

Follow the [development guide](./docs/developing.md) for requirements, dependency installation, Chromium setup,
local frontends, build commands, and cleanup. Run repository commands from the root directory.

## Making changes

Read the affected package README and public entry first. Keep changes focused and keep structural refactors separate
from behavior changes. Import other packages through their public `@galacean/*` entry points. Update types, tests, and both
README languages when changing public behavior. Document upgrade steps for breaking changes.

## Validation

Choose checks that cover the change. Documentation changes usually need link and diff checks. For an implementation
change, run ESLint on the affected files and the nearest regression tests. Changes to shared types or cross-package
calls also need type checks. Build affected packages when changing exports, bundling, dependencies, or published
resources. For example:

```bash
pnpm exec eslint packages/dsl-ir/src/dsl2ir/convert.ts
pnpm --filter @galacean/dsl-ir test
pnpm check:ts
pnpm --filter @galacean/html2figma build
```

Global `pnpm lint`, `pnpm test`, and `pnpm build` are available for changes spanning the repository. Include the checks
actually run and their results in the pull request. Rendering changes need representative before/after images and
sample identifiers; ordinary documentation or tooling changes do not need visual evidence.

## Fixtures and resources

Use small, self-contained inputs authored for the regression. Keep tests independent of personal files, `tmp/`, and
external network services. Document the source and license when adding third-party fixtures; do not
assume that a brand page, font, image, or design is reusable because it appears in a test. Strip private content and
unnecessary metadata. Generated output should be reproducible from an approved input.

## Pull requests and support

Explain the problem, resulting behavior, public compatibility impact, and validation. Include migration notes when
needed. Additional rollback detail is useful for high-risk changes. Maintainers prioritize reproducible regressions
in documented behavior; format support and rendering fidelity remain bounded by each package README. Feature requests,
older release backports, and work-in-progress `figma2ge` behavior are handled on a best-effort basis.
