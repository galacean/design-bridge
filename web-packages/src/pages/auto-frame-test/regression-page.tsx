import FrameRegressionReport from '../../features/frame-comparison/regression/frame-regression-report';

async function registerSuite(root: HTMLElement, options: { signal?: AbortSignal }) {
  const { registerFrameRegressionSuite } = await import('./frame-regression.spec');

  return registerFrameRegressionSuite(root, options);
}

export default function RegressionPage() {
  return (
    <FrameRegressionReport
      title="Lottie 批量帧回归" description="批量比较 Lottie 原始渲染与 GE 转换结果。" registerSuite={registerSuite}
    >
      该页面直接运行 Mocha 回归测试。可在 URL 附加 ?max=N 控制最大 fixture 数量。
    </FrameRegressionReport>
  );
}
