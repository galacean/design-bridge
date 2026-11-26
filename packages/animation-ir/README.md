# @galacean/animation-ir

English | [简体中文](./README-zh_CN.md)

Source-neutral 2D animation schema, adapter contracts, and runtime validation.

An importer produces an `IRScene`, an editor changes its layers by frame, and an exporter writes the target format.
All three use the same composition, layer, and asset types.

## Contents

- [Install](#install)
- [Create a scene](#create-a-scene)
- [Scene and layers](#scene-and-layers)
- [Time and animation](#time-and-animation)
- [Particles](#particles)
- [Assets](#assets)
- [Runtime validation](#runtime-validation)
- [Adapter contracts](#adapter-contracts)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
pnpm add @galacean/animation-ir
```

The package ships as native ESM. Running it in Node.js requires version 24 or later.

| Import path | Use it for |
| --- | --- |
| `@galacean/animation-ir` | Scene types and runtime constants, including `IRScene` and `IRLayerType` |
| `@galacean/animation-ir/adapter` | Scene creation, resource URLs, and particle unit conversion |
| `@galacean/animation-ir/validator` | Checking unknown input and either collecting issues or throwing on errors |

## Create a scene

This blue square loops at 30 fps. It starts transparent at frame 0, becomes fully visible at frame 30,
and starts the next loop at frame 60.

```ts
import { createIRScene } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';

const scene = createIRScene({
  id: 'main',
  width: 320,
  height: 180,
  frameRate: 30,
  inPoint: 0,
  outPoint: 60,
  endBehavior: 'loop',
  layers: [{
    id: 'square',
    type: 'solid',
    visible: true,
    time: { inFrame: 0, outFrame: 60 },
    localBounds: { x: 0, y: 0, width: 80, height: 80 },
    content: { color: [0, 0.4, 1, 1] },
    transform: {
      opacity: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }, { frame: 60, value: 0 }],
      },
    },
  }],
});

assertIRScene(scene);
```

`createIRScene` sets `main` as the entry composition and fills in `format` and `schemaVersion`.
Pass shared assets as its second argument.

## Scene and layers

- `scene.entryCompositionId` selects the composition to play. Use `getIRSceneEntryComposition(scene)` to look it up.
- `scene.compositions` holds the individual canvases, timelines, and layers. `scene.assets` holds shared images and fonts.
- Composition and asset IDs must be unique within their respective lists. Layer IDs are unique within their composition.
  References match IDs exactly.

### Layer types

| `type` | Content | `localBounds` |
| --- | --- | --- |
| `solid` | `content.color` in normalized RGBA | Required, defines the rectangle |
| `image` | `content.assetId` references an image | Required, sets the display size |
| `text` | Text, font, styles, and block layout | Required for fixed or auto-height layout; otherwise optional |
| `shape` | `content.shapes` holds vector geometry, fills, and strokes | Optional |
| `particle` | `content` holds capacity, lifetime, and emission parameters | Required, defines the editing area |
| `precomp` | `content.compositionId` selects the source, `clipToBounds` controls clipping to its canvas | Optional |
| `null` | Transform parent for other layers | Optional |

`layers[0]` draws at the back and the last layer draws at the front. Set `parentId` to inherit a transform from a layer
in the same composition. Each child keeps its own drawing order, visibility, and active interval.

### Vector shapes and masks

- **Shapes** include rectangles, ellipses, polygons, stars, and custom Bézier paths. Each shape paints all its fills
  before its strokes.
- **Fills and strokes** support solid colors, linear, radial, and angular gradients, and image textures.
  A texture references a shared image by `assetId`.
- **Path masks** in `masks` combine static closed paths in array order. Each uses `add`, `subtract`, or `intersect`,
  with optional `inverted`.
- **Track mattes** use `matte.sourceLayerId` to take geometry, alpha, or luminance from a layer in the same composition.
  The source still draws according to its own visibility and order.

A layer can use both masks and a matte. Multiply content alpha by path-mask coverage, matte coverage, and layer
`opacity` to get the resulting alpha.

### Rich text

Each style range uses a non-empty half-open `[start, end)` range in UTF-16 code units, matching JavaScript string indices.
Ranges must be sorted, non-overlapping, within `text.length`, and must not split a surrogate pair. Uncovered text and
omitted range styles inherit the content's default style. Ranges do not inherit styles from adjacent ranges;
an omitted or empty `styleRanges` array uses the default style throughout.

```ts
import type { IRTextContent } from '@galacean/animation-ir';

const content: IRTextContent = {
  text: 'Hello world', fontAssetId: 'font:body', fontSize: 16,
  color: [0, 0, 0, 1], letterSpacing: 0, lineHeight: 20, textAlign: 'left',
  styleRanges: [{ start: 6, end: 11, fontAssetId: 'font:emphasis', color: [1, 0, 0, 1] }],
};
```

Both font IDs must resolve to Font Assets; family, weight and italic style belong to those assets. Explicit line
breaks live in `text` as `\n`; line height and alignment apply to the whole text block. Text and range styles are static.
Per-character positioning, text on a path, and source-specific markup are outside this contract.

### Text layout

Layout belongs to the whole `IRTextContent` and does not depend on whether it has `styleRanges`.
Omitted fields have the following IR defaults; consumers must not substitute their runtime's defaults.

| Field | Values | Default |
| --- | --- | --- |
| `sizeMode` | `fixed`, `auto-width`, `auto-height` | `auto-width` |
| `wrap` | `true` wraps to the constrained width; `false` keeps only explicit `\n` line breaks | `false` |
| `overflow` | `visible`, `clip`, `shrink` | `visible` |
| `verticalAlign` | `top`, `center`, `bottom` | `top` |

`localBounds.x/y` locate the layout box in layer-local pixels. When bounds are absent, the origin is `(0, 0)`.
These are layout bounds, not the visible glyph-ink bounds. Their dimensions have the following roles:

| Size mode | Constraints from `localBounds` | Dimensions computed from text |
| --- | --- | --- |
| `fixed` | Positive `width` and `height`; bounds required | None; overflow never resizes the box |
| `auto-height` | Positive `width`; bounds required | Height after line breaking |
| `auto-width` | No width or height constraint; bounds optional | Width and height from explicit lines |

Dimensions on automatic axes are optional measurement hints within `localBounds`; if bounds are supplied, all four
members are still required and width/height must be finite and non-negative. Automatic dimensions must be recomputed
from text and must not constrain wrapping, alignment, clipping, or shrinking. `wrap: true` requires `fixed` or
`auto-height`. Changing automatic dimensions preserves the box origin and the authored local-pixel transform anchor;
consumers must not implicitly move either to the new center.

First resolve line breaks and automatic dimensions. `visible` permits content outside the resolved box;
`clip` clips to that box. `shrink` uniformly reduces the laid-out block, including font size, letter spacing, and
line height, until its width and height fit; it never enlarges content or reflows lines after scaling.
Apply horizontal `textAlign` and `verticalAlign` to the resulting block within the resolved box, then clip if requested.
Text layout and style ranges are static; layer transforms can animate the result.

```ts
import type { IRTextLayer } from '@galacean/animation-ir';

const label: IRTextLayer = {
  id: 'label', type: 'text', visible: true, time: { inFrame: 0, outFrame: 60 },
  localBounds: { x: 0, y: 0, width: 240, height: 80 },
  content: {
    text: 'A label that can wrap', fontAssetId: 'font:body', fontSize: 16,
    color: [0, 0, 0, 1], letterSpacing: 0, lineHeight: 20, textAlign: 'left',
    sizeMode: 'fixed', wrap: true, overflow: 'clip', verticalAlign: 'center',
  },
};
```

The validator checks field values, required bounds, and constrained dimensions without materializing defaults or
measuring text. Font fallback, glyph metrics, shaping, and exact break opportunities remain consumer-defined;
the contract specifies layout policy rather than pixel-identical rendering across engines.
Adapters that previously used measured bounds as a fixed box must explicitly set `sizeMode: 'fixed'` and their
wrapping, overflow, and alignment policies. Existing GE/SVG exporters are not yet adapted to these layout fields.

### Shape

Shape, fill, and stroke lists use back-to-front order. Supported primitives are custom, rectangle, ellipse, polygon,
and star. Paints include solid, linear, radial, angular, and image textures. Texture paints reference image assets and
support stretching to `fill`, containing with `fit`, covering and cropping with `crop`, or repeating with `tile`.
Each shape draws all fills before all strokes. The following fields use `IRAnimatedProperty<T>`, including for
constant values (`{ type: 'static', value }`):

| Fields | Value type and constraints |
| --- | --- |
| Solid paint `color` | RGBA tuple, each channel in `0..1` |
| All paints' optional `opacity` | Number in `0..1`, default `1` |
| Gradient `gradientStops` | Non-empty `[position, r, g, b, a][]`, all values in `0..1`, sorted by position |
| Gradient `gradientStart`, `gradientEnd` | Two-dimensional endpoints |
| Stroke `width` | Non-negative local pixels |
| Shape `position` | Two-dimensional local-pixel offset |
| Rectangle `width`, `height`, optional `cornerRadius` | Non-negative local pixels; corner radius defaults to `0` |
| Ellipse `xRadius`, `yRadius`; polygon `radius`; star `innerRadius`, `outerRadius` | Non-negative local pixels |
| Polygon `roundness`; star `innerRoundness`, `outerRoundness` | Optional percentages in `0..100`, default `0` |
| Custom `customPaths` | Non-empty `IRBezierPath[]`, using the `nonzero` winding rule |

Paint opacity multiplies the solid color, gradient stop, or texture alpha independently of layer opacity.
Stroke cap/join, paint type, texture asset/scale mode, primitive type, and polygon/star point count remain static.
Rectangle corner radius must not exceed half of the shorter edge at the sampled time. The validator checks that
cross-field bound for all-static geometry; it does not evaluate animated channels or guarantee interpolated bounds.

Continuous gradient segments require equal stop counts; stop positions and RGBA interpolate by array index.
Duplicate stop positions are allowed; rendering their hard edge is consumer-defined. Continuous path segments
require equal path counts, equal vertex counts per path, and matching `closed` flags. Paths and vertices correspond
by index, and points and relative Bézier handles interpolate component-wise without implicit resampling.
Compatibility is checked between `current.value` and `current.endValue ?? next.value`. `hold` segments may change
stop counts or path topology; an explicit `endValue` may also precede a discontinuous next value.
Trim paths, repeaters, and arbitrary fill/stroke interleaving are outside the core model and should produce diagnostics.

## Time and animation

### Frames and playback

| Field | Interpretation |
| --- | --- |
| `composition.inPoint`, `outPoint` | Frame range. Duration in seconds is `(outPoint - inPoint) / frameRate` |
| `layer.time.inFrame`, `outFrame` | The layer's base active interval, `[inFrame, outFrame)` |
| `keyframe.frame` | Absolute composition frame, including fractional frames |
| `precomp.time.sourceStartFrame` | Source frame sampled at activation. Defaults to the source composition's `inPoint` |
| `precomp.time.stretch` | Positive duration multiplier. Defaults to `1`. A value of `2` plays at half speed |

For example, take a 30 fps parent and a 24 fps source. With `sourceStartFrame` set to 10 and `stretch` set to 2,
after 30 parent frames the instance samples source frame `10 + 24 / 2 = 22`.

Every composition declares an `endBehavior`. Layers default to `destroy`. A precomp instance can override its source
composition's end behavior with `content.endBehavior`.

- `destroy` deactivates the layer or composition. `loop` wraps to its start frame.
- `freeze` holds the last state before the end. `continue` keeps advancing local time.

### Coordinates and keyframes

The origin is at the top left. X increases to the right and Y downward. The `anchor` is a point in layer-local pixels.
Its `position` is given in the parent's coordinates.

| Transform property | Unit | Default |
| --- | --- | --- |
| `position`, `anchor` | Pixels | `[0, 0, 0]` |
| `scale` | Multiplier | `[1, 1, 1]` |
| `rotation.x/y/z` | Degrees, with positive Z clockwise on screen | `0` on each axis |
| `opacity` | `0..1` | `1` |

The anchor is static. Other channels accept `static` or `keyframed` values. Keyframes must be in strictly increasing
frame order. On a layer starting at frame 10, a keyframe at frame 15 takes effect five frames later.

- **Linear interpolation** is the default. Set `hold: true` on a segment's starting keyframe to hold its value.
- **Bézier easing** uses `outTangent` on the starting keyframe and `inTangent` on the ending keyframe
  to control how fast the value changes.
- **Position paths** use `spatialOut` and `spatialIn`, measured in pixels relative to their respective endpoints.

## Particles

`startLifetime` is sampled at birth and measured in the owning composition's frames, including fractional frames.
In a 30 fps composition, this emitter produces particles that live for 0.25 to 0.5 seconds.

```ts
import type { IRParticleContent } from '@galacean/animation-ir';

const particles: IRParticleContent = {
  maxParticles: 100,
  startLifetime: { type: 'randomBetweenConstants', min: 7.5, max: 15 },
  emission: {
    rateOverTime: { type: 'constant', value: 12 },
    bursts: [{ frameOffset: 5, count: 8, cycleCount: 2, repeatIntervalFrames: 15 }],
  },
};
```

| Example setting | Playback |
| --- | --- |
| `maxParticles: 100` | Up to 100 particles alive at once |
| `startLifetime` | Uniform random duration from 7.5 to 15 frames per particle |
| `emission.rateOverTime` | Continuous emission at 12 particles per second |
| `emission.bursts` | Eight particles at each of two offsets, 5 and 20 frames after the layer starts |

Lifetime and continuous emission rate each accept a constant, a random range, or a curve. A curve's horizontal axis
is normalized emitter `progress` (`0..1`). The vertical axis, `value`, uses the parameter's unit.

**Migrating lifetimes stored in seconds**

- With a GE or DSL source, reimport the scene. Regenerate any paired DSL preserved data.
- For saved IR, call `mapIRParticleScalarValues(lifetime, seconds => seconds * frameRate)` at the composition's
  frame rate. It scales constants, range endpoints, curve keys, and control values while preserving `progress`.

## Assets

Image layers and shape textures share images by `assetId`. Text layers select a font by `fontAssetId`.

| `source.kind` | Data | Used by |
| --- | --- | --- |
| `url` | Absolute URL | Images, fonts |
| `embedded` | `mimeType` and standard Base64 `data` without the Data URL prefix | Images, fonts |
| `system` | The host matches the font's `family`, `style`, and `weight` | Fonts |

Resolve relative paths against the source document's URL on import. `createIRResourceSource` also converts Data URLs
to `embedded` sources. On export, `getIRResourceSourceUrl` returns a URL or Data URL.

```ts
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';

const url = resolveIRResourceUrl('./icon.png', 'https://example.com/scenes/intro.json');
const source = createIRResourceSource(url);
// { kind: 'url', url: 'https://example.com/scenes/icon.png' }
```

For a text layer with a font asset, see the [authoring guide](../../site/manual-source/en/author-animation-ir.md).

## Runtime validation

- To display issues in an editor, call `validateIRScene(input)`. It returns `{ valid, errors, warnings }`.
  An empty `errors` list means the scene is valid.
- To read a scene from JSON, call `assertIRScene(input)`. Success narrows `unknown` to `IRScene`.
  On failure, `IRValidationError.issues` contains all blocking errors.

For example, change the entry ID in the scene above to a missing composition. The issue points to the field to fix.

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';

const result = validateIRScene({ ...scene, entryCompositionId: 'intro' });
// result.valid          → false
// result.errors[0].code → 'IR_SCENE_ENTRY_COMPOSITION_MISSING'
// result.errors[0].path → 'entryCompositionId'
```

Validation checks field values, unique IDs, asset references, and cycles in parenting, mattes, and nested compositions.
Unreachable compositions and system fonts produce warnings. The consumer handles resource loading and rendering.

## Adapter contracts

- **Import and export.** Map the source's time units, coordinates, and resource references to IR on import.
  Convert units to the target format on export.
- **Round trips.** Store format-specific data alongside its `IRScene` so the corresponding converter can restore it.
- **Diagnostics.** Use `ConversionDiagnostic` to report a conversion decision. Set `action` to `normalized`,
  `approximated`, `dropped`, or `unsupported`, and `path` to the affected value.

## Contributing

Run `pnpm --filter @galacean/animation-ir test` for the package checks. See the [contributing guide](../../CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
