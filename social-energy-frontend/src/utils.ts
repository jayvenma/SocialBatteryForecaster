import type { ImpactLabel } from "./types";

export function formatTimeRange(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);

  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  return `${dateFmt.format(start)} • ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}

export function labelFromScore(score: number): ImpactLabel {
  if (score >= 18) return "Extreme";
  if (score >= 12) return "High";
  if (score >= 6) return "Medium";
  return "Low";
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
