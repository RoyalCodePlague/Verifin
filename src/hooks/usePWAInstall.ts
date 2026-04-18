import { useState, useEffect } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isMobileOrTablet() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const touchDevice = navigator.maxTouchPoints > 1 || window.matchMedia("(pointer: coarse)").matches;
  const smallOrTabletScreen = window.matchMedia("(max-width: 1024px)").matches;
  return touchDevice && (smallOrTabletScreen || /android|iphone|ipad|ipod|mobile|tablet/.test(ua));
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isSupportedDevice, setIsSupportedDevice] = useState(false);

  useEffect(() => {
    const supported = isMobileOrTablet() && !isStandalone();
    setIsSupportedDevice(supported);

    const handleBeforeInstallPrompt = (e: Event) => {
      if (!supported) return;
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstallable(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installPWA = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
      setIsInstallable(false);
    }
  };

  return { installPWA, isInstallable: isSupportedDevice && isInstallable };
}
