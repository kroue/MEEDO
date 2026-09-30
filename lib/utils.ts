import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True when an amount has centavos, once float noise is rounded off. */
export function hasCentavos(value: number): boolean {
  return !Number.isInteger(Math.round(value * 100) / 100);
}

/**
 * Pesos as the office writes them. Bills are in whole pesos, so a whole
 * amount shows without a decimal point — ₱376, not ₱376.00. An amount that
 * really has centavos (a rate per m³, a balance from before bills were
 * rounded) keeps them, so nothing is rounded away on screen.
 */
export function formatPeso(value: number) {
  const digits = hasCentavos(value) ? 2 : 0;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Short form of a number for a chart axis or a tile.
 *
 * Only reaches for "k" once a value is actually in the thousands. Dividing
 * everything by a thousand and rounding, as the charts used to, turned every
 * tick on a small axis into "0k" — water consumption is tens of cubic metres,
 * so an entire axis read 0k, 0k, 0k.
 */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const trim = (n: number) => String(Number(n.toFixed(1)));

  if (magnitude >= 1_000_000) return `${sign}${trim(magnitude / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${sign}${trim(magnitude / 1_000)}k`;
  // Below a thousand the real number is short enough to read as it is.
  return `${sign}${Number(magnitude.toFixed(magnitude < 10 ? 1 : 0))}`;
}

/** [formatCompact] with the peso sign, for money axes. */
export function formatCompactPeso(value: number): string {
  return `₱${formatCompact(value)}`;
}

export function getFullName(c: { firstName?: string; middleName?: string; lastName?: string; name?: string }) {
  if (!c.firstName && !c.lastName && c.name) return c.name;
  return `${c.firstName || ""} ${c.middleName || ""} ${c.lastName || ""}`.trim().replace(/\s+/g, " ");
}
