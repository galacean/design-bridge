/**
 * 收集转换 warning；严格模式下将 warning 转为转换错误。
 */
import { SVGConverterError, SVG_CONVERTER_ERROR_CODES } from '../../../common/errors';
import type { SVG2IRWarning, SVG2IRWarningCode } from '../../../common/types';

export function collectWarning (
  emit: (w: SVG2IRWarning) => void,
  code: SVG2IRWarningCode,
  message: string,
  elementSelector: string | undefined,
  strict: boolean | undefined,
): void {
  if (strict === true) {
    throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.PARSE_FAIL, message, {
      warningCode: code,
      elementSelector,
    });
  }
  emit({ code, message, elementSelector });
}

/** 元素定位提示:tag#id 或 tag:nth。供 warning 的 elementSelector 用。 */
export function describeElement (el: { node?: Element | null }): string | undefined {
  const node = (el).node;

  if (node == null) { return undefined; }
  const tag = node.tagName?.toLowerCase() ?? 'element';
  const id = node.getAttribute?.('id');

  return id != null && id !== '' ? `${tag}#${id}` : tag;
}
