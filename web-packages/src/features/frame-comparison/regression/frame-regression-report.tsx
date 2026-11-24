import './frame-regression.css';
import { useEffect, useState, type ReactNode } from 'react';
import WorkbenchHeader from '../../../components/workbench-header';
import { runFrameRegression, type FrameRegressionOptions } from './run-frame-regression';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();

        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => {
        existing.remove();
        reject(new Error(`Failed to load script: ${src}`));
      }, {
        once: true,
      });

      return;
    }

    const script = document.createElement('script');

    script.src = src;
    script.async = true;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true },
    );
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`Failed to load script: ${src}`));
    }, {
      once: true,
    });
    document.body.appendChild(script);
  });
}

function ensureMochaStyle(): void {
  const href = 'https://unpkg.com/mocha@10.2.0/mocha.css';
  const existing = document.querySelector(`link[href="${href}"]`);

  if (existing) {
    return;
  }

  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.href = href;
  link.addEventListener('error', () => link.remove(), { once: true });
  document.head.appendChild(link);
}

interface FrameRegressionReportProps {
  title: string;
  description: string;
  children: ReactNode;
  registerSuite: FrameRegressionOptions['registerSuite'];
  signal?: AbortSignal;
  className?: string;
  controlsClassName?: string;
  controlsAs?: 'p' | 'div';
  collapsibleLog?: boolean;
  galleryTitle?: string;
}

export default function FrameRegressionReport({
  title, description, children, registerSuite, signal, className = '',
  controlsClassName = 'ui-callout mb-3 text-[12px] text-[var(--workbench-muted)]',
  controlsAs: Controls = 'p', collapsibleLog = false, galleryTitle,
}: FrameRegressionReportProps) {
  const [status, setStatus] = useState('准备中...');

  useEffect(() => {
    let disposed = false;
    const abortController = new AbortController();
    let stopSession: (() => void) | null = null;
    const stop = () => {
      abortController.abort();
      stopSession?.();
    };

    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) { stop(); }

    async function bootstrap(): Promise<void> {
      try {
        if (abortController.signal.aborted) { return; }
        ensureMochaStyle();
        setStatus('加载 Mocha/Chai...');

        await loadScript('https://unpkg.com/chai@4.3.7/chai.js');
        await loadScript('https://unpkg.com/mocha@10.2.0/mocha.js');

        if (disposed || abortController.signal.aborted) {
          return;
        }

        setStatus('初始化测试...');
        const mochaRoot = document.getElementById('mocha');
        const galleryRoot = document.getElementById('frame-galleries');

        if (!mochaRoot || !galleryRoot) {
          throw new Error('Missing report container');
        }

        const session = await runFrameRegression({
          registerSuite,
          mochaRoot,
          galleryRoot,
          signal: abortController.signal,
        });

        stopSession = session.stop;
        if (abortController.signal.aborted) { stopSession(); }

        if (!disposed && !abortController.signal.aborted) {
          setStatus(`已加载 ${session.fixtureCount} 个文件，下方报告显示执行进度与结果`);
        }
      } catch (error) {
        if (!disposed && !abortController.signal.aborted) {
          setStatus(`初始化失败: ${(error as Error).message}`);
        }
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
      signal?.removeEventListener('abort', stop);
      stop();
    };
  }, [registerSuite, signal]);

  return (
    <div className={`ui-soft-workbench ui-regression min-h-screen ${className}`}>
      <div className="ui-page-shell">
        <WorkbenchHeader title={title} description={description} />

        <Controls className={controlsClassName}>
          {children}
        </Controls>
        <p role="status" className="mb-3 text-[12px] text-[var(--workbench-muted)]">{status}</p>

        {collapsibleLog ? (
          <details className="ui-soft-panel ui-regression-log">
            <summary>运行日志</summary>
            <div id="mocha" />
          </details>
        ) : <div id="mocha" className="ui-soft-panel" />}
        {galleryTitle != null && <h2 className="ui-gallery-heading pt-4">{galleryTitle}</h2>}
        <div id="frame-galleries" className={galleryTitle == null ? 'pt-4' : undefined} />
      </div>
    </div>
  );
}
