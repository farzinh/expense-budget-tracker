import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";

import { readChatCookies } from "@/lib/chatCookies";
import { isDemoMode } from "@/lib/demoMode";
import { DEFAULT_USER_SETTINGS, RTL_LOCALES, type SupportedLocale } from "@/lib/locale";
import { getLocaleCookie } from "@/lib/localeCookie";
import { NAV_LINKS } from "@/lib/navigation";
import { themeAttribute } from "@/lib/theme";
import { getThemeCookie } from "@/lib/themeCookie";
import { I18nProvider } from "@/i18n/I18nProvider";
import { t } from "@/i18n/serverT";
import { buildRequestIdentity } from "@/server/db/requestIdentity";
import { listWorkspaces, type WorkspaceSummary } from "@/server/workspaces";
import { getReportCurrency } from "@/server/reportCurrency";
import { getUserSettings } from "@/server/userSettings";
import { extractUserIdFromHeaders, extractWorkspaceIdFromHeaders } from "@/server/userId";
import { resolveWorkspaceForCurrentRequestIdentity } from "@/server/workspaceBootstrap";
import { AccountMenu } from "@/ui/AccountMenu";
import { ChatLayoutProvider, ChatLayoutShell } from "@/ui/chat";
import type { ChatDraftScope } from "@/ui/chat/shell/layout/chatDraftStorage";
import { CurrencySelector } from "@/ui/CurrencySelector";
import { FilteredBanner } from "@/ui/FilteredBanner";
import { FilteredModeProvider } from "@/ui/FilteredModeProvider";
import { FormatProvider } from "@/ui/FormatProvider";
import { ModeToggle } from "@/ui/ModeToggle";
import { TableEditorActivationProvider } from "@/ui/tables/shared/TableEditorActivationProvider";
import { ThemeToggle } from "@/ui/ThemeToggle";

import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Budget Tracker",
  description: "Personal finance tracker",
};

/** Must track `--bg` in `styles/tokens.css`. */
const LIGHT_BG = "#ffffff";
const DARK_BG = "#0d0d0d";

/**
 * Tints mobile browser chrome to match the page. Resolved from the same cookie
 * as `data-theme` so an explicit choice is honored; "system" falls back to the
 * two media-scoped entries.
 */
export const generateViewport = async (): Promise<Viewport> => {
  const theme = await getThemeCookie();
  if (theme === "light") return { themeColor: LIGHT_BG };
  if (theme === "dark") return { themeColor: DARK_BG };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: LIGHT_BG },
      { media: "(prefers-color-scheme: dark)", color: DARK_BG },
    ],
  };
};

export default async function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
  const { children } = props;
  const headersList = await headers();
  const requestPath = headersList.get("x-request-path") ?? "";
  const isPublicMonthlySharePage = requestPath.startsWith("/share/monthly/");

  // Read on the server so `data-theme` is in the initial HTML: an explicit
  // choice must not flash the other theme before hydration.
  const theme = await getThemeCookie();
  const themeAttr = themeAttribute(theme);

  if (isPublicMonthlySharePage) {
    const publicLocale = await getLocaleCookie();

    return (
      <html
        lang={publicLocale}
        dir={RTL_LOCALES.has(publicLocale) ? "rtl" : "ltr"}
        data-theme={themeAttr}
      >
        <body>
          <I18nProvider locale={publicLocale}>
            {children}
          </I18nProvider>
        </body>
      </html>
    );
  }

  const demo = await isDemoMode();
  const { chatOpen, chatWidth } = await readChatCookies();
  const currentUserId = extractUserIdFromHeaders(headersList);

  const authEnabled = process.env.AUTH_MODE === "cognito";
  let reportingCurrency = "USD";
  let workspaces: ReadonlyArray<WorkspaceSummary> = [];
  let currentWorkspaceId = "";
  let locale: SupportedLocale = "en";
  let numberFormat = DEFAULT_USER_SETTINGS.numberFormat;
  let dateFormat = DEFAULT_USER_SETTINGS.dateFormat;
  let autoFilterDelayMinutes = DEFAULT_USER_SETTINGS.autoFilterDelayMinutes;

  if (demo) {
    locale = await getLocaleCookie();
  } else {
    try {
      const workspaceId = extractWorkspaceIdFromHeaders(headersList);
      currentWorkspaceId = workspaceId;
      if (authEnabled) {
        const resolvedWorkspace = await resolveWorkspaceForCurrentRequestIdentity(
          buildRequestIdentity(headersList),
          workspaceId,
        );
        if (resolvedWorkspace.workspaceId !== workspaceId) {
          const returnTo = headersList.get("x-request-path") ?? "/";
          redirect(`/api/workspaces/bootstrap?returnTo=${encodeURIComponent(returnTo)}`);
        }
      }
      reportingCurrency = await getReportCurrency(currentUserId, workspaceId);
      if (authEnabled) {
        workspaces = await listWorkspaces(currentUserId, workspaceId);
      }
      const initialLocale = await getLocaleCookie();
      const userSettings = await getUserSettings(currentUserId, workspaceId, initialLocale);
      locale = userSettings.locale;
      numberFormat = userSettings.numberFormat;
      dateFormat = userSettings.dateFormat;
      autoFilterDelayMinutes = userSettings.autoFilterDelayMinutes;
    } catch (err) {
      unstable_rethrow(err);
      console.error("Layout DB unavailable, using defaults: %s", err instanceof Error ? err.message : String(err));
      locale = await getLocaleCookie();
    }
  }

  const chatDraftScope: ChatDraftScope = demo
    ? { mode: "demo", userId: currentUserId }
    : { mode: "workspace", userId: currentUserId, workspaceId: currentWorkspaceId };

  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"} data-theme={themeAttr}>
      <body>
        <I18nProvider locale={locale}>
          <FormatProvider numberFormat={numberFormat} dateFormat={dateFormat}>
            <TableEditorActivationProvider>
              <FilteredModeProvider isDemoMode={demo} autoFilterDelayMinutes={autoFilterDelayMinutes}>
                <div className="header-sticky">
                  {demo && (
                    <div className="demo-banner">
                      {t(locale, "demo.banner")}<span className="demo-banner-detail"> {t(locale, "demo.bannerDetail")}</span>
                    </div>
                  )}
                  <FilteredBanner />
                  <header className="topbar">
                    <Link href="/" className="topbar-brand">
                      <span className="brand-full">{t(locale, "brand.full")}</span>
                      <span className="brand-short">{t(locale, "brand.short")}</span>
                    </Link>
                    <div className="topbar-actions">
                      <ThemeToggle initialTheme={theme} />
                      <ModeToggle isDemoMode={demo} />
                      <AccountMenu
                        authEnabled={authEnabled}
                        workspaces={workspaces}
                        currentWorkspaceId={currentWorkspaceId}
                      />
                    </div>
                  </header>
                  <nav className="nav">
                    {NAV_LINKS.map((link) => (
                      <Link key={link.href} href={link.href}>{t(locale, link.labelKey)}</Link>
                    ))}
                    <CurrencySelector initialCurrency={reportingCurrency} titleText={t(locale, "currency.title")} />
                  </nav>
                </div>
                <ChatLayoutProvider
                  initialChatOpen={chatOpen}
                  initialChatWidth={chatWidth}
                  draftScope={chatDraftScope}
                >
                  <ChatLayoutShell workspaceId={currentWorkspaceId}>
                    {children}
                  </ChatLayoutShell>
                </ChatLayoutProvider>
              </FilteredModeProvider>
            </TableEditorActivationProvider>
          </FormatProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
