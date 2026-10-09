import { cn } from 'cn';
import { useId, type ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';

export type RadioCardOption = {
  value: string;
  /** The option's name; it alone is the radio's accessible name. */
  title: string;
  /** One muted line under the title, e.g. "until 3 April 2027". */
  meta?: ReactNode;
  /** Next to the title, e.g. <Badge tone="success">Recommended</Badge>. */
  badge?: ReactNode;
  /** One line that explains the option, tied to the radio with aria-describedby. */
  description?: string | undefined;
  /** `danger`: an option that removes protection. It sits apart, after a separator, with its title in danger text. */
  tone?: 'default' | 'danger' | undefined;
  /** Why this option cannot be chosen here. The option is disabled and says so under its description. */
  disabledReason?: string | undefined;
};

type RadioCardGroupProps = {
  legend: string;
  /** The legend only for screen readers, when a heading right above says the same. */
  legendHidden?: boolean | undefined;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly RadioCardOption[];
  /** 2: two columns from 640 px. */
  columns?: 1 | 2 | undefined;
  className?: string | undefined;
};

/**
 * A choice between a few options, each a card with its words next to its radio (DECISIONS.md D112). The whole card is
 * the radio's label, so a click anywhere on it chooses; the radio stays visible, so the choice is never shown by colour
 * alone (the chosen card also turns primary-soft with a primary frame). Arrow keys move between options (Radix).
 */
export function RadioCardGroup({ legend, legendHidden = false, value, onValueChange, options, columns = 1, className }: RadioCardGroupProps) {
  const id = useId();
  const legendId = `${id}-legend`;
  const regular = options.filter((option) => option.tone !== 'danger');
  const danger = options.filter((option) => option.tone === 'danger');
  const card = (option: RadioCardOption, index: number) => {
    const base = `${id}-${String(index)}`;
    const ids = {
      item: `${base}-item`,
      title: `${base}-title`,
      meta: `${base}-meta`,
      description: `${base}-description`,
      reason: `${base}-reason`,
    };
    const disabled = option.disabledReason !== undefined;
    const describedBy = [
      option.meta === undefined ? null : ids.meta,
      option.description === undefined ? null : ids.description,
      disabled ? ids.reason : null,
    ].filter((part) => part !== null);
    return (
      <label
        key={option.value}
        htmlFor={ids.item}
        data-slot="radio-card"
        data-tone={option.tone ?? 'default'}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:bg-subtle',
          'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft',
          disabled && 'cursor-not-allowed hover:bg-surface',
        )}
      >
        <RadioGroupItem
          value={option.value}
          id={ids.item}
          disabled={disabled}
          aria-labelledby={ids.title}
          aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(' ')}
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span id={ids.title} className={cn('text-sm font-medium', option.tone === 'danger' ? 'text-danger' : 'text-foreground')}>
              {option.title}
            </span>
            {option.badge}
          </span>
          {option.meta === undefined ? null : (
            <span id={ids.meta} className="text-sm text-muted tabular-nums">
              {option.meta}
            </span>
          )}
          {option.description === undefined ? null : (
            <span id={ids.description} className="text-sm text-muted">
              {option.description}
            </span>
          )}
          {disabled ? (
            <span id={ids.reason} className="text-sm font-medium text-foreground">
              {option.disabledReason}
            </span>
          ) : null}
        </span>
      </label>
    );
  };
  return (
    <fieldset data-slot="radio-card-group" className={cn('flex min-w-0 flex-col', className)}>
      <legend id={legendId} className={legendHidden ? 'sr-only' : 'mb-3 text-sm font-medium'}>
        {legend}
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        value={value}
        onValueChange={onValueChange}
        className={cn('grid grid-cols-1 gap-3', columns === 2 && 'sm:grid-cols-2')}
      >
        {regular.map((option, index) => card(option, index))}
        {danger.length === 0 ? null : <Separator className={cn(columns === 2 && 'sm:col-span-2')} />}
        {danger.map((option, index) => card(option, regular.length + index))}
      </RadioGroup>
    </fieldset>
  );
}
