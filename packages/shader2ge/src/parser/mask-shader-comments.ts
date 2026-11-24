/** Replace comment contents with spaces while preserving source length and line breaks. */
export function maskShaderComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n\r]*/g, comment => ' '.repeat(comment.length));
}
