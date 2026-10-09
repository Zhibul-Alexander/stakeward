import { useEffect } from 'react';

/** The element the address's fragment names, or null for an empty, unknown or malformed fragment. */
function hashTarget(hash: string): HTMLElement | null {
  if (hash.length <= 1) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    // "#%E0%A4%A" and the like: not an address anyone could have meant.
    return null;
  }
  return document.getElementById(id);
}

/**
 * Opens what the fragment names, and every <details> around it (an FAQ question sits inside its closed group), then
 * brings the target to the top of the view. A target outside any <details> opens nothing.
 */
function showHashTarget() {
  const target = hashTarget(window.location.hash);
  if (target === null) return;
  for (let node: HTMLElement | null = target; node !== null; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
  // jsdom has no scrollIntoView; browsers scroll at once (no smooth scrolling, spec 17).
  const scrollable: Partial<Pick<HTMLElement, 'scrollIntoView'>> = target;
  scrollable.scrollIntoView?.({ block: 'start' });
}

/**
 * A link to `/#faq-ledger` (or `#cannot-do` from the footer of another page) opens that FAQ question and its group and
 * shows it, after the page's first render and on every later hash change on this page. The browser alone would scroll
 * to a closed <details> without opening it, and would not scroll at all when the site's router brings the page in.
 */
export function useHashTarget(): void {
  useEffect(() => {
    showHashTarget();
    window.addEventListener('hashchange', showHashTarget);
    return () => {
      window.removeEventListener('hashchange', showHashTarget);
    };
  }, []);
}
