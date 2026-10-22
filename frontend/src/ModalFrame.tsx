import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = { title: string; kicker?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean };

const modalStack: HTMLElement[] = [];
const backgroundInert = new Map<HTMLElement, boolean>();
let originalOverflow = '';
let originalFocus: HTMLElement | null = null;

function syncModalBoundary() {
  const activeHost = modalStack[modalStack.length - 1];
  if (activeHost) {
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (!modalStack.includes(child) && !backgroundInert.has(child)) backgroundInert.set(child, child.inert);
      child.inert = child !== activeHost;
    }
    document.body.style.overflow = 'hidden';
  } else {
    backgroundInert.forEach((value, node) => { node.inert = value; });
    backgroundInert.clear();
    document.body.style.overflow = originalOverflow;
  }
}

function focusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]'))
    .filter(node => node.tabIndex >= 0 && !node.matches(':disabled,[hidden],input[type="hidden"]')
      && !node.closest('[inert],[hidden]') && node.getClientRects().length > 0);
}

/** One modal boundary for all teacher workflows, including nested previews. */
export default function ModalFrame({ title, kicker, children, onClose, wide = false, busy = false }: Props) {
  const [host] = useState(() => document.createElement('div'));
  const frame = useRef<HTMLDivElement>(null);
  const close = useRef(onClose), pending = useRef(busy);
  close.current = onClose; pending.current = busy;
  const titleId = useId();

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!modalStack.length) {
      originalOverflow = document.body.style.overflow;
      originalFocus = previous;
    }
    host.dataset.teacherModal = 'true';
    document.body.appendChild(host);
    // A shared boundary also restores correctly when parent and child unmount together.
    modalStack.push(host);
    syncModalBoundary();
    const dialog = frame.current;
    const topmost = () => !host.inert && host.isConnected;
    const initial = () => {
      if (!dialog || !topmost()) return;
      const targets = focusable(dialog);
      const preferred = targets.find(node => node.matches('input:not([type="file"]),textarea,select'));
      (preferred || targets[0] || dialog).focus({ preventScroll: true });
    };
    initial();
    const keydown = (event: KeyboardEvent) => {
      if (!dialog || !topmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!pending.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const targets = focusable(dialog), first = targets[0], last = targets[targets.length - 1];
      const active = document.activeElement;
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(active) || active === dialog || !targets.includes(active as HTMLElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault(); first.focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (dialog && topmost() && !dialog.contains(event.target as Node)) initial();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', keepFocus);
      const index = modalStack.indexOf(host);
      if (index >= 0) modalStack.splice(index, 1);
      host.remove();
      syncModalBoundary();
      const restore = modalStack.length ? previous : originalFocus;
      if (restore?.isConnected && !restore.closest('[inert]')) restore.focus({ preventScroll: true });
      else if (modalStack.length) {
        const activeDialog = modalStack[modalStack.length - 1].querySelector<HTMLElement>('[role="dialog"]');
        if (activeDialog) (focusable(activeDialog)[0] || activeDialog).focus({ preventScroll: true });
      }
      if (!modalStack.length) originalFocus = null;
    };
  }, [host]);

  return createPortal(<div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !pending.current) close.current();
  }}><div ref={frame} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined} tabIndex={-1}>
    <header className="modal-header"><div>{kicker && <div className="eyebrow">{kicker}</div>}<h2 id={titleId}>{title}</h2></div>
      <button type="button" className="icon-button" aria-label={`关闭${title}`} disabled={busy} onClick={() => close.current()}><X size={21}/></button>
    </header>{children}
  </div></div>, host);
}

export function useUnsavedWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);
}
