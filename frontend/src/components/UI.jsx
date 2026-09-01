import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Info, LoaderCircle, Search, X } from "lucide-react";
import { createToastKey, createToastState, dismissToast, enqueueToast } from "../lib/uiState";

const ToastContext = createContext(null);

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

export function SearchInput({ value, onChange, placeholder = "搜索...", className = "", shortcut }) {
  return (
    <label className={`search-input ${className}`}>
      <Search size={18} />
      <input value={value} onChange={onChange} placeholder={placeholder} />
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

export function Modal({ open, title, description, children, footer, onClose, tone = "default", className = "" }) {
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const listener = (event) => event.key === "Escape" && onClose?.();
    window.addEventListener("keydown", listener);
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", listener);
      window.clearTimeout(focusTimer);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`modal modal-${tone} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
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
