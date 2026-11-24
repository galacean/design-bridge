# DSL editing guide

The DSL is JSON for humans and models to edit: time in **seconds**, colors as strings, and animation as piecewise
curves, which makes it easier to read and write than Animation IR. `@galacean/dsl-ir` provides validation and
two-way conversion with IR. See types such as [Composition](../../api/dsl-ir/current/Composition/); the authoritative
definition is [schema.ts](https://github.com/galacean/design-bridge/blob/main/packages/dsl-ir/src/dsl/schema.ts).

## Document structure

A DSL document consists of `meta` and `layers`:

```ts
import { validateDSL, convertDSLToIR, type Composition } from '@galacean/dsl-ir';

const dsl: Composition = {
  meta: {
    name: 'demo',
    duration: 2, // seconds
    fps: 30,
    width: 750,
    height: 400,
    loop: true,
    background_color: '#101020',
  },
  layers: [{
    id: 'title',
    name: 'title',
    type: 'text',
    width: 400,
    height: 60,
    description: { self: 'Title text', composite: 'Title text' },
    position: {
      a: true,
      animation: [{
        t: [0, 1], // segment start/end in seconds
        start: [375, 120, 0],
        end: [375, 200, 0],
        easing: [0.33, 0, 0.67, 1], // cubic Bezier
      }],
    },
    opacity: { a: false, value: 1 },
    text: { content: 'Hello', size: 48, color: '#ffffff', align: 'center' },
  }],
};
```

- Layer types: `null` (transform node), `layer` (image, requires `asset`), `text` (requires `text`), `particle`
  (requires `particle`).
- A property is `{ a: false, value }` when static and `{ a: true, animation: [...] }` when animated. The end of one
  segment and the start of the next may differ, which expresses an instant reset.
- The **initial** `position.z` decides the stacking order of siblings; larger values are on top. Array order does not
  decide occlusion.
- `time_range`, `rotation`, `scale`, `anchor`, and `opacity` may be omitted. Preserved write-back keeps the source
  values; a fresh conversion uses defaults.
- Text uses its horizontal alignment point on the first-line baseline as the local origin. Width and height do not
  add a translation. Conversion offsets the IR text bounds and preserves parent transforms; apply the text anchor once.

## Validate first, then convert

`validateDSL` accepts any input, never throws, and returns `result` (`'pass'` or `'fail'`), `errors`, and `warnings`:

```ts
const report = validateDSL(dsl);

if (report.result === 'fail') {
  for (const issue of report.errors) {
    console.error(issue.code, issue.path, issue.message);
  }
}
```

Each issue has a stable `code`, a JSON `path`, and an optional `layerId`. Run this on manual edits and model output
alike; feeding `errors` back to the model lets it correct itself.

## Creating from scratch

A DSL created from scratch needs no preserved data:

```ts
const { scene, diagnostics } = convertDSLToIR(dsl);
```

The resulting `scene` always satisfies the Animation IR contract and can go on to `convertIRToGE`.

## Editing an existing scene

Export DSL from IR and store `preservedData` together with the DSL:

```ts
import { convertIRToDSL } from '@galacean/dsl-ir';

const { dsl, preservedData } = convertIRToDSL(scene);
const edited = structuredClone(dsl);

edited.layers[0].opacity = { a: false, value: 0.5 };

const result = convertDSLToIR(edited, {
  preservedData,
  onChange: change => console.info(change.kind, change.op, change.field),
  onWarning: warning => console.warn(warning.code, warning.message),
});
```

- `onChange` reports each applied modification; `onWarning` reports edits that were safely ignored (such as adding a
  layer or changing a type). Warnings do not interrupt conversion.
- `preservedData` can be persisted with `JSON.stringify`, but do not modify it or rely on its internals.
- Preserved write-back supports field edits, deletion, and same-parent reordering of existing layers.
- Precompositions are expanded in the DSL; shared instances edit the same source layer, and conflicting edits to the
  same field keep the original value and report a warning.
- Invalid DSL, mismatched preserved data, or position edits that cannot keep source depth throw. Catch the error,
  keep the last valid scene, and replace it only on success.

## Combining with GE

When editing a GE scene, the GE and DSL preserved data are **independent**. After the DSL write-back produces a new
IR, reconcile the GE preserved data before exporting:

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const editable = convertIRToDSL(imported.scene);
const edited = structuredClone(editable.dsl);

edited.meta.duration = 4;

const updated = convertDSLToIR(edited, { preservedData: editable.preservedData });
const gePreserved = updateGEToIRPreservedData(imported.scene, updated.scene, imported.preservedData);
const output = convertIRToGE(updated.scene, { preservedData: gePreserved });
```

Skipping `updateGEToIRPreservedData` leaves the GE sidecar out of sync with the edited IR.

## Particle layers

A particle is an ordinary layer with `type: 'particle'`. You can edit `options` (`maxCount`, `startLifetime`) and
`emission` (`rateOverTime`, `bursts`).

- Values use a subset of GE `NumberExpression`: a constant or a random range. IR curves are projected with
  diagnostics and preserved by the sidecar while the field is unedited.
- `startLifetime`, burst times, and intervals use seconds; `rateOverTime` is particles per second. The adapter maps
  them to the particle's own IR composition frame rate, including inside a precomp.
- Omitted or zero `burst.cycles` means unbounded repetition; use `cycles: 1` for one burst. When repeating, `interval` (seconds) must
  be greater than 0.
- `shape` is read-only emitter geometry supplied by the source adapter to help models understand the emitter; do not
  write it back by hand.
- Renderer, texture, and other GE-only fields stay in the GE preserved data; exporting particles requires a trusted
  GE sidecar, either for the imported scene or for each placed source below.

## Combining particle sources

Use `particleSources` to place existing particle systems alongside ordinary layers in a complete target DSL.
`fullDSL` below is a validated target document containing a root particle leaf with ID `target-particle`;
`particleGE` is a trusted GE 3.6 source with a self-contained particle composition:

```ts
import { convertDSLToIR, convertIRToDSL } from '@galacean/dsl-ir';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';

const particle = convertGEToIR(particleGE, { frameRate: 30 });
const source = convertIRToDSL(particle.scene);
const sourceLayer = source.dsl.layers.find(layer => layer.type === 'particle' && layer.parent == null);

if (sourceLayer === undefined) {
  throw new Error('The source needs a root particle layer');
}
const converted = convertDSLToIR(fullDSL, {
  particleSources: [{
    preservedData: source.preservedData,
    layers: { 'target-particle': sourceLayer.id },
  }],
});
const exported = convertIRToGE(converted.scene, {
  sources: converted.sourceInstances?.map(({ idMap }) => ({ ...particle, idMap })),
});
```

- `layers` maps target DSL IDs to source DSL IDs. Each entry places one system or the complete source group in an
  independent IR Precomp. Coupled systems must stay together; repeated placements use separate entries.
- Targets must be root particle leaves with a static position, Z-only rotation, uniform XY scale, and `scale.z = 1`.
  Systems sharing one entry must have the same target dimensions and placement transform.
- Target width, height, and position fit the source region proportionally without clipping; `position.z` orders it
  with ordinary layers. Optional `authoringBounds` selects the source region instead of its full canvas.
- Rotation and scale place the wrapper rather than modifying the source emitter. Reset these fields when cloning
  a source layer for fresh layout. Name, opacity, timing, and editable particle values still update the source IR.
- Omitted `time_range` extends the particle and its ancestors to the host duration; explicit timing remains intact.
  `meta.duration` controls the host playback window.
- With multiple sources, pair each returned `sourceIndex`/`idMap` with the original GE import at that index.
  GE export restores and reconciles source payloads through `sources`; the DSL package does not read GE sidecars.

GE source placement adapts world-space motion and enables automatic sprite-size compensation. Inspect diagnostics
such as `GE_PARTICLE_SIZE_COMPENSATION`, `GE_PARTICLE_TEXTURE_FILL_MISSING`, and `GE_PARTICLE_DEPTH_CLIPPED`.
Per-source `sizeCompensation` accepts `false` or a positive fixed multiplier; `particleTextureFills` supplies
precomputed mean-alpha overrides keyed by original ParticleSystem component IDs. See the
[GE guide](https://github.com/galacean/design-bridge/blob/main/packages/ge-ir/README.md#particle-spatial-adaptation).

## Common pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Layer order did not change after an edit | The DSL orders by `position.z`, not array order | Change the initial `position.z` |
| A newly added layer did not appear | Preserved write-back does not support adding layers | Check `onWarning`; add the layer on the IR side |
| Preserved data mismatch error | `preservedData` from another scene was used | Store it paired with its DSL |
| Font size validation fails | `size` and `line_height` must be greater than 0 | Fix the values |

Continue with [Fidelity editing](../fidelity-editing/) or return to [Best practices](../best-practices/).
