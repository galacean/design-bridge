// Compile-only assertions for the public TypeScript contract.
import {
  IREndBehavior, IRTextureScaleMode, type IRAnimatedProperty, type IRAsset,
  IRAssetType, IRPropertyType, IRParticleExpressionType,
  type IRComposition, type IRScene, type IRGradientPaint,
  type IRKeyframe, type IRLayer, type IRLayerMatte,
  type IRMask,
  type IRShape, type IRShapeStroke, type IRTextContent, type IRTexturePaint, type IRLayerTime,
  type IRParticleBurst, type IRParticleLayer, type IRParticleScalarExpression, type IRVec3,
} from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { assertIRScene, validateIRScene } from '@galacean/animation-ir/validator';

const validCompositionId: IRComposition['id'] = 'composition';
const validAssetId = 'image:hero';
const validUrlImageAsset: IRAsset = {
  id: validAssetId,
  type: IRAssetType.Image,
  source: { kind: 'url', url: 'https://example.com/hero.png' },
};
const validEmbeddedImageAsset: IRAsset = {
  id: 'image:embedded',
  type: 'image',
  source: { kind: 'embedded', mimeType: 'image/png', data: 'AQID' },
};
const invalidUrlSourceMetadata: IRAsset = {
  ...validUrlImageAsset,
  // @ts-expect-error URL resources only carry their resolved URL.
  source: { kind: 'url', url: 'https://example.com/hero.png', mimeType: 'image/png' },
};
const invalidEmbeddedEncoding: IRAsset = {
  ...validEmbeddedImageAsset,
  // @ts-expect-error Embedded data is always canonical Base64, so encoding is implicit.
  source: { kind: 'embedded', mimeType: 'image/png', encoding: 'base64', data: 'AQID' },
};
const invalidImagePixelMetadata: IRAsset = {
  ...validUrlImageAsset,
  // @ts-expect-error Display dimensions belong to Layer.localBounds, not Image Asset metadata.
  pixelWidth: 100,
};
const validSystemFontAsset: IRAsset = {
  id: 'font:system-body',
  type: IRAssetType.Font,
  family: 'PingFang SC',
  style: 'normal',
  weight: 400,
  source: { kind: 'system' },
};
const validComposition: IRComposition = {
  id: validCompositionId,
  name: 'composition',
  width: 1,
  height: 1,
  frameRate: 30,
  inPoint: 0.5,
  outPoint: 1.5,
  endBehavior: IREndBehavior.Loop,
  layers: [],
};
const validContinueEndBehavior: IRComposition['endBehavior'] = IREndBehavior.Continue;
// @ts-expect-error restart is target-specific; normalized playback uses loop.
const invalidRestartEndBehavior: IRComposition['endBehavior'] = 'restart';
// @ts-expect-error forward is target-specific; normalized playback uses continue.
const invalidForwardEndBehavior: IRComposition['endBehavior'] = 'forward';
const validDocument: IRScene = {
  format: 'animation-ir',
  schemaVersion: '1.0.0',
  entryCompositionId: 'composition',
  compositions: [validComposition],
  assets: [validUrlImageAsset, validEmbeddedImageAsset, validSystemFontAsset],
};
// @ts-expect-error Every IRScene requires an Asset Registry, even when it is empty.
const invalidMissingAssets: IRScene = {
  format: 'animation-ir',
  schemaVersion: '1.0.0',
  entryCompositionId: 'composition',
  compositions: [validComposition],
};
const validDiagnostic: ConversionDiagnostic = {
  code: 'POSITION_NORMALIZED',
  severity: 'info',
  action: 'normalized',
  path: '$.compositions[0].layers[0].transform.position',
  sourceId: 'layer',
  feature: 'position',
  message: 'Position was normalized.',
};
const invalidErrorDiagnostic: ConversionDiagnostic = {
  ...validDiagnostic,
  // @ts-expect-error Fatal conversion failures throw; diagnostics are non-fatal observations.
  severity: 'error',
};

validateIRScene(validDocument);
// @ts-expect-error Runtime validation accepts only the current contract.
validateIRScene(validDocument, { mode: 'compatible' });
const unknownScene: unknown = validDocument;

assertIRScene(unknownScene);
const narrowedScene: IRScene = unknownScene;
const validUnnamedComposition: IRComposition = { ...validComposition, name: undefined };
const validUnnamedLayer: IRLayer = {
  id: 'unnamed-layer',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const validPrecompLayer: IRLayer = {
  id: 'precomp',
  type: 'precomp',
  time: { inFrame: 0.5, outFrame: 30.5, sourceStartFrame: 12, stretch: 2 },
  visible: true,
  content: { compositionId: 'child-composition', clipToBounds: true, endBehavior: IREndBehavior.Freeze },
};
const validMask: IRMask = {
  mode: 'intersect',
  inverted: true,
  path: { points: [{ x: 0, y: 0 }], inTangents: [{ x: 0, y: 0 }], outTangents: [{ x: 0, y: 0 }], closed: true },
};
const invalidMaskMode: IRMask = {
  ...validMask,
  // @ts-expect-error Mask mode must be a supported composition operation.
  mode: 'exclude',
};
const validLayerMatte: IRLayerMatte = {
  sourceLayerId: 'matte-source',
  mode: 'alpha',
  inverted: true,
};
const invalidLayerMatteMode: IRLayerMatte = {
  sourceLayerId: 'matte-source',
  // @ts-expect-error Layer matte mode must be geometry, alpha, or luminance.
  mode: 'red',
};
const invalidUnknownLayer: IRLayer = {
  id: 'unknown',
  // @ts-expect-error Unknown source layers are omitted with diagnostics, not represented in core IR.
  type: 'unknown',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const invalidNonPrecompStretch: IRLayer = {
  id: 'null-with-stretch',
  type: 'null',
  // @ts-expect-error stretch is owned only by Precomp instance time.
  time: { inFrame: 0, outFrame: 1, stretch: 2 },
  visible: true,
};
const invalidNonPrecompSourceStart: IRLayer = {
  id: 'null-with-source-start',
  type: 'null',
  // @ts-expect-error sourceStartFrame is owned only by Precomp instance time.
  time: { inFrame: 0, outFrame: 1, sourceStartFrame: 2 },
  visible: true,
};
const invalidLegacyPrecompOffset: IRLayer = {
  id: 'precomp-with-offset',
  type: 'precomp',
  // @ts-expect-error sourceStartFrame is the only Precomp source offset field.
  time: { inFrame: 0, outFrame: 1, offsetFrame: 2 },
  visible: true,
  content: { compositionId: 'child-composition', clipToBounds: true },
};
// @ts-expect-error IRScene is the Animation IR root.
const invalidBareCompositionRoot: IRScene = {} as IRComposition;
const invalidLegacyLayerTime: IRLayerTime = {
  // @ts-expect-error Layer entry time is named inFrame, not startFrame.
  startFrame: 0,
  outFrame: 1,
};
const invalidLegacyLayerEndTime: IRLayerTime = {
  inFrame: 0,
  // @ts-expect-error Layer exit time is named outFrame, not endFrame.
  endFrame: 1,
};
const validStatic: IRAnimatedProperty<number> = { type: IRPropertyType.Static, value: 1 };
const validKeyframed: IRAnimatedProperty<number> = {
  type: IRPropertyType.Keyframed,
  keyframes: [{ frame: 29.5, value: 1 }],
};
// @ts-expect-error Animated properties use the type discriminator.
const _invalidLegacyProperty: IRAnimatedProperty<number> = { keyframed: false, value: 1 };
const validBoundsLayer: IRLayer = {
  id: 'bounds',
  name: 'bounds',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  localBounds: { x: 0, y: 0, width: 100, height: 50 },
};
const validParticleExpression: IRParticleScalarExpression = {
  type: IRParticleExpressionType.RandomBetweenConstants,
  min: 1,
  max: 2,
};
const validParticleBurst: IRParticleBurst = {
  frameOffset: 0,
  count: 10,
  cycleCount: 'infinite',
  repeatIntervalFrames: 15,
};
// @ts-expect-error Burst cycle defaults must be explicit in normalized IR.
const _invalidParticleBurstDefaults: IRParticleBurst = { frameOffset: 0, count: 10 };
const validParticleLayer: IRParticleLayer = {
  id: 'particle',
  type: 'particle',
  time: { inFrame: 0, outFrame: 30 },
  visible: true,
  localBounds: { x: 0, y: 0, width: 100, height: 100 },
  content: {
    maxParticles: 50,
    startLifetime: validParticleExpression,
    emission: { rateOverTime: { type: 'constant', value: 10 }, bursts: [validParticleBurst] },
  },
};
// @ts-expect-error Every composition requires a stable string identity.
const invalidMissingCompositionId: IRComposition = {
  name: 'missing-id',
  width: 1,
  height: 1,
  frameRate: 30,
  inPoint: 0,
  outPoint: 1,
  endBehavior: IREndBehavior.Loop,
  layers: [],
};
const invalidLegacyCompositionSource: IRComposition = {
  ...validComposition,
  // @ts-expect-error Source provenance belongs to Adapter results, not the normalized Composition.
  source: 'lottie',
};
const invalidCompositionSourceFormat: IRComposition = {
  ...validComposition,
  // @ts-expect-error Source format belongs to Adapter-owned diagnostics or preserved data.
  sourceFormat: 'lottie',
};
const invalidMissingEndBehavior: IRComposition = {
  ...validComposition,
  // @ts-expect-error Every composition explicitly declares its playback end behavior.
  endBehavior: undefined,
};
// @ts-expect-error Every layer requires a stable string identity.
const invalidMissingLayerId: IRLayer = {
  name: 'missing-id',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const invalidLegacyLayerReference: IRLayer = {
  id: 'legacy-parent-reference',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  // @ts-expect-error Parent references use parentId directly.
  parent: { layerId: 'parent-layer' },
};
const invalidLegacyLayerIndex: IRLayer = {
  id: 'legacy-index',
  // @ts-expect-error Layer identity is carried by id, not a numeric index.
  index: 0,
  name: 'legacy-index',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const invalidAnimatedAnchor: IRLayer = {
  id: 'animated-anchor',
  name: 'animated-anchor',
  type: 'null',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  transform: {
    // @ts-expect-error Anchor is intentionally static-only in normalized IR.
    anchor: { type: 'keyframed', keyframes: [{ frame: 0, value: [0, 0, 0] }] },
  },
};
const invalidShapeSize: IRShape = {
  primitiveType: 'rectangle',
  width: 10,
  height: 10,
  fills: [],
  strokes: [],
  position: [0, 0],
  // @ts-expect-error Shape dimensions are carried by primitive-specific fields.
  size: [10, 10],
};
const validShapeStroke: IRShapeStroke = {
  paint: { type: 'solid', color: [1, 0, 0, 1] },
  width: 2,
  cap: 'round',
  join: 'bevel',
};
// @ts-expect-error Every stroke owns its width, cap, and join.
const invalidShapeStroke: IRShapeStroke = { paint: { type: 'solid', color: [1, 0, 0, 1] } };
const invalidSharedStrokeStyle: IRShape = {
  primitiveType: 'rectangle',
  width: 10,
  height: 10,
  fills: [],
  strokes: [validShapeStroke],
  position: [0, 0],
  // @ts-expect-error Stroke geometry belongs to each IRShapeStroke.
  strokeWidth: 2,
};
const invalidRectangleRoundness: IRShape = {
  primitiveType: 'rectangle',
  width: 10,
  height: 10,
  fills: [],
  strokes: [],
  position: [0, 0],
  // @ts-expect-error Rectangle corners use local-pixel cornerRadius.
  roundness: 10,
};
// @ts-expect-error Rectangle geometry requires both width and height.
const invalidRectangleGeometry: IRShape = {
  primitiveType: 'rectangle',
  fills: [],
  strokes: [],
  position: [0, 0],
};
const invalidGradientColor: IRGradientPaint = {
  type: 'linear-gradient',
  gradientStops: [[0, 1, 1, 1, 1]],
  gradientStart: [0, 0],
  gradientEnd: [1, 0],
  // @ts-expect-error Gradient color is fully represented by gradientStops.
  color: [1, 1, 1, 1],
};
// @ts-expect-error Every gradient requires both spatial endpoints.
const _invalidGradientWithoutStart: IRGradientPaint = {
  type: 'radial-gradient',
  gradientStops: [[0, 1, 1, 1, 1]],
  gradientEnd: [1, 0],
};
// @ts-expect-error Every gradient requires both spatial endpoints.
const _invalidGradientWithoutEnd: IRGradientPaint = {
  type: 'angular-gradient',
  gradientStops: [[0, 1, 1, 1, 1]],
  gradientStart: [0, 0],
};
const invalidTextureScaleMode: IRShape = {
  primitiveType: 'rectangle',
  width: 10,
  height: 10,
  fills: [
    {
      type: 'texture',
      assetId: 'image:texture',
      // @ts-expect-error Texture scale mode uses source-neutral semantic values.
      scaleMode: 3,
    },
  ],
  strokes: [],
  position: [0, 0],
};
const validTextureScaleMode: IRTexturePaint = {
  type: 'texture',
  assetId: 'image:texture',
  scaleMode: IRTextureScaleMode.Tile,
};
const invalidLegacyTexturePaint: IRTexturePaint = {
  type: 'texture',
  assetId: 'image:texture',
  // @ts-expect-error Texture paint references an Image Asset by assetId.
  texture: { url: 'texture.png' },
};
// @ts-expect-error Static properties require a value.
const invalidStatic: IRAnimatedProperty<number> = { type: 'static' };

// @ts-expect-error Keyframed properties require keyframes.
const invalidKeyframed: IRAnimatedProperty<number> = { type: 'keyframed' };

const invalidSpatialTangent: IRKeyframe<IRVec3> = {
  frame: 0,
  value: [0, 0, 0],
  // @ts-expect-error Spatial tangents are fixed 2D or 3D tuples.
  spatialOut: [0],
};

const validImage: IRLayer = {
  id: 'image',
  type: 'image',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  content: { assetId: validAssetId },
  localBounds: { x: 0, y: 0, width: 100, height: 100 },
};
// @ts-expect-error Image layers require content with a registry Asset ID.
const invalidImage: IRLayer = {
  id: 'image',
  name: 'image',
  type: 'image',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  localBounds: { x: 0, y: 0, width: 100, height: 100 },
};
// @ts-expect-error Image layers require explicit display bounds.
const invalidImageBounds: IRLayer = {
  id: 'image-without-bounds',
  type: 'image',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  content: { assetId: validAssetId },
};
const invalidLegacyImageAsset: IRLayer = {
  ...validImage,
  // @ts-expect-error Image resources live in IRScene.assets, not inline on the Layer.
  asset: { url: 'https://example.com/hero.png' },
};

const validText: IRLayer = {
  id: 'text',
  type: 'text',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  localBounds: { x: 0, y: 0, width: 100, height: 24 },
  content: {
    color: [1, 1, 1, 1],
    text: 'hello',
    fontAssetId: validSystemFontAsset.id,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 14,
    textAlign: 'left',
  },
};

type LegacyTextField =
  'content' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'autoWidth' | 'width' | 'height' | 'anchorAdjust';
const textHasNoLegacyFields: Extract<keyof IRTextContent, LegacyTextField> extends never ? true : false = true;
// @ts-expect-error Text content requires a Font Asset reference.
const _invalidTextWithoutFontAsset: IRTextContent = {
  color: [1, 1, 1, 1],
  text: 'hello',
  fontSize: 12,
  letterSpacing: 0,
  lineHeight: 14,
  textAlign: 'left',
};
// @ts-expect-error Text lineHeight is explicit and required.
const _invalidTextWithoutLineHeight: IRTextContent = {
  color: [1, 1, 1, 1],
  text: 'hello',
  fontAssetId: validSystemFontAsset.id,
  fontSize: 12,
  letterSpacing: 0,
  textAlign: 'left',
};
// @ts-expect-error Text layers require content.
const invalidText: IRLayer = {
  id: 'text',
  name: 'text',
  type: 'text',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const invalidLegacyText: IRLayer = {
  ...validText,
  // @ts-expect-error Text payload lives in content, not on the Layer base.
  text: validText.content,
};

const validSolid: IRLayer = {
  id: 'solid',
  type: 'solid',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  content: { color: [1, 0, 0, 1] },
  localBounds: { x: 0, y: 0, width: 100, height: 100 },
};
// @ts-expect-error Solid layers require content with a color payload.
const invalidSolid: IRLayer = {
  id: 'solid',
  name: 'solid',
  type: 'solid',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  localBounds: { x: 0, y: 0, width: 100, height: 100 },
};
// @ts-expect-error Solid layers require explicit display bounds.
const invalidSolidBounds: IRLayer = {
  id: 'solid-without-bounds',
  type: 'solid',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  content: { color: [1, 0, 0, 1] },
};
const invalidLegacySolidColor: IRLayer = {
  ...validSolid,
  // @ts-expect-error Solid color lives in content.color, not on the Layer base.
  solidColor: [1, 0, 0, 1],
};

const validShape: IRLayer = {
  id: 'shape',
  name: 'shape',
  type: 'shape',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
  content: {
    shapes: [{
      primitiveType: 'rectangle', width: 10, height: 10, fills: [], strokes: [], position: [0, 0],
    }],
  },
};
// @ts-expect-error Shape layers require a content payload.
const invalidShape: IRLayer = {
  id: 'shape',
  name: 'shape',
  type: 'shape',
  time: { inFrame: 0, outFrame: 1 },
  visible: true,
};
const invalidLegacyShape: IRLayer = {
  ...validShape,
  // @ts-expect-error Shape payload lives in content.shapes, not on the Layer base.
  shapes: validShape.content.shapes,
};

void [
  validCompositionId,
  validComposition,
  validContinueEndBehavior,
  invalidRestartEndBehavior,
  invalidForwardEndBehavior,
  validDocument,
  narrowedScene,
  invalidMissingAssets,
  validDiagnostic,
  invalidUrlSourceMetadata,
  invalidEmbeddedEncoding,
  invalidImagePixelMetadata,
  invalidErrorDiagnostic,
  invalidCompositionSourceFormat,
  validUnnamedComposition,
  validUnnamedLayer,
  validPrecompLayer,
  validMask,
  invalidMaskMode,
  validLayerMatte,
  invalidLayerMatteMode,
  invalidUnknownLayer,
  invalidNonPrecompStretch,
  invalidNonPrecompSourceStart,
  invalidLegacyPrecompOffset,
  invalidBareCompositionRoot,
  invalidLegacyLayerTime,
  invalidLegacyLayerEndTime,
  validStatic,
  validKeyframed,
  validBoundsLayer,
  validParticleExpression,
  validParticleLayer,
  invalidMissingCompositionId,
  invalidLegacyCompositionSource,
  invalidMissingEndBehavior,
  invalidMissingLayerId,
  invalidLegacyLayerReference,
  invalidLegacyLayerIndex,
  invalidStatic,
  invalidKeyframed,
  invalidImage,
  invalidImageBounds,
  validImage,
  invalidLegacyImageAsset,
  validText,
  textHasNoLegacyFields,
  invalidText,
  invalidLegacyText,
  validSolid,
  invalidSolid,
  invalidSolidBounds,
  invalidLegacySolidColor,
  validShape,
  invalidShape,
  invalidLegacyShape,
  invalidSpatialTangent,
  invalidAnimatedAnchor,
  invalidShapeSize,
  validShapeStroke,
  invalidShapeStroke,
  invalidSharedStrokeStyle,
  invalidRectangleRoundness,
  invalidGradientColor,
  validTextureScaleMode,
  invalidTextureScaleMode,
  invalidLegacyTexturePaint,
  invalidRectangleGeometry,
];
