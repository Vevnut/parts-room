import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/db";
import { adjustQty, ensureSeeded, quickAdd, saveBin, savePart } from "./db/repo";
import { ContextMenuProvider, buildMenu } from "./ContextMenu";
import type { Part } from "./domain/rules";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

const deps = () => ({ navigate: vi.fn(), toast: vi.fn(), copy: vi.fn(async () => true) });
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("menu items for a part", () => {
  it("offers open, bin, put away, quantity, copy and delete, then navigation", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const p = await savePart({ partId: "MP-0001", name: "Impeller", qty: 2, binId: bin.id, mfrPartNumber: "47-43026Q06" });
    const items = buildMenu({ kind: "part", part: p, binCode: "A1-01" }, deps());
    expect(ids(items).slice(0, 10)).toEqual(["open", "go-bin", "put-away", "plus", "minus", "copy-id", "copy-number", "duplicate", "delete", "sep"]);
    expect(items.find((i) => i.id === "put-away")!.label).toBe("Mark put away");
    expect(items.find((i) => i.id === "delete")!.confirmLabel).toBeTruthy();
    expect(ids(items)).toContain("nav-quick-add");
  });

  it("leaves out bin actions for a tossed part and disables Remove 1 at zero", async () => {
    const p = await savePart({ partId: "MP-0002", name: "Old gasket", qty: 0, disposition: "Toss" });
    const items = buildMenu({ kind: "part", part: p, binCode: null }, deps());
    expect(ids(items)).not.toContain("put-away");
    expect(ids(items)).not.toContain("go-bin");
    expect(items.find((i) => i.id === "minus")!.disabled).toBe(true);
  });

  it("navigates and copies through the given helpers", async () => {
    const p = await savePart({ partId: "MP-0003", name: "Filter", qty: 1 });
    const d = deps();
    const items = buildMenu({ kind: "part", part: p, binCode: null }, d);
    await items.find((i) => i.id === "open")!.run!();
    expect(d.navigate).toHaveBeenCalledWith(`/parts/${p.id}`);
    await items.find((i) => i.id === "copy-id")!.run!();
    expect(d.copy).toHaveBeenCalledWith("MP-0003");
  });
});

describe("menu items for a bin", () => {
  it("offers open, edit, add parts, put away all and copy", async () => {
    const bin = await saveBin({ binCode: "B2-03" });
    const items = buildMenu({ kind: "bin", bin, notPutAway: 2 }, deps());
    expect(ids(items).slice(0, 5)).toEqual(["open-bin", "edit-bin", "add-parts", "put-away-all", "copy-bin"]);
    expect(ids(buildMenu({ kind: "bin", bin, notPutAway: 0 }, deps()))).not.toContain("put-away-all");
  });
});

describe("adjustQty", () => {
  it("changes the quantity, never below zero, and queues the change for sync", async () => {
    const p = await quickAdd({ name: "Impeller", systemId: null, qty: 1, disposition: null });
    await db.outbox.clear();
    await adjustQty(p.id, 1);
    expect((await db.parts.get(p.id))!.qty).toBe(2);
    await adjustQty(p.id, -5);
    expect((await db.parts.get(p.id))!.qty).toBe(0);
    expect(await db.outbox.get(["parts", p.id])).toBeTruthy();
  });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe("right-click on the page", () => {
  async function setup(part: Part) {
    render(
      <MemoryRouter initialEntries={["/parts"]}>
        <ContextMenuProvider>
          <div data-ctx={`part:${part.id}`}>Impeller row</div>
          <input aria-label="notes" />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </ContextMenuProvider>
      </MemoryRouter>,
    );
  }

  it("opens the part menu on a row and runs an item", async () => {
    const p = await savePart({ partId: "MP-0009", name: "Impeller", qty: 1 });
    await setup(p);
    fireEvent.contextMenu(screen.getByText("Impeller row"), { clientX: 50, clientY: 60 });
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("MP-0009");
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /open part/i }));
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent(`/parts/${p.id}`);
  });

  it("asks twice before deleting", async () => {
    const p = await savePart({ partId: "MP-0010", name: "Impeller", qty: 1 });
    await setup(p);
    fireEvent.contextMenu(screen.getByText("Impeller row"));
    const del = await screen.findByRole("menuitem", { name: /delete part/i });
    fireEvent.click(del);
    expect((await db.parts.get(p.id))!.deletedAt).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: /tap again/i }));
    await waitFor(async () => expect((await db.parts.get(p.id))!.deletedAt).not.toBeNull());
  });

  it("closes on Escape", async () => {
    const p = await savePart({ partId: "MP-0011", name: "Impeller", qty: 1 });
    await setup(p);
    fireEvent.contextMenu(screen.getByText("Impeller row"));
    await screen.findByRole("menu");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the normal browser menu alone in text fields", async () => {
    const p = await savePart({ partId: "MP-0012", name: "Impeller", qty: 1 });
    await setup(p);
    const notPrevented = fireEvent.contextMenu(screen.getByLabelText("notes"));
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
