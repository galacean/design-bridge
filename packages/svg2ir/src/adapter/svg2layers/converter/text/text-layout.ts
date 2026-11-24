import type { IRTextContent } from '@galacean/animation-ir';
import { buildCanvasFontDesc, estimateTextWidth, resolveFontMetrics } from '../../../../svg2ir/converter/text/font-metrics';
import { SVG2IR_WARNING_CODES, type ConvertOptions, type SVG2IRWarning } from '../../../../common/types';
import { collectLayerWarning, throwInvalidLayerData } from '../diagnostics/collect-warnings';
import type { SVGLayerBBox } from '../../types';
import type { TextRun } from './parse-text-runs';

export interface PositionedTextRun { run: TextRun; box: SVGLayerBBox }

export function buildTextRunLayout(
  runs: TextRun[],
  family: string,
  spacing: number,
  content: IRTextContent,
  size: [number, number],
  conversionOptions: ConvertOptions,
  warnings: SVG2IRWarning[],
  id: string,
  segmented = false,
  renderScale: readonly [number, number] = [1, 1],
): PositionedTextRun[] {
  const rows: TextRun[][] = [[]];

  for (const run of runs) {
    run.text.split('\n').forEach((text, index) => {
      if (index > 0) { rows.push([]); }
      if (text !== '') { rows[rows.length - 1].push({ ...run, text }); }
    });
  }
  let estimated = false;
  const configuredLineHeight = content.lineHeight;
  const measuredRows = rows.filter(row => !segmented || row.length > 0).map(row => {
    const parts = row.map(run => {
      // 基线沿用参考字号指标，字宽按实际输出字号单独测量。
      const measurementSize = segmented ? 10 : run.fontSize;
      const scale = run.fontSize / measurementSize;
      const weight = run.bold ? 'bold' : 'normal';
      const style = run.italic ? 'italic' : 'normal';
      const font = buildCanvasFontDesc(measurementSize, family, weight, style);
      const metrics = conversionOptions.measureText?.(font, segmented ? 'x' : run.text);
      const characters = Array.from(run.text);
      // 片段协议不输出额外字重和斜体，测宽使用同样的普通样式。
      const widthFontSize = run.fontSize * renderScale[1];
      const widthFont = buildCanvasFontDesc(widthFontSize, family, 'normal', 'normal');
      const measureWidth = (text: string): number => {
        const width = conversionOptions.measureText?.(widthFont, text).width;

        if (width != null && Number.isFinite(width) && width >= 0) { return width; }
        estimated = true;

        return estimateTextWidth(text, widthFontSize, 0, undefined, family, 'normal', 'normal');
      };
      // 字距和字宽交替累加，保持与 Artis 逐字测宽的计算顺序一致。
      let renderedWidth = 0;

      characters.forEach((character, index) => {
        if (index > 0) { renderedWidth += spacing * renderScale[0]; }
        renderedWidth += measureWidth(character);
      });
      const width = renderedWidth / renderScale[0];
      const fallback = resolveFontMetrics(undefined, family, weight, style, run.fontSize);
      const ascent = metrics?.fontBoundingBoxAscent == null
        ? fallback.asc : metrics.fontBoundingBoxAscent * scale;
      const descent = metrics?.fontBoundingBoxDescent == null
        ? fallback.desc : metrics.fontBoundingBoxDescent * scale;

      estimated ||= metrics?.fontBoundingBoxAscent == null || metrics.fontBoundingBoxDescent == null;
      if (!Number.isFinite(width) || width < 0 || !Number.isFinite(ascent) || !Number.isFinite(descent)) {
        throwInvalidLayerData('Text measurement returned invalid metrics.');
      }

      return { run, width, ascent, descent };
    });
    const width = parts.reduce((sum, part) => sum + part.width, 0);
    const ascent = Math.max(0, ...parts.map(part => part.ascent));
    const descent = Math.max(0, ...parts.map(part => part.descent));
    const height = segmented && configuredLineHeight > 0
      ? configuredLineHeight : Math.max(configuredLineHeight, ascent + descent);

    return { parts, width, ascent, descent, height };
  });
  const baselines: number[] = [];
  let offset = 0;

  for (const row of measuredRows) {
    baselines.push(offset);
    offset += row.height;
  }
  const contentTop = Math.min(0, ...measuredRows.map((row, index) =>
    baselines[index] - row.ascent - (row.height - row.ascent - row.descent) / 2,
  ));
  const firstBaseline = -size[1] / 2 - contentTop;
  const result: PositionedTextRun[] = [];
  const alignment = content.textAlign;

  measuredRows.forEach((row, index) => {
    let left = -size[0] / 2
      + (alignment === 'center' ? (size[0] - row.width) / 2 : alignment === 'right' ? size[0] - row.width : 0);
    const baseline = segmented ? firstBaseline + baselines[index]
      : -size[1] / 2 + baselines[index] + (row.height - row.ascent - row.descent) / 2 + row.ascent;

    for (const part of row.parts) {
      result.push({
        run: part.run,
        box: [left, baseline - part.ascent, left + part.width, baseline + part.descent],
      });
      left += part.width;
    }
  });
  if (estimated) {
    collectLayerWarning(warnings, conversionOptions, SVG2IR_WARNING_CODES.LAYERS_TEXT_BOUNDS_ESTIMATED,
      'Text fragment bounds use estimated metrics; supply measureText for precise layout.', id);
  }

  return result;
}
