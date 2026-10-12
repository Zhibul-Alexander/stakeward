import { cn } from 'cn';
import { CheckIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';

export type HeaderMenuItem = {
  id: string;
  label: string;
  /** The item's language, for a screen reader (a language named in itself). */
  lang?: string | undefined;
  icon?: LucideIcon | undefined;
  current: boolean;
  onSelect: () => void;
};

type HeaderMenuProps = {
  /** The list's name ("Language", "Theme"). */
  label: string;
  /** The button's name: the setting and its current value ("Language: English"). */
  buttonLabel: string;
  /** What the closed button shows: an icon, and a short code if there is room. */
  buttonContent: ReactNode;
  items: readonly HeaderMenuItem[];
  className?: string | undefined;
};

/**
 * A setting in the site header (the language D143, the theme D151): a small button showing the current value (no
 * chevron: the header has no room for one at 640 px; `aria-expanded` says it opens), opening a list of buttons under it,
 * the current one marked. Not Radix DropdownMenu, which the CSP rules out (D3): a disclosure with a list of buttons.
 * Choosing, Escape, a click elsewhere and a page change close it; focus goes back to the button.
 */
export function HeaderMenu({ label, buttonLabel, buttonContent, items, className }: HeaderMenuProps) {
  const listId = useId();
  const [location] = useLocation();
  // The page the list was opened on: a page change closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpenOn(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpenOn(null);
    button.current?.focus();
  };

  return (
    <div
      ref={root}
      className={cn('relative', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="gap-1.5 px-2"
        onClick={() => {
          setOpenOn(open ? null : location);
        }}
      >
        {buttonContent}
      </Button>
      {open ? (
        <ul
          id={listId}
          role="list"
          aria-label={label}
          className="animate-reveal absolute top-full right-0 z-50 mt-1 flex min-w-40 flex-col gap-0.5 rounded-md border border-border bg-surface p-1 shadow-md"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  lang={item.lang}
                  aria-current={item.current ? 'true' : undefined}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-subtle aria-[current=true]:font-medium max-sm:min-h-11 pointer-coarse:min-h-11"
                  onClick={() => {
                    item.onSelect();
                    close();
                  }}
                >
                  {Icon === undefined ? (
                    item.label
                  ) : (
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                      {item.label}
                    </span>
                  )}
                  {item.current ? <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
