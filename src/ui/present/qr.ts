// QR code as a single SVG path (crisp at any size; no raster).

import qrcode from 'qrcode-generator';

export interface QrSvg {
  /** viewBox size in modules, including the quiet zone. */
  size: number;
  /** Path data of the dark modules (offset by the quiet zone). */
  path: string;
}

export function qrSvg(text: string, quiet = 4): QrSvg {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      let len = 1;
      while (c + len < n && qr.isDark(r, c + len)) len++;
      path += `M${c + quiet} ${r + quiet}h${len}v1h-${len}z`;
      c += len;
    }
  }
  return { size: n + 2 * quiet, path };
}
