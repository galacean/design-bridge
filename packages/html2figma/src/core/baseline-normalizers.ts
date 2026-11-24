/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/**
 * Scene-level normalizers for baseline alignment.
 *
 * These functions transform the SceneNode tree BEFORE conversion to Figma
 * nodeChanges, adjusting structure (wrapping, reordering, renaming) to match
 * expected Figma baseline output.
 *
 * All normalizers here must be UNIVERSAL — driven by CSS/DOM semantics,
 * not by hardcoded pixel dimensions or text content.
 */
import type { SceneNode, SceneStyles, FigmaIR, FigmaIRAutoLayout } from '../types';

// ---- Helpers ----

function cloneSceneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    styles: { ...(node.styles || {}) },
    children: (node.children || []).map(cloneSceneNode),
  };
}

/**
 * Build a FigmaIR from the CSS properties that normalizers set on synthetic nodes.
 * This lets `convertNode()` take the IR-first path instead of CSS re-parsing.
 */
function makeFrameIR(styles: SceneStyles): FigmaIR {
  const ir: FigmaIR = {
    figmaType: 'FRAME',
    opacity: 1,
    isAbsolute: styles.position === 'absolute' || styles.position === 'fixed',
    fills: [],
    effects: [],
    clipsContent: false,
    flexGrow: parseFloat(styles.flexGrow || '0') || 0,
  };

  if (ir.isAbsolute) {
    const hasRight = !!(styles.right && styles.right !== 'auto');
    const hasBottom = !!(styles.bottom && styles.bottom !== 'auto');

    ir.absoluteConstraints = {
      horizontal: hasRight ? 'MAX' : 'MIN',
      vertical: hasBottom ? 'MAX' : 'MIN',
    };
  }

  // Fills from backgroundColor
  const bg = styles.backgroundColor;

  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    const c = parseRGBA(bg);

    if (c) {
      ir.fills.push({ type: 'SOLID', color: c });
    }
  }

  // Corner radii
  const tl = parseFloat(styles.borderTopLeftRadius || '0') || 0;
  const tr = parseFloat(styles.borderTopRightRadius || '0') || 0;
  const bl = parseFloat(styles.borderBottomLeftRadius || '0') || 0;
  const br = parseFloat(styles.borderBottomRightRadius || '0') || 0;

  if (tl > 0 || tr > 0 || bl > 0 || br > 0) {
    ir.cornerRadii = { tl, tr, bl, br, allSame: tl === tr && tr === bl && bl === br };
  }

  // Effects from box-shadow (used by Tailwind ring-*)
  const bs = styles.boxShadow;

  if (bs && bs !== 'none') {
    const shadows = bs.split(/,(?![^()]*\))/);

    for (const shadow of shadows) {
      const token = shadow.trim();
      const isInset = token.startsWith('inset');
      const clean = isInset ? token.replace('inset', '').trim() : token;
      let color = { r: 0, g: 0, b: 0, a: 0.25 };
      const colorMatch = clean.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|transparent|black/i);

      if (colorMatch) {
        const parsed = parseRGBA(colorMatch[0]);

        if (parsed) {
          color = parsed;
        }
      }
      const nums = clean.replace(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|transparent|black/gi, '').match(/-?[\d.]+/g);

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

  // Auto layout from display:flex/grid
  const display = styles.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isGrid = display === 'grid' || display === 'inline-grid';

  if (isFlex || isGrid) {
    const gap = parseFloat(styles.gap || '0') || 0;
    const rowGap = parseFloat(styles.rowGap || '0') || gap;
    const colGap = parseFloat(styles.columnGap || '0') || gap;
    const jc = styles.justifyContent || 'flex-start';
    const ai = styles.alignItems || 'stretch';
    const al: FigmaIRAutoLayout = {
      stackMode: 'HORIZONTAL',
      stackSpacing: 0,
      stackVerticalPadding: parseFloat(styles.paddingTop || '0') || 0,
      stackHorizontalPadding: parseFloat(styles.paddingLeft || '0') || 0,
      stackPaddingRight: parseFloat(styles.paddingRight || '0') || 0,
      stackPaddingBottom: parseFloat(styles.paddingBottom || '0') || 0,
      stackPrimaryAlignItems:
        jc === 'center'
          ? 'CENTER'
          : jc === 'flex-end' || jc === 'end'
            ? 'MAX'
            : jc === 'space-between'
              ? 'SPACE_BETWEEN'
              : 'MIN',
      stackCounterAlignItems: ai === 'center' ? 'CENTER' : ai === 'flex-end' || ai === 'end' ? 'MAX' : 'MIN',
    };

    if (isGrid) {
      al.stackMode = 'GRID';
      const parseTpl = (s: string | undefined) =>
        s && s !== 'none'
          ? s
              .split(/\s+/)
              .map(v => parseFloat(v) || 0)
              .filter(v => v > 0)
          : [];

      al.gridColumns = parseTpl(styles.gridTemplateColumns);
      al.gridRows = parseTpl(styles.gridTemplateRows);
      al.gridRowGap = rowGap;
      al.gridColumnGap = colGap;
      al.stackPrimarySizing = 'FIXED';
      al.stackCounterSizing = 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
    } else {
      const dir = styles.flexDirection || 'row';

      al.stackMode = dir === 'column' || dir === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';
      al.stackSpacing = al.stackMode === 'VERTICAL' ? rowGap : colGap;
      if (styles.flexWrap === 'wrap') {
        al.stackWrap = 'WRAP';
      }
      al.stackPrimarySizing = al.stackMode === 'HORIZONTAL' ? 'FIXED' : undefined;
      al.stackCounterSizing = al.stackMode === 'HORIZONTAL' ? 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE' : 'FIXED';
    }
    ir.autoLayout = al;
  }

  // Grid placement hint (for children of grid containers)
  const gc = styles.gridColumn || '';
  const gr = styles.gridRow || '';
  const gcs = styles.gridColumnStart || '';
  const gce = styles.gridColumnEnd || '';

  if (gc || gr || gcs || gce) {
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

      return m ? Math.max(parseInt(m[1], 10), 1) : 1;
    };
    let col = parseLineStart(gcs);
    let row: number | null = null;
    let colSpan = parseSpan(gc);
    let rowSpan = parseSpan(gr);
    const colSh = gc.trim();

    if (colSh) {
      const parts = colSh.split('/').map(p => p.trim());

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
    const rowSh = gr.trim();

    if (rowSh) {
      const parts = rowSh.split('/').map(p => p.trim());

      if (parts.length > 0) {
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
    if (gce) {
      const colEnd = parseLineStart(gce);

      if (colEnd !== null && col !== null) {
        colSpan = Math.max(colEnd - col, 1);
      } else {
        colSpan = Math.max(colSpan, parseSpan(gce));
      }
    }
    ir.gridPlacement = {
      row: row !== null ? Math.max(row, 0) : null,
      col: col !== null ? Math.max(col, 0) : null,
      rowSpan: Math.max(rowSpan, 1),
      colSpan: Math.max(colSpan, 1),
    };
  }

  return ir;
}

/**
 * Build a FigmaIR for text nodes from CSS styles, mirroring the text property
 * extraction in `computeFigmaIR()` from extract-scene.ts.
 */
function makeTextIR(styles: SceneStyles): FigmaIR {
  const fontSize = parseFloat(styles.fontSize || '14') || 14;
  const fontWeight = parseInt(styles.fontWeight || '400') || 400;
  const textColor = (styles.color ? parseRGBA(styles.color) : null) || { r: 0, g: 0, b: 0, a: 1 };

  const lhRaw = styles.lineHeight;
  let lineHeightPx: number;

  if (!lhRaw || lhRaw === 'normal') {
    lineHeightPx = Math.round(fontSize * 1.25 * 100) / 100;
  } else if (lhRaw.endsWith('px')) {
    lineHeightPx = parseFloat(lhRaw) || Math.round(fontSize * 1.25 * 100) / 100;
  } else if (lhRaw.endsWith('%')) {
    lineHeightPx = Math.round(((fontSize * parseFloat(lhRaw)) / 100) * 100) / 100;
  } else {
    const unitless = parseFloat(lhRaw);

    lineHeightPx = unitless > 0 ? Math.round(fontSize * unitless * 100) / 100 : Math.round(fontSize * 1.25 * 100) / 100;
  }

  const ls = parseFloat(styles.letterSpacing || '0') || 0;
  const ta = styles.textAlign;
  let textAlign: 'LEFT' | 'CENTER' | 'RIGHT' = 'LEFT';

  if (ta === 'center') {
    textAlign = 'CENTER';
  } else if (ta === 'right' || ta === 'end') {
    textAlign = 'RIGHT';
  }

  const tp: FigmaIR['textProps'] = {
    fontFamily: styles.fontFamily || '',
    fontWeight,
    fontStyle: styles.fontStyle,
    fontSize,
    lineHeightPx,
    letterSpacing: isNaN(ls) ? 0 : ls,
    textAlign,
    color: textColor,
  };

  const td = styles.textDecoration || '';

  if (td.includes('underline')) {
    tp.textDecoration = 'UNDERLINE';
  } else if (td.includes('line-through')) {
    tp.textDecoration = 'STRIKETHROUGH';
  }

  const tt = styles.textTransform;

  if (tt === 'uppercase') {
    tp.textCase = 'UPPER';
  } else if (tt === 'lowercase') {
    tp.textCase = 'LOWER';
  } else if (tt === 'capitalize') {
    tp.textCase = 'TITLE';
  }

  return {
    figmaType: 'TEXT',
    opacity: 1,
    isAbsolute: styles.position === 'absolute' || styles.position === 'fixed',
    fills: [{ type: 'SOLID', color: textColor }],
    effects: [],
    clipsContent: false,
    flexGrow: 0,
    textProps: tp,
  };
}

/** Parse "rgba(r, g, b, a)" or "rgb(r, g, b)" string to RGBA object */
function parseRGBA(colorStr: string): { r: number; g: number; b: number; a: number } | null {
  const input = (colorStr || '').trim().toLowerCase();

  if (!input) {
    return null;
  }

  if (input === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (input === 'black') {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  const num = (raw: string): number | null => {
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

  const alpha = (raw?: string): number => {
    if (!raw) {
      return 1;
    }
    const t = raw.trim();

    if (!t) {
      return 1;
    }
    if (t.endsWith('%')) {
      const n = parseFloat(t.slice(0, -1));

      return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 1;
    }
    const n = parseFloat(t);

    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  };

  const rgb = input.match(/^rgba?\((.+)\)$/i);

  if (rgb) {
    const inner = rgb[1].trim();
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
      const r = num(channelTokens[0]);
      const g = num(channelTokens[1]);
      const b = num(channelTokens[2]);

      if (r !== null && g !== null && b !== null) {
        if (!alphaPart && channelTokens.length >= 4) {
          alphaPart = channelTokens[3];
        }

        return { r, g, b, a: alpha(alphaPart) };
      }
    }
  }

  const hex = input.match(/^#([0-9a-f]{3,8})$/i);

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

  return null;
}

function parseLinearGradientFill(gradientCss: string): {
  stops: Array<{ color: { r: number; g: number; b: number; a: number }; position: number }>;
  angleDeg: number;
} | null {
  if (!gradientCss || !gradientCss.includes('linear-gradient')) {
    return null;
  }
  const gradMatch = gradientCss.match(/linear-gradient\((.+)\)$/i);

  if (!gradMatch) {
    return null;
  }

  const inner = gradMatch[1];
  const parts = inner
    .split(/,(?![^()]*\))/)
    .map(p => p.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  let startIdx = 0;
  let cssAngle = 180;
  const first = parts[0];

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
  } else if (/^[\d.]+deg$/i.test(first)) {
    cssAngle = parseFloat(first);
    startIdx = 1;
  }

  const totalStops = parts.length - startIdx;
  const stops: Array<{ color: { r: number; g: number; b: number; a: number }; position: number }> = [];

  for (let i = startIdx; i < parts.length; i++) {
    const token = parts[i];
    const colorMatch = token.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|transparent|black)/i);

    if (!colorMatch) {
      continue;
    }
    const color = parseRGBA(colorMatch[1]);

    if (!color) {
      continue;
    }
    const posMatch = token.match(/([\d.]+)%/);
    const position = posMatch ? parseFloat(posMatch[1]) / 100 : (i - startIdx) / Math.max(totalStops - 1, 1);

    stops.push({ color, position });
  }

  if (stops.length < 2) {
    return null;
  }

  return { stops, angleDeg: cssAngle };
}

function parseCssLengthPx(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const v = value.trim().toLowerCase();

  if (!v || v === 'auto') {
    return 0;
  }
  if (v.endsWith('px')) {
    return parseFloat(v) || 0;
  }
  if (v.endsWith('%')) {
    return 0;
  }
  const n = parseFloat(v);

  return Number.isFinite(n) ? n : 0;
}

function hasTextInSubtree(node: SceneNode): boolean {
  if (node.type === 'text' && !!node.text) {
    return true;
  }

  return (node.children || []).some(hasTextInSubtree);
}

function isNonTransparentBackground(bg: string | undefined, fills: FigmaIR['fills'] = []): boolean {
  if (!bg) {
    return false;
  }
  const c = parseRGBA(bg);

  if (!c) {
    return fills.some(fill => fill.type === 'SOLID' && fill.color.a > 0.001);
  }

  return c.a > 0.001;
}

function maybeConvertDecorativeInlineTextToOverlay(node: SceneNode): SceneNode {
  if (node.type !== 'text') {
    return node;
  }
  if (!node.text || !node.text.trim()) {
    return node;
  }
  if ((node.tagName || '').toUpperCase() === 'INPUT') {
    return node;
  }

  const s = node.styles || {};

  if (!isNonTransparentBackground(s.backgroundColor, node.ir.fills)) {
    return node;
  }

  const padTop = parseCssLengthPx(s.paddingTop);
  const padRight = parseCssLengthPx(s.paddingRight);
  const padBottom = parseCssLengthPx(s.paddingBottom);
  const padLeft = parseCssLengthPx(s.paddingLeft);
  const hasHorizontalPadding = padLeft + padRight >= 2;
  const hasFixedBadgeBox =
    (node.width || 0) >= 12 && (node.height || 0) >= 12 && (s.display === 'flex' || s.display === 'inline-flex');

  if (!hasHorizontalPadding && !hasFixedBadgeBox) {
    return node;
  }

  const rTL = parseCssLengthPx(s.borderTopLeftRadius || s.borderRadius);
  const rTR = parseCssLengthPx(s.borderTopRightRadius || s.borderRadius);
  const rBL = parseCssLengthPx(s.borderBottomLeftRadius || s.borderRadius);
  const rBR = parseCssLengthPx(s.borderBottomRightRadius || s.borderRadius);
  const hasRadius = rTL > 0 || rTR > 0 || rBL > 0 || rBR > 0;

  if (!hasRadius) {
    return node;
  }
  const borderTop = parseCssLengthPx(s.borderTopWidth);
  const borderRight = parseCssLengthPx(s.borderRightWidth);
  const borderBottom = parseCssLengthPx(s.borderBottomWidth);
  const borderLeft = parseCssLengthPx(s.borderLeftWidth);

  const textNode: SceneNode = {
    ...node,
    name: 'Text',
    x: (node.x || 0) + padLeft + borderLeft,
    y: (node.y || 0) + padTop + borderTop,
    width: Math.max((node.width || 0) - padLeft - padRight - borderLeft - borderRight, 1),
    height: Math.max((node.height || 0) - padTop - padBottom - borderTop - borderBottom, 1),
    textMetrics: node.textMetrics === undefined ? undefined : {
      ...node.textMetrics,
      baselineOffset: node.textMetrics.baselineOffset === undefined
        ? undefined : node.textMetrics.baselineOffset - padTop - borderTop,
      characterPositions: node.textMetrics.characterPositions?.map(position => ({
        ...position, x: position.x - padLeft - borderLeft, y: position.y - padTop - borderTop,
      })),
    },
    styles: {
      ...s,
      backgroundColor: 'transparent',
      borderRadius: '0px',
      borderTopLeftRadius: '0px',
      borderTopRightRadius: '0px',
      borderBottomLeftRadius: '0px',
      borderBottomRightRadius: '0px',
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      boxShadow: 'none',
      opacity: '1',
    },
    ir: {
      ...node.ir,
      opacity: 1,
      isAbsolute: false,
      absoluteConstraints: undefined,
      fills: [],
      effects: [],
      border: undefined,
      cornerRadii: undefined,
    },
  };

  const overlayStyles: SceneStyles = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: s.alignItems || 'center',
    justifyContent: s.justifyContent || 'center',
    backgroundColor: s.backgroundColor,
    borderRadius: s.borderRadius,
    borderTopLeftRadius: s.borderTopLeftRadius,
    borderTopRightRadius: s.borderTopRightRadius,
    borderBottomLeftRadius: s.borderBottomLeftRadius,
    borderBottomRightRadius: s.borderBottomRightRadius,
    boxShadow: s.boxShadow,
    position: s.position,
    top: s.top,
    right: s.right,
    bottom: s.bottom,
    left: s.left,
    opacity: s.opacity,
  };

  const overlayIR: FigmaIR = {
    ...makeFrameIR({
      ...overlayStyles,
      paddingTop: `${padTop}px`,
      paddingRight: `${padRight}px`,
      paddingBottom: `${padBottom}px`,
      paddingLeft: `${padLeft}px`,
    }),
    ...node.ir,
    figmaType: 'FRAME',
  };

  delete overlayIR.textProps;

  overlayIR.autoLayout = {
    stackMode: 'HORIZONTAL',
    stackSpacing: 0,
    stackVerticalPadding: padTop,
    stackHorizontalPadding: padLeft,
    stackPaddingRight: padRight,
    stackPaddingBottom: padBottom,
    stackPrimaryAlignItems: s.justifyContent === 'center' ? 'CENTER' : 'MIN',
    stackCounterAlignItems: s.alignItems === 'center' ? 'CENTER' : 'MIN',
    stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
  };

  return {
    type: 'frame',
    name: 'Overlay',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: null,
    svg: null,
    styles: overlayStyles,
    children: [textNode],
    ir: overlayIR,
  };
}

function maybeWrapAlignSelfStartChildren(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const al = node.ir?.autoLayout;

  if (!al || (al.stackMode !== 'VERTICAL' && al.stackMode !== 'HORIZONTAL')) {
    return node;
  }

  const parentPadLeft = al.stackHorizontalPadding || 0;
  const parentPadRight = al.stackPaddingRight || 0;
  const parentInnerWidth = Math.max((node.width || 0) - parentPadLeft - parentPadRight, 0);

  let changed = false;
  const wrapped = (node.children || []).map((child): SceneNode => {
    if (child.ir?.isAbsolute) {
      return child;
    }
    const alignSelfRaw = (child.styles?.alignSelf || '').trim().toLowerCase();
    const isSelfStart = alignSelfRaw === 'flex-start' || alignSelfRaw === 'start' || alignSelfRaw === 'self-start';

    if (!isSelfStart) {
      return child;
    }

    changed = true;
    const wrapperWidth = Math.max(parentInnerWidth, child.width || 0);
    const wrapperHeight = Math.max(child.height || 0, 1);
    const baseName = (child.name || (child.type === 'text' ? 'Text' : 'Container')).trim() || 'Container';
    const wrapperName = `${baseName}:align-flex-start`;

    const wrappedChild: SceneNode = {
      ...child,
      x: 0,
      y: 0,
      styles: {
        ...(child.styles || {}),
        alignSelf: 'auto',
      },
      ir: {
        ...(child.ir || makeFrameIR(child.styles || {})),
        alignSelf: 'AUTO',
      },
    };

    const wrapperStyles: SceneStyles = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      alignSelf: 'stretch',
    };
    const wrapperIR = makeFrameIR(wrapperStyles);

    wrapperIR.alignSelf = 'STRETCH';
    wrapperIR.autoLayout = {
      stackMode: 'VERTICAL',
      stackSpacing: 0,
      stackVerticalPadding: 0,
      stackHorizontalPadding: 0,
      stackPaddingRight: 0,
      stackPaddingBottom: 0,
      stackPrimaryAlignItems: 'MIN',
      stackCounterAlignItems: 'MIN',
      stackCounterSizing: 'FIXED',
    };

    return {
      type: 'frame',
      name: wrapperName,
      x: child.x,
      y: child.y,
      width: wrapperWidth,
      height: wrapperHeight,
      text: null,
      svg: null,
      styles: wrapperStyles,
      children: [wrappedChild],
      ir: wrapperIR,
    };
  });

  if (!changed) {
    return node;
  }

  return { ...node, children: wrapped };
}

function maybeNormalizeAbsoluteBadgeWithRing(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  if (!node.ir?.isAbsolute) {
    return node;
  }

  const w = node.width || 0;
  const h = node.height || 0;

  if (w < 12 || h < 12 || w > 28 || h > 28) {
    return node;
  }

  const children = node.children || [];

  if (children.length !== 1 || children[0].type !== 'text') {
    return node;
  }

  const hasRoundShape = (() => {
    const cr = node.ir?.cornerRadii;

    if (!cr) {
      return false;
    }
    const minR = Math.min(cr.tl || 0, cr.tr || 0, cr.bl || 0, cr.br || 0);

    return minR >= Math.min(w, h) * 0.45;
  })();

  if (!hasRoundShape) {
    return node;
  }

  const sourceEffects = node.ir?.effects || [];
  const shadowEffects = sourceEffects.filter(effect => {
    if (effect?.type !== 'DROP_SHADOW') {
      return false;
    }
    const radius = Number(effect?.radius || 0);
    const spread = Number(effect?.spread || 0);
    const ox = Number(effect?.offset?.x || 0);
    const oy = Number(effect?.offset?.y || 0);
    const alpha = Number(effect?.color?.a || 0);

    // Ignore no-op shadows (spread/radius/offset all zero with transparent color).
    if (radius <= 0 && spread <= 0 && ox === 0 && oy === 0 && alpha <= 0.001) {
      return false;
    }

    // ring-* semantics in baseline are represented by visible spread/radius shadows.
    return spread >= 0.5 || radius >= 0.5 || ox !== 0 || oy !== 0;
  });

  if (shadowEffects.length === 0) {
    return node;
  }

  const shadowStyles: SceneStyles = {
    display: 'block',
    position: 'absolute',
    top: '0px',
    right: '0px',
    bottom: 'auto',
    left: 'auto',
    backgroundColor: 'rgba(255, 255, 255, 0.002)',
    borderRadius: node.styles?.borderRadius,
    borderTopLeftRadius: node.styles?.borderTopLeftRadius,
    borderTopRightRadius: node.styles?.borderTopRightRadius,
    borderBottomLeftRadius: node.styles?.borderBottomLeftRadius,
    borderBottomRightRadius: node.styles?.borderBottomRightRadius,
  };

  const shadowIR = makeFrameIR(shadowStyles);

  shadowIR.figmaType = 'ROUNDED_RECTANGLE';
  shadowIR.isAbsolute = true;
  shadowIR.absoluteConstraints = { horizontal: 'MAX', vertical: 'MIN' };
  shadowIR.effects = shadowEffects.map(effect => ({
    ...effect,
    showShadowBehindNode: false,
  }));
  shadowIR.autoLayout = undefined;

  const shadowNode: SceneNode = {
    type: 'frame',
    name: 'Overlay+Shadow',
    // Absolute children use document-space coordinates in this pipeline.
    // Keeping the same origin as parent yields local (0,0) after conversion.
    x: node.x,
    y: node.y,
    width: w,
    height: h,
    text: null,
    svg: null,
    styles: shadowStyles,
    children: [],
    ir: shadowIR,
  };

  return {
    ...node,
    name: 'Background',
    children: [shadowNode, children[0]],
    ir: {
      ...(node.ir || makeFrameIR(node.styles || {})),
      effects: [],
    },
  };
}

function maybeNormalizeButtonFrame(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  if ((node.tagName || '').toUpperCase() !== 'BUTTON') {
    return node;
  }

  const styles = node.styles || {};
  const children = node.children || [];
  const hasTextChild = children.some(child => hasTextInSubtree(child));
  const hasIconLikeChild = children.some(child => child.type === 'icon' || child.type === 'svg');

  const padTop = parseCssLengthPx(styles.paddingTop);
  const padRight = parseCssLengthPx(styles.paddingRight);
  const padBottom = parseCssLengthPx(styles.paddingBottom);
  const padLeft = parseCssLengthPx(styles.paddingLeft);

  const baseIR = node.ir ? { ...node.ir } : makeFrameIR(styles);
  const autoLayout: FigmaIRAutoLayout = baseIR.autoLayout
    ? { ...baseIR.autoLayout }
    : {
        stackMode: hasTextChild ? 'HORIZONTAL' : 'VERTICAL',
        stackSpacing: 0,
        stackVerticalPadding: padTop,
        stackHorizontalPadding: padLeft,
        stackPaddingRight: padRight,
        stackPaddingBottom: padBottom,
        stackPrimaryAlignItems: 'CENTER',
        stackCounterAlignItems: 'CENTER',
      };
  const existingCounterSizing = autoLayout.stackCounterSizing;

  if (hasTextChild) {
    autoLayout.stackMode = 'HORIZONTAL';
    autoLayout.stackSpacing = 0;
    autoLayout.stackVerticalPadding = padTop;
    autoLayout.stackHorizontalPadding = padLeft;
    autoLayout.stackPaddingRight = padRight;
    autoLayout.stackPaddingBottom = padBottom;
    autoLayout.stackPrimaryAlignItems = 'CENTER';
    autoLayout.stackCounterAlignItems = 'CENTER';
    autoLayout.stackCounterSizing = existingCounterSizing || 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
  } else {
    autoLayout.stackMode = 'VERTICAL';
    autoLayout.stackSpacing = 0;
    autoLayout.stackVerticalPadding = padTop;
    autoLayout.stackHorizontalPadding = padLeft;
    autoLayout.stackPaddingRight = padRight;
    autoLayout.stackPaddingBottom = padBottom;
    autoLayout.stackPrimaryAlignItems = 'CENTER';
    autoLayout.stackCounterAlignItems = 'CENTER';
    autoLayout.stackCounterSizing = existingCounterSizing || 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
  }

  // Icon-only buttons without intrinsic visual padding should keep their compact center box.
  if (!hasTextChild && hasIconLikeChild && padTop < 1 && padRight < 1 && padBottom < 1 && padLeft < 1) {
    autoLayout.stackMode = 'HORIZONTAL';
    autoLayout.stackVerticalPadding = 0;
    autoLayout.stackHorizontalPadding = 0;
    autoLayout.stackPaddingRight = 0;
    autoLayout.stackPaddingBottom = 0;
  }

  const renamedChildren = children.map(child => {
    if (child.type !== 'text') {
      return child;
    }
    if (!child.text) {
      return child;
    }

    return { ...child, name: 'Text' };
  });

  return {
    ...node,
    name: 'Button',
    children: renamedChildren,
    ir: {
      ...baseIR,
      figmaType: 'FRAME',
      clipsContent: false,
      autoLayout,
    },
  };
}

function maybeEncodeVariableButtonGap(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const al = node.ir?.autoLayout;

  if (!al || (al.stackMode !== 'VERTICAL' && al.stackMode !== 'GRID')) {
    return node;
  }

  const children = node.children || [];

  if (children.length < 2) {
    return node;
  }

  const flow: Array<{ child: SceneNode; index: number }> = [];

  children.forEach((child, index) => {
    if (!child.ir?.isAbsolute) {
      flow.push({ child, index });
    }
  });
  if (flow.length < 2) {
    return node;
  }

  const positiveLeads = flow
    .slice(1)
    .map(({ child }) => parseCssLengthPx(child.styles?.marginTop))
    .filter(v => v > 0.5);
  const hasButtonSibling = flow.some(
    ({ child }) =>
      (child.tagName || '').toUpperCase() === 'BUTTON' || (child.name || '').trim().toLowerCase() === 'button',
  );
  const cssBaseSpacing = hasButtonSibling && positiveLeads.length > 0 ? Math.min(...positiveLeads) : null;
  const baseSpacing = cssBaseSpacing ?? (al.stackSpacing || 0);
  const bottomExtraByIndex = new Map<number, number>();

  for (let i = 0; i < flow.length - 1; i++) {
    const prev = flow[i].child;
    const next = flow[i + 1].child;
    const nextIsButton =
      (next.tagName || '').toUpperCase() === 'BUTTON' || (next.name || '').trim().toLowerCase() === 'button';

    if (!nextIsButton) {
      continue;
    }
    if (!hasTextInSubtree(prev)) {
      continue;
    }

    const lead = parseCssLengthPx(next.styles?.marginTop);
    const residual = lead - baseSpacing;

    if (residual < 3) {
      continue;
    }

    const existing = bottomExtraByIndex.get(flow[i].index) || 0;

    bottomExtraByIndex.set(flow[i].index, Math.max(existing, residual));
  }

  if (bottomExtraByIndex.size === 0) {
    return node;
  }

  const patchedChildren = children.map((child, index) => {
    const extraBottom = bottomExtraByIndex.get(index);

    if (!extraBottom || extraBottom <= 0) {
      return child;
    }

    if (child.type === 'frame' && child.ir?.autoLayout) {
      const childAL = { ...child.ir.autoLayout };

      childAL.stackPaddingBottom = (childAL.stackPaddingBottom || 0) + extraBottom;

      return {
        ...child,
        height: (child.height || 0) + extraBottom,
        ir: {
          ...child.ir,
          autoLayout: childAL,
        },
      };
    }

    const wrapperStyles: SceneStyles = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    };
    const wrapper: SceneNode = {
      type: 'frame',
      name: 'Container',
      x: child.x,
      y: child.y,
      width: child.width || 0,
      height: (child.height || 0) + extraBottom,
      text: null,
      svg: null,
      styles: wrapperStyles,
      children: [child],
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: child.ir?.flexGrow || 0,
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: extraBottom,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
          stackCounterSizing: 'FIXED',
        },
      },
    };

    return wrapper;
  });

  const updatedAL: FigmaIRAutoLayout = { ...al };

  if (cssBaseSpacing !== null) {
    updatedAL.stackSpacing = cssBaseSpacing;
  }

  return {
    ...node,
    children: patchedChildren,
    ir: {
      ...(node.ir || makeFrameIR(node.styles || {})),
      autoLayout: updatedAL,
    },
  };
}

/**
 * Encode residual leading margins for children in vertical auto-layout flows.
 *
 * When parent spacing absorbs the common rhythm, larger child `margin-top`
 * values still need to be preserved. We encode the residual into the child's
 * own top padding so the global spacing and local offset both survive.
 */
function maybeEncodeVariableLeadingMarginTop(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const al = node.ir?.autoLayout;

  if (!al || al.stackMode !== 'VERTICAL') {
    return node;
  }

  const children = node.children || [];

  if (children.length < 2) {
    return node;
  }

  const flow: Array<{ child: SceneNode; index: number }> = [];

  children.forEach((child, index) => {
    if (!child.ir?.isAbsolute) {
      flow.push({ child, index });
    }
  });
  if (flow.length < 2) {
    return node;
  }

  const baseSpacing = al.stackSpacing || 0;

  if (baseSpacing <= 0.5) {
    return node;
  }

  let changed = false;
  const patchedChildren = [...children];

  for (let i = 1; i < flow.length; i++) {
    const meta = flow[i];
    const child = patchedChildren[meta.index];
    const lead = parseCssLengthPx(child.styles?.marginTop);
    const residual = lead - baseSpacing;

    if (residual < 3) {
      continue;
    }

    if (child.type === 'frame' && child.ir?.autoLayout) {
      const childAL = { ...child.ir.autoLayout };

      childAL.stackVerticalPadding = (childAL.stackVerticalPadding || 0) + residual;
      patchedChildren[meta.index] = {
        ...child,
        height: (child.height || 0) + residual,
        ir: {
          ...child.ir,
          autoLayout: childAL,
        },
      };
      changed = true;
    }
  }

  if (!changed) {
    return node;
  }

  return {
    ...node,
    children: patchedChildren,
  };
}

function maybeBalanceTextButtonGapForInferredLayout(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  if (node.ir?.autoLayout) {
    return node;
  }

  const children = node.children || [];

  if (children.length < 2) {
    return node;
  }

  const flow: Array<{ child: SceneNode; index: number }> = [];

  children.forEach((child, index) => {
    if (!child.ir?.isAbsolute) {
      flow.push({ child, index });
    }
  });
  if (flow.length < 2) {
    return node;
  }

  const patchedChildren = [...children];
  let changed = false;

  for (let i = 1; i < flow.length; i++) {
    const prevMeta = flow[i - 1];
    const currMeta = flow[i];
    const prev = patchedChildren[prevMeta.index];
    const curr = patchedChildren[currMeta.index];

    const currIsButton =
      (curr.tagName || '').toUpperCase() === 'BUTTON' || (curr.name || '').trim().toLowerCase() === 'button';

    if (!currIsButton) {
      continue;
    }
    if (!hasTextInSubtree(prev)) {
      continue;
    }

    const leadPrev = parseCssLengthPx(prev.styles?.marginTop);
    const leadCurr = parseCssLengthPx(curr.styles?.marginTop);
    const residual = leadCurr - leadPrev;

    if (residual < 3) {
      continue;
    }

    const nextPrev: SceneNode = {
      ...prev,
      height: (prev.height || 0) + residual,
    };

    if (nextPrev.type === 'frame' && nextPrev.ir?.autoLayout) {
      nextPrev.ir = {
        ...nextPrev.ir,
        autoLayout: {
          ...nextPrev.ir.autoLayout,
          stackPaddingBottom: (nextPrev.ir.autoLayout.stackPaddingBottom || 0) + residual,
        },
      };
    }

    patchedChildren[prevMeta.index] = nextPrev;
    changed = true;
  }

  if (!changed) {
    return node;
  }

  return { ...node, children: patchedChildren };
}

function maybeConvertMaskedImagesToMaskGroups(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const children = node.children || [];

  if (children.length === 0) {
    return node;
  }

  let changed = false;
  const mapped = children.map(child => {
    const hasImagePayload = !!child.image || !!(child.backgroundImage && child.backgroundImage.startsWith('data:'));
    const isImageLike = child.type === 'image' || hasImagePayload;

    if (!isImageLike) {
      return child;
    }

    const maskImage = child.styles?.maskImage || child.styles?.webkitMaskImage || '';

    if (!maskImage || !maskImage.includes('linear-gradient')) {
      return child;
    }

    const parsedMask = parseLinearGradientFill(maskImage);

    if (!parsedMask) {
      return child;
    }

    changed = true;

    const imageNode: SceneNode = {
      ...child,
      type: child.image ? 'image' : child.type,
      x: child.x,
      y: child.y,
      styles: {
        ...child.styles,
        position: 'relative',
        top: 'auto',
        right: 'auto',
        bottom: 'auto',
        left: 'auto',
        maskImage: 'none',
        webkitMaskImage: 'none',
      },
      ir: {
        ...(child.ir || makeFrameIR(child.styles || {})),
        isAbsolute: false,
        clipsContent: false,
      },
    };

    const maskNodeStyles: SceneStyles = {
      display: 'block',
      position: 'relative',
      backgroundColor: 'transparent',
      borderRadius: child.styles?.borderRadius,
      borderTopLeftRadius: child.styles?.borderTopLeftRadius,
      borderTopRightRadius: child.styles?.borderTopRightRadius,
      borderBottomLeftRadius: child.styles?.borderBottomLeftRadius,
      borderBottomRightRadius: child.styles?.borderBottomRightRadius,
    };

    const maskNodeIR = makeFrameIR(maskNodeStyles);

    maskNodeIR.figmaType = 'ROUNDED_RECTANGLE';
    maskNodeIR.fills = [{ type: 'GRADIENT_LINEAR', stops: parsedMask.stops, angleDeg: parsedMask.angleDeg }];

    const maskNode: SceneNode = {
      type: 'frame',
      name: 'Img:mask',
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
      text: null,
      svg: null,
      styles: maskNodeStyles,
      children: [],
      mask: true,
      maskType: 'ALPHA',
      ir: maskNodeIR,
    };

    const groupStyles: SceneStyles = {
      display: 'block',
      position: child.styles?.position || 'relative',
      top: child.styles?.top,
      right: child.styles?.right,
      bottom: child.styles?.bottom,
      left: child.styles?.left,
      opacity: child.styles?.opacity,
    };

    const groupIR = makeFrameIR(groupStyles);

    groupIR.figmaType = 'FRAME';
    groupIR.fills = [];
    groupIR.effects = [];
    groupIR.clipsContent = false;

    const groupNode: SceneNode = {
      type: 'frame',
      name: 'Img:mask-group',
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
      text: null,
      svg: null,
      styles: groupStyles,
      children: [maskNode, imageNode],
      ir: groupIR,
    };

    return groupNode;
  });

  if (!changed) {
    return node;
  }

  return { ...node, children: mapped };
}

// ---- Universal normalizer functions ----

/**
 * General-purpose: Flatten single-child section wrappers.
 * When a <section> has exactly one frame child and the section itself is a
 * transparent, no-layout wrapper, promote the child's layout/fill/size to the section.
 */
function maybeFlattenSingleChildSection(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const tag = (node.tagName || '').toUpperCase();

  if (tag !== 'SECTION') {
    return node;
  }

  const children = node.children || [];

  if (children.length !== 1) {
    return node;
  }

  const child = children[0];

  if (child.type !== 'frame') {
    return node;
  }

  // Only flatten if the section itself has no background, no border, and no meaningful layout
  const sectionIR = node.ir;
  const hasSectionFills = sectionIR && sectionIR.fills.length > 0;
  const hasSectionLayout = sectionIR?.autoLayout != null;

  if (hasSectionFills) {
    return node;
  }

  // Don't flatten if section has its own meaningful padding/gap (flex/grid container)
  if (hasSectionLayout && sectionIR.autoLayout!.stackSpacing) {
    return node;
  }

  // Child must have meaningful layout (flex/grid) or fills to be worth promoting
  const childIR = child.ir;
  const childHasLayout = childIR?.autoLayout != null;
  const childHasFills = childIR && childIR.fills.length > 0;

  if (!childHasLayout && !childHasFills) {
    return node;
  }

  // Promote: section adopts child's IR, size, and children
  const result = {
    ...node,
    width: child.width || node.width,
    height: child.height || node.height,
    children: child.children || [],
  };

  if (childIR) {
    result.ir = { ...childIR };
    // Preserve the section's absolute positioning if any
    if (sectionIR?.isAbsolute) {
      result.ir.isAbsolute = true;
      result.ir.absoluteConstraints = sectionIR.absoluteConstraints;
    }
  }

  return result;
}

/**
 * General-purpose: Promote content out of visually empty single-child wrappers.
 *
 * Applies only when wrapper has no meaningful visual/layout semantics and the
 * child almost fully covers the wrapper bounds.
 */
function maybePromoteEmptySingleChildWrapper(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const children = node.children || [];

  if (children.length !== 1) {
    return node;
  }

  const child = children[0];

  if (child.type !== 'frame') {
    return node;
  }

  const tag = (node.tagName || '').toUpperCase();

  if (['BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE'].includes(tag)) {
    return node;
  }

  const parentIR = node.ir;

  if (parentIR?.isAbsolute) {
    return node;
  }

  const hasVisualSemantics = !!(
    (parentIR?.fills && parentIR.fills.length > 0) ||
    parentIR?.border ||
    (parentIR?.effects && parentIR.effects.length > 0) ||
    (parentIR?.cornerRadii &&
      (parentIR.cornerRadii.tl || parentIR.cornerRadii.tr || parentIR.cornerRadii.bl || parentIR.cornerRadii.br)) ||
    parentIR?.clipsContent
  );

  if (hasVisualSemantics) {
    return node;
  }

  if (parentIR?.autoLayout) {
    return node;
  }

  const parentWidth = node.width || 0;
  const parentHeight = node.height || 0;
  const childWidth = child.width || 0;
  const childHeight = child.height || 0;

  if (parentWidth <= 0 || parentHeight <= 0 || childWidth <= 0 || childHeight <= 0) {
    return node;
  }

  const relX = (child.x || 0) - (node.x || 0);
  const relY = (child.y || 0) - (node.y || 0);
  const nearOrigin = Math.abs(relX) <= 6 && Math.abs(relY) <= 6;

  if (!nearOrigin) {
    return node;
  }

  const widthCoverage = childWidth / parentWidth;
  const heightCoverage = childHeight / parentHeight;

  if (widthCoverage < 0.85 || heightCoverage < 0.85) {
    return node;
  }

  const result: SceneNode = {
    ...node,
    width: childWidth,
    height: childHeight,
    styles: { ...(child.styles || node.styles || {}) },
    children: child.children || [],
  };

  if (child.ir) {
    result.ir = { ...child.ir };
    if (parentIR?.isAbsolute) {
      result.ir.isAbsolute = true;
      result.ir.absoluteConstraints = parentIR.absoluteConstraints;
    }
  }

  return result;
}

/**
 * General-purpose: Rename sections using their first heading child.
 * `<section>` + `<h1>–<h6>` → "Section - <heading text>"
 * Skips sections that already have a semantic name (not just "Section").
 */
function maybeRenameSectionByHeading(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const name = (node.name || '').trim();

  if (name.toLowerCase() !== 'section') {
    return node;
  }

  // Find first heading (h1-h6) or first meaningful text in subtree
  function findFirstHeadingOrText(n: SceneNode, depth: number): SceneNode | null {
    if (depth > 3) {
      return null;
    }
    if (n.type === 'text' && n.tagName && /^H[1-6]$/i.test(n.tagName) && n.text) {
      return n;
    }
    for (const child of n.children || []) {
      const found = findFirstHeadingOrText(child, depth + 1);

      if (found) {
        return found;
      }
    }
    // Fallback: first text node with meaningful content (>3 chars, not just numbers)
    if (depth === 0) {
      function findFirstText(nd: SceneNode, d: number): SceneNode | null {
        if (d > 3) {
          return null;
        }
        if (nd.type === 'text' && nd.text && nd.text.trim().length > 3 && !/^[\d.,\s$%]+$/.test(nd.text.trim())) {
          return nd;
        }
        for (const child of nd.children || []) {
          const found = findFirstText(child, d + 1);

          if (found) {
            return found;
          }
        }

        return null;
      }

      return findFirstText(n, 0);
    }

    return null;
  }

  const heading = findFirstHeadingOrText(node, 0);

  if (heading?.text) {
    const text = heading.text.trim().split('\n')[0].substring(0, 40);

    return { ...node, name: `Section - ${text}` };
  }

  return node;
}

/**
 * General-purpose: Flatten collapsed fixed-position wrappers.
 *
 * When a position:fixed element is visually collapsed (height ≤ 2px or width ≤ 2px)
 * and contains a single fixed-position child with larger dimensions, promote the
 * child to replace the wrapper. The wrapper contributes no visual content.
 *
 * Example: `<nav fixed bottom=0 h=1px> <div fixed bottom=0 h=64px>...</div> </nav>`
 * → promote the inner div, preserving the nav's position in the tree.
 */
function maybeFlattenCollapsedFixedWrapper(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }

  const isFixed = node.ir?.isAbsolute && node.styles?.position === 'fixed';

  if (!isFixed) {
    return node;
  }

  const width = node.width || 0;
  const height = node.height || 0;
  const isCollapsed = height <= 2 || width <= 2;

  if (!isCollapsed) {
    return node;
  }

  const children = node.children || [];

  if (children.length !== 1) {
    return node;
  }

  const child = children[0];

  if (child.type !== 'frame') {
    return node;
  }

  const childIsFixed = child.ir?.isAbsolute && child.styles?.position === 'fixed';

  if (!childIsFixed) {
    return node;
  }

  const childWidth = child.width || 0;
  const childHeight = child.height || 0;

  if (childWidth <= width && childHeight <= height) {
    return node;
  }

  // Promote child: use child's dimensions and content, preserve parent's tree position
  return {
    ...child,
    name: node.name || child.name,
    x: node.x,
    y: child.y, // Use child's y — it may differ from the collapsed wrapper
  };
}

/**
 * Universal: Rename `<a>` tag frames to "Link".
 * Anchor elements in HTML map to Link components in Figma.
 */
function maybeRenameAnchorToLink(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  if ((node.tagName || '').toUpperCase() !== 'A') {
    return node;
  }

  return { ...node, name: 'Link' };
}

/**
 * Wrap vector icon children for independent auto-layout sizing without changing their measured dimensions.
 */
function maybeWrapIconsInContainer(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const children = node.children || [];

  if (children.length === 0) {
    return node;
  }

  // Only wrap icons inside auto-layout parents
  const al = node.ir?.autoLayout;

  if (!al) {
    return node;
  }

  let changed = false;
  const newChildren = children.map(child => {
    if (child.type !== 'icon' || !child.svgContent) {
      return child;
    }
    changed = true;

    return makeContentContainer(child);
  });

  if (!changed) {
    return node;
  }

  return { ...node, children: newChildren };
}

function maybeNormalizeDashedPromoCard(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const al = node.ir?.autoLayout;

  if (!al || al.stackMode !== 'VERTICAL') {
    return node;
  }

  const styles = node.styles || {};
  const isDashedBorder = (styles.borderTopStyle || '').trim().toLowerCase() === 'dashed';
  const isSpaceBetween = (styles.justifyContent || '').trim().toLowerCase() === 'space-between';
  const isRelativeHidden =
    (styles.position || '').trim().toLowerCase() === 'relative' &&
    (styles.overflow || '').trim().toLowerCase() === 'hidden';

  if (!isDashedBorder || !isSpaceBetween || !isRelativeHidden) {
    return node;
  }

  let changed = false;
  const newChildren = (node.children || []).map((child): SceneNode => {
    const isAbsoluteOverlayIcon =
      !!child.ir?.isAbsolute && (child.type === 'icon' || child.type === 'svg') && !!child.svgContent;

    if (!isAbsoluteOverlayIcon) {
      return child;
    }

    changed = true;

    const rightInset = parseCssLengthPx(child.styles?.right);
    const bottomInset = parseCssLengthPx(child.styles?.bottom);
    const extraRight = rightInset < 0 ? Math.abs(rightInset) : 0;
    const extraBottom = bottomInset < 0 ? Math.abs(bottomInset) : 0;

    const iconChild: SceneNode = {
      ...child,
      x: 0,
      y: 0,
      styles: {
        ...(child.styles || {}),
        position: 'relative',
        top: 'auto',
        right: 'auto',
        bottom: 'auto',
        left: 'auto',
      },
      ir: {
        ...(child.ir || makeFrameIR(child.styles || {})),
        isAbsolute: false,
        absoluteConstraints: undefined,
      },
    };

    const containerW = Math.max((child.width || 0) + extraRight, child.width || 0);
    const containerH = Math.max((child.height || 0) + extraBottom, child.height || 0);

    const containerStyles: SceneStyles = {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      alignItems: 'flex-end',
      position: 'absolute',
      top: child.styles?.top,
      right: child.styles?.right,
      bottom: child.styles?.bottom,
      left: child.styles?.left,
    };
    const containerIR = makeFrameIR(containerStyles);

    containerIR.isAbsolute = true;
    containerIR.absoluteConstraints = {
      horizontal:
        child.styles?.right && child.styles?.right !== 'auto'
          ? 'MAX'
          : child.ir?.absoluteConstraints?.horizontal || 'MIN',
      vertical:
        child.styles?.bottom && child.styles?.bottom !== 'auto'
          ? 'MAX'
          : child.ir?.absoluteConstraints?.vertical || 'MIN',
    };
    containerIR.autoLayout = {
      stackMode: 'VERTICAL',
      stackSpacing: 0,
      stackVerticalPadding: extraBottom,
      stackHorizontalPadding: 0,
      stackPaddingRight: 0,
      stackPaddingBottom: 0,
      stackPrimaryAlignItems: 'MIN',
      stackCounterAlignItems: 'MAX',
      stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
    };

    return {
      type: 'frame',
      name: 'Container',
      x: child.x - extraRight,
      y: child.y - extraBottom,
      width: containerW,
      height: containerH,
      text: null,
      svg: null,
      styles: containerStyles,
      children: [iconChild],
      ir: containerIR,
    };
  });

  const nextAutoLayout: FigmaIRAutoLayout = {
    ...al,
    stackCounterAlignItems: 'CENTER',
  };

  if (!changed && al.stackCounterAlignItems === 'CENTER') {
    return node;
  }

  return {
    ...node,
    children: newChildren,
    ir: {
      ...(node.ir || makeFrameIR(styles)),
      autoLayout: nextAutoLayout,
    },
  };
}

/**
 * Expand frosted icon tiles into baseline-like layered structure:
 * Overlay+Border+OverlayBlur -> [Overlay+Shadow (rectangle), Container -> Icon]
 */
function maybeExpandFrostedIconTile(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const children = node.children || [];

  if (children.length !== 1 || children[0].type !== 'icon') {
    return node;
  }

  const s = node.styles || {};
  const bg = parseRGBA(s.backgroundColor || '');
  const hasSemiTransparentBg = !!bg && bg.a > 0.05 && bg.a < 0.7;
  const hasBorder = (parseFloat(s.borderTopWidth || '0') || 0) > 0.5;
  const hasShadow = !!s.boxShadow && s.boxShadow !== 'none';

  if (!hasSemiTransparentBg || !hasBorder || !hasShadow) {
    return node;
  }

  const iconChild = children[0];
  const sourceEffects = node.ir?.effects || [];
  const backgroundBlurEffects = sourceEffects.filter(effect => effect?.type === 'BACKGROUND_BLUR');

  if (backgroundBlurEffects.length === 0) {
    return node;
  }
  const dropShadowEffects = sourceEffects
    .filter(effect => {
      if (effect?.type !== 'DROP_SHADOW') {
        return false;
      }
      const radius = Number(effect?.radius || 0);
      const colorAlpha = Number(effect?.color?.a || 0);

      return radius > 0 || colorAlpha > 0;
    })
    .sort((a, b) => Number(a?.radius || 0) - Number(b?.radius || 0));

  const iconContainerIR = makeFrameIR({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  });

  iconContainerIR.autoLayout = {
    stackMode: 'VERTICAL',
    stackSpacing: 0,
    stackVerticalPadding: 0,
    stackHorizontalPadding: 0,
    stackPaddingRight: 0,
    stackPaddingBottom: 0,
    stackPrimaryAlignItems: 'MIN',
    stackCounterAlignItems: 'MIN',
    stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
  };

  const iconContainer: SceneNode = {
    type: 'frame',
    name: 'Container',
    x: iconChild.x,
    y: iconChild.y,
    width: iconChild.width,
    height: iconChild.height,
    text: null,
    svg: null,
    styles: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    },
    children: [iconChild],
    ir: iconContainerIR,
  };

  const shadowStyles: SceneStyles = {
    display: 'block',
    backgroundColor: (() => {
      const base = parseRGBA(s.backgroundColor || '');

      if (!base) {
        return 'rgba(255, 255, 255, 0.002)';
      }

      return `rgba(${Math.round(base.r * 255)}, ${Math.round(base.g * 255)}, ${Math.round(base.b * 255)}, 0.002)`;
    })(),
    borderRadius: s.borderRadius,
    borderTopLeftRadius: s.borderTopLeftRadius,
    borderTopRightRadius: s.borderTopRightRadius,
    borderBottomLeftRadius: s.borderBottomLeftRadius,
    borderBottomRightRadius: s.borderBottomRightRadius,
    boxShadow: s.boxShadow,
  };

  const overlayShadowIR = makeFrameIR(shadowStyles);

  overlayShadowIR.figmaType = 'ROUNDED_RECTANGLE';
  overlayShadowIR.isAbsolute = true;
  overlayShadowIR.absoluteConstraints = { horizontal: 'CENTER', vertical: 'MIN' };
  overlayShadowIR.autoLayout = undefined;
  if (dropShadowEffects.length > 0) {
    overlayShadowIR.effects = dropShadowEffects.map(effect => ({
      ...effect,
      showShadowBehindNode: false,
    }));
  }

  const overlayShadow: SceneNode = {
    type: 'frame',
    name: 'Overlay+Shadow',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: null,
    svg: null,
    styles: shadowStyles,
    children: [],
    ir: overlayShadowIR,
  };

  const outerStyles: SceneStyles = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: s.backgroundColor,
    borderRadius: s.borderRadius,
    borderTopLeftRadius: s.borderTopLeftRadius,
    borderTopRightRadius: s.borderTopRightRadius,
    borderBottomLeftRadius: s.borderBottomLeftRadius,
    borderBottomRightRadius: s.borderBottomRightRadius,
    borderTopWidth: s.borderTopWidth,
    borderTopColor: s.borderTopColor,
    borderRightWidth: s.borderRightWidth,
    borderBottomWidth: s.borderBottomWidth,
    borderLeftWidth: s.borderLeftWidth,
  };

  const outerIR = makeFrameIR(outerStyles);

  if ((node.ir?.fills || []).length > 0) {
    outerIR.fills = [...(node.ir?.fills || [])];
  }
  if (node.ir?.border) {
    outerIR.border = { ...node.ir.border };
  }
  outerIR.effects = backgroundBlurEffects;
  outerIR.autoLayout = {
    stackMode: 'HORIZONTAL',
    stackSpacing: 0,
    stackVerticalPadding: 0,
    stackHorizontalPadding: 0,
    stackPaddingRight: 0,
    stackPaddingBottom: 0,
    stackPrimarySizing: 'FIXED',
    stackPrimaryAlignItems: 'CENTER',
    stackCounterAlignItems: 'CENTER',
    stackCounterSizing: 'FIXED',
  };

  return {
    ...node,
    name: 'Overlay+Border+OverlayBlur',
    styles: outerStyles,
    children: [overlayShadow, iconContainer],
    ir: outerIR,
  };
}

/**
 * Universal: Convert INPUT text nodes into "Input" frame with padding.
 *
 * HTML <input> with placeholder text maps to Figma structure:
 *   Input (FRAME, padding from CSS) > Container (FRAME) > Text
 *
 * The INPUT's CSS padding becomes the Input frame's auto-layout padding.
 * The placeholder text becomes a Text node inside a Container wrapper.
 */
function maybeConvertInputToInputFrame(node: SceneNode): SceneNode {
  if (node.type !== 'text') {
    return node;
  }
  if ((node.tagName || '').toUpperCase() !== 'INPUT') {
    return node;
  }
  if (!node.text) {
    return node;
  }

  const s = node.styles || {};
  const padTop = parseFloat(s.paddingTop || '0') || 0;
  const padRight = parseFloat(s.paddingRight || '0') || 0;
  const padBottom = parseFloat(s.paddingBottom || '0') || 0;
  const padLeft = parseFloat(s.paddingLeft || '0') || 0;

  const nodeW = node.width || 0;
  const nodeH = node.height || 0;

  // Text size = input size minus padding
  const textW = Math.max(nodeW - padLeft - padRight, 1);
  const textH = node.ir?.textProps?.lineHeightPx || Math.max(nodeH - padTop - padBottom, 1);
  const textX = (node.x || 0) + padLeft;
  const textY = (node.y || 0) + padTop;

  // Inner Container wraps the Text node (allows independent sizing control)
  const containerPadTop = 1;
  const containerPadBottom = Math.max(padBottom - padTop, 0) || 3;
  const containerH = textH + containerPadTop + containerPadBottom;

  const textNode: SceneNode = {
    ...node,
    type: 'text',
    name: 'Text',
    tagName: undefined,
    x: textX,
    y: textY,
    width: textW,
    height: textH,
    children: [],
    styles: {},
  };

  if (textNode.ir) {
    textNode.ir = {
      ...textNode.ir,
      opacity: 1,
      isAbsolute: false,
      absoluteConstraints: undefined,
      fills: [],
      effects: [],
      border: undefined,
      cornerRadii: undefined,
    };
  }

  // Override text color with placeholder color when available
  const placeholderColor = s.placeholderColor ? parseRGBA(s.placeholderColor) : null;

  if (placeholderColor && textNode.ir?.textProps) {
    textNode.ir = {
      ...textNode.ir,
      textProps: { ...textNode.ir.textProps, color: placeholderColor },
    };
  }

  const innerContainer: SceneNode = {
    type: 'frame',
    name: 'Container',
    x: textX,
    y: textY,
    width: textW,
    height: containerH,
    text: null,
    svg: null,
    styles: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    },
    children: [textNode],
    ir: {
      figmaType: 'FRAME',
      opacity: 1,
      isAbsolute: false,
      fills: [],
      effects: [],
      clipsContent: true,
      flexGrow: 0,
      autoLayout: {
        stackMode: 'VERTICAL',
        stackSpacing: 0,
        stackVerticalPadding: containerPadTop,
        stackHorizontalPadding: 0,
        stackPaddingRight: 0,
        stackPaddingBottom: containerPadBottom,
        stackPrimaryAlignItems: 'MIN',
        stackCounterAlignItems: 'MIN',
        stackCounterSizing: 'FIXED',
      },
      sizing: {
        widthMode: 'FILL',
        heightMode: 'AUTO',
        isBlockLevel: true,
      },
    },
  };

  // Outer Input frame with CSS padding
  const inputFrame: SceneNode = {
    type: 'frame',
    name: 'Input',
    x: node.x || 0,
    y: node.y || 0,
    width: nodeW,
    height: nodeH,
    text: null,
    svg: null,
    styles: {
      ...s,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    },
    children: [innerContainer],
    ir: {
      ...node.ir,
      figmaType: 'FRAME',
      opacity: node.ir?.opacity ?? 1,
      isAbsolute: node.ir?.isAbsolute ?? false,
      fills: node.ir?.fills ?? [],
      effects: node.ir?.effects ?? [],
      textProps: undefined,
      clipsContent: false,
      flexGrow: node.ir?.flexGrow || 0,
      autoLayout: {
        stackMode: 'VERTICAL',
        stackSpacing: 0,
        stackVerticalPadding: padTop,
        stackHorizontalPadding: padLeft,
        stackPaddingRight: padRight,
        stackPaddingBottom: padBottom,
        stackPrimaryAlignItems: 'MIN',
        stackCounterAlignItems: 'MIN',
        stackCounterSizing: 'FIXED',
      },
      sizing: node.ir?.sizing,
    },
  };

  return inputFrame;
}

/**
 * Universal: In Link-like vertical stacks (icon + text), wrap the text
 * child in a Container frame for independent sizing.
 */
function maybeWrapLinkTextInContainer(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }

  // Only target Link-like patterns: exactly 2 children (1 frame wrapping icon + 1 text)
  const children = node.children || [];

  if (children.length !== 2) {
    return node;
  }

  // After maybeWrapIconsInContainer, icon is already wrapped → look for frame with icon child
  const wrappedIcon = children.find(c => {
    if (c.type !== 'frame') {
      return false;
    }
    const hasDirectIcon = c.children?.length === 1 && c.children[0].type === 'icon';

    if (hasDirectIcon) {
      return true;
    }
    const hasIconDescendant = (n: SceneNode): boolean => {
      if (n.type === 'icon') {
        return true;
      }

      return (n.children || []).some(hasIconDescendant);
    };

    // Structural fallback: decorative icon shells still contain an icon descendant.
    return hasIconDescendant(c);
  });
  const textChild = children.find(c => c.type === 'text' && c.text);

  if (!wrappedIcon || !textChild) {
    return node;
  }

  const centeredText =
    (textChild.styles?.textAlign || '').toLowerCase() === 'center' ||
    (textChild.ir?.textProps?.textAlign || '').toUpperCase() === 'CENTER';
  const textLineHeight = textChild.ir?.textProps?.lineHeightPx || parseFloat(textChild.styles?.lineHeight || '0') || 0;
  const likelyMultilineCenteredText =
    centeredText &&
    ((textChild.text || '').includes('\n') || (textLineHeight > 0 && (textChild.height || 0) >= textLineHeight * 1.45));

  // Keep single-line centered labels as direct text nodes, but wrap multiline
  // centered labels so centering can be resolved by container + content sizing.
  if (centeredText && !likelyMultilineCenteredText) {
    return node;
  }

  // Must have VERTICAL auto-layout (icon stacked above text)
  const al = node.ir?.autoLayout;

  if (!al || al.stackMode !== 'VERTICAL') {
    return node;
  }

  const newChildren = children.map(child => {
    if (child === textChild) {
      return makeContentContainer(child, likelyMultilineCenteredText);
    }

    return child;
  });

  // Derive spacing from geometry for 2-item vertical icon+label stacks.
  // This avoids name-based fixture tuning and keeps behavior structural.
  if (al.stackMode === 'VERTICAL') {
    const measuredGap = (textChild.y || 0) - ((wrappedIcon.y || 0) + (wrappedIcon.height || 0));

    if (Number.isFinite(measuredGap) && measuredGap >= 0) {
      const normalizedGap = Math.max(0, Math.round(measuredGap));

      if (Math.abs((al.stackSpacing || 0) - normalizedGap) >= 1) {
        return {
          ...node,
          children: newChildren,
          ir: {
            ...(node.ir || makeFrameIR(node.styles || {})),
            autoLayout: {
              ...al,
              stackSpacing: normalizedGap,
            },
          },
        };
      }
    }
  }

  return { ...node, children: newChildren };
}

/** Helper: wrap a content node (icon or text) in a Container frame */
function makeContentContainer(child: SceneNode, centerContent = false): SceneNode {
  const childW = child.width || 0;
  const childH = child.height || 0;
  const containerWidth = childW;
  const containerHeight = childH;

  return {
    type: 'frame',
    name: 'Container',
    x: child.x,
    y: child.y,
    width: containerWidth,
    height: containerHeight,
    text: null,
    svg: null,
    styles: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: centerContent ? 'center' : 'flex-start',
      justifyContent: 'flex-start',
    },
    children: [child],
    ir: {
      figmaType: 'FRAME',
      opacity: 1,
      isAbsolute: false,
      fills: [],
      effects: [],
      clipsContent: false,
      flexGrow: 0,
      autoLayout: {
        stackMode: 'VERTICAL',
        stackSpacing: 0,
        stackVerticalPadding: 0,
        stackHorizontalPadding: 0,
        stackPaddingRight: 0,
        stackPaddingBottom: 0,
        stackPrimaryAlignItems: 'MIN',
        stackCounterAlignItems: centerContent ? 'CENTER' : 'MIN',
        stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
      },
    },
  };
}

/** Ensure every node in the tree that lacks `ir` gets one synthesized from `styles`. Mutates in place. */
function ensureSyntheticNodesHaveIR(node: SceneNode): void {
  if (!node.ir && node.styles) {
    if (node.type === 'frame') {
      const ir = makeFrameIR(node.styles);
      // Normalizer-created leaf frames with fills + uniform corner radius → ROUNDED_RECTANGLE
      const isLeaf = !node.children || node.children.length === 0;

      if (isLeaf && ir.fills.length > 0 && ir.cornerRadii?.allSame) {
        ir.figmaType = 'ROUNDED_RECTANGLE';
      }
      node.ir = ir;
    } else if (node.type === 'text') {
      node.ir = makeTextIR(node.styles);
    }
  }
  for (const child of node.children || []) {
    ensureSyntheticNodesHaveIR(child);
  }
}

/**
 * Wrap children that have CSS margins in a "Margin" frame.
 * Figma has no margin concept — the baseline represents margins as a wrapper
 * frame with padding corresponding to the margin values.
 *
 * Only wraps when the parent is a CSS flex/grid container with zero gap,
 * ensuring the margin can't be expressed as uniform stackSpacing between siblings.
 */
function maybeWrapChildrenWithMargins(node: SceneNode): SceneNode {
  if (node.type !== 'frame') {
    return node;
  }
  const children = node.children || [];

  if (children.length === 0) {
    return node;
  }

  // Only apply to layout containers (flex/grid) — that's where Figma stackSpacing matters
  const irAL = node.ir?.autoLayout;

  if (!irAL) {
    return node;
  }

  // Only wrap when CSS gap is 0 — if the parent has non-zero gap, margins are
  // absorbed into the spacing by the geometric inference
  if ((irAL.stackSpacing || 0) > 0.5) {
    return node;
  }

  // Filter non-absolute children for flow analysis
  const flowChildren = children.filter(c => !c.ir?.isAbsolute);

  if (flowChildren.length < 2) {
    return node;
  }

  // Detect asymmetric margins: only wrap if some children have margins and others don't.
  // If ALL children have the same margin, the geometric gap inference handles it as uniform spacing.
  const primaryAxis = irAL.stackMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
  const getTrailingMargin = (c: SceneNode) => {
    const s = c.styles || {};

    return primaryAxis === 'vertical' ? parseFloat(s.marginBottom || '0') || 0 : parseFloat(s.marginRight || '0') || 0;
  };
  const getLeadingMargin = (c: SceneNode) => {
    const s = c.styles || {};

    return primaryAxis === 'vertical' ? parseFloat(s.marginTop || '0') || 0 : parseFloat(s.marginLeft || '0') || 0;
  };

  // Check if any flow child has a significant margin (>= 3px)
  const childrenWithMargins = flowChildren.filter(c => {
    const s = c.styles || {};
    const mt = parseFloat(s.marginTop || '0') || 0;
    const mr = parseFloat(s.marginRight || '0') || 0;
    const mb = parseFloat(s.marginBottom || '0') || 0;
    const ml = parseFloat(s.marginLeft || '0') || 0;

    return mt >= 3 || mr >= 3 || mb >= 3 || ml >= 3;
  });

  if (childrenWithMargins.length === 0) {
    return node;
  }

  // If ALL flow children have the same primary-axis margins, it's uniform spacing — skip wrapping
  if (childrenWithMargins.length === flowChildren.length) {
    const margins = flowChildren.map(c => getTrailingMargin(c) + getLeadingMargin(c));
    const allSame = margins.every(m => Math.abs(m - margins[0]) < 1);

    if (allSame) {
      return node;
    }
  }

  let changed = false;
  const newChildren = children.map(child => {
    const s = child.styles || {};
    const mt = parseFloat(s.marginTop || '0') || 0;
    const mr = parseFloat(s.marginRight || '0') || 0;
    const mb = parseFloat(s.marginBottom || '0') || 0;
    const ml = parseFloat(s.marginLeft || '0') || 0;

    if (mt < 3 && mr < 3 && mb < 3 && ml < 3) {
      return child;
    }
    if (child.ir?.isAbsolute) {
      return child;
    }

    changed = true;
    const childW = child.width || 0;
    const childH = child.height || 0;
    const wrapperW = childW + ml + mr;
    const wrapperH = childH + mt + mb;

    const wrapper: SceneNode = {
      type: 'frame',
      name: 'Margin',
      x: (child.x || 0) - ml,
      y: (child.y || 0) - mt,
      width: wrapperW,
      height: wrapperH,
      text: null,
      svg: null,
      styles: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
      },
      children: [
        {
          ...child,
          styles: {
            ...s,
            marginTop: '0px',
            marginRight: '0px',
            marginBottom: '0px',
            marginLeft: '0px',
          },
        },
      ],
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: child.ir?.flexGrow || 0,
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: mt,
          stackHorizontalPadding: ml,
          stackPaddingRight: mr,
          stackPaddingBottom: mb,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
          stackCounterSizing: 'FIXED',
        },
        sizing: child.ir?.sizing,
      },
    };

    return wrapper;
  });

  if (!changed) {
    return node;
  }

  return { ...node, children: newChildren };
}

// ---- Main entry point ----

/** Preserve required scene semantics; infer flow structure only in auto-layout mode. */
export function enrichSceneForBaseline(
  node: SceneNode,
  layoutMode: 'snapshot' | 'auto-layout' = 'auto-layout',
): SceneNode {
  const cloned = cloneSceneNode(node);

  // Convert leaf INPUT text nodes to Input frames BEFORE child recursion
  // (INPUT nodes have no meaningful children to recurse into)
  const withInput = maybeConvertInputToInputFrame(cloned);
  const withDecorativeText = maybeConvertDecorativeInlineTextToOverlay(withInput);

  withDecorativeText.children = (withDecorativeText.children || []).map(child => enrichSceneForBaseline(child, layoutMode));

  if (layoutMode === 'snapshot') {
    const result = maybeConvertMaskedImagesToMaskGroups(withDecorativeText);

    ensureSyntheticNodesHaveIR(result);

    return result;
  }

  // Universal normalizers (CSS/structure-driven, no hardcoded content checks)
  const withBadges = maybeNormalizeAbsoluteBadgeWithRing(withDecorativeText);
  const withButtons = maybeNormalizeButtonFrame(withBadges);
  const withFlattenedFixed = maybeFlattenCollapsedFixedWrapper(withButtons);
  const withFlattenedSection = maybeFlattenSingleChildSection(withFlattenedFixed);
  const withPromotedWrapper = maybePromoteEmptySingleChildWrapper(withFlattenedSection);
  const withSectionNames = maybeRenameSectionByHeading(withPromotedWrapper);
  const withLinks = maybeRenameAnchorToLink(withSectionNames);
  const withSelfStartWrapped = maybeWrapAlignSelfStartChildren(withLinks);
  const withMargins = maybeWrapChildrenWithMargins(withSelfStartWrapped);
  const withInferredTextButtonGaps = maybeBalanceTextButtonGapForInferredLayout(withMargins);
  const withVariableButtonGaps = maybeEncodeVariableButtonGap(withInferredTextButtonGaps);
  const withVariableLeadingMargins = maybeEncodeVariableLeadingMarginTop(withVariableButtonGaps);
  const withMaskGroups = maybeConvertMaskedImagesToMaskGroups(withVariableLeadingMargins);
  const withDashedPromoCards = maybeNormalizeDashedPromoCard(withMaskGroups);
  const withFrostedIcons = maybeExpandFrostedIconTile(withDashedPromoCards);
  const withIcons = maybeWrapIconsInContainer(withFrostedIcons);
  const result = maybeWrapLinkTextInContainer(withIcons);

  // Ensure all normalizer-created synthetic nodes have IR data
  ensureSyntheticNodesHaveIR(result);

  return result;
}
