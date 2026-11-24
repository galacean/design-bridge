# Runtimes and limitations

Select the documented public entry appropriate for your runtime when installing a converter.

## Browser and Node.js

Repository development and documented Node.js usage require Node.js 24+; the repository uses pnpm 10+.
Browser applications must select browser-compatible entries:

| Package | Entry and runtime |
| --- | --- |
| `animation-ir` | ESM root for types; `/validator` and `/adapter` for validation and shared adapter utilities |
| `ge-ir`, `dsl-ir`, `lottie2ir`, `shader2ge`, `figma2ge` | Public root; ESM and CommonJS builds |
| `svg2ir` | Conditional root export selects Node's `svgdom` setup or the browser entry; no `/node` subpath |
| `html2figma` | Node root or `/node`; browser `/browser` and its documented subpaths |

Install Playwright Chromium for Node HTML extraction. Browser HTML extraction uses DOM and iframes and needs no
Playwright installation. SVG graphic baking additionally needs browser SVG, Canvas, and image support; Node static
layer export can retain native images/text but reports graphics it cannot bake.

## Resources and players

IR, GE, DSL, Lottie, and SVG IR/GE conversion resolve or preserve resource references;
they do not fetch those resources.
SVG static layer export fetches and inlines images, while HTML extraction and export may read fonts and other resources.
Browser reads require CORS where applicable. Configure these paths separately;
resource loading depends on the conversion path.

The GE player needs WebGL and the plugins used by the scene; `figma2ge` currently expects the matching
`@galacean/effects@2.11.0-alpha.1` peer. Shader playback targets WebGL 1.0;
conversion does not compile shaders on a GPU. Dispose players when replacing a scene or leaving the page.
Fonts, resource availability, and renderer versions affect pixels.

## Supported scope

Validation checks data contracts, not pixel equality or resource safety. Read converter diagnostics as well:

- Lottie effects, expressions, 3D features, and unsupported mask stacks are omitted or approximated. Embedded glyphs
  may become shapes rather than editable text.
- GE runtime graphs, particle renderer data, and other GE-only fields require paired GE preserved data
  and runtime plugins.
- SVG IR/GE and static layers have different feature coverage. Baked static graphics lose vector editability
  and animation.
- HTML conversion captures a rendered snapshot. `.fig` output defaults to snapshot layout;
  inferred Auto Layout is optional.
- Figma import is under development. Check `.fig` output in native Figma and GE output in the target player.

Limit untrusted input sizes, archive expansion, dimensions, and processing time. HTML script isolation is not a network
or local-file sandbox; see [design files and web pages](../design-to-ge/).

## Documentation version

Check the API reference's selected package/version against the package installed in your application. `current` selects
that package's current snapshot; package release versions are independent. Missing translated comments can fall back to
the source language, and undocumented symbols can still show signatures.
Package READMEs describe entry points and limits.

For problems, see [Troubleshooting](../troubleshooting/). Return to [getting started](../getting-started/) or browse the [API](../../api/).
