import { convertGEToDSL, convertDSLToGE, type GEToDSLDiagnostic } from '../../features/dsl-conversion/ge-dsl-workflow';

export function convertGEInputRoundTrip(json: string, frameRate: number, resourceBaseUrl?: string) {
  const input: unknown = JSON.parse(json);

  if (input == null || typeof input !== 'object' || Array.isArray(input) || !('compositions' in input) ||
    !Array.isArray(input.compositions) || input.compositions.length === 0) {
    throw new TypeError('请输入包含 compositions 的 GE 场景。');
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError('转换帧率必须是大于 0 的有限数。');
  }
  const source = input as Record<string, unknown>;
  const diagnostics: GEToDSLDiagnostic[] = [];
  const startedAt = performance.now();
  let scene: Record<string, unknown> | null = null;
  let error: string | null = null;
  let stage = 'GE → DSL';

  try {
    const imported = convertGEToDSL(structuredClone(source), { frameRate, resourceBaseUrl });

    diagnostics.push(...imported.diagnostics);
    stage = 'DSL → GE';
    const exported = convertDSLToGE(imported.dsl, { preservedData: imported.preservedData });

    diagnostics.push(...exported.diagnostics);
    scene = exported.scene as unknown as Record<string, unknown>;
  } catch (cause) {
    error = `${stage} 转换失败：${cause instanceof Error ? cause.message : String(cause)}`;
  }

  return { source, scene, diagnostics, error, elapsedMs: performance.now() - startedAt };
}
