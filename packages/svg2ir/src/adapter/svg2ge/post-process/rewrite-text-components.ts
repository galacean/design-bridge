/**
 * 将 Effects TextComponent 转换为 RichTextComponent，并将逐段样式编码为 markup。
 * 文本尺寸字段和 textPath 标记保留在 Effects 场景中。
 */
import { DataType, type JSONScene } from '@galacean/effects-specification';
import type { IRColor } from '@galacean/animation-ir';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../svg-preserved-data';

interface RewriteTextComponentsToRichTextInput {
  textDataByLayerId: ReadonlyMap<string, SVGPreservedTextData>;
  itemLayerIds: Readonly<Record<string, string>>;
}

/** IRColor[0-1] → #RRGGBBAA(markup <color> 参数,Effects toRGBA 吃 #hex)。 */
function irColorToHex (c: IRColor): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');

  return `#${h(c[0])}${h(c[1])}${h(c[2])}${h(c[3])}`;
}

/** 按 IR Layer ID 应用 SVG 富文本保留数据。 */
export function rewriteTextComponentsToRichText (scene: JSONScene, input: RewriteTextComponentsToRichTextInput): void {
  for (const component of scene.components) {
    const c = isRecord(component) ? component : undefined;

    if (c?.['dataType'] !== DataType.TextComponent) { continue; }

    const itemRef = isRecord(c['item']) ? c['item'] : undefined;
    const itemId = typeof itemRef?.['id'] === 'string' ? itemRef['id'] : undefined;
    const layerId = itemId != null ? input.itemLayerIds[itemId] : undefined;
    const info = layerId != null ? input.textDataByLayerId.get(layerId) : undefined;

    if (info == null) { continue; }
    rewriteTextComponentToRichText(c, info);
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** 将普通 TextComponent 转为 RichTextComponent。 */
function rewriteTextComponentToRichText (comp: Record<string, unknown>, info: SVGPreservedTextData): void {
  comp['dataType'] = 'RichTextComponent';
  const old = isRecord(comp['options']) ? comp['options'] : undefined;

  if (old == null) { return; }

  // 保留 IR 计算得到的文本样式和尺寸。
  const irColor = readIRColor(old['textColor']);
  const irWidth = typeof old['textWidth'] === 'number' ? old['textWidth'] : undefined;
  const irHeight = typeof old['textHeight'] === 'number' ? old['textHeight'] : undefined;

  const newOptions: Record<string, unknown> = {
    text: encodeMarkupFromSpans(info.spans, String(old['text'] ?? ''), irColor),
    fontSize: old['fontSize'],
    fontFamily: old['fontFamily'] ?? 'sans-serif',
    textColor: irColor ?? [0, 0, 0, 1],
    fontWeight: old['fontWeight'],
    fontStyle: old['fontStyle'],
    textAlign: old['textAlign'] ?? 0,
    lineHeight: old['lineHeight'] ?? old['fontSize'],
    letterSpace: old['letterSpace'] ?? 0,              // spec 字段名 letterSpace
    autoResize: 0,
    useLegacyRichText: false,
    wrapEnabled: false,
    textOverflow: 0,
    textVerticalAlign: 0,
    // 这些字段用于恢复文本尺寸。
    size: old['size'] ?? [1,1],
    textWidth: irWidth ?? old['textWidth'] ?? 1,
    textHeight: irHeight ?? old['textHeight'] ?? 1,
  };

  if (info.isPathText) {
    newOptions['isPathText'] = true;
  }

  comp['options'] = newOptions;
  // RichText 使用 autoResize。
}

function readIRColor (value: unknown): IRColor | undefined {
  if (!Array.isArray(value) || value.length < 4 || !value.slice(0, 4).every(isFiniteNumber)) {
    return undefined;
  }

  return [value[0], value[1], value[2], value[3]];
}

function isFiniteNumber (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 将逐段文本样式编码为 RichText markup。
 *  样式差异使用 size、color、b、i 标签，换行使用 `\n`；必要时显式写入文本颜色。
 */
function encodeMarkupFromSpans (spans: readonly SVGPreservedTextSpan[], fallbackText: string, defaultColor?: IRColor): string {
  if (spans.length === 0) { return fallbackText; }
  const defaultColorHex = defaultColor ? irColorToHex(defaultColor) : undefined;
  const hasStyleDiff = spans.some(s => s.fontSize !== undefined || s.color !== undefined || s.bold === true || s.italic === true) || defaultColorHex !== undefined;
  const esc = (s: string) => s
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\//g, '\\/');

  // 相邻且样式相同的 span 合并为一个 markup 段，使 letterSpace 覆盖整个字形 run。
  // 样式不同或换行时保留段边界；dy、旋转等不属于 markup 能表达的属性。
  const effColor = (s: SVGPreservedTextSpan): string | undefined => s.color ?? defaultColorHex;
  const effStyleKey = (s: SVGPreservedTextSpan): string => `${s.fontSize ?? ''}|${effColor(s) ?? ''}|${s.bold === true ? 1 : 0}|${s.italic === true ? 1 : 0}`;
  const mergedSpans: SVGPreservedTextSpan[] = [];

  for (const s of spans) {
    const last = mergedSpans.length > 0 ? mergedSpans[mergedSpans.length - 1] : null;

    if (last != null && !s.newLine && effStyleKey(last) === effStyleKey(s)) {
      last.text += s.text;   // 同效样式合并文本 → Effects 单段 ls 贯穿
    } else {
      mergedSpans.push({ ...s });
    }
  }

  const parts: string[] = [];

  for (const s of mergedSpans) {
    if (!hasStyleDiff) {
      // 无样式差异时直接拼接文本，并保留换行。
      if (s.newLine) { parts.push('\n'); }
      parts.push(s.text);
      continue;
    }
    // 将换行写入当前 markup 段。
    const text = (s.newLine ? '\n' : '') + s.text;
    let out = esc(text);

    if (s.fontSize != null && s.fontSize !== '') { out = `<size=${parseInt(s.fontSize, 10)}>${out}</size>`; }
    // 优先使用逐段颜色，缺省时使用 text 级颜色。
    const colorHex = s.color ?? defaultColorHex;

    if (colorHex != null && colorHex !== '') { out = `<color=${colorHex}>${out}</color>`; }
    if (s.bold === true) { out = `<b>${out}</b>`; }       // per-span 粗体(整段字重由 options.fontWeight 承载,这里只标与 normal 不同的粗体段)
    if (s.italic === true) { out = `<i>${out}</i>`; }     // per-span 斜体
    parts.push(out);
  }

  return parts.join('');
}
