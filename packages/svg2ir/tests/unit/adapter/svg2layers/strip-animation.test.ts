import { describe, expect, it } from 'vitest';
import { convertSVGToLayers } from '@galacean/svg2ir';

const wrap = (content: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">${content}</svg>`;
const measureText = (_font: string, text: string) => ({
  width: text.length * 8, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3,
});

describe('layers animation stripping', () => {
  it('removes SMIL nodes and keeps the animated element in its authored state', async () => {
    const source = wrap('<text x="10" y="30" font-family="Arial" font-size="16">Animated'
      + '<animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></text>');
    const result = await convertSVGToLayers(source, { measureText });

    expect(result.data).toEqual([expect.objectContaining({ type: 'text', content: 'Animated' })]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'svg2ge_layers_animation_stripped' })]);
  });

  it('stays warning-free for static sources', async () => {
    const source = wrap('<text x="10" y="30" font-family="Arial" font-size="16">Static</text>');
    const result = await convertSVGToLayers(source, { measureText });

    expect(result.warnings).toEqual([]);
    expect(result.data).toEqual([expect.objectContaining({ type: 'text', content: 'Static' })]);
  });

  it('still fails strict mode when animation was stripped', async () => {
    const source = wrap('<circle r="10"><animate attributeName="r" values="8;12;8" dur="1s"/></circle>');

    await expect(convertSVGToLayers(source, { strict: true }))
      .rejects.toThrow(/animated element/);
  });
});
