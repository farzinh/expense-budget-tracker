import { cookies } from "next/headers";

import { THEME_COOKIE, type ThemePreference, resolveTheme } from "@/lib/theme";

/** Read the theme preference from the cookie. For Server Components. */
export const getThemeCookie = async (): Promise<ThemePreference> => {
  const cookieStore = await cookies();
  return resolveTheme(cookieStore.get(THEME_COOKIE)?.value);
};

/** Read the theme preference from a raw Request. For API route handlers. */
export const getThemeFromRequest = (request: Request): ThemePreference => {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)theme=([^;]*)/);
  return resolveTheme(match !== null ? decodeURIComponent(match[1]) : undefined);
};
