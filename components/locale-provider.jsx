"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Languages } from "lucide-react";
import { translate } from "@/lib/i18n";

const LocaleContext = createContext(null);

export function LocaleProvider({ initialLocale = "en", children }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((value) => {
    if (value !== "en" && value !== "zh") return;
    document.cookie = `wallet_language=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    updateLocale(value);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title =
      locale === "zh"
        ? "Mone · 每一笔清晰可溯，每一步从容规划"
        : "Mone · Every Dollar, Accounted For";
  }, [locale]);
  const t = useCallback(
    (key, variables) => translate(key, locale, variables),
    [locale],
  );
  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        t,
        dateLocale: locale === "zh" ? "zh-CN" : "en-AU",
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider is required");
  return value;
}

export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="language-switch" role="group" aria-label={t("语言选择")}>
      <Languages size={15} aria-hidden="true" />
      <button
        type="button"
        lang="en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
      <button
        type="button"
        lang="zh-CN"
        aria-pressed={locale === "zh"}
        onClick={() => setLocale("zh")}
      >
        中文
      </button>
    </div>
  );
}
