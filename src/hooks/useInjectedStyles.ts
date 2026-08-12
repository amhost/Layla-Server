import { useEffect } from "react";

/** Append a <style> element to <head> for the lifetime of the component. */
export function useInjectedStyles(css: string): void {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [css]);
}
