# Getting started

Design Bridge provides composable TypeScript conversion libraries. Choose a package for your input and use Animation IR as the shared intermediate format.

## Install

Node.js 24 or later is required. Install only the packages your application needs. Repository development uses pnpm 10.

```bash
pnpm add @galacean/lottie2ir @galacean/ge-ir
```

## Your first conversion

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertLottieToIR(lottieJSON);
const effects = convertIRToGE(result.scene);
console.info(result.diagnostics, effects.scene);
```

`lottieJSON` is your Lottie animation object. Inspect diagnostics before saving or playing the result.

## Which package do I need

| Input | Target | Package |
| --- | --- | --- |
| Lottie JSON / ZIP | GE | `@galacean/lottie2ir` + `@galacean/ge-ir` |
| SVG | GE, IR, or static layers | `@galacean/svg2ir` |
| Existing GE | Editable DSL / IR | `@galacean/ge-ir` + `@galacean/dsl-ir` |
| HTML / CSS | Figma | `@galacean/html2figma` |
| Figma `.fig` | GE | `@galacean/figma2ge` |
| GLSL fragment shader | GE | `@galacean/shader2ge` |

## Suggested reading order

1. [Conversion paths](../conversion/): see the eight packages and available paths first, then decide what you need.
2. [The Animation IR model](../animation-ir/), [Authoring Animation IR](../author-animation-ir/): the shared data model.
3. [Importing Lottie and SVG](../import-animation/), [Shader to GE guide](../shader-to-ge/), [Design files and web pages](../design-to-ge/): pick an import path by input.
4. [DSL editing guide](../dsl-editing/), [Fidelity editing](../fidelity-editing/): round-trip editing across GE ↔ IR ↔ DSL.
5. [Best practices](../best-practices/), [Troubleshooting](../troubleshooting/): apply recommended approaches and locate problems by symptom.
6. [Try it in the local workbench](../playground/), [Runtimes and limitations](../runtime-and-limits/): debug live and learn the runtime boundaries.

You can also go straight to the [convertLottieToIR](../../api/lottie2ir/current/convertLottieToIR/) input contract.
