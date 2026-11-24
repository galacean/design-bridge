# Design Bridge

English | [简体中文](./README-zh_CN.md)

Design Bridge is a TypeScript monorepo for converting, validating, and editing design and animation data. The
packages use Animation IR as a source-neutral intermediate model and generate Galacean Effects JSONScene when needed.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Packages](#packages)
- [Compatibility](#compatibility)
- [Demo and documentation](#demo-and-documentation)
- [Contributing](#contributing)
- [License](#license)

## Install

Install the packages needed by your application, for example:

```bash
pnpm add @galacean/lottie2ir @galacean/ge-ir
```

Packages can be installed independently. Each package README contains its supported entry points and runtime
requirements. For repository setup, see the [development guide](./docs/developing.md).

## Usage

Choose packages for the conversion stages your application needs. Lottie can be imported with `@galacean/lottie2ir`
and converted to Galacean Effects with `@galacean/ge-ir`; editable workflows combine `@galacean/dsl-ir` with the same IR.
Follow the package READMEs below for supported inputs, public APIs, examples, and preservation requirements.

## Packages

| Package | Purpose | Documentation |
| --- | --- | --- |
| [`@galacean/animation-ir`](./packages/animation-ir/README.md) | Source-neutral animation schema, validation, and adapter contracts | [README](./packages/animation-ir/README.md) |
| [`@galacean/dsl-ir`](./packages/dsl-ir/README.md) | Editable DSL and Animation IR conversion with preserved-data write-back | [README](./packages/dsl-ir/README.md) |
| [`@galacean/figma2ge`](./packages/figma2ge/README.md) | Figma `.fig`/Kiwi data to Galacean Effects JSONScene conversion | [README](./packages/figma2ge/README.md) |
| [`@galacean/ge-ir`](./packages/ge-ir/README.md) | Galacean Effects JSONScene and Animation IR conversion | [README](./packages/ge-ir/README.md) |
| [`@galacean/html2figma`](./packages/html2figma/README.md) | HTML/CSS extraction to Figma Scene, clipboard data, and `.fig` files | [README](./packages/html2figma/README.md) |
| [`@galacean/lottie2ir`](./packages/lottie2ir/README.md) | Lottie JSON and ZIP import into Animation IR | [README](./packages/lottie2ir/README.md) |
| [`@galacean/shader2ge`](./packages/shader2ge/README.md) | GLSL fragment shader conversion to Galacean Effects JSONScene | [README](./packages/shader2ge/README.md) |
| [`@galacean/svg2ir`](./packages/svg2ir/README.md) | SVG import into Animation IR, GE scenes, and static image/text layers | [README](./packages/svg2ir/README.md) |

The package READMEs describe input capability matrices, API signatures, examples, and known limitations. Test
fixtures demonstrate regression cases and do not represent complete format support.

## Compatibility

| Package | Runtime and entry-point notes |
| --- | --- |
| `@galacean/animation-ir` | Node.js 24+; ESM only, with the root and `/adapter` ESM entry points |
| `@galacean/dsl-ir`, `@galacean/ge-ir`, `@galacean/lottie2ir`, `@galacean/shader2ge`, `@galacean/figma2ge` | Node.js 24+; ESM and CommonJS package builds |
| `@galacean/svg2ir` | Node.js 24+; browser and Node conditional entry points; Node uses `svgdom` |
| `@galacean/html2figma` | Node.js 24+ for the root/`node` entry; browser bundles are available from the documented browser subpaths |

`@galacean/figma2ge` requires a matching `@galacean/effects` 2.11.0-alpha.1 peer dependency. `@galacean/shader2ge` generates a
scene; browser playback additionally requires Galacean Effects, WebGL 1.0, and Web Crypto. See each package README
for format-specific limits and resource-loading behavior.

## Demo and documentation

- The [workbench README](./web-packages/README.md) describes local conversion tools and batch workflows.
- The [site README](./site/README.md) describes bilingual manuals, API browsing, browser demos, and Pages deployment.
- Report bugs and request features in [GitHub Issues](https://github.com/galacean/design-bridge/issues).

## Contributing

See the [development guide](./docs/developing.md) for setup, local tools, checks, builds, and cleanup.
Read [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution and validation policies.

Contributions are welcome through [GitHub pull requests](https://github.com/galacean/design-bridge/pulls). Include the
affected package, validation commands, compatibility impact, and fixture or resource licensing information when
applicable.

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
