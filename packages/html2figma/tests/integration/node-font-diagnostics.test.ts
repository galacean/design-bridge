import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createFigmaFile } from '@galacean/html2figma';
import { makeSceneNode } from '../helpers/scene-factories';

it('returns Node font resolution warnings through the public FIG API', async () => {
  const text = makeSceneNode({
    type: 'text', text: 'Hello', name: 'Hello',
    fontSource: fileURLToPath(new URL('../fixtures/html/assets/inter-latin-400-normal.woff2', import.meta.url)),
    ir: {
      figmaType: 'TEXT', opacity: 1, isAbsolute: false, fills: [], effects: [], clipsContent: false, flexGrow: 0,
      textProps: {
        fontFamily: 'Declared Alias', fontSize: 16, fontWeight: 400, lineHeightPx: 20,
        letterSpacing: 0, color: { r: 0, g: 0, b: 0, a: 1 }, textAlign: 'LEFT',
      },
    },
  });
  const result = await createFigmaFile([{ name: 'Font diagnostics', sceneData: makeSceneNode({ children: [text] }) }]);

  expect(result.validation.valid).toBe(true);
  expect(result.validation.warnings).toContain('Font resolution: requested "Declared Alias", encoded "Inter".');
  expect(result.blobStats.byKind.glyph.references).toBeGreaterThan(0);
});
