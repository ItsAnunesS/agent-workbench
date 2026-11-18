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
      <legend>Aparência</legend>
      <p>Escolhe o tema que preferes para trabalhar.</p>
      <div className="theme-options">
        {(
          [
            { value: "dark", label: "Escuro", icon: Moon },
            { value: "light", label: "Claro", icon: Sun },
            { value: "system", label: "Sistema", icon: Monitor },
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
