import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupAdaptiveAppIcons } from "@/lib/app-icons";
import { applySystemThemeClass } from "@/lib/store";

applySystemThemeClass();
setupAdaptiveAppIcons();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
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

		navigator.serviceWorker.register('/service-worker.js').then(
			registration => {
				console.log('ServiceWorker registration successful with scope: ', registration.scope);
				if (registration.waiting && navigator.serviceWorker.controller) {
					notifyUpdateAvailable(registration);
				}
				registration.addEventListener('updatefound', () => {
					const worker = registration.installing;
					if (!worker) return;
					worker.addEventListener('statechange', () => {
						if (worker.state === 'installed' && navigator.serviceWorker.controller) {
							notifyUpdateAvailable(registration);
						}
					});
				});

				window.setInterval(() => {
					if (navigator.onLine) void registration.update();
				}, 60 * 60 * 1000);
			},
			err => {
				console.log('ServiceWorker registration failed: ', err);
			}
		);
	});
}

createRoot(document.getElementById("root")!).render(<App />);
