import { t, useLocale } from "../i18n";

export function LanguageSwitcher() {
  const { locale, selectLocale } = useLocale();
  return (
    <label className="field language-settings">
      <strong>{t("Language")}</strong>
      <small>{t("Choose the app language.")}</small>
      <select
        value={locale}
        onChange={(event) =>
          selectLocale(event.target.value === "pt" ? "pt" : "en")
        }
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="pt" lang="pt">
          Português
        </option>
      </select>
    </label>
  );
}
