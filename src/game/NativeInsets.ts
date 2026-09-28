interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

declare global {
  interface Window {
    /** Provided by the Android shell (MainActivity) via addJavascriptInterface. */
    SkzNative?: { getInsets(): string };
  }
}

function apply(i: Insets): void {
  const root = document.documentElement.style;
  root.setProperty('--native-inset-top', `${i.top}px`);
  root.setProperty('--native-inset-right', `${i.right}px`);
  root.setProperty('--native-inset-bottom', `${i.bottom}px`);
  root.setProperty('--native-inset-left', `${i.left}px`);
}

/**
 * Safe-area handling. CSS env(safe-area-inset-*) covers browsers/iOS; on
 * Android the native shell reports WindowInsets (system bars + display
 * cutout) in CSS pixels, both on request and whenever they change.
 */
export function installNativeInsets(): void {
  const read = () => {
    try {
      const raw = window.SkzNative?.getInsets();
      if (raw) apply(JSON.parse(raw) as Insets);
    } catch {
      /* not running in the Android shell */
    }
  };
  read();
  window.addEventListener('skz-insets', (e) => apply((e as CustomEvent<Insets>).detail));
  window.addEventListener('resize', read);
}
