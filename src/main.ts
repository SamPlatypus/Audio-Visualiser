import './styles.css';
import { App } from './app';
import { isNativeShell } from './platform/platform';

const app = new App();

// Expose for debugging and automated tests.
(window as unknown as { auralis: App }).auralis = app;

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    app.controls.setOfflineStatus('Offline mode is not supported in this browser');
    return;
  }
  if (!import.meta.env.PROD) {
    app.controls.setOfflineStatus('Development build (offline cache disabled)');
    return;
  }
  if (isNativeShell()) {
    app.controls.setOfflineStatus('Installed app · works offline');
    return;
  }

  // Only reload when an *update* takes over; the very first install claiming
  // this page must not cause a surprise reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      const offerUpdate = (worker: ServiceWorker) => {
        app.controls.message('A new version is ready — tap to update', {
          duration: 10000,
          action: () => worker.postMessage('SKIP_WAITING'),
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      await navigator.serviceWorker.ready;
      app.controls.setOfflineStatus('Ready to use offline ✓');
    } catch {
      app.controls.setOfflineStatus('Offline cache unavailable');
    }
  });
}

registerServiceWorker();
