import { isAbsoluteResourceUrl, isRecord, isValidHexColor } from '../../common/utils';
import { encodeInlineSVGUrl, readSVGAssetUrl } from '../../common/svg-asset-source';
import { DSL_CODE_LABELS } from './labels';
import { lintParticle } from './particle';
import type { DSLLintIssue, DSLLintReport, DSLSeverity, DSLValidationIssue, DSLValidationResult } from './types';

type DSLRecord = Record<string, unknown>;
type PropertyDimension = 3 | 'scalar';

interface DSLValidationContext {
  issues: DSLLintIssue[];
  duration: number | null;
}
interface LayerEntry {
  layer: DSLRecord;
  path: string;
  layerId: string | null;
  physicalParentId: string | null;
}
interface ValidatedCurve {
  t: [number, number];
  start: unknown;
  end: unknown;
}

const SPATIAL_PROPERTIES = ['position', 'rotation', 'scale', 'anchor'] as const;
const VALID_LAYER_TYPE_SET = new Set(['null', 'layer', 'text', 'particle']);
const VALID_ASSET_SOURCE_SET = new Set(['user', 'llm_svg']);
const EPSILON = 1e-9;

/** Lint an unnormalized DSL value while preserving issue severity. */
export function lintDSL(dsl: unknown): DSLLintReport {
  const context: DSLValidationContext = { issues: [], duration: null };

  if (containsCircularReference(dsl)) {
    addIssue(context, 'ERROR', 'R001', 'DSL root contains circular references, expected a JSON-compatible object', '');

    return createLintReport(context.issues);
  }

  if (!checkRoot(dsl, context)) {
    return createLintReport(context.issues);
  }

  checkMeta(dsl, context);
  const entries = walkLayers(dsl['layers'], context);

  for (const entry of entries) {
    checkLayerBase(entry, context);
    checkProperties(entry, context);
    checkLayerContent(entry, context);
  }
  checkLayerRelationships(entries, context);

  return createLintReport(context.issues);
}

/**
 * Validate DSL and return the public validation result.
 * Strings are interpreted as raw JSON. File-system paths are intentionally not
 * accepted so the same validator works unchanged in Node.js and browsers.
 */
export function validateDSL(dsl: unknown): DSLValidationResult {
  const coerced = coerceInput(dsl);

  if ('error' in coerced) {
    return createInputErrorResult(coerced.error);
  }

  const report = lintDSL(coerced.value);
  const errors = report.issues.filter(issue => issue.severity === 'ERROR').map(convertToValidationIssue);
  const warnings = report.issues.filter(issue => issue.severity === 'WARNING').map(convertToValidationIssue);
  const hasFailed = errors.length > 0;

  return {
    result: hasFailed ? 'fail' : 'pass',
    summary: `${errors.length} errors, ${warnings.length} warnings`,
    errors,
    warnings,
  };
}

/** Error thrown when a value cannot be used as a valid DSL composition. */
export class DSLValidationError extends TypeError {
  readonly issues: DSLValidationIssue[];

  constructor(errors: DSLValidationIssue[], warnings: DSLValidationIssue[] = []) {
    super(errors.map(issue => `${issue.code}: ${issue.message}`).join('; '));
    this.name = 'DSLValidationError';
    this.issues = [...errors, ...warnings];
  }

  static fromValidationResult(validationResult: DSLValidationResult): DSLValidationError {
    return new DSLValidationError(validationResult.errors, validationResult.warnings);
  }
}

function coerceInput(dsl: unknown): { value: unknown } | { error: string } {
  if (typeof dsl !== 'string') {
    if (isRecord(dsl)) {
      if (containsCircularReference(dsl)) {
        return {
          error: 'DSL value contains circular references and cannot be represented as JSON',
        };
      }

      return { value: dsl };
    }

    return { error: `expected a DSL object or raw JSON string, got ${describeValueType(dsl)}` };
  }

  const firstCharacter = dsl.trimStart()[0];

  if (firstCharacter !== '{' && firstCharacter !== '[') {
    return { error: 'expected raw DSL JSON text beginning with { or [' };
  }

  try {
    return { value: JSON.parse(dsl) as unknown };
  } catch (error) {
    return { error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function createInputErrorResult(message: string): DSLValidationResult {
  return {
    result: 'fail',
    summary: 'input cannot be read as DSL JSON',
    errors: [
      {
        code: 'INPUT_ERROR',
        label: '输入无法解析为 DSL JSON',
        message,
        path: '',
        layerId: null,
      },
    ],
    warnings: [],
  };
}

function createLintReport(issues: DSLLintIssue[]): DSLLintReport {
  const errorCount = issues.filter(issue => issue.severity === 'ERROR').length;
  const warningCount = issues.length - errorCount;

  return {
    ok: issues.length === 0,
    hasErrors: errorCount > 0,
    counts: { ERROR: errorCount, WARNING: warningCount },
    issues,
  };
}

function convertToValidationIssue(issue: DSLLintIssue): DSLValidationIssue {
  return {
    code: issue.code,
    label: DSL_CODE_LABELS[issue.code] ?? '',
    message: issue.message,
    path: issue.path,
    layerId: issue.layerId,
  };
}

function addIssue(
  context: DSLValidationContext,
  severity: DSLSeverity,
  code: string,
  message: string,
  path: string,
  layerId: string | null = null,
): void {
  context.issues.push({ severity, code, message, path, layerId });
}

function checkRoot(dsl: unknown, context: DSLValidationContext): dsl is DSLRecord {
  if (!isRecord(dsl)) {
    addIssue(context, 'ERROR', 'R001', `DSL root is ${describeValueType(dsl)}, expected an object`, '');

    return false;
  }
  if (!hasValue(dsl, 'meta')) {
    addIssue(context, 'ERROR', 'R002', "missing 'meta' object", 'meta');
  } else if (!isRecord(dsl['meta'])) {
    addIssue(context, 'ERROR', 'R005', 'meta must be an object', 'meta');
  }
  if (!hasValue(dsl, 'layers')) {
    addIssue(context, 'ERROR', 'R003', "missing 'layers' array", 'layers');
  } else if (!Array.isArray(dsl['layers'])) {
    addIssue(context, 'ERROR', 'R004', `layers is ${describeValueType(dsl['layers'])}, expected an array`, 'layers');
  }

  return true;
}

function checkMeta(dsl: DSLRecord, context: DSLValidationContext): void {
  const meta = dsl['meta'];

  if (!isRecord(meta)) {
    return;
  }
  const required: Array<[string, string, (value: unknown) => boolean, string]> = [
    ['name', 'string', value => typeof value === 'string', 'M002a'],
    ['duration', 'number', isNumber, 'M002b'],
    ['fps', 'number', isNumber, 'M002c'],
    ['width', 'number', isNumber, 'M002d'],
    ['height', 'number', isNumber, 'M002e'],
    ['loop', 'boolean', value => typeof value === 'boolean', 'M002f'],
  ];

  for (const [field, expected, accepts, code] of required) {
    const severity = field === 'name' ? 'WARNING' : 'ERROR';

    if (!hasValue(meta, field)) {
      addIssue(context, severity, 'M001', `meta.${field} is missing`, `meta.${field}`);
    } else if (!accepts(meta[field])) {
      addIssue(
        context,
        severity,
        code,
        `meta.${field} is ${describeValueType(meta[field])}, expected ${expected}`,
        `meta.${field}`,
      );
    }
  }

  if (meta['background_color'] != null) {
    const background = meta['background_color'];

    if (typeof background !== 'string') {
      addIssue(
        context,
        'WARNING',
        'M003',
        `meta.background_color is ${describeValueType(background)}, expected a string`,
        'meta.background_color',
      );
    } else if (!isValidHexColor(background)) {
      addIssue(
        context,
        'WARNING',
        'M004',
        `meta.background_color ${formatValue(background)} is not a supported hex color`,
        'meta.background_color',
      );
    }
  }

  const fps = meta['fps'];
  const width = meta['width'];
  const height = meta['height'];
  const duration = meta['duration'];

  if (isNumber(fps) && fps <= 0) {
    addIssue(context, 'ERROR', 'M005', `meta.fps is ${formatNumber(fps)}, must be > 0`, 'meta.fps');
  }
  if (isNumber(width) && width <= 0) {
    addIssue(context, 'ERROR', 'M006', `meta.width is ${formatNumber(width)}, must be > 0`, 'meta.width');
  }
  if (isNumber(height) && height <= 0) {
    addIssue(context, 'ERROR', 'M006', `meta.height is ${formatNumber(height)}, must be > 0`, 'meta.height');
  }
  if (isNumber(duration)) {
    if (duration <= 0) {
      addIssue(context, 'ERROR', 'M007', `meta.duration is ${formatNumber(duration)}, must be > 0`, 'meta.duration');
    } else {
      context.duration = duration;
    }
  }
}

function walkLayers(layers: unknown, context: DSLValidationContext): LayerEntry[] {
  const entries: LayerEntry[] = [];

  if (!Array.isArray(layers)) {
    return entries;
  }

  const visitLayer = (layer: unknown, path: string, physicalParentId: string | null): void => {
    if (!isRecord(layer)) {
      addIssue(
        context,
        'ERROR',
        'L021',
        `layer entry is ${describeValueType(layer)}, expected an object`,
        path,
        physicalParentId,
      );

      return;
    }

    const layerId = readLayerId(layer);

    entries.push({ layer, path, layerId, physicalParentId });
    const children = layer['children'];

    if (children == null) {
      return;
    }
    if (!Array.isArray(children)) {
      addIssue(
        context,
        'ERROR',
        'L022',
        `children is ${describeValueType(children)}, expected an array`,
        `${path}.children`,
        layerId,
      );

      return;
    }
    children.forEach((child, index) => visitLayer(child, `${path}.children[${index}]`, layerId));
  };

  layers.forEach((layer, index) => visitLayer(layer, `layers[${index}]`, null));

  return entries;
}

function checkLayerBase(entry: LayerEntry, context: DSLValidationContext): void {
  const { layer, path, layerId } = entry;

  if (!hasValue(layer, 'id')) {
    addIssue(context, 'ERROR', 'L001', 'id is missing', `${path}.id`);
  } else if (typeof layer['id'] !== 'string') {
    addIssue(context, 'ERROR', 'L002', `id is ${describeValueType(layer['id'])}, expected a string`, `${path}.id`);
  } else if (layer['id'] === '') {
    addIssue(context, 'ERROR', 'L003', 'id is an empty string', `${path}.id`);
  }

  if (!hasValue(layer, 'name')) {
    addIssue(context, 'WARNING', 'L004', 'name is missing', `${path}.name`);
  } else if (typeof layer['name'] !== 'string') {
    addIssue(context, 'WARNING', 'L005', `name is ${describeValueType(layer['name'])}, expected a string`, `${path}.name`);
  }

  if (!hasValue(layer, 'type')) {
    addIssue(context, 'ERROR', 'L006', 'type is missing', `${path}.type`);
  } else if (!VALID_LAYER_TYPE_SET.has(String(layer['type']))) {
    addIssue(
      context,
      'ERROR',
      'L007',
      `type ${formatValue(layer['type'])} not in {null, layer, text, particle}`,
      `${path}.type`,
    );
  }

  for (const [field, missingCode, typeCode] of [
    ['width', 'L008', 'L009'],
    ['height', 'L010', 'L011'],
  ] as const) {
    if (!hasValue(layer, field)) {
      addIssue(context, 'ERROR', missingCode, `${field} is missing`, `${path}.${field}`);
    } else if (!isNumber(layer[field])) {
      addIssue(
        context,
        'ERROR',
        typeCode,
        `${field} is ${describeValueType(layer[field])}, expected a number`,
        `${path}.${field}`,
      );
    } else if (layer[field] < 0) {
      addIssue(
        context,
        'ERROR',
        typeCode,
        `${field} is ${formatNumber(layer[field])}, expected a number greater than or equal to 0`,
        `${path}.${field}`,
      );
    }
  }

  const description = layer['description'];

  if (!hasValue(layer, 'description')) {
    addIssue(context, 'WARNING', 'L012', 'description is missing', `${path}.description`);
  } else if (!isRecord(description)) {
    addIssue(
      context,
      'WARNING',
      'L013',
      `description is ${describeValueType(description)}, expected an object`,
      `${path}.description`,
    );
  } else {
    for (const [field, code] of [
      ['self', 'L014'],
      ['composite', 'L015'],
    ] as const) {
      if (!hasValue(description, field)) {
        addIssue(context, 'WARNING', code, `description.${field} is missing`, `${path}.description.${field}`);
      } else if (typeof description[field] !== 'string') {
        addIssue(
          context,
          'WARNING',
          'L016',
          `description.${field} is ${describeValueType(description[field])}, expected a string`,
          `${path}.description.${field}`,
        );
      }
    }
  }

  const timeRange = layer['time_range'];
  let hasNumericTimeRange = false;

  if (timeRange === undefined) {
    return;
  }
  if (!Array.isArray(timeRange) || timeRange.length !== 2) {
    const got = Array.isArray(timeRange) ? `array of length ${timeRange.length}` : describeValueType(timeRange);

    addIssue(context, 'ERROR', 'L018', `time_range is ${got}, expected [number, number]`, `${path}.time_range`);
  } else if (!timeRange.every(isNumber)) {
    addIssue(context, 'ERROR', 'L019', 'time_range elements must be numbers', `${path}.time_range`);
  } else {
    hasNumericTimeRange = true;
  }

  if (hasNumericTimeRange && Array.isArray(timeRange)) {
    const start = timeRange[0] as number;
    const end = timeRange[1] as number;

    if (start > end) {
      addIssue(
        context,
        'ERROR',
        'L020',
        `time_range [${formatNumber(start)}, ${formatNumber(end)}] — start must be <= end`,
        `${path}.time_range`,
        layerId,
      );
    } else if (start === end) {
      addIssue(
        context,
        'WARNING',
        'L020',
        `time_range [${formatNumber(start)}, ${formatNumber(end)}] has zero duration`,
        `${path}.time_range`,
        layerId,
      );
    }
    if (context.duration != null && (start < -EPSILON || end > context.duration + EPSILON)) {
      addIssue(
        context,
        'WARNING',
        'L023',
        `time_range [${formatNumber(start)}, ${formatNumber(end)}] falls outside [0, ${formatNumber(context.duration)}]`,
        `${path}.time_range`,
        layerId,
      );
    }
  }
}

function checkProperties(entry: LayerEntry, context: DSLValidationContext): void {
  const { layer, path, layerId } = entry;

  for (const propertyName of [...SPATIAL_PROPERTIES, 'opacity'] as const) {
    const dimension: PropertyDimension = propertyName === 'opacity' ? 'scalar' : 3;
    const propertyPath = `${path}.${propertyName}`;
    const property = layer[propertyName];

    if (propertyName !== 'position' && property === undefined) {
      continue;
    }
    if (property == null) {
      addIssue(context, 'ERROR', 'P001', `${propertyName} is missing`, propertyPath, layerId);
      continue;
    }
    if (!isRecord(property)) {
      addIssue(
        context,
        'ERROR',
        'P002',
        `${propertyName} is ${describeValueType(property)}, expected an object`,
        propertyPath,
        layerId,
      );
      continue;
    }

    const animated = property['a'];

    if (!hasValue(property, 'a')) {
      addIssue(context, 'ERROR', 'P003', `${propertyName}.a is missing`, `${propertyPath}.a`, layerId);
      continue;
    }
    if (typeof animated !== 'boolean') {
      addIssue(
        context,
        'ERROR',
        'P004',
        `${propertyName}.a is ${describeValueType(animated)}, expected a boolean`,
        `${propertyPath}.a`,
        layerId,
      );
      continue;
    }

    const hasAnimation = hasValue(property, 'animation');
    const hasValueField = hasValue(property, 'value');

    if (!animated) {
      const accepts2DPosition = propertyName === 'position' && layer['type'] !== 'particle';

      checkStaticValue(propertyName, dimension, accepts2DPosition, property, propertyPath, layerId, context);
      if (hasAnimation) {
        addIssue(
          context,
          'WARNING',
          'P006',
          `${propertyName}.animation present while a=false (ignored)`,
          `${propertyPath}.animation`,
          layerId,
        );
      }
      continue;
    }

    if (propertyName === 'anchor') {
      addIssue(
        context,
        'WARNING',
        'P015',
        'anchor animation is unsupported; using the first segment start or the default anchor',
        propertyPath,
        layerId,
      );
    }

    if (!hasAnimation) {
      addIssue(
        context,
        'ERROR',
        'P007',
        `${propertyName}.animation missing while a=true`,
        `${propertyPath}.animation`,
        layerId,
      );
      continue;
    }
    const animation = property['animation'];

    if (!Array.isArray(animation)) {
      addIssue(
        context,
        'ERROR',
        'P008',
        `${propertyName}.animation is ${describeValueType(animation)}, expected an array`,
        `${propertyPath}.animation`,
        layerId,
      );
      continue;
    }
    if (hasValueField) {
      addIssue(
        context,
        'WARNING',
        'P009',
        `${propertyName}.value present while a=true (ignored)`,
        `${propertyPath}.value`,
        layerId,
      );
    }
    if (animation.length === 0) {
      addIssue(
        context,
        'WARNING',
        'P010',
        `${propertyName}.animation is empty (no segments)`,
        `${propertyPath}.animation`,
        layerId,
      );
      continue;
    }

    const animationPath = `${propertyPath}.animation`;
    const curves = animation.map((curve, index) =>
      checkCurve(propertyName, dimension, curve, `${animationPath}[${index}]`, layerId, context),
    );

    checkContinuity(propertyName, curves, animationPath, layerId, context);
  }
}

function checkStaticValue(
  propertyName: string,
  dimension: PropertyDimension,
  accepts2DPosition: boolean,
  property: DSLRecord,
  propertyPath: string,
  layerId: string | null,
  context: DSLValidationContext,
): void {
  const value = property['value'];

  if (!hasValue(property, 'value')) {
    addIssue(context, 'ERROR', 'P005', `${propertyName}.value missing while a=false`, `${propertyPath}.value`, layerId);

    return;
  }
  if (dimension === 3) {
    if (accepts2DPosition && Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1])) {
      addIssue(context, 'WARNING', 'P011', 'position.value uses [x, y]; using z=0', `${propertyPath}.value`, layerId);

      return;
    }
    if (!Array.isArray(value) || value.length !== 3) {
      const got = Array.isArray(value) ? `array length ${value.length}` : describeValueType(value);

      addIssue(
        context,
        'ERROR',
        'P011',
        `${propertyName}.value must be a 3-element array, got ${got}`,
        `${propertyPath}.value`,
        layerId,
      );

      return;
    }
    if (!value.every(isNumber)) {
      addIssue(
        context,
        'WARNING',
        'P013',
        `${propertyName}.value has non-numeric elements`,
        `${propertyPath}.value`,
        layerId,
      );
    }

    return;
  }

  const opacity: unknown = Array.isArray(value) && value.length === 1 ? value[0] : value;

  if (!isNumber(opacity)) {
    addIssue(
      context,
      'ERROR',
      'P012',
      `opacity.value is ${describeValueType(value)}, expected a number`,
      `${propertyPath}.value`,
      layerId,
    );

    return;
  }
  if (Array.isArray(value)) {
    addIssue(context, 'WARNING', 'P012', 'opacity.value uses [value]; using its scalar', `${propertyPath}.value`, layerId);
  }
  if (opacity < -EPSILON || opacity > 1 + EPSILON) {
    addIssue(
      context,
      'WARNING',
      'P014',
      `opacity.value ${formatNumber(opacity)} out of [0, 1]; clamped`,
      `${propertyPath}.value`,
      layerId,
    );
  }
}

function checkCurve(
  propertyName: string,
  dimension: PropertyDimension,
  curve: unknown,
  segmentPath: string,
  layerId: string | null,
  context: DSLValidationContext,
): ValidatedCurve | null {
  if (!isRecord(curve)) {
    addIssue(
      context,
      'ERROR',
      'C001',
      `animation segment is ${describeValueType(curve)}, expected an object`,
      segmentPath,
      layerId,
    );

    return null;
  }

  const timeRange = curve['t'];
  let isTimeRangeValid = false;

  if (!hasValue(curve, 't')) {
    addIssue(context, 'ERROR', 'C002', 't is missing', `${segmentPath}.t`, layerId);
  } else if (!Array.isArray(timeRange) || timeRange.length !== 2) {
    const got = Array.isArray(timeRange) ? `array length ${timeRange.length}` : describeValueType(timeRange);

    addIssue(context, 'ERROR', 'C003', `t must be a 2-element array, got ${got}`, `${segmentPath}.t`, layerId);
  } else if (!timeRange.every(isNumber)) {
    addIssue(context, 'ERROR', 'C005', 't elements must be numbers', `${segmentPath}.t`, layerId);
  } else {
    isTimeRangeValid = true;
  }

  if (isTimeRangeValid && Array.isArray(timeRange)) {
    const start = timeRange[0] as number;
    const end = timeRange[1] as number;

    if (start >= end) {
      addIssue(
        context,
        'ERROR',
        'C004',
        `t [${formatNumber(start)}, ${formatNumber(end)}] — start >= end`,
        `${segmentPath}.t`,
        layerId,
      );
    }
    if (context.duration != null && (start < -EPSILON || end > context.duration + EPSILON)) {
      addIssue(
        context,
        'WARNING',
        'C016',
        `t [${formatNumber(start)}, ${formatNumber(end)}] falls outside [0, ${formatNumber(context.duration)}]`,
        `${segmentPath}.t`,
        layerId,
      );
    }
  }

  const isStartValid = checkCurveEndpoint(dimension, curve, 'start', 'C006', segmentPath, layerId, context);
  const isEndValid = checkCurveEndpoint(dimension, curve, 'end', 'C007', segmentPath, layerId, context);
  const easing = curve['easing'];

  if (!hasValue(curve, 'easing')) {
    addIssue(
      context, 'WARNING', 'C011', 'easing is missing; using linear interpolation', `${segmentPath}.easing`, layerId,
    );
  } else if (!Array.isArray(easing) || easing.length !== 4) {
    const got = Array.isArray(easing) ? `array length ${easing.length}` : describeValueType(easing);

    addIssue(
      context,
      'WARNING',
      'C011',
      `easing must be a 4-element array [x1,y1,x2,y2], got ${got}; using linear interpolation`,
      `${segmentPath}.easing`,
      layerId,
    );
  } else if (!easing.every(isNumber)) {
    addIssue(
      context, 'WARNING', 'C012', 'easing elements must be numbers; using linear interpolation',
      `${segmentPath}.easing`, layerId,
    );
  } else if (easing[0] < 0 || easing[0] > 1 || easing[2] < 0 || easing[2] > 1) {
    addIssue(
      context,
      'WARNING',
      'C012',
      'easing x control points must be in [0, 1]; using linear interpolation',
      `${segmentPath}.easing`,
      layerId,
    );
  }

  for (const key of ['in', 'out'] as const) {
    if (!hasValue(curve, key)) {
      continue;
    }
    if (propertyName !== 'position') {
      addIssue(
        context,
        'WARNING',
        'C013',
        `'${key}' tangent only allowed on position, not ${propertyName}`,
        `${segmentPath}.${key}`,
        layerId,
      );
    } else {
      const tangent = curve[key];

      if (!Array.isArray(tangent) || tangent.length !== 3 || !tangent.every(isNumber)) {
        const got = Array.isArray(tangent) ? `array length ${tangent.length}` : describeValueType(tangent);

        addIssue(
          context,
          'WARNING',
          'C014',
          `'${key}' must be a finite 3-element array, got ${got}; ignored`,
          `${segmentPath}.${key}`,
          layerId,
        );
      }
    }
  }

  if (!isTimeRangeValid || !isStartValid || !isEndValid || !Array.isArray(timeRange)) {
    return null;
  }

  return {
    t: [timeRange[0] as number, timeRange[1] as number],
    start: curve['start'],
    end: curve['end'],
  };
}

function checkCurveEndpoint(
  dimension: PropertyDimension,
  curve: DSLRecord,
  key: 'start' | 'end',
  missingCode: string,
  segmentPath: string,
  layerId: string | null,
  context: DSLValidationContext,
): boolean {
  const value = curve[key];

  if (!hasValue(curve, key)) {
    addIssue(context, 'ERROR', missingCode, `${key} is missing`, `${segmentPath}.${key}`, layerId);

    return false;
  }
  if (dimension === 3) {
    if (!Array.isArray(value) || value.length !== 3) {
      const got = Array.isArray(value) ? `array length ${value.length}` : describeValueType(value);

      addIssue(
        context,
        'ERROR',
        'C008',
        `${key} must be a 3-element array, got ${got}`,
        `${segmentPath}.${key}`,
        layerId,
      );

      return false;
    }

    if (!value.every(isNumber)) {
      addIssue(
        context,
        'ERROR',
        'C008',
        `${key} must contain finite numbers`,
        `${segmentPath}.${key}`,
        layerId,
      );

      return false;
    }

    return true;
  }
  const opacity = Array.isArray(value) && value.length === 1 ? value[0] as unknown : value;

  if (isNumber(opacity) && (opacity < -EPSILON || opacity > 1 + EPSILON)) {
    addIssue(
      context, 'WARNING', 'C017', `${key} opacity ${formatNumber(opacity)} out of [0, 1]; clamped`,
      `${segmentPath}.${key}`, layerId,
    );
  }
  if (isNumber(value)) {
    addIssue(
      context,
      'WARNING',
      'C010',
      `${key} is a scalar ${formatNumber(value)}; expected a 1-element array (accepted and normalized)`,
      `${segmentPath}.${key}`,
      layerId,
    );

    return true;
  }
  if (Array.isArray(value)) {
    if (value.length === 1) {
      if (!isNumber(value[0])) {
        addIssue(
          context,
          'ERROR',
          'C009',
          `${key} must contain one finite number`,
          `${segmentPath}.${key}`,
          layerId,
        );

        return false;
      }

      return true;
    }
    addIssue(
      context,
      'ERROR',
      'C009',
      `${key} must be a 1-element array, got array length ${value.length}`,
      `${segmentPath}.${key}`,
      layerId,
    );

    return false;
  }
  addIssue(
    context,
    'ERROR',
    'C009',
    `${key} is ${describeValueType(value)}, expected a 1-element array`,
    `${segmentPath}.${key}`,
    layerId,
  );

  return false;
}

function checkContinuity(
  propertyName: string,
  curves: Array<ValidatedCurve | null>,
  animationPath: string,
  layerId: string | null,
  context: DSLValidationContext,
): void {
  const validCurves = curves.filter((curve): curve is ValidatedCurve => curve != null);

  for (let index = 0; index < validCurves.length - 1; index++) {
    const left = validCurves[index];
    const right = validCurves[index + 1];
    const path = `${animationPath}[segments ${index}->${index + 1}]`;

    if (left.t[1] > right.t[0] + EPSILON) {
      addIssue(
        context,
        'WARNING',
        'S002',
        `${propertyName}: segments ${index}/${index + 1} overlap (t ${formatValue(left.t)} / ${formatValue(right.t)})`,
        path,
        layerId,
      );
    } else if (left.t[1] < right.t[0] - EPSILON) {
      addIssue(
        context,
        'WARNING',
        'S003',
        `${propertyName}: gap between segments ${index}/${index + 1} (t ${formatValue(left.t)} / ${formatValue(right.t)})`,
        path,
        layerId,
      );
    }
    if (right.t[0] < left.t[0] - EPSILON) {
      addIssue(
        context,
        'WARNING',
        'S004',
        `${propertyName}: segments not monotonic at ${index}/${index + 1} (t ${formatValue(left.t)} / ${formatValue(right.t)})`,
        path,
        layerId,
      );
    }
  }
}

function checkLayerContent(entry: LayerEntry, context: DSLValidationContext): void {
  const { layer, path, layerId } = entry;
  const layerType = layer['type'];

  if (typeof layerType !== 'string' || !VALID_LAYER_TYPE_SET.has(layerType)) {
    return;
  }

  const asset = layer['asset'];
  const hasAsset = hasValue(layer, 'asset');
  const particle = layer['particle'];
  const hasParticle = hasValue(layer, 'particle');

  if (layerType !== 'particle' && hasParticle) {
    addIssue(
      context,
      'WARNING',
      'A024',
      `type=${layerType} has a particle block (ignored)`,
      `${path}.particle`,
      layerId,
    );
  }

  if (layerType === 'null') {
    if (hasAsset) {
      addIssue(context, 'WARNING', 'A010', 'null layer has an asset (ignored)', `${path}.asset`, layerId);
    }

    return;
  }

  if (layerType === 'layer') {
    if (!hasAsset) {
      addIssue(context, 'ERROR', 'A001', 'type=layer requires an asset', `${path}.asset`, layerId);
    } else if (!isRecord(asset)) {
      addIssue(context, 'ERROR', 'A002', `asset is ${describeValueType(asset)}, expected an object`, `${path}.asset`, layerId);
    } else {
      checkAssetFields(asset, `${path}.asset`, layerId, context);
    }
    if (hasValue(layer, 'text')) {
      addIssue(context, 'WARNING', 'A016', 'type=layer has a text block (ignored)', `${path}.text`, layerId);
    }
    if (
      (isNumber(layer['width']) && layer['width'] <= 0) ||
      (isNumber(layer['height']) && layer['height'] <= 0)
    ) {
      addIssue(
        context,
        'ERROR',
        'L024',
        'image layers require width and height greater than 0',
        path,
        layerId,
      );
    }

    return;
  }

  if (layerType === 'particle') {
    if (
      (isNumber(layer['width']) && layer['width'] <= 0) ||
      (isNumber(layer['height']) && layer['height'] <= 0)
    ) {
      addIssue(
        context,
        'ERROR',
        'L024',
        'particle layers require width and height greater than 0',
        path,
        layerId,
      );
    }
    if (!hasParticle) {
      addIssue(context, 'ERROR', 'A022', 'type=particle requires a particle block', `${path}.particle`, layerId);
    } else if (!isRecord(particle)) {
      addIssue(
        context,
        'ERROR',
        'A023',
        `particle is ${describeValueType(particle)}, expected an object`,
        `${path}.particle`,
        layerId,
      );
    } else {
      for (const issue of lintParticle(particle, layer, `${path}.particle`)) {
        addIssue(context, 'ERROR', issue.code, issue.message, issue.path, layerId);
      }
    }
    if (hasAsset) {
      addIssue(context, 'WARNING', 'A025', 'type=particle has an asset (ignored)', `${path}.asset`, layerId);
    }
    if (hasValue(layer, 'text')) {
      addIssue(context, 'WARNING', 'A026', 'type=particle has a text block (ignored)', `${path}.text`, layerId);
    }

    return;
  }

  const text = layer['text'];

  if (!hasValue(layer, 'text')) {
    addIssue(context, 'ERROR', 'A011', 'type=text requires a text block', `${path}.text`, layerId);
  } else if (!isRecord(text)) {
    addIssue(context, 'ERROR', 'A012', `text is ${describeValueType(text)}, expected an object`, `${path}.text`, layerId);
  } else {
    for (const [field, code, expected] of [
      ['content', 'A013', 'string'],
      ['size', 'A014', 'number'],
    ] as const) {
      const value = text[field];

      if (!hasValue(text, field)) {
        addIssue(context, 'ERROR', code, `text.${field} is missing`, `${path}.text.${field}`, layerId);
      } else if (expected === 'number' && !isNumber(value)) {
        addIssue(
          context,
          'ERROR',
          code,
          `text.${field} is ${describeValueType(value)}, expected a number`,
          `${path}.text.${field}`,
          layerId,
        );
      } else if (expected === 'string' && typeof value !== 'string') {
        addIssue(
          context,
          'ERROR',
          code,
          `text.${field} is ${describeValueType(value)}, expected a string`,
          `${path}.text.${field}`,
          layerId,
        );
      }
    }
    if (isNumber(text['size']) && text['size'] <= 0) {
      addIssue(
        context,
        'ERROR',
        'A014',
        `text.size is ${formatNumber(text['size'])}, expected a number greater than 0`,
        `${path}.text.size`,
        layerId,
      );
    }
    if (!isValidHexColor(text['color'])) {
      addIssue(
        context,
        'WARNING',
        'A015',
        `text.color ${formatValue(text['color'])} is missing or not a supported hex color; a fallback color will be used`,
        `${path}.text.color`,
        layerId,
      );
    }
    if (hasValue(text, 'font') && typeof text['font'] !== 'string') {
      addIssue(context, 'WARNING', 'A018', 'text.font must be a string', `${path}.text.font`, layerId);
    }
    if (
      hasValue(text, 'align') &&
      text['align'] !== 'left' &&
      text['align'] !== 'center' &&
      text['align'] !== 'right'
    ) {
      addIssue(
        context,
        'WARNING',
        'A019',
        'text.align must be left, center, or right',
        `${path}.text.align`,
        layerId,
      );
    }
    if (isNumber(text['line_height']) && text['line_height'] <= 0) {
      addIssue(context, 'WARNING', 'A027', 'text.line_height must be greater than 0', `${path}.text.line_height`, layerId);
    }
    for (const field of ['line_height', 'letter_spacing'] as const) {
      if (hasValue(text, field) && !isNumber(text[field])) {
        addIssue(
          context,
          'WARNING',
          'A020',
          `text.${field} must be a finite number`,
          `${path}.text.${field}`,
          layerId,
        );
      }
    }
  }
  if (hasAsset) {
    addIssue(context, 'WARNING', 'A017', 'type=text has an asset (ignored)', `${path}.asset`, layerId);
  }
}

function checkAssetFields(
  asset: DSLRecord,
  assetPath: string,
  layerId: string | null,
  context: DSLValidationContext,
): void {
  const source = asset['source'];

  if (!hasValue(asset, 'source')) {
    addIssue(context, 'ERROR', 'A003', 'asset.source is missing', `${assetPath}.source`, layerId);

    return;
  }
  if (typeof source !== 'string' || !VALID_ASSET_SOURCE_SET.has(source)) {
    addIssue(
      context,
      'ERROR',
      'A004',
      `asset.source ${formatValue(source)} not in {user, llm_svg}`,
      `${assetPath}.source`,
      layerId,
    );

    return;
  }

  if (source === 'llm_svg') {
    const url = asset['url'];
    const canUseUrl = readSVGAssetUrl(url) !== undefined;
    const canUseInlineSvg = encodeInlineSVGUrl(asset['svg']) !== undefined;

    if (asset['format'] !== 'svg') {
      addIssue(
        context,
        'ERROR',
        'A005',
        `asset.format is ${formatValue(asset['format'])}, must be 'svg' for llm_svg`,
        `${assetPath}.format`,
        layerId,
      );
    }
    if (!canUseInlineSvg) {
      addIssue(
        context,
        canUseUrl ? 'WARNING' : 'ERROR',
        'A006',
        'asset.svg must be a non-empty encodable string' + (canUseUrl ? '; using asset.url' : ''),
        `${assetPath}.svg`,
        layerId,
      );
    }
    if (typeof asset['prompt'] !== 'string') {
      addIssue(context, 'WARNING', 'A007', 'asset.prompt must be a string', `${assetPath}.prompt`, layerId);
    }
    if (url !== undefined && url !== '' && !canUseUrl) {
      addIssue(
        context,
        canUseInlineSvg ? 'WARNING' : 'ERROR',
        'A021',
        'asset.url must be an absolute URL or a decodable Data URL' + (canUseInlineSvg ? '; using inline SVG' : ''),
        `${assetPath}.url`,
        layerId,
      );
    }
  } else {
    if (typeof asset['url'] !== 'string') {
      addIssue(context, 'ERROR', 'A008', 'asset.url must be a string', `${assetPath}.url`, layerId);
    } else if (!isAbsoluteResourceUrl(asset['url'])) {
      addIssue(
        context,
        'ERROR',
        'A008',
        'asset.url must be absolute or a Data URL',
        `${assetPath}.url`,
        layerId,
      );
    }
    if (asset['prompt'] !== '') {
      addIssue(
        context,
        'WARNING',
        'A009',
        `asset.prompt must be '' for source=user, got ${formatValue(asset['prompt'])}`,
        `${assetPath}.prompt`,
        layerId,
      );
    }
  }
}

function checkLayerRelationships(entries: LayerEntry[], context: DSLValidationContext): void {
  const firstLayerById = new Map<string, LayerEntry>();
  const layerCountById = new Map<string, number>();

  for (const entry of entries) {
    if (entry.layerId == null) {
      continue;
    }
    layerCountById.set(entry.layerId, (layerCountById.get(entry.layerId) ?? 0) + 1);
    if (!firstLayerById.has(entry.layerId)) {
      firstLayerById.set(entry.layerId, entry);
    }
  }

  for (const entry of entries) {
    if (entry.layerId == null || (layerCountById.get(entry.layerId) ?? 0) <= 1) {
      continue;
    }
    addIssue(
      context,
      'ERROR',
      'X001',
      `id ${formatValue(entry.layerId)} is not globally unique (${layerCountById.get(entry.layerId)} occurrences)`,
      `${entry.path}.id`,
      entry.layerId,
    );
  }

  const logicalParentIdByLayer = new Map<LayerEntry, string | null>();

  for (const entry of entries) {
    const parent = entry.layer['parent'];
    let resolvedParentId: string | null = null;

    if (parent == null) {
      resolvedParentId = null;
    } else if (typeof parent !== 'string') {
      addIssue(
        context,
        'ERROR',
        'X003',
        `parent is ${describeValueType(parent)}, expected a string or null`,
        `${entry.path}.parent`,
        entry.layerId,
      );
    } else if (entry.layerId != null && parent === entry.layerId) {
      addIssue(
        context,
        'ERROR',
        'X002',
        `parent ${formatValue(parent)} references own id (self-reference)`,
        `${entry.path}.parent`,
        entry.layerId,
      );
    } else if (!firstLayerById.has(parent)) {
      addIssue(
        context,
        'ERROR',
        'X004',
        `parent ${formatValue(parent)} not found (dangling reference)`,
        `${entry.path}.parent`,
        entry.layerId,
      );
    } else {
      resolvedParentId = parent;
    }

    logicalParentIdByLayer.set(entry, resolvedParentId);

    if (resolvedParentId != null && entry.physicalParentId !== resolvedParentId) {
      addIssue(
        context,
        'WARNING',
        'X005',
        `parent=${formatValue(resolvedParentId)} but physical nesting under ${formatValue(entry.physicalParentId)} (parent wins)`,
        `${entry.path}.parent`,
        entry.layerId,
      );
    } else if (resolvedParentId == null && parent == null && entry.physicalParentId != null) {
      addIssue(
        context,
        'WARNING',
        'X005',
        `layer nested under ${formatValue(entry.physicalParentId)} but parent is null/absent`,
        `${entry.path}.parent`,
        entry.layerId,
      );
    }
  }

  checkParentCycles(entries, firstLayerById, logicalParentIdByLayer, context);
}

function checkParentCycles(
  entries: LayerEntry[],
  firstLayerById: Map<string, LayerEntry>,
  logicalParentIdByLayer: Map<LayerEntry, string | null>,
  context: DSLValidationContext,
): void {
  const resolvedLayerSet = new Set<LayerEntry>();
  const cycleEntries: LayerEntry[] = [];

  for (const start of entries) {
    if (resolvedLayerSet.has(start)) {
      continue;
    }

    const pathEntries: LayerEntry[] = [];
    const visitedLayerIdSet = new Set<string>();
    let current: LayerEntry | undefined = start;

    while (current != null) {
      const currentId = current.layerId;

      if (currentId == null) {
        break;
      }
      if (visitedLayerIdSet.has(currentId)) {
        const cycleStartIndex = pathEntries.findIndex(entry => entry.layerId === currentId);

        if (cycleStartIndex >= 0) {
          cycleEntries.push(...pathEntries.slice(cycleStartIndex));
        }

        break;
      }
      if (resolvedLayerSet.has(current)) {
        break;
      }

      pathEntries.push(current);
      visitedLayerIdSet.add(currentId);
      const parentId = logicalParentIdByLayer.get(current);

      current = parentId == null ? undefined : firstLayerById.get(parentId);
    }

    pathEntries.forEach(entry => resolvedLayerSet.add(entry));
  }

  const reportedCycleLayerSet = new Set<LayerEntry>();

  for (const entry of cycleEntries) {
    if (reportedCycleLayerSet.has(entry)) {
      continue;
    }
    reportedCycleLayerSet.add(entry);
    addIssue(
      context,
      'ERROR',
      'X006',
      `layer ${formatValue(entry.layerId)} is part of a parent-pointer cycle`,
      `${entry.path}.parent`,
      entry.layerId,
    );
  }
}

function readLayerId(layer: DSLRecord): string | null {
  const id = layer['id'];

  return typeof id === 'string' && id.length > 0 ? id : null;
}

function containsCircularReference(value: unknown, ancestorSet = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (ancestorSet.has(value)) {
    return true;
  }

  ancestorSet.add(value);
  const hasCircularChild = Object.values(value).some(child => containsCircularReference(child, ancestorSet));

  ancestorSet.delete(value);

  return hasCircularChild;
}

function hasValue(object: DSLRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] != null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (isRecord(value)) {
    return 'object';
  }

  return typeof value;
}

function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(', ')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .map(([key, item]) => `${formatValue(key)}: ${formatValue(item)}`)
      .join(', ')}}`;
  }

  return String(value);
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Infinity) {
    return 'Infinity';
  }
  if (value === -Infinity) {
    return '-Infinity';
  }

  return String(value);
}
