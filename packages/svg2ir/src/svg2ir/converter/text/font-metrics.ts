/**
 * SVG 文本到 Effects 文本组件共用的字体、度量和宽度估算逻辑。
 *
 * 这些函数不读取 SVG DOM，只根据字体属性和可选的 measureText 回调计算文本布局数据。
 */
type IRFontWeight = 'normal' | 'bold' | 'lighter';

interface TextMeasureResult {
  width: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
  actualBoundingBoxAscent?: number;
  hangingBaseline?: number;
}

export type TextMeasure = (fontDesc: string, text: string) => TextMeasureResult;

/** Effects TextWeight 枚举值。生产 Effects 的 fontWeight 只接受 'normal' | 'bold' | 'lighter'。 */
type GETextWeight = 'normal' | 'bold' | 'lighter';

export function mapFontWeight (raw: string, fontFamily?: string): IRFontWeight {
  if (raw !== '') {
    const lowered = raw.toLowerCase();

    // 显式关键字统一收敛到 Effects 枚举(Effects 没有 'bolder',按规范视为 bold)。
    if (lowered === 'bold' || lowered === 'bolder') { return 'bold'; }
    if (lowered === 'normal') { return 'normal'; }
    if (lowered === 'lighter') { return 'lighter'; }

    const n = Number(raw);

    if (Number.isFinite(n)) { return numericToGEWeight(n); }
  }
  // font-weight 属性缺失时，从 font-family 名后缀推断字重；部分字体将字重编码在族名中。
  if (typeof fontFamily === 'string' && fontFamily !== '') {
    const inferred = inferNumericWeightFromFamily(fontFamily);

    if (inferred !== null) { return numericToGEWeight(inferred); }
  }

  return 'normal';
}

/** 数值字重 → Effects TextWeight 枚举归并:100-300 lighter,400 normal,500-950 bold。 */
function numericToGEWeight (n: number): GETextWeight {
  if (n < 400) { return 'lighter'; }
  if (n < 500) { return 'normal'; }

  return 'bold';
}

/** 从字体族名中推断数值字重(100-950)。
 *  优先级:关键词 > Linotype 数字代码 > 裸 100-900 数字 > AlibabaPuHuiTi 单字母后缀。 */
export function inferNumericWeightFromFamily (family: string): number | null {
  const f = normalizeFontFamily(family);

  if (f === '') { return null; }

  // 1. 关键词（更具体的字重名称优先匹配）。
  if (/(?:extra\s?black|ultra\s?black)/.test(f)) { return 950; }
  if (/(?:heavy|black)/.test(f)) { return 900; }
  if (/(?:extra\s?bold|ultra\s?bold|extrabold|ultrabold)/.test(f)) { return 800; }
  if (/(?:semi\s?bold|demi\s?bold|semibold|demibold)/.test(f)) { return 600; }
  if (f.includes('bold')) { return 700; }
  if (f.includes('medium')) { return 500; }
  if (/(?:extra\s?light|ultra\s?light|extralight|ultralight)/.test(f)) { return 200; }
  if (f.includes('light')) { return 300; }
  if (f.includes('thin')) { return 100; }
  if (/(?:regular|normal|book)/.test(f)) { return 400; }

  // 2. Linotype 风格数字代码(55/65/75/85/95/115)。
  const linotype = f.match(/\b(55|65|75|85|95|115)\b/);

  if (linotype != null) {
    const code = Number(linotype[1]);

    if (code === 55) { return 400; }
    if (code === 65) { return 500; }
    if (code === 75) { return 700; }
    if (code === 85) { return 800; }
    if (code === 95) { return 900; }
    if (code === 115) { return 950; }
  }

  // 3. 裸 100-900 数字。
  const bare = f.match(/\b([1-9]00)\b/);

  if (bare != null) { return Number(bare[1]); }

  // 4. AlibabaPuHuiTi 单字母后缀:H=Heavy(800) M=Medium(500) L=Light(300)。
  const suffix = f.match(/puhuiti([hml])$/);

  if (suffix != null) { return suffix[1] === 'h' ? 800 : suffix[1] === 'm' ? 500 : 300; }

  return null;
}

/** 规范化 font-family 字符串:去引号、取首项、转小写、去首尾空白。 */
function normalizeFontFamily (family: string): string {
  return family.replace(/['"]/g, '').toLowerCase().split(',')[0].trim();
}

/** 估算字体 asc/desc 比例。CJK 字体通常 asc 更高、desc 更低，latin 默认 0.8/0.2。 */
function estimateFontMetrics (fontFamily: string): { ascRatio: number; descRatio: number } {
  const f = fontFamily.toLowerCase();
  const isCJK = /puhuiti|alimama|hei|song|kai|ming|gothic|yu|alibaba|cjk|sc|tc\b|jp\b|kr\b/.test(f);

  return isCJK ? { ascRatio: 0.88, descRatio: 0.12 } : { ascRatio: 0.8, descRatio: 0.2 };
}

/** 解析 Effects RichText strategies 所需的字体 asc/desc 与 x-height。
 * 有 measureText 回调时使用当前字体指标；没有回调时使用字族比例估算。
 * SVG 的 precise baseline 指标按实际字号读取，Effects layout metric 按字号比例缩放。 */
export function resolveFontMetrics (
  measureText: TextMeasure | undefined,
  fontFamily: string,
  fontWeight: IRFontWeight,
  fontStyle: string,
  fontSize: number,
): { asc: number; desc: number; xHeight: number; hanging?: number; svgAsc?: number; svgDesc?: number } {
  if (measureText != null && fontFamily !== '') {
    const fd = buildCanvasFontDesc(10, fontFamily, fontWeight, fontStyle);
    const m = measureText(fd, 'x');
    const scale = fontSize / 10;
    const asc = (m.fontBoundingBoxAscent ?? 0) * scale;
    const desc = (m.fontBoundingBoxDescent ?? 0) * scale;
    const xHeight = (m.actualBoundingBoxAscent ?? 0) * scale;

    if (asc > 0 || desc > 0) {
      // Effects RichText layout 固定以 10px 的 fontBoundingBoxAscent/Descent 做字号缩放。
      // SVG 的 dominant-baseline 则由实际字号的字体 metric 决定;Chrome 的小字号 metric
      // 存在像素量化,例如 sans-serif hangingBaseline:10px=8.8、200px=169.6,
      // 不能用 8.8*20=176 代替 SVG 的 200px 基线。
      const actual = fontSize === 10
        ? m
        : measureText(buildCanvasFontDesc(fontSize, fontFamily, fontWeight, fontStyle), 'x');

      return {
        asc, desc, xHeight,
        svgAsc: actual.fontBoundingBoxAscent ?? asc,
        svgDesc: actual.fontBoundingBoxDescent ?? desc,
        hanging: actual.hangingBaseline ?? (m.hangingBaseline != null ? m.hangingBaseline * scale : undefined),
      };
    }
  }
  const { ascRatio, descRatio } = estimateFontMetrics(fontFamily);

  return { asc: ascRatio * fontSize, desc: descRatio * fontSize, xHeight: 0.5 * fontSize };
}

/** 将 SVG dominant-baseline 转换为 Effects alphabetic baseline 的 y 偏移。
 * Effects 没有独立的 dominant-baseline 字段，因此复用字体 asc/desc、x-height 和可用的 hangingBaseline。 */
export function dominantBaselineDelta (
  baseline: string | undefined,
  asc: number, desc: number, xHeight: number,
  precise?: { hanging?: number; svgAsc?: number; svgDesc?: number },
): number {
  const b = (baseline ?? '').toLowerCase();

  // 未读/缺省/alphabetic = 无偏移
  if (b === '' || b === 'alphabetic' || b === 'auto') { return 0; }
  const svgAsc = precise?.svgAsc ?? asc;
  const svgDesc = precise?.svgDesc ?? desc;

  if (b === 'central') { return (svgAsc - svgDesc) / 2; }
  if (b === 'middle') { return (xHeight > 0 ? xHeight : (asc - desc) / 2) / 2; }  // x-height 中点(无 xHeight 退 central 近似)
  // hanging 优先使用字体提供的 hangingBaseline，其余值使用对应的 asc/desc 指标。
  if (b === 'hanging') { return precise?.hanging ?? asc; }
  if (b === 'text-before-edge') { return svgAsc; }
  if (b === 'text-after-edge') { return -svgDesc; }
  if (b === 'ideographic') { return -svgDesc; }

  return 0; // 未知值(spec 还有 mathematical/cjk 等)→ 不偏,降级 alphabetic
}

/** 多档空格字符（advance 不同），用于近似表达无法直接映射的 dx。不同字体的 advance
 *  U+0020 最稳,Unicode 空格在某些字体可能 fallback 成同 advance 或缺失 → 只取 advance>0 且与其它档不同的。 */
const SPACE_CHAR_CANDIDATES = [
  ' ', // regular space
  ' ', // thin space
  ' ', // hair space
  ' ', // punctuation space
  ' ', // narrow no-break space
  ' ', // figure space
];

/** 读取各空格字符在目标字体下的 advance，返回去重后的候选表。 */
export function buildSpaceCharTable (
  measureText: TextMeasure,
  fd: string,
): Array<{ ch: string; w: number }> {
  const seen = new Map<number, string>();

  for (const ch of SPACE_CHAR_CANDIDATES) {
    const w = measureText(fd, ch).width;

    if (w > 0 && !seen.has(Math.round(w * 100))) { seen.set(Math.round(w * 100), ch); }
  }

  return Array.from(seen.entries()).map(([k, ch]) => ({ ch, w: k / 100 })).sort((a, b) => b.w - a.w);
}

/** 选择 advance 最接近目标值的单个空格字符。 */
export function greedySpaceForDx (target: number, table: Array<{ ch: string; w: number }>): string {
  if (table.length === 0) { return ' '; }
  let best = table[0];
  let bestErr = Math.abs(best.w - target);

  for (const { ch, w } of table) {
    const err = Math.abs(w - target);

    if (err < bestErr) { best = { ch, w }; bestErr = err; }
  }

  return best.ch;
}

/** 判断字符是否 CJK(中日韩统一表意文字/假名/谚文),按 Unicode 区段近似的快速判断。 */
function isCJKChar (ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;

  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0x3100 && cp <= 0x312f) || // Bopomofo
    (cp >= 0xff00 && cp <= 0xffef)    // Halfwidth/Fullwidth Forms
  );
}

/** 估算单字符在 sans-serif 下占的 em 系数。 */
function charWidthCoef (ch: string): number {
  if (ch === ' ') { return 0.333; }
  if (isCJKChar(ch)) { return 1.0; }

  // latin / digit / 标点:典型比例字体 sans-serif 大写字母约 0.65em,数字稍窄。
  return /[0-9]/.test(ch) ? 0.55 : 0.62;
}

/** 去除单个字体族名的 CSS 字符串引号。 */
export function normalizeFontFamilyName(fontFamily: string): string {
  return fontFamily.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** 构造与 Effects Runtime getFontDesc 一致的 CSS font 简写字符串,用于 Canvas measureText。 */
export function buildCanvasFontDesc (fontSize: number, fontFamily: string, fontWeight: IRFontWeight, fontStyle: string): string {
  const weightStr = String(fontWeight);
  const genericFamilies = ['serif', 'sans-serif', 'monospace', 'courier'];
  const family = normalizeFontFamilyName(fontFamily);
  const familyName = genericFamilies.includes(family) ? family : `"${family}"`;
  let desc = `${fontSize}px ${familyName}`;

  if (weightStr !== 'normal' && weightStr !== '') {
    desc = `${weightStr} ${desc}`;
  }
  if (fontStyle !== 'normal' && fontStyle !== '') {
    desc = `${fontStyle} ${desc}`;
  }

  return desc;
}

/** 文本宽度估算。优先使用调用方提供的 Canvas measureText，否则使用字符级启发式系数。 */
export function estimateTextWidth (
  content: string,
  fontSize: number,
  letterSpacing: number,
  measureText: ((fontDesc: string, text: string) => { width: number }) | undefined,
  fontFamily: string,
  fontWeight: IRFontWeight,
  fontStyle: string,
): number {
  const chars = Array.from(content);
  const len = chars.length;

  if (measureText != null && fontFamily !== '') {
    const fontDesc = buildCanvasFontDesc(fontSize, fontFamily, fontWeight, fontStyle);
    const { width } = measureText(fontDesc, content);

    return width + letterSpacing * Math.max(len - 1, 0);
  }

  const width = chars.reduce((s, ch) => s + charWidthCoef(ch) * fontSize, 0);

  return width + letterSpacing * Math.max(len - 1, 0);
}
