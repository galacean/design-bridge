import { describe, expect, it } from 'vitest';

import * as animationIR from '@galacean/animation-ir';
import {
  ANIMATION_IR_SCHEMA_VERSION, IRBlendMode, IREndBehavior, IRPaintType, IRLayerType,
  IRLineCap, IRLineJoin, IRShapePrimitiveType, IRAssetSourceKind, IRAssetType,
  IRPropertyType, IRParticleExpressionType,
} from '@galacean/animation-ir';
import { createIRScene, getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import * as validation from '@galacean/animation-ir/validator';

describe('public export smoke test', () => {
  it('exports public enum objects with exact values', () => {
    expect(ANIMATION_IR_SCHEMA_VERSION).toBe('1.0.0');
    expect(IRAssetType).toEqual({ Image: 'image', Font: 'font' });
    expect(IRPropertyType).toEqual({ Static: 'static', Keyframed: 'keyframed' });
    expect(IRParticleExpressionType).toEqual({
      Constant: 'constant',
      RandomBetweenConstants: 'randomBetweenConstants',
      Curve: 'curve',
    });
    expect(IRAssetSourceKind).toEqual({
      Url: 'url',
      Embedded: 'embedded',
      System: 'system',
    });
    expect(IREndBehavior).toEqual({
      Destroy: 'destroy',
      Loop: 'loop',
      Continue: 'continue',
      Freeze: 'freeze',
    });
    expect(IRLayerType).toEqual({
      Precomp: 'precomp',
      Solid: 'solid',
      Image: 'image',
      Null: 'null',
      Shape: 'shape',
      Text: 'text',
      Particle: 'particle',
    });
    expect(IRPaintType).toEqual({
      Solid: 'solid',
      LinearGradient: 'linear-gradient',
      RadialGradient: 'radial-gradient',
      AngularGradient: 'angular-gradient',
      Texture: 'texture',
    });
    expect(IRLineCap).toEqual({
      Butt: 'butt',
      Round: 'round',
      Square: 'square',
    });
    expect(IRLineJoin).toEqual({
      Miter: 'miter',
      Round: 'round',
      Bevel: 'bevel',
    });
    expect(IRShapePrimitiveType).toEqual({
      Custom: 'custom',
      Rectangle: 'rectangle',
      Ellipse: 'ellipse',
      Polygon: 'polygon',
      Star: 'star',
    });
    expect(IRBlendMode).toEqual({
      Normal: 'normal',
      Multiply: 'multiply',
      Screen: 'screen',
      Overlay: 'overlay',
      Darken: 'darken',
      Lighten: 'lighten',
      ColorDodge: 'color-dodge',
      ColorBurn: 'color-burn',
      HardLight: 'hard-light',
      SoftLight: 'soft-light',
      Difference: 'difference',
      Exclusion: 'exclusion',
      Hue: 'hue',
      Saturation: 'saturation',
      Color: 'color',
      Luminosity: 'luminosity',
      Add: 'add',
    });
  });

  it('exports validator APIs only from the validator entry', () => {
    expect(validation).toMatchObject({
      assertIRScene: expect.any(Function),
      IRValidationError: expect.any(Function),
      isIRId: expect.any(Function),
      validateIRScene: expect.any(Function),
    });
    expect(Object.keys(validation).filter(name => name in animationIR)).toEqual([]);
  });

  it('keeps adapter utilities off the schema root entry', () => {
    expect('createIRScene' in animationIR).toBe(false);
  });

  it('exports Scene helpers from the adapter entry', () => {
    const composition = {
      id: 'root',
      name: 'root',
      width: 1,
      height: 1,
      frameRate: 30,
      inPoint: 0,
      outPoint: 1,
      endBehavior: IREndBehavior.Loop,
      layers: [],
    };
    const document = createIRScene(composition);

    expect(document).toMatchObject({
      format: 'animation-ir',
      schemaVersion: '1.0.0',
      entryCompositionId: 'root',
      assets: [],
    });
    expect(getIRSceneEntryComposition(document)).toBe(composition);
  });
});
