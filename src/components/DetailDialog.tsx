import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModalFocus } from "../use-modal-focus";

export function DetailDialog({ children, id, onClose, title }: { children: ReactNode; id: string; onClose: () => void; title: string }) {
  const modal = useModalFocus<HTMLDivElement>(true, onClose);
  return createPortal(<div ref={modal} className="monitoring-detail-modal" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="monitoring-detail-panel">
      <button className="monitoring-detail-close" type="button" onClick={onClose}>닫기</button>
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  </div>, document.body);
}
