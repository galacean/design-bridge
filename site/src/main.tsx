import { createRoot } from 'react-dom/client';
import '@galacean/docs-site/index.css';
import App from './app';
import './styles/site-style.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Site root is missing');
}
createRoot(root).render(<App />);
