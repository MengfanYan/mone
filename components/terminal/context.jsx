"use client";
import { createContext, useContext, useState, useCallback } from "react";
import { ShieldCheck, EyeOff } from "lucide-react";
import { useLocale } from "../locale-provider";

const PrivacyContext = createContext({ masked: false, density: "comfortable" });
export function TerminalProvider({
  children,
  initialMasked = false,
  initialDensity = "comfortable",
}) {
  const [masked, setMasked] = useState(initialMasked),
    [density, setDensity] = useState(initialDensity);
  const toggleMask = useCallback(
    () =>
      setMasked((old) => {
        const value = !old;
        document.cookie = `wallet_screen_privacy=${value ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Strict`;
        return value;
      }),
    [],
  );
  const changeDensity = useCallback((value) => {
    if (!["comfortable", "compact"].includes(value)) return;
    setDensity(value);
    document.cookie = `wallet_density=${value}; Path=/; Max-Age=31536000; SameSite=Strict`;
  }, []);
  return (
    <PrivacyContext.Provider
      value={{ masked, toggleMask, density, changeDensity }}
    >
      <div
        className="terminal-provider"
        data-density={density}
        data-screen-privacy={masked ? "on" : "off"}
      >
        {children}
      </div>
    </PrivacyContext.Provider>
  );
}
export const useScreenPrivacy = () => useContext(PrivacyContext);
export function useTerminalText() {
  const { locale } = useLocale();
  return (en, zh) => (locale === "zh" ? zh : en);
}
export function MaskedPanel() {
  const text = useTerminalText();
  return (
    <section className="panel masked-panel" role="status">
      <EyeOff size={32} />
      <h2>{text("Screen privacy is on", "屏幕隐私遮罩已开启")}</h2>
      <p>
        {text(
          "Financial content is hidden. Use the eye icon to reveal this workspace.",
          "财务内容已隐藏。点击顶部眼睛图标重新显示工作台。",
        )}
      </p>
      <span>
        <ShieldCheck size={14} />
        {text(
          "Visual privacy · access permissions are unchanged",
          "视觉隐私保护 · 访问权限保持不变",
        )}
      </span>
    </section>
  );
}
