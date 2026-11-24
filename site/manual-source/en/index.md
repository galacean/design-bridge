## What problem does Design Bridge solve

Animation and design assets live in different formats: Lottie, SVG, Figma, HTML, shaders, and
Galacean Effects (GE). Each has its own data model, and converting between them usually means
hand-writing one converter per pair. Design Bridge introduces a source-agnostic intermediate format,
**Animation IR**, plus an editable **DSL** that suits both people and AI:

```text
Lottie ─→ Animation IR ←→ GE JSONScene ─→ Galacean Effects player
SVG ────→     ↕
         DSL (editable)

SVG ─→ static image/text layers
GLSL fragment shader ─→ GE JSONScene
HTML/CSS ─→ Figma Scene / .fig ─→ GE JSONScene
```

Each package owns one conversion step and your application composes them. New animation adapters can reuse IR;
shader and design-file conversion use their own direct paths.

## Find your scenario

| What you want to do | Recommended path | Read |
| --- | --- | --- |
| Play a Lottie animation in Galacean Effects | `lottie2ir` → `ge-ir` | [Importing Lottie and SVG](./import-animation/) |
| Turn SVG into an animated scene or layered static image | `svg2ir` | [Importing Lottie and SVG](./import-animation/) |
| Generate or edit animation programmatically | `animation-ir` | [Authoring Animation IR](./author-animation-ir/) |
| Let users or AI modify an existing GE animation through DSL | `ge-ir` + `dsl-ir` | [DSL editing guide](./dsl-editing/), [Fidelity editing](./fidelity-editing/) |
| Turn a GLSL effect into a GE material | `shader2ge` | [Shader to GE guide](./shader-to-ge/) |
| Recreate a web page as an editable design | `html2figma` | [Design files and web pages](./design-to-ge/) |
| Bring a Figma design into the animation runtime | `figma2ge` | [Design files and web pages](./design-to-ge/) |
| The result is not what you expected | — | [Troubleshooting](./troubleshooting/) |

## Five-minute start

After installing, two calls convert Lottie to GE:

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertLottieToIR(lottieJSON);
const effects = convertIRToGE(result.scene);

console.info(result.diagnostics, effects.scene);
```

`convertLottieToIR` is synchronous. Both results carry `diagnostics` that tell you which semantics
were kept, normalized, dropped, or unsupported. **Check diagnostics before saving or playing the
output**; this is the basic habit for every converter. See [Getting started](./getting-started/)
for installation and package selection.

## Principles to know up front

- **Conversion is not guaranteed lossless.** An arrow means the direction is provided, not that every
  asset round-trips. Input, diagnostics, and the target runtime together determine the result.
- **IR is the hub, not a mandatory stop.** HTML → Figma, Figma → GE, and Shader → GE do not pass
  through Animation IR. Pick the shortest path from input to target.
- **Edit through the fidelity chain.** Keep the DSL with its DSL sidecar and retain the separate GE sidecar.
  After editing IR, reconcile the GE sidecar before exporting GE.
- **Browser and Node.js differ.** Core converters run in the browser; the `html2figma` root entry and
  similar features need Node.js and Playwright. See [Runtimes and limitations](./runtime-and-limits/).

## Pick a learning path

1. **Integrate quickly:** [Getting started](./getting-started/) → [Importing Lottie and SVG](./import-animation/) → [Best practices](./best-practices/). Goal: turn existing assets into GE fast.
2. **Understand the model:** [Conversion paths](./conversion/) → [The Animation IR model](./animation-ir/) → [Authoring Animation IR](./author-animation-ir/). For extension work and programmatic generation.
3. **Edit and write back:** [DSL editing guide](./dsl-editing/) → [Fidelity editing](./fidelity-editing/) → [Best practices](./best-practices/). For building editors or AI rewriting.
4. **Design files and shaders:** [Design files and web pages](./design-to-ge/), [Shader to GE guide](./shader-to-ge/).

The sidebar lists every page in learning order. For exact function signatures, use the
[API reference](../api/).

## Try it live locally

Code in the manual is static. To load real assets, inspect conversion output, and debug, clone the
source repository and run `pnpm install && pnpm dev` to start the `web-packages` workbench
(default `http://localhost:8080`). Entry pages, input manifests, and debugging tips are in
[Try it in the local workbench](./playground/).
