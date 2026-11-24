# @galacean/lottie2ir

English | [简体中文](./README-zh_CN.md)

Lottie to Animation IR converter.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Input capabilities](#input-capabilities)
- [API](#api)
- [Project structure](#project-structure)
- [License](#license)

## Install

Node.js 24 or later is required.

```bash
pnpm add @galacean/lottie2ir
```

## Usage

### Convert JSON

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';

const result = convertLottieToIR(lottieJSON, {
  resourceBaseUrl: 'https://cdn.example.com/animations/data.json',
});

console.info(result.scene.format); // animation-ir
```

`convertLottieToIR` accepts either a Lottie JSON object or a serialized JSON string. Relative image and font paths are
resolved against the absolute `resourceBaseUrl`.

### Extract ZIP input

```ts
import { convertLottieToIR, extractLottieFromZip } from '@galacean/lottie2ir';

const extracted = await extractLottieFromZip(zipArrayBuffer);
const result = convertLottieToIR(extracted.json, { zipResources: extracted });
```

## Input capabilities

This matrix describes Lottie import into Animation IR. Supported means the listed subset is converted; partial means
some values are approximated or omitted. GE export through `@galacean/ge-ir` has additional limits.

| Capability | Status | Behavior |
| --- | --- | --- |
| JSON object / string | Supported | Requires valid frame rate, canvas size, and in/out points. |
| ZIP input | Supported | Extracts JSON and supported image/font files; ZIP entries become Data URLs. |
| Layers and hierarchy | Supported | Precomp, solid, image, null, shape, and text layers; parent references. |
| Precomp timing | Partial | Start and stretch are mapped; invalid stretch uses `1` with a warning. |
| Transform keyframes | Partial | Position, rotation, scale, and opacity; animated anchors use the first value. |
| Separated position | Partial | Incompatible axis timelines are sampled at combined keyframe times, with a warning. |
| Shape geometry and paint | Partial | Paths, rectangles, ellipses, stars, polygons, fills, and strokes. |
| Animated gradients | Partial | Only the first keyframe is retained; a warning is returned. |
| Shape modifiers | Unsupported | Trim, repeater, merge, and other unsupported operators are omitted with warnings. |
| Authored masks | Partial | Ordered closed static paths, full opacity, add/subtract/intersect, and inversion. |
| Track mattes | Partial | Alpha/luminance and inversion enter IR; GE export cannot lower luminance mattes. |
| Text | Partial | First Text Document only. Static filled point-text glyphs become vector shapes; font-based text may use estimated bounds and fallback fonts. |
| Resource loading | Partial | Resolves URLs or ZIP data; conversion does not fetch external images or fonts. |
| Expressions, effects, 3D | Unsupported | No expression evaluator, general effect pipeline, or 3D scene conversion. |

Inspect `result.diagnostics`: examples include `LOTTIE_UNSUPPORTED_LAYER_TYPE`, `LOTTIE_UNSUPPORTED_SHAPE_FEATURE`,
`LOTTIE_UNSUPPORTED_MASK`, `LOTTIE_ANIMATED_ANCHOR_FALLBACK`, and `LOTTIE_ANIMATED_GRADIENT_FALLBACK`.
Masks retain source order in `layer.masks[]`. A stack containing animated, open, non-opaque, or unsupported entries
is dropped as a whole with `LOTTIE_UNSUPPORTED_MASK`. GE export has separate limits on Add unions.
Embedded `chars` preserve glyph contours, advance widths, tracking, alignment, and line spacing as IR Shape layers.
These layers retain their transforms and parenting but are no longer editable text. Missing glyphs, paragraph boxes,
strokes, animated glyphs, and unsupported outline operators fall back to font-based text with
`LOTTIE_UNSUPPORTED_TEXT_GLYPHS`.
Duplicate layer indices produce `LOTTIE_DUPLICATE_LAYER_INDEX`; parent references retain lottie-web's source-order
transform multiplication through private null layers, without changing the visible parents.
Children active outside an ancestor's visibility interval also use independent transform nodes, so the ancestor's
animation continues to affect them while its own content keeps its authored display interval.
Text animation and unrecognized fields do not all have dedicated diagnostics; an empty array does not prove fidelity.
Invalid JSON, ZIP parsing, conversion, or IR validation failures throw `LottieConverterError`.

## API

### `convertLottieToIR(input, options?)`

- `input`: a Lottie JSON object or serialized JSON string.
- `options.resourceBaseUrl`: absolute base URL for relative image and font paths.
- `options.zipResources`: ZIP resource directory and Data URL map returned by `extractLottieFromZip`.
- Returns `{ scene: IRScene; diagnostics: ConversionDiagnostic[] }` after validating the IR scene.

### `extractLottieFromZip(zipData)`

Accepts a ZIP `ArrayBuffer` and returns the serialized JSON, resource Data URL map, and JSON directory.

### Errors

`LottieConverterError` and `LOTTIE_CONVERTER_ERROR_CODES` are exported from the package root for JSON, ZIP, conversion
pipeline, and IR validation failures.

## Project structure

```text
src/
├── convert-lottie-to-ir.ts            # Public conversion flow and IR boundary validation
├── assemble-ir-scene.ts               # IRScene and Composition assembly
├── extract-lottie-from-zip.ts         # Lottie JSON and resource extraction from ZIP input
├── parser/                             # Input, layer stack, and property parsing
├── converter/                          # Layer, asset, mask, shape, text, and transform conversion
├── common/                             # Types, error model, and identifier generation
└── index.ts                            # Stable public entry
```

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
