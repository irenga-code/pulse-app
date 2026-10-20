import { useEffect, useState } from 'react';

const current = () => window.location.hash.replace(/^#/, '') || '/';

/** The admin dashboard answers to both /#/manage and /#/admin. */
export const isAdminRoute = (route: string) => /^\/(manage|admin)(\/|$)/.test(route);

/**
 * A plain path URL such as https://site/admin (no hash) is turned into https://site/#/admin so the hash router
 * sees it. The query string is kept (sign-in links return as ?code=...).
 */
export function hashFromPath(base = import.meta.env.BASE_URL) {
  const { pathname, search, hash } = window.location;
  const root = base.endsWith('/') ? base : base + '/';
  if (hash || !pathname.startsWith(root)) return;
  const rest = pathname.slice(root.length).replace(/\/+$/, '');
  if (!isAdminRoute('/' + rest)) return;
  window.history.replaceState(window.history.state, '', `${root}${search}#/${rest}`);
}

/** Minimal hash router: returns e.g. "/" or "/manage". */
export function useHashRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
