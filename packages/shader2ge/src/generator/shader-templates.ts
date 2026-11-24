export const FULLSCREEN_VERTEX_SHADER = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUV;
uniform vec4 _Time;
uniform mat4 effects_ObjectToWorld;
uniform mat4 effects_MatrixVP;
varying vec2 vUV;
varying float vTime;

void main () {
  vUV = aUV;
  vTime = _Time.y;
  gl_Position = effects_MatrixVP * effects_ObjectToWorld * vec4(aPos, 1.0);
}
`.trim();

export const FALLBACK_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform float uTime;

void main () {
  vec3 color = 0.5 + 0.5 * cos(uTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(color, 1.0);
}
`.trim();
