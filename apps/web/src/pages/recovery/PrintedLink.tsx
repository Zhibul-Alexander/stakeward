import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/** An address on another site (`https://...`), as opposed to a path of this one. */
function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** `href` as a full address: paths of this site get the origin it is served from (never a hard-coded domain). */
export function absoluteUrl(href: string): string {
  return isExternal(href) ? href : new URL(href, window.location.origin).toString();
}

/**
 * A link on the recovery card (DECISIONS.md D77). On screen it is a link: another site opens in a new tab and says so
 * (spec L14), a page of this site opens here. On paper, where nothing can be clicked, the full address follows the
 * label in brackets.
 */
export function PrintedLink({ href, label }: { href: string; label: string }) {
  const external = isExternal(href);
  return (
    <span data-slot="printed-link">
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={`${label} ${t('common.opensInNewTab')}`} className={LINK_CLASS}>
          {label}
        </a>
      ) : (
        <Link href={href} className={LINK_CLASS}>
          {label}
        </Link>
      )}
      <span className="hidden break-all print:inline">
        {' ('}
        {absoluteUrl(href)}
        {')'}
      </span>
    </span>
  );
}
