/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { parseSvgContent, svgPathsToBlob } from './svg-to-vector';
import { toClipboardBlobStore } from './clipboard-blob-store';
import type { ClipboardBlobStore } from './clipboard-blob-store';
import { mapFontStyle, normalizeFontFamily, shouldEmitFallbackFonts } from './font-mapping';
import { BASIC_TEXT_CONVERSION_RUNTIME } from './text-conversion-runtime';
import type { TextConversionRuntime } from './text-conversion-runtime';
// Universal bottom-nav detection: position:fixed + pinned to bottom of viewport
function isFixedBottomElement (node: SceneNode): boolean {
  if (node.type !== 'frame') {
    return false;
  }
  const ir = node.ir;

  if (!ir?.isAbsolute) {
    return false;
  }
  const pos = node.styles?.position;

  if (pos !== 'fixed') {
    return false;
  }
  // Element must be pinned to bottom (vertical constraint MAX or bottom inset is small)
  const vc = ir.absoluteConstraints?.vertical;

  return vc === 'MAX';
}
import { resolveAutoLayout } from './layout-resolver';
import { positionForIndex, buildGridStructures, resolveGridPlacements } from './grid-handler';
import { makeSolidPaint, makeImageFillPaint, dataUrlToUint8Array, mapIRFillPaint } from './paint-helpers';
import type {
  SceneNode,
  FigmaGUID,
  FigmaNodeChange,
  FigmaBlob,
  AutoLayout,
  FigmaTextDataGlyph,
  FigmaTextData,
  TextCharMetrics,
} from '../types';

// ---- Node ID generation ----
let localIdCounter = 100;

export function makeGUID (sessionID = 0): FigmaGUID {
  return { sessionID, localID: localIdCounter++ };
}

export function resetLocalIdCounter (value = 100): void {
  localIdCounter = value;
}

function mapAlignSelfToConstraint (alignSelf: string | undefined): 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' {
  if (!alignSelf) {
    return 'MIN';
  }
  switch (alignSelf.toUpperCase()) {
    case 'CENTER':
      return 'CENTER';
    case 'MAX':
      return 'MAX';
    case 'STRETCH':
      return 'STRETCH';
    default:
      return 'MIN';
  }
}

function resolveAutoChildConstraints (params: {
  node: SceneNode;
  parentLayout: AutoLayout | null;
  parentWidth?: number;
  parentHeight?: number;
  hasExplicitAlignSelf: boolean;
  alignSelf?: string;
}): {
  horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
} {
  const { node, parentLayout, parentWidth, parentHeight, hasExplicitAlignSelf, alignSelf } = params;

  let horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' = 'MIN';
  let vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' = 'MIN';

  if (!parentLayout) {
    return { horizontal, vertical };
  }

  if (parentLayout.stackMode === 'GRID') {
    horizontal = 'STRETCH';

    return { horizontal, vertical };
  }

  const sizing = node.ir?.sizing;

  // -- VERTICAL parent: determine child's horizontal constraint --
  if (parentLayout.stackMode === 'VERTICAL') {
    // 1. Explicit alignSelf takes priority
    if (hasExplicitAlignSelf) {
      horizontal = mapAlignSelfToConstraint(alignSelf);

      return { horizontal, vertical };
    }

    // Text, vector, and icon nodes are content nodes — they follow parent alignment, never STRETCH
    const isContentNode = node.type === 'text' || node.type === 'icon' || node.type === 'image';
    const counterAlign = parentLayout.stackCounterAlignItems || 'MIN';

    // Compute child fill ratio for size-aware alignment decisions
    const paddings = resolveLayoutPaddings(parentLayout);
    const childWidth = Math.max(node.width || 0, 0);
    const innerWidth = parentWidth ? Math.max(parentWidth - paddings.left - paddings.right, 0) : 0;
    const childFillRatio = innerWidth > 0 ? childWidth / innerWidth : 0;

    // Detect whether parent layout is geometrically inferred (vs CSS-declared)
    const isInferredParentLayout = !!parentLayout?._inferredAxisScore;

    // 2. CSS-driven STRETCH: block elements fill parent width
    //    Only STRETCH when element actually fills the parent — small block elements
    //    in a CENTER parent should follow CENTER, not STRETCH.
    if (!isContentNode && sizing) {
      const isFillWidth = sizing.widthMode === 'FILL';
      const isBlockAutoWidth = sizing.isBlockLevel && sizing.widthMode !== 'FIXED';
      // Only apply block-auto STRETCH when the child actually fills the parent (>= 80% width)
      const blockStretchable = isBlockAutoWidth && !isInferredParentLayout && childFillRatio >= 0.8;

      if (isFillWidth || blockStretchable) {
        horizontal = 'STRETCH';
      }
    }

    // 3. Geometric fallback for frame nodes: if no IR sizing, use geometry to detect STRETCH
    //    Use strict threshold to avoid false positives (stricter for inferred layouts)
    if (horizontal === 'MIN' && !isContentNode && !sizing && parentWidth && parentWidth > 0) {
      const stretchThreshold = isInferredParentLayout ? 0.99 : 0.98;

      if (childFillRatio >= stretchThreshold) {
        horizontal = 'STRETCH';
      }
    }

    // 4. Parent's counter-align as signal — override STRETCH for non-fill children
    //    When parent has CENTER/MAX alignment, children that don't have explicit
    //    FILL width should follow alignment, not stretch
    if (horizontal === 'STRETCH' && !sizing && counterAlign !== 'MIN') {
      // Geometric STRETCH was set, but parent wants CENTER/MAX —
      // only keep STRETCH if child has genuine FILL width signal
      horizontal = counterAlign === 'CENTER' ? 'CENTER' : counterAlign === 'MAX' ? 'MAX' : horizontal;
    }
    if (horizontal === 'MIN') {
      const isLargeChild = childFillRatio >= 0.99;

      if (counterAlign === 'CENTER' && !isLargeChild) {
        horizontal = 'CENTER';
      } else if (counterAlign === 'MAX' && !isLargeChild) {
        horizontal = 'MAX';
      }
    }
  }

  // -- HORIZONTAL parent: determine child's vertical constraint --
  // Use parent's counter-align as primary signal, with geometric validation.
  if (parentLayout.stackMode === 'HORIZONTAL' && parentHeight && parentHeight > 0) {
    const isSingleIconContainer =
      node.type === 'frame' && (node.children || []).length === 1 && node.children[0].type === 'icon';

    if (isSingleIconContainer && (parentLayout.stackPrimaryAlignItems || 'MIN') === 'CENTER') {
      horizontal = 'CENTER';
    }

    const counterAlign = parentLayout.stackCounterAlignItems || 'MIN';

    if (counterAlign === 'CENTER') {
      // Trust parent's CENTER alignment for children that clearly don't fill parent
      const childHeight = Math.max(node.height || 0, 0);
      const paddings = resolveLayoutPaddings(parentLayout);
      const innerHeight = Math.max(parentHeight - paddings.top - paddings.bottom, 0);
      const fillRatio = innerHeight > 0 ? childHeight / innerHeight : 0;

      // Only fall back to MIN when child is nearly full-height.
      // Most CENTER-aligned rows still center children that occupy a large
      // fraction of the height but do not truly fill it.
      vertical = fillRatio < 0.95 ? 'CENTER' : 'MIN';
    } else if (counterAlign === 'MAX') {
      vertical = 'MAX';
    }

    // Detect STRETCH for children that fill the parent height
    if (sizing && sizing.heightMode === 'FILL') {
      vertical = 'STRETCH';
    }
  }

  return { horizontal, vertical };
}

function resolveLayoutPaddings (layout: AutoLayout | null | undefined) {
  const left = layout?.stackPaddingLeft ?? layout?.stackHorizontalPadding ?? 0;
  const right = layout?.stackPaddingRight ?? layout?.stackHorizontalPadding ?? 0;
  const top = layout?.stackPaddingTop ?? layout?.stackVerticalPadding ?? 0;
  const bottom = layout?.stackPaddingBottom ?? layout?.stackVerticalPadding ?? 0;

  return { left, right, top, bottom };
}

function applyTextCaseTransform (text: string, textCase: 'UPPER' | 'LOWER' | 'TITLE' | undefined): string {
  if (!text || !textCase) {
    return text;
  }
  if (textCase === 'UPPER') {
    return text.toUpperCase();
  }
  if (textCase === 'LOWER') {
    return text.toLowerCase();
  }
  if (textCase === 'TITLE') {
    return text.replace(
      /\b([A-Za-z])([A-Za-z]*)/g,
      (_match, first: string, rest: string) => `${first.toUpperCase()}${rest.toLowerCase()}`,
    );
  }

  return text;
}

function buildVisualLineSpans (
  text: string,
  charWidths: number[],
  fallbackCharWidth: number,
  wrapWidth: number,
  enableSoftWrap: boolean,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];

  const pushWrappedSpan = (start: number, end: number) => {
    if (start > end) {
      return;
    }
    if (start === end) {
      spans.push({ start, end });

      return;
    }

    if (!enableSoftWrap || wrapWidth <= 1) {
      spans.push({ start, end });

      return;
    }

    let lineStart = start;

    while (lineStart < end) {
      let width = 0;
      let cursor = lineStart;
      let lastBreak = -1;

      while (cursor < end) {
        const ch = String.fromCodePoint(text.codePointAt(cursor) ?? 0);
        const charWidth = charWidths.slice(cursor, cursor + ch.length)
          .reduce((sum, value) => sum + (Number.isFinite(value) ? value : fallbackCharWidth), 0);

        if (width + charWidth > wrapWidth) {
          if (cursor === lineStart) {
            cursor += ch.length;
            width += charWidth;
          }

          break;
        }

        width += charWidth;
        if (ch === ' ' || ch === '\t') {
          lastBreak = cursor;
        }
        cursor += ch.length;
      }

      if (cursor >= end) {
        spans.push({ start: lineStart, end });

        break;
      }

      if (lastBreak >= lineStart) {
        const breakEnd = lastBreak + 1;

        spans.push({ start: lineStart, end: breakEnd });
        let nextStart = breakEnd;

        while (nextStart < end && (text[nextStart] === ' ' || text[nextStart] === '\t')) {
          nextStart += 1;
        }
        lineStart = nextStart;
      } else {
        spans.push({ start: lineStart, end: cursor });
        lineStart = cursor;
      }
    }
  };

  let segmentStart = 0;

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      pushWrappedSpan(segmentStart, i);
      segmentStart = i + 1;
    }
  }

  if (spans.length === 0) {
    spans.push({ start: 0, end: 0 });
  }

  return spans;
}

function buildMeasuredLineSpans(
  positions: NonNullable<TextCharMetrics['characterPositions']>, text: string,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;

  for (let index = 0; index < positions.length; index++) {
    if (text[index] === '\n') {
      spans.push({ start, end: index });
      start = index + 1;
    } else if (index > start && positions[index].y !== positions[index - 1].y) {
      spans.push({ start, end: index });
      start = index;
    }
  }
  spans.push({ start, end: positions.length });

  return spans;
}

function shouldUseAutoFlowPositioning (node: SceneNode, layout: AutoLayout | null | undefined): boolean {
  if (!layout) {
    return false;
  }
  if (layout.stackMode !== 'VERTICAL' && layout.stackMode !== 'HORIZONTAL') {
    return false;
  }

  // Root semantic body containers should always use auto-flow cursor positioning.
  // Their children commonly carry document-space geometry that conflicts with
  // auto-layout semantics.
  if ((node.tagName || '').toUpperCase() === 'BODY') {
    return true;
  }

  const children = (node.children || []).filter(child => !child.ir?.isAbsolute);

  if (children.length < 2) {
    return false;
  }

  // If layout was inferred (no explicit IR auto-layout), child transforms are
  // more likely to carry stale geometry and should be normalized by flow cursor.
  if (!node.ir?.autoLayout) {
    return true;
  }

  const nodeWidth = node.width || 0;
  const nodeHeight = node.height || 0;
  let pathologicalCount = 0;

  for (const child of children) {
    const relX = (child.x || 0) - (node.x || 0);
    const relY = (child.y || 0) - (node.y || 0);
    const childWidth = child.width || 0;
    const childHeight = child.height || 0;

    const isPathological =
      relX < -2 || relY < -2 || relX + childWidth > nodeWidth + 2 || relY + childHeight > nodeHeight + 2;

    if (isPathological) {
      pathologicalCount += 1;
    }
  }

  return pathologicalCount / Math.max(children.length, 1) >= 0.2;
}

function buildAutoFlowPositionMap (node: SceneNode, layout: AutoLayout): Map<SceneNode, { x: number; y: number }> {
  const nonAbsoluteChildren = (node.children || []).filter(child => !child.ir?.isAbsolute);
  const sortedChildren = [...nonAbsoluteChildren].sort((a, b) => {
    if (layout.stackMode === 'VERTICAL') {
      return a.y - b.y || a.x - b.x;
    }

    return a.x - b.x || a.y - b.y;
  });

  const paddings = resolveLayoutPaddings(layout);
  const spacing = layout.stackSpacing || 0;
  const parentInnerWidth = Math.max((node.width || 0) - paddings.left - paddings.right, 0);
  const parentInnerHeight = Math.max((node.height || 0) - paddings.top - paddings.bottom, 0);
  let primaryCursor = layout.stackMode === 'VERTICAL' ? paddings.top : paddings.left;

  const result = new Map<SceneNode, { x: number; y: number }>();

  for (const child of sortedChildren) {
    const childWidth = child.width || 0;
    const childHeight = child.height || 0;

    if (layout.stackMode === 'VERTICAL') {
      const align = layout.stackCounterAlignItems || 'MIN';
      let forcedX = paddings.left;

      if (align === 'CENTER') {
        forcedX = paddings.left + Math.max((parentInnerWidth - childWidth) / 2, 0);
      } else if (align === 'MAX') {
        forcedX = Math.max((node.width || 0) - paddings.right - childWidth, 0);
      }

      result.set(child, { x: forcedX, y: primaryCursor });
      primaryCursor += childHeight + spacing;
    } else {
      const align = layout.stackCounterAlignItems || 'MIN';
      let forcedY = paddings.top;

      if (align === 'CENTER') {
        forcedY = paddings.top + Math.max((parentInnerHeight - childHeight) / 2, 0);
      } else if (align === 'MAX') {
        forcedY = Math.max((node.height || 0) - paddings.bottom - childHeight, 0);
      }

      result.set(child, { x: primaryCursor, y: forcedY });
      primaryCursor += childWidth + spacing;
    }
  }

  return result;
}

// ---- Core convertNode ----

export function convertNode (
  node: SceneNode,
  parentGUID: FigmaGUID,
  positionStr: string,
  nodeChanges: FigmaNodeChange[],
  sessionID: number,
  blobStoreOrBlobs: ClipboardBlobStore | FigmaBlob[],
  parentAbsX: number,
  parentAbsY: number,
  parentLayout: AutoLayout | null,
  parentWidth?: number,
  parentHeight?: number,
  forcedRelX?: number,
  forcedRelY?: number,
  textRuntime: TextConversionRuntime = BASIC_TEXT_CONVERSION_RUNTIME,
  layoutMode: 'snapshot' | 'auto-layout' = 'auto-layout',
): FigmaGUID {
  const blobStore = toClipboardBlobStore(blobStoreOrBlobs);
  const guid = makeGUID(sessionID);
  const s = node.styles || {};
  const ir = node.ir;
  const alignSelfRaw = (ir?.alignSelf || '').toLowerCase();
  const hasExplicitAlignSelf = alignSelfRaw !== '' && alignSelfRaw !== 'auto';

  const absX = node.x || 0;
  const absY = node.y || 0;
  const naturalRelX = absX - parentAbsX;
  const naturalRelY = absY - parentAbsY;

  const isAbsolutePos = !!ir?.isAbsolute;
  const relX = forcedRelX ?? naturalRelX;
  const relY = forcedRelY ?? naturalRelY;

  // Determine Figma node type
  let nodeType: string;

  switch (node.type) {
    case 'text':
      nodeType = 'TEXT';

      break;
    case 'image':
      nodeType = 'FRAME';

      break;
    case 'svg':
      nodeType = node.svgContent !== undefined ? 'VECTOR' : 'FRAME';

      break;
    case 'icon':
      nodeType = node.svgContent ? 'VECTOR' : 'FRAME';

      break;
    default:
      nodeType = ir?.figmaType || 'FRAME';

      break;
  }

  // Promote leaf frames with fills to ROUNDED_RECTANGLE (decorative layers, overlays)
  if (nodeType === 'FRAME' && node.type === 'frame' && (!node.children || node.children.length === 0)) {
    const hasFills = ir && ir.fills.length > 0;
    const hasUniformRadii = !ir?.cornerRadii || ir.cornerRadii.allSame;

    if (hasFills && hasUniformRadii) {
      nodeType = 'ROUNDED_RECTANGLE';
    }
  }

  const nc: FigmaNodeChange = {
    guid,
    phase: 'CREATED',
    parentIndex: { guid: parentGUID, position: positionStr },
    type: nodeType,
    name: node.name || node.type || 'Element',
    visible: true,
    opacity: ir?.opacity ?? 1,
    size: {
      x: Math.max(node.width || 1, 0.01),
      y: Math.max(node.height || 1, 0.01),
    },
    transform: {
      m00: 1,
      m01: 0,
      m02: relX,
      m10: 0,
      m11: 1,
      m12: relY,
    },
    dashPattern: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    strokeJoin: 'MITER',
    effects: [],
    horizontalConstraint: 'MIN',
    verticalConstraint: 'MIN',
    stackChildAlignSelf: ir?.alignSelf || 'AUTO',
    stackPositioning: isAbsolutePos ? 'ABSOLUTE' : 'AUTO',
  };

  if (node.mask) {
    nc.mask = true;
    nc.maskType = node.maskType || 'ALPHA';
  }

  // Sizing from IR
  if (ir && ir.flexGrow > 0 && parentLayout) {
    nc.stackChildPrimaryGrow = ir.flexGrow;
  }

  // Grid children default to grow=1
  if (!isAbsolutePos && parentLayout?.stackMode === 'GRID' && !nc.stackChildPrimaryGrow) {
    nc.stackChildPrimaryGrow = 1;
  }

  if (isAbsolutePos) {
    const constraints = ir?.absoluteConstraints || { horizontal: 'MIN', vertical: 'MIN' };

    nc.horizontalConstraint = constraints.horizontal;
    nc.verticalConstraint = constraints.vertical;
    nc.stackChildAlignSelf = 'AUTO';
    delete nc.stackChildPrimaryGrow;

    // Fix Y position for position:fixed elements pinned to bottom.
    // getBoundingClientRect() returns viewport-relative coords for fixed elements,
    // but the Figma design frame uses the full document scroll height.
    // Recalculate Y to place the element at the bottom of the parent.
    const isFixedBottom = s.position === 'fixed' && s.bottom !== undefined && s.bottom !== 'auto';
    const bottomInset = parseFloat(s.bottom || '0') || 0;
    const isBottomPinned = isFixedBottom && bottomInset <= 10;

    if (layoutMode !== 'snapshot' && isBottomPinned && parentHeight && parentHeight > 0) {
      const expectedY = parentHeight - (node.height || 0) - bottomInset;

      // Only adjust when the expected position differs significantly from the
      // viewport-derived position (avoids mis-correction inside small containers)
      if (expectedY > relY + 10) {
        nc.transform!.m12 = expectedY;
      }
      // Bottom-pinned fixed elements should have MAX vertical constraint
      nc.verticalConstraint = 'MAX';
    }
  }

  if (!isAbsolutePos) {
    const resolvedConstraints = resolveAutoChildConstraints({
      node,
      parentLayout,
      parentWidth,
      parentHeight,
      hasExplicitAlignSelf,
      alignSelf: ir?.alignSelf,
    });

    nc.horizontalConstraint = resolvedConstraints.horizontal;
    nc.verticalConstraint = resolvedConstraints.vertical;
    const normalizedName = (node.name || '').trim().toLowerCase();
    const normalizedTag = (node.tagName || '').trim().toLowerCase();
    const isSemanticRootFlow =
      normalizedName === 'main' || normalizedName === 'body' || normalizedTag === 'main' || normalizedTag === 'body';
    const parentInnerWidth = Math.max(
      (parentWidth || 0) - (parentLayout?.stackHorizontalPadding || 0) - (parentLayout?.stackPaddingRight || 0),
      0,
    );
    const nearFullWidth = parentInnerWidth > 0 && (node.width || 0) >= parentInnerWidth * 0.95;

    if (!hasExplicitAlignSelf && resolvedConstraints.horizontal === 'STRETCH' && isSemanticRootFlow && nearFullWidth) {
      nc.stackChildAlignSelf = 'STRETCH';
    }
  }

  // Fills
  if (node.type === 'text') {
    if (['span', 'p', 'label'].includes((nc.name || '').trim().toLowerCase())) {
      nc.name = 'Text';
    }
    nc.strokeAlign = 'OUTSIDE';

    // Text properties from IR
    const irTP = ir?.textProps;
    const textColor = irTP?.color || { r: 0, g: 0, b: 0, a: 1 };

    nc.fillPaints = [makeSolidPaint(textColor)];

    const fontSize = irTP?.fontSize || 14;

    nc.fontSize = fontSize;
    const weightNum = irTP?.fontWeight || 400;
    const userFontFamily = normalizeFontFamily(irTP?.fontFamily);
    const userFontStyle = mapFontStyle(weightNum, userFontFamily, irTP?.fontStyle ?? s.fontStyle);

    // If there's a downloaded or system available font source, prefer its actual family/style.
    const runtimeFontFamily = textRuntime.resolveFontFamily(
      userFontFamily,
      userFontStyle,
      node.fontSource,
      weightNum,
    );
    const resolvedFontFamily = runtimeFontFamily ?? userFontFamily;
    const resolvedFontStyle = userFontStyle;

    nc.fontName = { family: resolvedFontFamily, style: resolvedFontStyle, postscript: '' };

    const lineHeightPx = irTP?.lineHeightPx || Math.round(fontSize * 1.25 * 100) / 100;

    nc.lineHeight = { value: lineHeightPx, units: 'PIXELS' };

    nc.textAlignHorizontal = irTP?.textAlign || 'LEFT';

    nc.textAlignVertical = 'CENTER';
    const hasReliableTextBox = (node.width || 0) > 1 && (node.height || 0) > 1;
    const textContent = node.text || '';
    const isMultiLine = textContent.includes('\n');
    const estimatedLineCount = hasReliableTextBox && lineHeightPx > 0 ? (node.height || 0) / lineHeightPx : 1;

    const rawText = node.text || ' ';
    const resolvedTextCase =
      irTP?.textCase ??
      (s.textTransform === 'uppercase'
        ? 'UPPER'
        : s.textTransform === 'lowercase'
          ? 'LOWER'
          : s.textTransform === 'capitalize'
            ? 'TITLE'
            : undefined);
    const text = applyTextCaseTransform(rawText, resolvedTextCase);

    // Generate complete textData with baselines, glyphs, and font metadata.
    const tm = node.textMetrics;
    const capturedPositions = tm?.characterPositions;
    const measuredPositions = layoutMode === 'snapshot' && capturedPositions !== undefined &&
      capturedPositions.length === text.length && capturedPositions.length > 0 &&
      capturedPositions.every(position => Number.isFinite(position.x) && Number.isFinite(position.y) &&
        Number.isFinite(position.advance) && position.advance >= 0)
      ? capturedPositions : undefined;
    const measuredSpans = measuredPositions === undefined ? undefined : buildMeasuredLineSpans(measuredPositions, text);

    if (measuredPositions !== undefined) {
      nc.textAlignVertical = 'TOP';
    }
    let charWidths: number[];
    let ascentPx: number;
    let fontLineHeightPx: number;

    if (measuredPositions !== undefined) {
      charWidths = measuredPositions.map(position => position.advance);
    } else if (tm && tm.charWidths.length === text.length) {
      charWidths = tm.charWidths;
    } else {
      charWidths = Array.from(text, () => fontSize * 0.55);
    }

    const shouldUseKerningLayout = measuredPositions === undefined && !text.includes('\n');

    if (shouldUseKerningLayout) {
      const kerningAwareWidths = textRuntime.computeCharWidths(
        resolvedFontFamily,
        resolvedFontStyle,
        weightNum,
        node.fontSource,
        text,
        fontSize,
      );

      if (kerningAwareWidths && kerningAwareWidths.length === text.length) {
        const sourceTotal = charWidths.reduce((acc, width) => acc + (Number.isFinite(width) ? width : 0), 0);
        const kerningTotal = kerningAwareWidths.reduce((acc, width) => acc + (Number.isFinite(width) ? width : 0), 0);

        if (sourceTotal > 0 && kerningTotal > 0) {
          const scale = sourceTotal / kerningTotal;

          charWidths = kerningAwareWidths.map(width => width * scale);
        } else {
          charWidths = kerningAwareWidths;
        }
      }
    }

    const letterSpacing = irTP?.letterSpacing ?? parseFloat(s.letterSpacing ?? '0');
    const tracking = Number.isFinite(letterSpacing) ? letterSpacing : 0;

    // Canvas/fontkit advances exclude CSS tracking; baked glyph placement must include it.
    if (measuredPositions === undefined) {
      charWidths = charWidths.map((width, index) => text[index] === '\n' ? width : Math.max(0, width + tracking));
    }

    const isInterFamily = resolvedFontFamily.trim().toLowerCase() === 'inter';

    if (tm) {
      ascentPx = tm.ascent;
      fontLineHeightPx = tm.fontLineHeight;
    } else if (isInterFamily && fontSize > 0) {
      ascentPx = fontSize * 0.96875;
      fontLineHeightPx = fontSize * 1.21;
    } else {
      ascentPx = fontSize * 0.8;
      fontLineHeightPx = fontSize * 1.2;
    }

    // Cumulative x positions for each character
    const cumulativeX: number[] = [0];

    for (let i = 1; i < text.length; i++) {
      cumulativeX.push(cumulativeX[i - 1] + charWidths[i - 1]);
    }
    const totalWidth = text.length > 0 ? cumulativeX[cumulativeX.length - 1] + charWidths[charWidths.length - 1] : 0;

    const textBoxWidth = hasReliableTextBox ? Math.max(node.width || 0, 0) : 0;
    const hasSoftWrappedByHeight = !isMultiLine && estimatedLineCount >= 1.45;
    const shouldUseWidthOverflowWrapFallback =
      nc.textAlignHorizontal === 'CENTER' || nc.textAlignHorizontal === 'RIGHT';
    const hasSoftWrappedByWidth =
      shouldUseWidthOverflowWrapFallback && !isMultiLine && textBoxWidth > 1 && totalWidth > textBoxWidth + 0.5;
    const hasSoftWrappedLines = measuredSpans === undefined
      ? hasSoftWrappedByHeight || hasSoftWrappedByWidth : measuredSpans.length > 1;

    const prefersFixedTextBox =
      hasReliableTextBox && (nc.textAlignHorizontal === 'CENTER' || nc.textAlignHorizontal === 'RIGHT');

    if (!hasReliableTextBox) {
      nc.textAutoResize = 'WIDTH_AND_HEIGHT';
    } else if (measuredPositions !== undefined || prefersFixedTextBox) {
      nc.textAutoResize = 'NONE';
    } else if (isMultiLine || hasSoftWrappedLines) {
      // Multi-line text: width fixed, height adapts to content wrapping
      nc.textAutoResize = 'HEIGHT';
    } else {
      nc.textAutoResize = 'NONE';
    }

    const fontLineHeightRatio = fontSize > 0 ? fontLineHeightPx / fontSize : 1.2;
    const lineHeightStep = lineHeightPx;
    const baselineOffset = tm?.baselineOffset ?? ascentPx + (lineHeightPx - fontLineHeightPx) / 2;
    const wrapWidth = hasSoftWrappedLines ? Math.max(textBoxWidth, 1) : 0;
    const visualLineSpans = measuredSpans ??
      buildVisualLineSpans(text, charWidths, fontSize * 0.55, wrapWidth, hasSoftWrappedLines);
    const textLines = visualLineSpans.map(() => ({
      lineType: 'PLAIN',
      indentationLevel: 0,
      sourceDirectionality: 'AUTO',
    }));

    const glyphs: Array<{
      commandsBlob: number;
      position: { x: number; y: number };
      fontSize: number;
      firstCharacter: number;
      advance: number;
    }> = [];
    const baselines: Array<{
      position: { x: number; y: number };
      width: number;
      lineY: number;
      lineHeight: number;
      lineAscent: number;
      firstCharacter: number;
      endCharacter: number;
    }> = [];
    const logicalIndexToCharacterOffsetMap: number[] = [];
    const lineGlyphRanges: Array<{ glyphStart: number; glyphEnd: number; lineWidth: number }> = [];

    let yOffset = 0;
    let maxLineWidth = 0;

    for (const span of visualLineSpans) {
      let lineWidth = 0;
      const linePosition = measuredPositions?.[span.start];
      const lineFirstCharacter = span.start;
      const glyphStart = glyphs.length;

      for (let textIndex = span.start; textIndex < span.end; textIndex++) {
        const character = String.fromCodePoint(text.codePointAt(textIndex) ?? 0);
        const characterLength = character.length;
        const measured = measuredPositions?.[textIndex];
        const charWidth = charWidths.slice(textIndex, textIndex + characterLength)
          .reduce((sum, width) => sum + (Number.isFinite(width) ? width : fontSize * 0.55), 0);
        const glyphBlobIndex = character === '\t' ? null : textRuntime.getGlyphBlobIndex(
          resolvedFontFamily,
          resolvedFontStyle,
          weightNum,
          node.fontSource,
          character,
          blobStore,
        );

        if (glyphBlobIndex !== null) {
          glyphs.push({
            commandsBlob: glyphBlobIndex,
            position: {
              x: measured?.x ?? lineWidth,
              y: measured?.y ?? yOffset + baselineOffset,
            },
            fontSize,
            firstCharacter: textIndex,
            advance: fontSize > 0 ? charWidth / fontSize : 0,
          });
        }
        logicalIndexToCharacterOffsetMap[textIndex] = measured?.x ?? lineWidth;
        if (characterLength === 2) {
          logicalIndexToCharacterOffsetMap[textIndex + 1] = measured?.x ?? lineWidth;
          textIndex += 1;
        }
        lineWidth = measured === undefined ? lineWidth + charWidth : Math.max(lineWidth, measured.x + charWidth);
      }

      const ligaturePolicy = s.fontVariantLigatures ?? 'normal';
      const featureSettings = s.fontFeatureSettings ?? 'normal';

      if (tracking === 0 && (ligaturePolicy === 'normal' || ligaturePolicy === 'common-ligatures') &&
          featureSettings === 'normal') {
        const ligatures = textRuntime.getLigatureGlyphs?.(
          resolvedFontFamily, resolvedFontStyle, weightNum, node.fontSource,
          text.slice(span.start, span.end), blobStore,
        ) ?? [];

        if (ligatures.length > 0) {
          const substitutions = new Map(ligatures.map(ligature => [span.start + ligature.firstCharacter, ligature]));
          const originalGlyphs = glyphs.splice(glyphStart);

          for (let index = 0; index < originalGlyphs.length; index++) {
            const original = originalGlyphs[index];
            const substitution = substitutions.get(original.firstCharacter);

            if (substitution === undefined) {
              glyphs.push(original);
              continue;
            }
            const end = original.firstCharacter + substitution.characterCount;
            let advance = original.advance;

            while (index + 1 < originalGlyphs.length && originalGlyphs[index + 1].firstCharacter < end) {
              advance += originalGlyphs[++index].advance;
            }
            glyphs.push({ ...original, commandsBlob: substitution.commandsBlob, advance });
          }
        }
      }

      baselines.push({
        position: { x: linePosition?.x ?? 0, y: linePosition?.y ?? yOffset + baselineOffset },
        width: lineWidth - (linePosition?.x ?? 0),
        lineY: linePosition === undefined ? yOffset : linePosition.y - ascentPx,
        lineHeight: lineHeightPx,
        lineAscent: ascentPx,
        firstCharacter: lineFirstCharacter,
        endCharacter: span.end,
      });
      maxLineWidth = Math.max(maxLineWidth, lineWidth);
      lineGlyphRanges.push({ glyphStart, glyphEnd: glyphs.length, lineWidth });

      if (span.end < text.length && text[span.end] === '\n') {
        logicalIndexToCharacterOffsetMap[span.end] = lineWidth;
      }
      yOffset += lineHeightStep;
    }

    if (measuredPositions === undefined && (nc.textAlignHorizontal === 'CENTER' || nc.textAlignHorizontal === 'RIGHT')) {
      for (let i = 0; i < lineGlyphRanges.length; i++) {
        const line = lineGlyphRanges[i];
        const remaining = Math.max(maxLineWidth - line.lineWidth, 0);
        const offsetX = nc.textAlignHorizontal === 'CENTER' ? remaining / 2 : remaining;

        if (offsetX <= 0) {
          continue;
        }

        const baseline = baselines[i];

        if (baseline?.position) {
          baseline.position.x = offsetX;
        }
        for (let g = line.glyphStart; g < line.glyphEnd; g++) {
          glyphs[g].position.x += offsetX;
        }
      }
    }

    if (measuredPositions === undefined && prefersFixedTextBox && hasSoftWrappedLines && hasReliableTextBox) {
      const fittedWidth = Math.max(Math.min(maxLineWidth, node.width || maxLineWidth), 0.01);
      const fittedHeight = Math.max(lineHeightPx * Math.max(visualLineSpans.length, 1), 0.01);

      nc.size = { x: fittedWidth, y: fittedHeight };
    }

    const textData: FigmaTextData = {
      characters: text,
      lines: textLines,
      layoutVersion: 9,
      layoutSize: { x: maxLineWidth, y: lineHeightPx * Math.max(visualLineSpans.length, 1) },
      baselines,
      glyphs,
      fontMetaData: [
        {
          key: nc.fontName,
          fontLineHeight: fontLineHeightRatio,
          fontStyle: 'NORMAL',
          fontWeight: weightNum,
        },
      ],
      decorations: [],
      logicalIndexToCharacterOffsetMap,
      truncationStartIndex: -1,
      truncatedHeight: -1,
    };

    if (shouldEmitFallbackFonts(resolvedFontFamily, text)) {
      textData.fallbackFonts = [{ family: resolvedFontFamily, style: resolvedFontStyle, postscript: '' }];
    }
    nc.textData = textData;
    nc.fontVariantCommonLigatures = true;
    nc.fontVariantContextualLigatures = true;
    nc.fontVariantDiscretionaryLigatures = false;
    nc.fontVariantHistoricalLigatures = false;
    nc.fontVariantOrdinal = false;
    nc.fontVariantSlashedZero = false;
    nc.fontVariantNumericFigure = 'NORMAL';
    nc.fontVariantNumericSpacing = 'NORMAL';
    nc.fontVariantNumericFraction = 'NORMAL';
    nc.fontVariantCaps = 'NORMAL';
    nc.fontVariantPosition = 'NORMAL';
    nc.letterSpacing = { value: tracking, units: 'PIXELS' };
    nc.textTracking = 0;
    if (irTP?.textDecoration) {
      nc.textDecoration = irTP.textDecoration;
    } else {
      const td = s.textDecoration || '';

      if (td.includes('underline')) {
        nc.textDecoration = 'UNDERLINE';
      } else if (td.includes('line-through')) {
        nc.textDecoration = 'STRIKETHROUGH';
      }
    }
    if (resolvedTextCase) {
      nc.textCase = resolvedTextCase;
    }
    nc.fontVersion = '';
    nc.textUserLayoutVersion = 4;
    nc.textExplicitLayoutVersion = 1;
    nc.toggledOnOTFeatures = [];
    nc.toggledOffOTFeatures = [];
    nc.fontVariations = [];
    nc.textBidiVersion = 1;
    nc.textTruncation = 'DISABLED';
    nc.detachOpticalSizeFromFontSize = true;
    nc.autoRename = true;
    nc.locked = false;
    nc.blendMode = 'PASS_THROUGH';
  } else if (node.svgContent && nodeType === 'VECTOR') {
    if (node.type === 'icon') {
      nc.name = 'Icon';
    }
    nc.locked = false;
    nc.blendMode = 'PASS_THROUGH';
    const iconTransform = nc.transform;

    if (
      node.type === 'icon' && iconTransform &&
      parentLayout?.stackMode === 'VERTICAL' &&
      (parentWidth || 0) <= 52 &&
      (parentHeight || 0) <= 52 &&
      iconTransform.m12 >= 11.5 &&
      iconTransform.m12 <= 12.5
    ) {
      iconTransform.m12 = 16;
    }

    const svgData = parseSvgContent(node.svgContent);

    if (svgData && svgData.paths.length > 0) {
      const vbW = svgData.viewBox[2] || 960;
      const vbH = svgData.viewBox[3] || 960;
      const renderSize = Math.max(node.width || 24, node.height || 24);
      const result = svgPathsToBlob(svgData.paths, vbW, vbH, renderSize);

      nc.size = { x: Math.max(result.bounds.width, 0.01), y: Math.max(result.bounds.height, 0.01) };

      const blobIndex = blobStore.add('vector', result.blob);

      nc.vectorData = { vectorNetworkBlob: blobIndex };

      const iconColor = ir?.fills?.find(f => f.type === 'SOLID')?.color || {
        r: 0,
        g: 0,
        b: 0,
        a: 1,
      };

      nc.fillPaints = [makeSolidPaint(iconColor)];
      delete nc.strokeWeight;
      delete nc.strokeAlign;
      delete nc.strokeJoin;
    }
  } else if ((node.type as string) === 'image' || (node.type === 'svg' && node.image)) {
    const imgData = dataUrlToUint8Array(node.image);

    if (imgData) {
      nc.fillPaints = [
        ...(ir?.fills ?? []).map(fill => mapIRFillPaint(fill, { width: node.width, height: node.height })),
        makeImageFillPaint(imgData, blobStore),
      ];
    } else {
      nc.fillPaints = [makeSolidPaint({ r: 0.85, g: 0.85, b: 0.85, a: 1 })];
    }
    // Respect semantic clipping from IR for image frames as well
    nc.frameMaskDisabled = !(ir?.clipsContent ?? false);
    nc.stackMode = 'NONE';
  } else {
    // Non-text, non-icon, non-image fills from IR
    const irFills = ir?.fills;

    if (irFills && irFills.length > 0) {
      nc.fillPaints = irFills.map(fill => mapIRFillPaint(fill, { width: node.width, height: node.height }));
    } else if (node.type !== 'image') {
      nc.fillPaints = [];
    }

    const bgImgData = dataUrlToUint8Array(node.backgroundImage);

    if (bgImgData) {
      nc.fillPaints = [...(nc.fillPaints ?? []), makeImageFillPaint(bgImgData, blobStore)];
    }

    if (nodeType === 'FRAME') {
      nc.frameMaskDisabled = !(ir?.clipsContent ?? false);
      const autoLayout = layoutMode === 'snapshot' ? null : resolveAutoLayout(node);

      if (!autoLayout) {
        nc.stackMode = 'NONE';
      }
      if (autoLayout) {
        const gridCols = autoLayout._gridColumns;
        const gridRows = autoLayout._gridRows;

        delete autoLayout._gridColumns;
        delete autoLayout._gridRows;

        Object.assign(nc, autoLayout);

        if (autoLayout.stackMode === 'GRID') {
          nc.stackPrimarySizing = 'FIXED';
        }

        if (autoLayout.stackMode === 'GRID' && gridCols && gridCols.length > 0) {
          const gridRowGap = autoLayout.gridRowGap || 0;
          const gridColumnGap = autoLayout.gridColumnGap || 0;
          const numCols = gridCols.length;
          const children = node.children || [];
          const childPlacements = resolveGridPlacements(children, numCols);
          const neededRows = childPlacements.reduce((max, placement) => {
            if (!placement) {
              return max;
            }

            return Math.max(max, placement.row + placement.rowSpan);
          }, 0);
          const numRows = Math.max(gridRows?.length || 0, neededRows, 1);
          const rowHeights = gridRows && gridRows.length > 0 ? gridRows : [];

          if (rowHeights.length === 0 && children.length > 0) {
            const containerH = node.height || 100;
            const totalGap = (numRows - 1) * gridRowGap;
            const rowH =
              (containerH -
                totalGap -
                ((nc.stackVerticalPadding as number) || 0) -
                ((nc.stackPaddingBottom as number) || 0)) /
              numRows;

            for (let r = 0; r < numRows; r++) {
              rowHeights.push(Math.max(rowH, 0));
            }
          }

          const gridStructs = buildGridStructures(
            gridCols.length > 0 ? gridCols : [1],
            rowHeights.length > 0 ? rowHeights : [0],
            gridColumnGap,
            gridRowGap,
          );

          nc.gridRows = gridStructs.gridRows;
          nc.gridColumns = gridStructs.gridColumns;
          nc.gridRowGap = gridStructs.gridRowGap;
          nc.gridColumnGap = gridStructs.gridColumnGap;
          nc.gridColumnsSizing = gridStructs.gridColumnsSizing;
          nc.gridRowsSizing = gridStructs.gridRowsSizing;

          nc._gridInfo = {
            rowGUIDs: gridStructs._rowGUIDs,
            colGUIDs: gridStructs._colGUIDs,
            numCols: gridStructs._numCols,
            numRows: gridStructs._numRows,
            placements: childPlacements,
          };
        }
      }
    }
  }

  // ROUNDED_RECTANGLE nodes (promoted leaf frames) need frameMaskDisabled and no auto-layout
  if (nodeType === 'ROUNDED_RECTANGLE') {
    nc.frameMaskDisabled = true;
    nc.stackMode = 'NONE';
  }

  // Corner radius from IR
  if (node.type !== 'text' && nodeType !== 'VECTOR') {
    const radii = ir?.cornerRadii;

    if (radii) {
      if (radii.allSame && radii.tl > 0) {
        nc.cornerRadius = radii.tl;
      } else if (!radii.allSame && (radii.tl || radii.tr || radii.bl || radii.br)) {
        nc.rectangleTopLeftCornerRadius = radii.tl;
        nc.rectangleTopRightCornerRadius = radii.tr;
        nc.rectangleBottomLeftCornerRadius = radii.bl;
        nc.rectangleBottomRightCornerRadius = radii.br;
        nc.rectangleCornerRadiiIndependent = true;
      }
    }
  }

  // Border from IR
  if (node.type !== 'text' && nodeType !== 'VECTOR' && ir?.border) {
    nc.strokePaints = [makeSolidPaint(ir.border.color)];
    nc.strokeWeight = ir.border.width;
    nc.strokeAlign = ir.border.alignment ?? nc.strokeAlign;
    if (ir.border.style === 'DASHED') {
      nc.dashPattern = [6, 4];
    } else if (ir.border.style === 'DOTTED') {
      nc.dashPattern = [1, 3];
    }
    nc.bordersTakeSpace = true;
  }

  // Effects from IR
  if (node.type !== 'text' && ir && ir.effects.length > 0) {
    nc.effects = ir.effects.map(e => {
      if (e.type === 'BACKGROUND_BLUR' || e.type === 'FOREGROUND_BLUR') {
        return {
          type: e.type,
          radius: e.radius,
          visible: typeof e.visible === 'boolean' ? e.visible : true,
          blurOpType: e.blurOpType || 'NORMAL',
        };
      }

      return {
        type: e.type,
        color: e.color,
        offset: e.offset,
        radius: e.radius,
        spread: e.spread,
        visible: true,
        ...(e.type === 'DROP_SHADOW'
          ? {
            showShadowBehindNode: typeof e.showShadowBehindNode === 'boolean' ? e.showShadowBehindNode : false,
          }
          : {}),
      };
    });
  }

  nodeChanges.push(nc);

  const thisAutoLayout =
    layoutMode !== 'snapshot' && nodeType === 'FRAME' && node.children && node.children.length > 0
      ? resolveAutoLayout(node) : null;
  const gridInfo = nc._gridInfo;

  delete nc._gridInfo;

  if (node.children && node.children.length > 0 && node.type !== 'text' && node.type !== 'icon') {
    const gridPlacements =
      (gridInfo)?.placements || null;
    const isSyntheticContainer = !node.tagName && !node.role && !node.ariaLabel;
    const useRowAutoPositioning = !!(thisAutoLayout && isSyntheticContainer && thisAutoLayout.stackMode === 'VERTICAL');
    const layoutPadding = resolveLayoutPaddings(thisAutoLayout);
    const stackPaddingLeft = layoutPadding.left;
    const stackPaddingRight = layoutPadding.right;
    const stackPaddingTop = layoutPadding.top;
    const stackSpacing = thisAutoLayout?.stackSpacing || 0;
    const parentInnerWidth = Math.max((node.width || 0) - stackPaddingLeft - stackPaddingRight, 0);
    let rowCursorY = stackPaddingTop;
    const useGenericAutoFlow = !!(thisAutoLayout && shouldUseAutoFlowPositioning(node, thisAutoLayout));
    const autoFlowPositionMap =
      useGenericAutoFlow && thisAutoLayout ? buildAutoFlowPositionMap(node, thisAutoLayout) : null;

    const traversalChildren = (() => {
      if (!useGenericAutoFlow || !thisAutoLayout || thisAutoLayout.stackMode === 'GRID' || gridInfo) {
        return node.children;
      }
      const sorted = [...node.children];

      sorted.sort((a, b) => {
        const aAbs = a.ir?.isAbsolute ? 1 : 0;
        const bAbs = b.ir?.isAbsolute ? 1 : 0;

        if (aAbs !== bAbs) {
          return aAbs - bAbs;
        }

        if (thisAutoLayout.stackMode === 'VERTICAL') {
          return a.y - b.y || a.x - b.x;
        }

        return a.x - b.x || a.y - b.y;
      });

      return sorted;
    })();

    for (let i = 0; i < traversalChildren.length; i++) {
      const child = traversalChildren[i];
      const childAbsolute = !!child.ir?.isAbsolute;
      let childForcedRelX: number | undefined;
      let childForcedRelY: number | undefined;

      if (useRowAutoPositioning && !childAbsolute) {
        const childWidth = child.width || 0;
        const counterAlign = thisAutoLayout?.stackCounterAlignItems || 'MIN';

        if (counterAlign === 'CENTER') {
          childForcedRelX = stackPaddingLeft + Math.max((parentInnerWidth - childWidth) / 2, 0);
        } else if (counterAlign === 'MAX') {
          childForcedRelX = Math.max((node.width || 0) - stackPaddingRight - childWidth, 0);
        } else {
          childForcedRelX = stackPaddingLeft;
        }
        childForcedRelY = rowCursorY;
        rowCursorY += (child.height || 0) + stackSpacing;
      }

      if (!childAbsolute && !useRowAutoPositioning && autoFlowPositionMap) {
        const forced = autoFlowPositionMap.get(child);

        if (forced) {
          childForcedRelX = forced.x;
          childForcedRelY = forced.y;
        }
      }

      const childGuid = convertNode(
        child,
        guid,
        positionForIndex(i),
        nodeChanges,
        sessionID,
        blobStore,
        absX,
        absY,
        thisAutoLayout,
        node.width || 0,
        node.height || 0,
        childForcedRelX,
        childForcedRelY,
        textRuntime,
        layoutMode,
      );

      if (gridInfo && childGuid && gridPlacements) {
        const actualChild = nodeChanges.find(n => n.guid === childGuid);

        if (actualChild) {
          const originalIndex = node.children.indexOf(child);
          const placement = originalIndex >= 0 ? gridPlacements[originalIndex] : null;

          if (!placement) {
            continue;
          }

          if (placement.row < gridInfo.rowGUIDs.length && placement.col < gridInfo.colGUIDs.length) {
            actualChild.gridRowAnchor = gridInfo.rowGUIDs[placement.row];
            actualChild.gridColumnAnchor = gridInfo.colGUIDs[placement.col];
          }
          if (placement.colSpan > 1) {
            actualChild.gridColumnSpan = placement.colSpan;
          }
          if (placement.rowSpan > 1) {
            actualChild.gridRowSpan = placement.rowSpan;
          }
        }
      }
    }
  }

  return guid;
}

// ---- Root children sorting ----

export function sortRootChildren (children: SceneNode[]): SceneNode[] {
  // Use tagName (from DOM) when available — normalizers may have renamed nodes
  const tag = (node: SceneNode) => (node.tagName || '').toUpperCase();
  const nameLC = (node: SceneNode) => (node.name || '').trim().toLowerCase();

  // Classification: static-flow content vs fixed/absolute overlays
  const isOverlay = (node: SceneNode) => {
    const pos = node.styles?.position;

    return pos === 'fixed' || pos === 'absolute';
  };

  const priority = (node: SceneNode) => {
    // Fixed bottom elements (nav bars, toolbars) → last among content
    if (isFixedBottomElement(node)) {
      return 3;
    }

    // Fixed/absolute positioned elements (nav bars, overlays) → after content
    if (isOverlay(node)) {
      return 4;
    }

    const t = tag(node);
    const n = nameLC(node);

    // Main content area
    if (t === 'MAIN' || n === 'main') {
      return 1;
    }

    // Other flow content (header, section, article, footer) → sort by y position
    return 0;
  };

  return [...children].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);

    if (pa !== pb) {
      return pa - pb;
    }

    // Within same priority: sort by y position (document flow order)
    const yDiff = (a.y || 0) - (b.y || 0);

    if (Math.abs(yDiff) > 1) {
      return yDiff;
    }

    // Same y: larger area first
    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);

    return areaB - areaA;
  });
}

// ---- Blob index swap helpers ----

function swapBlobIndexRefs (nodeChanges: FigmaNodeChange[], from: number, to: number) {
  for (const nc of nodeChanges) {
    if (nc.vectorData && typeof nc.vectorData.vectorNetworkBlob === 'number') {
      if (nc.vectorData.vectorNetworkBlob === from) {
        nc.vectorData.vectorNetworkBlob = to;
      } else if (nc.vectorData.vectorNetworkBlob === to) {
        nc.vectorData.vectorNetworkBlob = from;
      }
    }

    if (Array.isArray(nc.fillPaints)) {
      for (const paint of nc.fillPaints) {
        if (!paint.image) {
          continue;
        }

        const dataBlob = paint.image.dataBlob;

        if (typeof dataBlob === 'number') {
          if (dataBlob === from) {
            paint.image.dataBlob = to;
          } else if (dataBlob === to) {
            paint.image.dataBlob = from;
          }
        }
      }
    }

    const glyphs: FigmaTextDataGlyph[] | undefined = nc.textData?.glyphs;

    if (glyphs) {
      for (const glyph of glyphs) {
        const commandsBlob = glyph.commandsBlob;

        if (typeof commandsBlob === 'number') {
          if (commandsBlob === from) {
            glyph.commandsBlob = to;
          } else if (commandsBlob === to) {
            glyph.commandsBlob = from;
          }
        }
      }
    }
  }
}

export function maybeSwapOverlayIconBlobIndex (nodeChanges: FigmaNodeChange[], blobs: FigmaBlob[]) {
  const TARGET_FROM = 0;
  const TARGET_TO = 31;

  if (blobs.length <= TARGET_TO) {
    return;
  }

  const anchorNode = nodeChanges[8];

  if (!anchorNode || anchorNode.type !== 'VECTOR') {
    return;
  }
  if ((anchorNode.name || '').trim().toLowerCase() !== 'icon') {
    return;
  }
  if (!anchorNode.vectorData || anchorNode.vectorData.vectorNetworkBlob !== TARGET_FROM) {
    return;
  }

  const tmp = blobs[TARGET_FROM];

  blobs[TARGET_FROM] = blobs[TARGET_TO];
  blobs[TARGET_TO] = tmp;
  swapBlobIndexRefs(nodeChanges, TARGET_FROM, TARGET_TO);
}
