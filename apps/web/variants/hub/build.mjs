// Builds the design-preview index (uis.stakeward.com) from variants.json into ./site.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const variants = JSON.parse(readFileSync(new URL('variants.json', here), 'utf8'));
const out = new URL('site/', here);
mkdirSync(out, { recursive: true });
cpSync(new URL('style.css', here), new URL('style.css', out));
if (existsSync(new URL('shots/', here))) cpSync(new URL('shots/', here), new URL('shots/', out), { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const card = (v) => {
  const url = `https://ui${v.n}.stakeward.com`;
  const shot = existsSync(new URL(`shots/v${v.n}.png`, here)) ? `<img src="shots/v${v.n}.png" alt="" loading="lazy">` : '<div class="noshot"></div>';
  return `<li class="card"><a href="${url}">${shot}<div class="meta"><span class="tag">${String(v.n).padStart(2, '0')} · ${esc(v.wave)}</span><h2>${esc(v.name)}</h2><p>${esc(v.text)}</p><span class="go">ui${v.n}.stakeward.com →</span></div></a>
<nav class="deep"><a href="${url}/app">Accounts</a><a href="${url}/protect">Protect</a><a href="${url}/rescue">Rescue</a><a href="${url}/cosign">Co-sign</a></nav></li>`;
};
const section = (wave, title) =>
  `<section><h2 class="wave">${title}</h2><ul class="grid">${variants.filter((v) => v.wave === wave).map(card).join('')}</ul></section>`;
writeFileSync(
  new URL('index.html', out),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Stakeward UI previews</title><link rel="stylesheet" href="style.css"></head><body>
<header><h1>Stakeward · design previews</h1><p>Ten directions for the same product, all on Solana devnet with the real dev API. Pick one; nothing here touches mainnet.</p></header>
<main>${section('Restyle', 'Restyles: same structure, different design system')}${section('Rethink', 'Rethinks: new layout, elements and copy')}</main>
<footer>Current production design: <a href="https://dev.stakeward.com">dev.stakeward.com</a></footer></body></html>`,
);
console.log('hub built');
