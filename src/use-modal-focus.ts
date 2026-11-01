import { useEffect, useRef } from "react";

const focusableSelector = ":is(a[href],button,input,select,textarea,[tabindex],video[controls],audio[controls]):not(:disabled,[tabindex^='-'],[type='hidden'])";

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

    // media 요소의 native controls로 Tab focus를 넘긴 직후에만 값이 있으며, 이때 modal 밖으로 나간 focus를 되돌린다.
    let mediaTabDirection: "forward" | "backward" | null = null;
    const handleKeyDown = (event: KeyboardEvent) => {
      mediaTabDirection = null;
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
      if (elements.includes(active) && active.matches("video[controls],audio[controls]")) {
        mediaTabDirection = event.shiftKey ? "backward" : "forward";
        return;
      }
      if (!elements.includes(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        focus(event.shiftKey ? last : first);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const direction = mediaTabDirection;
      if (!direction) return;
      const target = event.target as Node | null;
      const container = modal();
      if (!container || !target || target === document || container.contains(target)) return;
      mediaTabDirection = null;
      const elements = focusableElements();
      focus(direction === "backward" ? elements[elements.length - 1] : elements[0]);
    };
    const resetMediaTab = () => { mediaTabDirection = null; };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("pointerdown", resetMediaTab);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("pointerdown", resetMediaTab);
      returnFocusRef.current?.focus();
    };
  }, [isOpen, selector]);

  return modalRef;
}
