# The Animation IR model

Animation IR is a source-independent model for 2D animation. `@galacean/animation-ir` owns the canonical types and validation.

## Scenes and compositions

[IRScene](../../api/animation-ir/current/IRScene/) stores compositions, an entry composition ID, and an asset registry. Layers can reference shared precompositions. IDs represent stable identity; they do not imply render order.

## Time, coordinates, and animation

Layers have separate timing and transform fields. Properties may be static or keyframed. Converters map the coordinate and timing semantics of each source format into IR; copying raw source fields does not perform this mapping.

## Validate

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';

const report = validateIRScene(scene);
if (!report.valid) {
  console.error(report.errors);
}
```

Validation separates errors from warnings. Asset portability or empty-content warnings do not mean the model is invalid. To build a scene yourself, see [Authoring Animation IR](../author-animation-ir/); otherwise continue to [conversion paths](../conversion/).
