import { expect, it } from 'vitest';
import { extractSceneDocument } from '@galacean/html2figma';
import { flattenScene } from '../helpers/html-fixture';

it.each([
  ['solid', 'solid', true],
  ['double', 'solid', false],
  ['hidden', 'solid', null],
] as const)('resolves row %s against cell %s using CSS precedence', async (rowStyle, cellStyle, cellWins) => {
  const document = await extractSceneDocument('<style>table{border-collapse:collapse}' +
    `tr{border-top:3px ${rowStyle} red}td{width:40px;height:24px;border-top:3px ${cellStyle} blue}` +
    '</style><table><tr><td></td></tr></table>', true, {
    networkPolicy: 'offline', scriptPolicy: 'disabled',
  });
  const paints = flattenScene(document.root).filter(node => node.name === 'Collapsed border paint');

  if (cellWins === null) {
    expect(paints).toHaveLength(0);
  } else {
    expect(paints).toHaveLength(1);
    expect(paints[0].ir.fills).toEqual([{ type: 'SOLID', color: cellWins
      ? { r: 0, g: 0, b: 1, a: 1 } : { r: 1, g: 0, b: 0, a: 1 } }]);
    expect(paints[0].svgContent?.match(/M/g)).toHaveLength(rowStyle === 'double' ? 2 : 1);
  }
});
