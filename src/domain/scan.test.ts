import { describe, expect, it } from "vitest";
import { readScan } from "./scan";

describe("reading a scanned barcode", () => {
  it("takes a part number as printed, trimmed and upper-cased", () => {
    expect(readScan("  47-8m0137219\n")).toEqual({ value: "47-8M0137219", upc: false });
    expect(readScan("8M0205803")).toEqual({ value: "8M0205803", upc: false });
  });

  it("flags a 12 or 13 digit number as a UPC/EAN, not the part number", () => {
    expect(readScan("745061174252")).toEqual({ value: "745061174252", upc: true });
    expect(readScan("0745061174252")).toEqual({ value: "0745061174252", upc: true });
    expect(readScan("27034897")).toEqual({ value: "27034897", upc: false }); // 8 digits: could be a part number
  });

  it("drops control characters scanners sometimes add, and ignores empty reads", () => {
    expect(readScan("\u001d47-43026Q06\u0004")).toEqual({ value: "47-43026Q06", upc: false });
    expect(readScan("   ")).toBeNull();
  });
});
