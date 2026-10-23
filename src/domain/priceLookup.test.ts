import { describe, expect, it } from "vitest";
import { priceLookupLinks } from "./priceLookup";

describe("price lookup links", () => {
  it("searches Wholesale Marine by part number and Google by manufacturer and part number", () => {
    expect(priceLookupLinks({ mfrPartNumber: " 47-8M0137219 ", manufacturer: "Mercury" })).toEqual([
      { label: "Wholesale Marine", url: "https://www.wholesalemarine.com/search.php?search_query=47-8M0137219" },
      { label: "Google", url: "https://www.google.com/search?q=Mercury%2047-8M0137219%20price" },
    ]);
  });

  it("encodes odd characters and leaves out a blank manufacturer", () => {
    const [wm, g] = priceLookupLinks({ mfrPartNumber: "A&B #1/2", manufacturer: "  " });
    expect(wm.url).toBe("https://www.wholesalemarine.com/search.php?search_query=A%26B%20%231%2F2");
    expect(g.url).toBe("https://www.google.com/search?q=A%26B%20%231%2F2%20price");
  });

  it("offers nothing without a part number", () => {
    expect(priceLookupLinks({ mfrPartNumber: "   ", manufacturer: "Mercury" })).toEqual([]);
  });
});
