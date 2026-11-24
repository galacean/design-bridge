import { describe, expect, it } from 'vitest';
import type { IRFontAsset } from '@galacean/animation-ir';
import { parseTextRuns } from '../../../../../src/adapter/svg2layers/converter/text/parse-text-runs';
import type { SVGPreservedTextData } from '../../../../../src/svg-preserved-data';
import { buildTextLayer } from '../build-layer-fixtures';

const font: IRFontAsset = {
  id: 'font', type: 'font', family: 'Arial', weight: 400, style: 'normal', source: { kind: 'system' },
};
const base: SVGPreservedTextData = { fontFamily: 'Arial', fontWeight: 400, fontStyle: 'normal', isPathText: false, spans: [] };
const layer = buildTextLayer();

layer.content.fontSize = 20;

describe('SVG preserved text runs', () => {
  it('reads span styles, literal characters and line breaks without markup conversion', () => {
    const runs = parseTextRuns(layer, font, { ...base, spans: [
      { text: 'A<=/\\', fontSize: '30', color: '#ff0000', newLine: false },
      { text: 'B', color: '#ff0000', newLine: false }, { text: 'C', newLine: true },
    ] });

    expect(runs.map(run => [run.text, run.fontSize, run.color])).toEqual([
      ['A<=/\\', 30, '#FF0000'], ['B', 20, '#FF0000'], ['\nC', 20, '#000000'],
    ]);
  });

  it.each([{ fontSize: 'NaN' }, { fontSize: '0' }, { color: 'none' }])(
    'rejects invalid fragment styles %s', style => {
      expect(() => parseTextRuns(layer, font, { ...base, spans: [{ text: 'Hi', newLine: false, ...style }] }))
        .toThrow();
    },
  );

  it('merges adjacent equal styles without mutating preservation data', () => {
    const preserved: SVGPreservedTextData = { ...base, spans: [
      { text: 'A', color: 'red', newLine: false }, { text: 'B', color: 'red', newLine: false },
    ] };
    const before = structuredClone(preserved);

    expect(parseTextRuns(layer, font, preserved).map(run => run.text)).toEqual(['AB']);
    expect(preserved).toEqual(before);
  });

  it('merges explicit default colors with implicit default styles', () => {
    const runs = parseTextRuns(layer, font, { ...base, spans: [
      { text: 'A', color: '#000000ff', newLine: false }, { text: 'B', newLine: false },
    ] });

    expect(runs.map(run => run.text)).toEqual(['AB']);
  });

  it('does not interpret plain IR text as rich markup', () => {
    const plain = { ...layer, content: { ...layer.content, text: '<unknown>' } };

    expect(parseTextRuns(plain, font)[0].text).toBe('<unknown>');
  });
});
