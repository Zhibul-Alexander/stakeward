import { cn } from 'cn';
import type { ReactNode } from 'react';

/** Building blocks of the /dev/ui page: a section (h2), a group per component (h3) and one labelled state. */

export function DevSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-6">
      <h2 id={`${id}-title`} className="border-b border-border pb-2 text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DemoGroup({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        {note === undefined ? null : <p className="text-sm text-muted">{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** One state of a component, labelled with the state's name. */
export function Demo({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return (
    <figure className={cn('flex min-w-0 flex-col gap-2', className)}>
      <figcaption className="text-xs font-medium tracking-wide text-muted uppercase">{label}</figcaption>
      {children}
    </figure>
  );
}
