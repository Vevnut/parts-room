// Reads a barcode with the phone's back camera and hands back the text. The scanner library
// is only downloaded the first time Scan is tapped.
import { useEffect, useRef, useState } from "react";
import { readScan, type ScanResult } from "../domain/scan";

function cameraMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was refused. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again.";
  return (e as Error)?.message || "Couldn't start the camera.";
}

function ScannerView({ onScan, onClose }: { onScan: (r: ScanResult) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  handler.current = onScan;
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    let done = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here.");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current, (result) => {
          if (!result || done) return;
          const r = readScan(result.getText());
          if (!r) return;
          done = true;
          controls?.stop();
          navigator.vibrate?.(60);
          handler.current(r);
        });
        if (cancelled) controls.stop();
        else setStarting(false);
      } catch (e) {
        if (!cancelled) {
          setStarting(false);
          setError(cameraMessage(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan a barcode">
      <div className="scanner-frame">
        <video ref={video} muted playsInline />
        {!error && <div className="scanner-guide" aria-hidden />}
      </div>
      <p className="scanner-text">
        {error || (starting ? "Starting the camera…" : "Hold the barcode or QR code inside the box. It reads on its own.")}
      </p>
      <button type="button" className="btn big" onClick={onClose}>
        {error ? "Close" : "Cancel"}
      </button>
    </div>
  );
}

export function ScanButton({ onScan, label = "Scan" }: { onScan: (r: ScanResult) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn scan-btn" onClick={() => setOpen(true)} aria-label="Scan a barcode with the camera">
        {label}
      </button>
      {open && (
        <ScannerView
          onClose={() => setOpen(false)}
          onScan={(r) => {
            setOpen(false);
            onScan(r);
          }}
        />
      )}
    </>
  );
}

export const UPC_NOTE = "That's the box's UPC barcode, not the part number. Check the label for the part number, or keep it if that's all there is.";
