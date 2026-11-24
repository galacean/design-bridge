import FrameRegressionReport from '../../features/frame-comparison/regression/frame-regression-report';

async function registerSuite(root: HTMLElement, options: { signal?: AbortSignal }) {
  const { registerGEFrameRegressionSuite } = await import('./frame-regression.spec');

  return registerGEFrameRegressionSuite(root, options);
}

export default function RegressionPage() {
  return (
    <FrameRegressionReport
      title="GE 批量帧回归" description="批量比较原始 GE 与往返转换结果。" registerSuite={registerSuite}
    >
          对比 原始 GE 与 round-trip 的逐帧渲染。默认 GE→IR→GE；附加 <code>?mode=ge2dsl</code> 改为 GE→DSL→GE
          拼接链路验证。可附加 <code>?max=N</code> 控制最大 fixture 数量、
          <code>?only=关键词</code> 模糊过滤、<code>?exact=文件名</code> 精确过滤。
    </FrameRegressionReport>
  );
}
