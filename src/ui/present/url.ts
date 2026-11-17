// The address students should open. On a local or LAN address (the lecturer's laptop),
// the published site is shown instead.

/** The published tutorial. */
export const PUBLIC_URL = 'https://cherrywoods.github.io/z-notation/';

function isLocal(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    h === '' ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h) || // IPv6 unique local
    /^fe80:/.test(h) // IPv6 link local
  );
}

/** URL for the QR code and the large address: origin + path, or PUBLIC_URL when local. */
export function joinUrl(loc: Pick<Location, 'hostname' | 'origin' | 'pathname'> = location): string {
  return isLocal(loc.hostname) ? PUBLIC_URL : loc.origin + loc.pathname;
}
