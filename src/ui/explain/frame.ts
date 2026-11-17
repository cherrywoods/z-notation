// Hover strips over the rules of a schema box (left, top, middle, bottom) that show the
// 'schema' explainer: hover = card after the usual delay, click/tap = pinned card.
// The strips are thin and lie on the rules, so editing inside the box is unaffected.
//
//   <span class="frame-strip" data-explain="schema" {@attach schemaFrame(() => ctx)}></span>

import type { Attachment } from 'svelte/attachments';
import { explain, type ExplainerContext } from './explain.svelte';

/** A small anchor rectangle at the pointer (strips can be long). */
const at = (e: MouseEvent) => new DOMRect(e.clientX - 6, e.clientY - 8, 12, 16);

export function schemaFrame(ctx: () => ExplainerContext | undefined): Attachment<HTMLElement> {
  return (el) => {
    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      explain.show({ id: 'schema', anchor: at(e), ctx: ctx(), source: el });
    };
    const leave = () => explain.hide();
    const click = (e: MouseEvent) => {
      e.preventDefault();
      explain.show({ id: 'schema', anchor: at(e), ctx: ctx(), source: el, pinned: true });
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', click);
    };
  };
}
