import type { SceneNode, FigmaIR, FigmaIRAutoLayout, FigmaIRTextProps } from '../types';

type WalkResult = SceneNode | SceneNode[] | null;

/**
 * Extracts the current browser document after fonts are ready.
 *
 * @returns A measured scene tree in document coordinates, without rebasing its origin.
 */
export function extractSceneFromDocument(): Promise<SceneNode>;
/**
 * Extracts an existing DOM document attached to a window.
 *
 * @param sourceDocument - Rendered document whose layout and resources are ready for capture.
 * @param options - Opt-in synthetic webfont rasterization, disabled by default.
 * @returns A measured scene tree in document coordinates, without rebasing its origin.
 */
export function extractSceneFromDocument(
  sourceDocument: Document, options?: { rasterizeSyntheticText?: boolean },
): Promise<SceneNode>;
/**
 * Extracts the current browser document with optional synthetic webfont rasterization.
 *
 * @param options - Set `rasterizeSyntheticText` to capture supported synthetic styles as images.
 * @returns A measured scene tree in document coordinates, without rebasing its origin.
 */
export function extractSceneFromDocument(options: { rasterizeSyntheticText?: boolean }): Promise<SceneNode>;
export async function extractSceneFromDocument(
  source: Document | { rasterizeSyntheticText?: boolean } = globalThis.document,
  extractionOptions: { rasterizeSyntheticText?: boolean } = {},
): Promise<SceneNode> {
  const document = 'nodeType' in source ? source : globalThis.document;
  const options = 'nodeType' in source ? extractionOptions : source;
  const window = document.defaultView;

  if (window === null) {
    throw new Error('The source document is not attached to a window.');
  }

  await document.fonts.ready;
  const canvasSnapshots = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  const snapshotCanvas = (canvas: HTMLCanvasElement): void => {
    if (canvas.width === 0 || canvas.height === 0) {
      return;
    }
    const source = canvas.getContext('2d');

    if (source === null) {
      return;
    }
    const pixels = source.getImageData(0, 0, canvas.width, canvas.height);
    const snapshot = document.createElement('canvas');

    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const context = snapshot.getContext('2d', { willReadFrequently: true });

    if (context === null) {
      throw new Error('Canvas pixel snapshot is unavailable.');
    }
    context.putImageData(pixels, 0, 0);
    canvasSnapshots.set(canvas, snapshot);
  };

  // Freeze painted pixels before asynchronous media work and temporary DOM changes.
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    try {
      snapshotCanvas(canvas);
    } catch (error) {
      console.warn('Canvas pixels could not be snapshotted:', error instanceof Error ? error.message : String(error));
    }
  }
  const emojiTransforms = new WeakMap<HTMLCanvasElement, DOMMatrix>();

  const normalizeFontFamily = (fontFamily: string | undefined): string => {
    if (!fontFamily) {
      return '';
    }

    return fontFamily.trim().replace(/["']/g, '').replace(/_/g, ' ').toLowerCase();
  };

  const normalizeFontWeight = (fontWeight: string | undefined): string => {
    return (fontWeight || '400').trim().toLowerCase();
  };

  const normalizeFontStyle = (fontStyle: string | undefined): string => {
    return (fontStyle || 'normal').trim().toLowerCase();
  };

  const extractFontUrl = (src: string): string | null => {
    const match = src.match(/url\((['"]?)(.+?)\1\)/i);

    return match ? match[2] : null;
  };

  const parseUnicodeRange = (unicodeRange: string | undefined | null) => {
    if (!unicodeRange) {
      return null;
    }
    const ranges: Array<{ min: number; max: number }> = [];
    const parts = unicodeRange
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const match = part.match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i);

      if (!match) {
        continue;
      }
      const startRaw = match[1].toUpperCase();
      const endRaw = match[2] ? match[2].toUpperCase() : null;

      if (startRaw.includes('?')) {
        const min = parseInt(startRaw.replace(/\?/g, '0'), 16);
        const max = parseInt(startRaw.replace(/\?/g, 'F'), 16);

        if (Number.isFinite(min) && Number.isFinite(max)) {
          ranges.push({ min, max });
        }
        continue;
      }
      const min = parseInt(startRaw, 16);
      const max = endRaw ? parseInt(endRaw, 16) : min;

      if (Number.isFinite(min) && Number.isFinite(max)) {
        ranges.push({ min, max });
      }
    }

    return ranges.length > 0 ? ranges : null;
  };

  const parseFontWeightRange = (fontWeight: string | undefined | null) => {
    const raw = (fontWeight || '').trim().toLowerCase();

    if (!raw) {
      return null;
    }
    if (raw === 'normal') {
      return { min: 400, max: 400 };
    }
    if (raw === 'bold') {
      return { min: 700, max: 700 };
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    const numeric = parts.map(part => Number(part)).filter(v => Number.isFinite(v));

    if (numeric.length === 0) {
      return null;
    }
    if (numeric.length === 1) {
      return { min: numeric[0], max: numeric[0] };
    }

    const min = Math.min(numeric[0], numeric[1]);
    const max = Math.max(numeric[0], numeric[1]);

    return { min, max };
  };

  const fontSourceMap = new Map<
    string,
    Array<{
      src: string;
      unicodeRanges: Array<{ min: number; max: number }> | null;
      weightRange: { min: number; max: number } | null;
    }>
  >();
  const registerFontSource = (
    family: string,
    weight: string,
    style: string,
    src: string,
    unicodeRange?: string | null,
  ) => {
    const fontUrl = extractFontUrl(src);

    if (!fontUrl) {
      return;
    }
    const familyKey = normalizeFontFamily(family);

    if (!familyKey) {
      return;
    }
    const weightKey = normalizeFontWeight(weight);
    const styleKey = normalizeFontStyle(style);
    const parsedRanges = parseUnicodeRange(unicodeRange || undefined);
    const weightRange = parseFontWeightRange(weight);
    const keys = [
      `${familyKey}::${weightKey}::${styleKey}`,
      `${familyKey}::${weightKey}`,
      `${familyKey}::${styleKey}`,
      familyKey,
    ];

    for (const key of keys) {
      const entries = fontSourceMap.get(key) || [];

      if (!entries.some(entry => entry.src === fontUrl)) {
        entries.push({ src: fontUrl, unicodeRanges: parsedRanges, weightRange });
        fontSourceMap.set(key, entries);
      }
    }
  };

  const registerFontSourcesFromCssText = (cssText: string) => {
    if (!cssText) {
      return;
    }
    const faceBlocks = cssText.match(/@font-face\s*\{[\s\S]*?\}/gi) || [];

    for (const block of faceBlocks) {
      const familyMatch = block.match(/font-family\s*:\s*([^;]+);/i);
      const weightMatch = block.match(/font-weight\s*:\s*([^;]+);/i);
      const styleMatch = block.match(/font-style\s*:\s*([^;]+);/i);
      const srcMatch = block.match(/src\s*:\s*([^;]+);/i);
      const unicodeMatch = block.match(/unicode-range\s*:\s*([^;]+);/i);

      if (!familyMatch || !srcMatch) {
        continue;
      }
      registerFontSource(
        familyMatch[1],
        weightMatch ? weightMatch[1] : '400',
        styleMatch ? styleMatch[1] : 'normal',
        srcMatch[1],
        unicodeMatch ? unicodeMatch[1] : null,
      );
    }
  };

  const unicodeRangeCoversCodePoint = (ranges: Array<{ min: number; max: number }> | null, codePoint: number) => {
    if (!ranges || ranges.length === 0) {
      return true;
    }

    return ranges.some(range => codePoint >= range.min && codePoint <= range.max);
  };

  const rankFontSourcesForText = (
    candidates: Array<{
      src: string;
      unicodeRanges: Array<{ min: number; max: number }> | null;
      weightRange: { min: number; max: number } | null;
    }>,
    text: string | undefined,
    targetWeight: number | null,
  ): string[] => {
    if (candidates.length === 0) {
      return [];
    }
    if (!text) {
      return candidates.map(candidate => candidate.src);
    }

    const codePoints = Array.from(text)
      .map(ch => ch.codePointAt(0))
      .filter((cp): cp is number => typeof cp === 'number' && cp > 0x20);

    if (codePoints.length === 0) {
      return candidates.map(candidate => candidate.src);
    }

    const ranked = candidates.map((candidate, index) => {
      let covered = 0;

      for (const cp of codePoints) {
        if (unicodeRangeCoversCodePoint(candidate.unicodeRanges, cp)) {
          covered += 1;
        }
      }
      let weightDistance = Number.POSITIVE_INFINITY;

      if (Number.isFinite(targetWeight)) {
        const target = Number(targetWeight);
        const range = candidate.weightRange;

        if (range) {
          if (target >= range.min && target <= range.max) {
            weightDistance = 0;
          } else if (target < range.min) {
            weightDistance = range.min - target;
          } else {
            weightDistance = target - range.max;
          }
        }
      }

      return { src: candidate.src, covered, weightDistance, index };
    });
    const coveredCandidates = ranked.filter(candidate => candidate.covered > 0);

    return (coveredCandidates.length > 0 ? coveredCandidates : ranked).sort((left, right) =>
      right.covered - left.covered || left.weightDistance - right.weightDistance || left.index - right.index,
    ).map(candidate => candidate.src);
  };

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;

    try {
      rules = sheet.cssRules;
    } catch {
      const href = sheet.href;

      if (!href) {
        continue;
      }
      try {
        const cssText = await fetch(href).then(r => (r.ok ? r.text() : ''));

        registerFontSourcesFromCssText(cssText);
      } catch {
        // Ignore stylesheets that cannot be fetched due CORS/network restrictions.
      }
      continue;
    }

    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) {
        continue;
      }
      const fontFaceRule = rule as CSSFontFaceRule;

      registerFontSource(
        fontFaceRule.style.getPropertyValue('font-family'),
        fontFaceRule.style.getPropertyValue('font-weight'),
        fontFaceRule.style.getPropertyValue('font-style'),
        fontFaceRule.style.getPropertyValue('src'),
        fontFaceRule.style.getPropertyValue('unicode-range'),
      );
    }
  }

  const _measureCanvas = document.createElement('canvas').getContext('2d')!;
  const resolveFontSources = (
    fontFamily: string | undefined,
    fontWeight: string | undefined,
    fontStyle: string | undefined,
    fontSize: string,
    text?: string,
  ): string[] => {
    const families = fontFamily?.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [];
    const weightKey = normalizeFontWeight(fontWeight);
    const styleKey = normalizeFontStyle(fontStyle);
    const parsedTargetWeight = parseFontWeightRange(fontWeight);
    const targetWeight = parsedTargetWeight ? (parsedTargetWeight.min + parsedTargetWeight.max) / 2 : null;

    for (let index = 0; index < families.length; index++) {
      const familyKey = normalizeFontFamily(families[index]);
      const merged: Array<{
        src: string;
        unicodeRanges: Array<{ min: number; max: number }> | null;
        weightRange: { min: number; max: number } | null;
      }> = [];
      const keys = [
        `${familyKey}::${weightKey}::${styleKey}`, `${familyKey}::${weightKey}`, `${familyKey}::${styleKey}`, familyKey,
      ];

      for (const key of keys) {
        for (const entry of fontSourceMap.get(key) ?? []) {
          if (!merged.some(candidate => candidate.src === entry.src)) {
            merged.push(entry);
          }
        }
      }
      if (merged.length === 0) {
        continue;
      }
      if (index > 0) {
        if (text === undefined || text.trim() === '') {
          return [];
        }
        // A preceding installed system font must not be replaced by a later web font.
        // Only use the later family when its rendered text metrics match the full CSS stack.
        const prefix = `${fontStyle ?? 'normal'} ${fontWeight ?? '400'} ${fontSize} `;

        _measureCanvas.font = prefix + (fontFamily ?? '');
        const requested = _measureCanvas.measureText(text);

        _measureCanvas.font = prefix + families.slice(index).join(',');
        const candidate = _measureCanvas.measureText(text);

        if (requested.width !== candidate.width || requested.fontBoundingBoxAscent !== candidate.fontBoundingBoxAscent ||
            requested.fontBoundingBoxDescent !== candidate.fontBoundingBoxDescent) {
          continue;
        }
      }

      return rankFontSourcesForText(merged, text, targetWeight);
    }

    return [];
  };
  const resolveFontSource = (
    fontFamily: string | undefined,
    fontWeight: string | undefined,
    fontStyle: string | undefined,
    fontSize: string,
    text?: string,
  ): string | null => resolveFontSources(fontFamily, fontWeight, fontStyle, fontSize, text)[0] ?? null;

  // Canvas-based text measurement for Figma glyph data
  const needsSyntheticTextCapture = (element: Element, style: CSSStyleDeclaration, text: string): boolean => {
    if (options.rasterizeSyntheticText !== true || !['normal', 'italic'].includes(style.fontStyle) ||
        style.writingMode !== 'horizontal-tb' || style.direction !== 'ltr' ||
        style.textDecorationLine !== 'none' || !['normal', 'nowrap'].includes(style.whiteSpace) ||
        !['none', 'uppercase', 'lowercase'].includes(style.textTransform) ||
        style.fontVariantCaps !== 'normal' || style.fontFeatureSettings !== 'normal' ||
        !['normal', 'common-ligatures'].includes(style.fontVariantLigatures)) {
      return false;
    }
    let transformed: Element | null = element;

    while (transformed !== null) {
      if (window.getComputedStyle(transformed).transform !== 'none') {
        return false;
      }
      transformed = transformed.parentElement;
    }
    const families = style.fontFamily.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [];
    const loaded = Array.from(document.fonts).filter(face => face.status === 'loaded');
    const familyIdentity = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase();
    const family = families[0];

    if (family === undefined) {
      return false;
    }
    const familyFaces = loaded.filter(face => familyIdentity(face.family) === familyIdentity(family));
    const matchingStyle = familyFaces.filter(face => face.style === style.fontStyle);
    const normalStyle = familyFaces.filter(face => face.style === 'normal');
    const styledFaces = matchingStyle.length > 0 ? matchingStyle : normalStyle.length > 0 ? normalStyle : familyFaces;
    const requestedWeight = Number(style.fontWeight);
    const matchingWeight = styledFaces.filter(face => {
      const range = parseFontWeightRange(face.weight);

      return range !== null && requestedWeight >= range.min && requestedWeight <= range.max;
    });
    const faces = matchingWeight.length > 0 ? matchingWeight : styledFaces;
    const descriptors = new Set(faces.map(face => `${face.style}:${face.weight}`));

    // An exact weight can span font subsets, but its base style must be unambiguous.
    // Do not infer a missing first family from later fallback fonts.
    if (faces.length === 0 || new Set(faces.map(face => face.style)).size !== 1 ||
        (matchingWeight.length === 0 && descriptors.size !== 1)) {
      return false;
    }
    const face = faces[0];
    const weight = parseFontWeightRange(face.weight);
    const baseWeight = weight === null ? 400 : Math.max(weight.min, Math.min(weight.max, requestedWeight));
    const missingWeight = weight !== null && (requestedWeight < weight.min || requestedWeight > weight.max);
    const missingStyle = style.fontStyle !== face.style;

    if ((!missingWeight && !missingStyle) ||
        (missingWeight && style.getPropertyValue('font-synthesis-weight') === 'none') ||
        (missingStyle && style.getPropertyValue('font-synthesis-style') === 'none')) {
      return false;
    }
    _measureCanvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const requested = _measureCanvas.measureText(text);

    _measureCanvas.font = `${face.style} ${baseWeight} ${style.fontSize} ${style.fontFamily}`;
    const base = _measureCanvas.measureText(text);

    if (requested.actualBoundingBoxLeft !== base.actualBoundingBoxLeft ||
        requested.actualBoundingBoxRight !== base.actualBoundingBoxRight ||
        requested.actualBoundingBoxAscent !== base.actualBoundingBoxAscent ||
        requested.actualBoundingBoxDescent !== base.actualBoundingBoxDescent) {
      return true;
    }
    // Synthetic emboldening can change pixels without changing the reported ink bounds.
    const probe = document.createElement('canvas');
    const context = probe.getContext('2d', { willReadFrequently: true });

    if (context === null) {
      return false;
    }
    const ascent = Math.max(requested.fontBoundingBoxAscent, base.fontBoundingBoxAscent);
    const descent = Math.max(requested.fontBoundingBoxDescent, base.fontBoundingBoxDescent);
    const left = Math.max(0, requested.actualBoundingBoxLeft, base.actualBoundingBoxLeft);

    try {
      probe.width = Math.max(1, Math.ceil(left + Math.max(requested.width, base.width,
        requested.actualBoundingBoxRight, base.actualBoundingBoxRight)));
      probe.height = Math.max(1, Math.ceil(ascent + descent));
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.fillText(text, left, ascent);
      const requestedPixels = context.getImageData(0, 0, probe.width, probe.height).data;

      context.clearRect(0, 0, probe.width, probe.height);
      context.font = `${face.style} ${baseWeight} ${style.fontSize} ${style.fontFamily}`;
      context.fillText(text, left, ascent);
      const basePixels = context.getImageData(0, 0, probe.width, probe.height).data;

      return requestedPixels.some((value, index) => value !== basePixels[index]);
    } catch {
      // If the native probe exceeds the canvas implementation's limits, retain editable text.
      return false;
    }
  };
  const captureSyntheticText = (textNode: Node, style: CSSStyleDeclaration): SceneNode | null => {
    const raw = textNode.textContent ?? '';
    let ancestor = textNode.parentElement;

    while (ancestor !== null) {
      if (window.getComputedStyle(ancestor).transform !== 'none') {
        return null;
      }
      ancestor = ancestor.parentElement;
    }
    const range = document.createRange();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (context === null || raw.trim() === '') {
      return null;
    }
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    context.font = font;
    if ('letterSpacing' in context) {
      context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    }
    if ('wordSpacing' in context) {
      context.wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
    }
    const lines: Array<{ text: string; x: number; y: number }> = [];

    for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)) {
      range.setStart(textNode, index);
      range.setEnd(textNode, index + segment.length);
      const rect = range.getClientRects()[0];

      if (rect === undefined || rect.width === 0) {
        continue;
      }
      const line = lines.at(-1);

      if (line !== undefined && line.y === rect.y) {
        line.text += segment;
      } else {
        lines.push({ text: segment, x: rect.x, y: rect.y });
      }
    }
    if (lines.length === 0) {
      return null;
    }
    const measured = lines.map(line => {
      const text = style.textTransform === 'uppercase' ? line.text.toUpperCase()
        : style.textTransform === 'lowercase' ? line.text.toLowerCase() : line.text;
      const metrics = context.measureText(text);

      return { ...line, text, metrics, baseline: line.y + metrics.fontBoundingBoxAscent };
    });
    const scale = Math.max(2, window.devicePixelRatio);
    let inkLeft = Infinity, inkTop = Infinity, inkRight = -Infinity, inkBottom = -Infinity;

    for (const line of measured) {
      const { metrics } = line;

      inkLeft = Math.min(inkLeft, line.x - Math.max(0, metrics.actualBoundingBoxLeft));
      inkTop = Math.min(inkTop,
        line.baseline - Math.max(metrics.fontBoundingBoxAscent, metrics.actualBoundingBoxAscent));
      inkRight = Math.max(inkRight, line.x + Math.max(metrics.width, metrics.actualBoundingBoxRight));
      inkBottom = Math.max(inkBottom,
        line.baseline + Math.max(metrics.fontBoundingBoxDescent, metrics.actualBoundingBoxDescent));
    }
    const left = Math.max(-window.scrollX, Math.floor(inkLeft * scale) / scale);
    const top = Math.max(-window.scrollY, Math.floor(inkTop * scale) / scale);
    const right = Math.min(document.documentElement.scrollWidth - window.scrollX, Math.ceil(inkRight * scale) / scale);
    const bottom = Math.min(document.documentElement.scrollHeight - window.scrollY,
      Math.ceil(inkBottom * scale) / scale);
    const width = right - left, height = bottom - top;

    if (width <= 0 || height <= 0) {
      return null;
    }
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    context.scale(scale, scale);
    context.font = font;
    context.fillStyle = style.color;
    if ('letterSpacing' in context) {
      context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    }
    if ('wordSpacing' in context) {
      context.wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
    }
    for (const line of measured) {
      context.fillText(line.text, line.x - left, line.baseline - top);
    }

    const image = canvas.toDataURL('image/png');

    if (!image.startsWith('data:image/png;base64,')) {
      return null;
    }

    return {
      type: 'image', name: raw.trim().slice(0, 24), text: raw, image,
      x: left + window.scrollX, y: top + window.scrollY, width, height, styles: {},
      children: [],
      ir: {
        figmaType: 'FRAME', opacity: 1, fills: [], effects: [], clipsContent: false,
        isAbsolute: false, flexGrow: 0,
      },
    };
  };

  const measureTextMetrics = (text: string, cssFont: string) => {
    _measureCanvas.font = cssFont;
    const charWidths: number[] = [];
    let prefix = '';
    let prevWidth = 0;

    for (let i = 0; i < text.length; i++) {
      prefix += text[i];
      const prefixWidth = _measureCanvas.measureText(prefix).width;
      const advance = Math.max(0, prefixWidth - prevWidth);

      charWidths.push(advance);
      prevWidth = prefixWidth;
    }
    const m = _measureCanvas.measureText(text);
    const ascent = m.emHeightAscent || m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 0;
    const descent = m.emHeightDescent || m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || 0;

    return {
      charWidths,
      ascent,
      fontLineHeight: ascent + descent,
    };
  };

  const measureCharacterPositions = (
    textNode: Node, text: string, bounds: DOMRect, ascent: number,
  ): Array<{ x: number; y: number; advance: number }> | undefined => {
    const raw = textNode.textContent ?? '';
    const parent = textNode.parentElement;

    if (parent === null) {
      return undefined;
    }
    const preservesLines = ['pre', 'pre-wrap', 'break-spaces'].includes(window.getComputedStyle(parent).whiteSpace);

    if ((raw !== text && raw.trim() !== text) || (text.includes('\n') && !preservesLines) ||
        Array.from(text).length !== text.length || /\p{Mark}/u.test(text)) {
      return undefined;
    }
    let ancestor = textNode.parentElement;

    while (ancestor !== null) {
      const computed = window.getComputedStyle(ancestor);

      if (computed.direction !== 'ltr' || computed.writingMode !== 'horizontal-tb' || computed.transform !== 'none') {
        return undefined;
      }
      ancestor = ancestor.parentElement;
    }
    const start = raw.indexOf(text);
    const range = document.createRange();
    const positions: Array<{ x: number; y: number; advance: number }> = [];
    const checkedCharacters = new Set<string>();

    for (let index = 0; index < text.length; index++) {
      const character = text[index];

      if (!checkedCharacters.has(character)) {
        const metrics = _measureCanvas.measureText(character);
        const characterAscent = metrics.emHeightAscent || metrics.fontBoundingBoxAscent ||
          metrics.actualBoundingBoxAscent || 0;

        // Different fallback-font ascents cannot share this run's range-to-baseline mapping.
        if (characterAscent !== ascent) {
          return undefined;
        }
        checkedCharacters.add(character);
      }
      range.setStart(textNode, start + index);
      range.setEnd(textNode, start + index + 1);
      const rectangles = range.getClientRects();

      // A collapsed wrap-space can expose both the previous line's end and the next line's start.
      if (rectangles.length === 0 || (rectangles.length !== 1 && ![' ', '\n', '\t'].includes(character))) {
        return undefined;
      }
      const rect = rectangles[0];

      if (rect.height <= 0 || !Number.isFinite(rect.width) || rect.width < 0) {
        return undefined;
      }
      const previous = positions.at(-1);

      if (previous !== undefined && rect.y - bounds.y + ascent === previous.y && rect.x - bounds.x < previous.x) {
        return undefined;
      }
      positions.push({ x: rect.x - bounds.x, y: rect.y - bounds.y + ascent, advance: rect.width });
    }

    return positions;
  };

  const scaleTextMetrics = (node: SceneNode, element: Element): SceneNode => {
    let scale = 1;
    let ancestor: Element | null = element;

    while (ancestor !== null) {
      const transform = window.getComputedStyle(ancestor).transform;

      if (transform !== 'none') {
        const matrix = new DOMMatrix(transform);

        if (!matrix.is2D || matrix.a <= 0 || matrix.a !== matrix.d || matrix.b !== 0 || matrix.c !== 0) {
          return node;
        }
        scale *= matrix.a;
      }
      ancestor = ancestor.parentElement;
    }
    if (scale === 1) {
      return node;
    }
    const props = node.ir.textProps;

    if (props !== undefined) {
      props.fontSize *= scale;
      props.letterSpacing *= scale;
      if (props.lineHeightPx !== undefined) {
        props.lineHeightPx *= scale;
      }
    }
    for (const key of ['fontSize', 'lineHeight', 'letterSpacing'] as const) {
      const value = node.styles[key];

      if (value !== undefined && value.endsWith('px')) {
        node.styles[key] = `${parseFloat(value) * scale}px`;
      }
    }
    const metrics = node.textMetrics;

    if (metrics !== undefined) {
      metrics.charWidths = metrics.charWidths.map(width => width * scale);
      metrics.ascent *= scale;
      metrics.fontLineHeight *= scale;
      if (metrics.baselineOffset !== undefined) {
        metrics.baselineOffset *= scale;
      }
    }

    return node;
  };

  // ---- CSS → Figma IR mapping (runs in browser context) ----
  const colorCache = new Map<string, { r: number; g: number; b: number; a: number } | null>();
  let colorContext: CanvasRenderingContext2D | null | undefined;

  const parseColorToRGBA = (css: string | undefined): { r: number; g: number; b: number; a: number } | null => {
    if (!css) {
      return null;
    }
    const input = css.trim();

    const parseNumericChannel = (raw: string): number | null => {
      const t = raw.trim();

      if (!t) {
        return null;
      }
      if (t.endsWith('%')) {
        const n = parseFloat(t.slice(0, -1));

        if (!Number.isFinite(n)) {
          return null;
        }

        return Math.max(0, Math.min(1, n / 100));
      }
      const n = parseFloat(t);

      if (!Number.isFinite(n)) {
        return null;
      }

      return Math.max(0, Math.min(1, n / 255));
    };

    const parseAlpha = (raw: string | undefined): number => {
      if (!raw) {
        return 1;
      }
      const t = raw.trim();

      if (!t) {
        return 1;
      }
      if (t.endsWith('%')) {
        const n = parseFloat(t.slice(0, -1));

        if (!Number.isFinite(n)) {
          return 1;
        }

        return Math.max(0, Math.min(1, n / 100));
      }
      const n = parseFloat(t);

      if (!Number.isFinite(n)) {
        return 1;
      }

      return Math.max(0, Math.min(1, n));
    };

    // rgb()/rgba() legacy comma syntax and modern space+slash syntax
    const rgbFn = input.match(/^rgba?\((.+)\)$/i);

    if (rgbFn) {
      const inner = rgbFn[1].trim();
      let channelsPart = inner;
      let alphaPart: string | undefined;

      if (inner.includes('/')) {
        const split = inner.split('/');

        channelsPart = split[0].trim();
        alphaPart = split[1]?.trim();
      }

      const channelTokens = channelsPart.includes(',')
        ? channelsPart
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : channelsPart
            .split(/\s+/)
            .map(s => s.trim())
            .filter(Boolean);

      if (channelTokens.length >= 3) {
        const r = parseNumericChannel(channelTokens[0]);
        const g = parseNumericChannel(channelTokens[1]);
        const b = parseNumericChannel(channelTokens[2]);

        if (r !== null && g !== null && b !== null) {
          if (!alphaPart && channelTokens.length >= 4) {
            alphaPart = channelTokens[3];
          }

          return { r, g, b, a: parseAlpha(alphaPart) };
        }
      }
    }

    const hex = input.match(/^#([0-9a-fA-F]{3,8})$/);

    if (hex) {
      const h = hex[1];

      if (h.length === 3) {
        return {
          r: parseInt(h[0] + h[0], 16) / 255,
          g: parseInt(h[1] + h[1], 16) / 255,
          b: parseInt(h[2] + h[2], 16) / 255,
          a: 1,
        };
      }
      if (h.length === 6) {
        return {
          r: parseInt(h.slice(0, 2), 16) / 255,
          g: parseInt(h.slice(2, 4), 16) / 255,
          b: parseInt(h.slice(4, 6), 16) / 255,
          a: 1,
        };
      }
      if (h.length === 8) {
        return {
          r: parseInt(h.slice(0, 2), 16) / 255,
          g: parseInt(h.slice(2, 4), 16) / 255,
          b: parseInt(h.slice(4, 6), 16) / 255,
          a: parseInt(h.slice(6, 8), 16) / 255,
        };
      }
    }

    const cached = colorCache.get(input);

    if (cached !== undefined) {
      return cached === null ? null : { ...cached };
    }
    if (colorContext === undefined) {
      const canvas = document.createElement('canvas');

      canvas.width = 1;
      canvas.height = 1;
      colorContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (colorContext === null) {
      return null;
    }
    // Rejected assignments retain the previous fillStyle; two sentinels also accept either sentinel as a valid color.
    colorContext.fillStyle = '#000001';
    colorContext.fillStyle = input;
    const accepted = colorContext.fillStyle;

    colorContext.fillStyle = '#000002';
    colorContext.fillStyle = input;
    if (colorContext.fillStyle !== accepted) {
      colorCache.set(input, null);

      return null;
    }
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillRect(0, 0, 1, 1);
    const pixel = colorContext.getImageData(0, 0, 1, 1).data;
    const color = { r: pixel[0] / 255, g: pixel[1] / 255, b: pixel[2] / 255, a: pixel[3] / 255 };

    colorCache.set(input, color);

    return { ...color };
  };

  const computeFigmaIR = (
    nodeType: string,
    style: CSSStyleDeclaration,
    _hasChildren: boolean,
    parentLayoutAxis?: 'HORIZONTAL' | 'VERTICAL' | 'NONE',
    parentAlignItems?: string,
    parentIsGrid?: boolean,
    classNameRaw?: string,
    paintSize?: { width: number; height: number },
  ): FigmaIR => {
    const ir: FigmaIR = {
      figmaType: 'FRAME',
      opacity: 1,
      isAbsolute: false,
      fills: [],
      effects: [],
      clipsContent: false,
      flexGrow: 0,
    };
    const classTokens = (classNameRaw || '')
      .split(/\s+/)
      .map(t => t.trim())
      .filter(Boolean);
    const normalizeTailwindUtility = (token: string): string => {
      const parts = token.split(':');

      return (parts[parts.length - 1] || '').trim();
    };
    const hasTailwindFixedWidthClass = classTokens.some(token => {
      const util = normalizeTailwindUtility(token);

      if (!util.startsWith('w-')) {
        return false;
      }
      if (
        util === 'w-auto' ||
        util === 'w-full' ||
        util === 'w-screen' ||
        util === 'w-dvw' ||
        util === 'w-lvw' ||
        util === 'w-svw' ||
        util === 'w-min' ||
        util === 'w-max' ||
        util === 'w-fit'
      ) {
        return false;
      }
      if (/^w-\d+$/.test(util)) {
        return true;
      }
      if (util === 'w-px') {
        return true;
      }
      if (/^w-\[[^\]]+\]$/.test(util)) {
        return true;
      }

      return false;
    });
    const hasTailwindFixedHeightClass = classTokens.some(token => {
      const util = normalizeTailwindUtility(token);

      if (!util.startsWith('h-')) {
        return false;
      }
      if (
        util === 'h-auto' ||
        util === 'h-full' ||
        util === 'h-screen' ||
        util === 'h-dvh' ||
        util === 'h-lvh' ||
        util === 'h-svh' ||
        util === 'h-min' ||
        util === 'h-max' ||
        util === 'h-fit'
      ) {
        return false;
      }
      if (/^h-\d+$/.test(util)) {
        return true;
      }
      if (util === 'h-px') {
        return true;
      }
      if (/^h-\[[^\]]+\]$/.test(util)) {
        return true;
      }

      return false;
    });

    // 1. Opacity
    ir.opacity = parseFloat(style.opacity) || 1;

    // 2. Position / absolute
    const pos = style.position;

    ir.isAbsolute = pos === 'absolute' || pos === 'fixed';
    if (ir.isAbsolute) {
      const hasLeft = style.left !== '' && style.left !== 'auto';
      const hasRight = style.right !== '' && style.right !== 'auto';
      const hasTop = style.top !== '' && style.top !== 'auto';
      const hasBottom = style.bottom !== '' && style.bottom !== 'auto';
      let hc: NonNullable<FigmaIR['absoluteConstraints']>['horizontal'] = 'MIN';

      if (hasLeft && hasRight) {
        // getComputedStyle resolves auto insets to pixel values for fixed/absolute
        // elements with explicit width. Heuristic: if both left and right are near-zero,
        // the element is full-width pinned (MIN), not stretching.
        const leftVal = parseFloat(style.left) || 0;
        const rightVal = parseFloat(style.right) || 0;

        if (leftVal <= 1 && rightVal <= 1) {
          hc = 'MIN';
        } else if (rightVal <= 5 && leftVal > rightVal + 2) {
          hc = 'MAX';
        } else if (leftVal <= 5 && rightVal > leftVal + 2) {
          hc = 'MIN';
        } else if (Math.abs(leftVal - rightVal) <= 2) {
          hc = 'CENTER';
        } else {
          hc = 'STRETCH';
        }
      } else if (!hasLeft && hasRight) {
        hc = 'MAX';
      }
      let vc: NonNullable<FigmaIR['absoluteConstraints']>['vertical'] = 'MIN';

      if (hasTop && hasBottom) {
        // getComputedStyle resolves auto insets to pixel values, so both top and
        // bottom may have values even when only one was explicitly set.
        // Heuristic: near-zero vs large value means pinned to the smaller side.
        const topVal = parseFloat(style.top) || 0;
        const bottomVal = parseFloat(style.bottom) || 0;

        if (bottomVal <= 5 && topVal > bottomVal + 2) {
          vc = 'MAX';
        } else if (topVal <= 5 && bottomVal > topVal + 2) {
          vc = 'MIN';
        } else if (Math.abs(topVal - bottomVal) <= 2) {
          vc = 'CENTER';
        } else {
          vc = 'STRETCH';
        }
      } else if (!hasTop && hasBottom) {
        vc = 'MAX';
      }
      ir.absoluteConstraints = { horizontal: hc, vertical: vc };
    }

    // 3. Fills
    ir.fills = [];
    const bg = style.backgroundColor;

    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const c = parseColorToRGBA(bg);

      if (c) {
        ir.fills.push({ type: 'SOLID', color: c });
      }
    }
    // Icon font color: icons derived from text render with CSS `color`, not backgroundColor
    if (nodeType === 'icon' && ir.fills.length === 0) {
      const iconColor = parseColorToRGBA(style.color);

      if (iconColor) {
        ir.fills.push({ type: 'SOLID', color: iconColor });
      }
    }
    // Gradient fills
    const bgImage = style.backgroundImage;

    if (bgImage && bgImage.includes('linear-gradient')) {
      const isRepeating = bgImage.trim().startsWith('repeating-linear-gradient');
      // Use greedy match to handle nested rgba() parens inside linear-gradient()
      const gradMatch = bgImage.match(/linear-gradient\((.+)\)$/);

      if (gradMatch) {
        const inner = gradMatch[1];
        // Split on commas NOT inside parentheses
        const parts = inner.split(/,(?![^(]*\))/);
        let startIdx = 0;
        let cssAngle = 180;
        const first = parts[0].trim();

        if (first.startsWith('to ')) {
          startIdx = 1;
          const dir = first.replace('to ', '').trim();
          const dirMap: Record<string, number> = {
            right: 90,
            left: 270,
            top: 0,
            bottom: 180,
            'right bottom': 135,
            'bottom right': 135,
            'right top': 45,
            'top right': 45,
            'left bottom': 225,
            'bottom left': 225,
            'left top': 315,
            'top left': 315,
          };

          cssAngle = dirMap[dir] !== undefined ? dirMap[dir] : 180;
          if (paintSize !== undefined && paintSize.width > 0 && paintSize.height > 0 &&
              /\b(left|right)\b/.test(dir) && /\b(top|bottom)\b/.test(dir)) {
            const x = dir.includes('right') ? paintSize.height : -paintSize.height;
            const y = dir.includes('bottom') ? paintSize.width : -paintSize.width;

            // Corner keywords bisect the neighboring corners, unlike a fixed 45-degree angle.
            cssAngle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
          }
        } else if (/[\d.]+deg/.test(first)) {
          cssAngle = parseFloat(first);
          startIdx = 1;
        }
        const parsedStops: Array<{
          color: { r: number; g: number; b: number; a: number };
          position: number | null;
          unit: '%' | 'px' | null;
        }> = [];
        const totalStops = parts.length - startIdx;

        for (let i = startIdx; i < parts.length; i++) {
          const cs = parts[i].trim();
          const colorMatch = cs.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
          const posMatch = cs.match(/(-?[\d.]+)(%|px)\s*$/);

          if (colorMatch) {
            const c = parseColorToRGBA(colorMatch[1]);

            if (c) {
              parsedStops.push({
                color: c,
                position: posMatch ? parseFloat(posMatch[1]) : null,
                unit: posMatch ? posMatch[2] as '%' | 'px' : null,
              });
            }
          }
        }
        const angleRad = (cssAngle * Math.PI) / 180;
        const gradientLength = paintSize === undefined
          ? 1
          : Math.max(
              Math.abs(paintSize.width * Math.sin(angleRad)) +
              Math.abs(paintSize.height * Math.cos(angleRad)),
              1,
            );
        let stops: Array<{
          color: { r: number; g: number; b: number; a: number };
          position: number;
        }> = parsedStops.map((stop, index) => ({
          color: stop.color,
          position: stop.position === null
            ? index / Math.max(totalStops - 1, 1)
            : stop.unit === '%'
              ? stop.position / 100
              : stop.position / gradientLength,
        }));

        if (isRepeating && parsedStops.length >= 2) {
          const first = parsedStops[0];
          const last = parsedStops[parsedStops.length - 1];
          const commonUnit = first.unit !== null && first.unit === last.unit ? first.unit : null;
          const repeatLength = commonUnit === '%' ? 100 : gradientLength;
          const firstPosition = first.position ?? 0;
          const lastPosition = last.position ?? repeatLength;
          const cycleLength = lastPosition - firstPosition;

          if (commonUnit !== null && cycleLength > 0) {
            const repeatedStops: typeof stops = [];
            const firstCycle = Math.floor(-firstPosition / cycleLength);
            const lastCycle = Math.ceil((repeatLength - firstPosition) / cycleLength);

            for (let cycle = firstCycle; cycle <= lastCycle && repeatedStops.length < 256; cycle++) {
              const cycleStart = firstPosition + cycle * cycleLength;

              for (let index = 0; index < parsedStops.length && repeatedStops.length < 256; index++) {
                const stop = parsedStops[index];
                const sourcePosition = stop.position ??
                  firstPosition + (index / Math.max(parsedStops.length - 1, 1)) * cycleLength;
                const position = (cycleStart + sourcePosition - firstPosition) / repeatLength;

                if (position >= 0 && position <= 1) {
                  repeatedStops.push({ color: { ...stop.color }, position });
                }
              }
            }
            if (repeatedStops.length >= 2) {
              stops = repeatedStops;
            }
          }
        }
        if (stops.length >= 2) {
          ir.fills.push({ type: 'GRADIENT_LINEAR', stops, angleDeg: cssAngle });
        }
      }
    }

    // 4. Border
    const bw = parseFloat(style.borderTopWidth) || 0;

    if (bw > 0 && style.borderTopColor) {
      const bc = parseColorToRGBA(style.borderTopColor);

      if (bc) {
        const rawBorderStyle = (style.borderTopStyle || '').trim().toLowerCase();
        let borderStyle: 'SOLID' | 'DASHED' | 'DOTTED' | undefined;

        if (rawBorderStyle === 'dashed') {
          borderStyle = 'DASHED';
        } else if (rawBorderStyle === 'dotted') {
          borderStyle = 'DOTTED';
        } else if (rawBorderStyle) {
          borderStyle = 'SOLID';
        }
        ir.border = { color: bc, width: bw, style: borderStyle };
      }
    }

    // 5. Corner radii
    const tl = parseFloat(style.borderTopLeftRadius) || 0;
    const tr = parseFloat(style.borderTopRightRadius) || 0;
    const bl = parseFloat(style.borderBottomLeftRadius) || 0;
    const br = parseFloat(style.borderBottomRightRadius) || 0;

    if (tl > 0 || tr > 0 || bl > 0 || br > 0) {
      ir.cornerRadii = { tl, tr, bl, br, allSame: tl === tr && tr === bl && bl === br };
    }

    // 6. Effects (box-shadow and a standalone backdrop blur)
    ir.effects = [];
    const bs = style.boxShadow;

    if (bs && bs !== 'none') {
      const shadows = bs.split(/,(?![^(]*\))/);

      for (const shadow of shadows) {
        const s = shadow.trim();
        const isInset = s.startsWith('inset');
        const clean = isInset ? s.replace('inset', '').trim() : s;
        let color = { r: 0, g: 0, b: 0, a: 0.25 };
        const colorMatch = clean.match(/rgba?\([^)]+\)/);

        if (colorMatch) {
          const parsed = parseColorToRGBA(colorMatch[0]);

          if (parsed) {
            color = parsed;
          }
        }
        const nums = clean.replace(/rgba?\([^)]+\)/, '').match(/-?[\d.]+/g);

        if (nums && nums.length >= 3) {
          ir.effects.push({
            type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
            color,
            offset: { x: parseFloat(nums[0]), y: parseFloat(nums[1]) },
            radius: parseFloat(nums[2]),
            spread: nums[3] ? parseFloat(nums[3]) : 0,
          });
        }
      }
    }

    const backdropBlur = /^blur\(([\d.]+)px\)$/.exec(style.backdropFilter);

    if (backdropBlur !== null) {
      const sigma = Number(backdropBlur[1]);

      if (Number.isFinite(sigma) && sigma > 0) {
        // CSS blur uses the Gaussian standard deviation; Figma's radius is twice it.
        ir.effects.push({ type: 'BACKGROUND_BLUR', radius: sigma * 2 });
      }
    }
    const layerBlur = /^blur\(([\d.]+)px\)$/.exec(style.filter);

    if (nodeType !== 'text' && layerBlur !== null) {
      const sigma = Number(layerBlur[1]);

      if (Number.isFinite(sigma) && sigma > 0) {
        ir.effects.push({ type: 'FOREGROUND_BLUR', radius: sigma * 2 });
      }
    }

    // 7. Auto layout (flex/grid)
    const display = style.display;
    const isFlex = display === 'flex' || display === 'inline-flex';
    const isGrid = display === 'grid' || display === 'inline-grid';

    if (isFlex || isGrid) {
      const al: FigmaIRAutoLayout = { stackMode: 'HORIZONTAL' };

      if (isGrid) {
        al.stackMode = 'GRID';
        const parseTpl = (s: string) =>
          s && s !== 'none'
            ? s
                .split(/\s+/)
                .map(v => parseFloat(v) || 0)
                .filter(v => v > 0)
            : [];

        al.gridColumns = parseTpl(style.gridTemplateColumns);
        al.gridRows = parseTpl(style.gridTemplateRows);
      } else {
        const dir = style.flexDirection || 'row';

        al.stackMode = dir === 'column' || dir === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';
        if (style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse') {
          al.stackWrap = 'WRAP';
        }
      }

      const gap = parseFloat(style.gap) || 0;
      const rowGap = parseFloat(style.rowGap) || gap;
      const colGap = parseFloat(style.columnGap) || gap;

      if (isGrid) {
        al.stackSpacing = 0;
        al.gridRowGap = rowGap;
        al.gridColumnGap = colGap;
      } else {
        al.stackSpacing = al.stackMode === 'VERTICAL' ? rowGap : colGap;
        if (al.stackWrap === 'WRAP') {
          al.stackCounterSpacing = al.stackMode === 'VERTICAL' ? colGap : rowGap;
        }
      }

      // Snap sub-pixel padding (< 3px) to 0 — Figma rounds these down
      const snapPad = (v: number) => (v > 0 && v < 3 ? 0 : v);

      al.stackVerticalPadding = snapPad(parseFloat(style.paddingTop) || 0);
      al.stackHorizontalPadding = snapPad(parseFloat(style.paddingLeft) || 0);
      al.stackPaddingRight = snapPad(parseFloat(style.paddingRight) || 0);
      al.stackPaddingBottom = snapPad(parseFloat(style.paddingBottom) || 0);

      const jc = style.justifyContent || 'flex-start';

      if (jc === 'center') {
        al.stackPrimaryAlignItems = 'CENTER';
      } else if (jc === 'flex-end' || jc === 'end') {
        al.stackPrimaryAlignItems = 'MAX';
      } else if (jc === 'space-between') {
        al.stackPrimaryAlignItems = 'SPACE_BETWEEN';
      } else if (jc === 'space-evenly' || jc === 'space-around') {
        al.stackPrimaryAlignItems = 'SPACE_EVENLY';
      } else {
        al.stackPrimaryAlignItems = 'MIN';
      }

      const ai = style.alignItems || 'stretch';

      if (ai === 'center') {
        al.stackCounterAlignItems = 'CENTER';
      } else if (ai === 'flex-end' || ai === 'end') {
        al.stackCounterAlignItems = 'MAX';
      } else if (ai === 'baseline') {
        al.stackCounterAlignItems = 'BASELINE';
      } else {
        al.stackCounterAlignItems = 'MIN';
      }

      if (isGrid) {
        al.stackPrimarySizing = 'FIXED';
        al.stackCounterSizing = 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
      } else if (al.stackMode === 'HORIZONTAL') {
        // Primary axis (width): FIXED when element has explicit/fill width
        const hasExplicitW =
          hasTailwindFixedWidthClass ||
          (style.minWidth && style.minWidth !== '0px' && style.minWidth !== 'auto' && style.minWidth !== 'none');
        const hasMaxW = style.maxWidth && style.maxWidth !== 'none';
        const flexGrowVal = parseFloat(style.flexGrow) || 0;
        const flexShrinkVal = parseFloat(style.flexShrink);
        // FIXED when element has explicit width, flexGrow, flex-shrink:0,
        // fills parent width (block-level in non-horizontal context), or is grid child
        const fillsWidth = parentLayoutAxis !== 'HORIZONTAL' && display !== 'inline-flex';
        // flex-shrink:0 means the element maintains its natural width — it's FIXED
        const hasFixedFlexWidth = parentLayoutAxis === 'HORIZONTAL' && flexShrinkVal === 0;
        const hasWidthSignal =
          !!(hasExplicitW || hasMaxW) || flexGrowVal > 0 || fillsWidth || parentIsGrid || hasFixedFlexWidth;

        al.stackPrimarySizing = hasWidthSignal ? 'FIXED' : undefined;
        // Counter axis (height): FIXED when element has explicit height constraint
        // or when parent stretches children (align-items: stretch is CSS default)
        const hasExplicitH =
          hasTailwindFixedHeightClass ||
          (style.minHeight && style.minHeight !== '0px' && style.minHeight !== 'auto' && style.minHeight !== 'none');
        const hasMaxH = style.maxHeight && style.maxHeight !== 'none';
        // Parent stretches only when parent is a flex/grid layout with stretch alignment
        const parentIsLayoutContainer = parentLayoutAxis === 'HORIZONTAL' || parentLayoutAxis === 'VERTICAL';
        const parentStretchesHeight =
          parentIsLayoutContainer &&
          (parentAlignItems === 'stretch' || parentAlignItems === 'normal' || !parentAlignItems);
        const selfAlignOverrides = style.alignSelf && style.alignSelf !== 'auto' && style.alignSelf !== 'stretch';
        const parentStretchesAndNoOverride =
          parentStretchesHeight && !selfAlignOverrides && parentLayoutAxis === 'HORIZONTAL';

        al.stackCounterSizing =
          hasExplicitH || hasMaxH || parentStretchesAndNoOverride ? 'FIXED' : 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
      } else {
        // VERTICAL flex containers:
        // Counter axis (width): FIXED when element actually fills parent width
        const isInlineFlex = display === 'inline-flex';
        const hasExplicitW =
          hasTailwindFixedWidthClass ||
          (style.minWidth && style.minWidth !== '0px' && style.minWidth !== 'auto' && style.minWidth !== 'none');
        const hasMaxW = style.maxWidth && style.maxWidth !== 'none';
        // alignSelf overrides parent's stretch behavior
        const selfAlign = (style.alignSelf || '').trim().toLowerCase();
        const selfCentersOrShrinks =
          selfAlign === 'center' ||
          selfAlign === 'flex-start' ||
          selfAlign === 'start' ||
          selfAlign === 'flex-end' ||
          selfAlign === 'end';
        // Grid children get their width from the grid track → FIXED
        // Block-level elements in non-horizontal context fill parent width → FIXED
        const fillsParentWidth = !isInlineFlex && !selfCentersOrShrinks && parentLayoutAxis !== 'HORIZONTAL';

        al.stackCounterSizing =
          hasExplicitW || hasMaxW || fillsParentWidth || parentIsGrid ? 'FIXED' : 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
        // Primary axis (height): FIXED when explicit height or flexGrow > 0
        const hasExplicitH =
          hasTailwindFixedHeightClass ||
          (style.minHeight && style.minHeight !== '0px' && style.minHeight !== 'auto' && style.minHeight !== 'none');
        const hasMaxH = style.maxHeight && style.maxHeight !== 'none';
        const flexGrowVal = parseFloat(style.flexGrow) || 0;

        al.stackPrimarySizing = hasExplicitH || hasMaxH || flexGrowVal > 0 ? 'FIXED' : undefined;
      }

      // For small containers with CENTER alignment and symmetric padding,
      // Figma prefers RESIZE_TO_FIT (HUG) with MIN alignment — the padding
      // handles centering. This applies to icon wrappers, badge containers, etc.
      ir.autoLayout = al;
    }

    // 8. Overflow / clipsContent
    const overflow = style.overflow;

    ir.clipsContent = overflow !== 'visible';

    // 9. flexGrow / alignSelf
    ir.flexGrow = parseFloat(style.flexGrow) || 0;
    const alignSelf = (style.alignSelf || '').trim().toLowerCase();

    if (alignSelf === 'center') {
      ir.alignSelf = 'CENTER';
    } else if (alignSelf === 'flex-end' || alignSelf === 'end') {
      ir.alignSelf = 'MAX';
    } else if (alignSelf === 'stretch') {
      ir.alignSelf = 'STRETCH';
    } else if (alignSelf === 'baseline') {
      ir.alignSelf = 'BASELINE';
    }

    // 10. Grid placement hint (for children of grid containers)
    {
      const parseLineStart = (v: string): number | null => {
        if (!v) {
          return null;
        }
        const t = v.trim().toLowerCase();

        if (!t || t === 'auto') {
          return null;
        }
        const n = parseInt(t, 10);

        return Number.isFinite(n) ? Math.max(n - 1, 0) : null;
      };
      const parseSpan = (v: string): number => {
        if (!v) {
          return 1;
        }
        const m = v.match(/span\s+(\d+)/i);

        if (!m) {
          return 1;
        }
        const p = parseInt(m[1], 10);

        return Number.isFinite(p) && p > 0 ? p : 1;
      };
      const gc = style.gridColumn || '';
      const gr = style.gridRow || '';
      const gcs = style.gridColumnStart || '';
      const gce = style.gridColumnEnd || '';
      const grs = style.gridRowStart || '';
      const gre = style.gridRowEnd || '';

      if (gc || gr || gcs || gce || grs || gre) {
        let col = parseLineStart(gcs);
        let row = parseLineStart(grs);
        let colSpan = parseSpan(gc);
        let rowSpan = parseSpan(gr);
        // Parse shorthand gridColumn: "start / end" or "start / span N"
        const colSh = gc.trim();

        if (colSh) {
          const parts = colSh.split('/').map((p: string) => p.trim());

          if (parts.length > 0 && col === null) {
            const ps = parseLineStart(parts[0]);

            if (ps !== null) {
              col = ps;
            }
          }
          if (parts.length > 1) {
            const endVal = parseLineStart(parts[1]);

            if (endVal !== null && col !== null) {
              colSpan = Math.max(endVal - col, 1);
            } else {
              colSpan = Math.max(colSpan, parseSpan(parts[1]));
            }
          }
        }
        // Parse shorthand gridRow: "start / end" or "start / span N"
        const rowSh = gr.trim();

        if (rowSh) {
          const parts = rowSh.split('/').map((p: string) => p.trim());

          if (parts.length > 0 && row === null) {
            const ps = parseLineStart(parts[0]);

            if (ps !== null) {
              row = ps;
            }
          }
          if (parts.length > 1) {
            const endVal = parseLineStart(parts[1]);

            if (endVal !== null && row !== null) {
              rowSpan = Math.max(endVal - row, 1);
            } else {
              rowSpan = Math.max(rowSpan, parseSpan(parts[1]));
            }
          }
        }
        // Explicit end properties override shorthand
        if (gce) {
          const colEnd = parseLineStart(gce);

          if (colEnd !== null && col !== null) {
            colSpan = Math.max(colEnd - col, 1);
          } else {
            colSpan = Math.max(colSpan, parseSpan(gce));
          }
        }
        if (gre) {
          const rowEnd = parseLineStart(gre);

          if (rowEnd !== null && row !== null) {
            rowSpan = Math.max(rowEnd - row, 1);
          } else {
            rowSpan = Math.max(rowSpan, parseSpan(gre));
          }
        }
        ir.gridPlacement = {
          row: row !== null ? Math.max(row, 0) : null,
          col: col !== null ? Math.max(col, 0) : null,
          rowSpan: Math.max(rowSpan, 1),
          colSpan: Math.max(colSpan, 1),
        };
      }
    }

    // 11. CSS sizing semantics
    {
      const blockDisplays = ['block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'list-item', 'table', 'flow-root'];
      const isBlockLevel = blockDisplays.includes(display);
      const flexGrowVal = parseFloat(style.flexGrow) || 0;
      const alignSelfVal = (style.alignSelf || '').trim().toLowerCase();

      // Determine width mode
      // getComputedStyle().width always returns a pixel value for rendered elements.
      // We infer "auto" vs "fixed" from context:
      // - Block-level elements without explicit width constraints naturally fill parent → FILL
      // - Elements with flexGrow > 0 → FILL
      // - Elements with alignSelf=stretch in cross axis → FILL (for that axis)
      // - Inline/inline-block elements default to AUTO (content-sized)
      // - Elements with explicit width constraints (min-width, max-width != none) → FIXED
      let widthMode: 'FIXED' | 'AUTO' | 'FILL' = 'AUTO';
      const hasMinWidth =
        style.minWidth && style.minWidth !== '0px' && style.minWidth !== 'auto' && style.minWidth !== 'none';
      const hasMaxWidth = style.maxWidth && style.maxWidth !== 'none';
      const hasExplicitWidthConstraint = !!(hasTailwindFixedWidthClass || hasMinWidth || hasMaxWidth);

      // alignSelf center/start/end means the element does NOT fill parent
      const selfCentersOrShrinks =
        alignSelfVal === 'center' ||
        alignSelfVal === 'flex-start' ||
        alignSelfVal === 'start' ||
        alignSelfVal === 'flex-end' ||
        alignSelfVal === 'end';

      if (flexGrowVal > 0) {
        widthMode = 'FILL';
      } else if (alignSelfVal === 'stretch') {
        widthMode = 'FILL';
      } else if (
        isBlockLevel &&
        !hasExplicitWidthConstraint &&
        !selfCentersOrShrinks &&
        !parentIsGrid &&
        parentLayoutAxis !== 'HORIZONTAL'
      ) {
        // Block elements fill parent width only in vertical/block context,
        // not in horizontal flex, not in grid, and not when self-aligned away from stretch
        widthMode = 'FILL';
      } else if (display === 'inline' || display === 'inline-block') {
        widthMode = 'AUTO';
      } else if (hasExplicitWidthConstraint) {
        widthMode = 'FIXED';
      }

      // Determine height mode
      // Most elements have auto height (content-determined)
      // Elements with explicit height or flex stretch have FIXED/FILL
      let heightMode: 'FIXED' | 'AUTO' | 'FILL' = 'AUTO';
      const hasMinHeight =
        style.minHeight && style.minHeight !== '0px' && style.minHeight !== 'auto' && style.minHeight !== 'none';
      const hasMaxHeight = style.maxHeight && style.maxHeight !== 'none';
      const hasExplicitHeightConstraint = !!(hasTailwindFixedHeightClass || hasMinHeight || hasMaxHeight);

      if (hasExplicitHeightConstraint) {
        heightMode = 'FIXED';
      }

      ir.sizing = { widthMode, heightMode, isBlockLevel };
    }

    // 12. Text properties
    if (nodeType === 'text') {
      const fontSize = parseFloat(style.fontSize) || 14;
      const fontWeight = parseInt(style.fontWeight) || 400;
      const textColor = parseColorToRGBA(style.color) || { r: 0, g: 0, b: 0, a: 1 };

      const lhRaw = style.lineHeight;
      let lineHeightPx: number;

      if (!lhRaw || lhRaw === 'normal') {
        lineHeightPx = Math.round(fontSize * 1.25 * 100) / 100;
      } else if (lhRaw.endsWith('px')) {
        lineHeightPx = parseFloat(lhRaw) || Math.round(fontSize * 1.25 * 100) / 100;
      } else if (lhRaw.endsWith('%')) {
        lineHeightPx = Math.round(((fontSize * parseFloat(lhRaw)) / 100) * 100) / 100;
      } else {
        const unitless = parseFloat(lhRaw);

        lineHeightPx =
          unitless > 0 ? Math.round(fontSize * unitless * 100) / 100 : Math.round(fontSize * 1.25 * 100) / 100;
      }

      const ls = parseFloat(style.letterSpacing) || 0;
      const ta = style.textAlign;
      let textAlign: FigmaIRTextProps['textAlign'] = 'LEFT';

      if (ta === 'center') {
        textAlign = 'CENTER';
      } else if (ta === 'right' || ta === 'end') {
        textAlign = 'RIGHT';
      }

      const tp: FigmaIRTextProps = {
        fontFamily: style.fontFamily || '',
        fontWeight,
        fontStyle: style.fontStyle,
        fontSize,
        lineHeightPx,
        letterSpacing: isNaN(ls) ? 0 : ls,
        textAlign,
        color: textColor,
      };

      const td = style.textDecorationLine || style.textDecoration || '';

      if (td.includes('underline')) {
        tp.textDecoration = 'UNDERLINE';
      } else if (td.includes('line-through')) {
        tp.textDecoration = 'STRIKETHROUGH';
      }

      const tt = style.textTransform;

      if (tt === 'uppercase') {
        tp.textCase = 'UPPER';
      } else if (tt === 'lowercase') {
        tp.textCase = 'LOWER';
      } else if (tt === 'capitalize') {
        tp.textCase = 'TITLE';
      }

      ir.textProps = tp;
    }

    // 13. Determine Figma node type
    if (nodeType === 'text') {
      ir.figmaType = 'TEXT';
    } else if (nodeType === 'image') {
      ir.figmaType = 'FRAME';
    } else if (nodeType === 'svg' || nodeType === 'icon') {
      ir.figmaType = 'FRAME'; // icons with svgContent will be upgraded to VECTOR in convertNode
    } else {
      ir.figmaType = 'FRAME';
    }

    return ir;
  };

  const extractVisibleText = (element: Element): string => {
    const clone = element.cloneNode(true) as Element;
    const value = ((clone as HTMLElement).innerText ?? clone.textContent ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00A0/g, ' ');

    return value;
  };

  const blobToDataUrl = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';

    for (let start = 0; start < bytes.length; start += 32768) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    }

    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  };

  const rasterizeSourceToElementSize = (
    image: CanvasImageSource,
    naturalWidth: number,
    naturalHeight: number,
    targetWidth: number,
    targetHeight: number,
    objectFit = 'fill',
    objectPosition = '50% 50%',
    mimeType = 'image/png',
  ): string => {
    const safeWidth = Math.max(Math.round(targetWidth), 1);
    const safeHeight = Math.max(Math.round(targetHeight), 1);

    const canvas = document.createElement('canvas');

    canvas.width = safeWidth;
    canvas.height = safeHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx === null) {
      throw new Error('Image capture canvas is unavailable.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const containScale = Math.min(safeWidth / naturalWidth, safeHeight / naturalHeight);
    const scale = objectFit === 'cover'
      ? Math.max(safeWidth / naturalWidth, safeHeight / naturalHeight)
      : objectFit === 'none' ? 1 : objectFit === 'scale-down' ? Math.min(1, containScale) : containScale;
    const drawWidth = objectFit === 'fill' ? safeWidth : naturalWidth * scale;
    const drawHeight = objectFit === 'fill' ? safeHeight : naturalHeight * scale;
    const positionTokens = objectPosition.trim().split(/\s+/);
    const offset = (token: string, available: number): number => {
      const keywords: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };

      if (token in keywords) {
        return available * keywords[token];
      }
      const value = parseFloat(token);

      return Number.isFinite(value) ? token.endsWith('%') ? available * value / 100 : value : available / 2;
    };

    ctx.drawImage(
      image,
      offset(positionTokens[0] ?? '50%', safeWidth - drawWidth),
      offset(positionTokens[1] ?? '50%', safeHeight - drawHeight),
      drawWidth,
      drawHeight,
    );

    const fillsTarget = drawWidth >= safeWidth && drawHeight >= safeHeight;

    return mimeType === 'image/jpeg' && fillsTarget
      ? canvas.toDataURL('image/jpeg', 0.92)
      : canvas.toDataURL('image/png');
  };

  const rasterizeBlobToElementSize = async (
    blob: Blob,
    targetWidth: number,
    targetHeight: number,
    objectFit = 'fill',
    objectPosition = '50% 50%',
  ): Promise<string> => {
    if (Math.round(targetWidth) <= 2 || Math.round(targetHeight) <= 2) {
      return blobToDataUrl(blob);
    }
    const objectUrl = URL.createObjectURL(blob);

    try {
      const image = new Image();

      image.src = objectUrl;
      // Native decode promises also settle when input scripts and DOM event callbacks are disabled.
      await image.decode();

      return rasterizeSourceToElementSize(
        image, image.naturalWidth, image.naturalHeight, targetWidth, targetHeight,
        objectFit, objectPosition, blob.type,
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const getBase64FromUrl = async (
    url: string,
    targetWidth?: number,
    targetHeight?: number,
    objectFit = 'fill',
    objectPosition = '50% 50%',
  ): Promise<string | null> => {
    try {
      console.info('Fetching image:', url.substring(0, 100));
      const response = await fetch(url);

      if (!response.ok) {
        console.error('Failed to fetch (HTTP error):', response.status, url.substring(0, 100));

        return null;
      }
      const blob = await response.blob();

      if ((targetWidth || 0) > 0 && (targetHeight || 0) > 0) {
        return await rasterizeBlobToElementSize(blob, targetWidth || 0, targetHeight || 0, objectFit, objectPosition);
      }

      return await blobToDataUrl(blob);
    } catch (e) {
      console.error('Failed to fetch:', url.substring(0, 100), (e as Error).message);

      return null;
    }
  };

  const sceneByElement = new WeakMap<Element, SceneNode>();
  const owningTable = (element: Element): Element | null => {
    let ancestor = element.parentElement;

    while (ancestor !== null) {
      if (['table', 'inline-table'].includes(window.getComputedStyle(ancestor).display)) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }

    return null;
  };
  const assembleCollapsedBorders = (table: Element, host: SceneNode): void => {
    const tableStyle = window.getComputedStyle(table);

    if (!['table', 'inline-table'].includes(tableStyle.display) || tableStyle.borderCollapse !== 'collapse') {
      return;
    }
    const priorities: Record<string, number> = {
      table: 1, 'inline-table': 1, 'table-column-group': 2, 'table-column': 3,
      'table-row-group': 4, 'table-header-group': 4, 'table-footer-group': 4, 'table-row': 5, 'table-cell': 6,
    };
    const styles: Record<string, number> = {
      none: 0, dotted: 1, dashed: 2, solid: 3, double: 4,
      hidden: 5,
    };
    const descendants = Array.from(table.querySelectorAll('*')).filter(element => owningTable(element) === table);
    const elements = [table, ...descendants]
      .filter(element => {
        const display = window.getComputedStyle(element).display;

        return priorities[display] !== undefined && (element === table || !['table', 'inline-table'].includes(display));
      });

    // Per-cell/row compositing needs the corresponding ownership layer, not a table-wide paint.
    if (elements.some(element => element !== table && window.getComputedStyle(element).opacity !== '1')) {
      return;
    }
    let transformed: Element | null = table;

    while (transformed !== null) {
      if (window.getComputedStyle(transformed).transform !== 'none') {
        return;
      }
      transformed = transformed.parentElement;
    }
    const cells = elements.filter(element => window.getComputedStyle(element).display === 'table-cell');

    if (cells.length === 0) {
      return;
    }
    const rectangles = cells.map(cell => cell.getBoundingClientRect());
    const xs = [...new Set(rectangles.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b);
    const ys = [...new Set(rectangles.flatMap(rect => [rect.top, rect.bottom]))].sort((a, b) => a - b);

    type Edge = {
      vertical: boolean; coordinate: number; start: number; end: number;
      width: number; style: string; color: { r: number; g: number; b: number; a: number };
      rank: number; x: number; y: number;
    };
    const candidates: Edge[] = [];

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const isTable = element === table;
      const box = isTable ? { left: xs[0], right: xs[xs.length - 1], top: ys[0], bottom: ys[ys.length - 1] } : rect;

      for (const side of ['top', 'right', 'bottom', 'left']) {
        const borderStyle = style.getPropertyValue(`border-${side}-style`);

        if (styles[borderStyle] === undefined) {
          return;
        }
        if (borderStyle === 'none') {
          continue;
        }
        const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
        const color = parseColorToRGBA(style.getPropertyValue(`border-${side}-color`));

        if (color === null || (width <= 0 && borderStyle !== 'hidden')) {
          continue;
        }
        const vertical = side === 'left' || side === 'right';

        candidates.push({
          vertical, coordinate: side === 'left' ? box.left : side === 'right' ? box.right
            : side === 'top' ? box.top : box.bottom,
          start: vertical ? box.top : box.left, end: vertical ? box.bottom : box.right,
          width, style: borderStyle, color,
          rank: priorities[style.display], x: rect.x, y: rect.y,
        });
      }
    }
    const direction = tableStyle.direction === 'rtl' ? -1 : 1;
    const compare = (a: Edge, b: Edge): number => Number(a.style === 'hidden') - Number(b.style === 'hidden') ||
      a.width - b.width || styles[a.style] - styles[b.style] || a.rank - b.rank ||
      (b.x - a.x) * direction || b.y - a.y;
    const winners: Edge[] = [];
    const byLine = new Map<string, Edge[]>();

    for (const edge of candidates) {
      const key = `${edge.vertical}:${edge.coordinate}`;
      const line = byLine.get(key) ?? [];

      line.push(edge);
      byLine.set(key, line);
    }

    for (const vertical of [true, false]) {
      const coordinates = vertical ? xs : ys;
      const stops = vertical ? ys : xs;

      for (const coordinate of coordinates) {
        const line = (byLine.get(`${vertical}:${coordinate}`) ?? []).sort((a, b) => a.start - b.start);
        const active: Edge[] = [];
        let cursor = 0;

        for (let index = 0; index + 1 < stops.length; index++) {
          const start = stops[index], end = stops[index + 1];

          while (cursor < line.length && line[cursor].start <= start) {
            active.push(line[cursor++]);
          }
          for (let activeIndex = active.length - 1; activeIndex >= 0; activeIndex--) {
            if (active[activeIndex].end <= start) {
              active.splice(activeIndex, 1);
            }
          }
          const winner = active.filter(edge => edge.end >= end).sort(compare).at(-1);

          if (winner !== undefined && winner.style !== 'hidden' && winner.color.a > 0) {
            winners.push({ ...winner, start, end });
          }
        }
      }
    }

    if (winners.length === 0 && candidates.length === 0) {
      return;
    }
    const groups = new Map<string, {
      color: { r: number; g: number; b: number; a: number };
      shapes: Array<{ x: number; y: number; width: number; height: number; round: boolean }>;
    }>();

    for (const edge of winners.sort(compare)) {
      const key = JSON.stringify(edge.color);
      const group = groups.get(key) ?? { color: edge.color, shapes: [] };
      const addStripe = (start: number, end: number, offset: number, thickness: number, round = false): void => {
        group.shapes.push({
          x: edge.vertical ? edge.coordinate + offset - thickness / 2 : start,
          y: edge.vertical ? start : edge.coordinate + offset - thickness / 2,
          width: edge.vertical ? thickness : end - start,
          height: edge.vertical ? end - start : thickness, round,
        });
      };

      if (edge.style === 'double') {
        addStripe(edge.start, edge.end, -edge.width / 3, edge.width / 3);
        addStripe(edge.start, edge.end, edge.width / 3, edge.width / 3);
      } else if (edge.style === 'dashed' || edge.style === 'dotted') {
        const length = edge.style === 'dotted' ? edge.width : edge.width * 3;
        const gap = edge.width * 2;

        for (let start = edge.start; start < edge.end; start += length + gap) {
          addStripe(start, Math.min(start + length, edge.end), 0, edge.width, edge.style === 'dotted');
        }
      } else {
        addStripe(edge.start, edge.end, 0, edge.width);
      }
      groups.set(key, group);
    }
    for (const element of elements) {
      const node = sceneByElement.get(element);

      if (node !== undefined) {
        delete node.ir.border;
      }
    }
    const paintNodes: SceneNode[] = [];

    for (const group of groups.values()) {
      let x = Infinity, y = Infinity, rightEdge = -Infinity, bottomEdge = -Infinity;

      for (const shape of group.shapes) {
        x = Math.min(x, shape.x);
        y = Math.min(y, shape.y);
        rightEdge = Math.max(rightEdge, shape.x + shape.width);
        bottomEdge = Math.max(bottomEdge, shape.y + shape.height);
      }
      const width = rightEdge - x, height = bottomEdge - y;
      const paths = group.shapes.map(shape => {
        const left = shape.x - x, top = shape.y - y;
        const right = left + shape.width, bottom = top + shape.height;

        if (shape.round) {
          const cx = (left + right) / 2, cy = (top + bottom) / 2;
          const rx = shape.width / 2, ry = shape.height / 2;

          return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}` +
            `A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}Z`;
        }

        return `M${left} ${top}H${right}V${bottom}H${left}Z`;
      }).join('');

      paintNodes.push({
        type: 'frame', name: 'Collapsed border paint', text: null, x: x + window.scrollX, y: y + window.scrollY,
        width, height, styles: {}, children: [],
        svgContent: `<svg viewBox="0 0 ${width} ${height}"><path d="${paths}"/></svg>`,
        ir: {
          figmaType: 'VECTOR', opacity: 1, fills: [{ type: 'SOLID', color: group.color }], effects: [],
          clipsContent: false, isAbsolute: true, flexGrow: 0,
        },
      });
    }
    host.children.push({
      type: 'frame', name: 'Collapsed table borders', x: host.x, y: host.y,
      width: host.width, height: host.height, text: null, styles: {}, children: paintNodes,
      ir: {
        figmaType: 'FRAME', opacity: 1, fills: [], effects: [], clipsContent: false,
        isAbsolute: true, flexGrow: 0,
      },
    });
  };

  const walk = async (el: Element): Promise<WalkResult> => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    if (style.backgroundImage && style.backgroundImage !== 'none') {
      console.info(
        '🔍 Element with bg:',
        el.tagName,
        'size:',
        Math.round(rect.width) + 'x' + Math.round(rect.height),
        'bgImage:',
        style.backgroundImage.substring(0, 100),
      );
    }

    const opacity = parseFloat(style.opacity);
    const visibility = style.visibility;
    const display = style.display;
    const isHidden = opacity === 0 || visibility === 'hidden' || display === 'none';
    const isTiny = rect.width < 3 || rect.height < 3;
    const hasChildren = el.children.length > 0;
    const isLayoutContainer = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display);
    const isSemanticContainerTag = ['BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE'].includes(
      el.tagName,
    );
    const hasVisibleDecoration =
      (style.backgroundColor &&
        style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        style.backgroundColor !== 'transparent') ||
      (style.borderTopWidth && parseFloat(style.borderTopWidth) > 0) ||
      (style.boxShadow && style.boxShadow !== 'none') ||
      (style.backgroundImage && style.backgroundImage !== 'none');
    const keepTinyStructuralNode = isTiny && hasChildren && (isLayoutContainer || isSemanticContainerTag);

    const hasBgImage = style.backgroundImage && style.backgroundImage !== 'none';

    if (hasBgImage && (isHidden || isTiny)) {
      console.warn(
        '⚠️ SKIPPING element with background-image:',
        el.tagName,
        'size:',
        Math.round(rect.width) + 'x' + Math.round(rect.height),
        'hidden:',
        isHidden,
        'tiny:',
        isTiny,
      );
    }

    if (isHidden || (isTiny && !hasVisibleDecoration && !keepTinyStructuralNode)) {
      const children: SceneNode[] = [];

      for (const child of Array.from(el.children)) {
        const childNode = await walk(child);

        if (childNode) {
          if (Array.isArray(childNode)) {
            children.push(...childNode);
          } else {
            children.push(childNode);
          }
        }
      }

      return children.length > 0 ? children : null;
    }

    let className = '';

    try {
      if (typeof el.className === 'string') {
        className = el.className.toLowerCase();
      } else if (typeof el.className === 'object' && el.className !== null && 'baseVal' in el.className) {
        const svgClassName = (el.className as { baseVal?: unknown }).baseVal;

        if (typeof svgClassName === 'string') {
          className = svgClassName.toLowerCase();
        }
      } else if (el.getAttribute) {
        className = (el.getAttribute('class') || '').toLowerCase();
      }
    } catch {
      className = '';
    }

    let type: SceneNode['type'] = 'frame';
    const textTagNames = ['P', 'SPAN', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'BUTTON', 'INPUT', 'SELECT'];
    const blockTextTagNames = ['P', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'BUTTON'];

    const hasVideoPoster = el.tagName === 'VIDEO' && (el as HTMLVideoElement).poster !== '' &&
      (el as HTMLVideoElement).readyState < HTMLMediaElement.HAVE_CURRENT_DATA;

    if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || hasVideoPoster) {
      type = 'image';
    } else if (textTagNames.includes(el.tagName)) {
      type = 'text';
    }

    if (type === 'text' && ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display)) {
      type = 'frame';
    }

    if (type === 'text' && (blockTextTagNames.includes(el.tagName) || el.children.length > 0)) {
      type = 'frame';
    }

    const preserveWhitespace = ['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace);
    let textContent: string | null = null;

    if (type === 'text') {
      if (el.tagName === 'INPUT') {
        const inputEl = el as HTMLInputElement;
        const hasTextValue = !['checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(inputEl.type);

        textContent = hasTextValue ? inputEl.value || inputEl.placeholder || '' : '';
      } else if (el.tagName === 'SELECT') {
        const selectEl = el as HTMLSelectElement;

        textContent = selectEl.options[selectEl.selectedIndex]?.text || 'Select...';
      } else {
        textContent = preserveWhitespace ? el.textContent ?? '' : extractVisibleText(el).trim();
      }
      if (!textContent) {
        type = 'frame';
      }
    }

    const captureSynthetic = needsSyntheticTextCapture(el, style, textContent ?? el.textContent ?? '');

    if (type === 'text' && captureSynthetic && el.firstChild?.nodeType === 3) {
      type = 'frame';
      textContent = null;
    }

    // A CSS box may be narrower than its text. Keep the box as a frame and
    // extract its measured text separately; clipping belongs to the CSS host.
    if (type === 'text' && el.childNodes.length === 1 && el.firstChild?.nodeType === 3) {
      const range = document.createRange();

      range.selectNodeContents(el.firstChild);
      const textBounds = range.getBoundingClientRect();

      if (textBounds.left < rect.left || textBounds.right > rect.right) {
        type = 'frame';
        textContent = null;
      }
    }

    let bgImage: string | null = null;

    if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
      const m = style.backgroundImage.match(/url\(['"]?(.+?)['"]?\)/);

      if (m && m[1]) {
        bgImage = m[1];
      }
    }

    // Element naming
    let elementName = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';

    const tagNameMap: Record<string, string> = {
      BODY: 'Body',
      NAV: 'Nav',
      HEADER: 'Header',
      FOOTER: 'Footer',
      MAIN: 'Main',
      ASIDE: 'Sidebar',
      SECTION: 'Section',
      ARTICLE: 'Article',
      FIGURE: 'Figure',
      FIGCAPTION: 'Caption',
      UL: 'List',
      OL: 'NumberedList',
      LI: 'ListItem',
      TABLE: 'Table',
      FORM: 'Form',
      FIELDSET: 'FieldSet',
      A: 'Link',
    };

    if (ariaLabel) {
      elementName = ariaLabel;
    } else if (type === 'image') {
      // Images: prefer alt text over className-based naming
      elementName = (el as HTMLImageElement).alt || el.getAttribute('data-alt') || 'Image';
    } else if (role) {
      const roleMap: Record<string, string> = {
        navigation: 'Nav',
        banner: 'Header',
        main: 'Main',
        contentinfo: 'Footer',
        complementary: 'Sidebar',
        button: 'Button',
        dialog: 'Modal',
        alert: 'Alert',
        tablist: 'Tabs',
        tab: 'Tab',
        tabpanel: 'TabPanel',
        menu: 'Menu',
        menuitem: 'MenuItem',
        list: 'List',
        listitem: 'ListItem',
        search: 'Search',
        form: 'Form',
        img: 'Image',
        figure: 'Figure',
      };

      elementName = roleMap[role] || role;
    } else if (el.id) {
      elementName = el.id;
    } else if (tagNameMap[el.tagName]) {
      elementName = tagNameMap[el.tagName];
    } else if (className) {
      const classNames = className.split(/\s+/);
      let semanticClass = '';
      const utilityLikePattern =
        /^(flex|grid|block|inline|items-|justify-|content-|self-|place-|space-|gap-|p[trblxy]?-[0-9]|m[trblxy]?-[0-9]|w-|h-|min-|max-|text-|font-|leading-|tracking-|bg-|border|rounded|shadow|overflow-|z-|absolute|relative|fixed|sticky|top-|right-|bottom-|left-|group|transition|active:|hover:|dark:|no-scrollbar|flex-shrink|flex-grow|backdrop-|from-|to-|via-|opacity-|scale-|ring-|outline-|cursor-|pointer-events-|select-|sr-only|not-sr-only|object-|aspect-|columns-|break-|order-|col-|row-|auto-|float-|clear-|isolat|mix-blend-|brightness-|contrast-|grayscale|invert|saturate|sepia|drop-shadow|blur-|hue-rotate|backdrop|will-change|animate-|duration-|ease-|delay-|origin-|translate-|rotate-|skew-|whitespace-|break-|hyphens-|list-|decoration-|underline|overline|line-through|no-underline|accent-|caret-|scroll-|snap-|touch-|resize|appearance-|fill-|stroke-)/;
      const componentPatterns = [
        'header',
        'footer',
        'nav',
        'sidebar',
        'menu',
        'card',
        'button',
        'modal',
        'dialog',
        'alert',
        'badge',
        'chip',
        'tag',
        'avatar',
        'toolbar',
        'tab',
        'panel',
        'accordion',
        'carousel',
        'slider',
        'progress',
        'spinner',
        'toast',
        'tooltip',
        'dropdown',
        'popover',
        'breadcrumb',
        'pagination',
        'table',
        'form',
        'input',
        'select',
        'checkbox',
        'radio',
        'switch',
        'toggle',
        'search',
        'filter',
        'hero',
        'banner',
        'section',
        'container',
        'wrapper',
        'content',
        'title',
        'subtitle',
        'heading',
        'label',
        'description',
        'caption',
        'icon',
        'logo',
        'image',
        'thumbnail',
        'gallery',
        'list',
        'listitem',
        'row',
        'column',
        'divider',
        'separator',
        'spacer',
      ];

      for (const cls of classNames) {
        const cleaned = cls.replace(/^\./, '');
        // Strip pseudo-class prefixes (hover:, active:, dark:, etc.) for matching
        const baseCls = cleaned.replace(/^[a-z]+:/g, '');

        for (const pattern of componentPatterns) {
          // Match as whole word or hyphen-separated segment, not substring
          // e.g., "form" matches "form" or "my-form" but not "transition-transform"
          const wordBoundary = new RegExp('(^|[-_])' + pattern + '($|[-_])');

          if (wordBoundary.test(baseCls)) {
            semanticClass = cleaned;

            break;
          }
        }
        if (semanticClass) {
          break;
        }
      }

      if (!semanticClass) {
        const firstClass = (classNames[0] || '').replace(/^\./, '');
        const looksLikeUtility = classNames.every(cls => utilityLikePattern.test(cls.replace(/^\./, '')));

        if (looksLikeUtility) {
          if (style.display.includes('grid')) {
            elementName = 'Grid';
          } else {
            elementName = type === 'frame' ? 'Container' : elementName;
          }
        } else {
          elementName = firstClass || elementName;
        }
      } else {
        elementName = semanticClass;
      }
    } else {
      if (type === 'text' && textContent) {
        elementName = textContent.substring(0, 24);
      }
    }

    const node: SceneNode = {
      type,
      name: elementName,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
      text: textContent,
      svg: null,
      styles: {
        backgroundColor: style.backgroundColor,
        color: style.color,
        opacity: style.opacity,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        fontStyle: style.fontStyle,
        fontVariantLigatures: style.fontVariantLigatures,
        fontFeatureSettings: style.fontFeatureSettings,
        textAlign: style.textAlign,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        textDecoration: style.textDecorationLine || style.textDecoration,
        borderRadius: style.borderRadius,
        borderTopLeftRadius: style.borderTopLeftRadius,
        borderTopRightRadius: style.borderTopRightRadius,
        borderBottomLeftRadius: style.borderBottomLeftRadius,
        borderBottomRightRadius: style.borderBottomRightRadius,
        borderTopWidth: style.borderTopWidth,
        borderTopColor: style.borderTopColor,
        borderTopStyle: style.borderTopStyle,
        borderRightWidth: style.borderRightWidth,
        borderRightStyle: style.borderRightStyle,
        borderBottomWidth: style.borderBottomWidth,
        borderBottomStyle: style.borderBottomStyle,
        borderLeftWidth: style.borderLeftWidth,
        borderLeftStyle: style.borderLeftStyle,
        boxShadow: style.boxShadow,
        display: style.display,
        flexDirection: style.flexDirection,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        flexWrap: style.flexWrap,
        gap: style.gap,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        backgroundImage: style.backgroundImage,
        maskImage: style.maskImage,
        webkitMaskImage: style.webkitMaskImage,
        overflow: style.overflow,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        flexGrow: style.flexGrow,
        flexShrink: style.flexShrink,
        alignSelf: style.alignSelf,
        position: style.position,
        top: style.top,
        right: style.right,
        bottom: style.bottom,
        left: style.left,
        gridTemplateColumns: style.gridTemplateColumns,
        gridTemplateRows: style.gridTemplateRows,
        gridColumn: style.gridColumn,
        gridRow: style.gridRow,
        gridColumnStart: style.gridColumnStart,
        gridColumnEnd: style.gridColumnEnd,
        gridRowStart: style.gridRowStart,
        gridRowEnd: style.gridRowEnd,
        objectFit: style.objectFit,
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        placeholderColor: el.tagName === 'INPUT' ? window.getComputedStyle(el, '::placeholder').color : undefined,
      },
      tagName: el.tagName,
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      fontSource:
        type === 'text'
          ? resolveFontSource(style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, textContent || undefined)
          : null,
      fontSources:
        type === 'text'
          ? resolveFontSources(style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, textContent || undefined)
          : [],
      children: [],
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
      },
    };

    // Compute Figma IR — semantic properties resolved from CSS
    const parentEl = el.parentElement;
    const parentLayoutInfo = (() => {
      if (!parentEl) {
        return { axis: 'NONE' as const, alignItems: '', isGrid: false };
      }
      const ps = window.getComputedStyle(parentEl);
      const pd = ps.display;
      const isParentGrid = pd === 'grid' || pd === 'inline-grid';

      if (pd === 'flex' || pd === 'inline-flex') {
        const dir = ps.flexDirection || 'row';
        const axis = dir === 'column' || dir === 'column-reverse' ? ('VERTICAL' as const) : ('HORIZONTAL' as const);

        return { axis, alignItems: ps.alignItems || '', isGrid: false };
      }
      if (isParentGrid) {
        return { axis: 'HORIZONTAL' as const, alignItems: ps.alignItems || '', isGrid: true };
      }

      return { axis: 'NONE' as const, alignItems: '', isGrid: false };
    })();
    const elementClassName =
      typeof el.className === 'string'
        ? el.className
        : typeof el.className === 'object' && el.className !== null && 'baseVal' in el.className
          ? String((el.className as { baseVal?: unknown }).baseVal || '')
          : '';

    node.ir = computeFigmaIR(
      type,
      style,
      el.children.length > 0,
      parentLayoutInfo.axis,
      parentLayoutInfo.alignItems,
      parentLayoutInfo.isGrid,
      elementClassName,
      { width: el.clientWidth || rect.width, height: el.clientHeight || rect.height },
    );

    sceneByElement.set(el, node);

    // Collapsed cell borders straddle grid boundaries. Transparent shared edges need a single owner
    // before centering: painting them from both cells would darken the overlap.
    if (style.display === 'table-cell' && node.ir.border !== undefined && node.ir.border.color.a === 1) {
      let ancestor = el.parentElement;

      while (ancestor !== null) {
        const ancestorStyle = window.getComputedStyle(ancestor);

        if (ancestorStyle.display === 'table' || ancestorStyle.display === 'inline-table') {
          if (ancestorStyle.borderCollapse === 'collapse') {
            node.ir.border.alignment = 'CENTER';
          }

          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    // Detect explicit height on HORIZONTAL flex containers:
    // When element height exceeds auto-height (max child height + padding),
    // height was explicitly set via CSS → use FIXED so Figma respects it
    const _irAL = node.ir.autoLayout;

    if (_irAL?.stackMode === 'HORIZONTAL' && _irAL?.stackCounterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE') {
      const childEls = Array.from(el.children);

      if (childEls.length > 0) {
        const nonAbsoluteChildren = childEls.filter(c => {
          const cs = window.getComputedStyle(c);

          return cs.position !== 'absolute' && cs.position !== 'fixed';
        });
        const basisChildren = nonAbsoluteChildren.length > 0 ? nonAbsoluteChildren : childEls;
        const maxChildH = Math.max(0, ...basisChildren.map(c => c.getBoundingClientRect().height));
        const padTop = parseFloat(style.paddingTop) || 0;
        const padBot = parseFloat(style.paddingBottom) || 0;

        if (rect.height > maxChildH + padTop + padBot + 2) {
          _irAL.stackCounterSizing = 'FIXED';
        }
      }
    }

    if (el.tagName === 'CANVAS') {
      try {
        const canvas = el as HTMLCanvasElement;
        const matrix = emojiTransforms.get(canvas);
        let capturedCanvas = canvasSnapshots.get(canvas) ?? canvas;

        if (matrix !== undefined) {
          const width = parseFloat(canvas.style.width);
          const height = parseFloat(canvas.style.height);
          const corners = [[0, 0], [width, 0], [0, height], [width, height]]
            .map(([x, y]) => matrix.transformPoint({ x, y }));
          const minX = Math.min(...corners.map(point => point.x));
          const minY = Math.min(...corners.map(point => point.y));
          const scale = Math.max(2, window.devicePixelRatio);
          const output = document.createElement('canvas');

          output.width = Math.max(1, Math.ceil(rect.width * scale));
          output.height = Math.max(1, Math.ceil(rect.height * scale));
          const context = output.getContext('2d');

          if (context === null) {
            throw new Error('Emoji transform canvas is unavailable.');
          }
          context.scale(scale, scale);
          context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - minX, matrix.f - minY);
          context.drawImage(capturedCanvas, 0, 0, width, height);
          capturedCanvas = output;
        }
        if (capturedCanvas.width > 0 && capturedCanvas.height > 0) {
          // Canvas pixels already live in memory. Copy synchronously instead of encoding,
          // fetching, and decoding them through an asynchronous image resource.
          node.image = rasterizeSourceToElementSize(
            capturedCanvas, capturedCanvas.width, capturedCanvas.height,
            rect.width, rect.height, style.objectFit, style.objectPosition,
          );
        }
      } catch (error) {
        console.warn('Canvas pixels could not be captured:', error instanceof Error ? error.message : String(error));
      }
    } else if (hasVideoPoster) {
      node.image = await getBase64FromUrl(
        (el as HTMLVideoElement).poster, rect.width, rect.height, style.objectFit, style.objectPosition,
      );
    } else if (type === 'image') {
      console.info('📷 Found image:', (el as HTMLImageElement).src);
      node.image = await getBase64FromUrl(
        (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src,
        rect.width,
        rect.height,
        style.objectFit,
        style.objectPosition,
      );
      console.info(
        '  → Base64 conversion:',
        node.image ? 'SUCCESS (' + node.image.substring(0, 50) + '...)' : 'FAILED',
      );
    }

    // Measure text metrics for Figma glyph generation
    if (type === 'text' && textContent) {
      const cssFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = measureTextMetrics(textContent, cssFont);
      const textNode = el.childNodes.length === 1 ? el.firstChild : null;
      const hasPlainTextBox = [
        style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft,
        style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth,
      ].every(value => parseFloat(value) === 0);
      let baselineOffset: number | undefined;

      if (textNode?.nodeType === 3 && !hasPlainTextBox && style.writingMode === 'horizontal-tb') {
        let ancestor: Element | null = el;

        while (ancestor !== null && window.getComputedStyle(ancestor).transform === 'none') {
          ancestor = ancestor.parentElement;
        }
        if (ancestor === null) {
          const range = document.createRange();

          range.selectNodeContents(textNode);
          const textBounds = range.getBoundingClientRect();

          if (textBounds.height > 0) {
            baselineOffset = textBounds.top - rect.top + metrics.ascent;
          }
        }
      }

      node.textMetrics = {
        ...metrics,
        baselineOffset,
        characterPositions: textNode?.nodeType === 3 && hasPlainTextBox
          ? measureCharacterPositions(textNode, textContent, rect, metrics.ascent) : undefined,
      };
      scaleTextMetrics(node, el);
    }

    if (bgImage) {
      console.info('🖼️  Found background image:', bgImage);
      node.backgroundImage = await getBase64FromUrl(bgImage, rect.width, rect.height);
      console.info('  → Base64 conversion:', node.backgroundImage ? 'SUCCESS' : 'FAILED');
    }

    // SVG handling
    if (el.tagName.toUpperCase() === 'SVG') {
      node.type = 'svg';
      // Standalone SVG images cannot inherit the page's classes or currentColor.
      const svgClone = el.cloneNode(true) as Element;
      const sourceElements = [el, ...Array.from(el.querySelectorAll('*'))];
      const clonedElements = [svgClone, ...Array.from(svgClone.querySelectorAll('*'))];
      const svgProperties = [
        'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
        'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'stroke-dashoffset', 'opacity', 'visibility', 'display', 'font-family',
        'font-size', 'font-weight', 'font-style', 'text-anchor',
      ];

      sourceElements.forEach((source, index) => {
        const computed = window.getComputedStyle(source);
        const clone = clonedElements[index];

        for (const property of svgProperties) {
          const value = computed.getPropertyValue(property);

          if (value !== '') {
            // The Figma wrapper already carries the root element's opacity.
            (clone as SVGElement).style.setProperty(property, index === 0 && property === 'opacity' ? '1' : value);
          }
        }
      });
      node.svg = new XMLSerializer().serializeToString(svgClone);
      try {
        const svgStr = node.svg;
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const canvas = document.createElement('canvas');
        const scale = 2;

        canvas.width = Math.max(rect.width * scale, 1);
        canvas.height = Math.max(rect.height * scale, 1);
        const ctx = canvas.getContext('2d')!;
        const img = new Image();
        let dataUrl: string;

        try {
          img.src = svgUrl;
          await img.decode();
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/png');
        } finally {
          URL.revokeObjectURL(svgUrl);
        }

        if (dataUrl) {
          node.image = dataUrl;
          console.info('🎨 SVG rasterized:', Math.round(rect.width) + 'x' + Math.round(rect.height));
        }
      } catch (e) {
        console.info('⚠️ SVG rasterization failed:', (e as Error).message);
      }

      return node;
    }

    // Replaced media elements do not display their fallback DOM children.
    if (el.tagName === 'CANVAS' || el.tagName === 'VIDEO') {
      return node;
    }

    for (const child of Array.from(el.children)) {
      const childNode = await walk(child);

      if (childNode) {
        if (Array.isArray(childNode)) {
          node.children.push(...childNode);
        } else {
          node.children.push(childNode);
        }
      }
    }

    // Extract direct text nodes from mixed-content frames
    if (type === 'frame') {
      for (let tni = 0; tni < el.childNodes.length; tni++) {
        const tn = el.childNodes[tni];

        if (tn.nodeType === 3) {
          const tnRawText = tn.textContent || '';
          const isEmojiNeighbor = [tn.previousSibling, tn.nextSibling].some(sibling =>
            sibling?.nodeType === 1 && (sibling as Element).hasAttribute('data-html2figma-emoji'),
          );
          const tnText = preserveWhitespace ? tnRawText : isEmojiNeighbor
            ? tnRawText.replace(/\u00A0/g, ' ').replace(/[ \t\f\v]+/g, ' ')
            : tnRawText.replace(/\u00A0/g, ' ')
              .split('\n')
              .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
              .filter(Boolean)
              .join('\n');

          if (tnText) {
            const captured = captureSynthetic ? captureSyntheticText(tn, style) : null;

            if (captured !== null) {
              node.children.push(captured);
              continue;
            }
            const range = document.createRange();

            range.selectNodeContents(tn);
            const measuredRect = range.getBoundingClientRect();
            // Font leading above the scrollable document must not move the page origin.
            const textTop = Math.max(measuredRect.top, -window.scrollY);
            const tnRect = new DOMRect(measuredRect.left, textTop,
              measuredRect.width, measuredRect.bottom - textTop);

            if (tnRect.width > 0 && tnRect.height > 0) {
              const cssFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
              const textIR = computeFigmaIR('text', style, false);

              textIR.isAbsolute = false;
              delete textIR.absoluteConstraints;

              node.children.push(scaleTextMetrics({
                type: 'text',
                name: tnText.substring(0, 24),
                x: tnRect.left + window.scrollX,
                y: tnRect.top + window.scrollY,
                width: tnRect.width,
                height: tnRect.height,
                text: tnText,
                svg: null,
                styles: {
                  color: style.color,
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  fontFamily: style.fontFamily,
                  fontStyle: style.fontStyle,
                  fontVariantLigatures: style.fontVariantLigatures,
                  fontFeatureSettings: style.fontFeatureSettings,
                  textAlign: style.textAlign,
                  lineHeight: style.lineHeight,
                  letterSpacing: style.letterSpacing,
                },
                tagName: el.tagName,
                fontSource: resolveFontSource(style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, tnText),
                fontSources: resolveFontSources(style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, tnText),
                children: [],
                textMetrics: (() => {
                  const metrics = measureTextMetrics(tnText, cssFont);

                  return {
                    ...metrics,
                    baselineOffset: metrics.ascent,
                    characterPositions: measureCharacterPositions(tn, tnText, tnRect, metrics.ascent),
                  };
                })(),
                ir: textIR,
              }, el));
            }
          }
        }
      }
    }

    assembleCollapsedBorders(el, node);

    return node;
  };

  // Color emoji cannot be represented by monochrome font outlines. Keep each grapheme
  // as a browser-rendered image while leaving the surrounding text editable.
  const emojiReplacements: Array<{ original: Text; replacements: Node[] }> = [];
  const emojiTransitionStyles = new Map<HTMLElement, string | null>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const textWalker = document.createTreeWalker(document.body, 4);
  const emojiTextNodes: Text[] = [];

  while (textWalker.nextNode()) {
    const text = textWalker.currentNode as Text;

    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text.data) &&
        text.parentElement?.closest('script, style, textarea, svg, canvas') === null) {
      emojiTextNodes.push(text);
    }
  }
  for (const original of emojiTextNodes) {
    const parent = original.parentElement;

    if (parent === null) {
      continue;
    }
    const style = window.getComputedStyle(parent);

    // Measure in local CSS pixels, then bake the composed linear transform into the image.
    let ancestor: Element | null = parent;
    let transform = new DOMMatrix();
    const transformed: Array<{ element: HTMLElement; cssText: string }> = [];

    while (ancestor !== null) {
      const computed = window.getComputedStyle(ancestor);

      if (computed.transform !== 'none' && ancestor instanceof window.HTMLElement) {
        transform = new DOMMatrix(computed.transform).multiply(transform);
        transformed.push({ element: ancestor, cssText: ancestor.getAttribute('style') ?? '' });
        if (!emojiTransitionStyles.has(ancestor)) {
          emojiTransitionStyles.set(ancestor, ancestor.getAttribute('style'));
        }
      }
      ancestor = ancestor.parentElement;
    }
    if (style.writingMode !== 'horizontal-tb' || style.direction !== 'ltr' || !transform.is2D) {
      continue;
    }
    const replacements: Node[] = [];
    let pendingText = '';

    for (const { segment, index } of segmenter.segment(original.data)) {
      if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) {
        pendingText += segment;
        continue;
      }
      if (pendingText !== '') {
        replacements.push(document.createTextNode(pendingText));
        pendingText = '';
      }
      const range = document.createRange();

      range.setStart(original, index);
      range.setEnd(original, index + segment.length);
      let rect: DOMRect;

      try {
        for (const { element } of transformed) {
          element.style.setProperty('transition', 'none', 'important');
          element.style.setProperty('transform', 'none', 'important');
        }
        rect = range.getBoundingClientRect();
      } finally {
        for (const { element, cssText } of transformed) {
          if (cssText === '') {
            element.removeAttribute('style');
          } else {
            element.setAttribute('style', cssText);
          }
          // Keep transitions disabled until extraction finishes: restoring transform
          // with a transition would measure an intermediate, partly rotated box.
          element.style.setProperty('transition', 'none', 'important');
        }
      }
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (context === null || rect.width <= 0 || rect.height <= 0) {
        replacements.push(document.createTextNode(segment));
        continue;
      }
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

      context.font = font;
      const metrics = context.measureText(segment);
      const ascent = metrics.fontBoundingBoxAscent;
      const height = rect.height;
      const scale = Math.max(2, window.devicePixelRatio);
      const wrapper = document.createElement('span');
      const placeholder = document.createElement('span');

      canvas.width = Math.ceil(rect.width * scale);
      canvas.height = Math.ceil(height * scale);
      canvas.style.cssText = `position:absolute;left:0;top:0;width:${rect.width}px;height:${height}px;` +
        'margin:0;padding:0;border:0;';
      canvas.setAttribute('aria-label', segment);
      if (transformed.length > 0) {
        emojiTransforms.set(canvas, transform);
      }
      wrapper.style.cssText = 'display:inline;position:relative;margin:0;padding:0;border:0;';
      wrapper.setAttribute('data-html2figma-emoji', '');
      // Hidden native text preserves fallback-font line metrics and the inline baseline.
      placeholder.style.visibility = 'hidden';
      placeholder.textContent = segment;
      wrapper.append(placeholder, canvas);
      context.scale(scale, scale);
      context.font = font;
      context.fillStyle = style.color;
      context.fillText(segment, 0, ascent);
      replacements.push(wrapper);
    }
    if (pendingText !== '') {
      replacements.push(document.createTextNode(pendingText));
    }
    original.replaceWith(...replacements);
    emojiReplacements.push({ original, replacements });
  }
  let sceneResult: WalkResult;

  try {
    sceneResult = await walk(document.body);
  } finally {
    for (const { original, replacements } of emojiReplacements) {
      replacements[0]?.parentNode?.insertBefore(original, replacements[0]);
      for (const replacement of replacements) {
        replacement.parentNode?.removeChild(replacement);
      }
    }
    for (const [element, style] of emojiTransitionStyles) {
      // Commit the restored transform before re-enabling its transition.
      element.getBoundingClientRect();
      if (style === null) {
        element.removeAttribute('style');
      } else {
        element.setAttribute('style', style);
      }
    }
  }

  let scene: SceneNode;
  const rootIR: FigmaIR = {
    figmaType: 'FRAME',
    opacity: 1,
    isAbsolute: false,
    fills: [],
    effects: [],
    clipsContent: false,
    flexGrow: 0,
  };

  if (sceneResult === null) {
    scene = {
      type: 'frame',
      name: 'root',
      x: 0,
      y: 0,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      text: null,
      svg: null,
      styles: {},
      children: [],
      backgroundImage: null,
      ir: rootIR,
    };
  } else if (Array.isArray(sceneResult)) {
    scene = {
      type: 'frame',
      name: 'root',
      x: 0,
      y: 0,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      text: null,
      svg: null,
      styles: {},
      children: sceneResult,
      backgroundImage: null,
      ir: rootIR,
    };
  } else {
    scene = sceneResult;
    scene.width = document.documentElement.scrollWidth;
    scene.height = document.documentElement.scrollHeight;
  }

  return scene;
}
