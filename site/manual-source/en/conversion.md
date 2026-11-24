# Conversion paths

Design Bridge provides eight independent packages for animation models, design files, and shader integration.
Choose a path by input and destination; not every source needs to pass through Animation IR.

## Capability map

| Package | Direction | Purpose |
| --- | --- | --- |
| `@galacean/animation-ir` | Source-neutral 2D animation model | Types, keyframes, and validation; the source of truth for IR |
| `@galacean/lottie2ir` | Lottie JSON / ZIP → IR | Import supported Lottie layers and animation |
| `@galacean/svg2ir` | SVG → IR / GE / static layers | Vector input, scene output, and text/image layers |
| `@galacean/ge-ir` | GE ↔ IR | Parse and generate Galacean Effects JSONScene |
| `@galacean/dsl-ir` | DSL ↔ IR | Editable representation, validation, and reconstruction |
| `@galacean/html2figma` | HTML / CSS → Figma | Figma Scene data, clipboard content, and `.fig` files |
| `@galacean/figma2ge` | Figma `.fig` → GE | Decode design files and generate GE scenes; work in progress |
| `@galacean/shader2ge` | GLSL fragment shader → GE | Full-screen materials, textures, and timelines |

Arrows identify supported directions, not lossless coverage of every feature. Inspect diagnostics,
preservation data, and the target runtime when evaluating a result.

## Inputs to IR

Use [convertLottieToIR](../../api/lottie2ir/current/convertLottieToIR/) for Lottie, [convertSVGToIR](../../api/svg2ir/current/convertSVGToIR/) for SVG, and [convertGEToIR](../../api/ge-ir/current/convertGEToIR/) for GE. Diagnostics describe normalized, discarded, or unsupported semantics.

## Bidirectional GE, IR, and DSL editing

Each part of `GE ↔ IR ↔ DSL` has its own API:

- GE → IR: [convertGEToIR](../../api/ge-ir/current/convertGEToIR/).
- IR → GE: [convertIRToGE](../../api/ge-ir/current/convertIRToGE/).
- IR → DSL: [convertIRToDSL](../../api/dsl-ir/current/convertIRToDSL/).
- DSL → IR: [convertDSLToIR](../../api/dsl-ir/current/convertDSLToIR/).

GE and DSL adapters remain independent; applications compose them through IR. Keep editable DSL paired with
`IRToDSLPreservedData`, and manage GE-specific semantics through `GEToIRPreservedData`.
Bidirectional conversion does not guarantee exact reconstruction after arbitrary edits.

For a new composition containing existing particle systems, `convertDSLToIR` accepts `particleSources` and returns
`sourceInstances`. Pass the corresponding original GE imports and ID maps to `convertIRToGE` through `sources`;
see [DSL editing](../dsl-editing/) for placement requirements and a complete example.

```ts
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertIRToGE(scene);
console.info(result.scene, result.diagnostics);
```

The GE output is a JSONScene for a compatible Galacean Effects player. See [fidelity editing](../fidelity-editing/)
for the complete editing workflow.

## HTML / CSS to Figma

Use `@galacean/html2figma` to recover design data from a rendered page without going through Animation IR.
It extracts layout, text, images, and supported styles into Figma Scene data, clipboard content, or `.fig` files.

```ts
import { createFigmaFile, extractScene } from '@galacean/html2figma';

const sceneData = await extractScene('/absolute/path/to/page.html', false, {
  viewport: { width: 390, height: 844 },
  scriptPolicy: 'disabled',
  networkPolicy: 'offline',
});
const result = await createFigmaFile(
  [{ name: 'Imported page', sceneData }],
  { documentName: 'Imported page' },
);
```

Inspect `result.validation` before using `result.bytes`. The root entry is for Node.js and requires Playwright
Chromium. Browser extraction uses `@galacean/html2figma/browser`, with `/browser/file` or `/browser/clipboard`
for output. HTML strings, Documents, and virtual projects / ZIPs have dedicated entry points; see the
[html2figma API](../../api/?package=html2figma).

`.fig` export defaults to snapshot layout. Browser export can encode glyph paths and requires visible glyph coverage
by default; supply font bytes or Local Font Access permission. See [design files and web pages](../design-to-ge/)
for the Node/browser defaults, font setup, and clipboard workflow.

This captures a page snapshot, not JavaScript interactions, CSS animation timelines, or application logic.
Text remains editable, but fonts, resources, and CSS coverage affect fidelity. The host controls script,
network, and file permissions; disabling scripts or network access does not fully isolate local files.

## Figma design files to GE

Use the separate `@galacean/figma2ge` package to bring `.fig` files into the animation runtime:

```ts
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';

const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);
```

`figBytes` contains caller-supplied `.fig` bytes. Check `result.issues` before playing `result.scene` with a
compatible runtime. This package is a work in progress: some layout, effects, text, and component behavior
is approximated or omitted. It does not fetch Figma URLs or call its API. Its internal Figma IR is not Animation IR.

Applications explicitly compose `HTML / CSS → Figma → GE` from two packages. This is not a one-click,
lossless website-to-runtime conversion. See the
[figma2ge README](https://github.com/galacean/design-bridge/blob/main/packages/figma2ge/README.md).

## GLSL shaders to GE

Use `@galacean/shader2ge` to generate GE JSONScene directly from procedural visuals without first producing IR.
It accepts GE-style `main()` and `mainImage` fragment shaders, generating a full-screen quad, shader,
material, and timeline.

```ts
import { convertShaderToGE } from '@galacean/shader2ge';

const result = convertShaderToGE(`
  precision highp float;
  varying vec2 vUV;
  varying float vTime;

  void main() {
    vec3 color = 0.5 + 0.5 * cos(vTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
    gl_FragColor = vec4(color, 1.0);
  }
`, { duration: 5, previewSize: [1280, 720] });
```

Inspect `result.diagnostics` before using `result.scene`. Conversion needs no player; playback needs a
compatible GE runtime and WebGL 1.0. Supported image textures and selected uniforms can be configured;
unsupported values may produce warnings or fallbacks.

The converter targets a single fragment pass on fixed full-screen geometry. It does not support GLSL ES 3.0,
custom vertex shaders, feedback buffers, or multipass orchestration, and does not replace GPU compilation
or runtime validation. See the [shader2ge API](../../api/?package=shader2ge).

## Composition and validation

Choose an input and destination, then install only the needed packages. Preserve diagnostics and paired
sidecars, and verify target fonts, resources, and runtime constraints. Structural validation is not proof
of pixel parity. See [runtimes and limitations](../runtime-and-limits/).
