// Turns what the camera read off a box into a part number. A bare 12/13-digit number is the
// box's UPC/EAN retail barcode, not the manufacturer part number, so it's flagged for checking.

export interface ScanResult {
  value: string;
  upc: boolean;
}

export function readScan(raw: string): ScanResult | null {
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase();
  if (!value) return null;
  return { value, upc: /^\d{12,13}$/.test(value) };
}
