# @galacean/ge-ir

English | [简体中文](./README-zh_CN.md)

Bidirectional conversion between Galacean Effects and source-neutral Animation IR.

The package converts supported GE content into normalized IR and retains GE-only data in an adapter-owned sidecar
for fidelity-preserving export. Applications compose this adapter with `@galacean/dsl-ir` when editing DSL.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Input capabilities](#input-capabilities)
- [Preserved data](#preserved-data)
- [Data boundaries](#data-boundaries)
- [API](#api)
- [Project structure](#project-structure)
- [License](#license)

## Install

Node.js 24 or later is required.

```bash
pnpm add @galacean/ge-ir
```

## Usage

### Convert GE to Animation IR

```ts
import { convertGEToIR } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, {
  frameRate: 30,
  resourceBaseUrl: 'https://cdn.example.com/scenes/demo.json',
});

console.info(imported.scene);
console.info(imported.diagnostics);
```

`frameRate` converts GE timing in seconds to IR frames. `resourceBaseUrl` is optional and must be absolute when
supplied; it resolves relative image and font URLs at the GE import boundary.

### Particle source data

`convertGEToIR` extracts the ParticleSystem bindings and source layout needed for final host placement:

```ts
import { convertGEToIR } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });

console.info(imported.preservedData.particleSourceData);
```

Each source Composition containing ParticleSystems becomes one `particleEffectGroup`; every ParticleSystem retains an
independent binding and its original Item order. Because GE does not provide principal visual bounds, the adapter
stores `[0, 0, previewWidth, previewHeight]` as fallback `authoringBounds`, marked `authoringBoundsSource: 'source_preview'`.
Pass `particleAuthoringBounds` to import authored or reviewed activity regions by source GE Composition ID.
Source GE may omit an unused `animations` collection; when present, it must be an array.
Scenes without ParticleSystem components store empty group and Layer arrays. Complete renderer, shape, and resource
data remains in the GE-owned layer payload rather than this layout index.

### Particle spatial adaptation

`convertGEToIR(scene, { frameRate, particleAuthoringBounds: { [compositionId]: {
  bounds: [x, y, width, height], source: 'reviewed_multiframe_playback',
} } })` records activity bounds and their provenance (`'authored'` is also supported). Bounds must be inside the source
preview. Pass the same bounds to DSL `particleSources[].authoringBounds` and GE `sources[].authoringBounds`.

Explicit `convertIRToGE` source placements use both cameras to fit the wrapper, then bake scale, rotation, and off-center
perspective compensation into world-space motion. Source emitter transforms remain intact. Ordinary paired GE round trips
are unaffected. `particleFollowParent: true` is rejected. Mixed 3D directions, animated source transforms, orbital X/Y,
turbulence, and unsupported combinations of motion curves produce approximation diagnostics. Placement does not clip
particles to their target box. A deterministic 30 fps source replay checks scaled emission depth plus unscaled depth
travel against host near/far planes, including when size compensation is disabled. Estimated crossings emit
`GE_PARTICLE_DEPTH_CLIPPED` with the earliest sampled time per system and plane. Export keeps the motion and excludes
clipped samples from size estimates. The samples do not cover every random extreme or unsupported 3D operation.

Texture fill is looked up in the bundled offline table by the original `images[].url` and sprite-sheet `col/row/total`.
URL query strings and fragments are ignored; a different sheet layout is a different measurement. Conversion does not
download or decode images. The table in `src/particle/texture-fill-table.ts` contains the 117 texture entries from the
KiwiBeat v0.1.4 catalog (2026-11-05); update it when the provider publishes measurements for new or changed templates.
Each `sources` entry accepts `particleTextureFills: { [originalParticleSystemComponentId]: fill }` overrides in `(0, 1]`.
This replaces the decoded-pixel `particleTextures` option; callers should remove pixel loading and use the table or
precomputed overrides. `GE_PARTICLE_TEXTURE_FILL` reports each system's value and source (`table`, `given`, `untextured`,
or `default`). Untextured systems use their solid-disc fill. Unresolved URLs and missing table entries/layouts also use
`Math.PI / 4`, with `GE_PARTICLE_TEXTURE_FILL_MISSING` so callers can report missing catalog measurements.
An invalid override emits `GE_PARTICLE_TEXTURE_FILL_INVALID` and falls back to this same lookup.

`sources[].sizeCompensation` defaults to `true`. Deterministic analytic replay of the edited source uses texture fill,
visible sprite sizes, and coverage before motion is baked. One multiplier per source placement is the minimum of the
native display-size cap, the 15%-of-region-short-edge tail cap, the 12% coverage cap, and 3, clamped to `[1, 3]`.
Only initial particle sizes and independent trail widths change. `false` disables this size adjustment while retaining
spatial adaptation; a positive number fixes the multiplier. These two modes skip fill lookup. `GE_PARTICLE_SIZE_COMPENSATION`
reports the chosen factor, limits, and limiting constraint. Invalid fixed multipliers fall back to automatic sizing with
`GE_PARTICLE_SIZE_COMPENSATION_INVALID`. This estimate linearly interpolates curve keys and does not
promise pixel-identical Monte Carlo statistics or exact 3D playback.

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

### Convert Animation IR to GE

```ts
import { convertIRToGE } from '@galacean/ge-ir';

const exported = convertIRToGE(irScene);

console.info(exported.scene);
console.info(exported.diagnostics);
```

`convertIRToGE` validates the IR scene before conversion. `options.duration` can override the exported duration.

Exports use GE JSONScene **3.7**, with `children` on compositions and items instead of
`CompositionComponent.items`. Timeline assets and scene bindings retain playback and painter order.
Text uses `autoResize` and separates glyph size from item scale. Output is verified with GE Player `2.11.0-alpha.1`.
Consumers that read the former flat item list must traverse `children`; timeline-bound items use Timeline track
order for rendering. GE import continues to accept 3.6 input and also reads the exported 3.7 hierarchy and text units.

### Preserve GE-only data across a round trip

Pass the sidecar returned by `convertGEToIR` back to `convertIRToGE` when the IR has not been edited:

```ts
const imported = convertGEToIR(geScene, { frameRate: 30 });
const roundTripped = convertIRToGE(imported.scene, {
  preservedData: imported.preservedData,
});
```

The IR scene remains valid without the sidecar. Most supported layer types are also exportable without it. Particle
layers require their trusted GE sidecar for export because renderer, shape, and resource bindings are outside the
source-neutral particle contract. Supplying the sidecar restores compatible GE object-pool data, raw
animation payloads, component property tracks, camera configuration, renderer and geometry settings, masks,
precomposition payloads, sprite metadata, particle payloads, and source hierarchy data.

### Export edited IR with retained GE data

After editing IR, reconcile the original sidecar before exporting:

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const updatedScene = structuredClone(imported.scene);

updatedScene.compositions[0].layers[0].transform = {
  ...updatedScene.compositions[0].layers[0].transform,
  opacity: { type: 'static', value: 0.5 },
};

const updatedPreservedData = updateGEToIRPreservedData(
  imported.scene,
  updatedScene,
  imported.preservedData,
);

const exported = convertIRToGE(updatedScene, {
  preservedData: updatedPreservedData,
});
```

`updateGEToIRPreservedData` compares the baseline IR with the updated IR. It clones the supplied sidecar, removes only
GE values that conflict with changed IR fields, removes bindings for deleted compositions and layers, and returns the
reconciled sidecar. It does not modify either IR scene or generate GE output.

Changing a layer's activation interval keeps existing animation times: retained Bezier, linear, and color-gradient
curves are rebased to the new interval. Normalized IR keyframes use the edited composition's frame rate; animations
represented only in the GE sidecar retain their source times in seconds. Newly inserted layers follow IR painter order
among retained layers, while GE-only items keep their source slots.

## Input capabilities

This matrix describes GE JSONScene import and round trips. Supported applies to the listed IR subset; partial
requires approximation or GE-owned preserved data. Keeping a raw payload does not make it editable in IR.

| Capability | Status | Behavior |
| --- | --- | --- |
| Scene and compositions | Supported | Imports all source compositions and resolves the entry composition. |
| Common layers | Supported | Image, solid, text, shape, null, precomp, and valid ParticleSystem layers. |
| Hierarchy and timing | Supported | Parent references, painter order, seconds-to-frames, and activation timing. |
| Transform animation | Partial | Maps supported channels, including base-scale multipliers; raw encodings stay in the sidecar. |
| GE runtime graphs | Preserved | Effect, post-processing, model/lighting, FFD, video, camera controllers, and Animator objects remain GE-owned. |
| Component property tracks | Partial | Reconnects source component tracks and playable assets through preserved data. |
| Camera and renderer settings | Partial | Retains source cameras, depth/render settings, and referenced geometry in preserved data. |
| Sprite metadata | Partial | Tint, atlas splits, sampling settings, alternate image URLs, and texture sheets use preserved data. |
| Text and shape paints | Partial | Normalizes text metrics; gradients missing endpoints are dropped with a warning. |
| Mask references | Partial | Single resolvable masks; multiple or unresolved references remain source-specific. |
| Precomp export | Partial | Opacity, nonzero source start, and stretch can cause diagnostics; clipping composes with masks. |
| Particle editing | Partial | Maps supported parameters; export needs trusted source renderer, shape, and resources. |
| Particle opacity animation | Unsupported | Static opacity is applied; animated opacity produces an export warning. |
| Luminance matte export | Unsupported | Not generated; reports `GE_MATTE_MODE_UNSUPPORTED`. |
| Other item / plugin types | Preserved | Items outside the mapped subset remain in the sidecar with `GE_RUNTIME_ITEM_PRESERVED`. |
| External resources | Partial | Resolves image/font/media/binary URLs with `resourceBaseUrl`; no downloading. |

Inspect `diagnostics` for `normalized`, `approximated`, `dropped`, and `unsupported` actions. Particle source layout
without valid `previewSize` reports `GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE`; particle import can still succeed.
Malformed required data, a missing entry composition, invalid IR, or mismatched preserved data can throw errors.
The converter does not guarantee arbitrary plugin payloads or every GE runtime version will round-trip unchanged.

### Composition export

`convertIRToGE` generates the selected `entryCompositionId` and its reachable Precomp graph. Unreferenced IR
compositions and their items, components, and timelines are not generated. Shared references reuse a composition
unless clipping, masks, or inherited opacity require an instance-specific variant; unused originals are not emitted
alongside those variants. To export another root, set `entryCompositionId` to that composition before conversion.
GE-owned resources retained through `preservedData` continue to follow the preservation rules below.

### Mask export

Authored `layer.masks[]`, Precomp clipping, and Layer mattes compose into GE `mask.references[]` entries shaped as
`{ mask: { id: componentId }, inverted: boolean }`. Mask sources retain their hierarchy across compositions.
Redundant positive masks are removed only when their geometry shares the same coordinate space.

This is a breaking contract change: replace IR `mask: value` with `masks: [value]` and GE
`mask: { reference, inverted }` with `mask: { references: [{ mask: reference, inverted }] }`.
Import accepts legacy singular references and converts them to `references[]`; existing array references take precedence.
Export emits only array references, without modifying caller-owned input JSON. Playback requires a Runtime that reads
`mask.references[]`; the workbench uses GE `2.11.0-alpha.1` with matching plugins.

Positive references intersect and inverted references subtract. Multiple positive Add masks require a union, which
this Runtime model cannot express: additional positive Add entries are omitted with `GE_MASK_ADD_UNION_UNSUPPORTED`.
GE import still keeps multiple references in the paired preserved data instead of reconstructing an authored stack.

## Preserved data

`GEToIRPreservedData` is owned by this adapter and stored outside the Animation IR contract. Persist it together with
the IR scene when GE round-trip fidelity is required. Applications should not edit its internal fields directly.

GE-only items remain in their owning composition's preservation binding. They do not become placeholder IR Null
layers. Additional components on editable layers and composition-level components retain their object references,
timeline bindings, materials, shaders, geometry, binary resources, and media. Export rebuilds their hierarchy and
painter order around regenerated IR items; it also retains scene render settings. Media and binary URLs use
`resourceBaseUrl` when supplied, just like normalized image assets.

`GE_RUNTIME_ITEM_PRESERVED` reports items whose content is retained but cannot be edited through IR. These capabilities
require the paired `preservedData` and compatible GE Runtime/plugins; they are not portable IR feature definitions.
Deleting or changing the type of an editable layer removes its attached runtime components. GE-only sibling items
remain owned by the composition. Their internal parameters and animation are preserved rather than normalized.

Layer-level preserved data can include:

- raw position, rotation, scale, and color animation payloads, including static scale bases;
- component property tracks and their playable assets, renderer settings, and geometry references;
- sprite start color, texture splits, sampling settings, alternate image URLs, and texture-sheet animation settings;
- GE item and component identities, item timing, and independent Activation clip end behavior;
- masks and precomposition payloads that cannot be normalized losslessly;
- complete ParticleSystem payloads whose normalized IR fields override the corresponding values on export;
- the original single-item or null/sprite hierarchy.

Top-level `particleSourceData` indexes ParticleSystem source bounds, source order, and IR bindings used by final host
placement. A source Composition without a valid `previewSize` still imports into IR, but its host-placement bindings
are omitted and reported as
`GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE`.

Use `updateGEToIRPreservedData` for an edited scene. It derives all supported invalidations from the difference
between the baseline and updated IR scenes; layer-level lookup and invalidation remain internal implementation details.
Composition bindings also retain camera configuration. Property tracks are discarded when layer type or timing changes;
content or bounds edits invalidate property tracks, and opacity edits invalidate color tracks. Asset replacement
invalidates texture metadata; scale edits invalidate both the raw scale curve and its base.
Composition bindings cover imported content. Newly authored compositions do not need a source binding, while particle
layers still require their trusted GE payload. Export retains the source minimum web player version and binary slots.

## Data boundaries

- `@galacean/animation-ir` is the single source of truth for Animation IR types and validation.
- `GEToIRPreservedData` belongs to `@galacean/ge-ir`; it is never embedded in the source-neutral IR schema.
- Preserved data is bound to specific IR composition and layer identities. Version and scene bindings are
  validated before reuse.
- All source compositions are imported. The source entry composition becomes `IRScene.entryCompositionId`.
- External image and font resources entering IR must resolve to absolute URLs or Data URLs.
- Conversion diagnostics report normalization, approximation, dropped data, and unsupported features.
- Applications compose GE and DSL adapters through Animation IR. Their production code must not depend on each other.
- Particle import maps editable GE `options` fields to flat IR particle content, normalizes supported GE scalar forms
  to the IR curve model, and keeps engine-only particle data in the trusted sidecar. GE `options.startLifetime`
  uses seconds. Import and export convert it to and from IR `startLifetime` using the owning composition's
  frame rate. Export applies `maxParticles`, the lifetime expression,
  `rateOverTime`, `bursts`, Layer blend mode, anchor, and static opacity to that baseline instead of fabricating
  renderer, shape, or resource defaults. Animated Particle Layer opacity is reported as unsupported because GE has
  no timeline-compatible Particle renderer opacity target.
- Particle random endpoints are ordered for IR validation, and curves are cropped to emitter progress `[0, 1]`.
  Unedited parameters retain their original GE expressions to preserve evaluation and seeded random order. Negative
  item dimensions become positive local bounds with reflection in the scale channel.
- GE burst defaults are normalized to explicit IR `cycleCount` and `repeatIntervalFrames` values, including
  unbounded cycles, with an informational normalization diagnostic. GE Item end behavior enters the normalized Layer;
  Activation clip end behavior is retained independently in preserved data and restored during export.

Further documentation:

- [Animation IR contract](../animation-ir/README.md)
- [DSL adapter and editing contract](../dsl-ir/README.md)

Ordinary and particle layers share the initial DSL `position.z` stacking order; higher values render above lower
values. Reordering input arrays does not change stacking. Ordinary child subtrees stay together at their root rank.
The rank-to-item mapping is internal and is not serialized into GE transforms.

## API

### Conversion and preservation

```ts
function convertGEToIR(scene: Record<string, unknown>, options: GEToIROptions): GEToIRResult;

function convertIRToGE(scene: IRScene, options?: IRToGEOptions): IRToGEResult;

function updateGEToIRPreservedData(
  baselineScene: IRScene,
  updatedScene: IRScene,
  preservedData: GEToIRPreservedData,
  options?: UpdateGEToIRPreservedDataOptions,
): GEToIRPreservedData;

```

Results and options:

```ts
interface GEToIRResult {
  scene: IRScene;
  preservedData: GEToIRPreservedData;
  diagnostics: ConversionDiagnostic[];
}

interface IRToGEResult {
  itemLayerIds: Readonly<Record<string, string>>;
  scene: JSONScene;
  diagnostics: ConversionDiagnostic[];
}

interface GEToIROptions {
  frameRate: number;
  resourceBaseUrl?: string;
}

interface IRToGEOptions {
  duration?: number;
  preservedData?: GEToIRPreservedData;
  sources?: readonly {
    scene: IRScene;
    preservedData: GEToIRPreservedData;
    idMap: Readonly<Record<string, string>>;
  }[];
}
```

`UpdateGEToIRPreservedDataOptions.onChange` receives the composition, layer, and preserved field removed during
reconciliation.

### Runtime exports

| Export | Purpose |
| --- | --- |
| `convertGEToIR` | Import GE JSONScene as Animation IR and GE-owned preserved data |
| `convertIRToGE` | Export Animation IR as GE JSONScene |
| `updateGEToIRPreservedData` | Reconcile GE preserved data after IR edits |
| `get2dTo3dRatio` | Calculate the coordinate conversion ratio |

### Type exports

All public types are imported from the package root:

- Conversion: `GEToIROptions`, `GEToIRResult`, `IRToGEOptions`, and `IRToGEResult`.
- GE preserved data: `GEToIRPreservedData`.
- Reconciliation: `GEToIRPreservedDataChange` and `UpdateGEToIRPreservedDataOptions`.

`JSONScene` is defined by `@galacean/effects-specification` and should be imported from that package.

## Project structure

```text
src/
  ge2ir/                   GE parsing, mapping, assembly, and post-processing
  ir2ge/                   IR conversion, GE generation, assembly, and post-processing
  particle/                Particle fragment extraction, layout, and host-scene merge
  common/                  Coordinate, DataPath, JSON, ID, and math utilities
  conversion.ts            Public conversion result and option types
  preserved-data.ts        GE-owned composition and layer data contract
  layer-preserved-data.ts  Layer data lookup and field invalidation
  update-preserved-data.ts Scene-level preserved-data reconciliation
  index.ts                 Stable public entry
```

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.
