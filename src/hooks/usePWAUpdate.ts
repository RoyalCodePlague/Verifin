import { useEffect, useState } from "react";

type PWAUpdateEvent = CustomEvent<ServiceWorkerRegistration>;

export function usePWAUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let mounted = true;

    const handleUpdateAvailable = (event: Event) => {
      const nextRegistration = (event as PWAUpdateEvent).detail;
      if (nextRegistration?.waiting) setRegistration(nextRegistration);
    };

    window.addEventListener("verifin:pwa-update-available", handleUpdateAvailable);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration().then((currentRegistration) => {
        if (mounted && currentRegistration?.waiting) setRegistration(currentRegistration);
      }).catch(() => undefined);
    }

    return () => {
      mounted = false;
      window.removeEventListener("verifin:pwa-update-available", handleUpdateAvailable);
    };
  }, []);

  const refreshNow = () => {
    const worker = registration?.waiting;
    if (!worker) {
      window.location.reload();
      return;
    }
    worker.postMessage({ type: "SKIP_WAITING" });
  };

  const dismissUpdate = () => setRegistration(null);

  return {
    dismissUpdate,
    isUpdateAvailable: !!registration?.waiting,
    refreshNow,
  };
}
