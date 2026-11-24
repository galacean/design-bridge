import { maskShaderComments } from '../parser/mask-shader-comments';

export function convertMainImageToFragmentShader(source: string): string {
  let body = removeCodeMatches(source, /\bprecision\s+\w+\s+float\s*;/g);

  body = removeCodeMatches(body, /^[ \t]*#version[ \t]+[^/\n\r]*(?=\/\/|$)/gm);
  body = removeCodeMatches(
    body,
    /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler2D\s+iChannel[0-3]\s*;/g,
  );

  const sourceWithoutComments = maskShaderComments(body);
  const usedChannels = Array.from(
    sourceWithoutComments.matchAll(/\biChannel([0-3])\b/g),
    match => `iChannel${match[1]}`,
  );
  const channelSet = new Set(usedChannels);
  const headerLines = [
    'precision highp float;',
    'varying vec2 vUV;',
    'varying float vTime;',
    'uniform vec4 iResolution; // viewport resolution (pixels, xy used)',
  ];

  for (const channel of Array.from(channelSet).sort()) {
    headerLines.push(`uniform sampler2D ${channel};`);
  }

  headerLines.push('', '#define iTime vTime');

  const footer = [
    '',
    'void main() {',
    '  vec2 fragCoord = vUV * iResolution.xy;',
    '  vec4 fragColor;',
    '  mainImage(fragColor, fragCoord);',
    '  gl_FragColor = fragColor;',
    '}',
  ].join('\n');

  return `${headerLines.join('\n')}\n\n${body}\n${footer}`;
}

function removeCodeMatches(source: string, pattern: RegExp): string {
  const sourceWithoutComments = maskShaderComments(source);

  return source.replace(pattern, (match: string, offset: number) =>
    sourceWithoutComments.slice(offset, offset + match.length) === match ? '' : match,
  );
}
