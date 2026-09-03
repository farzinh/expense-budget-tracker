/**
 * Theme preference, persisted in the `theme` cookie.
 *
 * "system" is the default and is represented by the absence of a `data-theme`
 * attribute on <html>, which lets the `prefers-color-scheme` media query in
 * `styles/tokens.css` resolve it.
 */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: ReadonlyArray<ThemePreference> = ["light", "dark", "system"];

export const DEFAULT_THEME: ThemePreference = "system";

export const THEME_COOKIE = "theme";

/** One year, in seconds. Matches how long a theme choice should outlive a session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Narrow an untrusted cookie value to a supported preference.
 * A missing or unrecognized value is the normal first-visit case, so it
 * resolves to the default rather than raising.
 */
export const resolveTheme = (raw: string | undefined): ThemePreference => {
  if (raw !== undefined && (THEME_PREFERENCES as ReadonlyArray<string>).includes(raw)) {
    return raw as ThemePreference;
  }
  return DEFAULT_THEME;
};

/**
 * The value for the <html data-theme> attribute.
 * "system" stamps nothing so the media query decides.
 */
export const themeAttribute = (theme: ThemePreference): "light" | "dark" | undefined =>
  theme === "system" ? undefined : theme;
