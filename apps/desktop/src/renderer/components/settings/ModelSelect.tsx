import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type ModelOption = { id: string; name?: string };

/**
 * Styled select for picking a model id from the provider's fetched model
 * list, replacing the native <datalist> which renders an unthemed dropdown
 * inside Electron. Profiles without a model list fall back to a plain
 * input at the call site.
 */
export function ModelSelect({
  value,
  onChange,
  models,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  models: ModelOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep a saved value that is missing from the fetched list selectable.
  const options = useMemo(() => {
    if (value && !models.some((model) => model.id === value)) {
      return [{ id: value }, ...models];
    }
    return models;
  }, [models, value]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        close();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current
      ?.querySelectorAll('[role="option"]')
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = (id: string) => {
    onChange(id);
    close();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((model) => model.id === value),
            ),
          );
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActiveIndex(
                Math.max(
                  0,
                  options.findIndex((model) => model.id === value),
                ),
              );
              return;
            }
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((current) => Math.max(0, Math.min(options.length - 1, current + delta)));
          } else if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            select(options[activeIndex].id);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="model-select-list"
        className="field-input flex items-center justify-between gap-2 pr-8 text-left"
      >
        <span className={`min-w-0 truncate ${value ? "text-fg" : "text-subtle"}`}>
          {value || placeholder || "Select model"}
        </span>
      </button>
      <ChevronDown
        className={`pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
      {open ? (
        <div
          ref={listRef}
          id="model-select-list"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-50 max-h-56 overflow-y-auto rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
        >
          {options.map((model, index) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={model.id === value}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => select(model.id)}
              onPointerEnter={() => setActiveIndex(index)}
              className={`flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left transition-colors ${
                index === activeIndex ? "bg-surface-hover" : ""
              }`}
            >
              <span className="min-w-0 truncate font-mono text-app-12 font-medium text-fg">
                {model.id}
              </span>
              {model.name ? (
                <span className="min-w-0 shrink truncate text-app-11 text-subtle">
                  {model.name}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
