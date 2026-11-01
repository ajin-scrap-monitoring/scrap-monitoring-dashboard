import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { isClientRoute, navigate } from "./app-router";
import { preloadPageModule } from "./page-loaders";

export type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  onNavigate?: () => void;
  children?: ReactNode;
};

export function AppLink({
  children,
  download,
  onClick,
  onFocus,
  onNavigate,
  onPointerEnter,
  target,
  to,
  ...rest
}: AppLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (target && target !== "_self") return;
    if (download != null && download !== false) return;
    if (!isClientRoute(to)) return;

    e.preventDefault();
    onNavigate?.();
    navigate(to);
  };

  const handlePointerEnter = (e: React.PointerEvent<HTMLAnchorElement>) => {
    onPointerEnter?.(e);
    if (isClientRoute(to)) {
      try {
        const url = new URL(to, window.location.href);
        preloadPageModule(url.pathname);
      } catch {
        // url parsing error 무시
      }
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(e);
    if (isClientRoute(to)) {
      try {
        const url = new URL(to, window.location.href);
        preloadPageModule(url.pathname);
      } catch {
        // url parsing error 무시
      }
    }
  };

  const downloadAttr = typeof download === "string" ? download : download ? "" : undefined;

  return (
    <a
      href={to}
      target={target}
      download={downloadAttr}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onFocus={handleFocus}
      {...rest}
    >
      {children}
    </a>
  );
}
