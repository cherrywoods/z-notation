// Hash router (GitHub Pages friendly).
//
//   #/                       start page
//   #/present                presentation mode (QR code) over the start page
//   #/t/<topicId>/<step>     tutorial; step = 'about' | 'types' | 'state' | '<operation id>' | 'init' | 'spec'
//
// Browser back/forward works: every navigation is a history entry (unless `replace`).

export type Route =
  | { name: 'start' }
  | { name: 'present' }
  | { name: 'tutorial'; topicId: string; step: string };

export function parse(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  if (parts[0] === 'present') return { name: 'present' };
  if (parts[0] === 't' && parts[1]) return { name: 'tutorial', topicId: parts[1], step: parts[2] || 'about' };
  return { name: 'start' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'start':
      return '#/';
    case 'present':
      return '#/present';
    case 'tutorial':
      return `#/t/${encodeURIComponent(route.topicId)}/${encodeURIComponent(route.step)}`;
  }
}

/** Hash for a tutorial step. */
export const stepHref = (topicId: string, step: string) => href({ name: 'tutorial', topicId, step });

class Router {
  route = $state<Route>(typeof location === 'undefined' ? { name: 'start' } : parse(location.hash));

  constructor() {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const next = parse(location.hash);
      if (href(next) !== href(this.route)) this.route = next;
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    // number in-app history entries so `back()` knows whether there is one to go back to
    if (!history.state || typeof history.state.ztut !== 'number') history.replaceState({ ztut: 0 }, '');
    // plain clicks on in-app links (<a href="#/…">) go through the router
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
      if (!a || a.hasAttribute('target') || a.hasAttribute('download')) return;
      e.preventDefault();
      this.go(a.getAttribute('href')!);
    });
  }

  /** Navigate to a hash (`#/…`) or route. */
  go(to: string | Route, opts: { replace?: boolean } = {}) {
    const hash = typeof to === 'string' ? to : href(to);
    const route = parse(hash);
    const depth = (history.state?.ztut ?? 0) as number;
    if (href(route) === href(this.route)) {
      if (location.hash !== hash) history.replaceState({ ztut: depth }, '', hash);
      return;
    }
    if (opts.replace) history.replaceState({ ztut: depth }, '', hash);
    else history.pushState({ ztut: depth + 1 }, '', hash);
    this.route = route;
  }

  /** Replace the current entry (e.g. redirects for unknown topics/steps). */
  replace(to: string | Route) {
    this.go(to, { replace: true });
  }

  /** History back if the previous entry belongs to this app, else go to `fallback`. */
  back(fallback: string | Route = '#/') {
    if ((history.state?.ztut ?? 0) > 0) history.back();
    else this.replace(fallback);
  }
}

export const router = new Router();
