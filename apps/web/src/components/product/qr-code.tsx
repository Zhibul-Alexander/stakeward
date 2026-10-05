import { cn } from 'cn';
import { toSvgPath } from 'lean-qr/extras/svg';
import { correction, generate, type Bitmap2D } from 'lean-qr/nano';
import { useMemo } from 'react';
import { t } from '@/i18n';

/** The light margin around the code, in modules: ISO 18004 asks for 4 so a camera finds the edges. */
const QUIET_ZONE = 4;

/** The code for `value` at correction level L (the most room for data), or null when `value` does not fit. */
function qrBitmap(value: string): Bitmap2D | null {
  try {
    return generate(value, { minCorrectionLevel: correction.L });
  } catch {
    // lean-qr throws when the text is longer than the largest code (version 40) holds.
    return null;
  }
}

/** Modules per side of the QR code for `value` (21 for version 1 up to 177 for version 40); null when it does not fit. */
export function qrModules(value: string): number | null {
  return qrBitmap(value)?.size ?? null;
}

/**
 * A QR code for a phone camera: the signing link (/cosign) or a wallet address to fund. Drawn as one SVG path in the
 * qr-dark/qr-light tokens, the same in both themes because scanners need dark modules on a light ground. No style
 * attribute, no <style> element and no data: URI, so it renders under the strict CSP (DECISIONS.md D71). When the
 * text is too long for a QR code it says so; the page always shows the text itself too (the link with Copy).
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string | undefined }) {
  const code = useMemo(() => {
    const bitmap = qrBitmap(value);
    return bitmap === null ? null : { size: bitmap.size, path: toSvgPath(bitmap) };
  }, [value]);
  if (code === null) return <p className={cn('text-sm text-muted', className)}>{t('components.qr.tooLong')}</p>;
  const side = code.size + 2 * QUIET_ZONE;
  return (
    <svg
      data-slot="qr-code"
      role="img"
      aria-label={label}
      viewBox={`${String(-QUIET_ZONE)} ${String(-QUIET_ZONE)} ${String(side)} ${String(side)}`}
      shapeRendering="crispEdges"
      className={cn('aspect-square w-full max-w-80', className)}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={side} height={side} className="fill-qr-light" />
      <path d={code.path} className="fill-qr-dark" />
    </svg>
  );
}
