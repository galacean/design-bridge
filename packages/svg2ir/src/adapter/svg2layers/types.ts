import type { ConvertOptions, SVG2IRWarning } from '../../common/types';

/** 图片读取结果；data 为原始文件字节，不是 Base64 字符串。 */
export interface SVGImageResource {
  data: Uint8Array;
  mimeType: string;
}

/** 读取外链、本地文件或需要鉴权的图片资源。 */
export type SVGImageResourceLoader = (url: string) => Promise<SVGImageResource>;

export interface SVGToLayersOptions extends ConvertOptions {
  /** 外链图片读取回调，默认使用 fetch。 */
  loadImage?: SVGImageResourceLoader;
  /** 烘焙分辨率倍数，默认 2，不改变显示尺寸。 */
  rasterScale?: number;
}

/** 像素边界：[左、上、右、下]。 */
export type SVGLayerBBox = [number, number, number, number];

export interface SVGImageLayer {
  id: string;
  type: 'image';
  /** 图层业务角色；原生 SVG 图片默认为 content，不根据图片内容推断。 */
  role: 'background' | 'content' | 'text_pixels';
  bbox: SVGLayerBBox;
  /** 缩放后的显示宽高（px），不包含旋转造成的包围盒扩张。 */
  size: [number, number];
  /** XYZ 欧拉角（度）；二维 SVG 仅 Z 生效，正值在画布上顺时针旋转。 */
  rotation: [number, number, number];
  /** 内联图片资源，格式为 data:image/...;base64,...。 */
  url: string;
  /** 兼容字段：轴对齐 bbox 的宽高；还原图片显示尺寸应使用 size。 */
  width: number;
  height: number;
}

export interface SVGTextFragment {
  content: string;
  /** 相对文字层左上角的坐标。 */
  bbox: SVGLayerBBox;
  /** 相对文字层的布局四边形，依次为变换前的左上、右上、右下、左下角；不是字形轮廓。 */
  polygon: Array<[number, number]> | null;
  /** 字体名，不含 CSS 外层引号。 */
  font_family: string;
  font_size: number;
  color: string;
  letter_spacing: number;
  direction: 'horizontal' | 'vertical';
  rotation: number;
}

export interface SVGLayerEraseOperation {
  source_layer_id: string;
  bbox: SVGLayerBBox;
}

export interface SVGTextLayer {
  id: string;
  type: 'text';
  /** 原生文字已可编辑，不属于从图片识别出的待转换候选。 */
  state: 'active';
  bbox: SVGLayerBBox;
  content: string;
  fragments: SVGTextFragment[];
  /** 原生文字没有对应的图片擦除操作。 */
  erase_operations: SVGLayerEraseOperation[];
}

export type SVGStaticLayer = SVGImageLayer | SVGTextLayer;

export interface SVGToLayersResult {
  /** 独立返回的画布宽高（px），不属于 data 中的图层 JSON。 */
  size: [number, number];
  data: SVGStaticLayer[];
  warnings: SVG2IRWarning[];
}
