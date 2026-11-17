// Presenter mode (for the projector): stays on until switched off, remembered in
// localStorage. While on, <html> has the class `presenting` (larger Z text via
// --z-scale) and every page shows the join footer (QR code + address).

const KEY = 'ztut:presenter';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

class Presenter {
  on = $state(load());
  /** The large QR view (opened from the footer's QR code). */
  big = $state(false);

  constructor() {
    if (typeof document === 'undefined') return;
    $effect.root(() => {
      $effect(() => {
        document.documentElement.classList.toggle('presenting', this.on);
        if (!this.on) this.big = false;
        try {
          if (this.on) localStorage.setItem(KEY, '1');
          else localStorage.removeItem(KEY);
        } catch {
          /* storage unavailable: the mode still works for this visit */
        }
      });
    });
  }

  set(on: boolean) {
    this.on = on;
  }
  toggle() {
    this.on = !this.on;
  }
}

export const presenter = new Presenter();
