import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { loadLocale, readStoredLocale } from '@/i18n';
import { createBrowserPorts } from '@/ports';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
// One set of ports for the page's lifetime: HttpChain over /api, Wallet Standard wallets, slots in localStorage.
const ports = createBrowserPorts();
// The language this viewer chose (English by default, D140), loaded before the first paint so the page does not flash
// in English first. A catalog that fails to load leaves the site in English; the footer can try again.
await loadLocale(readStoredLocale()).catch(() => undefined);
createRoot(root).render(
  <StrictMode>
    <App ports={ports} />
  </StrictMode>,
);
