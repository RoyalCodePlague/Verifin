import { useState, useEffect } from 'react';

const INSTALL_PROMPT_SEEN_KEY = "sp_pwa_install_prompt_seen";
const APP_INSTALLED_KEY = "sp_pwa_installed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NavigatorWithInstalledApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; id?: string; url?: string }>>;
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

function hasSeenInstallPrompt() {
  return localStorage.getItem(INSTALL_PROMPT_SEEN_KEY) === "1";
}

function markInstallPromptSeen() {
  localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, "1");
}

function markInstalled() {
  localStorage.setItem(APP_INSTALLED_KEY, "1");
  markInstallPromptSeen();
}

function isKnownInstalled() {
  return isStandalone() || localStorage.getItem(APP_INSTALLED_KEY) === "1";
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isSupportedDevice, setIsSupportedDevice] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const knownInstalled = isKnownInstalled();
    const supported = isMobileOrTablet() && !knownInstalled && !hasSeenInstallPrompt();
    setIsInstalled(knownInstalled);
    setIsSupportedDevice(supported);

    const checkInstalledRelatedApps = async () => {
      try {
        const apps = await (navigator as NavigatorWithInstalledApps).getInstalledRelatedApps?.();
        if (apps?.length) {
          markInstalled();
          setIsInstalled(true);
          setIsSupportedDevice(false);
          setIsInstallable(false);
        }
      } catch {
        /* Unsupported on most browsers. display-mode and appinstalled cover the normal cases. */
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      if (!supported || isKnownInstalled() || hasSeenInstallPrompt()) return;
      e.preventDefault();
      markInstallPromptSeen();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      markInstalled();
      setDeferredPrompt(null);
      setIsInstallable(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    void checkInstalledRelatedApps();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installPWA = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        markInstalled();
        setIsInstalled(true);
      }
    } finally {
      setDeferredPrompt(null);
      setIsInstallable(false);
    }
  };

  return { installPWA, isInstallable: isSupportedDevice && isInstallable && !isInstalled, isInstalled };
}
