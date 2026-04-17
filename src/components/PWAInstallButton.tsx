import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";

export function PWAInstallButton() {
  const { installPWA, isInstallable } = usePWAInstall();

  if (!isInstallable) return null;

  return (
    <Button
      onClick={installPWA}
      className="fixed bottom-4 right-4 z-50 shadow-lg bg-green-600 hover:bg-green-700 text-white"
      size="lg"
    >
      <Download className="w-4 h-4 mr-2" />
      Install App
    </Button>
  );
}