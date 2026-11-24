import type { ConversionResult, EffectsScene } from '@galacean/figma2ge';

interface ConversionSummaryCardProps {
  scene: EffectsScene | undefined;
  result: ConversionResult;
  debugMapSize: number;
  warningCount: number;
  errorCount: number;
}

export default function ConversionSummaryCard(props: ConversionSummaryCardProps) {
  const { scene, result, debugMapSize, warningCount, errorCount } = props;

  return (
    <div className="ui-card-compact p-4">
      <div className="ui-kicker mb-2">转换摘要</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-[var(--color-text-primary)]">
        <div>Compositions: {scene?.compositions?.length ?? 0}</div>
        <div>Items: {scene?.items?.length ?? 0}</div>
        <div>Components: {scene?.components?.length ?? 0}</div>
        <div>Images: {scene?.images?.length ?? 0}</div>
        <div>Textures: {scene?.textures?.length ?? 0}</div>
        <div>Issues: {result.issues.length}</div>
        <div>DebugMap: {debugMapSize}</div>
      </div>
      <div className="mt-2 text-[12px]">
        <span className="text-[var(--gold)]">Warnings: {warningCount}</span>
        <span className="mx-2 text-[var(--color-text-secondary)]">|</span>
        <span className={errorCount > 0 ? 'text-[var(--coral)]' : 'text-[var(--cyan)]'}>Errors: {errorCount}</span>
      </div>
    </div>
  );
}
