# Best practices

Recommendations by scenario. Examples are static code and do not run live on this page; for live results, see
[Try it in the local workbench](../playground/).

## Scenario 1: ship Lottie assets as GE

1. Validate with `validateIRScene` right after conversion, then generate GE.
2. Walk `diagnostics`: log `dropped` and `unsupported` entries in your build; have design spot-check `approximated` ones.
3. Resolve relative resources through an absolute `resourceBaseUrl`; `extractLottieFromZip` turns supported bundled
   resources into Data URLs. External resources missing from the ZIP still need runtime access.
4. Verify representative frames on the workbench frame-comparison page, then run batch regression.

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';
import { convertLottieToIR } from '@galacean/lottie2ir';

const { scene, diagnostics } = convertLottieToIR(lottieJSON, { resourceBaseUrl });
const report = validateIRScene(scene);

if (!report.valid) {
  throw new Error('Invalid IR scene');
}
const blocking = diagnostics.filter(item => item.action === 'unsupported');

if (blocking.length > 0) {
  console.warn('Unsupported Lottie features', blocking);
}
```

## Scenario 2: controlled edits of an existing GE scene (including AI edits)

The path is `GE → IR → DSL → edit → IR → GE`. Store the two paired sidecars and keep DSL changes minimal.

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';
import { convertDSLToIR, convertIRToDSL, validateDSL } from '@galacean/dsl-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const editable = convertIRToDSL(imported.scene);

const nextDSL = await editDSL(editable.dsl); // manual or model edit

if (validateDSL(nextDSL).result === 'fail') {
  throw new Error('Invalid DSL');
}
const restored = convertDSLToIR(nextDSL, { preservedData: editable.preservedData });
const gePreserved = updateGEToIRPreservedData(imported.scene, restored.scene, imported.preservedData);
const output = convertIRToGE(restored.scene, { preservedData: gePreserved });
```

- Store `imported.preservedData` (GE sidecar) and `editable.preservedData` (DSL sidecar) together with the scene that
  produced them; never reuse them across scenes.
- After the DSL write-back produces a new IR, reconcile the GE sidecar with `updateGEToIRPreservedData` before
  exporting GE.
- Run `validateDSL` on model output before converting. On failure, feed the issues back to the model instead of
  silently falling back.
- Change only the fields that need to change; untouched layers are restored from the sidecar, which best preserves
  the original GE semantics.
- The `onChange` / `onWarning` callbacks of `convertDSLToIR` let you audit what the edit actually applied.
- The GE and DSL packages do not depend on each other; the application composes them. Store their sidecars in
  separate fields and pass each only to its owning adapter.

## Scenario 3: SVG vector animation and layer export

- Playback: `convertSVGToGE` outputs GE; check `warnings` and hand the scene to the player.
- Further editing: `convertSVGToIR`, then the DSL editing path.
- Layer hand-off: `convertSVGToLayers`; read images through `loadImage` to centralize authentication and caching.
- Browser static export can bake supported graphics into PNGs. Retain array order, inspect baking warnings, and
  choose `rasterScale` for your output resolution; Node does not provide this browser rasterization path.
- Dynamic SVG duration comes from the SMIL active interval; for static SVG pass `durationSeconds` explicitly.
- Fonts must be available to the GE runtime; inject them with the `fonts` option.

## Scenario 4: web page to Figma

- Fix `viewport`, disable unnecessary scripts, and keep resources in a ZIP or virtual project. Node extraction also
  supports `networkPolicy: 'offline'`; the browser API has no equivalent offline switch.
- Supply font bytes for browser export, or obtain Local Font Access permission. Browser `.fig` generation rejects
  missing visible glyphs by default. Use snapshot layout for measured positions; opt into Auto Layout deliberately.
- Check `result.validation` before writing `result.bytes`.
- Interactions and CSS animations are not restored; treat the output as a design snapshot.
- Use the root entry in Node.js; in browsers use `@galacean/html2figma/browser` and do not pull in the Playwright path.

## Scenario 5: Figma design to GE

```ts
const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);

if (result.issues.length > 0) {
  console.warn(result.issues);
}
```

This package is still in development. Re-run the same representative `.fig` files after every upgrade and watch
layout, text, and effect approximations. For a web-to-runtime pipeline, compose `html2figma` and `figma2ge`
explicitly in your application; do not expect a one-step lossless conversion.

## Scenario 6: shader as a procedural background

- Keep a single-pass fragment shader in WebGL 1.0 syntax and confirm it compiles in the target GE runtime first.
- Expose tunables with `uniformOverrides`, bind image textures with `channelTextures`, and use `result.uniforms` to
  build a parameter panel.
- Set `duration`, `previewSize`, and `endBehavior` explicitly rather than relying on the 5 s / 512×512 defaults.

```ts
const result = convertShaderToGE(fragmentSource, {
  duration: 8,
  previewSize: [1080, 1080],
  uniformOverrides: { uSpeed: 1.5 },
});
```

## General engineering habits

| Habit | Why |
| --- | --- |
| Always read diagnostics, warnings, or issues | A successful conversion is not lossless |
| Keep editing baselines separate | Node HTML export updates font sources; clone scenes when needed |
| Store sidecars with their outputs | Preserved data pairs one-to-one with a scene |
| Regress with small, stable samples | Batch regression reveals upgrade drift |
| Import only from public package entries | Internal paths are not a stable contract |
| Verify pixels in the target player | Validation passing does not imply identical rendering |

Go deeper: [DSL editing guide](../dsl-editing/), [Shader to GE guide](../shader-to-ge/), [Design files and web pages](../design-to-ge/).

Next: [Troubleshooting](../troubleshooting/), then [Try it in the local workbench](../playground/).
