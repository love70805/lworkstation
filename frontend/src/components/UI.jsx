import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Info, LoaderCircle, Search, X } from "lucide-react";
import { createToastKey, createToastState, dismissToast, enqueueToast } from "../lib/uiState";

const ToastContext = createContext(null);
const openDialogs = [];
let previousBodyOverflow = "";

export function ToastProvider({ children }) {
  const [toastState, setToastState] = useState(createToastState);
  const toastSequenceRef = useRef(0);
  const toastTimersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToastState((current) => dismissToast(current, id));
  }, []);

  const notify = useCallback((message, tone = "success") => {
    const normalizedTone = ["success", "info", "warning", "error"].includes(tone) ? tone : "success";
    const key = createToastKey(message, normalizedTone);
    toastSequenceRef.current += 1;
    setToastState((current) => enqueueToast(current, {
      id: `${toastSequenceRef.current}:${key}`,
      key,
      message,
      tone: normalizedTone,
    }));
  }, []);

  useEffect(() => {
    const visibleIds = new Set(toastState.visible.map((toast) => toast.id));
    for (const toast of toastState.visible) {
      if (toastTimersRef.current.has(toast.id)) continue;
      const duration = toast.tone === "error" || toast.tone === "warning" ? 5200 : 3200;
      const timer = window.setTimeout(() => removeToast(toast.id), duration);
      toastTimersRef.current.set(toast.id, timer);
    }
    for (const [id, timer] of toastTimersRef.current) {
      if (visibleIds.has(id)) continue;
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, [removeToast, toastState.visible]);

  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) window.clearTimeout(timer);
    toastTimersRef.current.clear();
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toastState.visible.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id} role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}>
            {toast.tone === "success" ? <Check size={17} /> : toast.tone === "info" ? <Info size={17} /> : <AlertCircle size={17} />}
            <span>{toast.message}</span>
            <button type="button" className="toast-dismiss" aria-label="关闭提示" onClick={() => removeToast(toast.id)}><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function Button({ children, variant = "secondary", icon: Icon, className = "", loading = false, ...props }) {
  return (
    <button className={`button button-${variant} ${className}`} aria-busy={loading || undefined} {...props}>
      {loading ? <LoaderCircle className="spin" size={17} /> : Icon ? <Icon size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}

export const IconButton = forwardRef(function IconButton({ label, icon: Icon, className = "", ...props }, ref) {
  return (
    <button ref={ref} className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={19} />
    </button>
  );
});

export function Badge({ children, tone = "neutral", dot = false, className = "" }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}

export function Panel({ children, className = "", ...props }) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <div className={`page-heading ${className}`}>
      <div className="page-heading-copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "搜索...", className = "", shortcut, label = placeholder }) {
  return (
    <label className={`search-input ${className}`}>
      <Search size={18} />
      <input aria-label={label} value={value} onChange={onChange} placeholder={placeholder} />
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </label>
  );
}

export function ProgressBar({ value, tone = "primary", label }) {
  return (
    <div className="progress-wrap">
      <div className="progress-track"><span className={`progress-fill progress-${tone}`} style={{ width: `${value}%` }} /></div>
      {label ? <span className="progress-label">{label}</span> : null}
    </div>
  );
}

export function Modal({ open, title, description, children, footer, onClose, tone = "default", className = "", size = "medium" }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  // Inline close handlers change during editing; keep Escape current without
  // restarting the dialog's initial focus and focus restoration lifecycle.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement;
    if (!openDialogs.length) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogs.push(dialog);
    const isTopDialog = () => openDialogs.at(-1) === dialog;
    const focusInside = () => closeButtonRef.current?.focus({ preventScroll: true });
    const listener = (event) => {
      if (!isTopDialog() || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
      }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
        .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, [hidden], input[type="hidden"]') && !element.closest('[hidden], [inert]') && window.getComputedStyle(element).visibility !== "hidden" && window.getComputedStyle(element).display !== "none");
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event) => {
      if (isTopDialog() && !dialog.contains(event.target)) focusInside();
    };
    window.addEventListener("keydown", listener);
    document.addEventListener("focusin", containFocus);
    const focusTimer = window.setTimeout(() => { if (isTopDialog()) focusInside(); }, 0);
    return () => {
      const wasTop = isTopDialog();
      window.removeEventListener("keydown", listener);
      document.removeEventListener("focusin", containFocus);
      window.clearTimeout(focusTimer);
      const index = openDialogs.indexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
      if (!openDialogs.length) document.body.style.overflow = previousBodyOverflow;
      if (wasTop && previousFocusRef.current?.isConnected) previousFocusRef.current.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div ref={dialogRef} className={`modal modal-${tone} modal-size-${size} ${className}`} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton ref={closeButtonRef} icon={X} label="关闭对话框" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
