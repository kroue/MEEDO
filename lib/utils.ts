import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPeso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(value);
}

export function getFullName(c: { firstName?: string; middleName?: string; lastName?: string; name?: string }) {
  if (!c.firstName && !c.lastName && c.name) return c.name;
  return `${c.firstName || ""} ${c.middleName || ""} ${c.lastName || ""}`.trim().replace(/\s+/g, " ");
}
