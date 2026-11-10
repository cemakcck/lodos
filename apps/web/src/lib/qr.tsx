import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** The QR code for `text` as an SVG string (qrcode's own renderer). Medium error correction, 2-module quiet zone. */
export function toQrSvg(text: string, color: { dark?: string; light?: string } = {}): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: color.dark ?? "#000000", light: color.light ?? "#ffffff" },
  });
}

interface Parsed { viewBox: string; d: string }

function parse(svg: string): Parsed | null {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const d = /<path[^>]*stroke="[^"]*"[^>]*d="([^"]+)"/.exec(svg)?.[1];
  return viewBox && d ? { viewBox, d } : null;
}

/** A QR code rendered as a real `<svg>` element (no innerHTML), labelled for screen readers. */
export function QrSvg({
  value, size = 176, label, dark = "#18161a", light = "#ffffff", className,
}: { value: string; size?: number; label: string; dark?: string; light?: string; className?: string }) {
  const [state, setState] = useState<{ value: string; parsed: Parsed | null } | null>(null);
  useEffect(() => {
    let live = true;
    void toQrSvg(value).then((s) => {
      if (live) setState({ value, parsed: parse(s) });
    });
    return () => {
      live = false;
    };
  }, [value]);

  const parsed = state?.value === value ? state.parsed : null;
  if (!parsed) return <span className={className} style={{ display: "block", width: size, height: size }} aria-busy="true" />;
  return (
    <svg
      data-qr=""
      role="img"
      aria-label={label}
      viewBox={parsed.viewBox}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width="100%" height="100%" fill={light} />
      <path stroke={dark} d={parsed.d} />
    </svg>
  );
}
