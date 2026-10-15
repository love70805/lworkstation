// Page lists share the document's vertical scroll; account for the fixed topbar.
export function revealListStart(element) {
  if (!element) return;
  const inset = (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 52) + 12;
  const top = element.getBoundingClientRect().top;
  if (top < inset || top >= window.innerHeight - 48) {
    element.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }
}
