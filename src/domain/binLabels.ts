// Bin labels carry a QR code with a link to the bin's page (/b/CODE). Scanning one with the
// phone's camera app opens it; scanning in the app reads the code back out.

export function binLabelUrl(origin: string, binCode: string): string {
  return `${origin.replace(/\/+$/, "")}/b/${encodeURIComponent(binCode)}`;
}

/** The bin code in a scanned label link, or a bare bin code; null for anything else. */
export function binCodeFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    const m = /^https?:\/\/[^/]+\/b\/([^/?#]+)/i.exec(text);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]).trim().toUpperCase() || null;
    } catch {
      return null;
    }
  }
  return text.toUpperCase();
}
