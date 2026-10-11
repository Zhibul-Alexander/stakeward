import { ChevronDownIcon, CircleAlertIcon, InfoIcon, ShieldCheckIcon, TriangleAlertIcon, WalletIcon } from 'lucide-react';
import { useId } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/i18n';
import { Demo, DemoGroup, DevSection } from './layout.tsx';

const BUTTON_VARIANTS = ['primary', 'outline', 'ghost', 'danger', 'link'] as const;
const TONES = ['neutral', 'success', 'warning', 'info', 'danger', 'outline', 'primary'] as const;
const BADGE_SIZES = ['sm', 'md'] as const;
/** The large alert: the /cosign stop panel. */
const ALERT_LARGE = { tone: 'danger', size: 'lg' } as const;
const ALERT_TONES = [
  ['neutral', InfoIcon],
  ['success', ShieldCheckIcon],
  ['warning', TriangleAlertIcon],
  ['info', InfoIcon],
  ['danger', CircleAlertIcon],
] as const;

/** The shadcn/ui primitives in src/components/ui, each variant once, so /design-sync and reviews see them all. */
export function PrimitivesSection() {
  const ids = {
    input: useId(),
    invalid: useId(),
    invalidHint: useId(),
    disabled: useId(),
    textarea: useId(),
    checkbox: useId(),
    checkboxOn: useId(),
    period: useId(),
  };
  return (
    <DevSection id="primitives" title={t('devUi.primitives')}>
      <DemoGroup title={t('devUi.buttons')}>
        <Demo label={t('devUi.buttonHierarchy')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button>{t('devUi.sample.protectTwo')}</Button>
            <Button variant="outline">{t('devUi.sample.extend')}</Button>
            <Button variant="ghost">{t('common.back')}</Button>
          </div>
          <p className="max-w-prose text-sm text-muted">{t('devUi.buttonRule')}</p>
        </Demo>
        <div className="flex flex-wrap items-center gap-2">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">sm</Button>
          <Button size="md">md</Button>
          <Button size="lg">lg</Button>
          <Button size="icon" variant="outline" aria-label={t('components.walletSlot.connect')}>
            <WalletIcon aria-hidden="true" />
          </Button>
          <Button disabled>{t('devUi.disabled')}</Button>
          <Button variant="outline" disabled>
            {t('devUi.disabled')}
          </Button>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.badges')}>
        {BADGE_SIZES.map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            <span className="w-8 shrink-0 font-mono text-xs text-muted">{size}</span>
            {TONES.map((tone) => (
              <Badge key={tone} tone={tone} size={size}>
                {tone}
              </Badge>
            ))}
          </div>
        ))}
      </DemoGroup>

      <DemoGroup title={t('devUi.alerts')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ALERT_TONES.map(([tone, Icon]) => (
            <Alert key={tone} tone={tone} role="note">
              <Icon aria-hidden="true" />
              <AlertTitle>
                {t('devUi.alertTitle')} · {tone}
              </AlertTitle>
              <AlertDescription>{t('devUi.alertBody')}</AlertDescription>
            </Alert>
          ))}
        </div>
        <Alert tone={ALERT_LARGE.tone} size={ALERT_LARGE.size} role="note">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>
            {t('devUi.alertTitle')} · {ALERT_LARGE.tone} · {ALERT_LARGE.size}
          </AlertTitle>
          <AlertDescription>
            <p>{t('devUi.alertLargeBody')}</p>
            <a href="#primitives">{t('devUi.alertLink')}</a>
          </AlertDescription>
        </Alert>
      </DemoGroup>

      <DemoGroup title={t('devUi.collapsible')} note={t('devUi.collapsibleNote')}>
        <Collapsible className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('devUi.collapsibleRow')}</span>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('devUi.collapsibleTrigger')}>
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="flex flex-wrap items-center gap-2 rounded-md bg-subtle p-3">
            <Button variant="outline" size="sm">
              {t('devUi.sample.withdraw')}
            </Button>
            <Button variant="outline" size="sm">
              {t('devUi.sample.extend')}
            </Button>
          </CollapsibleContent>
        </Collapsible>
      </DemoGroup>

      <DemoGroup title={t('devUi.formControls')}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.input}>{t('devUi.inputLabel')}</Label>
            <Input id={ids.input} placeholder={t('devUi.inputPlaceholder')} autoComplete="off" spellCheck={false} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.invalid}>{t('devUi.inputInvalid')}</Label>
            <Input id={ids.invalid} defaultValue="0xabc" aria-invalid="true" aria-describedby={ids.invalidHint} />
            <p id={ids.invalidHint} className="text-sm text-danger">
              {t('devUi.inputInvalidHint')}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.disabled}>{t('devUi.disabled')}</Label>
            <Input id={ids.disabled} disabled placeholder={t('devUi.inputPlaceholder')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ids.textarea}>{t('devUi.textareaLabel')}</Label>
            <Textarea id={ids.textarea} rows={3} placeholder={t('devUi.textareaPlaceholder')} spellCheck={false} className="font-mono" />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Checkbox id={ids.checkbox} />
              <Label htmlFor={ids.checkbox}>{t('devUi.checkboxLabel')}</Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox id={ids.checkboxOn} defaultChecked />
              <Label htmlFor={ids.checkboxOn}>{t('devUi.checkboxLabel')}</Label>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span id={ids.period} className="text-sm font-medium">
              {t('devUi.periodLabel')}
            </span>
            <RadioGroup aria-labelledby={ids.period} defaultValue="6">
              {(
                [
                  ['1', 'devUi.period1'],
                  ['6', 'devUi.period6'],
                  ['12', 'devUi.period12'],
                ] as const
              ).map(([value, key]) => (
                <div key={value} className="flex items-center gap-3">
                  <RadioGroupItem value={value} id={`${ids.period}-${value}`} />
                  <Label htmlFor={`${ids.period}-${value}`}>{t(key)}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.feedback')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Demo label={t('devUi.progress')}>
            <Progress value={0} aria-label={t('devUi.progress')} />
            <Progress value={40} aria-label={t('devUi.progress')} />
            <Progress value={100} aria-label={t('devUi.progress')} />
          </Demo>
          <Demo label={t('devUi.spinner')}>
            <Spinner className="size-6 text-muted" />
          </Demo>
          <Demo label={t('devUi.skeleton')}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Demo>
        </div>
        <Separator />
        <div className="flex flex-wrap items-start gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">{t('devUi.tooltipTrigger')}</Button>
            </TooltipTrigger>
            <TooltipContent>{t('devUi.tooltipText')}</TooltipContent>
          </Tooltip>
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle asChild>
                <h4>{t('devUi.card')}</h4>
              </CardTitle>
              <CardDescription>{t('devUi.alertBody')}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">{t('common.neverSeedPhrase')}</CardContent>
            <CardFooter>
              <Button size="sm">{t('common.continue')}</Button>
              <Button size="sm" variant="ghost">
                {t('common.cancel')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </DemoGroup>
    </DevSection>
  );
}
