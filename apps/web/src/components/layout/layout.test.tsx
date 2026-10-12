import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { MAINNET_SITE_URL } from '@/config';
import { Page } from './Page.tsx';
import { PageHeader } from './PageHeader.tsx';
import { Section } from './Section.tsx';
import { SiteHeader } from './SiteHeader.tsx';

describe('Page', () => {
  it('is the app width by default and a centred column for flows', () => {
    const { container, rerender } = render(<Page>content</Page>);
    const page = container.querySelector('[data-slot="page"]');
    expect(page).toHaveAttribute('data-width', 'app');
    expect(page).toHaveClass('max-w-5xl', 'mx-auto');
    rerender(<Page width="flow">content</Page>);
    expect(container.querySelector('[data-slot="page"]')).toHaveAttribute('data-width', 'flow');
    expect(container.querySelector('[data-slot="page"]')).toHaveClass('max-w-2xl', 'mx-auto');
  });
});

describe('PageHeader', () => {
  it('renders the only h1 with its lead, meta, back link, action and progress, and no banner landmark', () => {
    render(
      <PageHeader
        title="Withdraw"
        lead="Take your SOL out of a protected stake account."
        meta={<p>Stakeward never asks for your seed phrase.</p>}
        back={{ href: '/app', label: 'Back to your accounts' }}
        action={<button type="button">Print this card</button>}
        progress={<ol aria-label="Steps" />}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Withdraw' })).not.toHaveAttribute('tabindex');
    expect(screen.getByText('Take your SOL out of a protected stake account.')).toBeInTheDocument();
    expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('button', { name: 'Print this card' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Steps' })).toBeInTheDocument();
    // The site header is the page's only banner.
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('leaves out what is not given', () => {
    const { container } = render(<PageHeader title="Page not found" />);
    const header = container.querySelector('[data-slot="page-header"]');
    expect(header?.querySelectorAll('p, a, [data-slot="page-header-meta"]')).toHaveLength(0);
  });

  it('lets a page move focus to the h1 without putting it in the tab order', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<PageHeader title="Protect your stake" headingRef={ref} />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Protect your stake' });
    expect(ref.current).toBe(heading);
    expect(heading).toHaveAttribute('tabindex', '-1');
    ref.current?.focus();
    expect(heading).toHaveFocus();
  });
});

describe('Section', () => {
  it('is a region named by its h2, with count, one description and an action', () => {
    render(
      <Section
        id="protected"
        title="Protected"
        count="2 · 300 SOL"
        description="Withdrawing needs your second key until the date shown."
        action={<button type="button">Select all</button>}
      >
        <p>rows</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Protected' });
    expect(region).toHaveAttribute('id', 'protected');
    expect(within(region).getByRole('heading', { level: 2, name: 'Protected' })).toHaveAttribute('id', 'protected-title');
    expect(within(region).getByText('2 · 300 SOL')).toHaveClass('tabular-nums');
    expect(within(region).getByText('Withdrawing needs your second key until the date shown.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Select all' })).toBeInTheDocument();
    expect(within(region).getByText('rows')).toBeInTheDocument();
  });

  it('takes an h3 inside another section, named without an id', () => {
    render(
      <Section title="Before you pick a second key" headingLevel={3}>
        <p>rules</p>
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Before you pick a second key' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Before you pick a second key' })).toBeInTheDocument();
  });
});

describe('SiteHeader', () => {
  it('keeps Your accounts and Rescue in words, and opens the rest under More until a page change or Escape', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    render(<SiteHeader />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Your accounts' })).toHaveAttribute('href', '/app');
    expect(within(nav).getByRole('link', { name: 'Rescue' })).toHaveAttribute('href', '/rescue');
    // Every link has its words: no icon-only link in the header.
    for (const link of within(screen.getByRole('banner')).getAllByRole('link')) expect(link.textContent.trim()).not.toBe('');

    const more = within(nav).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(more.getAttribute('aria-controls') ?? '');
    if (list === null) throw new Error('no list');
    expect(within(list).getByRole('link', { name: 'Demo' })).toHaveAttribute('href', '/demo');

    await user.keyboard('{Escape}');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();

    await user.click(more);
    const opened = document.getElementById(more.getAttribute('aria-controls') ?? '');
    if (opened === null) throw new Error('no list');
    await user.click(within(opened).getByRole('link', { name: 'Demo' }));
    expect(window.location.pathname).toBe('/demo');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  // D143: the other network's site is a button with an outline, the last link of the nav on both sites, so it stays in
  // place when you switch networks; the header shows the Devnet badge but no sentence about it.
  it('ends the nav with the other network as an outlined button, and says nothing more about devnet', () => {
    window.history.replaceState(null, '', '/');
    render(<SiteHeader />);
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    const network = links.at(-1);
    expect(network).toHaveAttribute('href', MAINNET_SITE_URL);
    expect(network).toHaveAttribute('data-variant', 'outline');
    expect(network).toHaveTextContent('Go to mainnet');
    expect(screen.getByRole('banner')).not.toHaveTextContent('no real SOL');
  });

  it('opens the language list under its button and closes it on Escape, a click elsewhere and a choice', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    render(<SiteHeader />);
    const button = screen.getByRole('button', { name: 'Language: English' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Language' });
    expect(within(list).getAllByRole('button').map((item) => [item.textContent, item.getAttribute('lang')])).toEqual([
      ['English', 'en'],
      ['ქართული', 'ka'],
    ]);
    // Spanish is translated but not offered for now (D144).
    expect(within(list).queryByRole('button', { name: 'Español' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'English' })).toHaveAttribute('aria-current', 'true');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();

    await user.click(button);
    await user.click(screen.getByRole('link', { name: 'Stakeward home' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    await user.click(within(screen.getByRole('list', { name: 'Language' })).getByRole('button', { name: 'English' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('switches the theme next to the language: light, dark or the system one, kept for the next visit (D151)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    localStorage.removeItem('stakeward:theme:v1');
    delete document.documentElement.dataset['theme'];
    render(<SiteHeader />);
    const button = screen.getByRole('button', { name: 'Theme: System' });
    // Next to the language: the theme comes first, so the language stays where it was, by the nav.
    const language = screen.getByRole('button', { name: 'Language: English' });
    expect(button.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    const list = screen.getByRole('list', { name: 'Theme' });
    expect(within(list).getAllByRole('button').map((item) => item.textContent)).toEqual(['System', 'Light', 'Dark']);
    expect(within(list).getByRole('button', { name: 'System' })).toHaveAttribute('aria-current', 'true');

    await user.click(within(list).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('stakeward:theme:v1')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Theme: Dark' }));
    await user.click(within(screen.getByRole('list', { name: 'Theme' })).getByRole('button', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem('stakeward:theme:v1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeInTheDocument();
  });

  // D149: a button of the header shows the pointer like its links; Tailwind 4 leaves a <button> the default arrow.
  it('shows the pointer over every button of the header, the language list included', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    render(<SiteHeader />);
    await user.click(screen.getByRole('button', { name: 'Language: English' }));
    const buttons = within(screen.getByRole('banner')).getAllByRole('button');
    expect(buttons.map((item) => item.textContent)).toEqual(expect.arrayContaining(['EN', 'More', 'English', 'ქართული']));
    for (const item of buttons) expect(item).toHaveClass('cursor-pointer');
  });
});
