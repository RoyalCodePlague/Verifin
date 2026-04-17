import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

export function BarcodeScanner({ open, onClose, onDetected }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState("");
  const mountId = "barcode-reader";

  useEffect(() => {
    if (!open) return;

    const timeout = setTimeout(() => {
      const scanner = new Html5Qrcode(mountId);
      scannerRef.current = scanner;

      scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onDetected(decodedText);
          scanner.stop().catch(() => {});
          onClose();
        },
        () => {}
      ).catch((err) => {
        setError("Camera access denied or unavailable. Please allow camera permissions.");
        console.error("Scanner error:", err);
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={() => { onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" /> Scan Barcode / QR Code
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div id={mountId} className="w-full min-h-[280px] rounded-lg overflow-hidden bg-muted" />
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">
            Point your camera at a barcode or QR code to scan it.
          </p>
          <Button variant="outline" onClick={onClose} className="w-full">Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
