import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/service-worker.js').then(
			registration => {
				console.log('ServiceWorker registration successful with scope: ', registration.scope);
				if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
				registration.addEventListener('updatefound', () => {
					const worker = registration.installing;
					if (!worker) return;
					worker.addEventListener('statechange', () => {
						if (worker.state === 'installed' && navigator.serviceWorker.controller) {
							worker.postMessage({ type: 'SKIP_WAITING' });
						}
					});
				});
			},
			err => {
				console.log('ServiceWorker registration failed: ', err);
			}
		);
	});
}

createRoot(document.getElementById("root")!).render(<App />);
