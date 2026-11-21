export function parseDateToIso(raw, fmt) {
  const m = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T].*)?\s*$/.exec(
    raw,
  );
  if (!m) return null;
  const a = Number(m[1]),
    b = Number(m[2]),
    c = Number(m[3]);
  let y, mo, d;
  if (fmt === "iso") {
    if (m[1].length !== 4) return null;
    y = a;
    mo = b;
    d = c;
  } else if (fmt === "dmy") {
    if (m[3].length !== 4) return null;
    d = a;
    mo = b;
    y = c;
  } else {
    if (m[3].length !== 4) return null;
    mo = a;
    d = b;
    y = c;
  }
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const dayIndexFromIso = (iso) =>
  Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
export const isoFromDayIndex = (i) =>
  new Date(i * 86_400_000).toISOString().slice(0, 10);

export function parseQuantity(raw) {
  const s = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
