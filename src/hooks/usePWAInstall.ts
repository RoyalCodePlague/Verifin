import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallInstructions = {
  title: string;
  steps: string[];
};

const INSTALL_PROMPT_EVENT = "verifin:pwa-install-available";
let pendingInstallPrompt: BeforeInstallPromptEvent | null = null;

function isMobileOrTablet() {
  if (typeof window === "undefined") return false;

  const ua = navigator.userAgent.toLowerCase();
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const mobileBrowser = /android|iphone|ipad|ipod|mobile|tablet/.test(ua);
  const touchTablet = navigator.maxTouchPoints > 1
    && window.matchMedia("(max-width: 1024px)").matches;

  return mobileBrowser || isIPadOS || touchTablet;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// Capture this before React effects run; Chromium can fire it during startup.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event: Event) => {
    if (!isMobileOrTablet() || isStandalone()) return;
    event.preventDefault();
    pendingInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
  });
  window.addEventListener("appinstalled", () => {
    pendingInstallPrompt = null;
  });
}

function getInstallInstructions(): InstallInstructions {
  const ua = navigator.userAgent.toLowerCase();
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isIOS = /iphone|ipad|ipod/.test(ua) || isIPadOS;

  if (isIOS) {
    return {
      title: "Install Verifin on your iPhone or iPad",
      steps: [
        "Open this page in Safari if it is not already open there.",
        "Tap the Share button.",
        "Choose Add to Home Screen, then tap Add.",
      ],
    };
  }

  return {
    title: "Install Verifin on your device",
    steps: [
      "Open your browser menu (three dots).",
      "Choose Install app or Add to Home screen.",
      "Confirm the installation.",
    ],
  };
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isSupportedDevice, setIsSupportedDevice] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructions, setInstructions] = useState<InstallInstructions | null>(null);

  useEffect(() => {
    const supported = isMobileOrTablet();
    setIsSupportedDevice(supported);
    setIsInstalled(isStandalone());

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const syncInstalledState = () => setIsInstalled(isStandalone());

    const syncInstallPrompt = () => {
      setDeferredPrompt(pendingInstallPrompt);
    };

    const handleAppInstalled = () => {
      pendingInstallPrompt = null;
      setDeferredPrompt(null);
      setInstructionsOpen(false);
      setIsInstalled(true);
    };

    displayMode.addEventListener("change", syncInstalledState);
    window.addEventListener(INSTALL_PROMPT_EVENT, syncInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    syncInstallPrompt();

    return () => {
      displayMode.removeEventListener("change", syncInstalledState);
      window.removeEventListener(INSTALL_PROMPT_EVENT, syncInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const installPWA = async () => {
    const prompt = deferredPrompt;
    if (!prompt) {
      setInstructions(getInstallInstructions());
      setInstructionsOpen(true);
      return;
    }

    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalled(true);
    } catch {
      setInstructions(getInstallInstructions());
      setInstructionsOpen(true);
    } finally {
      pendingInstallPrompt = null;
      setDeferredPrompt(null);
    }
  };

  const closeInstructions = () => setInstructionsOpen(false);

  return {
    closeInstructions,
    installPWA,
    installInstructions: instructions,
    isInstallable: isSupportedDevice && !isInstalled,
    instructionsOpen,
  };
}
