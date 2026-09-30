import { useEffect } from 'react';

/** Keep mobile navigation out of the visual viewport while the OS keyboard is open. */
export function useMobileKeyboard() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const mobile = window.matchMedia('(max-width: 767px) and (pointer: coarse)');
    let baseline = window.innerHeight;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;

    const update = () => {
      if (!mobile.matches) {
        document.documentElement.classList.remove('mobile-keyboard-open');
        return;
      }
      const obscured = Math.max(baseline, window.innerHeight) - viewport.height - viewport.offsetTop;
      const open = obscured > 120;
      document.documentElement.classList.toggle('mobile-keyboard-open', open);
      if (!open) {
        baseline = window.innerHeight;
        return;
      }
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches('input, textarea, select, [contenteditable="true"]')) return;
        const rect = active.getBoundingClientRect();
        const top = viewport.offsetTop + 12;
        const bottom = viewport.offsetTop + viewport.height - 20;
        if (rect.top < top || rect.bottom > bottom) active.scrollIntoView({ block: 'center', behavior: 'instant' });
      }, 140);
    };
    const reset = () => { baseline = window.innerHeight; update(); };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('orientationchange', reset);
    mobile.addEventListener('change', reset);
    update();
    return () => {
      clearTimeout(scrollTimer);
      document.documentElement.classList.remove('mobile-keyboard-open');
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', reset);
      mobile.removeEventListener('change', reset);
    };
  }, []);
}