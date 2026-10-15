// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { revealListStart } from './pageListScroll';

afterEach(() => { document.documentElement.style.removeProperty('--topbar-height'); });
it('keeps a visible list in place and accounts for a taller topbar', () => {
  document.documentElement.style.setProperty('--topbar-height', '64px');
  const element = document.createElement('div'); element.scrollIntoView = vi.fn();
  element.getBoundingClientRect = () => ({ top: 90 });
  revealListStart(element); expect(element.scrollIntoView).not.toHaveBeenCalled();
  element.getBoundingClientRect = () => ({ top: 70 });
  revealListStart(element); expect(element.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'auto' });
});
it('reveals a list below the viewport and accepts an absent list', () => {
  const element = document.createElement('div'); element.scrollIntoView = vi.fn();
  element.getBoundingClientRect = () => ({ top: window.innerHeight });
  revealListStart(element); expect(element.scrollIntoView).toHaveBeenCalledOnce();
  expect(() => revealListStart(null)).not.toThrow();
});
