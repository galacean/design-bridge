import { maskShaderComments } from '../parser/mask-shader-comments';

export function convertTimeUniformToVarying(fragment: string): string {
  const declarationRegex = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?float\s+uTime\s*;/g;
  const sourceWithoutComments = maskShaderComments(fragment);
  let replaced = false;

  return fragment.replace(declarationRegex, (declaration: string, offset: number) => {
    if (sourceWithoutComments.slice(offset, offset + declaration.length) !== declaration) {
      return declaration;
    }

    if (replaced) {
      return '';
    }

    replaced = true;

    return 'varying float vTime;\n#define uTime vTime\n';
  });
}
