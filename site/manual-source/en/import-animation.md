# Importing Lottie and SVG

This chapter follows the flow input → IR → validation → output for the two most common animation inputs.
By the end you can turn Lottie or SVG into a Galacean Effects (GE) scene and read the diagnostics.

## Lottie → IR → GE

`@galacean/lottie2ir` accepts a Lottie JSON object or a serialized string. Conversion is synchronous and throws
`LottieConverterError` on failure.

```ts
import { convertLottieToIR, LottieConverterError } from '@galacean/lottie2ir';
import { validateIRScene } from '@galacean/animation-ir/validator';
import { convertIRToGE } from '@galacean/ge-ir';

try {
  const { scene, diagnostics } = convertLottieToIR(lottieJSON, {
    resourceBaseUrl: 'https://cdn.example.com/lottie/',
  });
  const report = validateIRScene(scene);
  const effects = convertIRToGE(scene);

  console.info(report.valid, diagnostics, effects.scene);
} catch (error) {
  if (error instanceof LottieConverterError) {
    console.error(error.message);
  }
  throw error;
}
```

- `resourceBaseUrl` must be absolute. It resolves relative image and font paths in the Lottie file; external
  resources are not downloaded during conversion.
- Each entry in `diagnostics` carries an `action` (`normalized`, `approximated`, `dropped`, `unsupported`) and a
  JSON path that locates the affected feature.
- `convertIRToGE` returns `scene` (GE JSONScene), `diagnostics`, and `itemLayerIds` (GE item → IR layer mapping).

### ZIP with resources

Assets are often delivered as a ZIP. Extract the JSON and resources first; resources inside the ZIP become Data URLs.

```ts
import { convertLottieToIR, extractLottieFromZip } from '@galacean/lottie2ir';

const extracted = await extractLottieFromZip(zipArrayBuffer);
const { scene } = convertLottieToIR(extracted.json, { zipResources: extracted });
```

Static filled point-text with embedded `chars` can become vector Shape layers, preserving glyph outlines but losing
text editability. Missing or unsupported glyphs fall back to font-based text with `LOTTIE_UNSUPPORTED_TEXT_GLYPHS`.
Authored masks support an ordered subset of closed, static, fully opaque add/subtract/intersect paths; an unsupported
entry drops the whole stack with `LOTTIE_UNSUPPORTED_MASK`. IR can retain luminance mattes that GE cannot export.
Read both import and GE export diagnostics, not just the first conversion's result.

## SVG → GE

[convertSVGToGE](../../api/svg2ir/current/convertSVGToGE/) in `@galacean/svg2ir` converts an SVG string into a GE scene.

```ts
import { convertSVGToGE, splitSVG } from '@galacean/svg2ir';

const context = splitSVG(svgText, {
  frameRate: 30,
  durationSeconds: 5,
});
const { data, warnings } = convertSVGToGE(context);
```

`data` is the GE JSONScene and `warnings` lists dropped or degraded SVG features. A static SVG is shown for
`durationSeconds`; an SVG with SMIL animation follows its active interval. Passing the `splitSVG` context preserves
SVG-specific data and reuses the parsed IR instead of parsing the source again.

### IR only

To keep editing in IR, call [convertSVGToIR](../../api/svg2ir/current/convertSVGToIR/), which returns
`{ ir, warnings }`. Continue with `convertIRToGE` or `convertIRToDSL`.

### Static layer export

For design hand-off and text/image separation, use `convertSVGToLayers`, which returns a Promise:

```ts
import { convertSVGToLayers } from '@galacean/svg2ir';

const { size, data, warnings } = await convertSVGToLayers(svgText, {
  rasterScale: 2,
  loadImage: async url => {
    const response = await fetch(url, { headers: { Authorization: token } });

    if (!response.ok) {
      throw new Error(`Image load failed: HTTP ${response.status}`);
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? 'image/png',
    };
  },
});
```

`size` is the canvas size and `data` is the list of image and text layers. `loadImage` returns raw bytes and a MIME type (not Base64), which suits authenticated images; without it `fetch` is used;
embedded Data URLs need no loading. See [SVGImageResourceLoader](../../api/svg2ir/current/SVGImageResourceLoader/)
for the callback signature.

- Create layers in `data` array order to preserve painter order. Native SVG text remains editable; text inside an
  image is not recognized. Layer bounding boxes use canvas pixels.
- In browsers, self-contained static graphics can be baked into transparent PNGs, including supported gradients,
  filters, patterns, clipping, and masks. Group-wide effects can merge child graphics;
  native text and images stay separate.
- Baking requires SVG, Canvas, and image support. Node export reports graphics it cannot bake. Mixed groups containing
  native text/images and external paint resources cannot always be baked.
- `rasterScale` defaults to `2` and changes raster resolution, not display size. The working raster is limited to
  16 megapixels. Baked vector geometry is no longer editable; non-normal blend modes are downgraded with warnings.
- Static export removes SMIL animation elements and does not sample an animation frame. `strict: true` rejects
  unsupported features and style downgrades; successful baking remains advisory.

These baking capabilities belong to static layer output; they do not add filter/pattern support to SVG → IR → GE.

## Reading diagnostics

| Fields | Meaning | Suggested action |
| --- | --- | --- |
| `info` + `normalized` | Source semantics were standardized | Usually nothing |
| `warning` + `approximated` | The effect is approximate | Check visually in the target player |
| `warning` + `dropped` | A feature was dropped | Judge the visual impact; adjust the source if needed |
| `warning` + `unsupported` | The source feature is unsupported | Rework it in the design tool or use another path |

Diagnostics are first-hand evidence of format differences. Log them before saving or shipping, and spot-check
representative frames. Continue with [Conversion paths](../conversion/) for the other six packages, or read
[Best practices](../best-practices/).
