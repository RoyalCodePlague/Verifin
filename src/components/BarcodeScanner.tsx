import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

export function BarcodeScanner({ open, onClose, onDetected }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const closingRef = useRef(false);
  const [error, setError] = useState("");
  const mountId = "barcode-reader";

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;

    try {
      if (scanner.isScanning) await scanner.stop();
    } catch (err) {
      console.warn("Scanner stop failed", err);
    }

    try {
      await scanner.clear();
    } catch (err) {
      console.warn("Scanner clear failed", err);
    }
  };

  const closeScanner = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    void stopScanner().finally(() => {
      closingRef.current = false;
      onClose();
    });
  };

  useEffect(() => {
    if (!open) {
      setError("");
      void stopScanner();
      return;
    }

    const timeout = setTimeout(() => {
      const target = document.getElementById(mountId);
      if (!target || scannerRef.current) return;

      const scanner = new Html5Qrcode(mountId);
      scannerRef.current = scanner;

      scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onDetected(decodedText);
          closeScanner();
        },
        () => {}
      ).catch((err) => {
        setError("Camera access denied or unavailable. Please allow camera permissions.");
        console.warn("Scanner error:", err);
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
      void stopScanner();
    };
  }, [open, onClose, onDetected]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeScanner(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" /> Scan Barcode / QR Code
          </DialogTitle>
          <DialogDescription>
            Use your device camera to scan a product barcode or QR code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div id={mountId} className="w-full min-h-[280px] rounded-lg overflow-hidden bg-muted" />
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
          <p className="text-xs text-muted-foreground text-center">
            Point your camera at a barcode or QR code to scan it.
          </p>
          <Button variant="outline" onClick={closeScanner} className="w-full">Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
