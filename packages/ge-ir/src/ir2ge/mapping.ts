import { IRBlendMode, IREndBehavior, type IRLayerType } from '@galacean/animation-ir';
import { BlendingMode, EndBehavior, ItemType } from '@galacean/effects-specification';

/** Value-level mappings used by the IR-to-GE conversion pipeline. */
const GE_BLENDING_BY_IR_MODE: Record<IRBlendMode, BlendingMode | undefined> = {
  [IRBlendMode.Normal]: undefined,
  [IRBlendMode.Multiply]: BlendingMode.MULTIPLY,
  [IRBlendMode.Screen]: undefined,
  [IRBlendMode.Overlay]: BlendingMode.SUPERPOSITION,
  [IRBlendMode.Darken]: undefined,
  [IRBlendMode.Lighten]: BlendingMode.BRIGHTNESS,
  [IRBlendMode.ColorDodge]: undefined,
  [IRBlendMode.ColorBurn]: undefined,
  [IRBlendMode.HardLight]: BlendingMode.STRONG_LIGHT,
  [IRBlendMode.SoftLight]: BlendingMode.WEAK_LIGHT,
  [IRBlendMode.Difference]: BlendingMode.SUBTRACTION,
  [IRBlendMode.Exclusion]: undefined,
  [IRBlendMode.Hue]: undefined,
  [IRBlendMode.Saturation]: undefined,
  [IRBlendMode.Color]: undefined,
  [IRBlendMode.Luminosity]: undefined,
  [IRBlendMode.Add]: BlendingMode.ADD,
};

export function mapBlendModeToGE(blendMode: IRBlendMode | undefined): BlendingMode | undefined {
  return blendMode != null ? GE_BLENDING_BY_IR_MODE[blendMode] : undefined;
}

export function mapEndBehaviorToGE(endBehavior: IREndBehavior): EndBehavior {
  switch (endBehavior) {
    case IREndBehavior.Destroy:
      return EndBehavior.destroy;
    case IREndBehavior.Continue:
      return EndBehavior.forward;
    case IREndBehavior.Freeze:
      return EndBehavior.freeze;
    case IREndBehavior.Loop:
      return EndBehavior.restart;
  }
}

const GE_TIMELINE_ITEM_TYPE_BY_IR_LAYER_TYPE: Record<IRLayerType, ItemType> = {
  image: ItemType.sprite,
  solid: ItemType.sprite,
  shape: ItemType.sprite,
  text: ItemType.text,
  particle: ItemType.particle,
  null: ItemType.null,
  precomp: ItemType.null,
};

const GE_VFX_ITEM_TYPE_BY_IR_LAYER_TYPE: Record<IRLayerType, ItemType> = {
  image: ItemType.sprite,
  solid: ItemType.sprite,
  shape: ItemType.shape,
  text: ItemType.text,
  particle: ItemType.particle,
  null: ItemType.null,
  precomp: ItemType.null,
};

export function mapLayerTypeToGETimelineItemType(type: IRLayerType): ItemType {
  return GE_TIMELINE_ITEM_TYPE_BY_IR_LAYER_TYPE[type];
}

export function mapLayerTypeToGEVFXItemType(type: IRLayerType): ItemType {
  return GE_VFX_ITEM_TYPE_BY_IR_LAYER_TYPE[type];
}
