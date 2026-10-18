import "./globals.css";
import "./workspace.css";
import "./experience.css";
import { cookies } from "next/headers";
import { LocaleProvider } from "@/components/locale-provider";
import { TerminalProvider } from "@/components/terminal/context";
import "./terminal.css";
import "./design-system.css";
import "./auth.css";
export const metadata = {
  title: "Mone · Personal Finance",
  description:
    "Every dollar traced. Every step planned. A private financial workspace with verifiable records.",
};
export default async function RootLayout({ children }) {
  const preferences = await cookies();
  const locale =
    (await cookies()).get("wallet_language")?.value === "zh" ? "zh" : "en";
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <TerminalProvider
            initialMasked={
              preferences.get("wallet_screen_privacy")?.value === "1"
            }
            initialDensity={
              preferences.get("wallet_density")?.value === "compact"
                ? "compact"
                : "comfortable"
            }
          >
            {children}
          </TerminalProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
