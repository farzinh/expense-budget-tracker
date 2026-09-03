"use client";

import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cn";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_PREFERENCES,
  type ThemePreference,
  themeAttribute,
} from "@/lib/theme";

import styles from "./Controls.module.css";

type Props = Readonly<{
  initialTheme: ThemePreference;
}>;

const LABEL_KEYS: Readonly<Record<ThemePreference, string>> = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
};

/**
 * Applies the preference to <html> immediately. The tokens in `styles/tokens.css`
 * are keyed off `data-theme`, so switching needs no reload and no re-render of
 * the tree — only this attribute changes.
 */
const applyTheme = (theme: ThemePreference): void => {
  const attribute = themeAttribute(theme);
  if (attribute === undefined) {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = attribute;
};

export const ThemeToggle = (props: Props): ReactElement => {
  const { initialTheme } = props;
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const { t } = useTranslation();

  const switchTo = (target: ThemePreference): void => {
    if (target === theme) return;
    setTheme(target);
    applyTheme(target);
    document.cookie = `${THEME_COOKIE}=${target};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
  };

  return (
    <div className={styles.segmented} role="group" aria-label={t("theme.title")}>
      {THEME_PREFERENCES.map((preference) => (
        <button
          key={preference}
          className={cn(styles.segment, theme === preference ? styles.segmentActive : "")}
          type="button"
          data-testid={`theme-${preference}`}
          aria-pressed={theme === preference}
          onClick={() => switchTo(preference)}
        >
          {t(LABEL_KEYS[preference])}
        </button>
      ))}
    </div>
  );
};
