import { describe, expect, it } from "vitest";
import {
  createSalesRowsAuditSnapshotBuilder,
  decodeSalesRowsAuditSnapshot,
  encodeSalesRowsAuditSnapshot,
  SALES_ROWS_AUDIT_FORMAT,
  SALES_ROWS_AUDIT_MIN_ROWS,
  validateSalesRowsAuditSnapshot,
} from "./salesRowsAuditSnapshot";

function largeRows(extra = {}) {
  return Array.from({ length: SALES_ROWS_AUDIT_MIN_ROWS + 3 }, (_, index) => ({
    id: index + 1, workspaceId: "workspace-default", ledgerId: "L-1", batchId: "I-1",
    platformSku: `SKU-${index % 20}`, orderId: `00012345678901234567890123456789${index}`,
    quantity: 0.12345678912345678, quantityExact: "0.123456789123456789",
    amount: 1234567.891234567, amountExact: "1234567.89123456789123456789",
    importedAt: "2026-10-06T08:00:00.000Z", missing: undefined, empty: null,
    raw: { 业务单号: `00012345678901234567890123456789${index}`, 金额: "1234567.89123456789123456789", 备注: "相同的来源备注" },
    ...extra,
  }));
}

describe("sales audit snapshot dictionary", () => {
  it("keeps small legacy arrays and empty snapshots unchanged", () => {
    const rows = [{ id: 1, raw: { 金额: "0" }, empty: null, missing: undefined }];
    const snapshot = encodeSalesRowsAuditSnapshot(rows);
    expect(snapshot).toEqual(rows);
    expect(Array.isArray(snapshot)).toBe(true);
    expect(decodeSalesRowsAuditSnapshot(snapshot)).toBe(snapshot);
    expect(encodeSalesRowsAuditSnapshot([])).toEqual([]);
  });

  it("roundtrips every field, long identifier and exact number through JSON", () => {
    const rows = largeRows();
    const snapshot = encodeSalesRowsAuditSnapshot(rows);
    expect(snapshot).toMatchObject({ format: SALES_ROWS_AUDIT_FORMAT, version: 1, rowCount: rows.length });
    expect(validateSalesRowsAuditSnapshot(snapshot)).toEqual({ rowCount: rows.length });
    expect(decodeSalesRowsAuditSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(rows);
    expect(JSON.stringify(snapshot).length).toBeLessThan(JSON.stringify(rows).length * 0.5);
  });

  it("streaming across uneven chunks produces the same snapshot without retaining row objects", () => {
    const rows = largeRows();
    const builder = createSalesRowsAuditSnapshotBuilder();
    builder.addRows(rows.slice(0, 77)); builder.addRows([]);
    builder.addRows(rows.slice(77, SALES_ROWS_AUDIT_MIN_ROWS));
    builder.addRows(rows.slice(SALES_ROWS_AUDIT_MIN_ROWS));
    // Once the threshold is reached, input mutation cannot alter encoded rows.
    const expected = encodeSalesRowsAuditSnapshot(rows);
    rows[0].raw.备注 = "later edit";
    expect(builder.finish()).toEqual(expected);
    expect(() => builder.addRows([])).toThrow("封存");
    expect(() => builder.finish()).toThrow("封存");
  });

  it("preserves heterogeneous shapes, undefined, holes, special numbers and safe object keys", () => {
    const unusual = Object.create(null);
    Object.defineProperty(unusual, "__proto__", { value: { polluted: true }, enumerable: true });
    const rows = largeRows({ unusual, values: [null, undefined, , 3, "3", false, NaN, Infinity, -Infinity, -0, [{ constructor: "source" }]] });
    delete rows[0].empty;
    rows[0].extra = true;
    const decoded = decodeSalesRowsAuditSnapshot(JSON.parse(JSON.stringify(encodeSalesRowsAuditSnapshot(rows))));
    expect(decoded).toEqual(rows);
    expect(Object.getPrototypeOf(decoded[0].unusual)).toBe(null);
    expect(Object.getPrototypeOf(decoded[0].unusual.__proto__)).toBe(Object.prototype);
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.hasOwn(decoded[1], "missing")).toBe(true);
    expect(Object.hasOwn(decoded[0], "empty")).toBe(false);
    expect(2 in decoded[0].values).toBe(false);
    expect(Object.is(decoded[0].values[9], -0)).toBe(true);
  });

  it.each([
    ["version", snapshot => { snapshot.version = 2; }],
    ["format", snapshot => { snapshot.format = "unknown"; }],
    ["row count", snapshot => { snapshot.rowCount += 1; }],
    ["field index", snapshot => { snapshot.shapes[0][1] = snapshot.fields.length; }],
    ["duplicate field", snapshot => { snapshot.fields.push(snapshot.fields[0]); }],
    ["duplicate shape field", snapshot => { snapshot.shapes[0].push(snapshot.shapes[0][1], 0); }],
    ["field type", snapshot => { snapshot.shapes[0][2] = 99; }],
    ["shape index", snapshot => { snapshot.rows[0][0] = snapshot.shapes.length; }],
    ["vector length", snapshot => { snapshot.rows[0].pop(); }],
    ["string index", snapshot => { const position = snapshot.shapes[snapshot.rows[0][0]].findIndex((value, index) => index > 0 && index % 2 === 0 && value === 3); snapshot.rows[0][position / 2] = snapshot.strings.length; }],
    ["valid-looking string corruption", snapshot => { snapshot.strings[0] += "modified"; }],
    ["valid-looking numeric corruption", snapshot => { snapshot.rows[0][1] += 1; }],
    ["checksum", snapshot => { delete snapshot.checksum; }],
  ])("rejects malformed or corrupted %s before decoding", (_name, damage) => {
    const snapshot = encodeSalesRowsAuditSnapshot(largeRows());
    damage(snapshot);
    expect(() => decodeSalesRowsAuditSnapshot(snapshot)).toThrow("销售审计快照无效");
    expect(() => validateSalesRowsAuditSnapshot(snapshot)).toThrow("销售审计快照无效");
  });

  it("rejects cycles, unsupported objects, lossy fields and excessive nesting", () => {
    const cycle = {}; cycle.self = cycle;
    const hidden = {}; Object.defineProperty(hidden, "private", { value: 1 });
    const array = []; array.extra = true;
    let nested = {}; for (let index = 0; index < 66; index += 1) nested = { nested };
    for (const value of [cycle, new Date(), hidden, array, nested, 1n, Symbol("source"), () => 1]) {
      expect(() => encodeSalesRowsAuditSnapshot(largeRows({ value }))).toThrow("销售审计快照无效");
    }
    const encoded = encodeSalesRowsAuditSnapshot(largeRows({ value: {} }));
    const rootShape = encoded.shapes[encoded.rows[0][0]];
    const valuePosition = rootShape.findIndex((value, index) => index % 2 === 1 && encoded.fields[value] === "value");
    encoded.rows[0][(valuePosition + 1) / 2] = encoded.rows[0];
    expect(() => decodeSalesRowsAuditSnapshot(encoded)).toThrow("层级过深");
  });
});
