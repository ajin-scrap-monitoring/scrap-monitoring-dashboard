import { useEffect, useId, useRef, useState } from "react";

type DropdownProps = {
  label: string;
  options: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
};

export function Dropdown({ label, options, defaultValue = "", value: controlledValue, onChange }: DropdownProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [internalValue, setValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, options.indexOf(defaultValue)));

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>(`[id="${id}-${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const select = (index: number) => {
    setValue(options[index]);
    onChange?.(options[index]);
    setOpen(false);
  };

  return (
    <div className={`dropdown${open ? " is-open" : ""}`} ref={root}>
      <button
        type="button"
        disabled={options.length === 0}
        className="dropdown-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onBlur={() => setOpen(false)}
        onClick={() => { setActive(Math.max(0, options.indexOf(value))); setOpen(!open); }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !open ? Math.max(0, options.indexOf(value)) : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) select(active);
            else { setActive(Math.max(0, options.indexOf(value))); setOpen(true); }
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (open) event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") {
            setOpen(false);
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = Date.now();
            search.current = { text: (now - search.current.time < 700 ? search.current.text : "") + event.key, time: now };
            const index = options.findIndex((option) => option.toLocaleLowerCase().startsWith(search.current.text.toLocaleLowerCase()));
            if (index >= 0) { setActive(index); setOpen(true); }
          }
        }}
      >
        <span>{value}</span><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="dropdown-options" id={id} role="listbox" aria-label={label} onMouseDown={(event) => event.preventDefault()}>
        {options.map((option, index) => <div key={option} id={`${id}-${index}`} role="option" aria-selected={value === option} className={`dropdown-option${active === index ? " active" : ""}`} onPointerMove={() => setActive(index)} onClick={() => select(index)}>{option}{value === option && <span aria-hidden="true">선택</span>}</div>)}
      </div>}
    </div>
  );
}
