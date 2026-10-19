// Quick add's form, and what carries over from one part to the next while you work
// through a bin: the system, manufacturer and old location stay; everything else clears.
import type { Disposition } from "./rules.js";

export interface QuickAddForm {
  name: string;
  mfrPartNumber: string;
  manufacturer: string;
  oldLocation: string;
  systemId: string | null;
  qty: number;
  disposition: Disposition | null;
}

export const blankQuickAdd = (): QuickAddForm => ({ name: "", mfrPartNumber: "", manufacturer: "", oldLocation: "", systemId: null, qty: 1, disposition: "Keep" });

export function nextQuickAddForm(prev: QuickAddForm): QuickAddForm {
  return { ...blankQuickAdd(), systemId: prev.systemId, manufacturer: prev.manufacturer, oldLocation: prev.oldLocation };
}
