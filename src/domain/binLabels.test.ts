import { describe, expect, it } from "vitest";
import { binCodeFromScan, binLabelUrl } from "./binLabels";

describe("bin label links", () => {
  it("points at the bin's page on this site", () => {
    expect(binLabelUrl("https://parts-room-azure.vercel.app", "A1-01")).toBe("https://parts-room-azure.vercel.app/b/A1-01");
    expect(binLabelUrl("https://parts-room-azure.vercel.app/", "MERC MISC 1")).toBe("https://parts-room-azure.vercel.app/b/MERC%20MISC%201");
  });
});

describe("reading a scanned bin label", () => {
  it("takes the bin code from a label link, whatever the case", () => {
    expect(binCodeFromScan("https://parts-room-azure.vercel.app/b/A1-01")).toBe("A1-01");
    expect(binCodeFromScan("HTTPS://PARTS-ROOM-AZURE.VERCEL.APP/B/MERC%20MISC%201")).toBe("MERC MISC 1");
    expect(binCodeFromScan("http://localhost:5173/b/a1-02?x=1")).toBe("A1-02");
  });
  it("accepts a bare bin code, and ignores blanks or other links", () => {
    expect(binCodeFromScan(" b2-03 ")).toBe("B2-03");
    expect(binCodeFromScan("   ")).toBeNull();
    expect(binCodeFromScan("https://example.com/parts/123")).toBeNull();
  });
});
