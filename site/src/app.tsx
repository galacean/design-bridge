import { bindDocsSitePages, DocsSite } from '@galacean/docs-site';
import siteConfig, { sitePages } from '../site.config';
import HomePage from './pages/home/home-page';

const pages = bindDocsSitePages(sitePages, {
  home: locale => <HomePage locale={locale} />,
});

export default function App() {
  return <DocsSite config={siteConfig} pages={pages} />;
}
