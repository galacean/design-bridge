/**
 * Shader 示例库
 * 包含 GE 原生格式的示例 shader
 */
/** 示例文件中使用的纹理输入结构（与 @galacean/shader2ge 的 TextureInput 结构兼容，但不引用外部类型，避免 IDE union 解析问题） */
export interface ExampleTextureInput {
  url: string;
  wrapS?: number;
  wrapT?: number;
  magFilter?: number;
  minFilter?: number;
  flipY?: boolean;
}

export interface ShaderExample {
  /** 示例名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** fragment shader 源码 */
  code: string;
  /** 推荐的 uniform override 值（支持数值、向量、纹理） */
  overrides: Record<string, number | { x: number; y: number; z: number; w: number } | ExampleTextureInput>;
  /** 来源链接（如有） */
  source?: string;
  /** 推荐时长（秒） */
  duration: number;
  /** 推荐预览尺寸 */
  previewSize: [number, number];
}

// ─── 原生 GE 格式示例 ───

const GLOW_SHADER: ShaderExample = {
  name: '✦ 光晕脉冲',
  description: '爆炸粒子光晕 — 脉冲爆发 + 粒子喷射 + 冲击波 + 火花',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;        // elapsed time
uniform vec4 uColor;        // core glow color
uniform float uIntensity;   // glow intensity
uniform float uRadius;      // glow radius
uniform float uSpeed;       // pulse speed
uniform vec4 uResolution;   // viewport resolution (xy used)

// --- pseudo-random ---
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// --- burst envelope: 0→2s charge, 2s→ explode then pulse ---
float burstEnvelope(float t) {
  float chargeEnd = 2.0;
  if (t < chargeEnd) {
    return 0.0;
  }
  float elapsed = t - chargeEnd;
  float firstBurst = exp(-elapsed * 2.5);
  return max(firstBurst, 0.0);
}

float burstMix(float t) {
  return smoothstep(1.8, 2.2, t);
}

// --- charge phase: gentle breathing glow ---
float chargePulse(float t) {
  return 0.3 + 0.15 * sin(t * 3.0) + 0.08 * sin(t * 7.5);
}

// --- sharp pulse wave with rapid attack, slow decay ---
float pulseBeat(float t) {
  float burstTime = max(0.0, t - 2.0);
  float period = 6.283185 / uSpeed;
  float phase = mod(burstTime, period) / period;
  float attack = pow(max(0.0, 1.0 - phase * 4.0), 0.5);
  float sustain = exp(-phase * 3.5);
  return max(attack, sustain * 0.6);
}

// --- single particle spark ---
float particle(vec2 uv, float angle, float speed, float radius, float size, float t, float phase) {
  float life = fract(t * speed + phase);
  float fadeIn = smoothstep(0.0, 0.05, life);
  float fadeOut = 1.0 - life;
  float currentRadius = life * radius;
  vec2 particlePos = vec2(cos(angle), sin(angle)) * currentRadius;
  float dist = length(uv - particlePos);
  float sparkSize = size * (0.5 + 0.5 * fadeOut);
  float brightness = exp(-dist * dist / max(sparkSize * sparkSize, 0.0001));
  float flicker = 0.7 + 0.3 * sin(t * 30.0 + phase * 100.0);
  return brightness * fadeIn * fadeOut * fadeOut * flicker;
}

// --- shockwave ring ---
float shockwave(float dist, float t) {
  float burstTime = max(0.0, t - 2.0);
  float period = 6.283185 / uSpeed;
  float phase = mod(burstTime, period) / period;
  float ringRadius = phase * 0.6;
  float ringWidth = 0.015 + phase * 0.02;
  float ring = exp(-pow(dist - ringRadius, 2.0) / (ringWidth * ringWidth));
  float fade = exp(-phase * 4.0);
  return ring * fade * 1.5;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float dist = length(uv);
  float angle = atan(uv.y, uv.x);
  float t = uTime;

  // --- phase control ---
  float burst = burstMix(t);
  float burstEnv = burstEnvelope(t);
  float charge = chargePulse(t);
  float beat = pulseBeat(t);

  // --- charge phase: small breathing glow (before 2s) ---
  float chargeRadius = uRadius * 0.35 * (1.0 + charge * 0.3);
  float chargeGlow = uIntensity * 0.4 * exp(-dist * dist / max(chargeRadius * chargeRadius, 0.001));
  // charging ramp: glow grows as we approach burst moment
  float chargeRamp = smoothstep(0.0, 2.0, t);
  chargeGlow *= (0.5 + 0.5 * chargeRamp);
  vec3 chargeColor = uColor.rgb * chargeGlow * (0.4 + 0.3 * charge);
  // small warm core during charge
  float chargeCore = exp(-dist * dist / 0.001) * (0.3 + 0.2 * charge) * chargeRamp;
  chargeColor += vec3(1.0, 0.95, 0.85) * chargeCore;
  // orbiting charge particles: small motes spiraling inward
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float orbitAngle = fi * 0.628318 + t * (1.5 + hash(fi * 5.3) * 1.0);
    float orbitRadius = 0.08 + 0.06 * hash(fi * 9.1) - chargeRamp * 0.03;
    vec2 motePos = vec2(cos(orbitAngle), sin(orbitAngle)) * orbitRadius;
    float moteDist = length(uv - motePos);
    float moteSize = 0.004 + 0.003 * hash(fi * 11.7);
    float moteBright = exp(-moteDist * moteDist / (moteSize * moteSize));
    float moteFlicker = 0.6 + 0.4 * sin(t * 12.0 + fi * 7.0);
    float moteFade = chargeRamp * moteFlicker;
    vec3 moteColor = mix(uColor.rgb, vec3(1.0, 0.9, 0.7), 0.4 + 0.3 * hash(fi * 3.7));
    chargeColor += moteColor * moteBright * moteFade * 0.8;
  }

  // --- burst phase: full explosion (after 2s) ---
  float glowRadius = uRadius * (0.6 + 0.6 * beat + 0.4 * burstEnv);
  float glow = uIntensity * exp(-dist * dist / max(glowRadius * glowRadius, 0.001));

  float core = exp(-dist * dist / 0.002) * (beat + burstEnv) * 2.0;
  vec3 coreColor = vec3(1.0, 0.95, 0.85) * core;

  vec3 glowColor = uColor.rgb * glow * (0.5 + 0.7 * beat);

  // --- particle burst: 24 particles (only after burst) ---
  float burstTime = max(0.0, t - 2.0);
  float particles = 0.0;
  vec3 particleColor = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float pAngle = hash(fi * 7.3) * 6.283185;
    float pSpeed = 0.25 + hash(fi * 3.1) * 0.3;
    float pRadius = 0.2 + hash(fi * 11.7) * 0.35;
    float pSize = 0.008 + hash(fi * 5.9) * 0.012;
    float pPhase = hash(fi * 13.3);
    float sparkVal = particle(uv, pAngle, pSpeed, pRadius, pSize, burstTime, pPhase);
    float hueShift = hash(fi * 17.1);
    vec3 sparkColor = mix(uColor.rgb, vec3(1.0, 0.4, 0.1), hueShift * 0.6);
    sparkColor = mix(sparkColor, vec3(1.0, 1.0, 0.9), sparkVal * 0.5);
    particleColor += sparkColor * sparkVal;
    particles += sparkVal;
  }

  // --- radial streaks (only after burst) ---
  float streaks = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float streakAngle = hash(fi * 23.7) * 6.283185;
    float angleDiff = abs(mod(angle - streakAngle + 3.14159, 6.28318) - 3.14159);
    float streakWidth = 0.03 + hash(fi * 31.1) * 0.04;
    float streak = exp(-angleDiff * angleDiff / (streakWidth * streakWidth));
    float life = fract(burstTime * (0.2 + hash(fi * 9.3) * 0.2) + hash(fi * 41.7));
    float radialFade = smoothstep(0.0, 0.05, dist) * exp(-dist / (0.15 + life * 0.25));
    streaks += streak * radialFade * life * beat;
  }

  // --- shockwave ---
  float wave = shockwave(dist, t);
  vec3 waveColor = mix(uColor.rgb, vec3(1.0, 0.9, 0.7), 0.5) * wave;

  // --- compose: crossfade charge → burst ---
  vec3 burstColor = vec3(0.0);
  burstColor += glowColor;
  burstColor += coreColor;
  burstColor += particleColor * 1.2;
  burstColor += uColor.rgb * streaks * 0.5;
  burstColor += waveColor;

  vec3 color = mix(chargeColor, burstColor, burst);

  // --- bloom ---
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.6, 1.5, luminance) * 0.4;

  // --- vignette ---
  float vignette = 1.0 - 0.3 * length(vUV - 0.5);
  color *= vignette;

  float alpha = mix(chargeGlow, max(glow, max(particles, wave)), burst) * uColor.a;
  alpha = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`.trim(),
  overrides: {
    uColor: { x: 1, y: 0.7, z: 0.2, w: 1 },
    uIntensity: 1.8,
    uRadius: 0.25,
    uSpeed: 1.2,
  },
  duration: 8,
  previewSize: [1280, 720],
};

const GRADIENT_SHADER: ShaderExample = {
  name: '🌈 极光渐变',
  description: '极光波动 — 多层体积光帘 + 射线结构 + 垂直条带 + 层间散射 + 辉光弥漫',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uSpeed;       // animation speed
uniform vec4 uResolution;   // viewport resolution (xy used)

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    val += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return val;
}

// domain-warped fbm for organic swirling (slow-timed)
float warpedFbm(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t * 0.06),
                fbm(p + vec2(5.2, 1.3) + t * 0.05));
  return fbm(p + 2.0 * q);
}

// vertical ray/curtain structure — bright vertical bands
float curtainRays(vec2 uv, float t, float offset) {
  float rays = 0.0;
  float x = uv.x * 3.0 + offset;
  // primary vertical bands (slow drift)
  float band1 = sin(x * 2.5 + t * 0.08) * 0.5 + 0.5;
  float band2 = sin(x * 4.1 - t * 0.12 + 1.7) * 0.5 + 0.5;
  float band3 = sin(x * 7.3 + t * 0.06 + 3.2) * 0.5 + 0.5;
  rays = band1 * 0.5 + band2 * 0.3 + band3 * 0.2;
  // modulate by noise for organic edges (lower frequency)
  rays *= 0.5 + 0.5 * noise(vec2(uv.x * 8.0 + offset, t * 0.1));
  return rays;
}

// volume-enhanced aurora curtain with depth layering
float auroraCurtain(vec2 uv, float t, float freq, float offset, float depth) {
  // horizontal warp driven by domain-warped fbm (slow)
  float warp = warpedFbm(vec2(uv.x * 1.5 + offset, t * 0.08), t) * 0.6;
  warp += sin(uv.x * freq + t * 0.15 + offset) * 0.2;

  float curtainCenter = warp;

  // create multi-band structure: bright core + softer outer bands
  float dist = uv.y - curtainCenter;
  float absDist = abs(dist);

  // core band (bright, narrow) — stretched vertically
  float coreWidth = 0.04 + fbm(vec2(uv.x * 4.0 + offset, t * 0.06)) * 0.06;
  float core = exp(-dist * dist / (coreWidth * coreWidth));

  // middle glow band — larger, use wider falloff for smoother merge
  float midWidth = 0.10 + fbm(vec2(uv.x * 2.5 + offset * 1.3, t * 0.07)) * 0.12;
  float mid = exp(-absDist / midWidth); // exponential (not gaussian) for slower tail decay

  // outer diffuse glow — use even slower falloff
  float outerWidth = 0.22 + fbm(vec2(uv.x * 1.5 + offset * 0.7, t * 0.04)) * 0.14;
  float outer = exp(-absDist / outerWidth); // exponential: smoother transition to transparent

  // combine with soft crossfade: core→mid→outer blend without kinks
  // use power curves to ensure the shoulders of each band merge smoothly
  float curtain = core * 1.0 + mid * 0.45 + outer * 0.15;

  // vertical rays: bright vertical streaks within the curtain
  float rays = curtainRays(uv, t, offset);
  curtain *= 0.4 + 0.6 * rays;

  // top dissolve: use smooth power curve instead of smoothstep for organically ragged edge
  float raggedEdge = fbm(vec2(uv.x * 6.0 + offset * 2.0 + t * 0.1, t * 0.04)) * 0.3;
  // asymmetric falloff: slow decay below center, fast dissolve above
  float aboveFade = exp(-max(0.0, (uv.y - curtainCenter - 0.2 - raggedEdge)) * 4.5);
  float belowFade = exp(-max(0.0, (curtainCenter + 0.4 - uv.y)) * 1.8);
  float verticalFade = aboveFade * belowFade;
  curtain *= verticalFade;

  // bottom brightening: use smooth exponential instead of smoothstep for seamless blend
  float bottomBoost = exp(-max(0.0, dist - 0.05) * 3.0) * 0.4;
  curtain += bottomBoost * mid;

  // fine filament detail: horizontal streaks (lower frequency, slower)
  float filament = fbm(vec2(uv.x * 10.0 + offset * 3.0, uv.y * 10.0 - t * 0.35));
  curtain *= 0.55 + 0.55 * filament;

  // depth fog: further layers are dimmer and more diffuse
  float depthFade = mix(1.0, 0.5, depth);
  // use smoothstep instead of hard step for seamless transition
  float depthDiffuse = mix(1.0, 1.6, depth * smoothstep(0.0, 0.15, absDist));
  curtain *= depthFade * depthDiffuse;

  return curtain;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  // dark sky background with subtle gradient
  vec3 skyTop = vec3(0.005, 0.005, 0.03);
  vec3 skyMid = vec3(0.01, 0.015, 0.05);
  vec3 skyBottom = vec3(0.02, 0.04, 0.07);
  float skyGrad = smoothstep(0.7, 0.3, vUV.y);
  vec3 color = mix(skyTop, skyMid, skyGrad);
  color = mix(color, skyBottom, smoothstep(0.3, 0.0, vUV.y));

  // star field with varying brightness (slow flicker)
  float stars = pow(hash(floor(vUV * 300.0)), 18.0);
  float starFlicker = 0.85 + 0.15 * sin(t * 1.5 + hash(floor(vUV * 300.0)) * 50.0);
  color += vec3(0.5, 0.6, 0.85) * stars * 0.35 * starFlicker;
  // dimmer secondary stars
  float stars2 = pow(hash(floor(vUV * 500.0 + 100.0)), 22.0);
  color += vec3(0.4, 0.5, 0.7) * stars2 * 0.2;

  // ─── Layer 1: deep background aurora (far, diffuse, dim) ───
  float c0 = auroraCurtain(uv * vec2(0.7, 1.0) + vec2(0.5, 0.0), t * 0.25, 1.0, 25.0, 0.9);
  vec3 deepCyan = vec3(0.05, 0.3, 0.35);
  color += deepCyan * c0 * 0.4;

  // ─── Layer 2: green aurora (dominant, mid-depth) ───
  float c1 = auroraCurtain(uv, t * 0.65, 1.5, 0.0, 0.3);
  vec3 green = vec3(0.08, 0.85, 0.35);
  vec3 teal = vec3(0.1, 0.65, 0.65);
  float hueShift1 = warpedFbm(vec2(uv.x * 2.0, t * 0.05), t);
  color += mix(green, teal, hueShift1) * c1 * 1.3;

  // bright vertical rays within the green layer
  float greenRays = curtainRays(uv, t * 0.65, 0.0);
  float rayBright = greenRays * c1 * 0.4;
  color += vec3(0.3, 1.0, 0.5) * rayBright;

  // ─── Layer 3: purple-pink aurora (mid-back) ───
  float c2 = auroraCurtain(uv * vec2(0.85, 1.0) + vec2(0.3, 0.08), t * 0.45, 2.0, 5.0, 0.5);
  vec3 purple = vec3(0.45, 0.1, 0.75);
  vec3 pink = vec3(0.75, 0.15, 0.45);
  float hueShift2 = warpedFbm(vec2(uv.x * 1.5 + 10.0, t * 0.04), t * 0.45);
  color += mix(purple, pink, hueShift2) * c2 * 0.75;

  // ─── Layer 4: cyan-blue accent (front, bright) ───
  float c3 = auroraCurtain(uv * vec2(1.15, 0.95) - vec2(0.2, 0.03), t * 0.55, 1.8, 12.0, 0.15);
  vec3 cyan = vec3(0.12, 0.55, 1.0);
  vec3 cyanWhite = vec3(0.5, 0.8, 1.0);
  float brightMod = smoothstep(0.3, 0.9, c3);
  color += mix(cyan, cyanWhite, brightMod * 0.4) * c3 * 0.55;

  // ─── Layer 5: warm highlight (foreground accent) ───
  float c4 = auroraCurtain(uv * vec2(0.6, 1.05) + vec2(-0.35, 0.0), t * 0.35, 1.2, 20.0, 0.7);
  vec3 warm = vec3(0.85, 0.6, 0.25);
  color += warm * c4 * 0.3;

  // ─── Layer 6: subtle emerald veil (very front, low opacity) ───
  float c5 = auroraCurtain(uv * vec2(1.4, 0.85) + vec2(0.1, -0.05), t * 0.7, 2.2, 35.0, 0.1);
  vec3 emerald = vec3(0.15, 0.95, 0.5);
  color += emerald * c5 * 0.25;

  // ─── Inter-layer scattering / glow diffusion ───
  float totalCurtain = c1 * 1.0 + c2 * 0.7 + c3 * 0.5 + c4 * 0.35 + c5 * 0.3 + c0 * 0.25;
  // colored glow based on proximity to each layer
  vec3 glowColor = vec3(0.0);
  glowColor += mix(green, teal, 0.5) * c1;
  glowColor += mix(purple, pink, 0.5) * c2 * 0.6;
  glowColor += cyan * c3 * 0.4;
  glowColor *= 0.18;
  color += glowColor * smoothstep(0.15, 0.8, totalCurtain);

  // ─── Volumetric light shafts: vertical illumination (slow drift) ───
  float shaft = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float shaftX = sin(fi * 2.37 + t * 0.03) * 0.5;
    float shaftDist = abs(uv.x - shaftX);
    float shaftWidth = 0.08 + 0.05 * sin(fi * 1.73 + t * 0.06);
    float shaftStr = exp(-shaftDist * shaftDist / (shaftWidth * shaftWidth));
    // shaft is strongest where aurora is bright
    shaftStr *= smoothstep(-0.2, 0.15, uv.y) * smoothstep(0.6, 0.1, uv.y);
    shaftStr *= 0.5 + 0.5 * noise(vec2(uv.y * 5.0 + fi * 3.0, t * 0.1 + fi));
    shaft += shaftStr * 0.12;
  }
  vec3 shaftColor = mix(vec3(0.1, 0.6, 0.4), vec3(0.2, 0.5, 0.8), fbm(vec2(uv.x * 1.5, t * 0.02)));
  color += shaftColor * shaft * totalCurtain;

  // ─── Horizon glow: atmospheric scattering at the bottom ───
  float horizonGlow = exp(-pow((vUV.y - 0.12) * 3.5, 2.0)) * 0.2;
  vec3 horizonColor = mix(vec3(0.12, 0.25, 0.2), vec3(0.2, 0.4, 0.3), fbm(vec2(uv.x * 2.0, t * 0.02)));
  color += horizonColor * horizonGlow;
  // subtle warm horizon accent
  float warmHorizon = exp(-pow((vUV.y - 0.08) * 5.0, 2.0)) * 0.08;
  color += vec3(0.4, 0.25, 0.15) * warmHorizon;

  // ─── Atmospheric haze: depth-based fog ───
  float haze = smoothstep(0.0, -0.45, uv.y) * 0.12;
  color = mix(color, vec3(0.02, 0.05, 0.08), haze);

  // ─── Post-processing ───
  // gentle vignette
  float vignette = 1.0 - 0.4 * length(vUV - 0.5);
  color *= vignette;

  // Reinhard tone mapping with rich color preservation
  color = color / (color + 0.85) * 1.35;

  // subtle bloom on bright areas
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.7, 1.4, luminance) * 0.25;

  gl_FragColor = vec4(color, 1.0);
}
`.trim(),
  overrides: {
    uSpeed: 0.8,
  },
  duration: 10,
  previewSize: [1280, 720],
};

const RIPPLE_SHADER: ShaderExample = {
  name: '💧 水波纹',
  description: '晶莹水体 — 折射扭曲 + 次表面散射 + 双光源高光 + 焦散',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform float uSpeed;       // wave animation speed
uniform vec4 uResolution;   // viewport resolution (xy used)

// --- hash & value noise ---
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    val += amp * noise(p);
    p *= 2.2;
    amp *= 0.5;
  }
  return val;
}

// --- wave height: layered ripples + directional waves + noise ---
float waveHeight(vec2 uv, float t) {
  float h = 0.0;
  float dist = length(uv);
  h += sin(dist * 20.0 - t * 4.5) * 0.25;
  h += sin(dist * 13.0 + t * 2.8) * 0.15;
  h += sin(uv.x * 9.0 + uv.y * 7.0 - t * 3.2) * 0.1;
  h += sin(uv.x * 5.5 - uv.y * 10.0 + t * 2.2) * 0.08;
  h += sin(uv.x * 15.0 + t * 5.0) * 0.04;
  h += (fbm(uv * 7.0 + t * 0.9) - 0.5) * 0.2;
  return h;
}

// --- surface normal via central differences ---
vec3 calcNormal(vec2 uv, float t) {
  float eps = 0.002;
  float hL = waveHeight(uv - vec2(eps, 0.0), t);
  float hR = waveHeight(uv + vec2(eps, 0.0), t);
  float hD = waveHeight(uv - vec2(0.0, eps), t);
  float hU = waveHeight(uv + vec2(0.0, eps), t);
  return normalize(vec3(hL - hR, hD - hU, eps * 8.0));
}

// --- sharp caustics pattern ---
float caustics(vec2 uv, float t) {
  vec2 p1 = uv * 10.0 + vec2(t * 0.5, t * 0.35);
  vec2 p2 = uv * 14.0 - vec2(t * 0.35, t * 0.55);
  vec2 p3 = uv * 7.0 + vec2(-t * 0.2, t * 0.45);
  float v1 = sin(p1.x) * sin(p1.y);
  float v2 = sin(p2.x + 0.7) * sin(p2.y + 1.1);
  float v3 = sin(p3.x + 2.0) * sin(p3.y + 0.3);
  float c = pow(max(0.0, v1 + v2 + v3), 4.0) * 0.25;
  c += pow(max(0.0, fbm(uv * 18.0 + t * 0.7) - 0.35), 2.0) * 0.6;
  return c;
}

// --- sky dome gradient for reflection ---
vec3 skyColor(vec3 reflDir) {
  float horizon = smoothstep(-0.1, 0.3, reflDir.z);
  vec3 zenith = vec3(0.35, 0.6, 1.0);
  vec3 horizonCol = vec3(0.7, 0.85, 1.0);
  vec3 sunGlow = vec3(1.0, 0.95, 0.8) * pow(max(0.0, dot(reflDir, normalize(vec3(-0.3, 0.6, 0.8)))), 32.0);
  return mix(horizonCol, zenith, horizon) + sunGlow;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  vec3 normal = calcNormal(uv, t);
  float height = waveHeight(uv, t);

  // view & light setup
  vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
  vec3 light1 = normalize(vec3(-0.3, 0.7, 0.6));
  vec3 light2 = normalize(vec3(0.5, -0.3, 0.7));

  // --- refracted floor UV ---
  vec2 refractedUV = uv + normal.xy * 0.06;

  // --- floor pattern seen through water ---
  float floorPattern = fbm(refractedUV * 4.0 + 0.5) * 0.15 + 0.12;
  vec3 floorColor = vec3(0.08, 0.18, 0.32) + floorPattern;

  // --- caustics on the floor ---
  float causticsVal = caustics(refractedUV, t);
  floorColor += vec3(0.5, 0.8, 1.0) * causticsVal * 0.8;

  // --- fresnel: Schlick approximation ---
  float ndotv = max(0.0, dot(normal, viewDir));
  float fresnel = pow(1.0 - ndotv, 4.0) * 0.85 + 0.15;

  // --- sky reflection ---
  vec3 reflDir = reflect(-viewDir, normal);
  vec3 reflection = skyColor(reflDir);

  // --- specular highlights (dual light) ---
  vec3 half1 = normalize(light1 + viewDir);
  vec3 half2 = normalize(light2 + viewDir);
  float spec1 = pow(max(0.0, dot(normal, half1)), 120.0) * 2.0;
  float spec2 = pow(max(0.0, dot(normal, half2)), 80.0) * 0.8;
  vec3 specular = vec3(1.0, 0.98, 0.95) * spec1 + vec3(0.8, 0.9, 1.0) * spec2;

  // --- subsurface scattering: light passing through wave crests ---
  float sss = pow(max(0.0, dot(viewDir, -light1 + normal * 0.5)), 3.0);
  sss *= smoothstep(-0.1, 0.3, height);
  vec3 subsurface = vec3(0.1, 0.7, 0.6) * sss * 0.6;

  // --- depth-based tint: crests lighter, troughs darker ---
  float depthFactor = smoothstep(-0.35, 0.4, height);
  vec3 deepCol = vec3(0.03, 0.1, 0.25);
  vec3 shallowCol = vec3(0.15, 0.5, 0.65);
  vec3 waterTint = mix(deepCol, shallowCol, depthFactor);

  // --- shadow in troughs ---
  float shadow = smoothstep(-0.25, 0.15, height);
  float ndotl = max(0.0, dot(normal, light1));
  vec3 diffuse = waterTint * (0.4 + 0.6 * ndotl * shadow);

  // --- compose: blend refracted floor and reflection by fresnel ---
  vec3 color = mix(floorColor + diffuse, reflection, fresnel);
  color += specular;
  color += subsurface;

  // --- rim glow: translucent edge light ---
  float rim = pow(1.0 - ndotv, 5.0);
  color += vec3(0.4, 0.75, 1.0) * rim * 0.25;

  // --- slight bloom on bright spots ---
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.8, 1.5, luminance) * 0.3;

  // --- vignette ---
  float vignette = 1.0 - 0.35 * length(vUV - 0.5);
  color *= vignette;

  gl_FragColor = vec4(color, 1.0);
}
`.trim(),
  overrides: {
    uSpeed: 1.0,
  },
  duration: 8,
  previewSize: [1280, 720],
};

const COLORFUL_ORBS_SHADER: ShaderExample = {
  name: '🔮 彩色光球',
  description: '五颜六色光球穿插移动 — 多层发光球体 + 轨道交叉 + 色相旋转 + 辉光弥漫',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;        // elapsed time
uniform float uSpeed;       // animation speed
uniform float uIntensity;   // glow intensity
uniform float uOrbCount;    // orb density multiplier
uniform vec4  uResolution;  // viewport resolution (xy used)

// --- hash functions ---
float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// --- HSL to RGB conversion ---
vec3 hsl2rgb(float h, float s, float l) {
  h = fract(h);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  if (h < 1.0 / 6.0)      rgb = vec3(c, x, 0.0);
  else if (h < 2.0 / 6.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0 / 6.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0 / 6.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0 / 6.0) rgb = vec3(x, 0.0, c);
  else                      rgb = vec3(c, 0.0, x);
  return rgb + m;
}

// --- single orb: position, color, glow ---
struct OrbResult {
  vec3 color;
  float glow;
};

OrbResult orb(vec2 uv, float t, float id) {
  OrbResult res;
  res.color = vec3(0.0);
  res.glow = 0.0;

  // each orb has unique parameters derived from id
  float seed1 = hash(id * 7.3 + 1.1);
  float seed2 = hash(id * 13.7 + 2.3);
  float seed3 = hash(id * 19.1 + 3.7);
  float seed4 = hash(id * 23.9 + 5.1);
  float seed5 = hash(id * 31.3 + 7.9);
  float seed6 = hash(id * 41.7 + 11.3);
  float seed7 = hash(id * 53.1 + 13.7);

  // orbit parameters
  float orbitRadius = 0.15 + seed1 * 0.45;
  float orbitSpeed  = (0.4 + seed2 * 1.2) * (seed3 > 0.5 ? 1.0 : -1.0);
  float orbitPhase  = seed4 * 6.283185;
  float orbitTilt   = seed5 * 3.14159; // orbit tilt angle
  float orbitOffset = (seed6 - 0.5) * 0.3; // center offset

  // wobble on the orbit path for more organic feel
  float wobbleAmp = seed7 * 0.06;
  float wobbleFreq = 3.0 + seed3 * 4.0;

  // position along orbit
  float angle = t * orbitSpeed + orbitPhase;
  float wobble = sin(angle * wobbleFreq + id) * wobbleAmp;
  float floatY = sin(t * (0.3 + seed4 * 0.5) + seed5 * 6.283) * 0.05;

  // 2D projected position with orbit tilt creating depth illusion
  vec2 center = vec2(
    (seed3 - 0.5) * 0.3 + orbitOffset,
    (seed5 - 0.5) * 0.2 + floatY
  );
  vec2 orbPos = center + vec2(
    cos(angle) * orbitRadius + wobble,
    sin(angle) * orbitRadius * cos(orbitTilt) + sin(angle * 0.7) * orbitRadius * sin(orbitTilt) * 0.4
  );

  // depth-based size: orbs "behind" are smaller
  float depth = sin(angle) * sin(orbitTilt);
  float orbSize = 0.05 + seed1 * 0.06;
  orbSize *= (0.7 + 0.3 * (0.5 + 0.5 * depth)); // depth scaling

  // tight glow: gaussian core with limited halo spread
  float dist = length(uv - orbPos);
  float core = exp(-dist * dist / (orbSize * orbSize * 0.5));
  float midGlow = exp(-dist / (orbSize * 1.2));
  float outerGlow = exp(-dist / (orbSize * 2.0));
  res.glow = core * 0.7 + midGlow * 0.35 + outerGlow * 0.08;

  // alpha fade for depth: further orbs are more transparent
  float depthAlpha = 0.55 + 0.45 * (0.5 + 0.5 * depth);
  res.glow *= depthAlpha;

  // color: unique hue per orb with time-based rotation
  // high saturation at core, moderate lightness for richer color
  float hue = fract(id * 0.137 + t * 0.02 + seed1 * 0.3);
  float baseSat = 0.85 + seed2 * 0.15;
  float baseLit = 0.4 + seed3 * 0.15;
  vec3 orbColor = hsl2rgb(hue, baseSat, baseLit);

  // boost core saturation and reduce core whiteness
  float coreSat = mix(baseSat, 1.0, core * 0.6);
  float coreLit = mix(baseLit, baseLit + 0.12, core * 0.5);
  orbColor = hsl2rgb(hue, coreSat, coreLit);

  // subtle brighten at very center only (reduced from before)
  orbColor = mix(orbColor, vec3(1.0), core * core * 0.25);

  res.color = orbColor;
  return res;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  vec3 color = vec3(0.0);

  // dark background with subtle radial gradient
  float bgGrad = 1.0 - length(vUV - 0.5) * 0.6;
  color = vec3(0.01, 0.01, 0.03) * bgGrad;

  // accumulate orbs (3 layers with different speeds for parallax)
  int orbCount = int(12.0 + uOrbCount * 16.0);

  // layer 1: slow background orbs (low brightness)
  for (int i = 0; i < 48; i++) {
    if (i >= orbCount) break;
    float fi = float(i);
    OrbResult o = orb(uv * 0.85, t * 0.7, fi * 3.0 + 100.0);
    color += o.color * o.glow * uIntensity * 0.4;
  }

  // layer 2: main orbs at normal speed
  for (int i = 0; i < 48; i++) {
    if (i >= orbCount) break;
    float fi = float(i);
    OrbResult o = orb(uv, t, fi * 3.0 + 1.0);
    color += o.color * o.glow * uIntensity;
  }

  // layer 3: fast foreground orbs (slightly brighter, larger)
  for (int i = 0; i < 48; i++) {
    if (i >= orbCount) break;
    float fi = float(i);
    OrbResult o = orb(uv * 1.1, t * 1.4, fi * 3.0 + 200.0);
    color += o.color * o.glow * uIntensity * 0.6;
  }

  // subtle color bleeding / atmosphere: soft overall hue shift
  float atmHue = fract(t * 0.015);
  vec3 atmColor = hsl2rgb(atmHue, 0.5, 0.15);
  float atmStrength = 0.02 * uIntensity;
  color += atmColor * atmStrength;

  // bloom on bright areas
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.5, 1.5, luminance) * 0.35;

  // soft vignette
  float vignette = 1.0 - 0.35 * length(vUV - 0.5);
  color *= vignette;

  // tone mapping to prevent clipping
  color = color / (color + 0.9) * 1.1;

  float alpha = clamp(length(color) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`.trim(),
  overrides: {
    uSpeed: 0.7,
    uIntensity: 1.0,
    uOrbCount: 1.0,
  },
  duration: 10,
  previewSize: [1280, 720],
};

const FIRE_ORB_SHADER: ShaderExample = {
  name: '🔥 烈焰熔炉',
  description: '烈焰熔炉 — 垂直上升火焰 + 湍流扭曲 + 紫色闪电 + 火星飞溅 + 底部漩涡',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;        // elapsed time
uniform float uIntensity;   // flame intensity
uniform float uSpeed;       // animation speed
uniform vec4  uResolution;  // viewport resolution (xy used)

// --- hash & noise ---
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM with domain warping for turbulent fire shapes
float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    val += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return val;
}

// 2-calls domain-warped fbm for more organic turbulence
float warpedFbm(vec2 p, float t) {
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.12),
    fbm(p + vec2(5.2, 1.3) + t * 0.1)
  );
  return fbm(p + 2.0 * q);
}

// --- fire shape: vertical column with turbulent edges ---
// Key insight: fire flows UPWARD. We use UV.y as "height" and
// scroll noise upward (subtract time from y) to simulate rising flames.
float fireShape(vec2 uv, float t) {
  // Center horizontally, use Y as height
  // Fire source at bottom center (~y = -0.15), flames rise upward

  // Horizontal width envelope: wide at base, narrow at top
  // The fire column narrows as it rises
  float height = uv.y + 0.15; // 0 at source, positive upward
  float baseWidth = 0.18;
  float topNarrow = 1.0 - smoothstep(0.0, 0.6, height) * 0.65;
  float envelope = baseWidth * topNarrow;

  // Vertical fade: fire exists from source to a certain height
  float vertFade = smoothstep(-0.05, 0.08, height) * smoothstep(0.7, 0.2, height);

  // Turbulent horizontal displacement (critical for fire look)
  // Domain-warped noise offsets the fire shape laterally
  float warpX = warpedFbm(vec2(uv.x * 3.0, uv.y * 2.0 - t * 1.8), t * 0.5) * 0.08;
  warpX += fbm(vec2(uv.x * 6.0 + t * 0.3, uv.y * 4.0 - t * 2.5)) * 0.04;
  float dUvX = uv.x - warpX;

  // Multiple noise layers scrolling upward at different speeds
  float n1 = fbm(vec2(dUvX * 4.0 + t * 0.2, uv.y * 3.0 - t * 2.0));
  float n2 = fbm(vec2(dUvX * 8.0 - t * 0.4, uv.y * 6.0 - t * 3.0));
  float n3 = fbm(vec2(dUvX * 14.0 + t * 0.6, uv.y * 10.0 - t * 4.5));
  float fireNoise = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;

  // Fire body: noise distorts the width envelope
  float body = envelope * (0.6 + fireNoise * 0.7);

  // Distance from center of the column (horizontally)
  float dist = abs(dUvX);

  // Fire intensity: strong at center, falls off at edges
  // Use noise to make edges irregular rather than smooth
  float edgeWarp = fbm(vec2(dUvX * 10.0 + t * 0.5, uv.y * 5.0 - t * 1.5)) * 0.06;

  // Inner bright core of flame
  float innerFire = smoothstep(body + edgeWarp, body * 0.3 - edgeWarp, dist);
  // Outer soft glow layer — wider, dimmer halo that fades into background
  float outerBody = body * 2.2 + edgeWarp * 1.5;
  float outerFire = smoothstep(outerBody, body * 0.5 - edgeWarp, dist) * 0.35;

  // Core brightness: brighter toward the base
  float baseBright = smoothstep(0.3, -0.05, height);

  return (innerFire + outerFire) * vertFade * (0.6 + 0.4 * baseBright);
}

// --- glowing core at the fire base (molten center) ---
float fireCore(vec2 uv, float t) {
  // Core sits at the base of the fire, slightly below center
  vec2 coreCenter = vec2(0.0, -0.12);

  // Pulsating core
  float pulse = 0.85 + 0.15 * sin(t * 3.5) + 0.08 * sin(t * 8.1);

  // Domain-warped noise for organic core shape (NOT circular)
  float warpX = fbm(vec2(uv.x * 5.0 + t * 0.3, uv.y * 5.0 - t * 1.0)) * 0.06;
  float warpY = fbm(vec2(uv.x * 5.0 - t * 0.2, uv.y * 5.0 + t * 0.5)) * 0.04;
  vec2 dUv = uv - coreCenter + vec2(warpX, warpY);

  // Anisotropic: wider than tall (fire pool shape)
  float distX = dUv.x / (0.14 * pulse);
  float distY = dUv.y / (0.09 * pulse);
  float dist = distX * distX + distY * distY;

  // Intense glow with noise variation
  float coreNoise = fbm(vec2(uv.x * 8.0 + t * 0.5, uv.y * 8.0 - t * 1.2));
  float core = exp(-dist * (2.5 + coreNoise * 1.5));

  return core;
}

// --- purple electric arcs (jagged lines from core) ---
float electricArcs(vec2 uv, float t) {
  float result = 0.0;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);

    // Arc origin: near the core, slightly varied positions
    float startX = (hash(fi * 7.3 + 1.1) - 0.5) * 0.15;
    vec2 start = vec2(startX, -0.1 + hash(fi * 3.7) * 0.05);

    // Arc direction: mostly upward with horizontal variation
    float dirAngle = 1.2 + (hash(fi * 11.3) - 0.5) * 0.8
      + sin(t * 0.7 + fi * 2.0) * 0.3;
    vec2 dir = vec2(cos(dirAngle), sin(dirAngle));

    // Project point onto arc line
    vec2 toPoint = uv - start;
    float along = dot(toPoint, dir);

    // Perpendicular distance with jagged noise displacement
    vec2 perpVec = toPoint - dir * along;
    float jagNoise = noise(vec2(along * 20.0 + fi * 15.0, t * 8.0 + fi * 3.0));
    float jagNoise2 = noise(vec2(along * 35.0 - fi * 10.0, t * 12.0 + fi * 7.0));
    float perpDist = length(perpVec) + (jagNoise - 0.5) * 0.03 + (jagNoise2 - 0.5) * 0.015;

    // Arc length and fade
    float arcLen = 0.15 + hash(fi * 13.3) * 0.2 + sin(t * 1.5 + fi * 4.0) * 0.05;
    float segFade = smoothstep(0.0, 0.015, along) * smoothstep(arcLen, arcLen - 0.03, along);

    // Intermittent flicker
    float flicker = smoothstep(0.2, 0.7, sin(t * 6.0 + fi * 5.0) * 0.5 + 0.5);
    flicker *= smoothstep(0.15, 0.5, sin(t * 10.0 + fi * 9.0) * 0.5 + 0.5);

    // Thin bright line
    float arc = exp(-perpDist * perpDist / 0.00015) * segFade * flicker;
    result += arc;
  }

  return result;
}

// --- bottom swirl (cauldron / molten pool) ---
float cauldronSwirl(vec2 uv, float t) {
  // Only visible at the bottom
  float belowFade = smoothstep(0.05, -0.2, uv.y);

  // Swirling flow: use noise driven by rotated coordinates
  // This creates visible flow patterns without polar coordinates
  float rotSpeed = t * 0.8;
  float cosR = cos(rotSpeed);
  float sinR = sin(rotSpeed);

  // Two rotating flow centers
  vec2 center1 = vec2(cosR * 0.05, -0.18);
  vec2 center2 = vec2(-cosR * 0.04, -0.22);

  // Flow noise: scrolls horizontally to simulate swirling motion
  float n1 = fbm(uv * 5.0 + vec2(t * 0.8, -t * 0.3));
  float n2 = fbm(uv * 8.0 - vec2(t * 0.6, t * 0.2));
  float swirl = n1 * 0.6 + n2 * 0.4;

  // Glow near the two centers
  float g1 = exp(-length(uv - center1) * 8.0);
  float g2 = exp(-length(uv - center2) * 10.0);

  // Horizontal streaks for molten liquid look
  float streaks = noise(vec2(uv.x * 15.0 + t * 1.5, uv.y * 3.0 - t * 0.5));

  return (swirl * 0.5 + streaks * 0.3 + g1 + g2 * 0.6) * belowFade;
}

// --- ember particles rising from fire ---
float embers(vec2 uv, float t) {
  float result = 0.0;

  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float seed1 = hash(fi * 7.3 + 1.1);
    float seed2 = hash(fi * 13.7 + 2.3);
    float seed3 = hash(fi * 19.1 + 3.7);
    float seed4 = hash(fi * 23.9 + 5.1);

    // Ember rises from near the core
    float life = fract(t * (0.12 + seed1 * 0.15) + seed2);

    // Horizontal wobble as it rises
    float emberX = (seed3 - 0.5) * 0.2 + sin(life * 4.0 + seed4 * 6.283) * 0.04;
    emberX += noise(vec2(fi * 5.0, life * 10.0 + t)) * 0.03;

    // Rises vertically from base
    float emberY = life * 0.7 - 0.12;

    vec2 emberPos = vec2(emberX, emberY);
    float d = length(uv - emberPos);

    float fadeIn = smoothstep(0.0, 0.08, life);
    float fadeOut = 1.0 - smoothstep(0.4, 0.9, life);
    float alpha = fadeIn * fadeOut;

    // Bright point + soft glow
    float brightness = exp(-d * d / 0.00015) * alpha;
    float glow = exp(-d / 0.025) * alpha * 0.3;

    result += brightness + glow;
  }

  return result;
}

// --- heat haze / smoke above the fire ---
float heatHaze(vec2 uv, float t) {
  // Only above the fire
  float aboveFade = smoothstep(0.1, 0.5, uv.y);
  // Center fade
  float centerFade = exp(-uv.x * uv.x / 0.04);

  float n = warpedFbm(vec2(uv.x * 3.0, uv.y * 2.0 - t * 0.6), t * 0.3);
  return n * aboveFade * centerFade * 0.4;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  // ─── fire body (vertical turbulent flames) ───
  float fire = fireShape(uv, t);

  // ─── glowing core (molten pool) ───
  float core = fireCore(uv, t);

  // ─── distance from fire center (used for glow & alpha) ───
  float fireCenterDist = length(uv - vec2(0.0, -0.1));

  // ─── color palette ───
  vec3 whiteHot = vec3(1.0, 0.98, 0.92);
  vec3 hotOrange = vec3(1.0, 0.6, 0.08);
  vec3 deepRed = vec3(0.85, 0.12, 0.02);
  vec3 darkSmoke = vec3(0.08, 0.02, 0.0);

  // ─── fire color: height-based temperature gradient ───
  float height = uv.y + 0.15; // 0 at fire source
  // Temperature drops as fire rises: white at base → orange → red → smoke
  float temp = smoothstep(0.5, -0.05, height); // 1 at base, 0 at top

  vec3 fireColor = mix(deepRed, hotOrange, fire * 0.8);
  fireColor = mix(fireColor, whiteHot, fire * fire * 0.5 * temp);
  // Darken at the top (cooling)
  fireColor *= 0.7 + 0.3 * temp;

  // ─── core color: intense white-hot glow ───
  vec3 coreColor = mix(hotOrange, whiteHot, core * core);
  coreColor += whiteHot * core * core * 0.5;

  // ─── purple electric arcs ───
  float arcs = electricArcs(uv, t);
  vec3 arcColor = vec3(0.55, 0.15, 1.0) * arcs * 3.0;
  arcColor += vec3(0.85, 0.7, 1.0) * arcs * arcs * 6.0;

  // ─── bottom cauldron swirl ───
  float swirl = cauldronSwirl(uv, t);
  vec3 swirlColor = mix(darkSmoke, deepRed * 0.7, swirl * 0.6 + 0.3);
  swirlColor += hotOrange * swirl * swirl * 0.6;

  // ─── embers ───
  float ember = embers(uv, t);
  vec3 emberColor = mix(hotOrange, whiteHot, ember * 0.4) * ember;

  // ─── heat haze above ───
  float haze = heatHaze(uv, t);
  vec3 hazeColor = deepRed * haze * 0.3;

  // ─── alpha: primary opacity from fire, core, arcs, embers ───
  // Each layer contributes to overall visibility
  float alphaFire = fire * 1.2;
  float alphaCore = core * 0.8;
  float alphaArcs = arcs * 0.6;
  float alphaEmber = ember * 0.7;
  float alphaSwirl = swirl * 0.4 * smoothstep(0.1, -0.15, uv.y);

  // ─── wide glow alpha: fires naturally illuminate surroundings ───
  // Multiple soft falloff rings so glow fades gradually into nothing
  float glowAlpha  = exp(-fireCenterDist / 0.15) * 0.9;            // tight core glow
  glowAlpha += exp(-fireCenterDist / 0.30) * 0.45;                 // near glow
  glowAlpha += exp(-fireCenterDist / 0.55) * 0.18;                 // mid glow
  glowAlpha += exp(-fireCenterDist / 0.90) * 0.06;                 // far ambient

  // Combine: solid elements + soft glow edges
  float alpha = clamp(
    alphaFire + alphaCore + alphaArcs + alphaEmber + alphaSwirl + glowAlpha,
    0.0, 1.0
  );

  // ─── compose color, premultiplied by alpha for soft edges ───
  // Outer glow regions carry color at low alpha → natural fade into transparent
  vec3 color = vec3(0.0);

  // Main fire body (strong where alpha is high)
  color += fireColor * fire * uIntensity * 2.5;

  // Core glow
  color += coreColor * core * uIntensity * 1.5;

  // Bottom swirl
  color += swirlColor * 0.5;

  // Heat haze
  color += hazeColor;

  // ─── atmospheric glow with gradient colors matching alpha ───
  // Tight white-hot glow
  color += whiteHot * exp(-fireCenterDist / 0.08) * 0.6 * uIntensity;
  // Medium orange glow
  color += hotOrange * exp(-fireCenterDist / 0.20) * 0.4 * uIntensity;
  // Wide red glow (fills the mid-alpha transition zone)
  color += deepRed * exp(-fireCenterDist / 0.40) * 0.25 * uIntensity;
  // Very wide dim glow (outermost alpha ring, ensures smooth fade)
  color += deepRed * 0.12 * exp(-fireCenterDist / 0.70) * uIntensity;

  // ─── smoke tint at fire edges (low alpha, dark warm color) ───
  float smokeZone = (1.0 - smoothstep(0.0, 0.2, fire)) * exp(-fireCenterDist / 0.35);
  smokeZone *= smoothstep(0.6, 0.0, fireCenterDist);
  float smokeNoise = fbm(uv * 4.0 + vec2(t * 0.1, -t * 0.3));
  vec3 smokeTint = deepRed * 0.2 * (0.3 + 0.7 * smokeNoise);
  color += smokeTint * smokeZone * uIntensity;

  // Electric arcs
  color += arcColor;

  // Embers
  color += emberColor * 1.5;

  // ─── bloom on bright areas ───
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color += color * smoothstep(0.4, 1.2, luminance) * 0.5;

  // ─── premultiply: color *= alpha so that edges fade correctly ───
  // This ensures semi-transparent pixels carry dim color,
  // blending smoothly into a transparent (black) background.
  // Without premultiply, bright color at low alpha creates hard color fringe.
  color *= alpha;

  // ─── tone mapping (applied after premultiply, so dark edges stay dark) ───
  color = color / (color + 0.85) * 1.2;

  // ─── vignette on alpha too (edges of screen become transparent) ───
  float vignette = 1.0 - 0.3 * length(vUV - 0.5);
  alpha *= vignette;

  gl_FragColor = vec4(color, alpha);
}
`.trim(),
  overrides: {
    uIntensity: 1.2,
    uSpeed: 1.0,
  },
  duration: 10,
  previewSize: [1280, 720],
};

const PAINT_SPLASH_SHADER: ShaderExample = {
  name: '🎨 颜料泼洒',
  description: '颜料动态泼洒 — 厚涂质感 + 鲜艳色彩 + 湿边积聚 + 光泽高光 + 湿色辉映 + ACES tone mapping',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;        // elapsed time
uniform float uSpeed;       // splash animation speed
uniform float uIntensity;   // color vibrancy
uniform vec4  uResolution;  // viewport resolution (xy used)

// --- hash & noise ---
float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    val += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return val;
}

// domain-warped fbm for organic pigment diffusion
float warpedFbm(vec2 p, float t) {
  float fbm1 = fbm(p + vec2(0.0, 0.0) + t * 0.04);
  float fbm2 = fbm(p + vec2(5.2, 1.3) + t * 0.03);
  vec2 q = vec2(fbm1, fbm2);
  return fbm(p + 1.8 * q);
}

// --- HSL to RGB (enhanced chroma) ---
vec3 hsl2rgb(float h, float s, float l) {
  h = fract(h);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = l - c * 0.5;
  vec3 rgb;
  if (h < 1.0 / 6.0)      rgb = vec3(c, x, 0.0);
  else if (h < 2.0 / 6.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0 / 6.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0 / 6.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0 / 6.0) rgb = vec3(x, 0.0, c);
  else                      rgb = vec3(c, 0.0, x);
  return rgb + m;
}

// --- paint pigment palette: rich artist colors ---
// Returns a vivid paint color from a curated palette
vec3 paintColor(float id, float seed) {
  // 10 artist-grade pigment hues (hand-tuned for vibrancy)
  // Cadmium Yellow, Vermilion, Alizarin Crimson, Ultramarine,
  // Phthalo Green, Cobalt Blue, Quinacridone Magenta,
  // Burnt Sienna, Cadmium Orange, Cerulean Blue
  int idx = int(mod(id, 10.0));
  vec3 col;
  if (idx == 0)      col = vec3(1.0, 0.84, 0.0);    // Cadmium Yellow
  else if (idx == 1) col = vec3(0.93, 0.18, 0.05);   // Vermilion
  else if (idx == 2) col = vec3(0.72, 0.05, 0.18);   // Alizarin Crimson
  else if (idx == 3) col = vec3(0.12, 0.07, 0.55);   // Ultramarine
  else if (idx == 4) col = vec3(0.0, 0.42, 0.28);    // Phthalo Green
  else if (idx == 5) col = vec3(0.0, 0.24, 0.65);    // Cobalt Blue
  else if (idx == 6) col = vec3(0.68, 0.05, 0.50);   // Quinacridone Magenta
  else if (idx == 7) col = vec3(0.55, 0.22, 0.08);   // Burnt Sienna
  else if (idx == 8) col = vec3(1.0, 0.50, 0.0);     // Cadmium Orange
  else                col = vec3(0.02, 0.48, 0.65);   // Cerulean Blue

  // slight per-instance variation
  col += (seed - 0.5) * 0.06;
  return clamp(col, 0.0, 1.0);
}

// --- splat structure ---
struct SplatResult {
  vec3 color;
  float alpha;
  float thickness; // paint thickness for gloss
};

SplatResult paintSplat(vec2 uv, float t, float id) {
  SplatResult res;
  res.color = vec3(0.0);
  res.alpha = 0.0;
  res.thickness = 0.0;

  float seed1 = hash(id * 7.3 + 1.1);
  float seed2 = hash(id * 13.7 + 2.3);
  float seed3 = hash(id * 19.1 + 3.7);
  float seed4 = hash(id * 23.9 + 5.1);
  float seed5 = hash(id * 31.3 + 7.9);
  float seed6 = hash(id * 41.7 + 11.3);
  float seed7 = hash(id * 53.1 + 13.7);

  // splat timing with staggered arrivals
  float splatTime = id * 0.55 + seed1 * 0.25;
  float elapsed = t - splatTime;
  if (elapsed < 0.0) return res;

  // splat center
  vec2 center = vec2(
    (seed2 - 0.5) * 1.3 + (seed3 - 0.5) * 0.15,
    (seed4 - 0.5) * 0.85 + (seed5 - 0.5) * 0.1
  );

  // vivid paint color from curated palette
  vec3 baseColor = paintColor(id, seed6);

  // --- phases ---
  float impactDuration = 0.25;
  float impactPhase = clamp(elapsed / impactDuration, 0.0, 1.0);
  float growthDuration = 1.0;
  float spreadPhase = clamp((elapsed - impactDuration) / growthDuration, 0.0, 1.0);
  float growth = 1.0 - pow(1.0 - spreadPhase, 3.0);

  // gravity drip
  float dripOffset = elapsed * 0.006 * (0.5 + seed3);
  vec2 dripCenter = center + vec2(0.0, -dripOffset);

  // --- main splat body ---
  float baseRadius = 0.07 + seed1 * 0.09;
  float currentRadius = baseRadius * (0.35 + 0.65 * (impactPhase * 0.5 + growth * 0.5));

  // organic edge distortion with domain warping
  vec2 toPoint = uv - dripCenter;
  float angle = atan(toPoint.y, toPoint.x);
  float angleArg1 = angle * 2.5 + id;
  float angleArg2 = seed5 * 8.0;
  float edgeNoise = warpedFbm(vec2(angleArg1, angleArg2), t * 0.08 * id) * 0.45;
  float fbmArg1 = angle * 6.0 - id;
  float fbmArg2 = seed6 * 6.0 + t * 0.02;
  edgeNoise += fbm(vec2(fbmArg1, fbmArg2)) * 0.2;
  float distortedRadius = currentRadius * (1.0 + edgeNoise * growth);

  float dist = length(toPoint);

  // --- paint body: thick opaque center, semi-transparent edge ---
  // thicker paint = more opaque, with pigment granulation
  float pigmentGrain = noise(uv * 300.0 + id * 50.0) * 0.12;
  float bodyAlpha = smoothstep(distortedRadius * 1.02, distortedRadius * 0.55, dist);
  bodyAlpha *= 0.85 + 0.15 * (1.0 - impactPhase); // wetter at impact

  // central thick paint: very opaque near center
  float thickCenter = smoothstep(distortedRadius * 0.4, 0.0, dist);
  bodyAlpha = max(bodyAlpha, thickCenter * 0.95);

  // pigment granulation: watercolor-style uneven pigment density
  float granulation = noise(uv * 180.0 + id * 30.0) * 0.15;
  bodyAlpha *= (0.9 + granulation);

  // --- wet edge accumulation (prominent dark ring at boundary) ---
  float edgeRing = smoothstep(distortedRadius * 0.82, distortedRadius * 0.94, dist)
    * smoothstep(distortedRadius * 1.08, distortedRadius * 0.94, dist);
  edgeRing *= (0.7 + 0.3 * growth); // strong ring when paint has settled

  // inside-edge darkening: pigment migrates to boundary as water evaporates
  float innerDarkBand = smoothstep(distortedRadius * 0.65, distortedRadius * 0.90, dist)
    * smoothstep(distortedRadius * 1.02, distortedRadius * 0.90, dist);
  innerDarkBand *= 0.35 * growth;

  // --- radial fingers/streaks: paint reaching outward ---
  float streaks = 0.0;
  for (int j = 0; j < 5; j++) {
    float fj = float(j);
    float streakAngle = hash(id * 17.3 + fj * 5.7) * 6.283185;
    float streakLen = currentRadius * (1.3 + hash(id * 23.1 + fj * 9.3) * 2.0) * growth;
    float streakWidth = 0.012 + hash(id * 29.7 + fj * 3.1) * 0.025;
    float angleDiff = abs(mod(angle - streakAngle + 3.14159, 6.28318) - 3.14159);
    float radialFade = smoothstep(0.0, currentRadius * 0.2, dist) * smoothstep(streakLen, currentRadius * 0.4, dist);
    float streak = exp(-angleDiff * angleDiff / (streakWidth * streakWidth)) * radialFade;
    // streaks also have wet edges
    streaks += streak;
  }
  float streakAlpha = streaks * 0.5 * growth;

  // --- scattered droplets with tails ---
  float droplets = 0.0;
  for (int k = 0; k < 8; k++) {
    float fk = float(k);
    float dropAngle = hash(id * 31.3 + fk * 7.7) * 6.283185;
    float dropDist = currentRadius * (1.8 + hash(id * 37.1 + fk * 11.3) * 3.5) * growth;
    float dropSize = 0.003 + hash(id * 43.7 + fk * 13.1) * 0.007;
    float dropDelay = 0.05 + fk * 0.03;
    float dropElapse = max(0.0, elapsed - splatTime - impactDuration - dropDelay);
    float dropAppear = smoothstep(0.0, 0.08, dropElapse);

    float cosAngle = cos(dropAngle);
    float sinAngle = sin(dropAngle);
    vec2 dropOffset = vec2(cosAngle, sinAngle) * dropDist;
    vec2 dropPos = dripCenter + dropOffset;
    // gravity + slight wobble
    dropPos.y -= dropElapse * 0.004;
    dropPos.x += sin(dropElapse * 1.5 + fk * 2.0) * 0.002;

    // droplet body
    float dd = length(uv - dropPos);
    float dropBody = exp(-dd * dd / (dropSize * dropSize));

    // tiny tail pointing back toward splat center
    vec2 tailDir = normalize(dripCenter - dropPos);
    float tailAlong = dot(uv - dropPos, tailDir);
    float tailPerp = length(uv - dropPos - tailDir * max(tailAlong, 0.0));
    float tailLen = dropSize * 3.5;
    float tailWidth = dropSize * 0.6;
    float dropTail = exp(-tailPerp * tailPerp / (tailWidth * tailWidth))
      * smoothstep(0.0, tailLen, tailAlong)
      * smoothstep(tailLen * 1.5, tailLen, tailAlong);

    droplets += (dropBody + dropTail * 0.5) * dropAppear;
  }
  float dropletAlpha = droplets * 0.7 * growth;

  // --- water bloom: translucent wet area beyond paint edge ---
  float wetRadius = currentRadius * (2.0 + 0.4 * seed2);
  float wetAlpha = smoothstep(wetRadius, currentRadius * 0.95, dist) * 0.12 * growth;
  // paper absorption: wicking pattern at wet boundary
  vec2 wickingUv = uv * 60.0 + id * 7.0;
  float wickingNoise = fbm(wickingUv + vec2(0.0, t * 0.02));
  float wicking = smoothstep(wetRadius * 0.85, wetRadius, dist)
    * smoothstep(wetRadius * 1.15, wetRadius, dist)
    * wickingNoise * 0.2 * growth;

  // --- color modulation ---
  // center: thick paint, slightly darker (concentrated pigment)
  // wet edge: significantly darker (pigment accumulation at boundary)
  // interior: vary with paper texture showing through
  float centerDark = smoothstep(currentRadius * 0.5, 0.0, dist) * 0.08;
  float edgeDarken = edgeRing * 0.45 + innerDarkBand * 0.2;

  // paper texture showing through thin areas
  float paperShow = noise(uv * 250.0 + id * 40.0) * 0.08 * (1.0 - thickCenter);

  // mix base color with darkened version for edges
  vec3 darkColor = baseColor * 0.45; // dark concentrated pigment
  vec3 modColor = baseColor * (1.0 + centerDark - edgeDarken + pigmentGrain * 0.3 - paperShow);
  // blend edge ring to dark pigment color
  modColor = mix(modColor, darkColor, edgeRing * 0.6);

  // --- paint thickness for gloss ---
  float paintThickness = bodyAlpha * (0.7 + thickCenter * 0.3);

  // --- compose ---
  float totalAlpha = max(max(bodyAlpha, streakAlpha), max(dropletAlpha, max(wetAlpha, wicking)));
  totalAlpha = clamp(totalAlpha, 0.0, 1.0);

  // opacity: near-opaque in center, transparent at edges
  float opacity = 0.88 + 0.12 * thickCenter;

  res.color = modColor * uIntensity;
  res.alpha = totalAlpha * opacity;
  res.thickness = paintThickness;

  return res;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  // --- white paper background ---
  // warm white with subtle fiber texture
  float grain = noise(vUV * 500.0) * 0.015 + noise(vUV * 200.0) * 0.01;
  // paper fiber direction (subtle horizontal streaks)
  float fiber = noise(vec2(vUV.x * 300.0, vUV.y * 15.0)) * 0.008;
  vec3 paperColor = vec3(0.97, 0.96, 0.94) + grain + fiber;
  // vignette
  float paperVignette = 1.0 - 0.06 * pow(length(vUV - 0.5) * 1.4, 2.0);
  paperColor *= paperVignette;

  // --- accumulate paint layers with wet blending ---
  vec3 paintLayer = vec3(0.0);
  float paintAlpha = 0.0;
  float totalThickness = 0.0; // for gloss calculation

  // 12 splats for richer composition
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    SplatResult s = paintSplat(uv, t, fi);
    // overpainting with partial wet blend at overlaps
    float blendFactor = 0.3 * (1.0 - s.thickness); // thin paint blends more
    float effectiveAlpha = s.alpha * (1.0 - paintAlpha * (1.0 - blendFactor));
    paintLayer = paintLayer + s.color * effectiveAlpha;
    paintAlpha = paintAlpha + effectiveAlpha;
    paintAlpha = min(paintAlpha, 1.0);
    totalThickness = max(totalThickness, s.thickness);
  }

  // --- gravity drips from select splats ---
  for (int i = 0; i < 4; i++) {
    float fi = float(i) + 12.0;
    float seed = hash(fi * 17.3);
    float splatTime = fi * 0.55 + hash(fi * 7.1) * 0.25;
    float elapsed = t - splatTime;
    if (elapsed < 0.0) continue;

    float dripStart = splatTime + 1.2 + seed * 0.8;
    float dripElapsed = t - dripStart;
    if (dripElapsed < 0.0) continue;

    vec2 dripSource = vec2(
      (hash(fi * 13.1) - 0.5) * 1.0,
      (hash(fi * 19.3) - 0.5) * 0.4
    );

    // drip flows down with acceleration
    float dripSpeed = 0.04 * (0.5 + hash(fi * 23.7) * 0.5);
    float dripLen = dripElapsed * dripSpeed + dripElapsed * dripElapsed * 0.005;
    dripLen = min(dripLen, 0.45);

    vec2 dripDir = vec2(sin(dripElapsed * 0.25 + fi) * 0.003, -1.0);
    vec2 dripEnd = dripSource + dripDir * dripLen;

    float segLen = length(dripEnd - dripSource);
    vec2 segDir = (dripEnd - dripSource) / max(segLen, 0.001);
    float along = dot(uv - dripSource, segDir);
    along = clamp(along, 0.0, segLen);
    float perpDist = length(uv - dripSource - segDir * along);

    // varying trail width: thin at top, bulging in middle, teardrop at bottom
    float alongNorm = along / max(segLen, 0.001);
    float trailWidth = 0.0025 + alongNorm * 0.005 * (1.0 - alongNorm * 0.3);
    float dripTrail = smoothstep(trailWidth * 1.1, trailWidth * 0.3, perpDist);

    // pigment settling: denser color at bottom of drip
    float trailDarken = alongNorm * 0.15;

    // drip head (teardrop bulge)
    float headDist = length(uv - dripEnd);
    float headSize = 0.007 + 0.003 * sin(dripElapsed * 1.5);
    float dripHead = exp(-headDist * headDist / (headSize * headSize));
    // merge head into trail
    float headMerge = smoothstep(headSize * 3.0, headSize, headDist);

    // vivid drip color
    vec3 dripColor = paintColor(fi, hash(fi * 7.3 + 1.1));
    dripColor *= (1.0 - trailDarken);

    float intensity = smoothstep(3.0, 0.5, dripElapsed);
    float dripAlpha = (dripTrail * 0.85 + dripHead * 0.8) * intensity;
    float newAlpha = dripAlpha * (1.0 - paintAlpha);
    paintLayer = paintLayer + dripColor * uIntensity * newAlpha;
    paintAlpha = paintAlpha + newAlpha;
    paintAlpha = min(paintAlpha, 1.0);
  }

  // --- composite: paint over paper with wet-paper darkening ---
  // wet paper areas darken slightly (like real watercolor paper)
  float wetDarken = paintAlpha * 0.02;
  vec3 color = mix(paperColor * (1.0 - wetDarken), paintLayer, paintAlpha);

  // --- gloss/specular highlight on thick paint ---
  // simulates light reflecting off wet paint surface
  vec2 glossUv = vUV - 0.5;
  vec2 glossDir = vec2(-0.3, 0.5);
  float glossAngle = dot(glossUv, normalize(glossDir));
  float glossHighlight = pow(max(0.0, glossAngle), 8.0) * 0.12 * totalThickness;
  // only on paint areas, not wet paper
  float glossMask = smoothstep(0.3, 0.7, paintAlpha);
  color += vec3(1.0, 0.99, 0.97) * glossHighlight * glossMask;

  // --- wet pigment chroma boost: simulates light scattering in wet paint ---
  // pushes painted pixels toward higher saturation without overexposing
  float wetGlow = smoothstep(0.0, 0.30, paintAlpha);
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 lumVec = vec3(lum);
  vec3 chromaDir = color - lumVec;
  color += chromaDir * wetGlow * 0.22;

  // --- ACES tone mapping: preserves shadows, tames highlights, adds filmic depth ---
  float ta = 2.51;
  float tb = 0.03;
  float tc = 2.43;
  float td = 0.59;
  float te = 0.14;
  vec3 acesNum = color * (color * ta + tb);
  vec3 acesDen = color * (color * tc + td) + te;
  color = clamp(acesNum / acesDen, 0.0, 1.0);

  // --- final vignette: pulls focus toward composition center ---
  vec2 vigUv = vUV - 0.5;
  float vigDist = dot(vigUv, vigUv);
  float vig = 1.0 - vigDist * 0.65;
  color *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`.trim(),
  overrides: {
    uSpeed: 1.0,
    uIntensity: 1.0,
  },
  duration: 12,
  previewSize: [1280, 720],
};

const SILK_FLOW_SHADER: ShaderExample = {
  name: '🌸 紫粉丝绸',
  description: '流动的紫粉色半透明丝绸飘带 — 深紫背景上多层发光有机流动',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uResolution;

// --- utility ---
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float ix = i.x + 1.0;
  float iy = i.y + 1.0;
  float b = hash(vec2(ix, i.y));
  float c = hash(vec2(i.x, iy));
  float d = hash(vec2(ix, iy));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0, 100.0);
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// domain warping: fbm(fbm()) for ultra-organic flow
vec2 warp(vec2 p, float t) {
  float fx = fbm(p + vec2(t * 0.12, t * 0.08));
  float fy = fbm(p + vec2(t * -0.1, t * 0.14) + vec2(5.2, 1.3));
  return vec2(fx, fy);
}

// a single silk ribbon with full shading info
// returns vec3: x=body, y=edge glow, z=fold specular
vec3 silk(vec2 uv, float offset, float width, float t, float freq, float warpAmt) {
  vec2 wp = warp(uv * 2.0 + vec2(offset, 0.0), t);
  float px = uv.x * 3.5 + offset + wp.x * warpAmt;
  float py = uv.y * 2.5 + wp.y * warpAmt * 0.5;
  float n1 = fbm(vec2(px + t * 0.25, py - t * 0.18));
  float n2 = fbm(vec2(px * 1.4 - t * 0.12, py * 1.3 + t * 0.2));

  float wave = sin(uv.y * freq + n1 * 5.5 + t * 0.7 + offset * 2.0) * 0.32;
  wave += sin(uv.y * freq * 0.55 - t * 0.4 + n2 * 4.0) * 0.18;
  wave += sin(uv.y * freq * 2.1 + t * 0.25 + offset * 1.5) * 0.06;
  wave += wp.x * 0.12;

  float centerX = 0.5 + wave;
  float dist = abs(uv.x - centerX);
  float w = width * (0.4 + 0.6 * n1);

  // body: smooth falloff with inner luminance variation
  float body = smoothstep(w, w * 0.05, dist);
  float innerShade = smoothstep(0.0, w * 0.7, dist);
  body *= (0.5 + 0.5 * n2) * (0.5 + 0.5 * innerShade);

  // edge glow: thin bright rim simulating light through thin fabric
  float edgeOuter = smoothstep(w * 1.3, w * 0.85, dist);
  float edgeInner = smoothstep(w * 0.4, w * 0.75, dist);
  float edge = edgeOuter * edgeInner * (0.7 + 0.3 * n2);

  // fold specular: bright highlights at curvature peaks
  float curvature = sin(uv.y * freq * 2.5 + n1 * 7.0 + t * 1.1 + offset * 3.0);
  curvature = pow(max(curvature, 0.0), 4.0);
  float fold = curvature * body;

  return vec3(body, edge, fold);
}

// iridescent color shift based on view angle (simulated by position)
vec3 iridescence(float t, float intensity) {
  float r = 0.5 + 0.5 * sin(t * 6.2832);
  float g = 0.5 + 0.5 * sin(t * 6.2832 + 2.094);
  float b = 0.5 + 0.5 * sin(t * 6.2832 + 4.189);
  return mix(vec3(1.0), vec3(r, g, b), intensity);
}

void main() {
  vec2 uv = vUV;
  float aspect = uResolution.x / uResolution.y;
  float uvx = (uv.x - 0.5) * aspect + 0.5;
  vec2 coords = vec2(uvx, uv.y);
  float t = uTime * 0.45;

  // background: deep space gradient with subtle nebula
  vec3 bgTop = vec3(0.07, 0.02, 0.14);
  vec3 bgMid = vec3(0.04, 0.01, 0.09);
  vec3 bgBot = vec3(0.015, 0.005, 0.04);
  vec3 bg = mix(bgBot, bgMid, smoothstep(0.0, 0.5, uv.y));
  bg = mix(bg, bgTop, smoothstep(0.5, 1.0, uv.y));
  // subtle nebula clouds in background
  float nebula = fbm(coords * 3.0 + vec2(t * 0.05, t * 0.03));
  bg += vec3(0.03, 0.01, 0.06) * nebula;
  vec3 color = bg;

  // --- palette ---
  vec3 white = vec3(1.0, 0.92, 0.97);
  vec3 hotPink = vec3(1.0, 0.3, 0.78);
  vec3 pink = vec3(0.95, 0.22, 0.65);
  vec3 magenta = vec3(0.82, 0.1, 0.55);
  vec3 fuchsia = vec3(0.7, 0.05, 0.6);
  vec3 purple = vec3(0.5, 0.1, 0.8);
  vec3 violet = vec3(0.35, 0.08, 0.6);
  vec3 deepV = vec3(0.18, 0.04, 0.32);

  // === BACK LAYER: slow, wide, dim, cool ===
  float bs = t * 0.35;
  vec3 s1 = silk(coords, 0.6, 0.20, bs, 4.2, 0.6);
  vec3 s2 = silk(coords, 4.0, 0.18, bs * 0.85, 4.8, 0.5);
  vec3 bc1 = mix(deepV, violet, s1.x);
  vec3 bc2 = mix(deepV, purple * 0.5, s2.x);
  color += bc1 * s1.x * 0.28;
  color += bc2 * s2.x * 0.22;
  color += violet * s1.y * 0.15;
  color += purple * 0.4 * s2.y * 0.12;

  // === MID LAYER: medium speed, layered with subsurface glow ===
  float ms = t * 0.65;
  vec3 s3 = silk(coords, 1.3, 0.14, ms, 5.5, 0.8);
  vec3 s4 = silk(coords, 3.5, 0.12, ms * 1.1, 5.8, 0.75);
  vec3 s5 = silk(coords, 6.2, 0.13, ms * 0.9, 5.2, 0.7);

  vec3 mc1 = mix(purple, magenta, s3.x);
  vec3 mc2 = mix(violet, fuchsia, s4.x);
  vec3 mc3 = mix(fuchsia, purple, s5.x);

  // subsurface scattering: warm glow bleeding through fabric
  float sss3 = s3.x * (1.0 - s3.x) * 4.0;
  float sss4 = s4.x * (1.0 - s4.x) * 4.0;
  vec3 sssColor = vec3(0.9, 0.2, 0.5);

  color += mc1 * s3.x * 0.5;
  color += mc2 * s4.x * 0.42;
  color += mc3 * s5.x * 0.38;
  color += sssColor * sss3 * 0.12;
  color += sssColor * 0.8 * sss4 * 0.1;
  // edge rim light
  color += pink * s3.y * 0.3;
  color += magenta * s4.y * 0.25;
  color += fuchsia * s5.y * 0.2;
  // fold specular with iridescence
  vec3 iri3 = iridescence(s3.z + uv.y * 0.5, 0.3);
  color += hotPink * iri3 * s3.z * 0.25;
  color += pink * s4.z * 0.2;

  // === FRONT LAYER: fast, sharp, luminous, warm ===
  float fs = t * 0.95;
  vec3 s6 = silk(coords, 0.0, 0.10, fs, 6.5, 1.0);
  vec3 s7 = silk(coords, 2.8, 0.085, fs * 1.15, 7.0, 0.95);
  vec3 s8 = silk(coords, 5.3, 0.075, fs * 0.9, 6.8, 0.9);

  vec3 fc1 = mix(magenta, hotPink, s6.x);
  vec3 fc2 = mix(pink, hotPink, s7.x);
  vec3 fc3 = mix(fuchsia, pink, s8.x);

  color += fc1 * s6.x * 0.85;
  color += fc2 * s7.x * 0.72;
  color += fc3 * s8.x * 0.6;
  // bright edge glow
  color += hotPink * s6.y * 0.55;
  color += pink * s7.y * 0.45;
  color += magenta * s8.y * 0.35;
  // specular highlights with iridescent sheen
  vec3 iri6 = iridescence(s6.z + coords.x * 0.3, 0.2);
  vec3 iri7 = iridescence(s7.z + coords.y * 0.4, 0.25);
  color += white * iri6 * s6.z * 0.5;
  color += white * 0.9 * iri7 * s7.z * 0.4;
  color += hotPink * s8.z * 0.3;

  // === SPARKLE LAYER: tiny bright points on front ribbons ===
  float sparkleBase = s6.x + s7.x;
  float sp1 = coords.x * 47.0 + coords.y * 31.0 + t * 2.0;
  float sp2 = coords.x * 73.0 - coords.y * 59.0 + t * 3.0;
  float sparkle = pow(max(sin(sp1) * sin(sp2), 0.0), 40.0);
  sparkle *= smoothstep(0.3, 0.6, sparkleBase);
  color += white * sparkle * 0.7;

  // === VOLUMETRIC LIGHT SCATTER ===
  float allFront = s6.x + s7.x + s8.x;
  float allMid = s3.x + s4.x + s5.x;
  float scatter = allFront * 0.06 + allMid * 0.03;
  vec3 scatterColor = mix(magenta, hotPink, 0.5 + 0.5 * sin(t * 0.3));
  color += scatterColor * scatter;

  // === DEPTH FOG: subtle warm haze in overlap areas ===
  float overlap = min(allFront, allMid) * 2.0;
  overlap = smoothstep(0.0, 1.0, overlap);
  color += vec3(0.15, 0.03, 0.12) * overlap * 0.4;

  // === ALPHA ===
  float allRibbons = s1.x + s2.x + s3.x + s4.x + s5.x + s6.x + s7.x + s8.x;
  float alpha = clamp(allRibbons * 1.2, 0.0, 1.0);
  alpha = max(alpha, 0.92);

  // === TONE MAPPING (filmic) ===
  color = max(color, vec3(0.0));
  vec3 x = color;
  // ACES-like curve
  vec3 mapped = (x * (2.51 * x + vec3(0.03))) / (x * (2.43 * x + vec3(0.59)) + vec3(0.14));
  color = clamp(mapped, vec3(0.0), vec3(1.0));

  // slight vignette to focus eye
  float vig = 1.0 - 0.3 * pow(length(vUV - 0.5) * 1.4, 2.0);
  color *= vig;

  gl_FragColor = vec4(color, alpha);
}`,
  overrides: {},
  duration: 12,
  previewSize: [522, 1050],
};

const PARTICLE_STORM_SHADER: ShaderExample = {
  name: '🌊 粒子旋风',
  description: '多彩烟雾丝带+星光粒子+暗背景 — 从底部"唰"入画面的惊艳开屏',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uResolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash1(float n) {
  return fract(sin(n * 127.753) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float ix = i.x + 1.0;
  float iy = i.y + 1.0;
  float b = hash(vec2(ix, i.y));
  float c = hash(vec2(i.x, iy));
  float d = hash(vec2(ix, iy));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(100.0, 100.0);
    a *= 0.5;
  }
  return v;
}

vec2 warp(vec2 p, float t) {
  float fx = fbm(p + vec2(t * 0.15, t * -0.1));
  float fy = fbm(p + vec2(t * -0.12, t * 0.13) + vec2(3.7, 8.2));
  return vec2(fx, fy);
}

// entrance easing: 0→1, starts at 1s, arrives ~1.6s
float entrance(float time) {
  float delay = 1.0;
  float dur = 0.6;
  float p = clamp((time - delay) / dur, 0.0, 1.0);
  // overshoot ease-out (cubic bezier feel)
  float t1 = 1.0 - p;
  return 1.0 - t1 * t1 * t1 * (1.0 + 3.0 * p);
}

// swirl distortion centered on current position
vec2 swirl(vec2 uv, vec2 center, float t) {
  float dx = uv.x - center.x;
  float dy = uv.y - center.y;
  float dist = sqrt(dx * dx + dy * dy);
  float angle = 3.0 * exp(-dist * 2.2) * sin(t * 0.4);
  float cs = cos(angle);
  float sn = sin(angle);
  float rx = dx * cs - dy * sn + center.x;
  float ry = dx * sn + dy * cs + center.y;
  return vec2(rx, ry);
}

void main() {
  vec2 uv = vUV;
  float aspect = uResolution.x / uResolution.y;
  float uvx = (uv.x - 0.5) * aspect + 0.5;
  vec2 coords = vec2(uvx, uv.y);
  float rawTime = uTime;
  float t = rawTime * 0.7;

  // --- ENTRANCE ANIMATION ---
  float ent = entrance(rawTime);
  // offset: starts far above (+1.2), drops into center (0.0)
  float yOffset = (1.0 - ent) * 1.2;
  // scale punch: slight overshoot scale
  float scaleFactor = 0.7 + 0.3 * ent;
  // apply entrance transform to coords
  vec2 entCoords = coords;
  entCoords.y += yOffset;
  entCoords = (entCoords - 0.5) / scaleFactor + 0.5;

  // overall fade in (pure black until 1.0s, then rapid fade)
  float fadeIn = smoothstep(1.0, 1.5, rawTime);

  // swirl center follows entrance
  vec2 swirlCenter = vec2(0.5, 0.5 + yOffset * 0.3);

  // dark background (pure black before fadeIn)
  vec3 color = vec3(0.0);
  vec3 bgColor = mix(vec3(0.01, 0.005, 0.02), vec3(0.03, 0.012, 0.05), uv.y);
  color = bgColor * fadeIn;

  // widen horizontal spread without stretching shapes
  entCoords.x = (entCoords.x - 0.5) * 0.65 + 0.5;

  // swirl the smoke coordinates
  vec2 sc = swirl(entCoords, swirlCenter, t);
  vec2 wp = warp(sc * 2.5, t * 0.8);
  vec2 warped = sc + wp * 0.35;

  // --- SMOKE RIBBONS ---
  float purpleSmoke = fbm(warped * 3.0 + vec2(t * 0.2, t * -0.1));
  purpleSmoke = smoothstep(0.35, 0.7, purpleSmoke);
  float purpleMask = smoothstep(0.0, 0.8, entCoords.x) * smoothstep(1.0, 0.3, entCoords.x);
  purpleSmoke *= purpleMask;
  vec3 purpleCol = mix(vec3(0.25, 0.05, 0.5), vec3(0.55, 0.18, 0.9), purpleSmoke);
  color += purpleCol * purpleSmoke * 0.6 * fadeIn;

  vec2 pinkWarp = warped + vec2(1.5, 0.8);
  float pinkSmoke = fbm(pinkWarp * 2.8 + vec2(t * 0.15, t * 0.12));
  pinkSmoke = smoothstep(0.38, 0.72, pinkSmoke);
  float pinkMask = smoothstep(-0.1, 0.6, entCoords.x) * smoothstep(1.1, 0.4, entCoords.x);
  pinkSmoke *= pinkMask;
  vec3 pinkCol = mix(vec3(0.8, 0.1, 0.4), vec3(1.0, 0.35, 0.75), pinkSmoke);
  color += pinkCol * pinkSmoke * 0.55 * fadeIn;

  vec2 blueWarp = warped + vec2(3.0, -0.5);
  float blueSmoke = fbm(blueWarp * 3.2 + vec2(t * -0.12, t * 0.18));
  blueSmoke = smoothstep(0.4, 0.75, blueSmoke);
  float blueMask = smoothstep(0.1, 0.7, entCoords.x) * smoothstep(0.95, 0.5, entCoords.x);
  blueSmoke *= blueMask;
  vec3 blueCol = mix(vec3(0.05, 0.15, 0.5), vec3(0.25, 0.55, 0.95), blueSmoke);
  color += blueCol * blueSmoke * 0.42 * fadeIn;

  vec2 orangeWarp = warped + vec2(2.0, 1.5);
  float orangeSmoke = fbm(orangeWarp * 3.5 + vec2(t * 0.22, t * -0.08));
  orangeSmoke = smoothstep(0.42, 0.73, orangeSmoke);
  float orangeMask = smoothstep(0.05, 0.5, entCoords.x) * smoothstep(0.9, 0.45, entCoords.x);
  orangeSmoke *= orangeMask;
  vec3 orangeCol = mix(vec3(0.6, 0.2, 0.0), vec3(1.0, 0.6, 0.15), orangeSmoke);
  color += orangeCol * orangeSmoke * 0.38 * fadeIn;

  // luminous cores (brightest areas glow hotter)
  color += vec3(0.6, 0.3, 1.0) * pow(purpleSmoke, 2.5) * 0.3 * fadeIn;
  color += vec3(1.0, 0.5, 0.8) * pow(pinkSmoke, 2.5) * 0.25 * fadeIn;
  color += vec3(0.3, 0.6, 1.0) * pow(blueSmoke, 2.5) * 0.2 * fadeIn;
  color += vec3(1.0, 0.7, 0.2) * pow(orangeSmoke, 2.0) * 0.2 * fadeIn;

  // ribbon interaction glow
  color += vec3(0.7, 0.2, 0.9) * purpleSmoke * pinkSmoke * 0.4 * fadeIn;
  color += vec3(1.0, 0.4, 0.3) * pinkSmoke * orangeSmoke * 0.3 * fadeIn;

  // --- SOFT BLOOM / HALO around dense regions ---
  float smokePresence = purpleSmoke + pinkSmoke + blueSmoke + orangeSmoke;
  float bloomBase = smoothstep(0.3, 1.5, smokePresence);
  vec3 bloomColor = mix(vec3(0.4, 0.15, 0.7), vec3(0.9, 0.4, 0.8), bloomBase);
  color += bloomColor * bloomBase * 0.2 * fadeIn;

  // --- SPECULAR HIGHLIGHTS on smoke folds ---
  float spec1 = pow(purpleSmoke, 4.0) * 0.4;
  float spec2 = pow(pinkSmoke, 4.0) * 0.35;
  float spec3 = pow(blueSmoke, 4.0) * 0.3;
  color += vec3(0.85, 0.7, 1.0) * spec1 * fadeIn;
  color += vec3(1.0, 0.75, 0.9) * spec2 * fadeIn;
  color += vec3(0.6, 0.85, 1.0) * spec3 * fadeIn;


  // --- DIRECTIONAL LIGHT SWEEP ---
  float sweep = sin(entCoords.x * 3.14159 - t * 0.4) * 0.5 + 0.5;
  sweep = pow(sweep, 3.0);
  color += vec3(0.15, 0.08, 0.2) * sweep * smokePresence * 0.3 * fadeIn;

  // --- EDGE LIGHT ---
  float ps2 = fbm((warped + vec2(0.01, 0.0)) * 3.0 + vec2(t * 0.2, t * -0.1));
  ps2 = smoothstep(0.35, 0.7, ps2) * purpleMask;
  float edgeGlow = abs(purpleSmoke - ps2) * 15.0;
  color += vec3(0.6, 0.3, 1.0) * edgeGlow * 0.2 * fadeIn;

  // --- ENTRANCE BURST (layered radial shockwave + light scatter) ---
  float burstTime = rawTime - 1.1;
  float burstEnv = exp(-burstTime * burstTime * 20.0) * step(0.0, burstTime);
  // radial shockwave ring expanding from center
  vec2 burstCenter = vec2(0.5, 0.5);
  float burstDx = entCoords.x - burstCenter.x;
  float burstDy = entCoords.y - burstCenter.y;
  float burstDist = sqrt(burstDx * burstDx + burstDy * burstDy);
  float ringRadius = burstTime * 2.5;
  float ring = exp(-pow(burstDist - ringRadius, 2.0) * 80.0) * step(0.0, burstTime);
  ring *= smoothstep(0.8, 0.0, burstTime);
  // inner hot core glow
  float coreGlow = exp(-burstDist * burstDist * 30.0) * burstEnv;
  // scattered light rays (angular variation)
  float burstAngle = atan(burstDy, burstDx);
  float rays = 0.5 + 0.5 * sin(burstAngle * 6.0 + rawTime * 5.0);
  rays *= 0.5 + 0.5 * sin(burstAngle * 10.0 - rawTime * 3.0);
  float rayGlow = rays * exp(-burstDist * 4.0) * burstEnv * 0.7;
  // second ring (slightly delayed, wider)
  float ring2Time = burstTime - 0.08;
  float ring2Radius = ring2Time * 2.0;
  float ring2 = exp(-pow(burstDist - ring2Radius, 2.0) * 50.0) * step(0.0, ring2Time);
  ring2 *= smoothstep(0.7, 0.0, ring2Time);
  // composite burst with color gradient (hot white center → purple → blue edge)
  vec3 burstCore = vec3(1.0, 0.85, 0.95) * coreGlow * 1.2;
  vec3 burstRing = vec3(0.6, 0.3, 1.0) * ring;
  vec3 burstRing2 = vec3(0.3, 0.2, 0.8) * ring2 * 0.6;
  vec3 burstRays = vec3(0.7, 0.4, 0.9) * rayGlow;
  // noise breakup on the burst for texture
  float burstNoise = noise(entCoords * 8.0 + vec2(rawTime * 3.0, 0.0));
  float burstTexture = 0.7 + 0.3 * burstNoise;
  vec3 burst = (burstCore + burstRing + burstRing2 + burstRays) * burstTexture;
  color += burst;

  // --- ALPHA ---
  float totalSmoke = purpleSmoke + pinkSmoke + blueSmoke + orangeSmoke;
  float burstAlpha = coreGlow + ring * 0.5 + rayGlow * 0.3;
  float alpha = clamp(totalSmoke * 0.8 * fadeIn + burstAlpha, 0.0, 1.0);
  alpha = max(alpha, fadeIn * 0.88);

  // --- TONE MAPPING (ACES) ---
  color = max(color, vec3(0.0));
  vec3 x = color;
  vec3 mapped = (x * (2.51 * x + vec3(0.03))) / (x * (2.43 * x + vec3(0.59)) + vec3(0.14));
  color = clamp(mapped, vec3(0.0), vec3(1.0));

  // vignette
  float vig = 1.0 - 0.35 * pow(length(vUV - 0.5) * 1.5, 2.5);
  color *= vig;

  gl_FragColor = vec4(color, alpha);
}`,
  overrides: {},
  duration: 20,
  previewSize: [1280, 720],
};

const STARRY_NIGHT_SHADER: ShaderExample = {
  name: '🌌 梵高星空',
  description: '致敬梵高《星月夜》——深蓝旋涡天空、金色星光辉芒、流动笔触质感',

  code: `precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uResolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float bx = i.x + 1.0;
  float cy = i.y + 1.0;
  float a = hash(i);
  float b = hash(vec2(bx, i.y));
  float c = hash(vec2(i.x, cy));
  float d = hash(vec2(bx, cy));
  float ab = mix(a, b, u.x);
  float cd = mix(c, d, u.x);
  return mix(ab, cd, u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * 0.06;

  // --- 双层 domain warp：梵高标志性的旋涡笔触 ---
  float off1 = 1.3 + t * 0.7;
  float w1x = fbm(uv * 3.0 + vec2(0.0, t));
  float w1y = fbm(uv * 3.0 + vec2(5.2, off1));
  vec2 warp1 = vec2(w1x, w1y);

  vec2 wb = uv * 3.0 + 4.0 * warp1;
  float off2 = 9.2 + t * 0.5;
  float off3 = 2.8 - t * 0.3;
  float w2x = fbm(wb + vec2(1.7, off2));
  float w2y = fbm(wb + vec2(8.3, off3));
  vec2 warp2 = vec2(w2x, w2y);

  float n = fbm(uv * 3.0 + 3.5 * warp2);

  // --- 色彩映射：深夜蓝 → 靛蓝 → 青蓝 → 金黄 ---
  vec3 c1 = vec3(0.01, 0.02, 0.1);
  vec3 c2 = vec3(0.04, 0.1, 0.32);
  vec3 c3 = vec3(0.08, 0.28, 0.52);
  vec3 c4 = vec3(0.12, 0.45, 0.58);
  vec3 c5 = vec3(0.92, 0.82, 0.3);
  vec3 col = mix(c1, c2, smoothstep(0.0, 0.3, n));
  col = mix(col, c3, smoothstep(0.25, 0.5, n));
  col = mix(col, c4, smoothstep(0.45, 0.65, n));
  col = mix(col, c5, smoothstep(0.72, 0.92, n));

  // --- 紫色旋涡穿插（蓝紫过渡区域） ---
  float purpleZone = fbm(uv * 4.5 + warp1 * 2.0 + vec2(3.1, t));
  vec3 purpleTint = vec3(0.3, 0.08, 0.45);
  col = mix(col, col + purpleTint, smoothstep(0.4, 0.7, purpleZone) * 0.4);

  // --- 旋涡高光：明亮笔触的隆起感 ---
  float ridgeBase = max(n - 0.55, 0.0) * 2.2;
  float ridge = pow(ridgeBase, 2.5);
  col += vec3(0.75, 0.65, 0.2) * ridge;

  // --- 星光：散布的金色亮点 + 闪烁 ---
  float starScale = 12.0;
  vec2 starUV = vUV * starScale;
  float starSeed = noise(starUV);
  float starBase = max(starSeed - 0.88, 0.0) * 9.0;
  float stars = pow(starBase, 3.0);
  float flicker = 0.6 + 0.4 * sin(uTime * 2.5 + starSeed * 30.0);
  col += vec3(1.0, 0.95, 0.6) * stars * flicker;

  // --- 星光辉芒 bloom ---
  float starGlowBase = max(starSeed - 0.82, 0.0) * 5.5;
  float starGlow = pow(starGlowBase, 2.0) * 0.4;
  col += vec3(0.6, 0.55, 0.25) * starGlow * flicker;

  // --- 笔触纹理：高频 noise 模拟油画质感 ---
  float brushX = vUV.x * 80.0 + uTime * 0.5;
  float brushY = vUV.y * 80.0;
  float brush = noise(vec2(brushX, brushY));
  col *= 0.88 + 0.12 * brush;

  // --- Bloom：亮区溢出 ---
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float bloomBase = max(luma - 0.35, 0.0);
  float bloom = pow(bloomBase, 2.0) * 0.35;
  col += col * bloom;

  // --- ACES tone mapping ---
  vec3 x = col;
  float ta = 2.51;
  float tb = 0.03;
  float tc = 2.43;
  float td = 0.59;
  float te = 0.14;
  col = clamp((x * (ta * x + tb)) / (x * (tc * x + td) + te), 0.0, 1.0);

  // --- Vignette ---
  float vig = 1.0 - dot(uv * 0.75, uv * 0.75);
  col *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}`,
  overrides: {},
  duration: 10,
  previewSize: [1280, 720],
};

const CYBERPUNK_LASER_SHADER: ShaderExample = {
  name: '⚡ 赛博激光',
  description: '赛博朋克霓虹激光 — 8 道光束 + 交叉爆点 + 透视网格 + 能量核心',

  code: `
precision highp float;
varying vec2 vUV;
uniform float uTime;        // elapsed time
uniform vec4 uResolution;   // viewport resolution (xy used)
uniform float uIntensity;   // overall glow intensity
uniform float uSpeed;       // animation speed multiplier

// --- pseudo-random ---
float hash21(vec2 p) {
  vec2 k = vec2(127.1, 311.7);
  float d = dot(p, k);
  return fract(sin(d) * 43758.5453);
}

// --- single laser beam: rotated band with travelling pulses ---
float laserBeam(vec2 p, float angle, float yOff, float thickness, float scrollT) {
  float c = cos(angle);
  float s = sin(angle);
  float rotX = p.x * c - p.y * s;
  float rotY = p.x * s + p.y * c;
  float dy = abs(rotY - yOff);
  float beam = exp(-dy / thickness);
  float pulseArg = rotX * 6.0 - scrollT * 5.0;
  float pulse = 0.5 + 0.5 * sin(pulseArg);
  float secondary = 0.5 + 0.5 * sin(rotX * 18.0 + scrollT * 9.0);
  return beam * (0.45 + 0.4 * pulse + 0.15 * secondary);
}

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float t = uTime * uSpeed;

  vec3 color = vec3(0.015, 0.0, 0.04); // deep purple-black base

  // --- 1. perspective grid (cyberpunk signature) ---
  float gridScale = 9.0;
  float gx = uv.x * gridScale;
  float gy = uv.y * gridScale + t * 0.5;
  vec2 gv = vec2(gx, gy);
  vec2 gFrac = fract(gv) - 0.5;
  vec2 gAbs = abs(gFrac);
  float gridLine = smoothstep(0.46, 0.50, max(gAbs.x, gAbs.y));
  float persp = exp(-abs(uv.y) * 1.3);
  color += vec3(0.05, 0.45, 0.75) * gridLine * 0.20 * persp;

  // --- 2. eight laser beams (oscillating positions) ---
  float yOff1 = sin(t * 0.5) * 0.22;
  float yOff2 = cos(t * 0.4 + 1.0) * 0.30;
  float yOff3 = sin(t * 0.6 + 2.0) * 0.26;
  float yOff4 = sin(t * 0.7 + 3.0) * 0.38;
  float yOff5 = sin(t * 0.45 + 4.0) * 0.30;
  float yOff6 = cos(t * 0.55 + 5.0) * 0.32;
  float yOff7 = sin(t * 0.65 + 6.0) * 0.20;
  float yOff8 = cos(t * 0.50 + 7.0) * 0.35;

  float scroll1 = t * 0.6;
  float scroll2 = -t * 0.7;
  float scroll3 = t * 0.5;
  float scroll4 = -t * 0.55;
  float scroll5 = t * 0.85;
  float scroll6 = -t * 0.65;
  float scroll7 = t * 0.45;
  float scroll8 = -t * 0.78;

  float l1 = laserBeam(uv,  0.30, yOff1, 0.008, scroll1);
  float l2 = laserBeam(uv, -0.40, yOff2, 0.006, scroll2);
  float l3 = laserBeam(uv,  0.15, yOff3, 0.005, scroll3);
  float l4 = laserBeam(uv, -0.20, yOff4, 0.007, scroll4);
  float l5 = laserBeam(uv,  0.55, yOff5, 0.007, scroll5);
  float l6 = laserBeam(uv, -0.55, yOff6, 0.006, scroll6);
  float l7 = laserBeam(uv,  0.05, yOff7, 0.005, scroll7);
  float l8 = laserBeam(uv, -0.10, yOff8, 0.008, scroll8);

  vec3 cCyan    = vec3(0.0, 1.0, 1.0);
  vec3 cMagenta = vec3(1.0, 0.15, 0.85);
  vec3 cBlue    = vec3(0.35, 0.55, 1.0);
  vec3 cPink    = vec3(1.0, 0.30, 0.55);
  vec3 cViolet  = vec3(0.70, 0.10, 1.0);
  vec3 cMint    = vec3(0.10, 1.0, 0.70);
  vec3 cYellow  = vec3(1.0, 0.95, 0.20);
  vec3 cOrange  = vec3(1.0, 0.50, 0.10);

  color += cCyan    * l1 * 1.7 * uIntensity;
  color += cMagenta * l2 * 1.7 * uIntensity;
  color += cBlue    * l3 * 1.5 * uIntensity;
  color += cPink    * l4 * 1.5 * uIntensity;
  color += cViolet  * l5 * 1.6 * uIntensity;
  color += cMint    * l6 * 1.5 * uIntensity;
  color += cYellow  * l7 * 1.4 * uIntensity;
  color += cOrange  * l8 * 1.5 * uIntensity;

  // --- 3. wide bloom halo around each beam ---
  float lg1 = laserBeam(uv,  0.30, yOff1, 0.055, scroll1);
  float lg2 = laserBeam(uv, -0.40, yOff2, 0.050, scroll2);
  float lg3 = laserBeam(uv,  0.15, yOff3, 0.045, scroll3);
  float lg4 = laserBeam(uv, -0.20, yOff4, 0.055, scroll4);
  float lg5 = laserBeam(uv,  0.55, yOff5, 0.050, scroll5);
  float lg6 = laserBeam(uv, -0.55, yOff6, 0.045, scroll6);
  float lg7 = laserBeam(uv,  0.05, yOff7, 0.040, scroll7);
  float lg8 = laserBeam(uv, -0.10, yOff8, 0.055, scroll8);
  color += cCyan    * lg1 * 0.40 * uIntensity;
  color += cMagenta * lg2 * 0.40 * uIntensity;
  color += cBlue    * lg3 * 0.32 * uIntensity;
  color += cPink    * lg4 * 0.32 * uIntensity;
  color += cViolet  * lg5 * 0.35 * uIntensity;
  color += cMint    * lg6 * 0.30 * uIntensity;
  color += cYellow  * lg7 * 0.28 * uIntensity;
  color += cOrange  * lg8 * 0.30 * uIntensity;

  // --- 3.5 cross spark: where beams overlap, emit white-hot flashes ---
  float beamSum = l1 + l2 + l3 + l4 + l5 + l6 + l7 + l8;
  float crossThresh = max(beamSum - 0.55, 0.0);
  float crossSpark = pow(crossThresh, 2.2) * 2.8;
  // tiny fast flicker for extra zing
  float flickerArg = beamSum * 30.0 + t * 22.0;
  float flicker = 0.85 + 0.15 * sin(flickerArg);
  color += vec3(1.0, 0.97, 0.90) * crossSpark * flicker * uIntensity;

  // --- 4. central energy core (heartbeat pulse) ---
  float dist = length(uv);
  float corePulse = 0.5 + 0.5 * sin(t * 4.0);
  float coreSize = 0.13 + corePulse * 0.06;
  float core = exp(-dist / coreSize);
  vec3 coreColor = mix(cMagenta, cBlue, corePulse);
  color += coreColor * core * 0.85 * uIntensity;

  // outer aura
  float aura = exp(-dist / 0.45) * 0.22;
  color += mix(cCyan, cViolet, 0.5 + 0.5 * sin(t * 1.8)) * aura;

  // --- 5. horizontal scan lines (digital feel) ---
  float scanArg = uv.y * 180.0 - t * 6.0;
  float scanRaw = 0.5 + 0.5 * sin(scanArg);
  float scan = pow(scanRaw, 8.0);
  color += vec3(0.0, 0.6, 0.85) * scan * 0.20;

  // --- 6. digital noise grain ---
  vec2 nCoord = vUV * uResolution.xy * 0.5;
  vec2 nFloor = floor(nCoord);
  float tFloor = floor(t * 28.0);
  vec2 nSeed = nFloor + vec2(tFloor, tFloor);
  float noise = hash21(nSeed);
  color += vec3(noise - 0.5) * 0.07;

  // --- 7. ACES tone mapping ---
  float ta = 2.51;
  float tb = 0.03;
  float tc = 2.43;
  float td = 0.59;
  float te = 0.14;
  vec3 num = color * (color * ta + tb);
  vec3 den = color * (color * tc + td) + te;
  color = clamp(num / den, 0.0, 1.0);

  // --- 8. vignette ---
  float vu = uv.x * 0.75;
  float vv = uv.y * 0.75;
  vec2 vUv2 = vec2(vu, vv);
  float vig = 1.0 - dot(vUv2, vUv2);
  color *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}`,
  overrides: {
    uIntensity: 1.0,
    uSpeed: 1.0,
  },
  duration: 8,
  previewSize: [1280, 720],
};

export const SHADER_EXAMPLES: ShaderExample[] = [
  GLOW_SHADER,
  GRADIENT_SHADER,
  RIPPLE_SHADER,
  COLORFUL_ORBS_SHADER,
  FIRE_ORB_SHADER,
  PAINT_SPLASH_SHADER,
  SILK_FLOW_SHADER,
  PARTICLE_STORM_SHADER,
  STARRY_NIGHT_SHADER,
  CYBERPUNK_LASER_SHADER,
];
