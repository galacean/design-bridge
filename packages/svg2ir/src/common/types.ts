import type { IRScene } from '@galacean/animation-ir';

/** SVG 字符串。convertSVGToIR 的输入。 */
export type SVGSource = string;

/** SVG → Animation IR 转换选项。 */
export interface ConvertOptions {
  /** 画布帧率，决定 IR 帧时间。默认 30。 */
  frameRate?: number;
  /** 静态 SVG 的展示时长（秒）。动态 SVG 可由 SMIL active interval 覆盖。默认 5。 */
  durationSeconds?: number;
  /** 输出 IR composition 的画布底色；未传时保持透明。支持 SVG 颜色字符串。 */
  backgroundColor?: string | null;
  /** true 时遇到无法表达的元素中断转换；false(默认)记录 warning 并继续。 */
  strict?: boolean;
  /** warning 回调：每条 warning 会先进入 ConvertResult.warnings，再通知调用方。 */
  onWarning?: (warning: SVG2IRWarning) => void;
  /** 同步文本测量回调，用于计算文字边界；调用转换前需加载测量使用的字体。 */
  measureText?: (fontDesc: string, text: string) => {
    width: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
    actualBoundingBoxAscent?: number;
    hangingBaseline?: number;
  };
  /** SVG 来源的绝对 URL，用于把相对图片 href 解析为规范化 IR Asset URL。 */
  resourceBaseUrl?: string;
  /** 图片 intrinsic(自然)尺寸表,url→{width,height}。用于算 <image> 默认 preserveAspectRatio="xMidYMid meet"
   *  的 fitted 几何框(svg2ir 不下载图、Node/svgdom 无 HTMLImageElement,自己拿不到自然尺寸)。浏览器调用方通常
   *  走 inlineSvgImages 给 <image> 盖 data-natural-w/h(优先于此表);Node 调用方读 PNG/JPEG 文件头建此表
   *  传入。两者都无时，meet 使用 full-fit 拉伸。key 用 <image> href 原值(xlink:href/href/dataURI)。 */
  imageNaturalSizes?: Map<string, { width: number; height: number }>;
}

/** SVG 转换产出。 */
export interface ConvertResult {
  /** SVG 解析后的完整 IRScene。 */
  ir: IRScene;
  /** 转换过程丢弃/降级的特性列表。 */
  warnings: SVG2IRWarning[];
}

/** 转换过程中产生的烘焙、降级或内容损失诊断。 */
export interface SVG2IRWarning {
  code: SVG2IRWarningCode;
  message: string;
  /** 触发元素在 SVG 里的定位提示(id/tag/索引等)。 */
  elementSelector?: string;
}

/** SVG 转换诊断码；用于报告烘焙、降级和不支持的特性。 */
export const SVG2IR_WARNING_CODES = {
  /** 图形或图形组已栅格化，矢量编辑能力变化通过 warning 报告。 */
  LAYERS_GRAPHIC_BAKED: 'svg2ge_layers_graphic_baked',
  LAYERS_BLEND_MODE_DOWNGRADED: 'svg2ge_layers_blend_mode_downgraded',
  LAYERS_ANIMATION_STRIPPED: 'svg2ge_layers_animation_stripped',
  LAYERS_UNSUPPORTED_TYPE: 'svg2ge_layers_unsupported_type',
  LAYERS_UNSUPPORTED_FEATURE: 'svg2ge_layers_unsupported_feature',
  LAYERS_INVALID_DATA: 'svg2ge_layers_invalid_data',
  LAYERS_TEXT_STYLE_DROPPED: 'svg2ge_layers_text_style_dropped',
  LAYERS_TEXT_BOUNDS_ESTIMATED: 'svg2ge_layers_text_bounds_estimated',
  /** 元素整体不渲染也不映射(无法展开的 use、foreignObject、switch 等不支持元素)。 */
  ELEMENT_DROPPED: 'svg2ir_element_dropped',
  /** stroke-dasharray/dashoffset 无法完整写入当前 IR，按可表达子集处理。 */
  STROKE_DASH_DROPPED: 'svg2ir_stroke_dash_dropped',
  /** SVG filter(feGaussianBlur 等)没有对应 IR 字段。 */
  FILTER_DROPPED: 'svg2ir_filter_dropped',
  /** pattern 平铺填充没有对应 IR paint。 */
  PATTERN_DROPPED: 'svg2ir_pattern_dropped',
  /** skewX/skewY 没有对应 IR transform 通道。 */
  SKEW_DROPPED: 'svg2ir_skew_dropped',
  /** IRTextContent 只有单色文本填充，渐变文字按中点色处理。 */
  TEXT_GRADIENT_FILL_FLATTENED: 'svg2ir_text_gradient_fill_flattened',
  /** IRTextContent 没有文本描边字段。 */
  TEXT_STROKE_DROPPED: 'svg2ir_text_stroke_dropped',
  /** IRTextContent 没有 text-decoration 字段。 */
  TEXT_DECORATION_DROPPED: 'svg2ir_text_decoration_dropped',
  /** Effects adapter 未获得调用方提供的字体文件，运行时可能使用 fallback。 */
  TEXT_FONT_NOT_SUPPLIED: 'svg2ir_text_font_not_supplied',
  /** ge-ir 导出阶段报告了规范化或保真降级。 */
  GE_EXPORT_DIAGNOSTIC: 'svg2ir_ge_export_diagnostic',
  /** clipPathUnits=objectBoundingBox:裁剪实现只接受 userSpaceOnUse。 */
  CLIP_PATH_UNITS_DROPPED: 'svg2ir_clip_path_units_dropped',
  /** clipPath 内显式 clip-rule/fill-rule 没有对应 IR mask 规则字段。 */
  CLIP_RULE_DROPPED: 'svg2ir_clip_rule_dropped',
  /** <g clip-path> 组级裁剪:当前仅支持元素级 clip-path 与组级 mask。 */
  GROUP_CLIP_PATH_DROPPED: 'svg2ir_group_clip_path_dropped',
  /** maskContentUnits=objectBoundingBox:mask 几何只接受 userSpaceOnUse。 */
  MASK_CONTENT_UNITS_DROPPED: 'svg2ir_mask_content_units_dropped',
  /** maskUnits / x/y/width/height 没有对应 IR mask region 字段。 */
  MASK_REGION_DROPPED: 'svg2ir_mask_region_dropped',
  /** mask-type=luminance/alpha:当前 IR mask 不保留该模式。 */
  MASK_TYPE_DROPPED: 'svg2ir_mask_type_dropped',
} as const;

export type SVG2IRWarningCode = (typeof SVG2IR_WARNING_CODES)[keyof typeof SVG2IR_WARNING_CODES];
