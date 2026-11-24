import EffectsPlayer from './effects-player';
import { downloadJsonValue } from '../local-inputs/download-json';

interface SceneComparisonProps {
  originalData: Record<string, unknown> | null;
  convertedData: Record<string, unknown> | null;
  convertedStats: { compositions: number; items: number; nestedLayers: number } | null;
  previewEnabled: boolean;
  setPreviewEnabled: (update: (value: boolean) => boolean) => void;
  previewSize: { width: number; height: number };
  baseName: string;
  preservedDataSummary: string;
  resultHint: string;
  preservationHint: string;
}

export default function SceneComparison({
  originalData, convertedData, convertedStats, previewEnabled, setPreviewEnabled,
  previewSize, baseName, preservedDataSummary, resultHint, preservationHint,
}: SceneComparisonProps) {
  return (
    <section aria-label="GE 预览对比" className="ui-soft-panel flex min-h-0 min-w-0 flex-col">
      <div className="ui-soft-toolbar">
        <h2 className="font-semibold">预览对比</h2>
        <button
          onClick={() => {
            if (convertedData != null) {
              downloadJsonValue(`${baseName}.roundtrip.ge.json`, convertedData);
            }
          }}
          disabled={convertedData == null}
          className="ui-btn ui-btn-secondary"
        >
          导出 GE
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        <div className="grid min-h-[260px] flex-1 grid-cols-2 gap-3 max-[480px]:grid-cols-1">
          {[
            { label: '原始 GE', data: originalData, hint: '选择或导入原始场景' },
            { label: '编辑后的 GE', data: convertedData, hint: resultHint },
          ].map(item => (
            <div key={item.label} className="ui-soft-preview flex min-w-0 flex-col gap-4 p-3">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <h3 className="font-medium">{item.label}</h3>
                <span className="text-[var(--workbench-muted)]">{item.data == null ? '待载入' : '已就绪'}</span>
              </div>
              <div className="flex min-h-[180px] flex-1 items-center justify-center">
                {previewEnabled && item.data != null ? (
                  <div
                    className="w-full"
                    style={{
                      maxWidth: `calc(max(220px, 100dvh - 390px) * ${previewSize.width / previewSize.height})`,
                    }}
                  >
                    <EffectsPlayer
                      effectsData={item.data}
                      width={previewSize.width}
                      height={previewSize.height}
                      fitContainer
                    />
                  </div>
                ) : (
                  <div className="space-y-3 text-center text-[12px] leading-[1.6] text-[var(--workbench-muted)]">
                    <span aria-hidden="true" className="text-[24px] opacity-60">▧</span>
                    <p>{item.data == null ? item.hint : '场景已就绪，可加载预览'}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 py-3">
          <span className="text-[12px] text-[var(--workbench-muted)]">原始场景与重组结果并排查看</span>
          <button
            onClick={() => setPreviewEnabled(value => !value)}
            disabled={originalData == null && convertedData == null}
            className="ui-btn ui-btn-ghost ui-btn-sm"
          >
            {previewEnabled ? '关闭预览' : '加载预览'}
          </button>
        </div>
        {convertedStats != null && (
          <div className="grid grid-cols-3 gap-3 border-t border-[var(--workbench-border)] py-3">
            <Metric label="合成" value={String(convertedStats.compositions)} />
            <Metric label="顶层 Item" value={String(convertedStats.items)} />
            <Metric label="嵌套图层" value={String(convertedStats.nestedLayers)} />
          </div>
        )}
        <div className="border-t border-[var(--workbench-border)] pt-3 text-[12px] leading-[1.6]">
          <p className="font-medium text-[var(--color-text-emphasis)]">保真数据</p>
          <p className="mt-1 text-[var(--workbench-muted)]">{preservedDataSummary}</p>
          <p className="mt-1 text-[var(--workbench-muted)]">{preservationHint}</p>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-1 text-[15px] leading-[1.35] font-semibold text-[var(--color-text-emphasis)]">{value}</div>
    </div>
  );
}
