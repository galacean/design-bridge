import { spec, generateGUID } from '@galacean/effects';
import type { FigmaIRFill, FigmaIRGradientPaint, FigmaIRNode, FigmaIRPath, FigmaIRStroke } from '../ir/figma-ir';
import type { ConversionDebugMap, ConversionIssue, ConvertOptions, EffectsScene } from '../types';
import { buildTimeline } from './timeline-builder';

const DEFAULT_COMPOSITION_DURATION = 5;

// ── Image Blob Helpers ──

function isImageBlob(bytes: Uint8Array): boolean {
  if (bytes.length < 2) {
    return false;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return true;
  } // PNG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return true;
  } // JPEG
  if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    return true;
  } // GIF
  if (bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return true;
  } // WebP

  return false;
}

function detectImageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    return 'image/gif';
  }
  if (bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    return 'image/webp';
  }

  return 'image/png'; // best-effort fallback
}

// ── Blend Mode Mapping ──

const FIGMA_TO_GE_BLENDING: Record<string, number> = {
  NORMAL: 0,
  PASS_THROUGH: 0,
  MULTIPLY: 1,
  SCREEN: 2,
  OVERLAY: 3,
  DARKEN: 4,
  LIGHTEN: 5,
  COLOR_DODGE: 6,
  COLOR_BURN: 7,
  HARD_LIGHT: 8,
  SOFT_LIGHT: 9,
  DIFFERENCE: 10,
  EXCLUSION: 11,
  HUE: 12,
  SATURATION: 13,
  COLOR: 14,
  LUMINOSITY: 15,
};

function mapBlendMode(mode: string | undefined): number {
  if (mode === undefined || mode.length === 0) {
    return 0;
  }

  return FIGMA_TO_GE_BLENDING[mode] ?? 0;
}

function mapAlignToFlex(align: string): string {
  switch (align) {
    case 'MIN':
      return 'flex-start';
    case 'CENTER':
      return 'center';
    case 'MAX':
      return 'flex-end';
    case 'SPACE_BETWEEN':
      return 'space-between';
    case 'SPACE_EVENLY':
      return 'space-evenly';
    case 'STRETCH':
      return 'stretch';
    case 'BASELINE':
      return 'baseline';
    default:
      return 'flex-start';
  }
}

// ── Camera & Coordinate Helpers ──

const CAMERA_Z = 8;
const CAMERA_FOV = 60;
/** Visible world-space height at z=0 for the default camera. */
const WORLD_HEIGHT = 2 * CAMERA_Z * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

/** Figma types that map to GE ShapeComponent with built-in primitives. */
const SHAPE_FIGMA_TYPES = new Set(['STAR', 'ELLIPSE', 'REGULAR_POLYGON', 'RECTANGLE', 'ROUNDED_RECTANGLE']);

/** Figma types that can map to GE ShapeComponent.Custom when fillPaths are available. */
const VECTOR_FIGMA_TYPES = new Set(['VECTOR', 'LINE', 'BOOLEAN_OPERATION']);

function isShapeNode(node: FigmaIRNode): boolean {
  // Use shape rendering for vector/shape nodes that do NOT have an image fill.
  // Image-filled shapes keep sprite rendering so the texture is displayed.
  const hasImageFill = node.fills?.some(f => f.visible !== false && f.type === 'image') ?? false;

  if (hasImageFill || node.imageRef !== undefined) {
    return false;
  }
  if (SHAPE_FIGMA_TYPES.has(node.figmaType)) {
    return true;
  }
  // VECTOR/LINE/BOOLEAN_OPERATION with parsed geometry paths → custom shape
  if (VECTOR_FIGMA_TYPES.has(node.figmaType) && (node.fillPaths || node.strokePaths)) {
    return true;
  }

  return false;
}

function isContainerNode(node: FigmaIRNode): boolean {
  if (node.kind !== 'frame' && node.kind !== 'group') {
    return false;
  }
  // A group is always a pure container
  if (node.kind === 'group') {
    return true;
  }
  // A frame is a container if it has no visual content
  const hasImage =
    node.imageRef !== undefined || (node.fills?.some(f => f.visible !== false && f.type === 'image') ?? false);

  if (hasImage) {
    return false;
  }

  return node.fillColor === undefined && node.fillGradient === undefined;
}

/**
 * Determines if a frame node should be rendered as a ShapeComponent (Rectangle)
 * instead of a SpriteComponent. This is used for:
 *   - Frames with gradient fills – ShapeComponent's `fills` array renders
 *     gradients natively, while SpriteComponent has limited gradient support.
 *   - Frames with clipContent that have fills – proper roundness + clipping.
 *   - Frames with corner radius and fills – same benefit.
 */
function isFrameShape(node: FigmaIRNode): boolean {
  if (node.kind !== 'frame') {
    return false;
  }
  // Image-filled frames stay as sprites so the texture is displayed
  const hasImage =
    node.imageRef !== undefined || (node.fills?.some(f => f.visible !== false && f.type === 'image') ?? false);

  if (hasImage) {
    return false;
  }

  // Frames with gradient fills are always rendered as shapes
  if (node.fillGradient !== undefined) {
    return true;
  }

  // Only promote to shape when the frame has visual fills AND needs shape features
  const hasFill = node.fillColor !== undefined;

  if (!hasFill) {
    return false;
  }

  return node.clipContent === true || (node.cornerRadius != null && node.cornerRadius > 0);
}

function toItemType(node: FigmaIRNode): spec.ItemType {
  if (node.kind === 'text') {
    return spec.ItemType.text;
  }
  if (isShapeNode(node)) {
    return spec.ItemType.shape;
  }
  if (isContainerNode(node)) {
    return spec.ItemType.null;
  }
  if (isFrameShape(node)) {
    return spec.ItemType.shape;
  }
  if (node.kind === 'frame' || node.kind === 'group' || node.kind === 'vector' || node.kind === 'shape') {
    return spec.ItemType.sprite;
  }

  return spec.ItemType.null;
}

/**
 * @param parentRef - [parentCenterX, parentCenterY] in Figma pixel coordinates.
 *   For root items this is the bounding box center of all root nodes;
 *   for child items it is [parent.x + parent.width/2, parent.y + parent.height/2].
 *   Both axes use center-to-center offset, with Y negated for GE's Y-up convention.
 */
function createItem(
  node: FigmaIRNode,
  id: string,
  parentRef: [number, number],
  compositionDuration: number,
  pxToWorld: number,
  parentId?: string,
): spec.VFXItemData {
  const options: Record<string, unknown> = {
    ...(typeof node.cornerRadius === 'number' && { cornerRadius: node.cornerRadius }),
    ...(node.cornerRadii !== undefined && { cornerRadii: node.cornerRadii }),
    ...(typeof node.cornerSmoothing === 'number' && { cornerSmoothing: node.cornerSmoothing }),
    ...(typeof node.strokeWidth === 'number' && { strokeWidth: node.strokeWidth }),
    ...(node.strokeColor !== undefined && { strokeColor: node.strokeColor }),
    ...(node.clipContent === true && { clipContent: true }),
  };

  // Stroke details from first visible stroke
  const strokes = node.strokes ?? [];

  if (strokes.length > 0) {
    const firstStroke = strokes.find(s => s.visible !== false);

    if (firstStroke !== undefined) {
      if (firstStroke.cap !== undefined) {
        options.strokeCap = firstStroke.cap.toLowerCase();
      }
      if (firstStroke.join !== undefined) {
        options.strokeJoin = firstStroke.join.toLowerCase();
      }
      if ((firstStroke.dashPattern?.length ?? 0) > 0) {
        options.dashPattern = firstStroke.dashPattern;
      }
      if (firstStroke.align !== undefined) {
        options.strokeAlign = firstStroke.align.toLowerCase();
      }
    }
  }

  // Auto-layout → flexbox-like options
  if (node.autoLayout) {
    const al = node.autoLayout;

    options.flexDirection = al.direction === 'HORIZONTAL' ? 'row' : 'column';
    options.gap = al.spacing;
    if (al.counterSpacing !== undefined) {
      options.rowGap = al.counterSpacing;
    }
    options.paddingTop = al.paddingTop;
    options.paddingRight = al.paddingRight;
    options.paddingBottom = al.paddingBottom;
    options.paddingLeft = al.paddingLeft;
    options.justifyContent = mapAlignToFlex(al.primaryAlign);
    options.alignItems = mapAlignToFlex(al.counterAlign);
    if (al.wrap === true) {
      options.flexWrap = 'wrap';
    }
    if (al.primarySizing !== undefined) {
      options.primarySizing = al.primarySizing.toLowerCase();
    }
    if (al.counterSizing !== undefined) {
      options.counterSizing = al.counterSizing.toLowerCase();
    }
  }

  // Effects → shadows / blur
  const effects = node.effects ?? [];

  if (effects.length > 0) {
    const shadows = effects
      .filter(e => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
      .map(e => ({
        type: e.type === 'DROP_SHADOW' ? 'dropShadow' : 'innerShadow',
        color: e.color ?? [0, 0, 0, 0.25],
        offset: e.offset ?? { x: 0, y: 0 },
        radius: e.radius,
        ...(e.spread !== undefined ? { spread: e.spread } : {}),
      }));

    const blurs = effects
      .filter(e => e.visible && (e.type === 'FOREGROUND_BLUR' || e.type === 'BACKGROUND_BLUR'))
      .map(e => ({
        type: e.type === 'BACKGROUND_BLUR' ? 'backgroundBlur' : 'blur',
        radius: e.radius,
      }));

    if (shadows.length) {
      options.shadows = shadows;
    }
    if (blurs.length) {
      options.blur = blurs[0];
    }
  }

  const w = Math.max(0, node.width);
  const h = Math.max(0, node.height);

  return {
    id,
    dataType: spec.DataType.VFXItemData,
    name: node.name,
    type: toItemType(node),
    duration: compositionDuration,
    endBehavior: spec.EndBehavior.freeze,
    delay: 0,
    renderLevel: spec.RenderLevel.BPlus,
    parentId,
    visible: node.visible,
    components: [],
    transform: {
      position: {
        x: (node.x + w / 2 - parentRef[0]) * pxToWorld,
        y: -(node.y + h / 2 - parentRef[1]) * pxToWorld || 0,
        z: 0,
      },
      eulerHint: { x: 0, y: 0, z: node.rotation ?? 0 },
      scale: { x: 1, y: 1, z: 1 },
      size: { x: w * pxToWorld, y: h * pxToWorld },
      anchor: { x: 0, y: 0 },
    },
    content: { options },
  };
}

function createComposition(
  compositionId: string,
  previewSize: [number, number],
  options: ConvertOptions,
): spec.CompositionData {
  return {
    id: compositionId,
    name: options.compositionName ?? 'FigmaMainComposition',
    duration: options.compositionDuration ?? DEFAULT_COMPOSITION_DURATION,
    startTime: 0,
    endBehavior: spec.EndBehavior.freeze,
    previewSize,
    camera: {
      fov: CAMERA_FOV,
      far: 40,
      near: 0.1,
      position: [0, 0, CAMERA_Z],
      rotation: [0, 0, 0],
      clipMode: 1,
    },
    components: [],
  };
}

function createSpriteComponent(
  componentId: string,
  itemId: string,
  options: {
    fillColor?: [number, number, number, number];
    fillGradient?: FigmaIRGradientPaint;
    strokeColor?: [number, number, number, number];
    strokeWidth?: number;
    textureId?: string;
    imageScaleMode?: string;
    opacity?: number;
    blendMode?: string;
    fills?: FigmaIRFill[];
    additionalFills?: Array<{ textureId: string; imageScaleMode?: string }>;
  },
): spec.SpriteComponentData {
  const renderer: Record<string, unknown> = {
    renderMode: 1,
  };

  if (options.textureId !== undefined) {
    renderer.texture = { id: options.textureId };
  }

  const blending = mapBlendMode(options.blendMode);

  if (blending !== 0) {
    renderer.blending = blending;
  }

  const startColor: [number, number, number, number] = [...(options.fillColor ?? [1, 1, 1, 1])] as [
    number,
    number,
    number,
    number,
  ];

  if (options.opacity !== undefined && options.opacity < 1) {
    startColor[3] *= options.opacity;
  }

  const component: spec.SpriteComponentData = {
    id: componentId,
    dataType: spec.DataType.SpriteComponent,
    item: { id: itemId },
    renderer,
    options: {
      startColor,
      ...(typeof options.strokeWidth === 'number' ? { strokeWidth: options.strokeWidth } : {}),
      ...(options.strokeColor ? { strokeColor: options.strokeColor } : {}),
    },
  };

  if (options.fillGradient !== undefined) {
    (component.options as Record<string, unknown>).gradient = {
      type: options.fillGradient.type,
      stops: options.fillGradient.stops,
      ...(options.fillGradient.handles ? { handles: options.fillGradient.handles } : {}),
    };
  }

  if (options.imageScaleMode !== undefined) {
    (component.options as Record<string, unknown>).imageScaleMode = options.imageScaleMode;
  }

  if (options.additionalFills && options.additionalFills.length > 0) {
    (component.options as Record<string, unknown>).additionalFills = options.additionalFills;
  }

  // Store all visible fills metadata for downstream consumers
  if (options.fills && options.fills.length > 1) {
    (component.options as Record<string, unknown>).fills = options.fills.map(f => ({
      type: f.type,
      ...(f.color ? { color: f.color } : {}),
      ...(f.gradient ? { gradient: f.gradient } : {}),
      ...(f.imageRef != null ? { imageRef: f.imageRef } : {}),
      ...(f.imageScaleMode ? { imageScaleMode: f.imageScaleMode } : {}),
      ...(f.opacity !== undefined && f.opacity !== 1 ? { opacity: f.opacity } : {}),
    }));
  }

  return component;
}

function createTextComponent(
  componentId: string,
  itemId: string,
  node: FigmaIRNode,
  pxToWorld: number,
): spec.TextComponentData {
  const textColor = node.textColor ?? [1, 1, 1, 1];

  const renderer: Record<string, unknown> = {
    renderMode: 1,
  };

  const blending = mapBlendMode(node.blendMode);

  if (blending !== 0) {
    renderer.blending = blending;
  }

  const textW = Math.max(1, node.width || 1);
  const textH = Math.max(1, node.height || 20);
  // Add a small width buffer to compensate for font metric differences
  // between the Figma source font and the runtime rendering font.
  const textWPadded = Math.ceil(textW * 1.05);

  return {
    id: componentId,
    dataType: spec.DataType.TextComponent,
    item: { id: itemId },
    renderer,
    options: {
      text: node.text ?? '',
      fontSize: node.textFontSize ?? 14,
      textWidth: textWPadded,
      textHeight: textH,
      // Figma bakes explicit line breaks into the text string; disable
      // GE auto-wrap to avoid font-metric-induced overflow when the
      // rendering font differs from the original Figma font.
      textOverflow: 1, // TextOverflow.display
      lineHeight: node.textLineHeight ?? 18,
      textColor: [textColor[0], textColor[1], textColor[2], textColor[3] * node.opacity],
      fontFamily: node.textFontFamily ?? 'sans-serif',
      size: [textW * pxToWorld, textH * pxToWorld],
      ...(typeof node.textFontWeight === 'number' ? { fontWeight: node.textFontWeight } : {}),
      ...(node.textAlignHorizontal !== undefined ? { textAlign: node.textAlignHorizontal.toLowerCase() } : {}),
      ...(node.textAlignVertical !== undefined ? { verticalAlign: node.textAlignVertical.toLowerCase() } : {}),
      ...(node.textDecoration !== undefined && node.textDecoration !== 'NONE'
        ? { textDecoration: node.textDecoration.toLowerCase() }
        : {}),
      ...(typeof node.letterSpacing === 'number' ? { letterSpacing: node.letterSpacing } : {}),
    },
  } as spec.TextComponentData;
}

// ── Shape Component Helpers ──

const STROKE_CAP_TO_LINE_CAP: Record<string, spec.LineCap> = {
  NONE: spec.LineCap.Butt,
  ROUND: spec.LineCap.Round,
  SQUARE: spec.LineCap.Square,
};
const STROKE_JOIN_TO_LINE_JOIN: Record<string, spec.LineJoin> = {
  MITER: spec.LineJoin.Miter,
  BEVEL: spec.LineJoin.Bevel,
  ROUND: spec.LineJoin.Round,
};

function irFillToPaintData(fill: FigmaIRFill): spec.PaintData | undefined {
  if (fill.visible === false) {
    return undefined;
  }
  if (fill.type === 'solid' && fill.color) {
    return {
      type: spec.FillType.Solid,
      color: { r: fill.color[0], g: fill.color[1], b: fill.color[2], a: fill.color[3] },
    };
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const g = fill.gradient;
    const gradientStops: spec.GradientStop[] = g.stops.map(s => [
      s.position,
      s.color[0],
      s.color[1],
      s.color[2],
      s.color[3],
    ]);
    const fillTypeMap: Record<string, spec.FillType> = {
      linear: spec.FillType.GradientLinear,
      radial: spec.FillType.GradientRadial,
      angular: spec.FillType.GradientAngular,
    };
    const startPoint = g.handles?.[0] ?? { x: 0, y: 0.5 };
    const endPoint = g.handles?.[1] ?? { x: 1, y: 0.5 };

    return {
      type: fillTypeMap[g.type] ?? spec.FillType.GradientLinear,
      gradientStops: [spec.ValueType.GRADIENT_COLOR, gradientStops],
      startPoint,
      endPoint,
    } as spec.GradientPaintData;
  }

  return undefined;
}

function irStrokeToPaintData(stroke: FigmaIRStroke): spec.PaintData | undefined {
  if (stroke.visible === false) {
    return undefined;
  }
  if (stroke.type === 'solid' && stroke.color) {
    return {
      type: spec.FillType.Solid,
      color: { r: stroke.color[0], g: stroke.color[1], b: stroke.color[2], a: stroke.color[3] },
    };
  }
  if (stroke.type === 'gradient' && stroke.gradient) {
    const g = stroke.gradient;
    const gradientStops: spec.GradientStop[] = g.stops.map(s => [
      s.position,
      s.color[0],
      s.color[1],
      s.color[2],
      s.color[3],
    ]);
    const fillTypeMap: Record<string, spec.FillType> = {
      linear: spec.FillType.GradientLinear,
      radial: spec.FillType.GradientRadial,
      angular: spec.FillType.GradientAngular,
    };
    const startPoint = g.handles?.[0] ?? { x: 0, y: 0.5 };
    const endPoint = g.handles?.[1] ?? { x: 1, y: 0.5 };

    return {
      type: fillTypeMap[g.type] ?? spec.FillType.GradientLinear,
      gradientStops: [spec.ValueType.GRADIENT_COLOR, gradientStops],
      startPoint,
      endPoint,
    } as spec.GradientPaintData;
  }

  return undefined;
}

function figmaTypeToShapePrimitive(node: FigmaIRNode): spec.ShapePrimitiveType {
  switch (node.figmaType) {
    case 'STAR':
      return spec.ShapePrimitiveType.Star;
    case 'ELLIPSE':
      return spec.ShapePrimitiveType.Ellipse;
    case 'REGULAR_POLYGON':
      return spec.ShapePrimitiveType.Polygon;
    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
      return spec.ShapePrimitiveType.Rectangle;
    default:
      return spec.ShapePrimitiveType.Custom;
  }
}

// ── Custom Shape Path Conversion ──

interface CustomShapeResult {
  points: Array<{ x: number; y: number }>;
  easingIns: Array<{ x: number; y: number }>;
  easingOuts: Array<{ x: number; y: number }>;
  shapes: Array<{
    indexes: Array<{ point: number; easingIn: number; easingOut: number }>;
    close: boolean;
  }>;
}

/**
 * Convert IR fill/stroke paths into GE CustomShapeData arrays.
 * Path coordinates are in Figma pixels relative to the node's top-left origin.
 * We center them to [-w/2, w/2] x [-h/2, h/2] and scale by pxToWorld for world units.
 */
function irPathsToCustomShapeData(
  paths: FigmaIRPath[],
  nodeWidth: number,
  nodeHeight: number,
  pxToWorld: number,
): CustomShapeResult {
  const points: Array<{ x: number; y: number }> = [];
  const easingIns: Array<{ x: number; y: number }> = [];
  const easingOuts: Array<{ x: number; y: number }> = [];
  const shapes: CustomShapeResult['shapes'] = [];

  // Center offset: move origin from top-left to center of node
  const cx = nodeWidth / 2;
  const cy = nodeHeight / 2;

  // Helper: convert Figma pixel coord to GE world coord (Y-flipped)
  const wx = (px: number): number => (px - cx) * pxToWorld;
  const wy = (py: number): number => -(py - cy) * pxToWorld;

  for (const path of paths) {
    let currentShapeIndexes: Array<{ point: number; easingIn: number; easingOut: number }> = [];
    let lastPointIdx = -1;

    for (const cmd of path.commands) {
      if (cmd.type === 'M') {
        // Start a new sub-path; if we had a previous one open, push it
        if (currentShapeIndexes.length > 0) {
          shapes.push({ indexes: currentShapeIndexes, close: false });
        }
        currentShapeIndexes = [];
        const ptIdx = points.length;

        points.push({ x: wx(cmd.x), y: wy(cmd.y) });
        easingIns.push({ x: 0, y: 0 });
        easingOuts.push({ x: 0, y: 0 });
        currentShapeIndexes.push({ point: ptIdx, easingIn: ptIdx, easingOut: ptIdx });
        lastPointIdx = ptIdx;
      } else if (cmd.type === 'L') {
        const ptIdx = points.length;

        points.push({ x: wx(cmd.x), y: wy(cmd.y) });
        easingIns.push({ x: 0, y: 0 });
        easingOuts.push({ x: 0, y: 0 });
        currentShapeIndexes.push({ point: ptIdx, easingIn: ptIdx, easingOut: ptIdx });
        lastPointIdx = ptIdx;
      } else if (cmd.type === 'C') {
        // Cubic bezier: set the outgoing control of the previous point
        // and the incoming control of this point (as relative offsets).
        const ptIdx = points.length;
        const endX = wx(cmd.x);
        const endY = wy(cmd.y);

        points.push({ x: endX, y: endY });

        // easingOut of previous point = control point 1 offset (relative to previous anchor)
        if (lastPointIdx >= 0) {
          const lastPt = points[lastPointIdx];

          easingOuts[lastPointIdx] = {
            x: wx(cmd.cp1x) - lastPt.x,
            y: wy(cmd.cp1y) - lastPt.y,
          };
        }
        // easingIn of this point = control point 2 offset (relative to this anchor)
        easingIns.push({
          x: wx(cmd.cp2x) - endX,
          y: wy(cmd.cp2y) - endY,
        });
        easingOuts.push({ x: 0, y: 0 });

        currentShapeIndexes.push({ point: ptIdx, easingIn: ptIdx, easingOut: ptIdx });
        lastPointIdx = ptIdx;
      } else if (cmd.type === 'Z') {
        // Close path — push the accumulated sub-path
        if (currentShapeIndexes.length > 0) {
          shapes.push({ indexes: currentShapeIndexes, close: true });
        }
        currentShapeIndexes = [];
        lastPointIdx = -1;
      }
    }

    // Flush any remaining open sub-path
    if (currentShapeIndexes.length > 0) {
      shapes.push({ indexes: currentShapeIndexes, close: false });
    }
  }

  return { points, easingIns, easingOuts, shapes };
}

function createShapeComponent(
  componentId: string,
  itemId: string,
  node: FigmaIRNode,
  pxToWorld: number,
): spec.ComponentData {
  const fills: spec.PaintData[] = [];
  const strokes: spec.PaintData[] = [];

  for (const fill of node.fills ?? []) {
    const paint = irFillToPaintData(fill);

    if (paint) {
      fills.push(paint);
    }
  }
  for (const stroke of node.strokes ?? []) {
    const paint = irStrokeToPaintData(stroke);

    if (paint) {
      strokes.push(paint);
    }
  }

  const shapeType = figmaTypeToShapePrimitive(node);

  const base: Record<string, unknown> = {
    id: componentId,
    dataType: spec.DataType.ShapeComponent,
    item: { id: itemId },
    type: shapeType,
    fills,
    strokes,
  };

  // Stroke styling — strokeWidth must be in world units
  if (typeof node.strokeWidth === 'number' && node.strokeWidth > 0) {
    base.strokeWidth = node.strokeWidth * pxToWorld;
  }
  const firstStroke = node.strokes?.find(s => s.visible !== false);

  if (firstStroke?.cap) {
    base.strokeCap = STROKE_CAP_TO_LINE_CAP[firstStroke.cap] ?? spec.LineCap.Butt;
  }
  if (firstStroke?.join) {
    base.strokeJoin = STROKE_JOIN_TO_LINE_JOIN[firstStroke.join] ?? spec.LineJoin.Miter;
  }

  // Blending
  const blending = mapBlendMode(node.blendMode);

  if (blending !== 0) {
    base.renderer = { blending };
  }

  // Shape-specific parameters — all dimensions in world units.
  // GE's ShapeComponent uses vertex positions directly in world space,
  // unlike SpriteComponent which multiplies by transform.size.
  const w = Math.max(0, node.width) * pxToWorld;
  const h = Math.max(0, node.height) * pxToWorld;

  if (shapeType === spec.ShapePrimitiveType.Rectangle) {
    base.width = w;
    base.height = h;
    // GE treats roundness as a percentage (0-100): actual radius = (roundness/100) * min(halfW, halfH)
    // Figma's cornerRadius is in absolute pixels, so convert to percentage.
    const maxRound = Math.min(node.width, node.height) / 2;

    base.roundness =
      maxRound > 0 && node.cornerRadius != null ? Math.min((node.cornerRadius / maxRound) * 100, 100) : 0;
  } else if (shapeType === spec.ShapePrimitiveType.Ellipse) {
    base.xRadius = w / 2;
    base.yRadius = h / 2;
  } else if (shapeType === spec.ShapePrimitiveType.Polygon) {
    base.pointCount = node.shapePointCount ?? 3;
    base.radius = Math.min(w, h) / 2;
    base.roundness = 0;
  } else if (shapeType === spec.ShapePrimitiveType.Star) {
    const outerRadius = Math.min(w, h) / 2;
    const innerScale = node.starInnerScale ?? 0.382;

    base.pointCount = node.shapePointCount ?? 5;
    base.outerRadius = outerRadius;
    base.innerRadius = outerRadius * innerScale;
    base.outerRoundness = 0;
    base.innerRoundness = 0;
  } else if (shapeType === spec.ShapePrimitiveType.Custom) {
    // Convert IR fill paths (and stroke paths if no fill) to CustomShapeData.
    // Points are in Figma pixels relative to node origin; convert to world units
    // centered around local origin (item center).
    const usingStrokeGeometry = !node.fillPaths && !!node.strokePaths;
    const sourcePaths = node.fillPaths ?? node.strokePaths ?? [];
    const customData = irPathsToCustomShapeData(sourcePaths, node.width, node.height, pxToWorld);

    base.points = customData.points;
    base.easingIns = customData.easingIns;
    base.easingOuts = customData.easingOuts;
    base.shapes = customData.shapes;

    // When using expanded stroke geometry as the path, the outline is already
    // at the correct width/cap/join. Render it as a filled shape using the
    // stroke color, and clear the stroke to avoid doubling.
    if (usingStrokeGeometry && fills.length === 0 && strokes.length > 0) {
      base.fills = strokes;
      base.strokes = [];
      delete base.strokeWidth;
    }
  }

  return base as unknown as spec.ComponentData;
}

export function buildSceneFromIR(
  nodes: FigmaIRNode[],
  options: ConvertOptions = {},
  blobs: Uint8Array[] = [],
  imagesByHash?: Map<string, Uint8Array>,
): { scene: EffectsScene; issues: ConversionIssue[]; debugMap: ConversionDebugMap } {
  const compositionDuration = options.compositionDuration ?? DEFAULT_COMPOSITION_DURATION;
  const items: spec.VFXItemData[] = [];
  const components: spec.ComponentData[] = [];
  const images: spec.ImageSource[] = [];
  const textures: spec.TextureDefine[] = [];
  const issues: ConversionIssue[] = [];
  const debugMap: ConversionDebugMap = {};
  const imageRefToTextureId = new Map<string, string>();
  const usedBlobIndices = new Set<number>();

  const includeInvisible = options.includeInvisibleNodes ?? false;

  // Compute pixel-to-world conversion from the bounding box of all root nodes.
  // GE uses world units; camera at z=8, fov=60 gives ~9.24 world units of visible height.
  let bboxMinX = Infinity;
  let bboxMinY = Infinity;
  let bboxMaxX = -Infinity;
  let bboxMaxY = -Infinity;

  for (const node of nodes) {
    if (node.width > 0 && node.height > 0) {
      bboxMinX = Math.min(bboxMinX, node.x);
      bboxMinY = Math.min(bboxMinY, node.y);
      bboxMaxX = Math.max(bboxMaxX, node.x + node.width);
      bboxMaxY = Math.max(bboxMaxY, node.y + node.height);
    }
  }
  const designWidth = Number.isFinite(bboxMinX) ? bboxMaxX - bboxMinX : 0;
  const designHeight = Number.isFinite(bboxMinY) ? bboxMaxY - bboxMinY : 0;
  const bboxCenterX = Number.isFinite(bboxMinX) ? bboxMinX + designWidth / 2 : 0;
  const bboxCenterY = Number.isFinite(bboxMinY) ? bboxMinY + designHeight / 2 : 0;
  const pxToWorld = designHeight > 0 ? WORLD_HEIGHT / designHeight : 1;

  const getOrCreateTextureIdForImageRef = (imageRef: string, blobIndex?: number): string | undefined => {
    const cached = imageRefToTextureId.get(imageRef);

    if (cached !== undefined) {
      return cached;
    }

    // Priority 1: hash-keyed image map (from .fig ZIP images/ directory)
    let bytes: Uint8Array | undefined;

    if (imagesByHash) {
      bytes = imagesByHash.get(imageRef);
    }

    // Priority 2: positional blob index (from clipboard/decoded JSON blobs)
    if (
      !bytes &&
      blobIndex !== undefined &&
      blobIndex >= 0 &&
      blobIndex < blobs.length &&
      isImageBlob(blobs[blobIndex])
    ) {
      bytes = blobs[blobIndex];
    }

    // Priority 3: scan blobs for an unused image
    if (!bytes) {
      for (let i = 0; i < blobs.length; i++) {
        if (blobs[i].length > 0 && isImageBlob(blobs[i]) && !usedBlobIndices.has(i)) {
          bytes = blobs[i];
          blobIndex = i;

          break;
        }
      }
    }
    if (!bytes) {
      return undefined;
    }
    if (blobIndex !== undefined) {
      usedBlobIndices.add(blobIndex);
    }

    const imageId = generateGUID();
    const textureId = generateGUID();
    const mime = detectImageMime(bytes);

    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));

    images.push({ id: imageId, url });
    textures.push({
      id: textureId,
      dataType: spec.DataType.Texture,
      source: { id: imageId },
      flipY: true,
    });

    imageRefToTextureId.set(imageRef, textureId);

    return textureId;
  };

  const walk = (node: FigmaIRNode, parentRef: [number, number], parentId?: string): string | null => {
    const mappedComponentIds: string[] = [];

    if (!includeInvisible && !node.visible) {
      debugMap[node.id] = {
        figmaNodeId: node.id,
        figmaNodeName: node.name,
        componentIds: [],
        skipped: true,
        reason: 'invisible-node',
      };

      return null;
    }

    const itemId = generateGUID();
    const item = createItem(node, itemId, parentRef, compositionDuration, pxToWorld, parentId);

    if (node.kind === 'text') {
      const component = createTextComponent(generateGUID(), itemId, node, pxToWorld);

      components.push(component);
      item.components.push({ id: component.id });
      mappedComponentIds.push(component.id);
    } else if (isShapeNode(node)) {
      const component = createShapeComponent(generateGUID(), itemId, node, pxToWorld);

      components.push(component);
      item.components.push({ id: component.id });
      mappedComponentIds.push(component.id);
    } else if (isContainerNode(node)) {
      // Pure container (group / frame with no visual fill): NullItem, no component needed.
    } else if (isFrameShape(node)) {
      // Frame with fills + clipContent or cornerRadius → render as ShapeComponent (Rectangle)
      // so it gets proper roundness, fills, and corner rendering.
      const frameAsShape: FigmaIRNode = {
        ...node,
        figmaType: 'RECTANGLE',
      };
      const component = createShapeComponent(generateGUID(), itemId, frameAsShape, pxToWorld);

      components.push(component);
      item.components.push({ id: component.id });
      mappedComponentIds.push(component.id);
    } else if (node.kind === 'frame' || node.kind === 'group' || node.kind === 'shape' || node.kind === 'vector') {
      // Resolve primary image texture from the first visible image fill
      let textureId: string | undefined;
      let imageScaleMode: string | undefined;
      const fills = node.fills ?? [];
      const firstImageFill = fills.find(
        (f): boolean => !!(f.visible !== false && f.type === 'image' && f.imageRef != null),
      );

      if (firstImageFill?.imageRef != null) {
        textureId = getOrCreateTextureIdForImageRef(firstImageFill.imageRef, firstImageFill.dataBlobIndex);
        imageScaleMode = firstImageFill.imageScaleMode;
      } else if (node.imageRef !== undefined) {
        textureId = getOrCreateTextureIdForImageRef(node.imageRef, node.imageBlobIndex);
      }

      // Collect additional textures for multi-image fills
      const additionalFills: Array<{ textureId: string; imageScaleMode?: string }> = [];

      for (const fill of fills) {
        if (fill.visible === false || fill.type !== 'image' || fill.imageRef == null || fill === firstImageFill) {
          continue;
        }
        const extraTextureId = getOrCreateTextureIdForImageRef(fill.imageRef, fill.dataBlobIndex);

        if (extraTextureId != null) {
          additionalFills.push({ textureId: extraTextureId, imageScaleMode: fill.imageScaleMode });
        }
      }

      // If the node has no visible color/gradient fills and no image, make the
      // sprite fully transparent so it doesn't occlude content behind it.
      // Frames/groups often serve purely as layout containers.
      const hasVisualFill = node.fillColor !== undefined || node.fillGradient !== undefined || textureId !== undefined;
      const effectiveFillColor: [number, number, number, number] | undefined = hasVisualFill
        ? node.fillColor
        : [1, 1, 1, 0]; // transparent

      const component = createSpriteComponent(generateGUID(), itemId, {
        fillColor: effectiveFillColor,
        fillGradient: node.fillGradient,
        strokeColor: node.strokeColor,
        strokeWidth: node.strokeWidth,
        textureId,
        imageScaleMode,
        opacity: node.opacity,
        blendMode: node.blendMode,
        fills: fills.filter(f => f.visible !== false),
        additionalFills: additionalFills.length > 0 ? additionalFills : undefined,
      });

      components.push(component);
      item.components.push({ id: component.id });
      mappedComponentIds.push(component.id);
    }

    debugMap[node.id] = {
      figmaNodeId: node.id,
      figmaNodeName: node.name,
      itemId,
      componentIds: mappedComponentIds,
    };

    items.push(item);

    // ── Frame clipping (clipContent) ──
    // Figma frames with clipContent clip children to the frame's bounds.
    // In GE this is achieved via the mask system:
    //   1. Keep the frame's sprite component as a normal visual element (fill, corners).
    //   2. Create a separate invisible shape item (rectangle, same size/radius) as
    //      the first child, marked isMask:true — this defines the clip region.
    //   3. Real children reference this mask shape for clipping.
    let clipMaskComponentId: string | undefined;

    if (node.clipContent === true && mappedComponentIds.length > 0) {
      const maskItemId = generateGUID();
      const maskComponentId = generateGUID();
      const w = Math.max(0, node.width);
      const h = Math.max(0, node.height);
      const wWorld = w * pxToWorld;
      const hWorld = h * pxToWorld;
      const maxRound = Math.min(w, h) / 2;
      const roundness =
        maxRound > 0 && node.cornerRadius != null ? Math.min((node.cornerRadius / maxRound) * 100, 100) : 0;

      // Invisible solid white fill so the shape defines a region (alpha=1 for stencil)
      const maskFill: spec.SolidPaintData = {
        type: spec.FillType.Solid,
        color: { r: 1, g: 1, b: 1, a: 1 },
      };

      const maskShapeComp: Record<string, unknown> = {
        id: maskComponentId,
        dataType: spec.DataType.ShapeComponent,
        item: { id: maskItemId },
        type: spec.ShapePrimitiveType.Rectangle,
        fills: [maskFill],
        strokes: [],
        width: wWorld,
        height: hWorld,
        roundness,
        mask: { isMask: true },
      };

      const maskItem: spec.VFXItemData = {
        id: maskItemId,
        dataType: spec.DataType.VFXItemData,
        name: `${node.name}_clip`,
        type: spec.ItemType.shape,
        duration: compositionDuration,
        endBehavior: spec.EndBehavior.freeze,
        delay: 0,
        renderLevel: spec.RenderLevel.BPlus,
        parentId: itemId,
        visible: true,
        components: [{ id: maskComponentId }],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          size: { x: wWorld, y: hWorld },
          anchor: { x: 0, y: 0 },
        },
        content: { options: {} },
      };

      items.push(maskItem);
      components.push(maskShapeComp as unknown as spec.ComponentData);
      clipMaskComponentId = maskComponentId;
    }

    // Child parentRef: [center X, center Y] of current node in Figma coordinates.
    const childParentRef: [number, number] = [
      node.x + Math.max(0, node.width) / 2,
      node.y + Math.max(0, node.height) / 2,
    ];

    // Track active mask within children for Figma mask semantics:
    // A child with isMask=true masks all subsequent siblings until the next mask.
    let activeMaskComponentId: string | undefined;
    let activeMaskAlpha = false;

    for (const child of node.children) {
      if (child.isMask === true && child.visible === true) {
        // This child defines a new mask scope
        const maskItemId = walk(child, childParentRef, itemId);

        if (maskItemId != null) {
          // Find the component just created for this mask item
          const maskItem = items.find(it => it.id === maskItemId);
          const maskComponentRef = maskItem?.components[0];

          if (maskComponentRef != null) {
            activeMaskComponentId = maskComponentRef.id;
            activeMaskAlpha = child.maskType === 'ALPHA' || child.maskType === 'LUMINANCE';
            // Tag the mask component itself with isMask flag
            const maskComp = components.find(c => c.id === activeMaskComponentId) as unknown as Record<
              string,
              unknown
            >;

            if (maskComp != null) {
              maskComp.mask = { isMask: true };
            }
          }
        }
      } else {
        const childItemId = walk(child, childParentRef, itemId);

        if (childItemId != null) {
          const childItem = items.find(it => it.id === childItemId);

          for (const compRef of childItem?.components ?? []) {
            const comp = components.find(c => c.id === compRef.id) as unknown as Record<string, unknown>;

            if (comp == null) {
              continue;
            }

            // Apply frame clipping mask (clipContent)
            if (clipMaskComponentId != null) {
              comp.mask = {
                reference: { id: clipMaskComponentId },
              };
            }
            // Apply sibling mask (Figma isMask layer) — overrides frame clip if both present
            if (activeMaskComponentId != null) {
              comp.mask = {
                reference: { id: activeMaskComponentId },
                ...(activeMaskAlpha ? { alphaMaskEnabled: true } : {}),
              };
            }
          }
        }
      }
    }

    if (node.kind === 'text' && (node.text === undefined || node.text.length === 0)) {
      issues.push({
        type: 'warning',
        message: `Text-like node ${node.name}(${node.id}) has no characters field.`,
      });
    }

    return itemId;
  };

  const rootChildren: string[] = [];
  // Root parentRef: bounding box center of all root nodes,
  // so root items are positioned relative to the viewport center.
  const rootParentRef: [number, number] = [bboxCenterX, bboxCenterY];

  for (const node of nodes) {
    const id = walk(node, rootParentRef);

    if (id !== null) {
      rootChildren.push(id);
    }
  }

  if (rootChildren.length === 0) {
    issues.push({
      type: 'warning',
      message: 'No visible nodes found in Figma input. Generated scene is empty.',
    });
  }

  const compositionId = generateGUID();
  const previewSize: [number, number] = [designWidth, designHeight];
  const composition = createComposition(compositionId, previewSize, options);

  // Build children tree explicitly for GE 3.7+ consumers.
  const itemChildrenByParent = new Map<string, string[]>();

  for (const item of items) {
    if (item.parentId !== undefined && item.parentId.length > 0) {
      const children = itemChildrenByParent.get(item.parentId) ?? [];

      children.push(item.id);
      itemChildrenByParent.set(item.parentId, children);
    }
  }

  for (const item of items) {
    const children = itemChildrenByParent.get(item.id) ?? [];

    item.children = children.map(id => ({ id }));
  }

  composition.children = rootChildren.map(id => ({ id }));

  // Build timeline data for all items
  const timeline = buildTimeline(items, components, compositionDuration);

  // Create CompositionComponent required by runtime — buildItemTree() uses its
  // `items` list + each item's `parentId` to reconstruct the parent-child tree.
  const compositionComponentId = generateGUID();
  const compositionComponent: spec.ComponentData = {
    id: compositionComponentId,
    dataType: spec.DataType.CompositionComponent,
    item: { id: compositionId },
    timelineAsset: { id: timeline.timelineAssetId },
    sceneBindings: timeline.sceneBindings,
  } as unknown as spec.ComponentData;

  composition.components = [{ id: compositionComponentId }];
  components.push(compositionComponent);

  const scene: EffectsScene = {
    version: spec.JSONSceneVersion['3_7'],
    playerVersion: { web: '', native: '' },
    type: 'ge',
    compositionId: composition.id,
    compositions: [composition],
    images,
    textures,
    plugins: [],
    items,
    components,
    materials: [],
    shaders: [],
    geometries: [],
    animations: [],
    miscs: timeline.miscs,
  };

  return { scene, issues, debugMap };
}
