# Try it in the local workbench

This site offers documentation and static code examples. To run conversions live, tweak parameters, and see
rendered results, use the `web-packages` workbench in the source repository. It is a local Vite + React debugging
app and is not published to npm.

## Start

Node.js 24+ and pnpm 10+ are required.

```bash
git clone https://github.com/galacean/design-bridge.git
cd design-bridge
pnpm install
pnpm dev
```

Open `http://localhost:8080`. The workbench has no production build; it runs only through the dev server.

For the Node/Playwright HTML extraction path, install Chromium once:

```bash
pnpm --filter @galacean/html2figma exec playwright install chromium
```

## Pick a page by goal

| I want to… | Open | Notes |
| --- | --- | --- |
| Convert Lottie to GE, preview, export video | `/lottie2ge` | Best first stop |
| Edit DSL and preview GE | `/dsl2ge` | Live preview and JSON export |
| Debug a GLSL shader | `/shader2ge` | Edit, tune, GE preview |
| Turn a web page into Figma data | `/html2figma` | ZIP / HTML → Figma Scene, clipboard, and `.fig` |
| Import a `.fig` file | `/figma2ge` | Decode, convert, preview |
| Edit GE as DSL or IR | `/ge2dsl-bundle`, `/ir-editing` | Split, edit, reassemble faithfully |
| Check round-trip fidelity | `/ge2ir`, `/ge2dsl` | GE round-trip comparison |
| Compare rendering differences | `/frame-test` | Lottie vs GE frame by frame |
| Compare SVG rendering | `/svg-frame-test` | SVG vs GE; preview and export |
| Batch regression | `/auto-frame-test`, `/ge-auto-frame-test`, `/svg-auto-frame-test` | Lottie, GE, or SVG |
| Validate DSL | `/dsl-validator` | Format and semantic checks |

## Suggested learning order

1. `/lottie2ge`: load a Lottie, inspect the result and diagnostics, and compare with
   [Importing Lottie and SVG](../import-animation/).
2. `/ir-editing` or `/ge2dsl-bundle`: split GE into editable data and reassemble it to understand
   [Fidelity editing](../fidelity-editing/).
3. `/frame-test`: compare source and GE output for one asset to learn to judge approximations and drops.
4. `/shader2ge`, `/html2figma`, `/figma2ge`: explore the remaining paths as needed.

## Local inputs and outputs

Paths in this section are relative to `web-packages/`. GE, DSL, and Lottie selectors read HTTP(S) JSON URLs from
manifests; they do not scan local input directories:

| Path | Purpose |
| --- | --- |
| `tests/fixtures/lottie/urls.txt` | Lottie conversion, frame comparison, and batch regression |
| `tests/fixtures/ge/urls.txt` | GE round trips and DSL / IR editing |
| `tests/fixtures/dsl/urls.txt` | DSL → GE and format validation |
| `tmp/dsl-input` | GE → DSL batch output; not added to the DSL selector |
| `tmp/output` | Saved scenes and images from conversions |
| `tmp/html-input` | Temporary HTML/ZIP uploads, cleaned by the API |

Put one URL per line; blank lines and duplicates are ignored. Empty manifests select no inputs, while missing
manifests and invalid URLs report errors. Browser reads require CORS; use the file picker for supported one-off imports.
SVG comparison uses local cases under `tmp/svg_input` and `tmp/svg_dynamic_tests/`. Local `tmp/` output is git-ignored.

The installation above supplies Chromium for Node HTML extraction. The frame-regression CLI uses a local Chrome,
Chromium, or Edge executable; set `CHROME_EXECUTABLE` if automatic discovery fails. Keep the workbench and its local
file APIs on your development machine.

## Debug your own conversion

- After editing `packages/*/src`, the dev server uses workspace sources, so no build is needed first.
- Reproduce the problem in a page, then save the smallest input as a test fixture of the owning package.
- Run one package's tests: `pnpm --filter @galacean/lottie2ir test`.
- Page details, batch APIs, and directory conventions are in the
  [web-packages README](https://github.com/galacean/design-bridge/blob/main/web-packages/README.md).

When you see differences, read [Runtimes and limitations](../runtime-and-limits/) first, then check the contract in
the [API reference](../../api/).
