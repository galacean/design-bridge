# @galacean/figma2ge

English | [简体中文](./README-zh_CN.md)

> Work in progress: Figma `.fig` decoding and Galacean Effects JSONScene conversion.

`@galacean/figma2ge` decodes browser-compatible Figma `.fig` archives, extracts the Kiwi node message into a small Figma
IR, and builds a Galacean Effects scene. The package is under active development; conversion coverage and public types
may change before the first stable release.


## Contents

- [Contents](#contents)
- [Install](#install)
- [Usage](#usage)
- [Public API](#public-api)
- [Input capabilities](#input-capabilities)
- [Known limitations](#known-limitations)
- [License](#license)

## Install

```bash
pnpm add @galacean/figma2ge @galacean/effects@2.11.0-alpha.1
```

`@galacean/effects@2.11.0-alpha.1` is a peer dependency used by the generated scene types and runtime. The decoder itself uses
`fzstd`, `pako`, and `kiwi-schema` and does not require Node.js APIs, so it can run in browser environments.
Node.js 24 or later is required for the package development and Node.js consumers.

## Usage

Decode a `.fig` file, then convert its decoded Kiwi message:

```ts
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';

const response = await fetch('/scene.fig');
const figBytes = new Uint8Array(await response.arrayBuffer());
const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);

for (const issue of result.issues) {
  console.warn(issue.type, issue.message);
}

console.info(result.scene, result.debugMap);
```

When an application already has a decoded Kiwi `NodeChange` object, pass it directly to `convertFigmaToEffects`.
`imagesByHash` is optional; provide it when image blobs are not embedded in the decoded message.

## Public API

| Export | Purpose |
| --- | --- |
| `decodeFigFile` | Decode a Figma `.fig` ZIP archive into metadata, a Kiwi message, and image bytes |
| `extractKiwiIR` | Convert a decoded Kiwi message into Figma IR nodes and blobs |
| `convertFigmaToEffects` | Build a GE JSONScene and return conversion issues and a Figma-to-GE debug map |
| `validateSceneReferences` | Check item, composition, and data references in a generated scene |
| `validateRuntimeReadiness` | Check runtime constraints of a generated scene |

The root entry also exports `ConversionResult`, `ConvertOptions`, `ConversionIssue`, `ConversionDebugMap`,
`DebugMapEntry`, `EffectsScene`, the `FigmaIR*` types, `KiwiIRResult`, and `DecodedFigFile`.

`ConvertOptions` currently supports `compositionName`, `compositionDuration`, and `includeInvisibleNodes`.
`ConversionResult.issues` contains warnings and errors that do not necessarily prevent a scene from being returned.

## Input capabilities

The package is under development. Supported refers to the listed decoding or mapping subset, not complete Figma
rendering fidelity; partial means only some data is mapped or rendering depends on the GE runtime.

| Capability | Status | Behavior |
| --- | --- | --- |
| `.fig` decoding | Supported | ZIP stored/deflate entries; `canvas.fig` Kiwi schema/message with deflate or zstd. |
| Decoded Kiwi nodes | Supported | Flat `nodeChanges` hierarchy; document/canvas nodes descend into their children. |
| Common visual nodes | Partial | Frames, groups, shapes, vectors, text, symbols, instances, and sections. |
| Paint and image data | Partial | Solid/gradient fills and strokes; images need hash-indexed blobs or image bytes. |
| Masks and frame clipping | Partial | Maps supported render components; target runtime affects the result. |
| Text | Partial | Content and alignment are mapped; font availability and estimated metrics affect layout. |
| Auto layout and effects | Partial | Maps layout/shadow/blur metadata, not the complete Figma engines. |
| Prototype interactions | Unsupported | Static scene and activation tracks; no interaction timeline. |
| Figma URL / API fetching | Unsupported | Supply `.fig` bytes or decoded Kiwi data; no Figma API client is included. |

Check `result.issues` for conversion and scene/runtime validation warnings or errors. Unknown fields and approximations
do not all produce issues; an empty array does not prove fidelity. ZIP, decompression, or Kiwi decoding failures can
throw before a conversion result is returned.

The generated scene is a minimal Galacean Effects JSONScene. It is intended to be loaded by a compatible GE runtime;
this package does not provide a preview player.

## Known limitations

- The `.fig` decoder accepts Figma ZIP archives containing `canvas.fig`, optional `meta.json`, and `images/*` entries.
- Figma features without a matching GE representation may be skipped or approximated and appear in `issues`.
- Font availability, text metrics, and GE runtime support affect rendered text results.
- Figma files and fixtures can contain private designs, images, and font metadata. Confirm authorization before sharing
  them or using them in public tests.
- The package does not convert a Figma URL or call the Figma API; callers must provide `.fig` bytes or decoded data.

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
