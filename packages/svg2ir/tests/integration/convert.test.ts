import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG_CONVERTER_ERROR_CODES, type SVGConverterError } from '../../src/common/errors';
import { convertSVGToIR as convertNodeSVGToIR } from '../../src/node';

describe('SVG to GE', () => {
  it('空 SVG 串跑通 SVG → IR 链路', async () => {
    const result = convertSVGToIR('<svg width="100" height="100"></svg>');

    expect(result.ir).toBeDefined();
    expect(result.ir.compositions[0].width).toBe(100);
    expect(result.ir.compositions[0].height).toBe(100);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('根入口与 Node 入口返回一致的 IRScene 契约', async () => {
    const svg = '<svg width="120" height="80"><rect width="40" height="20" fill="#1677ff"/></svg>';
    const browserEntryResult = convertSVGToIR(svg);
    const nodeEntryResult = convertNodeSVGToIR(svg);
    const summarize = (result: typeof browserEntryResult) => ({
      format: result.ir.format,
      schemaVersion: result.ir.schemaVersion,
      entryCompositionId: result.ir.entryCompositionId,
      composition: result.ir.compositions[0],
      assets: result.ir.assets,
    });

    expect(summarize(browserEntryResult)).toEqual(summarize(nodeEntryResult));
  });

  it('文本 IR 保留文本内容与动画关键帧', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <text id="title" x="20" y="40" font-size="24" fill="#ff0000">Title
          <animate attributeName="opacity" values="0;1" dur="1s" fill="freeze"/>
        </text>
      </svg>
    `, { frameRate: 30, durationSeconds: 1 });
    const textLayer = result.ir.compositions[0].layers.find(layer => layer.name === 'title');

    expect(textLayer).toMatchObject({ type: 'text', content: { text: 'Title', fontSize: 24 } });
    const opacityAnimation = textLayer?.transform?.opacity?.type === 'keyframed' === true
      ? textLayer.transform.opacity.keyframes
      : [];

    expect(opacityAnimation[0]).toMatchObject({ frame: 0, value: 0 });
    expect(opacityAnimation.at(-1)).toMatchObject({ frame: 30, value: 1 });
  });

  it('backgroundColor 写入 IR composition', async () => {
    const result = convertSVGToIR('<svg width="100" height="80"></svg>', {
      backgroundColor: 'rgba(255, 0, 0, 0.5)',
    });

    expect(result.ir.compositions[0].backgroundColor).toEqual([1, 0, 0, 0.5]);
  });

  it('onWarning 同时返回 warning 并调用外部回调', async () => {
    const callbackWarnings: string[] = [];
    const result = convertSVGToIR('<svg width="100" height="100"><foreignObject /></svg>', {
      onWarning: warning => callbackWarnings.push(warning.code),
    });

    expect(result.warnings.some(warning => warning.code === 'svg2ir_element_dropped')).toBe(true);
    expect(callbackWarnings).toEqual(result.warnings.map(warning => warning.code));
  });

  it('空串 SVG 抛 INVALID_SVG', () => {
    expect(() => convertSVGToIR('   ')).toThrowError(expect.objectContaining({
      name: 'SVGConverterError',
      code: SVG_CONVERTER_ERROR_CODES.INVALID_SVG,
    } satisfies Partial<SVGConverterError>));
  });

  it.each(['not svg', '<div />'])('非 SVG 文档抛 INVALID_SVG: %s', source => {
    expect(() => convertSVGToIR(source)).toThrowError(expect.objectContaining({
      name: 'SVGConverterError',
      code: SVG_CONVERTER_ERROR_CODES.INVALID_SVG,
    }));
  });
});
