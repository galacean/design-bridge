import type { spec } from '@galacean/effects';

export interface EffectsScene extends spec.JSONScene {}

export interface ConvertOptions {
  compositionName?: string;
  compositionDuration?: number;
  includeInvisibleNodes?: boolean;
}

export interface ConversionIssue {
  type: 'warning' | 'error';
  message: string;
}

export interface DebugMapEntry {
  figmaNodeId: string;
  figmaNodeName: string;
  itemId?: string;
  componentIds: string[];
  skipped?: boolean;
  reason?: string;
}

export type ConversionDebugMap = Record<string, DebugMapEntry>;

export interface ConversionResult {
  scene: EffectsScene;
  issues: ConversionIssue[];
  debugMap: ConversionDebugMap;
}
