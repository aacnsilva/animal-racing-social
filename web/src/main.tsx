import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { refreshSession } from './lib/api';
import './styles.css';

const url = new URL(window.location.href);
const authError = url.searchParams.get('authError');
if (authError) {
  url.searchParams.delete('authError');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

void refreshSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App authError={authError} />
  </StrictMode>,
);
