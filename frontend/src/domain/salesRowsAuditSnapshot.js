import { assertDomain } from "./errors.js";

export const SALES_ROWS_AUDIT_FORMAT = "lworkstation-sales-rows-dictionary";
export const SALES_ROWS_AUDIT_VERSION = 1;
export const SALES_ROWS_AUDIT_MIN_ROWS = 2000;

const MAX_DEPTH = 64;
const NULL = 0, BOOLEAN = 1, NUMBER = 2, STRING = 3, UNDEFINED = 4, OBJECT = 5, ARRAY = 6, SPECIAL_NUMBER = 7, HOLE = 8;
const specialNumbers = [NaN, Infinity, -Infinity, -0];

function check(condition, reason) {
  assertDomain(condition, "INVALID_SALES_AUDIT_SNAPSHOT", `销售审计快照无效：${reason}。`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function inRange(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length;
}

// This streaming integrity checksum detects accidental changes to dictionaries
// as well as row vectors. It is not an authentication or cryptographic hash.
function checksum(snapshot) {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  function write(text) {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
  }
  function visit(value) {
    if (Array.isArray(value)) {
      write(`a${value.length}:`);
      for (const item of value) visit(item);
    } else if (typeof value === "string") {
      write(`s${value.length}:`); write(value);
    } else {
      write(value === null ? "z" : typeof value === "boolean" ? (value ? "t" : "f") : `n${value};`);
    }
  }
  visit([snapshot.format, snapshot.version, snapshot.rowCount, snapshot.fields, snapshot.strings, snapshot.shapes, snapshot.rows]);
  return `fnv64:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function createEncoder() {
  const fields = [], strings = [], shapes = [], rows = [];
  const fieldIndices = new Map(), stringIndices = new Map(), shapeIndices = new Map();
  const ancestors = new Set();
  function intern(value, dictionary, indices) {
    if (!indices.has(value)) { indices.set(value, dictionary.length); dictionary.push(value); }
    return indices.get(value);
  }
  function kind(value) {
    if (value === null) return NULL;
    switch (typeof value) {
      case "boolean": return BOOLEAN;
      case "number": return Number.isFinite(value) && !Object.is(value, -0) ? NUMBER : SPECIAL_NUMBER;
      case "string": return STRING;
      case "undefined": return UNDEFINED;
      case "object": return Array.isArray(value) ? ARRAY : OBJECT;
      default: check(false, "包含不支持的字段类型");
    }
  }
  function enter(value, depth) {
    check(depth <= MAX_DEPTH, "嵌套层级过深");
    check(!ancestors.has(value), "包含循环引用");
    ancestors.add(value);
  }
  function encodeValue(value, type, depth) {
    check(depth <= MAX_DEPTH, "嵌套层级过深");
    if (type === STRING) return intern(value, strings, stringIndices);
    if (type === SPECIAL_NUMBER) return specialNumbers.findIndex(number => Object.is(number, value));
    if (type === NULL || type === UNDEFINED) return null;
    if (type === OBJECT) return encodeObject(value, depth);
    if (type === ARRAY) {
      enter(value, depth);
      const keys = Reflect.ownKeys(value);
      check(keys.every(key => key === "length" || typeof key === "string" && String(Number(key)) === key && inRange(Number(key), value.length)), "数组包含额外字段");
      const vector = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        check(!descriptor || "value" in descriptor && descriptor.enumerable, "数组包含非数据字段");
        const type = descriptor ? kind(descriptor.value) : HOLE;
        vector.push(type, descriptor ? encodeValue(descriptor.value, type, depth + 1) : null);
      }
      ancestors.delete(value);
      return vector;
    }
    return value;
  }
  function encodeObject(value, depth = 0) {
    check(isRecord(value), "包含非普通对象");
    enter(value, depth);
    const keys = Object.keys(value);
    check(Reflect.ownKeys(value).length === keys.length, "对象包含不可枚举或符号字段");
    // Each shape carries field types, so string references are plain integer
    // values rather than millions of individual tagged arrays in IndexedDB.
    const shape = [Object.getPrototypeOf(value) === null ? 1 : 0];
    const vector = [0];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check("value" in descriptor, "对象包含非数据字段");
      const type = kind(descriptor.value);
      shape.push(intern(key, fields, fieldIndices), type);
      vector.push(encodeValue(descriptor.value, type, depth + 1));
    }
    const shapeKey = shape.join(",");
    vector[0] = intern(shapeKey, shapes, shapeIndices);
    // intern() stores the lookup key; only the numeric shape is persisted.
    shapes[vector[0]] = shape;
    ancestors.delete(value);
    return vector;
  }
  return {
    add(row) { rows.push(encodeObject(row)); },
    finish() {
      const snapshot = { format: SALES_ROWS_AUDIT_FORMAT, version: SALES_ROWS_AUDIT_VERSION, rowCount: rows.length, fields, strings, shapes, rows };
      snapshot.checksum = checksum(snapshot);
      fieldIndices.clear(); stringIndices.clear(); shapeIndices.clear();
      return snapshot;
    },
  };
}

// Imported rows arrive in bounded write chunks. Once the threshold is reached,
// only vectors are retained, avoiding a second full object copy for the audit.
export function createSalesRowsAuditSnapshotBuilder() {
  let buffered = [], encoder = null, finished = false;
  return {
    addRows(rows) {
      check(!finished, "快照已经封存");
      check(Array.isArray(rows), "销售行不是数组");
      for (const row of rows) {
        check(isRecord(row), "销售行不是普通对象");
        if (encoder) encoder.add(row);
        else {
          buffered.push(row);
          if (buffered.length >= SALES_ROWS_AUDIT_MIN_ROWS) {
            encoder = createEncoder();
            for (const bufferedRow of buffered) encoder.add(bufferedRow);
            buffered = null;
          }
        }
      }
    },
    finish() {
      check(!finished, "快照已经封存");
      finished = true;
      return encoder ? encoder.finish() : buffered;
    },
  };
}

export function encodeSalesRowsAuditSnapshot(rows) {
  const builder = createSalesRowsAuditSnapshotBuilder();
  builder.addRows(rows);
  return builder.finish();
}

function encodedReader(snapshot) {
  check(isRecord(snapshot), "未知销售行格式");
  check(snapshot.format === SALES_ROWS_AUDIT_FORMAT && snapshot.version === SALES_ROWS_AUDIT_VERSION, "格式或版本不受支持");
  const expectedKeys = ["format", "version", "rowCount", "fields", "strings", "shapes", "rows", "checksum"];
  check(Object.keys(snapshot).length === expectedKeys.length && expectedKeys.every(key => Object.hasOwn(snapshot, key)), "封装字段不完整");
  const { fields, strings, shapes, rows } = snapshot;
  check([fields, strings, shapes, rows].every(Array.isArray), "字典或行向量不是数组");
  check(Number.isSafeInteger(snapshot.rowCount) && snapshot.rowCount >= 0 && snapshot.rowCount === rows.length, "行数不一致");
  for (const field of fields) check(typeof field === "string", "字段字典无效");
  for (const string of strings) check(typeof string === "string", "字符串字典无效");
  check(new Set(fields).size === fields.length, "字段字典重复");
  check(new Set(strings).size === strings.length, "字符串字典重复");
  const shapeKeys = new Set();
  for (const shape of shapes) {
    check(Array.isArray(shape) && shape.length % 2 === 1 && (shape[0] === 0 || shape[0] === 1), "对象结构无效");
    const keys = new Set();
    for (let index = 1; index < shape.length; index += 2) {
      check(inRange(shape[index], fields.length) && !keys.has(shape[index]), "对象字段索引无效或重复");
      keys.add(shape[index]);
      check(inRange(shape[index + 1], HOLE), "对象字段类型无效");
    }
    const key = shape.join(",");
    check(!shapeKeys.has(key), "对象结构重复");
    shapeKeys.add(key);
  }
  function readValue(type, value, depth, materialize) {
    check(depth <= MAX_DEPTH, "嵌套层级过深");
    switch (type) {
      case NULL: case UNDEFINED: case HOLE:
        check(value === null, "空值标记无效");
        return type === NULL ? null : undefined;
      case BOOLEAN: check(typeof value === "boolean", "布尔值无效"); return value;
      case NUMBER: check(typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0), "数值无效"); return value;
      case STRING: check(inRange(value, strings.length), "字符串索引无效"); return strings[value];
      case SPECIAL_NUMBER: check(inRange(value, specialNumbers.length), "特殊数值标记无效"); return specialNumbers[value];
      case OBJECT: return readObject(value, depth, materialize);
      case ARRAY: {
        check(Array.isArray(value) && value.length % 2 === 0, "数组向量无效");
        const array = materialize ? new Array(value.length / 2) : null;
        for (let index = 0; index < value.length; index += 2) {
          check(inRange(value[index], HOLE + 1), "数组字段类型无效");
          const item = readValue(value[index], value[index + 1], depth + 1, materialize);
          if (materialize && value[index] !== HOLE) array[index / 2] = item;
        }
        return array;
      }
      default: check(false, "未知字段类型");
    }
  }
  function readObject(vector, depth = 0, materialize = false) {
    check(depth <= MAX_DEPTH, "嵌套层级过深");
    check(Array.isArray(vector) && inRange(vector[0], shapes.length), "对象结构索引无效");
    const shape = shapes[vector[0]];
    check(vector.length === (shape.length + 1) / 2, "对象字段数量不一致");
    const object = materialize ? (shape[0] ? Object.create(null) : {}) : null;
    for (let index = 1; index < vector.length; index += 1) {
      const value = readValue(shape[index * 2], vector[index], depth + 1, materialize);
      if (materialize) Object.defineProperty(object, fields[shape[index * 2 - 1]], { value, writable: true, enumerable: true, configurable: true });
    }
    return object;
  }
  for (const row of rows) readObject(row);
  check(typeof snapshot.checksum === "string" && /^fnv64:[0-9a-f]{16}$/.test(snapshot.checksum) && snapshot.checksum === checksum(snapshot), "完整性校验失败");
  return () => rows.map(row => readObject(row, 0, true));
}

export function validateSalesRowsAuditSnapshot(snapshot) {
  if (Array.isArray(snapshot)) {
    for (const row of snapshot) check(isRecord(row), "销售行不是普通对象");
    return { rowCount: snapshot.length };
  }
  encodedReader(snapshot);
  return { rowCount: snapshot.rowCount };
}

export function decodeSalesRowsAuditSnapshot(snapshot) {
  if (Array.isArray(snapshot)) {
    validateSalesRowsAuditSnapshot(snapshot);
    return snapshot;
  }
  return encodedReader(snapshot)();
}
