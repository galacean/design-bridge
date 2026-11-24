/** Stable codes for blocking Scene contract violations; use these rather than parsing error messages. */
export type IRValidationErrorCode =
  | 'IR_SCENE_INVALID'
  | 'IR_SCENE_FORMAT_INVALID'
  | 'IR_SCENE_SCHEMA_VERSION_INVALID'
  | 'IR_SCENE_ENTRY_COMPOSITION_ID_INVALID'
  | 'IR_SCENE_ENTRY_COMPOSITION_MISSING'
  | 'IR_SCENE_COMPOSITIONS_INVALID'
  | 'IR_SCENE_ASSETS_INVALID'
  | 'IR_COMPOSITION_INVALID'
  | 'IR_COMPOSITION_ID_INVALID'
  | 'IR_COMPOSITION_ID_DUPLICATE'
  | 'IR_COMPOSITION_NAME_INVALID'
  | 'IR_COMPOSITION_WIDTH_INVALID'
  | 'IR_COMPOSITION_HEIGHT_INVALID'
  | 'IR_COMPOSITION_FRAME_RATE_INVALID'
  | 'IR_COMPOSITION_IN_POINT_INVALID'
  | 'IR_COMPOSITION_OUT_POINT_INVALID'
  | 'IR_COMPOSITION_TIME_RANGE_INVALID'
  | 'IR_COMPOSITION_BACKGROUND_COLOR_INVALID'
  | 'IR_COMPOSITION_END_BEHAVIOR_INVALID'
  | 'IR_COMPOSITION_LAYERS_INVALID'
  | 'IR_ASSET_INVALID'
  | 'IR_ASSET_ID_INVALID'
  | 'IR_ASSET_ID_DUPLICATE'
  | 'IR_ASSET_TYPE_INVALID'
  | 'IR_ASSET_SOURCE_INVALID'
  | 'IR_ASSET_MIME_TYPE_INVALID'
  | 'IR_ASSET_DATA_INVALID'
  | 'IR_ASSET_FONT_FAMILY_INVALID'
  | 'IR_ASSET_FONT_STYLE_INVALID'
  | 'IR_ASSET_FONT_WEIGHT_INVALID'
  | 'IR_LAYER_INVALID'
  | 'IR_LAYER_ID_INVALID'
  | 'IR_LAYER_ID_DUPLICATE'
  | 'IR_LAYER_NAME_INVALID'
  | 'IR_LAYER_TYPE_INVALID'
  | 'IR_LAYER_VISIBILITY_INVALID'
  | 'IR_LAYER_END_BEHAVIOR_INVALID'
  | 'IR_LAYER_BLEND_MODE_INVALID'
  | 'IR_LAYER_TIME_INVALID'
  | 'IR_LAYER_TIME_START_INVALID'
  | 'IR_LAYER_TIME_END_INVALID'
  | 'IR_LAYER_TIME_RANGE_INVALID'
  | 'IR_LAYER_TIME_STRETCH_INVALID'
  | 'IR_LAYER_TIME_SOURCE_START_INVALID'
  | 'IR_LAYER_PARENT_INVALID'
  | 'IR_LAYER_PARENT_SELF_REFERENCE'
  | 'IR_LAYER_PARENT_OUT_OF_RANGE'
  | 'IR_LAYER_PARENT_CYCLE'
  | 'IR_LAYER_MATTE_INVALID'
  | 'IR_LAYER_MATTE_SELF_REFERENCE'
  | 'IR_LAYER_MATTE_SOURCE_OUT_OF_RANGE'
  | 'IR_LAYER_MATTE_CYCLE'
  | 'IR_LAYER_LOCAL_BOUNDS_INVALID'
  | 'IR_LAYER_CONTENT_INVALID'
  | 'IR_LAYER_IMAGE_ASSET_MISSING'
  | 'IR_LAYER_IMAGE_ASSET_TYPE_INVALID'
  | 'IR_LAYER_IMAGE_CONTENT_INVALID'
  | 'IR_LAYER_PRECOMP_CONTENT_INVALID'
  | 'IR_LAYER_PRECOMP_COMPOSITION_MISSING'
  | 'IR_PARTICLE_CONTENT_INVALID'
  | 'IR_PARTICLE_EXPRESSION_INVALID'
  | 'IR_PARTICLE_EMISSION_INVALID'
  | 'IR_PARTICLE_BURST_INVALID'
  | 'IR_COMPOSITION_REFERENCE_CYCLE'
  | 'IR_LAYER_SOLID_COLOR_MISSING'
  | 'IR_LAYER_SOLID_COLOR_INVALID'
  | 'IR_TRANSFORM_INVALID'
  | 'IR_ANIMATED_PROPERTY_INVALID'
  | 'IR_KEYFRAME_INVALID'
  | 'IR_TEXT_DATA_MISSING'
  | 'IR_TEXT_DATA_INVALID'
  | 'IR_TEXT_FONT_ASSET_MISSING'
  | 'IR_TEXT_FONT_ASSET_TYPE_INVALID'
  | 'IR_TEXT_COLOR_INVALID'
  | 'IR_SHAPE_DATA_MISSING'
  | 'IR_SHAPE_DATA_INVALID'
  | 'IR_SHAPE_PAINT_INVALID'
  | 'IR_SHAPE_TEXTURE_ASSET_MISSING'
  | 'IR_SHAPE_TEXTURE_ASSET_TYPE_INVALID'
  | 'IR_MASK_DATA_INVALID';

/** Stable codes for non-blocking reachability, portability and empty-content diagnostics. */
export type IRValidationWarningCode =
  | 'IR_COMPOSITION_UNREACHABLE'
  | 'IR_ASSET_FONT_SYSTEM_PORTABILITY'
  | 'IR_SHAPE_DATA_EMPTY';

/** Blocking contract violation; path is relative to the Scene root, with $ denoting the root itself. */
export interface IRValidationIssue {
  code: IRValidationErrorCode;
  path: string;
  layerId?: string;
  message: string;
}

/** Non-blocking issue involving an unreachable composition, a system font dependency, or empty shape data. */
export interface IRValidationWarning {
  code: IRValidationWarningCode;
  path: string;
  layerId?: string;
  message: string;
}

/** Structural and reference validation report; valid is true exactly when errors is empty. */
export interface IRValidationResult {
  valid: boolean;
  errors: IRValidationIssue[];
  warnings: IRValidationWarning[];
}

/** Error thrown by `assertIRScene`; code, path and layerId describe the first blocking issue. */
export class IRValidationError extends Error {
  readonly code: IRValidationErrorCode;
  readonly path: string;
  readonly layerId?: string;
  /** All blocking issues collected by the failed assertion. */
  readonly issues: readonly IRValidationIssue[];

  constructor(issue: IRValidationIssue, issues: readonly IRValidationIssue[] = [issue]) {
    super(`[animation-ir:validate] ${issue.code} at ${issue.path}: ${issue.message}`);
    this.name = 'IRValidationError';
    this.code = issue.code;
    this.path = issue.path;
    this.layerId = issue.layerId;
    this.issues = issues;
  }
}
