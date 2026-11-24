# @galacean/dsl-ir

English | [简体中文](./README-zh_CN.md)

Bidirectional conversion and validation for editable DSL and source-neutral Animation IR.

The package owns the DSL boundary only. Importing and exporting Galacean Effects JSONScene, including preservation of
GE-only data, is handled by `@galacean/ge-ir`.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Data and editing boundaries](#data-and-editing-boundaries)
- [API](#api)
- [Project structure](#project-structure)
- [License](#license)

## Install

Node.js 24 or later is required.

```bash
pnpm add @galacean/dsl-ir
```

Install `@galacean/ge-ir` as well when working with Galacean Effects:

```bash
pnpm add @galacean/dsl-ir @galacean/ge-ir
```

## Usage

### Convert DSL to Animation IR

A DSL document created from scratch does not need preserved data:

```ts
import { convertDSLToIR, type Composition } from '@galacean/dsl-ir';

const dsl: Composition = {
  meta: {
    name: 'example',
    duration: 2,
    fps: 30,
    width: 512,
    height: 512,
    loop: true,
    background_color: null,
  },
  layers: [],
};

const { scene, diagnostics } = convertDSLToIR(dsl);
```

DSL timing is expressed in seconds. Animation IR timing is expressed in frames, using `dsl.meta.fps` as the frame
rate. Frame rates and canvas dimensions accept finite positive fractional values. Adjacent animation segments may have different end and start values to represent an instantaneous reset.

Preserved write-back retains each source composition's frame rate unless `meta.fps` is edited. An explicit FPS edit
resamples all compositions to the requested rate while preserving durations and precomposition source offsets in seconds.

DSL uses the initial `position.z` as a sibling stacking value: higher values render above lower values.
Array order does not control stacking. Equal values retain the imported order with preserved data; standalone DSL
uses layer IDs as a deterministic tie-breaker. Imported DSL exposes painter ranks in Z, while the paired sidecar
retains source spatial depth. Changing only Z reorders whole sibling subtrees without moving them toward the camera.
Standalone DSL positions are placed on the IR 2D plane (`z = 0`). Animated position uses its first segment's start Z
as a fixed rank. Editing XY on a layer with varying source depth retains depth at matching keyframe times;
changing that position's timing or replacing it with a static position is unsupported.

Text coordinates use the horizontal alignment point on the first-line baseline as the local origin. The usual
`parent * T(position) * R * S * T(-anchor)` transform applies around that origin. Width and height describe the text
layout box, not the origin or an additional translation. The adapter expresses this through IR `localBounds`:
`x = -a * width` and `y = -B`, where `a` is `0`, `0.5`, or `1` for left, center, or right alignment, and
`B = fontSize + (lineHeight - fontSize) / 3` matches the GE top-aligned text layout. Parent transforms are unchanged.
Preserved edits keep the baseline point fixed when text metrics, alignment, or dimensions change. Reverse conversion
expresses box-local IR anchors in baseline coordinates and rebases children of text layers into that coordinate system.

Rotation follows the DSL anchor. To rotate around the GE layout-box center, use the baseline-local anchor
`[(0.5 - a) * width, height / 2 - B, 0]` and place `position` at the desired center. Do not apply another baseline
translation to the parent or rotation transform.

Existing hand-authored DSL that used top-left text coordinates must subtract `[a * width, B, 0]` from its text anchor
to retain its placement. Do not apply that migration to baseline-authored DSL. Font shaping, wrapping, and overflow
remain renderer-defined; this mapping does not measure glyphs or introduce a different text layout policy.

### Convert Animation IR to DSL

`convertIRToDSL` always returns the editable DSL, diagnostics, and an `IRToDSLPreservedData` sidecar:

```ts
import { convertIRToDSL } from '@galacean/dsl-ir';

const { dsl, preservedData, diagnostics } = convertIRToDSL(scene);
```

The sidecar retains IR data and write-back relationships that DSL cannot represent completely. It is adapter-owned
data rather than business data. It can be persisted with `JSON.stringify` and `JSON.parse`, but applications should not
modify or depend on its internal structure.

### Write edited DSL back to its source IR

Pass the DSL and sidecar produced by the same conversion back to `convertDSLToIR`:

```ts
const converted = convertIRToDSL(scene);
const editedDSL = structuredClone(converted.dsl);

editedDSL.layers[0].opacity = { a: false, value: 0.5 };

const { scene: updatedScene, diagnostics } = convertDSLToIR(editedDSL, {
  preservedData: converted.preservedData,
  onChange: change => console.info(change),
  onWarning: warning => console.warn(warning),
});
```

When `preservedData` is supplied, the converter applies DSL-representable changes to the retained IR snapshot while
keeping information outside the DSL contract. Warnings do not stop conversion. Edits that can be safely ignored, such as
new layers or type changes, are skipped and reported through diagnostics and `onWarning`; supported edits still apply.
Invalid input, invalid preserved data, or edits that cannot retain source depth throw.
Applications should catch conversion failures and retain their last valid scene, replacing it only after conversion succeeds.

### Combine with `@galacean/ge-ir`

The application coordinates the adapters and keeps their sidecars paired.

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';
import { convertIRToDSL, convertDSLToIR } from '@galacean/dsl-ir';

const ge = convertGEToIR(geScene, { frameRate: 30 });
const dsl = convertIRToDSL(ge.scene);
const edited = structuredClone(dsl.dsl);

edited.meta.duration = 4;

const updated = convertDSLToIR(edited, { preservedData: dsl.preservedData });
const preservedData = updateGEToIRPreservedData(ge.scene, updated.scene, ge.preservedData);
const restored = convertIRToGE(updated.scene, { preservedData });
```

### Particle layers

`Composition` and `Layer` define the DSL for all layer types. Particle layers use `type: 'particle'` and the same
transform semantics as other layers. All layers may omit `time_range`, `rotation`, `scale`, `anchor`, and
`opacity`. Preserved write-back leaves omitted channels unchanged; fresh conversion uses composition timing and
identity transforms. Input DSL objects are not completed or mutated. `convertIRToDSL` produces complete layers;
`validateDSL` and `convertDSLToIR` validate and convert them through the common pipeline. `parseParticleShape` parses optional,
read-only emitter geometry supplied by a source adapter.

DSL `particle.options.startLifetime` uses seconds. The adapter converts between seconds and IR
`content.startLifetime` at the particle's own composition rate, including inside a precomp.

Applications compose source effects, target layout, model requests and GE resource restoration through public adapter APIs.

### Convert a complete DSL with particle sources

Pass the complete DSL to `convertDSLToIR`. Bind its particle placeholders to the paired source DSL sidecar;
ordinary layers are authored in the same conversion. This example uses a source with one root particle layer and
a `fullDSL` containing the target layer ID `target-particle`:

```ts
import { convertDSLToIR, convertIRToDSL } from '@galacean/dsl-ir';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';

const particle = convertGEToIR(particleGE, { frameRate: 30 });
const source = convertIRToDSL(particle.scene);
const converted = convertDSLToIR(fullDSL, {
  particleSources: [{
    preservedData: source.preservedData,
    layers: { 'target-particle': source.dsl.layers[0].id },
  }],
});
const exported = convertIRToGE(converted.scene, {
  sources: converted.sourceInstances?.map(({ idMap }) => ({ ...particle, idMap })),
});
```

Each `particleSources` entry creates one independent IR Precomp instance. Its `layers` record maps target DSL IDs to
source DSL IDs. Bind one system or every system in the source composition. Shared systems must have identical target
width, height, static position, rotation, and scale. Targets must be root particle leaves. Use separate entries for independent
placements or repeated instances. Auxiliary layers accompany the first source system when systems are split.

Target width, height, and position place the source region; Z controls painter order with ordinary DSL layers.
Optional `authoringBounds` defaults to the source canvas and fits proportionally without clipping. Placement uses
static uniform XY scale (`scale.z = 1`) and clockwise Z rotation, around the center of the source bounds. The wrapper
uses uniform XYZ scale; target anchors do not change source-local emitter transforms. Particle values, name, opacity,
and timing edit the retained source IR. Unedited curves survive. Omitted timing extends the particle and its ancestors
to the host duration; explicit timing remains unchanged. `meta.duration` controls the host and source-instance playback
windows. Source compositions retain their frame rates and extend to at least that duration; longer sources keep their
local timing without extending the host.

For source placement, rotation and scale now affect the wrapper instead of editing the emitter. Applications that clone
source Layers should reset these placement fields to zero rotation and unit scale before applying a target layout.
Edit emitter transforms through the paired source document when that is the intended operation. GE export adapts world
motion and enables sprite-size compensation; see [particle spatial adaptation](../ge-ir/README.md#particle-spatial-adaptation).

`sourceInstances` returns each input `sourceIndex` and its `idMap`. For multiple sources, pair each mapping with the
original GE import at that index. `convertIRToGE` restores and namespaces GE payloads through `options.sources`,
reconciles edited fields, and exports once. The assembled preserved data is used internally during export.
Inputs are not mutated.

Sources require trusted GE 3.6 data and self-contained compositions. Coupled systems must stay in one instance.
DSL and GE adapters remain independent; source selection and paired sidecars belong to the application.

## Data and editing boundaries

- `@galacean/animation-ir` is the single source of truth for Animation IR types and validation.
- DSL is an editing-oriented subset, not a mirror of any source format schema.
- `convertIRToDSL` expands precompositions and stores the write-back relationships in `IRToDSLPreservedData`.
  Shared instances edit the same source layers. Conflicting values for one field retain that field's original value
  with a warning; other edits apply. Deleting a shared child affects every instance and produces a warning.
- Independent rotation axes are sampled at their combined keyframe times and linearly interpolated with a diagnostic.
  Original easing and curves remain in the sidecar until rotation is edited.
- Text size and line height are positive composition-pixel values; letter spacing uses the same units and may be negative.
  Omitted line height uses `text.size * 1.2`.
- Fidelity-preserving write-back supports field edits, deletion, and reordering of existing layers under the same
  parent. Unsafe edits are reported through diagnostics or warnings.
- Both conversion directions validate their IR boundary. Every successfully returned `scene` satisfies the Animation
  IR contract.
- External images entering Animation IR must use absolute URLs or Data URLs. DSL font families become system font
  assets.
  Inline SVG assets use their SVG content when `url` is omitted or empty.
- Particle Layers use the same `convertIRToDSL` and `convertDSLToIR` workflow as other supported Layers. Editable
  `options` and `emission` values are represented in DSL. Source adapters may also expose an optional read-only
  `shape` block for model context; renderer, resources, and other GE-only fields remain in the GE adapter sidecar.
- Omitted or zero burst `cycles` means unbounded repetition until the Layer ends. Repeated bursts require a
  positive `interval` in seconds. Set `cycles: 1` explicitly for a single burst.
- Particle lifetime and emission values use the DSL subset of GE `NumberExpression`: constant tag `0` and
  random-range tag `4`. IR curves are projected with diagnostics and retained in the DSL sidecar until the
  corresponding field is edited. A projected `shape` block is not written into Animation IR; the source adapter
  remains responsible for restoring the original emitter geometry.

Further documentation:

- [DSL schema types](./src/dsl/schema.ts)
- [Animation IR contract](../animation-ir/README.md)
- [GE adapter and package boundaries](../ge-ir/README.md)

## API

### Runtime exports

| Export | Purpose |
| --- | --- |
| `convertDSLToIR` | Convert a new DSL document to IR, or write DSL values back to retained IR |
| `convertIRToDSL` | Convert IR to editable DSL and return the sidecar needed for write-back |
| `validateDSL` | Validate an unknown value against the DSL contract |
| `DSLValidationError` | Structured error for invalid DSL; conversion may also throw IR validation or other errors |
| `parseParticleShape` | Project GE-style numeric shape tags into optional read-only DSL context |
| `ValueType` | Runtime particle expression tags: `CONSTANT = 0`, `RANDOM = 4` |

Core signatures:

```ts
function convertDSLToIR(composition: Composition, options?: DSLToIROptions): DSLToIRResult;

function convertIRToDSL(scene: IRScene): IRToDSLResult;

function validateDSL(dsl: unknown): DSLValidationResult;
```

### Type exports

All public types are imported from the package root:

- DSL schema: `AnimationCurve`, `AnimatedProperty`, `Asset`, `Composition`, `CompositionMeta`, `Description`, `Layer`,
  `LLMSVGAsset`, `NumberExpression`, the `Particle*` types, `TextProperties`, `UserAsset`, and
  `ValueType`.
- Validation: `DSLValidationIssue` and `DSLValidationResult`.
- DSL to IR: `DSLToIROptions`, `DSLParticleSource`, `DSLToIRChange`, `DSLToIRResult`, and `DSLToIRWarning`.
- IR to DSL: `IRToDSLPreservedData` and `IRToDSLResult`.

Important result and option types:

```ts
interface IRToDSLResult {
  dsl: Composition;
  preservedData: IRToDSLPreservedData;
  diagnostics: ConversionDiagnostic[];
}

interface DSLToIRResult {
  sourceInstances?: { sourceIndex: number; idMap: Record<string, string> }[];
  scene: IRScene;
  diagnostics: ConversionDiagnostic[];
}

interface DSLParticleSource {
  preservedData: IRToDSLPreservedData;
  layers: Readonly<Record<string, string>>;
  authoringBounds?: readonly [x: number, y: number, width: number, height: number];
}

interface DSLToIROptions {
  preservedData?: IRToDSLPreservedData;
  particleSources?: readonly DSLParticleSource[];
  onWarning?: (warning: DSLToIRWarning) => void;
  onChange?: (change: DSLToIRChange) => void;
}
```

TypeScript callers should use `Layer['position']` or `AnimatedProperty<[number, number, number]>` for vector tracks
and `AnimatedProperty<number>` for opacity. `anchor` is static. Construct each `Layer` variant together with its required
`asset`, `text`, or `particle` content. Text requires content and a positive font size. Explicit line height is in
pixels; omit it to use `text.size * 1.2`.

Conversion can proceed with warnings for missing or malformed names, descriptions and asset prompts. Invalid
background or text styling uses the preserved style when available; new scenes omit invalid backgrounds and use
black text, a sans-serif font, left alignment, zero letter spacing and `text.size * 1.2` for invalid text styling.
A generated SVG prefers a valid asset URL and falls back to its inline SVG if the URL is missing or invalid. A valid
URL still works when the inline SVG is missing or cannot be encoded. If neither source is usable, conversion fails.
Static opacity accepts a single number in an array and clamps it to the valid range. Static `[x, y]` positions on
ordinary layers use `z = 0`. Conversion uses linear easing for invalid easing, ignores invalid or misplaced spatial
tangents, and freezes animated anchors at the first segment's start. The diagnostics identify each affected field.
If validation fails, `DSLValidationError.message` lists only the blocking errors; `issues` retains the warnings too.

## Project structure

```text
src/
  dsl/          DSL schema, emitter shape parsing, and validation
  dsl2ir/       DSL to Animation IR
    recombine/  Preserved-data write-back into retained IR
  ir2dsl/       Animation IR to DSL and precomposition expansion
  common/       Value mappings shared by both directions
```

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
