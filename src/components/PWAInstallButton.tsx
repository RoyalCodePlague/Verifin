import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

export function PWAInstallButton() {
  const {
    closeInstructions,
    installInstructions,
    installPWA,
    instructionsOpen,
    isInstallable,
  } = usePWAInstall();

  return (
    <>
      {isInstallable && (
        <Button
          onClick={installPWA}
          className="fixed bottom-4 right-4 z-50 shadow-lg bg-green-600 hover:bg-green-700 text-white"
          size="lg"
        >
          <Download className="w-4 h-4 mr-2" />
          Install App
        </Button>
      )}

      {instructionsOpen && installInstructions && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeInstructions();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
            className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-foreground shadow-xl dark:bg-card"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pwa-install-title" className="text-lg font-bold">{installInstructions.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Add Verifin to your home screen for quick access and offline support.</p>
              </div>
              <button
                type="button"
                onClick={closeInstructions}
                aria-label="Close install instructions"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm">
              {installInstructions.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>
        </div>
      )}
    </>
  );
}
