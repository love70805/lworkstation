export const MAX_VISIBLE_TOASTS = 2;

const CRITICAL_TOAST_TONES = new Set(["error", "warning"]);

export function normalizeAppearance(value) {
  return value === "dark" || value === "soft" ? "dark" : "light";
}

export function toggleAppearance(value) {
  return normalizeAppearance(value) === "dark" ? "light" : "dark";
}

export function createToastState() {
  return { visible: [], pending: [] };
}

export function createToastKey(message, tone) {
  return `${tone}:${String(message).trim().replace(/\s+/g, " ")}`;
}

export function enqueueToast(state, toast) {
  const key = toast.key ?? createToastKey(toast.message, toast.tone);
  if ([...state.visible, ...state.pending].some((item) => item.key === key)) return state;

  const nextToast = { ...toast, key };
  if (state.visible.length < MAX_VISIBLE_TOASTS) {
    return { ...state, visible: [...state.visible, nextToast] };
  }

  if (CRITICAL_TOAST_TONES.has(nextToast.tone)) {
    const replaceIndex = state.visible.findIndex((item) => !CRITICAL_TOAST_TONES.has(item.tone));
    if (replaceIndex >= 0) {
      const visible = [...state.visible];
      const [deferred] = visible.splice(replaceIndex, 1, nextToast);
      return { visible, pending: [deferred, ...state.pending] };
    }
  }

  return { ...state, pending: [...state.pending, nextToast] };
}

export function dismissToast(state, id) {
  if (!state.visible.some((toast) => toast.id === id)) return state;
  const visible = state.visible.filter((toast) => toast.id !== id);
  if (state.pending.length === 0) return { ...state, visible };

  const criticalIndex = state.pending.findIndex((toast) => CRITICAL_TOAST_TONES.has(toast.tone));
  const nextIndex = criticalIndex >= 0 ? criticalIndex : 0;
  const pending = [...state.pending];
  const [nextToast] = pending.splice(nextIndex, 1);
  return { visible: [...visible, nextToast], pending };
}
