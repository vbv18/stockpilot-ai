import { fmtInr, fmtInt, fmtNum, fmtPct } from "../../lib/format.js";

/**
 * Formats a key finding value based on its unit
 *
 * @param {number|string|null} value
 * @param {string} unit
 * @returns {string}
 */
export function formatFindingValue(value, unit) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  switch (unit) {
    case "inr":
      return fmtInr(value, Math.abs(value) < 100);
    case "inr_per_unit":
      return `${fmtInr(value, true)} / unit`;
    case "units":
      return `${fmtNum(value, Number.isInteger(value) ? 0 : 1)} units`;
    case "percent":
      return `${fmtNum(value, 1)}%`;
    case "fraction":
      return fmtPct(value, 1);
    case "days":
      return `${fmtNum(value, Number.isInteger(value) ? 0 : 1)} days`;
    case "count":
      return fmtInt(value);
    case "ratio":
      return fmtNum(value, 2);
    default:
      return fmtNum(value, 2);
  }
}
