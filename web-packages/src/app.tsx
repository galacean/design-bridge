import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/home';
import { ThemeModeProvider, useThemeMode } from './theme/theme-mode';

const FigmaToGE = lazy(() => import('./pages/figma2ge'));
const HTMLToFigma = lazy(() => import('./pages/html2figma'));
const LottieToGE = lazy(() => import('./pages/lottie2ge'));
const DslToGE = lazy(() => import('./pages/dsl2ge'));
const ShaderToGE = lazy(() => import('./pages/shader2ge'));
const GEToIR = lazy(() => import('./pages/ge2ir'));
const GEToDSL = lazy(() => import('./pages/ge2dsl'));
const GE2DSLBundle = lazy(() => import('./pages/ge2dsl-bundle'));
const IREditingPage = lazy(() => import('./pages/ir-editing'));
const FrameTest = lazy(() => import('./pages/frame-test'));
const SVGFrameTest = lazy(() => import('./pages/svg-frame-test'));
const SVGAutoFrameTest = lazy(() => import('./pages/svg-auto-frame-test'));

function LegacySVGPage() {
  const { search } = useLocation();

  return <Navigate to={`/svg-frame-test${search}`} replace />;
}
const AutoFrameTest = lazy(() => import('./pages/auto-frame-test'));
const GEAutoFrameTest = lazy(() => import('./pages/ge-auto-frame-test'));
const DSLValidator = lazy(() => import('./pages/dsl-validator'));

function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p role="status" className="ui-page-shell">正在加载工作台…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/figma2ge" element={<FigmaToGE />} />
          <Route path="/html2figma" element={<HTMLToFigma />} />
          <Route path="/lottie2ge" element={<LottieToGE />} />
          <Route path="/dsl2ge" element={<DslToGE />} />
          <Route path="/shader2ge" element={<ShaderToGE />} />
          <Route path="/ge2ir" element={<GEToIR />} />
          <Route path="/ge2dsl" element={<GEToDSL />} />
          <Route path="/ge2dsl-bundle" element={<GE2DSLBundle />} />
          <Route path="/ir-editing" element={<IREditingPage />} />
          <Route path="/svg-auto-frame-test" element={<SVGAutoFrameTest />} />
          <Route path="/svg-auto-frame-test.html" element={<SVGAutoFrameTest />} />
          <Route path="/svg2ge" element={<LegacySVGPage />} />
          <Route path="/svg-frame-test" element={<SVGFrameTest />} />
          <Route path="/frame-test" element={<FrameTest />} />
          <Route path="/auto-frame-test" element={<AutoFrameTest />} />
          <Route path="/ge-auto-frame-test" element={<GEAutoFrameTest />} />
          <Route path="/dsl-validator" element={<DSLValidator />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function ThemedAppShell() {
  const { themeMode } = useThemeMode();

  return (
    <div className="lab-theme-page min-h-screen" data-theme={themeMode}>
      <AppRoutes />
    </div>
  );
}

export default function App() {
  return (
    <ThemeModeProvider>
      <ThemedAppShell />
    </ThemeModeProvider>
  );
}
