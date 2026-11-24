# Authoring Animation IR

Most scenes come from converters, but building IR by hand clarifies the model and is useful for test fixtures and
custom source adapters. This chapter starts from a minimal scene and adds layers, keyframes, and assets. Field
definitions follow the [animation-ir README](https://github.com/galacean/design-bridge/blob/main/packages/animation-ir/README.md)
and the [API reference](../../api/?package=animation-ir).

## A minimal scene

An `IRScene` consists of an entry composition, a composition list, and an asset registry. `format` and
`schemaVersion` are fixed values.

```ts
import { IREndBehavior, IRLayerType, type IRScene } from '@galacean/animation-ir';
import { validateIRScene } from '@galacean/animation-ir/validator';

const scene: IRScene = {
  format: 'animation-ir',
  schemaVersion: '1.0.0',
  entryCompositionId: 'main',
  compositions: [{
    id: 'main',
    name: 'Main',
    width: 750,
    height: 400,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: IREndBehavior.Loop,
    layers: [],
  }],
  assets: [],
};

console.info(validateIRScene(scene).valid);
```

## Time and coordinates

- Time is measured in **frames**, and each composition has its own `frameRate`. 60 frames at 30 fps is 2 seconds.
- A layer is active over the half-open interval `[inFrame, outFrame)`.
- The origin is top-left, X grows right and Y grows down, in pixels; rotation is in degrees, scale is a factor,
  and colors are RGBA in `0..1`.
- `position` is where the anchor sits in the parent space; `anchor` is the rotation/scale center in layer-local
  coordinates.
- `layers` is in painter order, bottom to top; `parentId` inherits transforms only and does not affect drawing order.

## Adding layers

The layer type determines the required content:

| Type | Required content |
| --- | --- |
| `solid` | `content.color`, `localBounds` |
| `image` | `content.assetId`, `localBounds` |
| `text` | `content` (including `fontAssetId`) |
| `shape` | `content.shapes` |
| `precomp` | `content.compositionId`, `content.clipToBounds` |
| `particle` | `content.maxParticles`, `content.startLifetime` in composition frames, `content.emission`, `localBounds` |
| `null` | None; often used as a transform parent |

The following adds a solid background and a text layer that moves down, and registers a system font asset for the
text:

```ts
const [composition] = scene.compositions;

composition.layers.push(
  {
    id: 'bg',
    type: IRLayerType.Solid,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    content: { color: [0.1, 0.1, 0.2, 1] },
    localBounds: { x: 0, y: 0, width: 750, height: 400 },
  },
  {
    id: 'title',
    type: IRLayerType.Text,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    content: {
      text: 'Hello',
      color: [1, 1, 1, 1],
      fontAssetId: 'font',
      fontSize: 48,
      letterSpacing: 0,
      lineHeight: 56,
      textAlign: 'center',
    },
    transform: {
      position: {
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: [375, 120, 0], outTangent: { x: 0.33, y: 0 } },
          { frame: 30, value: [375, 200, 0], inTangent: { x: 0.67, y: 1 } },
        ],
      },
    },
  },
);
scene.assets.push({
  id: 'font',
  type: 'font',
  family: 'sans-serif',
  style: 'normal',
  weight: 400,
  source: { kind: 'system' },
});
```

## Animated properties

Animatable properties (`position`, `scale`, `rotation`, `opacity`) are discriminated by `type`:

- `{ type: 'static', value }`: a fixed value.
- `{ type: 'keyframed', keyframes }`: a keyframe sequence. `frame` lives in the **composition frame domain**, not an
  offset from the layer start. Easing between two keyframes comes from the start's `outTangent` and the end's
  `inTangent`; `hold` keeps the value until the next keyframe.

`anchor` is static. Text content, shape geometry, fills, and strokes are also static data; animate them through the
owning layer's transform.

## Assets

Images and fonts are registered in `scene.assets`, and layers reference them by `assetId` / `fontAssetId`. Sources:

```ts
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';

const imageURL = resolveIRResourceUrl('./a.png', 'https://cdn.example.com/scenes/intro.json');
const externalSource = createIRResourceSource(imageURL);
// { kind: 'url', url: 'https://cdn.example.com/scenes/a.png' }
const embeddedSource = createIRResourceSource('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E');
// Embedded sources store mimeType and Base64 data without the data: prefix.
```

Adapters should resolve relative URLs against the source location before writing them. System fonts depend on the
runtime environment, so validation reports a portability warning.

## Validation and error handling

```ts
import { assertIRScene, validateIRScene } from '@galacean/animation-ir/validator';

const result = validateIRScene(scene);

for (const issue of [...result.errors, ...result.warnings]) {
  console.info(issue.code, issue.path, issue.message);
}
const input: unknown = JSON.parse(serialized);

assertIRScene(input); // throws IRValidationError on failure; narrows input to IRScene on success
```

Typical problems: duplicate IDs, dangling asset or precomp references, parent cycles, missing `localBounds`, and
invalid time ranges. `validateIRScene` returns every issue at once, which suits editor UIs; `assertIRScene` suits
fail-fast service boundaries. A passing result means the structure is valid, not that resources load or pixels match.

## Output

A valid IR goes straight to the converters:

```ts
import { convertIRToGE } from '@galacean/ge-ir';
import { convertIRToDSL } from '@galacean/dsl-ir';

const ge = convertIRToGE(scene);
const editable = convertIRToDSL(scene);
```

Next: [Importing Lottie and SVG](../import-animation/), to generate IR with converters.
