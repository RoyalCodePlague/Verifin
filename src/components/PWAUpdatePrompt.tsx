import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAUpdate } from "@/hooks/usePWAUpdate";

export function PWAUpdatePrompt() {
  const { dismissUpdate, isUpdateAvailable, refreshNow } = usePWAUpdate();

  if (!isUpdateAvailable) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg border border-border bg-card p-4 text-card-foreground shadow-elevated">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <RefreshCw className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold">Update available</p>
          <p className="mt-1 text-sm text-muted-foreground">Refresh to load the latest version. Your login stays saved.</p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={refreshNow} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh now
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissUpdate}>
              Later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismissUpdate}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Dismiss update"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
