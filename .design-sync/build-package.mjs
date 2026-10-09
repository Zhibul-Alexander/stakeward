#!/usr/bin/env node
// Builds the Stakeward design system as a library package for /design-sync (cfg.buildCmd).
//
// apps/web is a site, not a published package: it has no dist/ and no .d.ts tree. This script compiles the site's own
// component source (apps/web/src/components/{ui,product} and three layout components) the way the site builds it -
// Vite with the React and Tailwind plugins and the `@/` alias - into apps/web/.ds-pkg/ (gitignored):
//   dist/index.js       ES module of the site's component code; npm dependencies stay external imports
//   dist/stakeward.css  Tailwind output for the whole site source plus a utility vocabulary (see step 1): tokens, fonts
//   types/              tsc declarations (rooted at the repo), `@/` imports rewritten to relative paths, plus index.d.ts
//   icons.js            the lucide-react icons the site uses, merged into the global (cfg.extraEntries)
//   package.json        name, module, types: what the converter reads
// Nothing here reimplements a component; the bundle is the site's code. Run from the repo root:
//   node .design-sync/build-package.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const WEB = join(ROOT, 'apps/web');
const SRC = join(WEB, 'src');
const OUT = join(WEB, '.ds-pkg');
// The cluster only changes explorer links (no ?cluster=devnet) and the devnet-only lock periods: mainnet is what prod
// serves, so designs show the real product.
const CLUSTER = 'mainnet';

// Which source files form the design system: every primitive and product component, and the page frame. App chrome
// (SiteHeader, SiteFooter, Layout) reads the router and the cluster badge and stays out.
const LAYOUT = ['Page.tsx', 'PageHeader.tsx', 'Section.tsx'];
const isModule = (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);
const files = [
  ...readdirSync(join(SRC, 'components/ui')).filter(isModule).map((f) => `components/ui/${f}`),
  ...readdirSync(join(SRC, 'components/product')).filter(isModule).map((f) => `components/product/${f}`),
  ...LAYOUT.map((f) => `components/layout/${f}`),
].sort();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. The library entry: the stylesheet, then every design-system module.
//
// Tailwind writes CSS only for classes it finds in the site source, so a class the site never uses (text-right,
// grid-cols-2, items-end, max-w-lg ...) would do nothing in a design built from this package, silently. The library
// stylesheet is the site's index.css plus `@source inline()`: the layout, spacing, sizing and type utilities, and every
// colour token as bg/text/border, with sm/md/lg variants for layout. Token names come from tokens.css itself, so a new
// token is in the vocabulary on the next build. The site's own build does not change.
const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
const colours = [...new Set([...tokens.matchAll(/--color-([a-z][a-z0-9-]*):/g)].map((m) => m[1]))].sort();
const steps = '0,0.5,1,1.5,2,2.5,3,4,5,6,8,10,12,16,20,24';
const widths = 'full,auto,fit,min,max,4,5,6,8,10,12,16,20,24,28,32,36,40,44,48,56,64,72,80,96,1/2,1/3,2/3,1/4,3/4';
const inline = [
  // layout, with breakpoints
  `{sm:,md:,lg:,}{block,inline-block,inline,flex,inline-flex,grid,inline-grid,hidden,contents}`,
  `{sm:,md:,lg:,}flex-{row,col,row-reverse,col-reverse,wrap,nowrap,1,auto,none}`,
  `{sm:,md:,lg:,}{grow,shrink-0,grow-0}`,
  `{sm:,md:,lg:,}items-{start,center,end,baseline,stretch}`,
  `{sm:,md:,lg:,}justify-{start,center,end,between,around,evenly}`,
  `{sm:,md:,lg:,}self-{auto,start,center,end,stretch}`,
  `{sm:,md:,lg:,}justify-self-{start,center,end}`,
  `{sm:,md:,lg:,}content-{start,center,end,between}`,
  `{sm:,md:,lg:,}grid-cols-{1,2,3,4,5,6,12}`,
  `{sm:,md:,lg:,}col-span-{1,2,3,4,5,6,full}`,
  `{sm:,md:,lg:,}gap{,-x,-y}-{${steps}}`,
  `{sm:,md:,lg:,}space-{x,y}-{${steps}}`,
  `{sm:,md:,lg:,}order-{first,last,none}`,
  // spacing
  `{sm:,md:,lg:,}{p,px,py,pt,pb,pl,pr,m,mx,my,mt,mb,ml,mr}-{${steps}}`,
  `{sm:,md:,lg:,}{mx,ml,mr,my,mt,mb}-auto`,
  // sizing
  `{sm:,md:,lg:,}w-{${widths}}`,
  `{sm:,md:,lg:,}max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,prose,full,none}`,
  `{min-w,min-h}-{0,full}`,
  `h-{full,auto,fit,screen,4,5,6,8,10,12,16,20,24,32,40,48,64}`,
  `size-{3,3.5,4,5,6,8,10,12,16,20,24,full}`,
  // type
  `{sm:,md:,lg:,}text-{xs,sm,base,lg,2xl,3xl}`,
  `{sm:,md:,lg:,}text-{left,center,right}`,
  `font-{normal,medium,semibold,sans,mono}`,
  `{truncate,whitespace-nowrap,whitespace-normal,break-all,break-words,tabular-nums,uppercase,lowercase,capitalize,italic,underline,no-underline,text-balance,text-pretty}`,
  `leading-{none,tight,snug,normal,relaxed}`,
  `tracking-{tight,normal,wide}`,
  `list-{none,disc,decimal}`,
  // colour tokens
  `{bg,text,border,divide,ring,outline,fill,stroke}-{${colours.join(',')}}`,
  `{hover:,}{bg,text,border}-{primary,primary-hover,subtle,subtle-hover,surface,foreground,muted}`,
  // borders, radius, elevation
  `border{,-0,-2,-t,-b,-l,-r,-x,-y}`,
  `divide-{x,y}`,
  `rounded{,-none,-sm,-md,-lg,-xl,-full}`,
  `rounded-{t,b,l,r}-{md,lg}`,
  `shadow{,-none,-sm,-md,-lg}`,
  `ring{,-0,-1,-2}`,
  // position and overflow
  `{relative,absolute,fixed,sticky,static}`,
  `{inset,top,right,bottom,left}-{0,auto}`,
  `z-{0,10,20,30,40,50}`,
  `overflow-{hidden,auto,x-auto,y-auto,visible}`,
  `{opacity-50,opacity-75,cursor-pointer,select-none,pointer-events-none,sr-only,not-sr-only,aspect-square,object-cover}`,
  `{transition,transition-colors,animate-pulse,animate-spin}`,
];
const entryCss = join(OUT, 'entry.css');
writeFileSync(entryCss, [`@import '../src/index.css';`, ...inline.map((v) => `@source inline("${v}");`)].join('\n') + '\n');
const entry = join(OUT, 'entry.ts');
writeFileSync(
  entry,
  [`import './entry.css';`, ...files.map((f) => `export * from '../src/${f}';`)].join('\n') + '\n',
);

// 2. JS and CSS with the site's own Vite plugins (resolved from apps/web, where they are installed).
const req = createRequire(join(WEB, 'package.json'));
const load = async (name) => import(pathToFileURL(req.resolve(name)).href);
const { build } = await load('vite');
const react = (await load('@vitejs/plugin-react')).default;
const tailwindcss = (await load('@tailwindcss/vite')).default;
await build({
  root: WEB,
  configFile: false,
  envDir: false,
  publicDir: false,
  logLevel: 'warn',
  plugins: [react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  define: { 'import.meta.env.VITE_CLUSTER': JSON.stringify(CLUSTER) },
  build: {
    outDir: join(OUT, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: { entry, formats: ['es'], fileName: () => 'index.js', cssFileName: 'stakeward' },
    // Like a published library: dist holds the site's own code, every npm dependency stays an import. The converter
    // bundles those from apps/web/node_modules with react and react-dom bound to its own copy; bundling them here would
    // leave CommonJS `require("react")` calls that its React shim cannot reach.
    rolldownOptions: { external: (id) => !/^(?:\.|\/|@\/|\0)/.test(id) && !/\.css$/.test(id) },
  },
});

// 3. Declarations: tsc over apps/web/src with the site's tsconfig, emit only .d.ts. The source reaches into other
// workspace folders, so the declaration tree is rooted at the repo: types/apps/web/src/...
const tsc = join(WEB, 'node_modules/.bin/tsc');
execFileSync(
  tsc,
  ['-p', join(WEB, 'tsconfig.json'), '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--rootDir', ROOT, '--declarationDir', join(OUT, 'types')],
  { stdio: 'inherit' },
);

// ts-morph (the converter) knows no `@/` alias and no `.ts`/`.tsx` import extensions: rewrite both to plain relative
// specifiers so every prop type resolves.
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const typesRoot = join(OUT, 'types');
const typesSrc = join(typesRoot, 'apps/web/src');
for (const file of walk(typesRoot).filter((p) => p.endsWith('.d.ts'))) {
  const text = readFileSync(file, 'utf8');
  const fixed = text.replace(/(from\s+|import\(\s*)(['"])([^'"]+)\2/g, (match, lead, quote, spec) => {
    let next = spec;
    if (next.startsWith('@/')) {
      next = relative(dirname(file), join(typesSrc, next.slice(2)));
      if (!next.startsWith('.')) next = `./${next}`;
    }
    if (next.startsWith('.')) next = next.replace(/\.tsx?$/, '.js');
    return `${lead}${quote}${next}${quote}`;
  });
  if (fixed !== text) writeFileSync(file, fixed);
}
writeFileSync(
  join(typesRoot, 'index.d.ts'),
  files.map((f) => `export * from './apps/web/src/${f.replace(/\.tsx?$/, '.js')}';`).join('\n') + '\n',
);

// 4. Icons: the lucide-react icons the site imports, so a design can use the same ones from window.Stakeward
// (cfg.extraEntries "./icons.js"). Read from the source on every build, so a new icon is in on the next sync.
const icons = new Set();
for (const file of walk(SRC).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim();
      if (/^[A-Z][A-Za-z0-9]*Icon$/.test(name)) icons.add(name);
    }
  }
}
writeFileSync(join(OUT, 'icons.js'), `export { ${[...icons].sort().join(', ')} } from 'lucide-react';\n`);

// 5. The package the converter reads.
writeFileSync(
  join(OUT, 'package.json'),
  JSON.stringify(
    {
      name: '@stakeward/design-system',
      version: '0.1.0',
      private: true,
      type: 'module',
      module: 'dist/index.js',
      types: 'types/index.d.ts',
      style: 'dist/stakeward.css',
    },
    null,
    2,
  ) + '\n',
);

for (const p of ['dist/index.js', 'dist/stakeward.css', 'types/index.d.ts', 'icons.js']) {
  if (!existsSync(join(OUT, p))) throw new Error(`build-package: ${p} was not written`);
}
console.log(`design system package: ${files.length} modules, ${icons.size} icons -> ${relative(ROOT, OUT)}`);
