import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { t } from "../i18n";

export function ManagementDialog({
  title,
  description,
  value,
  options,
  maxLength,
  danger,
  onChange,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  value: string;
  options?: { value: string; label: string }[];
  maxLength?: number;
  danger?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>("input, select, .secondary-button")
      ?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        className="modal management-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="management-title"
        aria-describedby="management-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const buttons = [
              ...ref.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input, select",
              ),
            ];
            if (event.shiftKey && document.activeElement === buttons[0]) {
              event.preventDefault();
              buttons.at(-1)?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === buttons.at(-1)
            ) {
              event.preventDefault();
              buttons[0]?.focus();
            }
          }
        }}
      >
        <button
          type="button"
          className="modal-close icon-button"
          aria-label={t("Close")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <h2 id="management-title">{title}</h2>
        <p id="management-description" className="modal-description">
          {description}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {!danger && (
            <label className="field">
              {t(options ? "Project" : "Name")}
              {options ? (
                <select
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  value={value}
                  maxLength={maxLength || 100}
                  onChange={(event) => onChange(event.target.value)}
                />
              )}
            </label>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              {t("Cancel")}
            </button>
            <button
              className={`primary-button ${danger ? "delete-button" : ""}`}
              type="submit"
            >
              {t(danger ? "Delete" : "Save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
