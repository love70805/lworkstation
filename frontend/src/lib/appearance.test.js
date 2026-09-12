// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { applyAppearance } from './appearance';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('keeps the newest theme when canceling rapid animations', () => {
  document.body.innerHTML = '<div class="app-shell"></div>';
  document.documentElement.dataset.appearance = 'light';
  const cancel = vi.fn();
  document.querySelector('.app-shell').animate = vi.fn(() => ({ cancel }));
  applyAppearance('dark'); applyAppearance('light'); applyAppearance('dark');
  expect(document.documentElement.dataset.appearance).toBe('dark');
  expect(localStorage.getItem('shopeers-appearance')).toBe('dark');
  expect(cancel).toHaveBeenCalledTimes(2);
});
it('switches reliably with reduced motion and without animation support', () => {
  document.body.innerHTML = '<div class="app-shell"></div>';
  const animate = vi.fn(); document.querySelector('.app-shell').animate = animate;
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
  applyAppearance('light'); expect(animate).not.toHaveBeenCalled();
  delete document.querySelector('.app-shell').animate;
  applyAppearance('dark'); expect(document.documentElement.dataset.appearance).toBe('dark');
});
it('cleans transition suppression on same-value reentry', () => {
  document.documentElement.dataset.appearance = 'light';
  applyAppearance('dark');
  expect(document.documentElement.classList.contains('appearance-changing')).toBe(true);
  applyAppearance('dark');
  expect(document.documentElement.classList.contains('appearance-changing')).toBe(false);
});
