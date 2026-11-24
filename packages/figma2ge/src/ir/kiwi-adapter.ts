import type { AnyRecord } from '../utils';
import { asRecord } from '../utils';
import type {
  FigmaIRAutoLayout,
  FigmaIRAutoLayoutDirection,
  FigmaIREffect,
  FigmaIRFill,
  FigmaIRGradientHandle,
  FigmaIRGradientPaint,
  FigmaIRGradientStop,
  FigmaIRNode,
  FigmaIRNodeKind,
  FigmaIRPath,
  FigmaIRPathCommand,
  FigmaIRStroke,
} from './figma-ir';

// ── Enum Mapping Factory ──
// Generates a Record that maps both integer keys ("0","1",...) and string keys ("SOLID","FRAME",...)
// to the same output value. New enums only need a single [intKey, value] entry.

function dualEnum<T extends string>(entries: Array<[number, T]>): Record<string, T>;
function dualEnum<T extends string>(entries: Array<[number, T]>, aliases: Record<string, T>): Record<string, T>;
function dualEnum<T extends string>(entries: Array<[number, T]>, aliases?: Record<string, T>): Record<string, T> {
  const map: Record<string, T> = {};

  for (const [intKey, value] of entries) {
    map[String(intKey)] = value;
    map[value] = value;
  }
  if (aliases) {
    Object.assign(map, aliases);
  }

  return map;
}

function dualEnumObj<T>(entries: Array<[number, string, T]>): Record<string, T> {
  const map: Record<string, T> = {};

  for (const [intKey, strKey, value] of entries) {
    map[String(intKey)] = value;
    map[strKey] = value;
  }

  return map;
}

// ── Enum Mappings ──

const NODE_TYPE_MAP = dualEnumObj<{ kind: FigmaIRNodeKind; name: string }>([
  [1, 'DOCUMENT', { kind: 'frame', name: 'DOCUMENT' }],
  [2, 'CANVAS', { kind: 'frame', name: 'CANVAS' }],
  [3, 'GROUP', { kind: 'group', name: 'GROUP' }],
  [4, 'FRAME', { kind: 'frame', name: 'FRAME' }],
  [5, 'BOOLEAN_OPERATION', { kind: 'shape', name: 'BOOLEAN_OPERATION' }],
  [6, 'VECTOR', { kind: 'vector', name: 'VECTOR' }],
  [7, 'STAR', { kind: 'vector', name: 'STAR' }],
  [8, 'LINE', { kind: 'vector', name: 'LINE' }],
  [9, 'ELLIPSE', { kind: 'vector', name: 'ELLIPSE' }],
  [10, 'RECTANGLE', { kind: 'shape', name: 'RECTANGLE' }],
  [11, 'REGULAR_POLYGON', { kind: 'vector', name: 'REGULAR_POLYGON' }],
  [12, 'ROUNDED_RECTANGLE', { kind: 'shape', name: 'ROUNDED_RECTANGLE' }],
  [13, 'TEXT', { kind: 'text', name: 'TEXT' }],
  [15, 'SYMBOL', { kind: 'frame', name: 'SYMBOL' }],
  [16, 'INSTANCE', { kind: 'frame', name: 'INSTANCE' }],
  [25, 'SECTION', { kind: 'frame', name: 'SECTION' }],
]);

const BLEND_MODES = [
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
] as const;
const BLEND_MODE_VALID = new Set<string>(BLEND_MODES);
const BLEND_MODE_INT_TO_STR: Record<number, string> = Object.fromEntries(BLEND_MODES.map((m, i) => [i, m]));

const PAINT_TYPE_MAP = dualEnum([
  [0, 'SOLID'],
  [1, 'GRADIENT_LINEAR'],
  [2, 'GRADIENT_RADIAL'],
  [3, 'GRADIENT_ANGULAR'],
  [4, 'GRADIENT_DIAMOND'],
  [5, 'IMAGE'],
] as Array<
  [number, 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE']
>);

const GRADIENT_TYPE_MAP: Record<string, FigmaIRGradientPaint['type']> = {
  GRADIENT_LINEAR: 'linear',
  GRADIENT_RADIAL: 'radial',
  GRADIENT_ANGULAR: 'angular',
  GRADIENT_DIAMOND: 'diamond',
};

const EFFECT_TYPE_MAP = dualEnum<FigmaIREffect['type']>([
  [0, 'INNER_SHADOW'],
  [1, 'DROP_SHADOW'],
  [2, 'FOREGROUND_BLUR'],
  [3, 'BACKGROUND_BLUR'],
]);

const TEXT_ALIGN_H_MAP = dualEnum<NonNullable<FigmaIRNode['textAlignHorizontal']>>([
  [0, 'LEFT'],
  [1, 'CENTER'],
  [2, 'RIGHT'],
  [3, 'JUSTIFIED'],
]);

const TEXT_ALIGN_V_MAP = dualEnum<NonNullable<FigmaIRNode['textAlignVertical']>>([
  [0, 'TOP'],
  [1, 'CENTER'],
  [2, 'BOTTOM'],
]);

const TEXT_DECORATION_MAP = dualEnum<NonNullable<FigmaIRNode['textDecoration']>>([
  [0, 'NONE'],
  [1, 'UNDERLINE'],
  [2, 'STRIKETHROUGH'],
]);

const STROKE_ALIGN_MAP = dualEnum<NonNullable<FigmaIRStroke['align']>>([
  [0, 'CENTER'],
  [1, 'INSIDE'],
  [2, 'OUTSIDE'],
]);

const STROKE_CAP_MAP = dualEnum<NonNullable<FigmaIRStroke['cap']>>([
  [0, 'NONE'],
  [1, 'ROUND'],
  [2, 'SQUARE'],
]);

const STROKE_JOIN_MAP = dualEnum<NonNullable<FigmaIRStroke['join']>>([
  [0, 'MITER'],
  [1, 'BEVEL'],
  [2, 'ROUND'],
]);

const MASK_TYPE_MAP = dualEnum<NonNullable<FigmaIRNode['maskType']>>([
  [0, 'ALPHA'],
  [1, 'OUTLINE'],
  [2, 'LUMINANCE'],
]);

const IMAGE_SCALE_MODE_MAP = dualEnum<NonNullable<FigmaIRFill['imageScaleMode']>>([
  [0, 'STRETCH'],
  [1, 'FIT'],
  [2, 'FILL'],
  [3, 'TILE'],
]);

const STACK_MODE_MAP = dualEnum<FigmaIRAutoLayoutDirection>([
  [1, 'HORIZONTAL'],
  [2, 'VERTICAL'],
]);

const STACK_JUSTIFY_MAP = dualEnum<NonNullable<FigmaIRAutoLayout['primaryAlign']>>([
  [0, 'MIN'],
  [1, 'CENTER'],
  [2, 'MAX'],
  [3, 'SPACE_EVENLY'],
  [4, 'SPACE_BETWEEN'],
]);

const STACK_ALIGN_MAP = dualEnum<NonNullable<FigmaIRAutoLayout['counterAlign']>>([
  [0, 'MIN'],
  [1, 'CENTER'],
  [2, 'MAX'],
  [3, 'BASELINE'],
]);

const STACK_SIZE_MAP = dualEnum<'FIXED' | 'HUG'>(
  [
    [0, 'FIXED'],
    [1, 'HUG'],
    [2, 'HUG'],
  ],
  { RESIZE_TO_FIT: 'HUG', RESIZE_TO_FIT_WITH_IMPLICIT_SIZE: 'HUG' },
);

const STACK_CHILD_ALIGN_MAP = dualEnum<NonNullable<FigmaIRNode['layoutAlignSelf']>>([
  [0, 'MIN'],
  [1, 'CENTER'],
  [2, 'MAX'],
  [3, 'STRETCH'],
  [4, 'AUTO'],
  [5, 'BASELINE'],
]);

// ── Helpers ──

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Resolve an enum value that may be an integer or a string. */
function resolveEnum<T>(value: unknown, map: Record<string, T>): T | undefined {
  if (typeof value === 'number') {
    return map[String(value)];
  }
  if (typeof value === 'string') {
    return map[value];
  }

  return undefined;
}

function guidToString(guid: AnyRecord): string {
  return `${asNumber(guid.sessionID)}:${asNumber(guid.localID)}`;
}

function parseKiwiColor(color: AnyRecord | undefined): [number, number, number, number] | undefined {
  if (!color) {
    return undefined;
  }

  return [
    clamp01(asNumber(color.r, 1)),
    clamp01(asNumber(color.g, 1)),
    clamp01(asNumber(color.b, 1)),
    clamp01(asNumber(color.a, 1)),
  ];
}

function parseKiwiNumber(value: unknown, fontSize?: number): number | undefined {
  const rec = asRecord(value);

  if (!rec) {
    return undefined;
  }
  const v = asNumber(rec.value, NaN);

  if (!Number.isFinite(v)) {
    return undefined;
  }
  const units = rec.units;

  // PIXELS=1/"PIXELS" or RAW=0/"RAW" → use directly, PERCENT=2/"PERCENT" → resolve relative to fontSize
  if ((units === 2 || units === 'PERCENT') && fontSize !== undefined && Number.isFinite(fontSize)) {
    return (v / 100) * fontSize;
  }

  return v;
}

// ── Paint Parsing ──

/**
 * Derive gradient handle positions from the Kiwi Paint's 2x3 transform matrix.
 * handle[0] = start  (matrix * [0, 0.5])
 * handle[1] = end    (matrix * [1, 0.5])
 * handle[2] = width  (matrix * [0.5, 1])
 */
function parseGradientHandles(transform: AnyRecord | undefined): FigmaIRGradientHandle[] | undefined {
  if (!transform) {
    return undefined;
  }
  const m00 = asNumber(transform.m00, NaN);

  if (!Number.isFinite(m00)) {
    return undefined;
  }
  const m01 = asNumber(transform.m01, 0);
  const m02 = asNumber(transform.m02, 0);
  const m10 = asNumber(transform.m10, 0);
  const m11 = asNumber(transform.m11, 0);
  const m12 = asNumber(transform.m12, 0);

  return [
    { x: m01 * 0.5 + m02, y: m11 * 0.5 + m12 },
    { x: m00 + m01 * 0.5 + m02, y: m10 + m11 * 0.5 + m12 },
    { x: m00 * 0.5 + m01 + m02, y: m10 * 0.5 + m11 + m12 },
  ];
}

/** Parse gradient stops + handles from a paint. Shared by fill and stroke parsers. */
function parseGradientFromPaint(
  paint: AnyRecord,
  gradientType: FigmaIRGradientPaint['type'],
): FigmaIRGradientPaint | undefined {
  const stops: FigmaIRGradientStop[] = [];
  const rawStops = Array.isArray(paint.stops) ? paint.stops : [];

  for (const s of rawStops) {
    const stopRec = asRecord(s);

    if (!stopRec) {
      continue;
    }
    const color = parseKiwiColor(asRecord(stopRec.color));

    if (!color) {
      continue;
    }
    stops.push({ position: clamp01(asNumber(stopRec.position, 0)), color });
  }
  if (stops.length === 0) {
    return undefined;
  }
  const handles = parseGradientHandles(asRecord(paint.transform));

  return { type: gradientType, stops, ...(handles ? { handles } : {}) };
}

/**
 * Parse image hash from either Uint8Array, plain object with numeric keys, or string.
 */
function parseImageHash(hash: unknown): string | undefined {
  if (typeof hash === 'string') {
    return hash;
  }
  if (hash !== null && typeof hash === 'object' && ArrayBuffer.isView(hash)) {
    return Array.from(hash as Uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Decoded JSON: object with numeric string keys {"0": 131, "1": 141, ...}
  if (hash !== null && typeof hash === 'object' && !Array.isArray(hash)) {
    const obj = hash as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k) && typeof obj[k] === 'number')) {
      const bytes = keys.sort((a, b) => Number(a) - Number(b)).map(k => obj[k] as number);

      return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  return undefined;
}

function parseKiwiPaintAsFill(paint: AnyRecord): FigmaIRFill | undefined {
  const paintType = resolveEnum(paint.type, PAINT_TYPE_MAP);

  if (!paintType) {
    return undefined;
  }
  const isVisible = paint.visible !== false;
  const opacity = asNumber(paint.opacity, 1);

  if (paintType === 'SOLID') {
    const color = parseKiwiColor(asRecord(paint.color));

    if (!color) {
      return undefined;
    }
    color[3] *= clamp01(opacity);

    return { type: 'solid', color, opacity, visible: isVisible };
  }

  const gradientType = GRADIENT_TYPE_MAP[paintType];

  if (gradientType) {
    const gradient = parseGradientFromPaint(paint, gradientType);

    if (!gradient) {
      return undefined;
    }

    return { type: 'gradient', gradient, opacity, visible: isVisible };
  }

  if (paintType === 'IMAGE') {
    const image = asRecord(paint.image);

    if (!image) {
      return undefined;
    }
    const imageRef = parseImageHash(image.hash);

    if (imageRef === undefined || imageRef.length === 0) {
      return undefined;
    }
    const imageScaleMode = resolveEnum(paint.imageScaleMode, IMAGE_SCALE_MODE_MAP);
    // Kiwi binary encoding omits uint fields at default value 0, so
    // image.dataBlob is undefined when the actual blob index is 0.
    const dataBlobIndex = asNumber(image.dataBlob, 0);

    return {
      type: 'image',
      imageRef,
      ...(imageScaleMode !== undefined ? { imageScaleMode } : {}),
      dataBlobIndex,
      opacity,
      visible: isVisible,
    };
  }

  return undefined;
}

function parseKiwiPaintAsStroke(
  paint: AnyRecord,
  strokeProps: {
    align?: FigmaIRStroke['align'];
    width?: number;
    cap?: FigmaIRStroke['cap'];
    join?: FigmaIRStroke['join'];
    dashPattern?: number[];
  },
): FigmaIRStroke | undefined {
  const paintType = resolveEnum(paint.type, PAINT_TYPE_MAP);

  if (!paintType) {
    return undefined;
  }
  const isVisible = paint.visible !== false;
  const opacity = asNumber(paint.opacity, 1);
  const { align, width, cap, join, dashPattern } = strokeProps;
  const strokeExtras = {
    ...(cap && cap !== 'NONE' ? { cap } : {}),
    ...(join ? { join } : {}),
    ...(dashPattern && dashPattern.length > 0 ? { dashPattern } : {}),
  };

  if (paintType === 'SOLID') {
    const color = parseKiwiColor(asRecord(paint.color));

    if (!color) {
      return undefined;
    }
    color[3] *= clamp01(opacity);

    return { type: 'solid', color, width, align, ...strokeExtras, opacity, visible: isVisible };
  }

  const gradientType = GRADIENT_TYPE_MAP[paintType];

  if (gradientType) {
    const gradient = parseGradientFromPaint(paint, gradientType);

    if (!gradient) {
      return undefined;
    }

    return {
      type: 'gradient',
      gradient,
      width,
      align,
      ...strokeExtras,
      opacity,
      visible: isVisible,
    };
  }

  return undefined;
}

// ── Effect Parsing ──

function parseKiwiEffects(raw: unknown[]): FigmaIREffect[] | undefined {
  const effects: FigmaIREffect[] = [];

  for (const entry of raw) {
    const e = asRecord(entry);

    if (!e) {
      continue;
    }
    const effectType = resolveEnum(e.type, EFFECT_TYPE_MAP);

    if (!effectType) {
      continue;
    }
    const offset = asRecord(e.offset);
    const color = parseKiwiColor(asRecord(e.color));
    const spread = asNumber(e.spread, NaN);

    effects.push({
      type: effectType,
      visible: e.visible !== false,
      ...(color ? { color } : {}),
      ...(offset ? { offset: { x: asNumber(offset.x, 0), y: asNumber(offset.y, 0) } } : {}),
      radius: asNumber(e.radius, 0),
      ...(Number.isFinite(spread) ? { spread } : {}),
    });
  }

  return effects.length > 0 ? effects : undefined;
}

// ── Path Geometry Parsing ──

/**
 * Parse a fillGeometry/strokeGeometry commandsBlob into path commands.
 * Binary format: command byte followed by float32LE coordinates.
 *   0x00 = ClosePath (0 coords)
 *   0x01 = MoveTo    (2 coords: x, y)
 *   0x02 = LineTo    (2 coords: x, y)
 *   0x04 = CubicTo   (6 coords: cp1x, cp1y, cp2x, cp2y, x, y)
 */
function parseCommandsBlob(blob: Uint8Array): FigmaIRPathCommand[] {
  const commands: FigmaIRPathCommand[] = [];
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let pos = 0;

  while (pos < blob.length) {
    const cmd = blob[pos++];

    if (cmd === 0x00) {
      commands.push({ type: 'Z' });
    } else if (cmd === 0x01) {
      if (pos + 8 > blob.length) {
        break;
      }
      const x = view.getFloat32(pos, true);

      pos += 4;
      const y = view.getFloat32(pos, true);

      pos += 4;

      commands.push({ type: 'M', x, y });
    } else if (cmd === 0x02) {
      if (pos + 8 > blob.length) {
        break;
      }
      const x = view.getFloat32(pos, true);

      pos += 4;
      const y = view.getFloat32(pos, true);

      pos += 4;

      commands.push({ type: 'L', x, y });
    } else if (cmd === 0x04) {
      if (pos + 24 > blob.length) {
        break;
      }
      const cp1x = view.getFloat32(pos, true);

      pos += 4;
      const cp1y = view.getFloat32(pos, true);

      pos += 4;
      const cp2x = view.getFloat32(pos, true);

      pos += 4;
      const cp2y = view.getFloat32(pos, true);

      pos += 4;
      const x = view.getFloat32(pos, true);

      pos += 4;
      const y = view.getFloat32(pos, true);

      pos += 4;

      commands.push({ type: 'C', cp1x, cp1y, cp2x, cp2y, x, y });
    } else {
      // Unknown command — skip rest of blob
      break;
    }
  }

  return commands;
}

function parseGeometryPaths(geometryArray: unknown[], blobs: Uint8Array[]): FigmaIRPath[] | undefined {
  const paths: FigmaIRPath[] = [];

  for (const entry of geometryArray) {
    const geom = asRecord(entry);

    if (!geom) {
      continue;
    }
    const blobIndex = asNumber(geom.commandsBlob, NaN);

    if (!Number.isFinite(blobIndex) || blobIndex < 0 || blobIndex >= blobs.length) {
      continue;
    }
    const blob = blobs[blobIndex];

    if (blob.length === 0) {
      continue;
    }
    const commands = parseCommandsBlob(blob);

    if (commands.length === 0) {
      continue;
    }
    const windingRule = geom.windingRule === 'EVENODD' ? ('EVENODD' as const) : ('NONZERO' as const);

    paths.push({ commands, windingRule });
  }

  return paths.length > 0 ? paths : undefined;
}

// ── Main Adapter ──

export interface KiwiIRResult {
  nodes: FigmaIRNode[];
  blobs: Uint8Array[];
}

/** Convert a Kiwi-decoded byte[] (Uint8Array or numeric-keyed object) to Uint8Array. */
function parseBlobBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value !== null && typeof value === 'object' && ArrayBuffer.isView(value)) {
    return new Uint8Array((value as Uint8Array).buffer);
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      const arr = new Uint8Array(keys.length);

      for (const k of keys) {
        arr[Number(k)] = Number(obj[k]) & 0xff;
      }

      return arr;
    }
  }

  return new Uint8Array(0);
}

export function extractKiwiIR(input: unknown): KiwiIRResult {
  const rec = asRecord(input);

  if (!rec) {
    return { nodes: [], blobs: [] };
  }

  // Support both { nodeChanges: [...] } and { message: { nodeChanges: [...] } }
  const messageRec = asRecord(rec.message);
  const container = messageRec ?? rec;
  const rawNodeChanges = container.nodeChanges;
  const nodeChanges = Array.isArray(rawNodeChanges) ? rawNodeChanges : [];

  // Build a map of guid → nodeChange and track parent→children
  const nodeMap = new Map<string, AnyRecord>();
  const childrenMap = new Map<string, { id: string; position: string }[]>();
  const roots: string[] = [];

  for (const raw of nodeChanges) {
    const nc = asRecord(raw);

    if (!nc) {
      continue;
    }

    const guid = asRecord(nc.guid);

    if (!guid) {
      continue;
    }

    const id = guidToString(guid);

    nodeMap.set(id, nc);

    const parentIndex = asRecord(nc.parentIndex);

    if (!parentIndex) {
      roots.push(id);
      continue;
    }

    const parentGuid = asRecord(parentIndex.guid);

    if (!parentGuid) {
      roots.push(id);
      continue;
    }

    const parentId = guidToString(parentGuid);
    const position = typeof parentIndex.position === 'string' ? parentIndex.position : '';

    let siblings = childrenMap.get(parentId);

    if (!siblings) {
      siblings = [];
      childrenMap.set(parentId, siblings);
    }
    siblings.push({ id, position });
  }

  // Sort children by fractional index position
  for (const siblings of childrenMap.values()) {
    siblings.sort((a, b) => a.position.localeCompare(b.position));
  }

  // Filter roots: skip DOCUMENT / CANVAS types, descend into their children
  const effectiveRoots: string[] = [];

  for (const id of roots) {
    collectVisualRoots(id, nodeMap, childrenMap, effectiveRoots);
  }

  // Parse blobs early so they are available during buildNode for geometry paths.
  // Kiwi-schema may decode Blob entries as either:
  //   1. { bytes: Uint8Array } (standard Kiwi message field)
  //   2. raw Uint8Array (binary decode path)
  //   3. { bytes: {"0": n, "1": n, ...} } (JSON decode path)
  const rawBlobs = Array.isArray(container.blobs) ? container.blobs : [];
  const blobs: Uint8Array[] = rawBlobs.map((b: unknown) => {
    // If the blob entry itself is already binary data, use it directly
    if (b instanceof Uint8Array) {
      return b;
    }
    if (b !== null && typeof b === 'object' && ArrayBuffer.isView(b)) {
      return new Uint8Array((b as Uint8Array).buffer);
    }
    // Otherwise try to unwrap { bytes: ... }
    const blobRec = asRecord(b);

    if (!blobRec) {
      return new Uint8Array(0);
    }

    // bytes might be Uint8Array, ArrayBufferView, or numeric-keyed object
    return parseBlobBytes(blobRec.bytes);
  });

  // Recursive tree builder with transform accumulation
  function buildNode(id: string, parentAbsX: number, parentAbsY: number): FigmaIRNode | null {
    const nc = nodeMap.get(id);

    if (!nc) {
      return null;
    }

    const typeInfo = resolveEnum(nc.type, NODE_TYPE_MAP) ?? {
      kind: 'unknown' as FigmaIRNodeKind,
      name: `UNKNOWN_${String(nc.type)}`,
    };

    const size = asRecord(nc.size);
    const width = asNumber(size?.x, 0);
    const height = asNumber(size?.y, 0);

    const transform = asRecord(nc.transform);
    const m00 = asNumber(transform?.m00, 1);
    const m02 = asNumber(transform?.m02, 0);
    const m10 = asNumber(transform?.m10, 0);
    const m12 = asNumber(transform?.m12, 0);

    const absX = parentAbsX + m02;
    const absY = parentAbsY + m12;

    const angle = Math.atan2(m10, m00) * (180 / Math.PI);
    const rotation = Math.abs(angle) > 0.01 ? angle : undefined;

    const opacity = clamp01(asNumber(nc.opacity, 1));
    const visible = nc.visible !== false;

    // Blend mode: integer or string
    const rawBlendMode =
      typeof nc.blendMode === 'string'
        ? BLEND_MODE_VALID.has(nc.blendMode)
          ? nc.blendMode
          : undefined
        : BLEND_MODE_INT_TO_STR[asNumber(nc.blendMode, 1)];
    const blendMode =
      rawBlendMode !== undefined && rawBlendMode !== 'PASS_THROUGH' && rawBlendMode !== 'NORMAL'
        ? rawBlendMode
        : undefined;

    const isFrame = typeInfo.name === 'FRAME' || typeInfo.name === 'INSTANCE' || typeInfo.name === 'SYMBOL';
    const clipContent = nc.frameMaskDisabled === true ? false : isFrame ? true : undefined;

    // Mask properties
    const isMask = nc.mask === true ? true : undefined;
    const maskType = isMask ? (resolveEnum(nc.maskType, MASK_TYPE_MAP) ?? 'OUTLINE') : undefined;

    // Fills
    const rawFills = Array.isArray(nc.fillPaints) ? nc.fillPaints : [];
    const fills: FigmaIRFill[] = [];
    let fillColor: [number, number, number, number] | undefined;
    let textColor: [number, number, number, number] | undefined;
    let fillGradient: FigmaIRGradientPaint | undefined;
    let imageRef: string | undefined;
    let imageBlobIndex: number | undefined;

    for (const fp of rawFills) {
      const paint = asRecord(fp);

      if (!paint) {
        continue;
      }
      const irFill = parseKiwiPaintAsFill(paint);

      if (!irFill) {
        continue;
      }
      fills.push(irFill);
      if (irFill.visible !== false) {
        if (irFill.type === 'solid' && irFill.color !== undefined) {
          if (typeInfo.kind === 'text') {
            textColor = textColor ?? irFill.color;
          } else {
            fillColor = irFill.color;
          }
        } else if (irFill.type === 'gradient' && irFill.gradient) {
          fillGradient = fillGradient ?? irFill.gradient;
        } else if (irFill.type === 'image' && irFill.imageRef !== undefined && irFill.imageRef.length > 0) {
          imageRef = imageRef ?? irFill.imageRef;
          imageBlobIndex = imageBlobIndex ?? irFill.dataBlobIndex;
        }
      }
    }

    // Strokes
    const rawStrokes = Array.isArray(nc.strokePaints) ? nc.strokePaints : [];
    const strokeAlignValue = resolveEnum(nc.strokeAlign, STROKE_ALIGN_MAP);
    const rawStrokeWidth = asNumber(nc.strokeWeight, NaN);
    const strokeWidth = Number.isFinite(rawStrokeWidth) ? Math.max(0, rawStrokeWidth) : undefined;
    const strokeCapValue = resolveEnum(nc.strokeCap, STROKE_CAP_MAP);
    const strokeJoinValue = resolveEnum(nc.strokeJoin, STROKE_JOIN_MAP);
    const rawDashPattern = Array.isArray(nc.dashPattern)
      ? nc.dashPattern.filter((v: unknown) => typeof v === 'number')
      : undefined;
    const strokes: FigmaIRStroke[] = [];
    let strokeColor: [number, number, number, number] | undefined;

    for (const sp of rawStrokes) {
      const paint = asRecord(sp);

      if (!paint) {
        continue;
      }
      const irStroke = parseKiwiPaintAsStroke(paint, {
        align: strokeAlignValue,
        width: strokeWidth,
        cap: strokeCapValue,
        join: strokeJoinValue,
        dashPattern: rawDashPattern,
      });

      if (!irStroke) {
        continue;
      }
      strokes.push(irStroke);
      if (irStroke.visible !== false && irStroke.type === 'solid' && irStroke.color) {
        strokeColor = strokeColor ?? irStroke.color;
      }
    }

    // Effects
    const rawEffects = Array.isArray(nc.effects) ? nc.effects : [];
    const effects = parseKiwiEffects(rawEffects);

    // Corner radius
    let cornerRadius: number | undefined;
    let cornerRadii: [number, number, number, number] | undefined;

    if (nc.rectangleCornerRadiiIndependent === true) {
      cornerRadii = [
        Math.max(0, asNumber(nc.rectangleTopLeftCornerRadius, 0)),
        Math.max(0, asNumber(nc.rectangleTopRightCornerRadius, 0)),
        Math.max(0, asNumber(nc.rectangleBottomRightCornerRadius, 0)),
        Math.max(0, asNumber(nc.rectangleBottomLeftCornerRadius, 0)),
      ];
    } else {
      const r = asNumber(nc.cornerRadius, NaN);

      if (Number.isFinite(r)) {
        cornerRadius = Math.max(0, r);
      }
    }
    const rawSmoothing = asNumber(nc.cornerSmoothing, NaN);
    const cornerSmoothing = Number.isFinite(rawSmoothing) && rawSmoothing > 0 ? rawSmoothing : undefined;

    // Shape-specific properties
    const rawCount = asNumber(nc.count, NaN);
    const shapePointCount = Number.isFinite(rawCount) && rawCount >= 3 ? rawCount : undefined;
    const rawStarInner = asNumber(nc.starInnerScale, NaN);
    const starInnerScale = Number.isFinite(rawStarInner) ? rawStarInner : undefined;
    const arcRec = asRecord(nc.arcData);
    const arcData = arcRec
      ? {
          startingAngle: asNumber(arcRec.startingAngle, 0),
          endingAngle: asNumber(arcRec.endingAngle, Math.PI * 2),
          innerRadius: asNumber(arcRec.innerRadius, 0),
        }
      : undefined;

    // Vector fill/stroke geometry paths (only for vector-like nodes that have geometry blobs)
    const rawFillGeometry = Array.isArray(nc.fillGeometry) ? nc.fillGeometry : [];
    const rawStrokeGeometry = Array.isArray(nc.strokeGeometry) ? nc.strokeGeometry : [];
    const fillPaths = rawFillGeometry.length > 0 ? parseGeometryPaths(rawFillGeometry, blobs) : undefined;
    const strokePaths = rawStrokeGeometry.length > 0 ? parseGeometryPaths(rawStrokeGeometry, blobs) : undefined;

    // Auto-layout (Stack)
    const stackDirection = resolveEnum(nc.stackMode, STACK_MODE_MAP);
    let autoLayout: FigmaIRAutoLayout | undefined;

    if (stackDirection) {
      const primaryAlign = resolveEnum(nc.stackPrimaryAlignItems ?? nc.stackJustify, STACK_JUSTIFY_MAP) ?? 'MIN';
      const counterAlign = resolveEnum(nc.stackCounterAlignItems ?? nc.stackAlign, STACK_ALIGN_MAP) ?? 'MIN';
      const spacing = asNumber(nc.stackSpacing, 0);
      const rawCounterSpacing = asNumber(nc.stackCounterSpacing, NaN);
      const padding = asNumber(nc.stackPadding, 0);
      const hPad = asNumber(nc.stackHorizontalPadding, padding);
      const vPad = asNumber(nc.stackVerticalPadding, padding);
      const primarySizing = resolveEnum(nc.stackPrimarySizing, STACK_SIZE_MAP);
      const counterSizing = resolveEnum(nc.stackCounterSizing, STACK_SIZE_MAP);
      const wrapMode = nc.stackWrap;

      autoLayout = {
        direction: stackDirection,
        spacing,
        ...(Number.isFinite(rawCounterSpacing) ? { counterSpacing: rawCounterSpacing } : {}),
        paddingTop: vPad,
        paddingRight: asNumber(nc.stackPaddingRight, hPad),
        paddingBottom: asNumber(nc.stackPaddingBottom, vPad),
        paddingLeft: hPad,
        primaryAlign,
        counterAlign,
        ...(wrapMode === 1 || wrapMode === 'WRAP' ? { wrap: true } : {}),
        ...(primarySizing ? { primarySizing } : {}),
        ...(counterSizing ? { counterSizing } : {}),
      };
    }

    // Auto-layout child properties
    const rawLayoutGrow = asNumber(nc.stackChildPrimaryGrow, NaN);
    const layoutGrow = Number.isFinite(rawLayoutGrow) ? rawLayoutGrow : undefined;
    const layoutAlignSelf = resolveEnum(nc.stackChildAlignSelf, STACK_CHILD_ALIGN_MAP);
    const layoutPositioning: FigmaIRNode['layoutPositioning'] =
      nc.stackPositioning === 1 || nc.stackPositioning === 'ABSOLUTE' ? 'ABSOLUTE' : undefined;

    // Text
    let text: string | undefined;
    let textFontSize: number | undefined;
    let textLineHeight: number | undefined;
    let textFontFamily: string | undefined;
    let textFontWeight: number | undefined;
    let textAlignHorizontal: FigmaIRNode['textAlignHorizontal'];
    let textAlignVertical: FigmaIRNode['textAlignVertical'];
    let textDecoration: FigmaIRNode['textDecoration'];
    let letterSpacing: number | undefined;

    if (typeInfo.kind === 'text') {
      const textData = asRecord(nc.textData);

      text = typeof textData?.characters === 'string' ? textData.characters : undefined;

      textFontSize = asNumber(nc.fontSize, NaN);
      if (!Number.isFinite(textFontSize) || textFontSize <= 0) {
        textFontSize = undefined;
      }

      textLineHeight = parseKiwiNumber(nc.lineHeight, textFontSize);
      letterSpacing = parseKiwiNumber(nc.letterSpacing, textFontSize);

      const fontName = asRecord(nc.fontName);

      if (fontName) {
        textFontFamily = typeof fontName.family === 'string' ? fontName.family : undefined;
        const fontStyle = typeof fontName.style === 'string' ? fontName.style : '';

        textFontWeight = inferWeightFromStyle(fontStyle);
      }

      textAlignHorizontal = resolveEnum(nc.textAlignHorizontal, TEXT_ALIGN_H_MAP);
      textAlignVertical = resolveEnum(nc.textAlignVertical, TEXT_ALIGN_V_MAP);
      textDecoration = resolveEnum(nc.textDecoration, TEXT_DECORATION_MAP);
    }

    // Children
    const childEntries = childrenMap.get(id) ?? [];
    const children: FigmaIRNode[] = [];

    for (const child of childEntries) {
      const childNode = buildNode(child.id, absX, absY);

      if (childNode) {
        children.push(childNode);
      }
    }

    const name = typeof nc.name === 'string' ? nc.name : id;

    return {
      id,
      name,
      kind: typeInfo.kind,
      figmaType: typeInfo.name,
      visible,
      x: absX,
      y: absY,
      width,
      height,
      opacity,
      rotation,
      blendMode,
      clipContent,
      isMask,
      maskType,
      fills: fills.length > 0 ? fills : undefined,
      fillColor,
      fillGradient,
      textColor,
      imageRef,
      imageBlobIndex,
      strokes: strokes.length > 0 ? strokes : undefined,
      strokeColor,
      strokeWidth: strokes.length > 0 ? strokeWidth : undefined,
      effects,
      cornerRadius,
      cornerRadii,
      cornerSmoothing,
      shapePointCount,
      starInnerScale,
      arcData,
      fillPaths,
      strokePaths,
      autoLayout,
      layoutGrow,
      layoutAlignSelf,
      layoutPositioning,
      text,
      textFontSize,
      textLineHeight,
      textFontFamily,
      textFontWeight,
      textAlignHorizontal,
      textAlignVertical,
      textDecoration,
      letterSpacing,
      children,
    };
  }

  const result: FigmaIRNode[] = [];

  for (const id of effectiveRoots) {
    const node = buildNode(id, 0, 0);

    if (node) {
      result.push(node);
    }
  }

  return { nodes: result, blobs };
}

// ── Helpers ──

function collectVisualRoots(
  id: string,
  nodeMap: Map<string, AnyRecord>,
  childrenMap: Map<string, { id: string; position: string }[]>,
  out: string[],
): void {
  const nc = nodeMap.get(id);

  if (!nc) {
    return;
  }

  const typeInfo = resolveEnum(nc.type, NODE_TYPE_MAP);

  // Skip DOCUMENT and CANVAS — descend into their children
  if (typeInfo?.name === 'DOCUMENT' || typeInfo?.name === 'CANVAS') {
    const children = childrenMap.get(id) ?? [];

    for (const child of children) {
      collectVisualRoots(child.id, nodeMap, childrenMap, out);
    }

    return;
  }

  out.push(id);
}

function inferWeightFromStyle(style: string): number | undefined {
  const lower = style.toLowerCase();

  if (lower.includes('thin') || lower.includes('hairline')) {
    return 100;
  }
  if (lower.includes('extralight') || lower.includes('ultralight')) {
    return 200;
  }
  if (lower.includes('light')) {
    return 300;
  }
  if (lower.includes('medium')) {
    return 500;
  }
  if (lower.includes('semibold') || lower.includes('demibold')) {
    return 600;
  }
  if (lower.includes('extrabold') || lower.includes('ultrabold')) {
    return 800;
  }
  if (lower.includes('bold')) {
    return 700;
  }
  if (lower.includes('black') || lower.includes('heavy')) {
    return 900;
  }
  if (lower.includes('regular') || lower.includes('normal')) {
    return 400;
  }

  return undefined;
}
