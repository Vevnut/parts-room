// Right-click menu (long-press on a phone). On a part or bin row it offers that item's
// common actions; anywhere else it's a jump menu to every screen. Text fields keep the
// browser's own menu so copy/paste still works, and Shift+right-click always gives it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "./db/db";
import { adjustQty, deletePart, duplicatePart, putAwayBin, setMovedBack } from "./db/repo";
import { binStats, isKept, type Bin, type Part } from "./domain/rules";
import { fmtQty, useToast } from "./ui";

export type MenuTarget = { kind: "part"; part: Part; binCode: string | null } | { kind: "bin"; bin: Bin; notPutAway: number } | { kind: "page" };

export interface MenuItem {
  id: string;
  label: string;
  run?: () => unknown;
  danger?: boolean;
  disabled?: boolean;
  confirmLabel?: string;
}

export interface MenuDeps {
  navigate: (to: string | number) => void;
  toast: (msg: string) => void;
  copy: (text: string) => Promise<boolean>;
}

const SEP: MenuItem = { id: "sep", label: "" };

function navItems(d: MenuDeps): MenuItem[] {
  const go = (id: string, label: string, to: string | number): MenuItem => ({ id: `nav-${id}`, label, run: () => d.navigate(to) });
  return [
    go("back", "Back", -1),
    go("home", "Home", "/"),
    go("quick-add", "Quick add", "/add"),
    go("parts", "Parts", "/parts"),
    go("bins", "Bins", "/bins"),
    go("needs-bin", "Needs bin", "/queue/needs-bin"),
    go("staged", "Staged", "/queue/staged"),
    go("systems", "Systems", "/systems"),
    go("export", "Export for Lightspeed", "/export"),
    go("sync", "Sync & backup", "/more"),
  ];
}

export function buildMenu(t: MenuTarget, d: MenuDeps): MenuItem[] {
  const copy = async (text: string, what: string) => d.toast((await d.copy(text)) ? `Copied ${what}` : "Couldn't copy. Select the text instead.");

  if (t.kind === "part") {
    const p = t.part;
    const items: MenuItem[] = [{ id: "open", label: "Open part", run: () => d.navigate(`/parts/${p.id}`) }];
    if (t.binCode) items.push({ id: "go-bin", label: `Go to bin ${t.binCode}`, run: () => d.navigate(`/b/${encodeURIComponent(t.binCode!)}`) });
    if (isKept(p) && p.binId) {
      items.push({
        id: "put-away",
        label: p.movedBack ? "Mark not put away" : "Mark put away",
        run: async () => {
          await setMovedBack(p.id, !p.movedBack);
          d.toast(p.movedBack ? `${p.partId} back to staged` : `${p.partId} put away`);
        },
      });
    }
    items.push(
      { id: "plus", label: `Add 1 (now ${fmtQty(p.qty)})`, run: async () => d.toast(`${p.partId}: qty ${fmtQty(await adjustQty(p.id, 1))}`) },
      { id: "minus", label: "Remove 1", disabled: p.qty <= 0, run: async () => d.toast(`${p.partId}: qty ${fmtQty(await adjustQty(p.id, -1))}`) },
      { id: "copy-id", label: "Copy Part ID", run: () => copy(p.partId, p.partId) },
    );
    if (p.mfrPartNumber) items.push({ id: "copy-number", label: "Copy part number", run: () => copy(p.mfrPartNumber, p.mfrPartNumber) });
    items.push({
      id: "duplicate",
      label: "Duplicate part",
      run: async () => {
        const c = await duplicatePart(p.id);
        d.toast(`Copied to ${c.partId}`);
        d.navigate(`/parts/${c.id}`);
      },
    });
    items.push({
      id: "delete",
      label: "Delete part",
      danger: true,
      confirmLabel: "Tap again to delete",
      run: async () => {
        await deletePart(p.id);
        d.toast(`Deleted ${p.partId}`);
      },
    });
    return [...items, SEP, ...navItems(d)];
  }

  if (t.kind === "bin") {
    const b = t.bin;
    const items: MenuItem[] = [
      { id: "open-bin", label: "Open bin", run: () => d.navigate(`/b/${encodeURIComponent(b.binCode)}`) },
      { id: "edit-bin", label: "Edit bin", run: () => d.navigate(`/bins/${b.id}/edit`) },
      { id: "add-parts", label: "Add parts to this bin", run: () => d.navigate(`/queue/needs-bin?bin=${b.id}`) },
    ];
    if (t.notPutAway > 0) {
      items.push({
        id: "put-away-all",
        label: `Put away all (${t.notPutAway})`,
        run: async () => {
          const n = await putAwayBin(b.id);
          d.toast(`${n} put away in ${b.binCode}`);
        },
      });
    }
    items.push({ id: "copy-bin", label: "Copy bin ID", run: () => copy(b.binCode, b.binCode) });
    return [...items, SEP, ...navItems(d)];
  }

  return navItems(d);
}

async function resolveTarget(el: Element | null): Promise<{ target: MenuTarget; title: string }> {
  const ctx = el?.closest("[data-ctx]")?.getAttribute("data-ctx") ?? "";
  const [kind, id] = ctx.split(":");
  if (kind === "part" && id) {
    const part = await db.parts.get(id);
    if (part && !part.deletedAt) {
      const bin = part.binId ? await db.bins.get(part.binId) : undefined;
      return { target: { kind: "part", part, binCode: bin && !bin.deletedAt ? bin.binCode : null }, title: `${part.partId} · ${part.name}` };
    }
  }
  if (kind === "bin" && id) {
    const bin = await db.bins.get(id);
    if (bin && !bin.deletedAt) {
      const parts = await db.parts.where("binId").equals(id).toArray();
      return { target: { kind: "bin", bin, notPutAway: binStats(id, parts).notPutAway }, title: `Bin ${bin.binCode}` };
    }
  }
  return { target: { kind: "page" }, title: "Go to" };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface OpenMenu {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
}

const LONG_PRESS_MS = 550;

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const lastTouchOpen = useRef(0);
  const swallowClick = useRef(false);

  const deps: MenuDeps = { navigate: (to) => (typeof to === "number" ? navigate(to) : navigate(to)), toast, copy: copyText };
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const close = useCallback(() => {
    setMenu(null);
    setArmed(null);
  }, []);

  const open = useCallback(async (el: Element | null, x: number, y: number) => {
    const { target, title } = await resolveTarget(el);
    setArmed(null);
    setMenu({ x, y, title, items: buildMenu(target, depsRef.current) });
  }, []);

  // Right-click (and Android long-press, which fires contextmenu too).
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const el = e.target as Element;
      if (e.shiftKey || el.closest("input, textarea, select, [contenteditable='true']")) return;
      if (window.getSelection()?.toString()) return; // let them copy selected text
      e.preventDefault();
      if (Date.now() - lastTouchOpen.current < 1000) return;
      void open(el, e.clientX, e.clientY);
    };
    document.addEventListener("contextmenu", onContext);
    return () => document.removeEventListener("contextmenu", onContext);
  }, [open]);

  // Long-press on rows for iPhone, which never fires contextmenu.
  useEffect(() => {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    const cancel = () => {
      window.clearTimeout(timer);
      start = null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const row = (e.target as Element).closest("[data-ctx]");
      if (!row) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        lastTouchOpen.current = Date.now();
        swallowClick.current = true;
        void open(row, start!.x, start!.y);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    };
    const onClick = (e: MouseEvent) => {
      if (swallowClick.current) {
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", cancel);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("click", onClick, true);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cancel);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("click", onClick, true);
    };
  }, [open]);

  // Close on navigation, outside click, Escape, scroll or resize.
  useEffect(() => {
    close();
  }, [location.pathname, location.search, close]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, close]);

  // Keep the menu on screen, and put focus on the first item for keyboard use.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    el.style.left = `${Math.max(pad, Math.min(menu.x, window.innerWidth - r.width - pad))}px`;
    el.style.top = `${Math.max(pad, Math.min(menu.y, window.innerHeight - r.height - pad))}px`;
    el.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
  }, [menu]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  async function choose(item: MenuItem) {
    if (item.confirmLabel && armed !== item.id) {
      setArmed(item.id);
      return;
    }
    close();
    try {
      await item.run?.();
    } catch (err) {
      toast((err as Error).message || "That didn't work.");
    }
  }

  return (
    <>
      {children}
      {menu && (
        <div ref={ref} className="ctx-menu" role="menu" aria-label={menu.title} style={{ left: menu.x, top: menu.y }} onKeyDown={onMenuKey}>
          <div className="ctx-title">{menu.title}</div>
          {menu.items.map((item, i) =>
            item.id === "sep" ? (
              <div key={`sep-${i}`} className="ctx-sep" role="separator" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`ctx-item${item.danger ? " danger" : ""}${armed === item.id ? " armed" : ""}`}
                disabled={item.disabled}
                onClick={() => void choose(item)}
              >
                {armed === item.id ? item.confirmLabel : item.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
