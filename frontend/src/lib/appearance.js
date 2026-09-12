import { normalizeAppearance } from './uiState';

let animation;
let transitionTimer;
// Apply the target synchronously. A single compositor animation never owns theme
// state, so canceling it cannot replay an older choice or touch external pages.
export function applyAppearance(value, { animate = true, document: doc = document, window: win = window } = {}) {
  const target = normalizeAppearance(value);
  const changed = doc.documentElement.dataset.appearance !== target;
  animation?.cancel();
  animation = null;
  clearTimeout(transitionTimer);
  doc.documentElement.classList.remove('appearance-changing');
  if (changed) {
    doc.documentElement.classList.add('appearance-changing');
    transitionTimer = setTimeout(() => doc.documentElement.classList.remove('appearance-changing'), 180);
  }
  doc.documentElement.dataset.appearance = target;
  try { win.localStorage.setItem('shopeers-appearance', target); } catch {}
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', target === 'dark' ? '#121821' : '#f6f7f9');
  if (changed && animate && !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    const surface = doc.querySelector('.app-shell');
    if (surface?.animate) {
      try { animation = surface.animate([{ opacity: .86 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' }); } catch {}
    }
  }
  return target;
}

export function readAppearance() {
  try { return normalizeAppearance(localStorage.getItem('shopeers-appearance') ?? window.shopeersDesktopRuntime?.appearance); }
  catch { return normalizeAppearance(window.shopeersDesktopRuntime?.appearance); }
}
