// Search links for checking a part's price by its manufacturer part number. They open in a
// new tab; nothing is fetched or filled in automatically.
import type { Part } from "./rules.js";

export interface LookupLink {
  label: string;
  url: string;
}

export function priceLookupLinks(p: Pick<Part, "mfrPartNumber" | "manufacturer">): LookupLink[] {
  const number = p.mfrPartNumber.trim();
  if (!number) return [];
  const query = [p.manufacturer.trim(), number, "price"].filter(Boolean).join(" ");
  return [
    { label: "Wholesale Marine", url: `https://www.wholesalemarine.com/search.php?search_query=${encodeURIComponent(number)}` },
    { label: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(query)}` },
  ];
}
