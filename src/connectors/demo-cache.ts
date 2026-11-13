import { generateDemoData, type DemoData } from "./demo-data.ts";
import type { DateRange } from "../core/types.ts";

let cache: { key: string; data: DemoData } | undefined;

/** All demo connectors share one simulated world so orders and ad spend line up. */
export function demoWorld(range: DateRange): DemoData {
  const key = range.to;
  if (!cache || cache.key !== key) cache = { key, data: generateDemoData(range.to, 180) };
  return cache.data;
}

export const inRange = (date: string, r: DateRange) => date >= r.from && date <= r.to;
