import { describe, expect, it } from "vitest";
import { indexSystems } from "./systems";
import type { System } from "./rules";

const sys = (id: string, name: string, sortOrder: number, over: Partial<System> = {}): System => ({ id, name, sortOrder, active: true, parentId: null, ...over });

const systems: System[] = [
  sys("mercury-m01", "MERCURY (M01)", 2),
  sys("honda-m02", "HONDA (M02)", 3),
  sys("plumbing-s02", "PLUMBING (S02)", 1),
  sys("water-pumps", "Water pumps", 9, { parentId: "mercury-m01" }),
  sys("thermostats", "Thermostats", 8, { parentId: "mercury-m01" }),
  sys("old-sub", "Old sub", 10, { parentId: "mercury-m01", active: false }),
  { id: "legacy", name: "Legacy", sortOrder: 4, active: true } as System, // synced before sub-systems existed
];
const idx = indexSystems(systems);

describe("system index", () => {
  it("lists main systems in order, treating a missing parent as a main system", () => {
    expect(idx.mains.map((s) => s.id)).toEqual(["plumbing-s02", "mercury-m01", "honda-m02", "legacy"]);
  });

  it("lists a main system's sub-systems in order", () => {
    expect(idx.subs("mercury-m01").map((s) => s.id)).toEqual(["thermostats", "water-pumps", "old-sub"]);
    expect(idx.subs("honda-m02")).toEqual([]);
  });

  it("finds the main system and sub-system behind a part's system", () => {
    expect([idx.mainOf("water-pumps"), idx.subOf("water-pumps")]).toEqual(["mercury-m01", "water-pumps"]);
    expect([idx.mainOf("mercury-m01"), idx.subOf("mercury-m01")]).toEqual(["mercury-m01", null]);
    expect([idx.mainOf(null), idx.subOf(null)]).toEqual([null, null]);
    expect(idx.mainOf("gone")).toBeNull();
  });

  it("labels a sub-system with its main system", () => {
    expect(idx.label("water-pumps")).toBe("MERCURY (M01) › Water pumps");
    expect(idx.label("honda-m02")).toBe("HONDA (M02)");
    expect(idx.label(null)).toBe("");
  });

  it("counts a part in a sub-system as inside its main system", () => {
    expect(idx.within("water-pumps", "mercury-m01")).toBe(true);
    expect(idx.within("water-pumps", "water-pumps")).toBe(true);
    expect(idx.within("mercury-m01", "water-pumps")).toBe(false);
    expect(idx.within("honda-m02", "mercury-m01")).toBe(false);
    expect(idx.within(null, "mercury-m01")).toBe(false);
  });

  it("builds a part code from the system codes in brackets and the mfr part number", () => {
    const withCodes = indexSystems([
      sys("mercury-m01", "MERCURY (M01)", 1),
      sys("01", "Cooling (01)", 2, { parentId: "mercury-m01" }),
      sys("plain", "Belts", 3),
      sys("plain-sub", "V-belts", 4, { parentId: "plain" }),
    ]);
    expect(withCodes.code("01", " 47-8M0137219 ")).toBe("M01-01-47-8M0137219");
    expect(withCodes.code("mercury-m01", "47-8M0137219")).toBe("M01-47-8M0137219");
    expect(withCodes.code("plain-sub", "7420")).toBe("Belts-V-belts-7420"); // no code in brackets: the name
    expect(withCodes.code(null, "7420")).toBe("7420");
    expect(withCodes.code("01", "")).toBe("M01-01");
    expect(withCodes.code(null, "  ")).toBe("");
  });

  it("builds a picker list of main systems each followed by their sub-systems", () => {
    expect(idx.options().map((o) => o.label)).toEqual([
      "PLUMBING (S02)",
      "MERCURY (M01)",
      "— Thermostats",
      "— Water pumps",
      "— Old sub",
      "HONDA (M02)",
      "Legacy",
    ]);
  });
});
