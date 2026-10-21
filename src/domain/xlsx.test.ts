import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName } from "./xlsx";

// Reads the stored (uncompressed) entries of a zip file and checks each CRC.
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    expect(view.getUint16(at + 8, true)).toBe(0); // stored
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.subarray(at + 30 + nameLen + extraLen, at + 30 + nameLen + extraLen + size);
    expect(crc32(data) >>> 0).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    at += 30 + nameLen + extraLen + size;
  }
  expect(view.getUint32(at, true)).toBe(0x02014b50); // central directory follows
  return out;
}

describe("xlsx writer", () => {
  it("names columns like Excel", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(27), columnName(701), columnName(702)]).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes a valid workbook with the parts needed by Excel", () => {
    const files = unzip(buildXlsx("Parts", ["Part Number", "Qty"], [["0047-1", 3]]));
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
    ]);
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Parts" sheetId="1" r:id="rId1"/>');
  });

  it("keeps part numbers as text (leading zeros survive) and numbers as numbers", () => {
    const sheet = unzip(buildXlsx("Parts", ["Part Number", "Qty", "Cost"], [["0047", 3, 28.5], ["12345", 0.5, null]]))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>0047</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(sheet).toContain('<c r="C2"><v>28.5</v></c>');
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t>12345</t></is></c>');
    expect(sheet).not.toContain('r="C3"'); // blank cell left out
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Part Number</t></is></c>'); // bold header
  });

  it("escapes XML and drops characters XML can't hold, keeping spaces and line breaks", () => {
    const sheet = unzip(buildXlsx("Parts", ["A"], [['<b>&"x"\u0001 ok\nnext ']]))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<t xml:space="preserve">&lt;b&gt;&amp;&quot;x&quot; ok\nnext </t>');
  });

  it("treats formula-looking text as plain text", () => {
    const sheet = unzip(buildXlsx("Parts", ["A"], [["=1+1"]]))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("<t>=1+1</t>");
    expect(sheet).not.toContain("<f>");
  });

  it("cleans the sheet name to what Excel allows", () => {
    const wb = unzip(buildXlsx("Parts: a/b [old] and a very long name", ["A"], []))["xl/workbook.xml"];
    expect(wb).toContain('<sheet name="Parts a b old and a very long n" sheetId="1"'); // 31 characters at most
  });

  it("skips non-finite numbers rather than writing a broken cell", () => {
    const sheet = unzip(buildXlsx("Parts", ["A", "B"], [[NaN, Infinity]]))["xl/worksheets/sheet1.xml"];
    expect(sheet).not.toContain('r="A2"');
  });
});
