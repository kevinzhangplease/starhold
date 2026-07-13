import './style.css';
import { UI } from './ui';

const ui = new UI();

if (new URLSearchParams(location.search).get('selftest') === '1') {
  import('./selftest').then(({ runSelfTest }) => runSelfTest(ui));
}

// PWA: only on a real HTTPS deployment. This is a no-op for the single-file build (opened
// via file://) and for plain-http local dev, so neither is ever affected by a service worker.
if (location.protocol === 'https:' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline install is best-effort */ });
  });
}

