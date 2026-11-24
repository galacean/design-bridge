import { assertIRScene } from '@galacean/animation-ir/validator';
import {
  convertGEToIR, convertIRToGE, updateGEToIRPreservedData, type GEToIRPreservedData,
} from '@galacean/ge-ir';

export function prepareIREditing(text: string, frameRate: number, resourceBaseUrl?: string) {
  const source = parseGESource(JSON.parse(text));

  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError('导入帧率必须是大于 0 的有限数。');
  }
  const imported = convertGEToIR(structuredClone(source), { frameRate, resourceBaseUrl });

  return {
    source,
    baselineScene: imported.scene,
    preservedData: imported.preservedData,
    diagnostics: imported.diagnostics,
  };
}

export function applyIREdits(text: string, session: ReturnType<typeof prepareIREditing>) {
  const edited: unknown = JSON.parse(text);

  assertIRScene(edited);
  const preservedData = updateGEToIRPreservedData(session.baselineScene, edited, session.preservedData);
  const exported = convertIRToGE(edited, { preservedData });

  return { scene: { ...exported.scene }, diagnostics: exported.diagnostics };
}

export function restoreIREditing(text: string): ReturnType<typeof prepareIREditing> {
  const input: unknown = JSON.parse(text);

  if (input == null || typeof input !== 'object' || Array.isArray(input) ||
    !('source' in input) || !('baselineScene' in input) || !('preservedData' in input)) {
    throw new TypeError('请导入本页面下载的保真数据文件（包含源 GE、原始 IR 和保真数据）。');
  }
  const source = parseGESource(input.source);
  const baselineScene = input.baselineScene;

  assertIRScene(baselineScene);
  if (input.preservedData == null || typeof input.preservedData !== 'object' || Array.isArray(input.preservedData)) {
    throw new TypeError('保真数据必须是对象。');
  }
  // The adapter validates the complete sidecar contract and its bindings before accepting it.
  const preservedData = input.preservedData as GEToIRPreservedData;
  const validated = convertIRToGE(baselineScene, { preservedData });

  return { source, baselineScene, preservedData, diagnostics: validated.diagnostics };
}

function parseGESource(input: unknown): Record<string, unknown> {
  if (input == null || typeof input !== 'object' || Array.isArray(input) || !('compositions' in input) ||
    !Array.isArray(input.compositions) || input.compositions.length === 0) {
    throw new TypeError('请输入包含 compositions 的 GE 场景。');
  }

  return { ...input };
}
