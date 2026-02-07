export type ConnectionStatus = "connected" | "disconnected" | "checking";

export type DiffState = {
  before: string;
  after: string;
  diff: string;
  updatedAt: number;
};

export const WORKSPACE_QUICK_BACKTEST_KEY = "workspace:quickBacktest";
export const WORKSPACE_TRADES_COL_WIDTHS_KEY = "workspace:tradesTableColWidths";

export function fmtTimerangePartUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function timerangeLastDaysUtc(days: number): string {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - Math.max(0, Math.floor(days)));
  return `${fmtTimerangePartUtc(from)}-${fmtTimerangePartUtc(now)}`;
}

export function timerangeYtdUtc(): string {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return `${fmtTimerangePartUtc(from)}-${fmtTimerangePartUtc(now)}`;
}

export function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function toPctMaybe(v: unknown): number | null {
  const n = toFiniteNumber(v);
  if (n == null) return null;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

export function fmtPct(v: number | null, digits = 2): string {
  if (v == null) return "-";
  return `${v.toFixed(digits)}%`;
}

export function fmtMoney(v: number | null, digits = 2): string {
  if (v == null) return "-";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return `${sign}${abs.toFixed(digits)}`;
}

export function fmtDateTime(v: unknown): string {
  if (typeof v !== "string") return "-";
  if (!v) return "-";
  return v.replace("+00:00", "").replace("T", " ");
}

export function dateMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function fmtDurationMinutes(v: number | null): string {
  if (v == null) return "-";
  const total = Math.max(0, Math.floor(v));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
