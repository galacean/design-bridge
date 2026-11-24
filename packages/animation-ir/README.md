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
| `text` | Text, `fontAssetId`, color, size, spacing, line height, alignment | Optional text bounds |
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
