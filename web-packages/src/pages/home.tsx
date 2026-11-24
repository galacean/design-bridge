import './home.css';
import { Link } from 'react-router-dom';
import ThemeModeDropdown from '../components/theme-mode-dropdown';

const inputFormatClasses = {
  Lottie: 'ui-nav-card-icon-violet',
  SVG: 'ui-nav-card-icon-cyan',
  DSL: 'ui-nav-card-icon-cyan',
  GE: 'ui-nav-card-icon-gold',
  GLSL: 'ui-nav-card-icon-violet',
  HTML: 'ui-nav-card-icon-gold',
  Figma: 'ui-nav-card-icon-cyan',
};

type ToolItem = {
  to: string;
  inputFormat: keyof typeof inputFormatClasses;
  title: string;
  desc: string;
};

const conversionTools: ToolItem[] = [
  {
    to: '/lottie2ge',
    inputFormat: 'Lottie',
    title: 'Lottie → GE',
    desc: '将 Lottie 动画转换为 GE 场景。',
  },
  {
    to: '/dsl2ge',
    inputFormat: 'DSL',
    title: 'DSL → GE',
    desc: '将 DSL 数据转换为 GE 场景。',
  },
  {
    to: '/shader2ge',
    inputFormat: 'GLSL',
    title: 'Shader → GE',
    desc: '将 GLSL 着色器转换为可播放的 GE 场景。',
  },
  {
    to: '/html2figma',
    inputFormat: 'HTML',
    title: 'HTML → Figma',
    desc: '将 HTML 转换为可编辑的 Figma 设计。',
  },
  {
    to: '/figma2ge',
    inputFormat: 'Figma',
    title: 'Figma → GE',
    desc: '将 Figma 设计转换为 GE 场景。',
  },
];

const editingTools: ToolItem[] = [
  {
    to: '/ir-editing',
    inputFormat: 'GE',
    title: 'IR 编辑',
    desc: '拆分场景、编辑 IR，重组后对比预览。',
  },
  {
    to: '/ge2dsl-bundle',
    inputFormat: 'GE',
    title: 'DSL 编辑',
    desc: '拆分场景、编辑 DSL，重组后对比预览。',
  },
];

const validationTools: ToolItem[] = [
  {
    to: '/svg-auto-frame-test', inputFormat: 'SVG', title: 'SVG 批量帧回归',
    desc: '筛选本地案例池，全量或抽样对比并定位失败帧。',
  },
  {
    to: '/svg-frame-test',
    inputFormat: 'SVG',
    title: 'SVG 帧对比',
    desc: '逐帧查看 SVG 与 GE 转换结果的差异。',
  },
  {
    to: '/frame-test',
    inputFormat: 'Lottie',
    title: 'Lottie 帧对比',
    desc: '逐帧查看 Lottie 与 GE 转换结果的差异。',
  },
  {
    to: '/auto-frame-test',
    inputFormat: 'Lottie',
    title: 'Lottie 批量帧回归',
    desc: '批量对比转换结果，集中查看失败帧。',
  },
  {
    to: '/ge-auto-frame-test',
    inputFormat: 'GE',
    title: 'GE 批量帧回归',
    desc: '批量检查 GE 经 IR 往返转换的渲染差异。',
  },
  {
    to: '/ge2ir',
    inputFormat: 'GE',
    title: 'GE ↔ IR 对比',
    desc: '对比 IR 保真往返或标准导出后的 GE 效果。',
  },
  {
    to: '/ge2dsl',
    inputFormat: 'GE',
    title: 'GE ↔ DSL 对比',
    desc: '对比 GE 与 DSL 往返转换的渲染效果。',
  },
  {
    to: '/dsl-validator',
    inputFormat: 'DSL',
    title: 'DSL 格式校验',
    desc: '批量检查 DSL 的结构与语义问题。',
  },
];

function ToolCard({ tool }: { tool: ToolItem }) {
  return (
    <Link to={tool.to} className="ui-nav-card">
      <span className={`ui-nav-card-icon ui-nav-card-input ${inputFormatClasses[tool.inputFormat]}`}>
        {tool.inputFormat}
      </span>
      <div className="ui-nav-card-body">
        <div className="ui-nav-card-head">
          <h3 className="ui-nav-card-title">{tool.title}</h3>
        </div>
        <p className="ui-nav-card-desc">{tool.desc}</p>
      </div>

      <span className="ui-nav-card-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

const toolGroups = [
  { title: '格式转换', description: '连接设计、动画与场景格式。', tools: conversionTools },
  { title: '编辑与重组', description: '修改场景内容，保留原始效果。', tools: editingTools },
  { title: '验证与回归', description: '检查数据，定位渲染差异。', tools: validationTools },
];

export default function Home() {
  return (
    <div className="ui-soft-workbench ui-home min-h-screen">
      <main className="ui-home-shell mx-auto w-full">
        <header className="ui-home-header flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="ui-home-title font-semibold">Design Bridge</h1>
            <p className="ui-home-intro mt-2">选择要完成的任务，开始处理你的素材。</p>
          </div>
          <ThemeModeDropdown />
        </header>
        <div className="grid grid-cols-1 gap-10 min-[1100px]:grid-cols-3 min-[1100px]:gap-6">
          {toolGroups.map(group => (
            <section key={group.title} className="min-w-0">
              <div className="ui-home-section-header mb-4">
                <h2 className="ui-home-section-title font-semibold">{group.title}</h2>
                <p className="ui-home-section-desc mt-2">{group.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-1">
                {group.tools.map(tool => <ToolCard key={tool.to} tool={tool} />)}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
