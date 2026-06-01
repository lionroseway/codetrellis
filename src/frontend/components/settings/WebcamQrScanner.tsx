/**
 * Webcam QR scanner — scans the phone's answer QR code via the
 * desktop's camera (webcam or built-in).
 *
 * Uses `jsqr` for QR decoding and `getUserMedia` for camera access.
 * Shows a live preview with a scan overlay. Falls back to a manual
 * paste input if the camera is unavailable or the user prefers it.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, CameraOff, Clipboard, Loader2, X } from 'lucide-react';
import jsQR from 'jsqr';

interface WebcamQrScannerProps {
  /** Called when a valid QR code is decoded. */
  onScan: (data: string) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

export function WebcamQrScanner({ onScan, onCancel }: WebcamQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<'loading' | 'active' | 'denied' | 'unavailable'>('loading');
  const [showManual, setShowManual] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  // Start camera
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        setCameraState('active');
      } catch (err) {
        if (cancelled) return;
        const error = err as DOMException;
        if (error.name === 'NotAllowedError') {
          setCameraState('denied');
        } else {
          setCameraState('unavailable');
        }
        console.warn('[WebcamQR] Camera error:', err);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Scan loop — decode QR from video frames
  useEffect(() => {
    if (cameraState !== 'active') return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    function scanFrame() {
      if (scannedRef.current || !video || !canvas || !ctx) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code?.data) {
          // Validate it looks like a v3 answer QR
          try {
            const parsed = JSON.parse(code.data);
            if (parsed.v === 3 && parsed.t === 'a') {
              scannedRef.current = true;
              onScan(code.data);
              return; // Stop scanning
            }
          } catch {
            // Not valid JSON — keep scanning
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame);
    }

    // Wait a moment for video to settle before starting scan
    const startDelay = setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(scanFrame);
    }, 300);

    return () => {
      clearTimeout(startDelay);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraState, onScan]);

  const handleManualSubmit = useCallback(() => {
    setManualError(null);
    const input = manualInput.trim();
    if (!input) {
      setManualError('Please paste the answer QR JSON');
      return;
    }
    try {
      const parsed = JSON.parse(input);
      if (parsed.v !== 3 || parsed.t !== 'a') {
        setManualError('Invalid format — expected a v3 answer QR');
        return;
      }
      onScan(input);
    } catch {
      setManualError('Invalid JSON');
    }
  }, [manualInput, onScan]);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Camera feed or fallback */}
      {!showManual && (
        <>
          {cameraState === 'loading' && (
            <div className="w-[280px] h-[210px] bg-black/40 rounded-lg flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-foreground-subtle" />
            </div>
          )}

          {cameraState === 'active' && (
            <div className="relative">
              <video
                ref={videoRef}
                className="w-[280px] h-[210px] object-cover rounded-lg bg-black"
                muted
                playsInline
              />
              {/* Scan overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[160px] h-[160px] border-2 border-accent/60 rounded-lg" />
              </div>
              {/* Hidden canvas for decoding */}
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}

          {(cameraState === 'denied' || cameraState === 'unavailable') && (
            <div className="w-[280px] h-[120px] bg-white/[0.02] border border-white/[0.06] rounded-lg flex flex-col items-center justify-center gap-2">
              <CameraOff size={20} className="text-foreground-subtle" />
              <p className="text-[11px] text-foreground-subtle text-center px-4">
                {cameraState === 'denied'
                  ? 'Camera access denied. Please allow camera access in your browser settings.'
                  : 'No camera available on this device.'}
              </p>
            </div>
          )}

          <p className="text-[11px] text-foreground-muted text-center max-w-[280px]">
            Point your webcam at the QR code on your phone's screen
          </p>
        </>
      )}

      {/* Manual paste fallback */}
      {showManual && (
        <div className="w-full space-y-2">
          <p className="text-[11px] text-foreground-muted">
            Paste the answer QR JSON from your phone:
          </p>
          <textarea
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder='{"v":3,"t":"a","n":"...","iu":"...","ip":"...","fp":"...","a":"...","cp":...,"cc":"..."}'
            className="w-full h-[80px] bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[11px] text-foreground font-mono resize-none focus:outline-none focus:border-accent/40"
            autoFocus
          />
          {manualError && (
            <p className="text-[10px] text-red-400">{manualError}</p>
          )}
          <button
            onClick={handleManualSubmit}
            className="w-full px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-md text-[12px] font-medium transition-colors"
          >
            Submit
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowManual(!showManual)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-foreground-subtle hover:text-foreground bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors"
        >
          {showManual ? (
            <>
              <Camera size={12} />
              Use Camera
            </>
          ) : (
            <>
              <Clipboard size={12} />
              Enter Manually
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-foreground-subtle hover:text-foreground bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors"
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}
