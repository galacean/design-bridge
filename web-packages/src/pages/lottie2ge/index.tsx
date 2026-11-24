import { lazy, Suspense, useRef, useState } from 'react';
import ConvertPanel from './components/convert-panel';
import EffectsRenderPanel from './components/effects-render-panel';
import WorkbenchHeader from '../../components/workbench-header';

type Tab = 'convert' | 'effects-render' | 'effects-video';

const VideoExportPanel = lazy(() => import('./components/video-export-panel'));

export default function LottieToGE() {
  const [activeTab, setActiveTab] = useState<Tab>('convert');
  const tabButtonRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    convert: null,
    'effects-render': null,
    'effects-video': null,
  });

  const tabs: Array<{ key: Tab; label: string }> = [
    {
      key: 'convert',
      label: '动画转换',
    },
    {
      key: 'effects-render',
      label: 'GE 渲染',
    },
    {
      key: 'effects-video',
      label: '视频导出',
    },
  ];

  const renderPanel = (tab: Tab) => {
    switch (tab) {
      case 'convert':
        return <ConvertPanel />;
      case 'effects-render':
        return <EffectsRenderPanel />;
      case 'effects-video':
        return (
          <Suspense fallback={<p role="status">正在加载视频导出...</p>}>
            <VideoExportPanel />
          </Suspense>
        );
    }
  };

  const activateTab = (tab: Tab, shouldFocus = false) => {
    setActiveTab(tab);
    if (shouldFocus) {
      requestAnimationFrame(() => {
        tabButtonRefs.current[tab]?.focus();
      });
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = (index + 1) % tabs.length;

      activateTab(tabs[next].key, true);

      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = (index - 1 + tabs.length) % tabs.length;

      activateTab(tabs[prev].key, true);

      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      activateTab(tabs[0].key, true);

      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      activateTab(tabs[tabs.length - 1].key, true);
    }
  };

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell lottie-workbench">
        <WorkbenchHeader title="Lottie 转换" description="转换动画、验证 GE 场景，或导出视频。">
          <nav
            className="ui-soft-tabs flex w-full gap-1 overflow-x-auto p-1"
            role="tablist"
          >
            {tabs.map((tab, index) => (
              <button
                key={tab.key}
                ref={node => {
                  tabButtonRefs.current[tab.key] = node;
                }}
                id={`ui-tab-${tab.key}`}
                role="tab"
                aria-controls={`ui-sec-${tab.key}`}
                aria-selected={activeTab === tab.key}
                tabIndex={activeTab === tab.key ? 0 : -1}
                onClick={() => activateTab(tab.key)}
                onKeyDown={event => handleTabKeyDown(event, index)}
                className="shrink-0 px-4 py-2 text-[12px] transition-colors"
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </WorkbenchHeader>

        {tabs.map(tab => (
          <section
            key={tab.key}
            id={`ui-sec-${tab.key}`}
            role="tabpanel"
            aria-labelledby={`ui-tab-${tab.key}`}
            aria-hidden={activeTab !== tab.key}
            hidden={activeTab !== tab.key}
            className={activeTab === tab.key ? 'block' : 'hidden'}
          >
            {activeTab === tab.key ? renderPanel(tab.key) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
