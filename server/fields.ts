// The exact fields each synced table accepts. Anything else in a pushed row is dropped.
import { CONDITIONS, DISPOSITIONS, validatePart, type Part } from "../src/domain/rules.js";
import type { TableName, WireRow } from "./store.js";

type Kind = "uuid" | "slug" | "text" | "longtext" | "num" | "int" | "bool" | "date" | "ts" | "condition" | "disposition";
interface FieldSpec {
  kind: Kind;
  nullable?: boolean;
}

const text = { kind: "text" } as const;
const numN = { kind: "num", nullable: true } as const;
const tsF = { kind: "ts" } as const;
const tsN = { kind: "ts", nullable: true } as const;

export const FIELDS: Record<TableName, Record<string, FieldSpec>> = {
  parts: {
    id: { kind: "uuid" },
    partId: text,
    name: text,
    systemId: { kind: "slug", nullable: true },
    qty: { kind: "num" },
    condition: { kind: "condition", nullable: true },
    disposition: { kind: "disposition", nullable: true },
    oldLocation: text,
    binId: { kind: "uuid", nullable: true },
    movedBack: { kind: "bool" },
    manufacturer: text,
    mfrPartNumber: text,
    supplier: text,
    minQty: numN,
    reorderQty: numN,
    unitCost: numN,
    retailPrice: numN,
    lastCounted: { kind: "date", nullable: true },
    replaceBy: { kind: "date", nullable: true },
    photoLink: text,
    notes: { kind: "longtext" },
    needsDetails: { kind: "bool" },
    createdAt: tsF,
    updatedAt: tsF,
    deletedAt: tsN,
  },
  bins: {
    id: { kind: "uuid" },
    binCode: text,
    shelfZone: text,
    binSize: text,
    labelText: text,
    createdAt: tsF,
    updatedAt: tsF,
    deletedAt: tsN,
  },
  systems: {
    id: { kind: "slug" },
    name: text,
    sortOrder: { kind: "int" },
    active: { kind: "bool" },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function check(kind: Kind, v: unknown): boolean {
  switch (kind) {
    case "uuid":
      return typeof v === "string" && UUID.test(v);
    case "slug":
      return typeof v === "string" && SLUG.test(v);
    case "text":
      return typeof v === "string" && v.length <= 500;
    case "longtext":
      return typeof v === "string" && v.length <= 10_000;
    case "num":
      return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;
    case "int":
      return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e6;
    case "bool":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
    case "ts":
      return typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
    case "condition":
      return (CONDITIONS as readonly unknown[]).includes(v);
    case "disposition":
      return (DISPOSITIONS as readonly unknown[]).includes(v);
  }
}

export type Sanitized = { ok: true; row: WireRow } | { ok: false; reason: string };

export function sanitize(table: TableName, input: unknown): Sanitized {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "Row must be an object." };
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(FIELDS[table])) {
    const v = Object.prototype.hasOwnProperty.call(src, name) ? src[name] : undefined;
    if (v === null || v === undefined) {
      if (!spec.nullable) return { ok: false, reason: `${name} is required.` };
      out[name] = null;
    } else if (!check(spec.kind, v)) {
      return { ok: false, reason: `${name} is not valid.` };
    } else {
      out[name] = v;
    }
  }
  if (table === "parts" && !out.deletedAt) {
    const errors = validatePart(out as unknown as Part);
    const first = Object.values(errors)[0];
    if (first) return { ok: false, reason: first };
  }
  if (table === "bins" && !String(out.binCode).trim()) return { ok: false, reason: "binCode is required." };
  return { ok: true, row: out as WireRow };
}

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
