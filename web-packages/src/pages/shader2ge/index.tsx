import { useState, useCallback } from 'react';
import { convertShaderToGE } from '@galacean/shader2ge';
import type { ShaderToGEResult, UniformValue } from '@galacean/shader2ge';
import WorkbenchHeader from '../../components/workbench-header';
import UniformEditor from './uniform-editor';
import EffectsPreview from './effects-preview';
import { SHADER_EXAMPLES } from './shader-examples';
import type { ShaderExample } from './shader-examples';

const DEFAULT_EXAMPLE = SHADER_EXAMPLES[0];

export default function ShaderToGE() {
  const [selectedExample, setSelectedExample] = useState(DEFAULT_EXAMPLE);
  const [shaderSource, setShaderSource] = useState(DEFAULT_EXAMPLE.code);
  const [result, setResult] = useState<ShaderToGEResult | null>(() =>
    convertShaderToGE(DEFAULT_EXAMPLE.code, {
      sceneName: 'ShaderScene',
      duration: DEFAULT_EXAMPLE.duration,
      previewSize: DEFAULT_EXAMPLE.previewSize,
      uniformOverrides: DEFAULT_EXAMPLE.overrides,
    }),
  );
  const [overrides, setOverrides] = useState<Record<string, UniformValue>>(DEFAULT_EXAMPLE.overrides);
  const [sceneName, setSceneName] = useState('ShaderScene');
  const [duration, setDuration] = useState(DEFAULT_EXAMPLE.duration);
  const [previewSize, setPreviewSize] = useState(DEFAULT_EXAMPLE.previewSize);
  const [jsonCopied, setJsonCopied] = useState(false);

  const handleConvert = useCallback(() => {
    const convertResult = convertShaderToGE(shaderSource, {
      sceneName,
      duration,
      previewSize,
      uniformOverrides: overrides,
    });

    setResult(convertResult);
  }, [shaderSource, sceneName, duration, previewSize, overrides]);

  const handleDownload = useCallback(() => {
    if (!result) {
      return;
    }
    const jsonString = JSON.stringify(result.scene, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `${sceneName || 'ShaderScene'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, sceneName]);

  const handleCopyJson = useCallback(() => {
    if (!result) {
      return;
    }
    void navigator.clipboard.writeText(JSON.stringify(result.scene, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  }, [result]);

  const handleSelectExample = useCallback(
    (example: ShaderExample) => {
      setSelectedExample(example);
      setShaderSource(example.code);
      setOverrides(example.overrides);
      setDuration(example.duration);
      setPreviewSize(example.previewSize);
      const convertResult = convertShaderToGE(example.code, {
        sceneName,
        duration: example.duration,
        previewSize: example.previewSize,
        uniformOverrides: example.overrides,
      });

      setResult(convertResult);
    },
    [sceneName],
  );

  const handleUniformChange = useCallback(
    (name: string, value: UniformValue) => {
      setOverrides(prev => ({ ...prev, [name]: value }));
    },
    [],
  );

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell shader2ge-workbench">
        {/* Header */}
        <WorkbenchHeader title="Shader 工作台" description="编写着色器、调整参数，预览并导出 GE 场景。" />

        {/* Main grid */}
        <div className="grid gap-3 lg:grid-cols-[clamp(360px,32vw,520px)_minmax(0,1fr)]">
          {/* Left: Controls */}
          <aside className="min-w-0 space-y-3">
            {/* Scene options */}
            <section className="ui-card space-y-3">
              <span className="ui-kicker">场景参数</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_70px_minmax(0,1fr)]">
                <div>
                  <label htmlFor="shader-scene-name" className="text-[length:var(--text-caption)] leading-[var(--lh-ui)] text-[var(--color-text-secondary)] mb-1 block">
                    名称
                  </label>
                  <input
                    id="shader-scene-name"
                    value={sceneName}
                    onChange={event => setSceneName(event.target.value)}
                    className="ui-input w-full text-[length:var(--text-caption)] px-2"
                  />
                </div>
                <div>
                  <label htmlFor="shader-duration" className="text-[length:var(--text-caption)] leading-[var(--lh-ui)] text-[var(--color-text-secondary)] mb-1 block">
                    时长(s)
                  </label>
                  <input
                    type="number"
                    id="shader-duration"
                    value={duration}
                    min={1}
                    onChange={event => setDuration(Number(event.target.value))}
                    className="ui-input w-full text-[length:var(--text-caption)] px-1.5"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1" role="group" aria-labelledby="shader-preview-size">
                  <span id="shader-preview-size" className="text-[length:var(--text-caption)] leading-[var(--lh-ui)] text-[var(--color-text-secondary)] mb-1 block">
                    尺寸
                  </span>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      aria-label="宽度"
                      value={previewSize[0]}
                      min={1}
                      onChange={event => setPreviewSize([Number(event.target.value), previewSize[1]])}
                      className="ui-input w-full text-[length:var(--text-caption)] px-1.5"
                    />
                    <span className="text-[10px] text-[var(--color-text-secondary)]">×</span>
                    <input
                      type="number"
                      aria-label="高度"
                      value={previewSize[1]}
                      min={1}
                      onChange={event => setPreviewSize([previewSize[0], Number(event.target.value)])}
                      className="ui-input w-full text-[length:var(--text-caption)] px-1.5"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Example Picker */}
            <details className="ui-card space-y-3">
              <summary className="cursor-pointer text-[13px] text-[var(--color-text-emphasis)]">
                示例库 · {selectedExample.name}
              </summary>
              <div className="grid grid-cols-2 gap-1.5">
                {SHADER_EXAMPLES.map(example => (
                  <button
                    key={example.name}
                    aria-pressed={selectedExample.name === example.name}
                    onClick={() => handleSelectExample(example)}
                    className={`text-left p-2 rounded-[var(--radius-sm)] transition-colors ${
                      selectedExample.name === example.name
                        ? 'bg-[var(--workbench-accent-dim)] text-[var(--workbench-accent)] ring-1 ring-[var(--workbench-accent)]'
                        : 'bg-[var(--s2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--s1)]'
                    }`}
                  >
                    <div className="text-[length:var(--text-ui)] leading-[var(--lh-ui)] font-medium truncate">{example.name}</div>
                    <div className="text-[length:var(--text-micro)] leading-[var(--lh-ui)] opacity-80 line-clamp-2 mt-0.5">
                      {example.description}
                    </div>
                  </button>
                ))}
              </div>

              {selectedExample.source && (
                <div className="text-[length:var(--text-micro)] text-[var(--color-text-secondary)]">
                  来源：
                  <a
                    href={selectedExample.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--workbench-accent)]"
                  >
                    {selectedExample.source}
                  </a>
                </div>
              )}
            </details>

            {/* Shader Editor */}
            <section className="ui-card space-y-2">
              <div className="flex items-center justify-between">
                <span className="ui-kicker">Fragment Shader</span>
              </div>
              <textarea
                aria-label="Fragment Shader"
                value={shaderSource}
                onChange={event => {
                  setShaderSource(event.target.value);
                  setResult(null);
                }}
                spellCheck={false}
                className="ui-textarea w-full h-[280px] text-[length:var(--text-caption)] font-mono leading-5 rounded-[var(--radius-sm)] p-3 resize-y"
                style={{ background: 'var(--code-bg)' }}
              />
              <button
                onClick={handleConvert}
                className="ui-btn ui-btn-primary w-full h-[var(--control-md)] md:h-[var(--control-sm)]"
              >
                转换为 GE 场景
              </button>
            </section>

            {/* Uniform Editor */}
            {result && result.uniforms.length > 0 && (
              <UniformEditor uniforms={result.uniforms} overrides={overrides} onChange={handleUniformChange} />
            )}
          </aside>

          {/* Right: Output */}
          <main className="min-w-0 space-y-3">
            {/* GE Preview */}
            <EffectsPreview scene={result ? (result.scene as unknown as Record<string, unknown>) : null} />

            {/* Diagnostics */}
            {result && result.diagnostics.length > 0 && (
              <div className="ui-callout ui-callout-gold">
                <span className="text-[length:var(--text-ui)] font-medium text-[var(--color-text-warning)] block mb-1.5">
                  ⚠ 转换诊断
                </span>
                <ul className="space-y-1">
                  {result.diagnostics.map((diagnostic, index) => (
                    <li
                      key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                      className="text-[length:var(--text-caption)] leading-[var(--lh-ui)] text-[var(--color-text-secondary)]"
                    >
                      • [{diagnostic.severity}] {diagnostic.code}: {diagnostic.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stats + Actions */}
            {result && (
              <section className="ui-card space-y-3">
                <div className="flex items-center justify-between">
                  <span className="ui-kicker">转换结果</span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyJson}
                      className="ui-btn ui-btn-sm ui-btn-ghost flex items-center gap-1.5"
                    >
                      {jsonCopied ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M13.5 4.5L6.5 11.5L3 8"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          已复制
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                            <path
                              d="M3 10.5V3.5C3 2.67 3.67 2 4.5 2H10.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                          复制 JSON
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="ui-btn ui-btn-sm ui-btn-violet flex items-center gap-1.5"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M8 11V3M8 11L5 8M8 11L11 8"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M2 13H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      下载 .json
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: 'Shaders', count: result.scene.shaders.length },
                    { label: 'Materials', count: result.scene.materials.length },
                    { label: 'Items', count: result.scene.items.length },
                    { label: 'Uniforms', count: result.uniforms.length },
                  ].map(stat => (
                    <div key={stat.label} className="ui-card-compact text-center">
                      <div className="text-[length:var(--text-body)] font-semibold text-[var(--color-text-emphasis)]">{stat.count}</div>
                      <div className="text-[length:var(--text-micro)] text-[var(--color-text-secondary)]">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* JSON Output */}
            {result && (
              <section className="ui-card space-y-2">
                <span className="ui-kicker">JSONScene 输出</span>
                <pre className="ui-code max-h-[600px] overflow-auto text-[length:var(--text-micro)] font-mono leading-[1.5] whitespace-pre-wrap break-all">
                  {JSON.stringify(result.scene, null, 2)}
                </pre>
              </section>
            )}

            {/* Empty state */}
            {!result && (
              <div className="ui-card py-16 text-center">
                <div className="text-[32px] mb-3 text-[var(--color-text-secondary)]">✧</div>
                <p className="text-[length:var(--text-body)] text-[var(--color-text-secondary)]">
                  编写 Fragment Shader 后点击「转换为 GE 场景」
                </p>
                <p className="text-[length:var(--text-caption)] text-[var(--color-text-secondary)] mt-1 opacity-60">
                  生成的 JSON 可直接在 GE Runtime 播放器中播放
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
