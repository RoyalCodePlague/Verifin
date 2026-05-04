import { useEffect, useState } from "react";

type PWAUpdateEvent = CustomEvent<ServiceWorkerRegistration>;

export function usePWAUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      setRegistration((event as PWAUpdateEvent).detail);
    };

    window.addEventListener("verifin:pwa-update-available", handleUpdateAvailable);
    return () => window.removeEventListener("verifin:pwa-update-available", handleUpdateAvailable);
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
