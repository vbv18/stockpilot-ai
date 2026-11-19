export function flattenNumbers(value, out = [], depth = 0) {
  if (out.length > 20000 || depth > 8) return out;
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) flattenNumbers(v, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) flattenNumbers(v, out, depth + 1);
  }
  return out;
}

export function flattenKeys(value, prefix = "", out = [], depth = 0) {
  if (depth > 6 || out.length > 400) return out;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = prefix ? `${prefix}.${k}` : k;
      out.push(key);
      flattenKeys(v, key, out, depth + 1);
    }
  } else if (Array.isArray(value) && value.length > 0) {
    flattenKeys(value[0], prefix, out, depth + 1);
  }
  return out;
}

export class EvidenceLedger {
  constructor() {
    this.entries = new Map();
    this.seq = 1;
  }

  addDigest(artifactId, payload) {
    const e = {
      evidenceId: "E0",
      artifactType: "session_digest",
      artifactId,
      skuId: null,
      source: "digest",
      toolName: null,
      numbers: flattenNumbers(payload),
      keys: flattenKeys(payload),
      label: "Session digest",
    };
    this.entries.set(e.evidenceId, e);
    return e;
  }

  add(args) {
    const e = {
      evidenceId: `E${this.seq++}`,
      artifactType: args.artifactType,
      artifactId: args.artifactId,
      skuId: args.skuId,
      source: args.source,
      toolName: args.toolName,
      numbers: flattenNumbers(args.payload),
      keys: flattenKeys(args.payload),
      label: args.label,
    };
    this.entries.set(e.evidenceId, e);
    return e;
  }

  get(id) {
    return this.entries.get(id);
  }

  has(id) {
    return this.entries.has(id);
  }

  all() {
    return [...this.entries.values()];
  }

  allNumbers() {
    return this.all().flatMap((e) => e.numbers);
  }
}
