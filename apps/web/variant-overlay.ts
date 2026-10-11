import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * UI design variants for preview subdomains (ui1.stakeward.com ...). With VITE_UI_VARIANT=v1 the build resolves every
 * module under src/ to variants/v1/<same path> when that file exists, so a variant replaces presentation files
 * (index.css, tokens, layout, pages) while the logic stays shared. Unset: the normal site, this plugin does nothing.
 */
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = resolve(ROOT, 'src');

export const UI_VARIANTS = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const;

export function uiVariant(): string | undefined {
  const value = process.env['VITE_UI_VARIANT'];
  if (value === undefined || value === '') return undefined;
  if (!(UI_VARIANTS as readonly string[]).includes(value)) throw new Error(`Unknown VITE_UI_VARIANT "${value}".`);
  return value;
}

export function variantOverlay(variant: string | undefined): Plugin {
  const overlay = variant === undefined ? '' : resolve(ROOT, 'variants', variant);
  return {
    name: 'stakeward-ui-variant-overlay',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (variant === undefined) return null;
      // Inside a variant, relative and `@/` imports resolve as if the file sat at its src/ path.
      const fromOverlay = importer !== undefined && importer.startsWith(overlay + sep);
      const effectiveImporter = fromOverlay ? join(SRC, relative(overlay, importer)) : importer;
      const effectiveSource = source.startsWith('@/') ? join(SRC, source.slice(2)) : source;
      const resolved = await this.resolve(effectiveSource, effectiveImporter, { ...options, skipSelf: true });
      if (resolved === null || resolved.external) return resolved;
      const [file = '', query] = resolved.id.split('?');
      if (!file.startsWith(SRC + sep)) return resolved;
      const candidate = join(overlay, relative(SRC, file));
      if (!existsSync(candidate)) return resolved;
      return query === undefined ? candidate : `${candidate}?${query}`;
    },
  };
}
