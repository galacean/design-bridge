import { describe, it, expect } from 'vitest';
import * as spec from '@galacean/effects-specification';
import { convertShaderToGE } from '@galacean/shader2ge';

const SIMPLE_SHADER = `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uColor;

void main() {
  vec3 col = 0.5 + 0.5 * cos(uTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(col, 1.0) * uColor;
}
`.trim();

const SHADER_WITH_TEXTURE = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uMainTex; // main texture
uniform float uTime;

void main() {
  vec4 texColor = texture2D(uMainTex, vUV);
  gl_FragColor = texColor;
}
`.trim();

const SHADER_WITH_MULTIPLE_TEXTURES = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uMainTex;
uniform sampler2D uNormalMap; // normal map
uniform sampler2D uLUT; // color lookup

void main() {
  vec4 c = texture2D(uMainTex, vUV);
  gl_FragColor = c;
}
`.trim();

const MAINIMAGE_WITH_ICHANNEL = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 tex = texture2D(iChannel0, uv);
  fragColor = tex;
}
`.trim();

const TEST_TEXTURE_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lCFOSQAAAABJRU5ErkJggg==';

describe('convertShaderToGE', () => {
  it('should produce a valid JSONScene with all required top-level fields', () => {
    const result = convertShaderToGE(SIMPLE_SHADER);
    const { scene } = result;

    expect(scene.version).toBe(spec.JSONSceneVersion.LATEST);
    expect(scene.playerVersion.web).toBe('2.9.0');
    expect(scene.type).toBe('ge');
    expect(scene.compositionId).toBeTruthy();
    expect(scene.compositions).toHaveLength(1);
    expect(scene.items).toHaveLength(1);
    expect(scene.components).toHaveLength(2);
    expect(scene.materials).toHaveLength(1);
    expect(scene.shaders).toHaveLength(1);
    expect(scene.geometries).toHaveLength(1);
    expect(scene.miscs.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('should embed the fragment shader in ShaderData', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);

    expect(scene.shaders[0].fragment).toContain('varying float vTime');
    expect(scene.shaders[0].fragment).toContain('#define uTime vTime');
    expect(scene.shaders[0].fragment).toContain('uColor');
    expect(scene.shaders[0].vertex).toContain('aPos');
    expect(scene.shaders[0].vertex).toContain('aUV');
    expect(scene.shaders[0].dataType).toBe('Shader');
  });

  it('should preserve a same-line shader after bridging uTime through the public API', () => {
    const { scene, uniforms, diagnostics } = convertShaderToGE(
      'precision highp float; uniform float uTime; void main() { gl_FragColor = vec4(uTime); }',
    );
    const fragment = scene.shaders[0].fragment;

    expect(fragment).toContain('void main() { gl_FragColor = vec4(uTime); }');
    expect(fragment).toContain('#define uTime vTime');
    expect(uniforms.some(uniform => uniform.name === 'uTime')).toBe(false);
    expect(scene.materials[0].floats).not.toHaveProperty('uTime');
    expect(
      diagnostics.some(
        diagnostic => diagnostic.code === 'SHADER_MAIN_MISSING' || diagnostic.code === 'SHADER_OUTPUT_MISSING',
      ),
    ).toBe(false);
  });

  it('should populate material uniforms from parsed shader', () => {
    const { scene, uniforms } = convertShaderToGE(SIMPLE_SHADER);

    expect(uniforms).toHaveLength(1);
    expect(uniforms[0].name).toBe('uColor');
    const material = scene.materials[0];

    expect(material.vector4s).toHaveProperty('uColor');
  });

  it('should apply uniform overrides', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER, {
      uniformOverrides: {
        uColor: { r: 1, g: 0, b: 0, a: 1 },
      },
    });
    const material = scene.materials[0];

    expect(material.colors.uColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it('should preserve a __proto__ uniform as an own serializable material property', () => {
    const uniformOverrides = Object.fromEntries([['__proto__', 0.75]]);
    const { scene, diagnostics } = convertShaderToGE(`
      uniform float __proto__;
      void main() { gl_FragColor = vec4(__proto__); }
    `, { uniformOverrides });
    const floats = scene.materials[0].floats;

    expect(diagnostics).toEqual([]);
    expect(Object.getPrototypeOf(floats)).toBe(Object.prototype);
    expect(Object.hasOwn(floats, '__proto__')).toBe(true);
    expect(floats['__proto__']).toBe(0.75);

    const serialized = JSON.parse(JSON.stringify(floats)) as Record<string, number>;

    expect(Object.hasOwn(serialized, '__proto__')).toBe(true);
    expect(serialized['__proto__']).toBe(0.75);
  });

  it('should respect custom options', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER, {
      sceneName: 'TestScene',
      duration: 10,
      previewSize: [1920, 1080],
    });

    expect(scene.compositions[0].name).toBe('TestScene');
    expect(scene.compositions[0].duration).toBe(10);
    expect(scene.compositions[0].previewSize).toEqual([1920, 1080]);
    expect(scene.items[0].duration).toBe(10);
  });

  it('should use fallback shader when input is empty', () => {
    const { scene, diagnostics } = convertShaderToGE('');

    expect(diagnostics.some(diagnostic => diagnostic.code === 'SHADER_EMPTY')).toBe(true);
    expect(scene.shaders[0].fragment).toContain('gl_FragColor');
  });

  it('should warn when main() is missing', () => {
    const { diagnostics } = convertShaderToGE('uniform float uTime;');

    expect(diagnostics.some(diagnostic => diagnostic.code === 'SHADER_MAIN_MISSING')).toBe(true);
  });

  it('should warn when gl_FragColor is not set', () => {
    const { diagnostics } = convertShaderToGE(`
      void main() { float x = 1.0; }
    `);

    expect(diagnostics.some(diagnostic => diagnostic.code === 'SHADER_OUTPUT_MISSING')).toBe(true);
  });

  it('should warn when sampler2D uniform has no texture override', () => {
    const shaderWithTexture = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D uMainTex; // main texture
      void main() {
        gl_FragColor = texture2D(uMainTex, vUV);
      }
    `;
    const { diagnostics, uniforms } = convertShaderToGE(shaderWithTexture);

    expect(uniforms.some(u => u.type === 'sampler2D')).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'TEXTURE_FALLBACK_USED')).toBe(true);
  });

  it('should have valid DataPath references (all ids resolve)', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);
    const allIds = new Set<string>();

    scene.compositions.forEach(c => allIds.add(c.id));
    scene.items.forEach(i => allIds.add(i.id));
    scene.components.forEach(c => allIds.add(c.id));
    scene.materials.forEach(m => allIds.add(m.id));
    scene.shaders.forEach(s => allIds.add(s.id));
    scene.geometries.forEach(g => allIds.add(g.id));
    scene.miscs.forEach(m => allIds.add(m.id));
    expect(scene.compositionId && allIds.has(scene.compositionId)).toBe(true);
    for (const comp of scene.compositions) {
      for (const ref of comp.components) {
        expect(allIds.has(ref.id)).toBe(true);
      }
    }
    for (const item of scene.items) {
      for (const ref of item.components) {
        expect(allIds.has(ref.id)).toBe(true);
      }
    }
    const effectComp = scene.components.find(
      c => c.dataType === spec.DataType.EffectComponent,
    ) as spec.EffectComponentData;

    if (effectComp && 'materials' in effectComp) {
      for (const ref of effectComp.materials) {
        expect(allIds.has(ref.id)).toBe(true);
      }
      expect(allIds.has(effectComp.geometry.id)).toBe(true);
    }
    for (const mat of scene.materials) {
      expect(allIds.has(mat.shader.id)).toBe(true);
    }
    const compComp = scene.components.find(
      c => c.dataType === spec.DataType.CompositionComponent,
    ) as spec.CompositionComponentData;

    if (compComp && 'timelineAsset' in compComp) {
      expect(allIds.has(compComp.timelineAsset.id)).toBe(true);
      for (const itemRef of compComp.items) {
        expect(allIds.has(itemRef.id)).toBe(true);
      }
      for (const binding of compComp.sceneBindings) {
        expect(allIds.has(binding.key.id)).toBe(true);
        expect(allIds.has(binding.value.id)).toBe(true);
      }
    }
  });

  it('should build correct Timeline structure (TimelineAsset → ObjectBindingTrack → ActivationTrack)', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);
    const timelineAsset = scene.miscs.find(m => m.dataType === spec.DataType.TimelineAsset) as spec.TimelineAssetData;

    expect(timelineAsset).toBeDefined();
    const tracks = timelineAsset.tracks as Array<{ id: string }>;

    expect(tracks).toHaveLength(1);
    const objectBindingTrack = scene.miscs.find(m => m.id === tracks[0].id) as spec.TrackAssetData;

    expect(objectBindingTrack).toBeDefined();
    expect(objectBindingTrack.dataType).toBe(spec.DataType.ObjectBindingTrack);
    const children = objectBindingTrack.children as Array<{ id: string }>;

    expect(children).toHaveLength(1);
    const activationTrack = scene.miscs.find(m => m.id === children[0].id) as spec.TrackAssetData;

    expect(activationTrack).toBeDefined();
    expect(activationTrack.dataType).toBe(spec.DataType.ActivationTrack);
    const clips = activationTrack.clips as Array<{
      start: number;
      duration: number;
      asset: { id: string };
    }>;

    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBe(0);
    expect(typeof clips[0].duration).toBe('number');
    const playableAsset = scene.miscs.find(m => m.id === clips[0].asset.id);

    expect(playableAsset).toBeDefined();
    expect(playableAsset!.dataType).toBe(spec.DataType.ActivationPlayableAsset);
  });

  it('should build CompositionComponent with items, timelineAsset, and sceneBindings', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);

    const compComp = scene.components.find(
      c => c.dataType === spec.DataType.CompositionComponent,
    ) as spec.CompositionComponentData;

    expect(compComp).toBeDefined();
    expect('items' in compComp).toBe(true);
    expect('timelineAsset' in compComp).toBe(true);
    expect('sceneBindings' in compComp).toBe(true);

    if ('items' in compComp) {
      expect(compComp.items).toHaveLength(1);
      expect(compComp.items[0].id).toBe(scene.items[0].id);
      const timelineAsset = scene.miscs.find(m => m.id === compComp.timelineAsset.id);

      expect(timelineAsset).toBeDefined();
      expect(timelineAsset!.dataType).toBe('TimelineAsset');
      expect(compComp.sceneBindings).toHaveLength(1);
      const binding = compComp.sceneBindings[0];
      const objectBindingTrack = scene.miscs.find(m => m.id === binding.key.id);

      expect(objectBindingTrack).toBeDefined();
      expect(objectBindingTrack!.dataType).toBe('ObjectBindingTrack');
      expect(binding.value.id).toBe(scene.items[0].id);
    }
  });

  it('should create a Quad geometry with correct structure', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);
    const geometry = scene.geometries[0];

    expect(geometry.dataType).toBe('Geometry');
    expect(geometry.vertexData.vertexCount).toBe(4);
    expect(geometry.vertexData.channels).toHaveLength(2);
    expect(geometry.vertexData.channels[0].semantic).toBe('POSITION');
    expect(geometry.vertexData.channels[1].semantic).toBe('TEXCOORD0');
    expect(geometry.subMeshes[0].indexCount).toBe(6);
    expect(geometry.buffer).toBeTruthy();
  });
});

describe('Texture channel support', () => {
  it('should generate texture reference chain for sampler2D with default white texture', () => {
    const { scene, diagnostics, uniforms } = convertShaderToGE(SHADER_WITH_TEXTURE);

    expect(uniforms.some(u => u.name === 'uMainTex' && u.type === 'sampler2D')).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'TEXTURE_FALLBACK_USED')).toBe(true);
    const material = scene.materials[0];

    expect(material.textures).toHaveProperty('uMainTex');
    const texProp = material.textures.uMainTex;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id) as spec.SerializedTexture2DImageSource;

    expect(textureDef).toBeDefined();
    expect(textureDef?.dataType).toBe(spec.DataType.Texture);

    const image = scene.images.find(img => img.id === (textureDef?.source as spec.DataPath).id);

    expect(image).toBeDefined();
    expect(image!.url).toMatch(/^data:image\/png;base64,/);
    expect(textureDef?.flipY).toBe(true);
  });

  it('should use custom texture URL from uniformOverrides', () => {
    const customUrl = 'https://example.com/my-texture.png';
    const { scene, diagnostics } = convertShaderToGE(SHADER_WITH_TEXTURE, {
      uniformOverrides: {
        uMainTex: { url: customUrl },
      },
    });

    expect(diagnostics.some(diagnostic => diagnostic.code === 'TEXTURE_FALLBACK_USED')).toBe(false);

    const material = scene.materials[0];
    const texProp = material.textures.uMainTex;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id) as spec.SerializedTexture2DImageSource;
    const image = scene.images.find(img => img.id === (textureDef.source as spec.DataPath).id);

    expect(image!.url).toBe(customUrl);
  });

  it('should respect custom texture parameters (wrapS, wrapT, flipY, etc.)', () => {
    const { scene } = convertShaderToGE(SHADER_WITH_TEXTURE, {
      uniformOverrides: {
        uMainTex: {
          url: 'https://example.com/tex.png',
          wrapS: 33071, // CLAMP_TO_EDGE
          wrapT: 33071,
          magFilter: 9728, // NEAREST
          minFilter: 9728,
          flipY: false,
        },
      },
    });

    const material = scene.materials[0];
    const texProp = material.textures.uMainTex;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id);

    expect(textureDef!.wrapS).toBe(33071);
    expect(textureDef!.wrapT).toBe(33071);
    expect(textureDef!.magFilter).toBe(9728);
    expect(textureDef!.minFilter).toBe(9728);
    expect(textureDef!.flipY).toBe(false);
  });

  it('should handle multiple sampler2D uniforms with independent texture chains', () => {
    const { scene, uniforms } = convertShaderToGE(SHADER_WITH_MULTIPLE_TEXTURES, {
      uniformOverrides: {
        uMainTex: { url: 'https://example.com/main.png' },
        uNormalMap: { url: 'https://example.com/normal.png' },
      },
    });
    const samplerUniforms = uniforms.filter(u => u.type === 'sampler2D');

    expect(samplerUniforms).toHaveLength(3);
    const material = scene.materials[0];

    expect(Object.keys(material.textures)).toHaveLength(3);
    expect(material.textures).toHaveProperty('uMainTex');
    expect(material.textures).toHaveProperty('uNormalMap');
    expect(material.textures).toHaveProperty('uLUT');
    expect(scene.images).toHaveLength(3);
    expect(scene.textures).toHaveLength(3);
    const mainTexDef = scene.textures?.find(
      t => t.id === material.textures.uMainTex.texture.id,
    ) as spec.SerializedTexture2DImageSource;
    const normalTexDef = scene.textures?.find(
      t => t.id === material.textures.uNormalMap.texture.id,
    ) as spec.SerializedTexture2DImageSource;
    const lutTexDef = scene.textures?.find(
      t => t.id === material.textures.uLUT.texture.id,
    ) as spec.SerializedTexture2DImageSource;

    const mainImage = scene.images.find(i => i.id === (mainTexDef.source as spec.DataPath).id);
    const normalImage = scene.images.find(i => i.id === (normalTexDef.source as spec.DataPath).id);
    const lutImage = scene.images.find(i => i.id === (lutTexDef.source as spec.DataPath).id);

    expect(mainImage!.url).toBe('https://example.com/main.png');
    expect(normalImage!.url).toBe('https://example.com/normal.png');
    expect(lutImage!.url).toMatch(/^data:image\/png;base64,/);
    const textureIds = scene.textures?.map(t => t.id);

    expect(new Set(textureIds).size).toBe(3);
    const imageIds = scene.images.map(i => i.id);

    expect(new Set(imageIds).size).toBe(3);
  });

  it('should produce empty textures and images when shader has no sampler2D', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER);

    expect(scene.textures).toHaveLength(0);
    expect(scene.images).toHaveLength(0);
    expect(Object.keys(scene.materials[0].textures)).toHaveLength(0);
  });

  it('should validate texture DataPath references fully resolve', () => {
    const { scene } = convertShaderToGE(SHADER_WITH_TEXTURE);

    const allIds = new Set<string>();

    scene.images.forEach(i => allIds.add(i.id));
    (scene.textures as spec.SerializedTexture2DImageSource[]).forEach(t => allIds.add((t as spec.DataPath).id));
    scene.materials.forEach(m => allIds.add(m.id));
    for (const mat of scene.materials) {
      for (const prop of Object.values(mat.textures)) {
        expect(allIds.has(prop.texture.id)).toBe(true);
        const texDef = scene.textures?.find(t => t.id === prop.texture.id) as spec.SerializedTexture2DImageSource;

        expect(texDef).toBeDefined();
        expect(allIds.has((texDef.source as spec.DataPath).id)).toBe(true);
      }
    }
  });
});

describe('mainImage format iChannel support', () => {
  it('should parse iChannel0 as sampler2D from mainImage shader', () => {
    const { uniforms } = convertShaderToGE(MAINIMAGE_WITH_ICHANNEL);

    const iChannel0 = uniforms.find(u => u.name === 'iChannel0');

    expect(iChannel0).toBeDefined();
    expect(iChannel0!.type).toBe('sampler2D');
  });

  it('should use channelTextures to provide texture for iChannel0', () => {
    const noiseUrl = 'https://example.com/noise.png';
    const { scene, diagnostics } = convertShaderToGE(MAINIMAGE_WITH_ICHANNEL, {
      channelTextures: {
        iChannel0: { url: noiseUrl },
      },
    });

    expect(diagnostics.some(diagnostic => diagnostic.code === 'TEXTURE_FALLBACK_USED')).toBe(false);
    const material = scene.materials[0];

    expect(material.textures).toHaveProperty('iChannel0');

    const texProp = material.textures.iChannel0;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id) as spec.SerializedTexture2DImageSource;
    const image = scene.images.find(img => img.id === (textureDef.source as spec.DataPath).id);

    expect(image!.url).toBe(noiseUrl);
  });

  it('should use default white texture for iChannel without channel mapping', () => {
    const { scene, diagnostics } = convertShaderToGE(MAINIMAGE_WITH_ICHANNEL);

    expect(diagnostics.some(diagnostic => diagnostic.code === 'TEXTURE_FALLBACK_USED')).toBe(true);
    const material = scene.materials[0];

    expect(material.textures).toHaveProperty('iChannel0');

    const texProp = material.textures.iChannel0;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id) as spec.SerializedTexture2DImageSource;
    const image = scene.images.find(img => img.id === (textureDef.source as spec.DataPath).id);

    expect(image!.url).toMatch(/^data:image\/png;base64,/);
  });

  it('should allow uniformOverrides to take precedence over channelTextures', () => {
    const overrideUrl = 'https://example.com/override.png';
    const channelUrl = 'https://example.com/channel.png';
    const { scene } = convertShaderToGE(MAINIMAGE_WITH_ICHANNEL, {
      uniformOverrides: {
        iChannel0: { url: overrideUrl },
      },
      channelTextures: {
        iChannel0: { url: channelUrl },
      },
    });
    const material = scene.materials[0];
    const texProp = material.textures.iChannel0;
    const textureDef = scene.textures?.find(t => t.id === texProp.texture.id) as spec.SerializedTexture2DImageSource;
    const image = scene.images.find(img => img.id === (textureDef.source as spec.DataPath).id);

    expect(image!.url).toBe(overrideUrl);
  });

  it('should bridge mainImage shader correctly with iChannel', () => {
    const { scene, uniforms: _uniforms } = convertShaderToGE(MAINIMAGE_WITH_ICHANNEL, {
      channelTextures: {
        iChannel0: { url: 'https://example.com/tex.png' },
      },
    });

    expect(scene.shaders[0].fragment).toContain('void main()');
    expect(scene.shaders[0].fragment).toContain('mainImage(fragColor, fragCoord)');
    expect(scene.shaders[0].fragment).toContain('#define iTime vTime');
    expect(scene.shaders[0].fragment).toContain('iResolution');
    expect(scene.materials[0].vector4s).toHaveProperty('iResolution');
  });
});

describe('mainImage format with multiple iChannels', () => {
  const MAINIMAGE_MULTI_CHANNEL = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 c0 = texture2D(iChannel0, uv);
  vec4 c1 = texture2D(iChannel1, uv + 0.01);
  fragColor = c0 * c1;
}
`.trim();

  it('should handle multiple iChannel textures', () => {
    const { scene, uniforms } = convertShaderToGE(MAINIMAGE_MULTI_CHANNEL, {
      channelTextures: {
        iChannel0: { url: 'https://example.com/tex0.png' },
        iChannel1: { url: 'https://example.com/tex1.png' },
      },
    });

    expect(uniforms.some(u => u.name === 'iChannel0' && u.type === 'sampler2D')).toBe(true);
    expect(uniforms.some(u => u.name === 'iChannel1' && u.type === 'sampler2D')).toBe(true);

    const material = scene.materials[0];

    expect(Object.keys(material.textures)).toHaveLength(2);
    expect(scene.images).toHaveLength(2);
    expect(scene.textures).toHaveLength(2);
    const tex0Prop = material.textures.iChannel0;
    const tex1Prop = material.textures.iChannel1;

    const tex0Def = scene.textures?.find(t => t.id === tex0Prop.texture.id) as spec.SerializedTexture2DImageSource;
    const tex1Def = scene.textures?.find(t => t.id === tex1Prop.texture.id) as spec.SerializedTexture2DImageSource;

    const img0 = scene.images.find(i => i.id === (tex0Def.source as spec.DataPath).id);
    const img1 = scene.images.find(i => i.id === (tex1Def.source as spec.DataPath).id);

    expect(img0!.url).toBe('https://example.com/tex0.png');
    expect(img1!.url).toBe('https://example.com/tex1.png');
  });
});

const NATIVE_SHADER_WITH_URESIOLUTION = `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uResolution;

void main() {
  vec2 uv = vUV - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  vec3 col = vec3(length(uv));
  gl_FragColor = vec4(col, 1.0);
}
`.trim();

describe('uResolution auto-injection for native shaders', () => {
  it('should auto-inject uResolution from previewSize, ignoring overrides', () => {
    const { scene, uniforms } = convertShaderToGE(NATIVE_SHADER_WITH_URESIOLUTION, {
      previewSize: [1920, 1080],
      uniformOverrides: {
        uResolution: { x: 1280, y: 720, z: 1, w: 0 },
      },
    });
    const material = scene.materials[0];

    expect(material.vector4s.uResolution).toEqual({ x: 1920, y: 1080, z: 1, w: 0 });
    expect(uniforms.some(u => u.name === 'uResolution' && u.type === 'vec4')).toBe(true);
  });

  it('should auto-inject uResolution even when not provided in overrides', () => {
    const { scene } = convertShaderToGE(NATIVE_SHADER_WITH_URESIOLUTION, {
      previewSize: [800, 600],
    });

    const material = scene.materials[0];

    expect(material.vector4s.uResolution).toEqual({ x: 800, y: 600, z: 1, w: 0 });
  });

  it('should inject uResolution from the default previewSize when none is provided', () => {
    const { scene, diagnostics } = convertShaderToGE(NATIVE_SHADER_WITH_URESIOLUTION, {
      uniformOverrides: {
        uResolution: { x: 1280, y: 720, z: 1, w: 0 },
      },
    });
    const material = scene.materials[0];

    expect(material.vector4s.uResolution).toEqual({ x: 512, y: 512, z: 1, w: 0 });
    expect(diagnostics.some(diagnostic => diagnostic.code === 'UNIFORM_OVERRIDE_IGNORED')).toBe(true);
  });

  it('should not affect shaders without uResolution uniform', () => {
    const { scene } = convertShaderToGE(SIMPLE_SHADER, {
      previewSize: [1920, 1080],
    });
    const material = scene.materials[0];

    expect(material.vector4s.uResolution).toBeUndefined();
  });
});

describe('PR2 validation and diagnostics', () => {
  it('should map int uniforms to material.ints', () => {
    const { scene, diagnostics } = convertShaderToGE(`
      precision highp float;
      uniform int uSteps;
      void main() { gl_FragColor = vec4(float(uSteps) / 10.0); }
    `, {
      uniformOverrides: { uSteps: 4 },
    });

    expect(scene.materials[0].ints.uSteps).toBe(4);
    expect(scene.materials[0].floats.uSteps).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('should diagnose vec2 and vec3 without writing incompatible vector4 values', () => {
    const { scene, diagnostics } = convertShaderToGE(`
      precision highp float;
      uniform vec2 uOffset;
      uniform vec3 uTint;
      void main() { gl_FragColor = vec4(uTint + vec3(uOffset, 0.0), 1.0); }
    `);

    expect(scene.materials[0].vector4s.uOffset).toBeUndefined();
    expect(scene.materials[0].vector4s.uTint).toBeUndefined();
    expect(diagnostics.filter(diagnostic => diagnostic.code === 'UNIFORM_VECTOR_SIZE_UNSUPPORTED')).toHaveLength(2);
  });

  it('should diagnose unsupported declarations instead of silently dropping them', () => {
    const { diagnostics } = convertShaderToGE(`
      precision highp float;
      uniform mat4 uTransform;
      uniform float uWeights[4];
      uniform samplerCube uEnvironment;
      void main() { gl_FragColor = vec4(1.0); }
    `);

    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'UNIFORM_TYPE_UNSUPPORTED',
      'UNIFORM_ARRAY_UNSUPPORTED',
      'UNIFORM_TYPE_UNSUPPORTED',
    ]);
  });

  it('should normalize invalid options and keep generated numbers finite', () => {
    const invalidOptions = {
      duration: Number.NaN,
      previewSize: [0, Number.POSITIVE_INFINITY],
      endBehavior: 999,
    } as unknown as Parameters<typeof convertShaderToGE>[1];
    const { scene, diagnostics } = convertShaderToGE(SIMPLE_SHADER, invalidOptions);

    expect(scene.compositions[0].duration).toBe(5);
    expect(scene.compositions[0].previewSize).toEqual([512, 512]);
    expect(scene.compositions[0].endBehavior).toBe(spec.EndBehavior.restart);
    expect(scene.items[0].transform?.scale).toEqual({ x: expect.any(Number), y: expect.any(Number), z: 1 });
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'OPTION_DURATION_INVALID',
      'OPTION_PREVIEW_SIZE_INVALID',
      'OPTION_END_BEHAVIOR_INVALID',
    ]);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'SCENE_VALUE_NON_FINITE')).toBe(false);
  });

  it('should reject invalid overrides, texture inputs, and channel names', () => {
    const options = {
      uniformOverrides: {
        uColor: 1,
        uUnknown: 2,
      },
      channelTextures: {
        iChannel4: { url: '' },
      },
    } as unknown as Parameters<typeof convertShaderToGE>[1];
    const { diagnostics } = convertShaderToGE(SIMPLE_SHADER, options);

    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'UNIFORM_OVERRIDE_INVALID',
      'UNIFORM_OVERRIDE_UNKNOWN',
      'CHANNEL_NAME_INVALID',
    ]);
  });

  it('should expose stable diagnostic fields', () => {
    const { diagnostics } = convertShaderToGE('uniform vec2 uOffset;');

    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(typeof diagnostic.code).toBe('string');
      expect(['warning', 'error']).toContain(diagnostic.severity);
      expect(typeof diagnostic.message).toBe('string');
      expect(diagnostic.message.length).toBeGreaterThan(0);
    }
  });

  it('should report iChannel names outside the supported range', () => {
    const { diagnostics } = convertShaderToGE(`
      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = texture2D(iChannel4, fragCoord / iResolution.xy);
      }
    `);

    expect(diagnostics.some(diagnostic => diagnostic.code === 'CHANNEL_NAME_INVALID')).toBe(true);
  });
});

describe('representative rendering scenarios', () => {
  it('should keep native shader, mainImage texture, and 16:9 resolution scenes valid', () => {
    const scenes = [
      convertShaderToGE(SIMPLE_SHADER).scene,
      convertShaderToGE(MAINIMAGE_WITH_ICHANNEL, {
        channelTextures: {
          iChannel0: {
            url: TEST_TEXTURE_DATA_URL,
          },
        },
      }).scene,
      convertShaderToGE(NATIVE_SHADER_WITH_URESIOLUTION, { previewSize: [1280, 720] }).scene,
    ];

    for (const scene of scenes) {
      expect(JSON.parse(JSON.stringify(scene))).toStrictEqual(scene);
      expect(scene.compositionId).toBe(scene.compositions[0].id);
    }
    expect(scenes[2].materials[0].vector4s.uResolution).toEqual({ x: 1280, y: 720, z: 1, w: 0 });
  });
});
