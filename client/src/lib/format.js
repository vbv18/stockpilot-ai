const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
export const fmtInt = (n) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : Math.round(n).toLocaleString("en-IN");
export const fmtNum = (n, d = 1) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : n.toLocaleString("en-IN", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
export const fmtInr = (n, cents = false) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : (cents ? inr2 : inr).format(n);
export const fmtPct = (frac, d = 1) =>
  frac === null || frac === undefined || !Number.isFinite(frac)
    ? "-"
    : `${(frac * 100).toFixed(d)}%`;
export const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
export const shortId = (id) => (id ? id.slice(-6) : "-");
