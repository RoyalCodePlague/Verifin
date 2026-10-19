import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupAdaptiveAppIcons } from "@/lib/app-icons";
import { applySystemThemeClass } from "@/lib/store";

applySystemThemeClass();
setupAdaptiveAppIcons();

// Register service worker for PWA
if ('serviceWorker' in navigator && import.meta.env.DEV) {
  // Vite modules use stable URLs; a cache-first worker can serve incompatible old pages.
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    let removed = false;
    for (const registration of registrations) {
      const worker = registration.active || registration.waiting || registration.installing;
      if (worker && new URL(worker.scriptURL).pathname === '/service-worker.js') {
        removed = await registration.unregister() || removed;
      }
    }
    for (const key of await caches.keys()) {
      if (key.startsWith('verifin-cache-')) await caches.delete(key);
    }
    if (removed && navigator.serviceWorker.controller) window.location.reload();
  }).catch(console.warn);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
	window.addEventListener('load', () => {
		let refreshing = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (refreshing) return;
			refreshing = true;
			window.location.reload();
		});

		const notifyUpdateAvailable = (registration: ServiceWorkerRegistration) => {
			window.dispatchEvent(new CustomEvent('verifin:pwa-update-available', { detail: registration }));
		};

		const checkForUpdate = (registration: ServiceWorkerRegistration) => {
			if (navigator.onLine) void registration.update().catch(() => undefined);
		};

		navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then(
			registration => {
				console.log('ServiceWorker registration successful with scope: ', registration.scope);
				if (registration.waiting) notifyUpdateAvailable(registration);

				registration.addEventListener('updatefound', () => {
					const worker = registration.installing;
					if (!worker) return;
					worker.addEventListener('statechange', () => {
						if (worker.state === 'installed' && registration.waiting) {
							notifyUpdateAvailable(registration);
						}
					});
				});

				const checkWhenActive = () => checkForUpdate(registration);
				window.addEventListener('focus', checkWhenActive);
				window.addEventListener('online', checkWhenActive);
				document.addEventListener('visibilitychange', () => {
					if (document.visibilityState === 'visible') checkWhenActive();
				});
				checkWhenActive();
				window.setInterval(checkWhenActive, 30 * 60 * 1000);
			},
			err => {
				console.log('ServiceWorker registration failed: ', err);
			}
		);
	});
}

createRoot(document.getElementById("root")!).render(<App />);
