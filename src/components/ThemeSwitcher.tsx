import { t } from "../i18n";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../theme";

export function ThemeSwitcher({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <fieldset className="theme-settings">
      <legend>{t("Appearance")}</legend>
      <p>{t("Choose your preferred theme.")}</p>
      <div className="theme-options">
        {(
          [
            { value: "dark", label: t("Dark"), icon: Moon },
            { value: "light", label: t("Light"), icon: Sun },
            { value: "system", label: t("System"), icon: Monitor },
          ] as const
        ).map(({ value: option, label, icon: Icon }) => (
          <label className="theme-option" key={option}>
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>
              <Icon size={18} />
              <strong>{label}</strong>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
