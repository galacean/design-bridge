# Troubleshooting

Look up causes by symptom. When something goes wrong, read the diagnostics first: they are the converter's
first-hand account of what changed and why.

## Diagnostics cheat sheet

| Source | Where | What to look at |
| --- | --- | --- |
| `lottie2ir`, `ge-ir`, `dsl-ir` | `diagnostics[]` | `severity`, `action` (`normalized` / `approximated` / `dropped` / `unsupported`), `path` |
| `svg2ir` | `warnings[]` | SVG features that were degraded or dropped |
| `shader2ge` | `diagnostics[]` | `code` and `severity`; **handle errors first** |
| `figma2ge` | `issues[]` | Warnings and errors; `debugMap` locates nodes |
| `html2figma` | `diagnostics`, `validation` | Missing resources; file structure validation |
| `animation-ir` | `errors` / `warnings` of `validateIRScene` | Stable `code`, `path`, `layerId` |
| `dsl-ir` | `errors` / `warnings` of `validateDSL` | `code`, `path`, `layerId` |

## Conversion fails (throws)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `LottieConverterError` | `INVALID_LOTTIE_JSON`, `ZIP_PARSE_FAILED`, `ZIP_JSON_NOT_FOUND`, `IR_VALIDATION_FAILED`, `CONVERT_PIPELINE_FAILED` | Branch on `error.code` and read `details`; a ZIP must contain the Lottie JSON |
| DSL → IR throws | Invalid DSL or mismatched preserved data | Run `validateDSL` first; confirm `preservedData` came from the same scene |
| Particle export fails | Missing GE sidecar | Use paired `preservedData` or placed-source `sources` |
| Particle placement fails | Invalid binding or layout | Check the [source requirements](../dsl-editing/) |
| GE → IR throws | Missing entry composition or invalid required data | Check `compositions` in the JSONScene |
| `.fig` decoding fails | Not a Figma ZIP, or corrupt compressed data | Confirm it contains `canvas.fig`; check with `make verify-fig` |

## Conversion succeeds but the result is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| IR/GE resources missing | Unresolved references | Set `resourceBaseUrl` or bundle resources; load them at playback |
| Fonts differ from the design | System fonts depend on the runtime | Supply font resources; validation warns `IR_ASSET_FONT_SYSTEM_PORTABILITY` |
| Effects missing or distorted | `dropped` / `approximated` / `unsupported` diagnostics | Locate by `path`; rework in the design tool or accept the approximation |
| Properties lost after a GE round trip | GE preserved data not passed back, or sidecar not reconciled after IR edits | Pass `preservedData`; after editing IR call `updateGEToIRPreservedData` first |
| A DSL edit had no effect | The edit is not supported by preserved write-back (adding layers, changing type) | Check `onWarning`; do it on the IR side |
| Wrong layer order | Array order mistaken for occlusion order | IR uses array order as painter order; DSL uses the initial `position.z` |
| Wrong timing | Seconds and frames mixed up | IR uses frames (per-composition frame rate); DSL and GE use seconds |
| Animation too long or short | Differing composition and layer `endBehavior` | Set `loop` / `freeze` / `destroy` explicitly |
| Rendering differs despite passing validation | Valid structure is not pixel parity | Check fonts, resources, and versions in the target player |
| SVG shapes missing in Node | No graphic baking APIs | Export static layers in a browser; inspect warnings |
| Lottie text is a shape | Embedded glyph conversion | Keep font-based text when editability is required |

## Shader

| Symptom | Fix |
| --- | --- |
| `SHADER_VERSION_UNSUPPORTED` | Use GLSL ES 1.0: `varying`, `gl_FragColor`, `texture2D` |
| `SHADER_MAIN_MISSING` / `SHADER_OUTPUT_MISSING` | Provide `main()` writing `gl_FragColor`, or a `mainImage` |
| Shader fails to compile at playback | The converter does not fully compile GLSL; debug syntax and precision on the target device |
| Override has no effect | Check `UNIFORM_OVERRIDE_*` diagnostics; use `vec4` instead of `vec2`/`vec3` |
| Texture turns white | `TEXTURE_FALLBACK_USED`: check the URL, CORS, and input shape |

## HTML → Figma

| Symptom | Fix |
| --- | --- |
| Node extraction fails | Confirm Playwright Chromium is installed; check `timeoutMs` and `maxInputBytes` |
| Missing resources | See `RESOURCE_NOT_FOUND`; bring local resources via ZIP / VirtualProject |
| Browser glyphs missing | Supply matching font bytes or permit Local Font Access |
| Text differs between runtimes | Match font bytes, family, style, weight, and shaping; inspect export warnings |
| Text becomes an image | Read `TEXT_RASTERIZED`; color emoji and opted-in synthetic styles lose text editability |
| Layout changes | Keep `snapshot` layout unless inferred `auto-layout` is needed |
| Animations are missing | The package takes page snapshots and does not restore animation or interaction |

## Environment and build

| Symptom | Fix |
| --- | --- |
| Install rejected | The repository enforces pnpm; Node 24+ and pnpm 10+ are required |
| Empty asset selector | Check the GE/DSL/Lottie URL manifests described in [workbench inputs](../playground/) |
| Node-only APIs pulled into a browser bundle | Use each package's browser subpath and avoid the Playwright path |

If you still cannot find the cause, keep the smallest input, the diagnostics output, and the package versions,
reproduce it in the workbench, and [open an issue](https://github.com/galacean/design-bridge/issues).
You can also revisit [Runtimes and limitations](../runtime-and-limits/).
