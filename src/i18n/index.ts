/**
 * Tiny i18n layer shared by the engine (findings), the rules-mode chat and the UI.
 * Dictionaries are flat key -> string maps; TypeScript enforces that every
 * language defines every key of the English master.
 */
import { en, type Dict } from "./en.ts";
import { de } from "./de.ts";
import { fr } from "./fr.ts";
import { it } from "./it.ts";
import { es } from "./es.ts";

export type Lang = "en" | "de" | "fr" | "it" | "es";
export type Key = keyof typeof en;
export type T = (key: Key, params?: Record<string, string | number>) => string;

export const LANGS: { id: Lang; label: string; short: string; locale: string }[] = [
  { id: "en", label: "English", short: "EN", locale: "en-GB" },
  { id: "de", label: "Deutsch", short: "DE", locale: "de-CH" },
  { id: "fr", label: "Français", short: "FR", locale: "fr-CH" },
  { id: "it", label: "Italiano", short: "IT", locale: "it-CH" },
  { id: "es", label: "Español", short: "ES", locale: "es-ES" },
];

const DICTS: Record<Lang, Dict> = { en, de, fr, it, es };

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && v in DICTS;
}

export function makeT(lang: Lang = "en"): T {
  const d = DICTS[lang] ?? en;
  return (key, params) => {
    let s = d[key] ?? en[key] ?? String(key);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
    return s;
  };
}

/** Best match for a browser language list, e.g. ["de-CH", "en"]. */
export function pickLang(prefs: readonly string[] | undefined): Lang {
  for (const p of prefs ?? []) {
    const base = p.toLowerCase().slice(0, 2);
    if (isLang(base)) return base;
  }
  return "en";
}

export const localeOf = (lang: Lang) => LANGS.find((l) => l.id === lang)?.locale ?? "en-GB";
