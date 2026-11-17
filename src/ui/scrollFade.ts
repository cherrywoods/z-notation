// Fades the edge(s) of a horizontally scrolling row where there is more to scroll to,
// so it is obvious that the row continues. No fade when everything fits.
//
//   <div class="row" {@attach scrollFade()}>…</div>

import type { Attachment } from 'svelte/attachments';

export function scrollFade(size = 36): Attachment<HTMLElement> {
  return (el) => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = el.scrollWidth - el.clientWidth;
      const left = max > 1 && el.scrollLeft > 1 ? size : 0;
      const right = max > 1 && el.scrollLeft < max - 1 ? size : 0;
      const mask =
        left || right
          ? `linear-gradient(to right, transparent 0, #000 ${left}px, #000 calc(100% - ${right}px), transparent 100%)`
          : '';
      el.style.setProperty('mask-image', mask);
      el.style.setProperty('-webkit-mask-image', mask);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const content = new MutationObserver(schedule);
    content.observe(el, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      resize.disconnect();
      content.disconnect();
    };
  };
}
