# @galacean/svg2ir

English | [简体中文](./README-zh_CN.md)

Convert SVG into source-neutral Animation IR, with optional SVG-to-GE and SVG-to-layers adapters in the same package.


## Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Output](#output)
- [Input capabilities](#input-capabilities)
- [Limitations](#limitations)
- [License](#license)

## Install

```bash
pnpm add @galacean/svg2ir @galacean/ge-ir
```

Node.js 24 or later and pnpm 10 or later are required. Browser and Node callers use the same root import; the Node
conditional entry automatically supplies the `svgdom` parsing base.

## Usage

### SVG to IR

```ts
import { convertSVGToIR } from '@galacean/svg2ir';

const { ir, warnings } = convertSVGToIR(
  '<svg width="400" height="300"><rect x="20" y="20" width="200" height="120" fill="#1677ff"/></svg>',
);

console.info(ir.compositions[0].layers, warnings);
```

`convertSVGToIR` returns the core `IRScene` and warnings. SVG-specific preserved data is not included.

### Preserve SVG-specific data

```ts
import { splitSVG } from '@galacean/svg2ir';

const { ir, warnings, preservedData } = splitSVG(svgSource);
```

`preservedData` is an `SVGPreservedData` sidecar for information that the core IR cannot represent, including rich
text spans and SMIL paint animation. Static layers export also uses the preserved text spans.

### SVG to GE

```ts
import { convertSVGToGE, splitSVG } from '@galacean/svg2ir';

const split = splitSVG(svgSource);
const { data, warnings } = convertSVGToGE(
  split,
  { fonts: [{ fontFamily: 'Custom Sans', fontURL: 'https://example.com/fonts/custom-sans.woff2' }] },
);
```

`convertSVGToGE` uses `@galacean/ge-ir` to build the base scene. Passing the sidecar enables SVG-specific rich-text,
paint-animation, and gradient-UV post-processing. Passing the `SVGConversionContext` returned by `splitSVG` reuses its
parsed IR and preserved data without parsing the SVG again. Passing an SVG string keeps source-specific post-processing
disabled unless `preservedData` is supplied separately. Pass parse options such as `frameRate`, `durationSeconds`, and
`measureText` to `splitSVG`; options passed to `convertSVGToGE` apply to GE output and diagnostics. Font definitions are
supplied independently through `fonts`.

### SVG to static layers

```ts
import { convertSVGToLayers } from '@galacean/svg2ir';

const svgSource = '<svg width="400" height="300"><text x="20" y="40" font-size="24">Hello</text></svg>';
const { size: canvasSize, data: layers, warnings } = await convertSVGToLayers(svgSource);
const json = JSON.stringify(layers);

console.info(canvasSize, json, warnings);
```

`convertSVGToLayers` converts Animation IR and SVG preserved text data directly into
static layers and asynchronously returns `{ size, data, warnings }`.
`data` is a flat array of image and text layers; `size` is the separate canvas width and height in pixels.
SVG images become image layers, and native text becomes editable text layers. Text inside images is not recognized.

Self-contained static graphics are baked into transparent PNG layers, preserving fills, gradients,
patterns, strokes, markers, transforms, filters, clipping, masks, and opacity. Ordinary graphics stay separate;
group-wide effects may merge child graphics into one PNG. Native text and images are never baked.
Consumers must create layers in array order to retain SVG painter order.

Non-normal blend modes (such as multiply, screen, and overlay) are downgraded to normal alpha compositing.
Baking and downgrades produce warnings; successful baking remains advisory in strict mode.
Baking requires browser SVG, Canvas, and DOM support; Node converts native layers and warns for unbaked graphics.
Mixed native effect groups, dependencies containing text/images, external paint resources, animations, scripts,
and `foreignObject` are not baked.

Layer format:

- Common fields: `id` is generated automatically; `bbox` uses canvas-pixel coordinates
  `[left, top, right, bottom]`.
- Image layers: `type: 'image'`, `role: 'content'`, and a Base64 data URL in `url`.
  `size` holds display dimensions before rotation; `rotation` holds XYZ Euler angles in degrees (positive Z is
  clockwise). `width` and `height` are the bbox dimensions.
  Native image geometry is rounded to two decimal places. Baked geometry follows raster resolution;
  transforms are included in the pixels, with `rotation: [0, 0, 0]`.
- Text layers: `type: 'text'`, `state: 'active'`, full text in `content`, and `fragments` containing text runs,
  fonts, sizes, colors, and spacing. Fragment `bbox` and `polygon` are relative to the text layer's top-left corner;
  polygon contains the layout corners. Rotation uses degrees and colors use `#RRGGBB`.
  `font_family` contains the family name without enclosing CSS quotes.
  Preserve `font_size` and `letter_spacing` on import.
  Text positions, font sizes, spacing, and rotation retain precision.
  Frame widths use per-code-point measurements at the transformed font size, with spacing only between characters.
  No width padding is added; consumers should preserve this precision when saving and restoring text.
  Native text requires no image erasure, so `erase_operations` is empty.

External images are fetched and inlined; browser fetch requires CORS. Supply `loadImage` for local files or
authenticated resources and `resourceBaseUrl` for relative image references. Failed reads or invalid resources throw errors.

## API

### Package API

- `convertSVGToIR(source, options?)` returns `{ ir, warnings }`.
- `splitSVG(source, options?)` returns `{ ir, warnings, preservedData }`.
- `convertSVGToGE(sourceOrContext, options?, preservedData?)` returns `{ data, warnings }`.
- `convertSVGToLayers(source, options?, preservedData?)` returns `Promise<SVGToLayersResult>`.
- `inferNumericWeightFromFamily(fontFamily)` infers a numeric font weight, or returns `null`.

Important options include `frameRate` (default `30`), `durationSeconds` (default `5` for static SVG),
`backgroundColor`, `resourceBaseUrl`, `imageNaturalSizes`, `measureText`, `strict`, `onWarning`, and the GE-only
`fonts` list. `resourceBaseUrl` must be absolute when used to resolve relative image references.
`convertSVGToLayers` accepts a `loadImage` callback:
`(url) => Promise<{ data: Uint8Array; mimeType: string }>`; `data` contains the original image bytes.

The layers-only `rasterScale` option controls PNG resolution without changing display size; it defaults to `2`
and must be finite and positive. The working raster is limited to 16 megapixels.

All public types, including `SVGConversionContext`, `SVGPreservedData`, `ConvertOptions`, `SVGToGEOptions`, `SVGToLayersOptions`, `SVGStaticLayer`,
`SVG2IRWarning`, and result types, are exported from `@galacean/svg2ir`.

## Output

```ts
convertSVGToIR(source, options?);
// { ir: IRScene; warnings: SVG2IRWarning[] }

splitSVG(source, options?);
// { ir: IRScene; warnings: SVG2IRWarning[]; preservedData: SVGPreservedData }

convertSVGToGE(sourceOrContext, options?, preservedData?);
// { data: JSONScene; warnings: SVG2IRWarning[] }

await convertSVGToLayers(source, options?, preservedData?);
// { size: [number, number]; data: SVGStaticLayer[]; warnings: SVG2IRWarning[] }
```

## Input capabilities

Supported refers to the listed subset; partial means some attributes are approximated or omitted. Output format
matters: static layers support a smaller subset than IR and GE.

### IR and GE

| Capability | Status | Behavior |
| --- | --- | --- |
| SVG string and shapes | Supported | `rect`, `circle`, `ellipse`, `path`, `polygon`, `polyline`, and `line`. |
| Groups and references | Supported | Hierarchy, transforms, opacity, and expanded `use` / `symbol` instances. |
| Images | Partial | URL assets and aspect ratio; supply natural sizes to avoid fitted-geometry fallback. |
| Text | Partial | Text/tspan, text paths, multiline and vertical text; GE rich text needs the sidecar. |
| Paints | Partial | Solid and supported gradients; gradient text is flattened, some gradient attributes lost. |
| Masks and clip paths | Partial | Element clip paths and element/group masks; unit and region limits below. |
| Group `clip-path` | Unsupported | Omitted with `svg2ir_group_clip_path_dropped`. |
| SMIL | Partial | Transform, motion, opacity, visibility, selected geometry and paint; GE paint uses sidecar. |
| Filters / patterns / markers | Unsupported | Effects omitted with warnings; supported content remains. |
| Skew and text decoration | Unsupported | Dropped with warnings; text stroke is also omitted. |
| Other elements | Unsupported | Unmapped content such as `foreignObject` is omitted with warnings. |

### Static layers

| Capability | Status | Behavior |
| --- | --- | --- |
| Images and native text | Supported | Flat image/text layers; text inside images is not recognized. |
| Image resources | Supported | Fetches and inlines bytes; use `loadImage` for local or authenticated resources. |
| Text layout and styles | Partial | Metrics may be estimated; bold/italic are downgraded; vertical text is split. |
| Shapes and animation | Unsupported | Skipped with warnings; layers export does not rasterize vector shapes. |
| Masks and visual transforms | Partial | Basic rotation/scale; unsupported opacity, crop, skew, etc. skip layers. |

Read `warnings` and optionally `onWarning`. Examples include `svg2ir_filter_dropped`,
`svg2ir_text_gradient_fill_flattened`, and `svg2ge_layers_unsupported_feature`.
`strict: true` rejects reported unsupported features and style downgrades; estimated layer text bounds still warn.
Invalid SVG and failed layer image loads throw errors. An empty warning list is not a complete rendering-fidelity check.

## Limitations

- Filters, patterns, markers, skew, and some text decoration are downgraded or reported as warnings.
- Element-level projection, blur, and inner-shadow effects do not have a general GE Runtime representation.
- Rich text cannot preserve every text stroke, decoration, or per-span position.
- Some radial-gradient focal offsets, `spreadMethod`, and `gradientTransform` values are not retained.
- Group-level `clip-path` is not currently mapped; element clip paths and group masks are supported.
- IR and GE conversion do not download external resources. Callers own URL resolution, font loading, and runtime
  resource access. Layers export reads and inlines image resources as described above.

Static layers export supports images and text only. SMIL animation elements are removed with a warning; unsupported animated channels, unbaked shapes, solid backgrounds,
image skew/reflection/cropping, masks, opacity, nonuniform text scaling, and text paths are skipped with warnings.
Bold and italic styles are downgraded with warnings; vertical text is split into character layers with horizontal fragments.
Load the fonts used by `measureText` before conversion; the callback is synchronous and does not load fonts.
Incomplete metrics produce estimated bounds and warnings.
`strict: true` turns unsupported content and style downgrades into errors; estimated bounds still produce warnings.

Images are retained when a straight rectangular mask covers the full image without inversion or subtraction.

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
