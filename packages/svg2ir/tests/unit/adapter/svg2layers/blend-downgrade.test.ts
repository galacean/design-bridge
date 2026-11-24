import { describe, expect, it } from 'vitest';
import { IRBlendMode } from '@galacean/animation-ir';
import { assembleSVGStaticLayers } from '../../../../src/adapter/svg2layers/assemble';
import type { SVG2IRWarning } from '@galacean/svg2ir';
import { convertSVGToLayers, splitSVG } from '@galacean/svg2ir';

const imageURL = 'data:image/png;base64,iVBORw0KGgo=';
const wrap = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${body}</svg>`;
const native = `<image id="photo" href="${imageURL}" width="80" height="60"/>`;

const blendWarnings = (warnings: Array<{ code: string }>) => warnings.filter(warning =>
  warning.code === 'svg2ge_layers_blend_mode_downgraded');

describe('layers blend mode downgrade', () => {
  it.each(['multiply', 'screen', 'overlay'])(
    'retains a native image and reports %s as downgraded to normal', async mode => {
      const source = wrap(native.replace('/>', ` style="mix-blend-mode:${mode}"/>`));
      const result = await convertSVGToLayers(source, {});
      const normal = await convertSVGToLayers(wrap(native), {});

      expect(result.data).toEqual(normal.data);
      expect(blendWarnings(result.warnings)).toHaveLength(1);
      expect(blendWarnings(result.warnings)[0]).toMatchObject({
        elementSelector: 'image#photo', message: expect.stringContaining(mode),
      });
      await expect(convertSVGToLayers(source, { strict: true })).rejects.toThrow(/normal/);
    },
  );

  it('does not reject a mixed native group merely because it has a blend mode', async () => {
    const source = wrap(`<g style="mix-blend-mode:multiply">${native}<text x="20" y="70">Native</text></g>`);
    const result = await convertSVGToLayers(source, {});

    expect(result.data.map(layer => layer.type)).toEqual(['image', 'text']);
    expect(blendWarnings(result.warnings)).toHaveLength(1);
    expect(result.warnings.some(warning => warning.message.includes('contains native text or images'))).toBe(false);
  });

  it('handles stylesheet declarations while preserving comments and property values containing CSS-like text', async () => {
    const source = wrap('<style>/* mix-blend-mode: overlay; */ .photo { mix-blend-mode: screen !important;'
      + ' --note: "mix-blend-mode: multiply;"; }</style>' + native.replace('id="photo"', 'id="photo" class="photo"'));
    const result = await convertSVGToLayers(source, {});

    expect(result.data).toHaveLength(1);
    expect(blendWarnings(result.warnings)).toHaveLength(1);
    expect(blendWarnings(result.warnings)[0]).toMatchObject({ message: expect.stringContaining('screen') });
  });

  it('retains an IR native layer with a non-default blend mode', () => {
    const split = splitSVG(wrap(native));
    const layer = split.ir.compositions[0].layers[0];
    const warnings: SVG2IRWarning[] = [];

    layer.blendMode = IRBlendMode.Multiply;
    const result = assembleSVGStaticLayers(split.ir, {}, warnings, split.preservedData);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].type).toBe('image');
    expect(blendWarnings(warnings)).toHaveLength(1);
    expect(() => assembleSVGStaticLayers(split.ir, { strict: true }, [], split.preservedData)).toThrow(/normal/);
  });

  it('reports the downgrade once through onWarning and does not change splitSVG', async () => {
    const source = wrap(native.replace('/>', ' style="mix-blend-mode:multiply"/>'));
    const reported: string[] = [];
    const split = splitSVG(source);
    const result = await convertSVGToLayers(source, {
      onWarning: warning => reported.push(warning.code),
    }, split.preservedData);

    expect(reported).toEqual(result.warnings.map(warning => warning.code));
    expect(blendWarnings(split.warnings)).toEqual([]);
  });

  it.each(['normal', 'initial', 'inherit', 'unset', 'revert'])('does not warn for %s', async mode => {
    const result = await convertSVGToLayers(wrap(native.replace('/>', ` style="mix-blend-mode:${mode}"/>`)), {
      });

    expect(blendWarnings(result.warnings)).toEqual([]);
  });
});
