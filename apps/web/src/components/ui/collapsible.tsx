import { cn } from 'cn';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui collapsible over Radix Collapsible, classes rewritten to design tokens. Radix writes the content's size
// variables through element.style (CSSOM, allowed by the CSP) and injects no <style> element (DECISIONS.md D3, D29).
// Used for a row's "More" actions only; text that folds away uses the native <details> instead (D109). Closed, the
// content is an empty element with `hidden`: its children are not in the DOM, so tests open it first. It fades in
// without a height animation.
function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn('data-open:animate-fade-in', className)}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
