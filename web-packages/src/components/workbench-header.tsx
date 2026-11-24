import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ThemeModeDropdown from './theme-mode-dropdown';

export default function WorkbenchHeader({ title, description, children }: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-tight text-[var(--color-text-emphasis)]">{title}</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--workbench-muted)]">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to="/" className="ui-btn ui-btn-ghost no-underline">← 首页</Link>
        <ThemeModeDropdown />
      </div>
      {children}
    </header>
  );
}
