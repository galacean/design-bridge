# HTML conversion corpus

Every fixture starts with `index.html`, its resources, and `case.json`. The standard integration test calls the public
HTML extraction and FIG generation APIs. It never starts from a handwritten Scene or a competitor's AST.

Run from the repository root:

```bash
pnpm --filter @galacean/html2figma test:html
HTML2FIGMA_TEST_ARTIFACTS="$PWD/.plans/html-corpus" pnpm --filter @galacean/html2figma test:html
```

The optional artifact directory contains standalone `input.html`, Chromium `reference.png`, `reference.json`,
`scene.json`, and `output.fig` for each fixture. The reference records `visualAcceptance: "not-run"`: structural validity,
text preservation, geometry, and resource checks do not prove visual parity in Figma. The default test does not depend
on OpenPencil, Figma login, ImageMagick, a dev server, personal files, or the artifact directory.

## Inputs and resources

- OpenPencil: two HTML/CSS inputs (card and form/layout matrix), wrapped in standalone HTML documents. CSS variables in
  the upstream TypeScript template were resolved to their original color values. No layout rules were added.
- Natumsol: the original element/CSS and composite HTML documents, covering 23 and 12 targets. The original case
  manifests are retained for provenance; their AST expectations, warning codes, and pixel thresholds are not our oracle.
- Local regressions: a small icon with a translucent bordered/shadowed container and no background blur, plus small
  digits, letters, and symbols which must remain editable text even with an icon-like class name.
- Measured text: wrapped paragraphs, negative tracking, centered wrapping, bold text, and an absent font followed by a
  locally bundled web font. A separate integration check compares browser line rectangles with decoded FIG baselines.
- Transparent media: object-fit letterboxing, partial image alpha, and transparent CSS background images over a color.
  Decoded FIG checks require the background paint below the image paint.
- Snapshot geometry: a padded section with a single decorated child, and a button clipping oversized content.
  Decoded FIG checks retain section size, child offsets, and the button's clipping flag.
- Gradient direction: zero degrees and `to top` compared with full rotation and opposite-direction controls, plus
  zero-degree/full-rotation image masks. Decoded FIG checks require equivalent direction matrices.
- Italic text: regular, italic, bold italic leaf text and wrapped italic text using bundled static Roboto faces.
  Decoded FIG checks require the requested font style; independent Canvas checks verify the measured font advances.
- Decorated text: opaque and translucent rounded labels, plus a bordered label with a shadow. Decoded FIG checks
  require decoration on the outer frame and content insets on the inner text.
- Modern colors: OKLCH, Lab, Display P3, alpha, borders, text, and rounded labels, with RGB and transparent controls.
  Decoded solid paints are compared to independently captured Chromium screenshot pixels.

`case.json` fixes the viewport, explicitly enables/disables input scripts, maps resource URLs, and names test targets.
The loader substitutes only the listed font/image URLs with local data URLs, preserving the input's CSS and DOM.
Both extraction and the independent Chromium reference block HTTP(S); reference image decode failures or attempted
external requests fail setup. Inline scripts in trusted Natumsol inputs prepare Canvas and Shadow DOM.

Inter 3.019 Latin regular/bold fonts are vendored from `@fontsource/inter` 4.5.15; no installed system Inter is required.
The source font copyright and OFL are retained in [assets/INTER-LICENSE.txt](assets/INTER-LICENSE.txt). Other system font
fallbacks may differ by OS, so these are semantic checks with a freshly rendered reference, not portable pixel goldens.
See [SOURCES.json](SOURCES.json) for fixed upstream commits, paths, adaptations, and file checksums.
Roboto 2.137 static Latin faces come from `@fontsource/roboto` 4.5.8; font attribution and Apache-2.0 terms are retained
in [assets/ROBOTO-NOTICE.txt](assets/ROBOTO-NOTICE.txt) and [assets/ROBOTO-LICENSE.txt](assets/ROBOTO-LICENSE.txt).

## Checks and limitations

The test compares captured target geometry to Chromium, checks visible DOM text and input values in the decoded FIG,
requires pixel data for image targets, validates the FIG structure, and verifies that font-backed inputs emit glyphs.
Text collection does not exclude font ligature names based on font or class labels. SVG paths, screenshots of Canvas, and images are not
mistaken for text nodes. Geometry checks currently cover extraction; they do not assert all final FIG positions.

Canvas pixels, static video posters, absence of invented blur, and measured icon sizes are ordinary regression
assertions. Their earlier expected-failure markers have been removed after fixes; this corpus has no expected failures.
The short-text regression also checks that ordinary digits/letters/symbols never become icon nodes merely because of
their dimensions, font family, or an icon-like class name. No threshold is relaxed to pass these checks.

Canvas requires readable origin-clean pixels. Poster capture applies before decoded video frames are available; playing
video and video controls are not captured. The local icon regression intentionally has no external Material icon font
or downloaded SVG: it checks normalization semantics, not correct rendering of that unavailable glyph. Its pixel output
can still be wrong even when the no-blur/size assertions pass. Use real icon/font assets for visual acceptance.

Tests which construct Scene objects remain useful unit tests; they supplement this HTML corpus rather than replace it.

The independent reference also records text line rectangles, extending beyond overflow-visible host boxes and
intersecting axis-aligned ancestor overflow clips. `tests/helpers/score-text-regions.ts` computes supplemental
8×8 luma SSIM for those regions; keep this separate from historical layout scores. An empty set is N/A.
Unit tests ensure this score detects clipping that an unchanged host-box score misses. Reference-region tests
cover visible overflow and hidden ancestor clipping. This diagnostic does not model arbitrary CSS masks,
rotated clipping paths, occlusion, or glyph ink outlines, and is not native Figma acceptance.

The ligature regression uses the vendored Roboto face with real `ffi`, `fi`, and `fl` substitutions.
Controls explicitly disable ligatures and add tracking. Decoded Node and Browser FIG outputs must retain the
original text while using the font layout's glyph count only in the normal-ligature case.

The preserved-whitespace regression compares `pre`, `pre-wrap`, and `break-spaces` against normal whitespace.
It includes leading/trailing spaces, internal runs of spaces, indentation, and a blank line. Separate regression
assertions require exact text preservation through both public FIG APIs; ordinary collapsed text stays unchanged.

The tab-layout regression compares two tab sizes, explicit blank lines, and a soft-wrapped preformatted block.
A separate test independently measures Chromium character rectangles and compares non-whitespace glyph
positions in both decoded FIG outputs. Tab/newline characters remain in the text but must not emit glyphs.

The self-authored business-document fixture expands coverage to a complete invoice page: summary cards,
a collapsed-border table with a merged total cell, mixed font families and sizes, and a tabbed multiline log.
It uses only existing local font assets. Both public file APIs are checked without external resources.
This fixture is not a copy of a user's business page and its score must not be presented as such.

Synthetic-fonts uses one regular-only face under a neutral family alias plus a real italic control. Tests require
editable defaults, explicit pixel capture diagnostics, synthesis-disabled controls, and family-renaming invariance.
Table-conflicts covers transparent shared edges, competing widths/colors, hidden edges, and row/column spans;
public Node and Browser files must contain one alpha paint and no duplicate cell-border paint for supported grids.
