import * as spec from '@galacean/effects-specification';
import type { ParsedUniform, TextureInput, UniformValue } from '../conversion-types';
import {
  DEFAULT_WHITE_TEXTURE_URL,
  GL_TEXTURE_2D,
  GL_TEXTURE_FILTER_LINEAR,
  GL_TEXTURE_WRAP_REPEAT,
} from '../generator/texture-constants';
import { generateId } from '../generator/generate-id';
import { isColorInput, isTextureInput, isVector4Input } from './resolve-uniform-overrides';
import { setRecordValue } from './set-record-value';

export interface MaterialUniformMapping {
  ints: Record<string, number>;
  floats: Record<string, number>;
  vector4s: Record<string, spec.Vector4Data>;
  colors: Record<string, spec.ColorData>;
  materialTextures: Record<string, spec.MaterialTextureProperty>;
  images: spec.ImageSource[];
  textures: spec.TextureDefine[];
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toTextureDefine(textureInput: TextureInput | null): {
  image: spec.ImageSource;
  texture: spec.TextureDefine;
  textureId: string;
} {
  const imageId = generateId();
  const textureId = generateId();

  const image: spec.ImageSource = {
    id: imageId,
    url: textureInput?.url ?? DEFAULT_WHITE_TEXTURE_URL,
  };

  const texture: spec.TextureDefine = {
    id: textureId,
    source: { id: imageId },
    dataType: spec.DataType.Texture,
    target: GL_TEXTURE_2D,
    wrapS: textureInput?.wrapS ?? GL_TEXTURE_WRAP_REPEAT,
    wrapT: textureInput?.wrapT ?? GL_TEXTURE_WRAP_REPEAT,
    magFilter: textureInput?.magFilter ?? GL_TEXTURE_FILTER_LINEAR,
    minFilter: textureInput?.minFilter ?? GL_TEXTURE_FILTER_LINEAR,
    flipY: textureInput?.flipY ?? true,
  };

  return { image, texture, textureId };
}

function applyVector4Default(
  target: Record<string, spec.Vector4Data>,
  uniformName: string,
  override: unknown,
): void {
  if (!isVector4Input(override)) {
    setRecordValue(target, uniformName, { x: 0, y: 0, z: 0, w: 1 });

    return;
  }

  setRecordValue(target, uniformName, override);
}

export function mapUniformsToMaterial(
  uniforms: ParsedUniform[],
  overrides: Record<string, UniformValue> = {},
): MaterialUniformMapping {
  const ints: Record<string, number> = {};
  const floats: Record<string, number> = {};
  const vector4s: Record<string, spec.Vector4Data> = {};
  const colors: Record<string, spec.ColorData> = {};
  const materialTextures: Record<string, spec.MaterialTextureProperty> = {};
  const images: spec.ImageSource[] = [];
  const textures: spec.TextureDefine[] = [];

  for (const uniform of uniforms) {
    const override = overrides[uniform.name];

    switch (uniform.type) {
      case 'float':
        setRecordValue(floats, uniform.name, toNumber(override));

        break;
      case 'int':
        setRecordValue(ints, uniform.name, toNumber(override));

        break;
      case 'vec2':
      case 'vec3':
        break;
      case 'vec4':
        if (isColorInput(override)) {
          setRecordValue(colors, uniform.name, override);
        } else {
          applyVector4Default(vector4s, uniform.name, override);
        }

        break;
      case 'sampler2D': {
        const textureInput = isTextureInput(override) ? override : null;
        const { image, texture, textureId } = toTextureDefine(textureInput);

        images.push(image);
        textures.push(texture);
        setRecordValue(materialTextures, uniform.name, { texture: { id: textureId } });

        break;
      }
    }
  }

  return { ints, floats, vector4s, colors, materialTextures, images, textures };
}
