import { useState, useCallback, useEffect } from 'react';
import { saveToVideo } from '../../../features/ge-video/save-video';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';

const DEFAULT_EFFECTS_URL = 'https://mdn.alipayobjects.com/mars/afts/file/A*47v_R7Lkd-UAAAAAQXAAAAgAelB4AQ';

export default function VideoExportPanel() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [effectsUrl, setEffectsUrl] = useState(DEFAULT_EFFECTS_URL);
  const [videoFps, setVideoFps] = useState(30);
  const [videoBg, setVideoBg] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendering' | 'done' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const appendLog = useCallback((message: string) => {
    setLogs(prev => [...prev, message]);
  }, []);

  const handleExport = useCallback(async () => {
    const signal = beginRequest();

    setStatus('loading');
    setProgress(0);
    setLogs([]);
    setVideoUrl(null);
    setErrorMsg('');

    try {
      appendLog('📥 加载场景数据...');
      const response = await fetch(effectsUrl, { signal });

      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }

      const effectsJSON: unknown = await response.json();

      if (signal.aborted) {
        return;
      }
      if (effectsJSON == null || typeof effectsJSON !== 'object' || Array.isArray(effectsJSON) ||
        !('compositions' in effectsJSON) || !Array.isArray(effectsJSON.compositions)) {
        throw new Error('GE 场景必须是 JSON 对象');
      }

      appendLog(`✅ 场景已加载，开始渲染 (${videoFps}fps)`);
      setStatus('rendering');

      const videoBlob = await saveToVideo(effectsJSON, {
        signal,
        fps: videoFps,
        background: videoBg || undefined,
        onProgress: value => { if (!signal.aborted) { setProgress(value); } },
        onLog: message => { if (!signal.aborted) { appendLog(message); } },
      });

      if (signal.aborted) {
        return;
      }
      const url = URL.createObjectURL(videoBlob);

      setVideoUrl(url);
      setStatus('done');
      appendLog(`🎉 导出完成，文件大小 ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);

      setErrorMsg(message);
      setStatus('error');
      appendLog(`❌ Error: ${message}`);
    }
  }, [beginRequest, effectsUrl, videoFps, videoBg, appendLog]);

  const handleDownload = useCallback(() => {
    if (!videoUrl) {
      return;
    }
    const a = document.createElement('a');

    a.href = videoUrl;
    a.download = 'output.mp4';
    a.click();
  }, [videoUrl]);

  const isRunning = status === 'loading' || status === 'rendering';

  return (
    <div className="w-full flex flex-col gap-4 text-[var(--color-text-primary)]">
      <div className="mb-4">
        <h3 className="mb-1 text-[18px] leading-[1.3] text-[var(--color-text-emphasis)]">视频导出</h3>
        <p className="text-[12px] leading-[1.45] text-[var(--color-text-secondary)]">
          输入 GE 场景地址，通过 逐帧渲染并导出 MP4 视频。
        </p>
      </div>

      <div className="ui-callout ui-callout-violet text-[12px] leading-[1.4]">
        建议先在 Render 页确认可播放，再在此页进行视频导出，避免长时间渲染后失败。
      </div>

      <div className="ui-card shadow-sm">
        {/* URL 输入 + 导出按钮 */}
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={effectsUrl}
            disabled={isRunning}
            onChange={e => setEffectsUrl(e.target.value)}
            placeholder="Effects JSON URL"
            className="ui-input min-w-0 flex-1 px-3 text-[13px] leading-[1.45]"
          />
          <button onClick={() => { void handleExport(); }} disabled={isRunning} className="ui-btn ui-btn-primary whitespace-nowrap">
            {status === 'loading' ? '加载中...' : status === 'rendering' ? '渲染中...' : '导出视频'}
          </button>
          {isRunning && (
            <button
              onClick={() => { cancelRequest(); setStatus('idle'); appendLog('导出已取消'); }}
              className="ui-btn ui-btn-ghost whitespace-nowrap"
            >
              取消
            </button>
          )}
        </div>

        {/* 参数配置 */}
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-[13px] leading-[1.45]">
            <span className="text-[var(--color-text-secondary)]">帧率</span>
            <input
              type="number"
              min="1"
              value={videoFps}
              onChange={e => setVideoFps(Number(e.target.value))}
              disabled={isRunning}
              className="ui-input w-16 px-2 text-[13px] leading-[1.45]"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] leading-[1.45]">
            <span className="text-[var(--color-text-secondary)]">背景色</span>
            <input
              type="text"
              value={videoBg}
              onChange={e => setVideoBg(e.target.value)}
              disabled={isRunning}
              placeholder="颜色名称或色值，留空为黑色"
              className="ui-input w-36 px-2 text-[13px] leading-[1.45]"
            />
          </label>
        </div>

        <p className="mb-4 text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
          MP4 不保留透明背景，导出时会先合成背景色；留空默认使用黑色。
        </p>

        {(status === 'rendering' || status === 'done') && (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
              <span>渲染进度</span>
              <span>{(progress * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden bg-[var(--s3)]">
              <div
                className="h-full bg-[var(--cyan)] transition-[width] duration-200"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="ui-callout ui-callout-danger mb-4 text-[13px] leading-[1.45] text-[var(--coral)]">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[981px]:grid-cols-2">
        {videoUrl && (
          <div className="ui-card-compact">
            <div className="mb-2 flex items-center justify-between">
              <strong>预览</strong>
              <button onClick={handleDownload} className="ui-btn ui-btn-gold ui-btn-sm px-[10px] text-[12px]">
                下载 MP4
              </button>
            </div>
            <video src={videoUrl} controls autoPlay loop className="block w-full bg-black" />
          </div>
        )}

        {logs.length > 0 && (
          <div className="ui-card-compact">
            <strong>日志</strong>
            <pre className="ui-code mt-2 max-h-[300px] whitespace-pre-wrap font-mono text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
              {logs.join('\n')}
            </pre>
          </div>
        )}
      </div>

      {logs.length === 0 && !videoUrl && (
        <div className="ui-card-compact text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
          暂无导出结果。请先输入可访问的 GE JSON URL 并点击“导出视频”。
        </div>
      )}
    </div>
  );
}
