import { useSyncExternalStore } from "react";
import english from "./locales/en.json";
import portuguese from "./locales/pt.json";

export type Locale = "en" | "pt";
export type TranslationKey = keyof typeof english;
type Parameters = Record<string, string | number>;
const storageKey = "workbench.locale";
const catalogs: Record<Locale, Record<string, string>> = {
  en: english,
  pt: portuguese,
};

export function normalizeLocale(value: unknown): Locale {
  return value === "pt" || value === "pt-PT" || value === "pt-BR" ? "pt" : "en";
}

function readLocale(): Locale {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(storageKey));
  } catch {
    return "en";
  }
}

let locale = readLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const dateLocale = () => (locale === "pt" ? "pt-PT" : "en-US");

function applyLocale(value: Locale) {
  locale = value;
  if (typeof document !== "undefined") document.documentElement.lang = value;
  listeners.forEach((listener) => listener());
}

export function selectLocale(value: Locale) {
  applyLocale(normalizeLocale(value));
  try {
    globalThis.localStorage?.setItem(storageKey, locale);
  } catch {
    // Keep the selected language in memory if storage is unavailable.
  }
}

applyLocale(locale);
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null)
      applyLocale(readLocale());
  });
}

export function useLocale() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLocale,
    () => "en" as Locale,
  );
  return { locale: current, selectLocale };
}

export function translate(
  key: string,
  language: Locale,
  values: Parameters = {},
): string {
  if (!Object.hasOwn(english, key)) {
    key =
      Object.entries(portuguese).find(([, value]) => value === key)?.[0] || key;
  }
  const template = Object.hasOwn(catalogs[language], key)
    ? catalogs[language][key]
    : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function t(key: string, values: Parameters = {}): string {
  return translate(key, locale, values);
}

// Native errors use canonical English messages. Also recognize messages in
// existing task records without rewriting persisted user data.
export function localizeMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.startsWith("Error: ")) return localizeMessage(message.slice(7));
  if (Object.hasOwn(english, message)) return t(message);
  const legacy = Object.entries(portuguese).find(
    ([, value]) => value === message,
  );
  if (legacy) return t(legacy[0]);
  const cleanup =
    "Docker did not confirm container cleanup. Check Docker before continuing.";
  for (const suffix of [cleanup, portuguese[cleanup]]) {
    if (message.endsWith(` ${suffix}`)) {
      return `${localizeMessage(message.slice(0, -suffix.length - 1))} ${t(cleanup)}`;
    }
  }
  return t("An unexpected error occurred. Please try again.");
}
