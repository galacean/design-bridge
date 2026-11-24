# Fidelity editing

Save editable DSL together with its preservation sidecar. The sidecar retains source data and mappings that the DSL projection cannot directly express.

## IR and DSL round trip

```ts
import { convertIRToDSL, convertDSLToIR } from '@galacean/dsl-ir';

const editable = convertIRToDSL(scene);
// Edit editable.dsl while retaining editable.preservedData.
const restored = convertDSLToIR(editable.dsl, {
  preservedData: editable.preservedData,
});
console.info(restored.scene, restored.diagnostics);
```

[IRToDSLPreservedData](../../api/dsl-ir/current/IRToDSLPreservedData/) must stay paired with the DSL that produced it. Do not mix sidecars from different scenes. Converters do not mutate their input.

## GE source preservation

GE to IR returns its own `GEToIRPreservedData`. Applications manage GE and DSL sidecars separately and return the GE sidecar when converting IR to GE. If the IR was edited, reconcile it with `updateGEToIRPreservedData` first; see the [DSL editing guide](../dsl-editing/). The DSL package does not process the GE sidecar.

GE-only runtime items, component tracks, materials, media, and particle renderer settings can remain in that sidecar.
Their retention does not make them editable through IR or DSL, and playback still needs the matching runtime plugins.
For particle sources placed in a new composition, pass their original import results and ID mappings through
`convertIRToGE`'s `sources` option; it reconciles those sources during export.

## Editing boundaries

Recoverable unsupported edits produce diagnostics. Invalid DSL, invalid IR, or mismatched sidecars may throw. Inspect diagnostics and validate actual rendering; a successful return does not establish pixel equality.
