import * as spec from '@galacean/effects-specification';
import type { ParsedUniform, UniformValue } from '../conversion-types';
import type { NormalizedConversionOptions } from '../converter/normalize-conversion-options';
import { mapUniformsToMaterial } from '../converter/map-material-uniforms';
import { mapPreviewSizeToResolution } from '../converter/map-resolution-uniform';
import { buildQuadGeometry } from './build-quad-geometry';
import { buildTimeline } from './build-timeline';
import { generateId } from './generate-id';
import { FULLSCREEN_VERTEX_SHADER } from './shader-templates';

const CAMERA_FOV = 60;
const CAMERA_POSITION_Z = 8;
const HALF_FOV_RAD = ((CAMERA_FOV / 2) * Math.PI) / 180;
const VISIBLE_HALF_WIDTH = CAMERA_POSITION_Z * Math.tan(HALF_FOV_RAD);

/** Compute the item scale for GE's horizontal-FOV portrait projection. */
function computeFillScale(previewSize: [number, number]): { x: number; y: number; z: number } {
  const aspect = previewSize[0] / previewSize[1];
  const halfWidth = VISIBLE_HALF_WIDTH;
  const halfHeight = halfWidth / aspect;

  return { x: halfWidth, y: halfHeight, z: 1 };
}

export function assembleGEScene(
  fragmentShader: string,
  uniforms: ParsedUniform[],
  options: NormalizedConversionOptions & { uniformOverrides: Record<string, UniformValue> },
  usesMainImage = false,
): spec.JSONScene {
  const { sceneName, duration, endBehavior, previewSize, uniformOverrides } = options;

  const fillScale = computeFillScale(previewSize);

  const shaderId = generateId();
  const materialId = generateId();
  const geometryId = generateId();
  const effectComponentId = generateId();
  const compositionComponentId = generateId();
  const itemId = generateId();
  const compositionId = generateId();

  const shader: spec.ShaderData = {
    id: shaderId,
    name: `${sceneName}_Shader`,
    dataType: spec.DataType.Shader,
    vertex: FULLSCREEN_VERTEX_SHADER,
    fragment: fragmentShader,
  };

  const {
    ints,
    floats,
    vector4s,
    colors,
    materialTextures,
    images: textureImages,
    textures: sceneTextures,
  } = mapUniformsToMaterial(uniforms, uniformOverrides);

  if (usesMainImage) {
    vector4s.iResolution = mapPreviewSizeToResolution(previewSize);
  }

  const material: spec.MaterialData = {
    id: materialId,
    name: `${sceneName}_Material`,
    dataType: spec.DataType.Material,
    shader: { id: shaderId },
    stringTags: { RenderType: 'Transparent' },
    macros: [],
    ints,
    floats,
    vector4s,
    colors,
    textures: materialTextures,
  };

  const geometry = buildQuadGeometry(geometryId);

  const effectComponent: spec.EffectComponentData = {
    id: effectComponentId,
    name: `${sceneName}_Effect`,
    dataType: spec.DataType.EffectComponent,
    item: { id: itemId },
    _priority: 0,
    materials: [{ id: materialId }],
    geometry: { id: geometryId },
  };

  const item: spec.VFXItemData = {
    id: itemId,
    name: sceneName,
    duration,
    type: spec.ItemType.effect,
    endBehavior,
    components: [{ id: effectComponentId }],
    dataType: spec.DataType.VFXItemData,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      eulerHint: { x: 0, y: 0, z: 0 },
      scale: { x: fillScale.x, y: fillScale.y, z: 1 },
    },
    // Required by the current GE schema despite being deprecated.
    content: null,
  };

  const timeline = buildTimeline(duration, endBehavior);

  const compositionComponent: spec.CompositionComponentData = {
    id: compositionComponentId,
    name: `${sceneName}_CompComp`,
    dataType: spec.DataType.CompositionComponent,
    item: { id: compositionId },
    items: [{ id: itemId }],
    timelineAsset: { id: timeline.timelineAssetId },
    sceneBindings: [
      {
        key: { id: timeline.objectBindingTrackId },
        value: { id: itemId },
      },
    ],
  };

  const composition: spec.CompositionData = {
    id: compositionId,
    name: sceneName,
    duration,
    startTime: 0,
    endBehavior,
    previewSize,
    camera: {
      fov: CAMERA_FOV,
      far: 40,
      near: 0.1,
      clipMode: spec.CameraClipMode.portrait,
      position: [0, 0, CAMERA_POSITION_Z],
      rotation: [0, 0, 0],
    },
    components: [{ id: compositionComponentId }],
    children: [{ id: itemId }],
  };

  return {
    version: spec.JSONSceneVersion.LATEST,
    playerVersion: { web: '2.9.0', native: '0.0.1.202311221223' },
    type: 'ge',
    compositionId,
    compositions: [composition],
    images: textureImages,
    plugins: [],
    items: [item],
    components: [effectComponent, compositionComponent],
    materials: [material],
    shaders: [shader],
    geometries: [geometry],
    animations: [],
    miscs: timeline.miscs,
    textures: sceneTextures,
  };
}
