import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { createBrowserPorts } from '@/ports';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
// One set of ports for the page's lifetime: HttpChain over /api, Wallet Standard wallets, slots in localStorage.
const ports = createBrowserPorts();
createRoot(root).render(
  <StrictMode>
    <App ports={ports} />
  </StrictMode>,
);
