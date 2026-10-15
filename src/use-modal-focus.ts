import { useEffect, useRef } from "react";

const focusableSelector = ":is(a[href],button,input,select,textarea,[tabindex]):not(:disabled,[tabindex^='-'],[type='hidden'])";

export function useModalFocus<T extends HTMLElement>(isOpen: boolean, onClose: () => void, selector?: string) {
  const modalRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = () => modalRef.current ?? (selector ? document.querySelector<T>(selector) : null);
    const focusableElements = () => Array.from(modal()?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    const focus = (target?: HTMLElement) => {
      const element = target ?? modal();
      if (element) {
        if (!target) element.tabIndex = -1;
        element.focus();
      }
    };
    const focusTimer = window.setTimeout(() => focus(focusableElements()[0]), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement as HTMLElement;
      if (!elements.includes(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        focus(event.shiftKey ? last : first);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [isOpen, selector]);

  return modalRef;
}
