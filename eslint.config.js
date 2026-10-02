// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/.wrangler/**',
    '**/worker-configuration.d.ts',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/coverage/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (CLAUDE.md section 11).',
        },
        // The CSP has style-src 'self' (DECISIONS.md D3): inline <style> elements and style attributes set as text
        // are blocked. The React style prop (CSSOM) is fine.
        {
          selector: "JSXOpeningElement[name.name='style']",
          message: 'Inline <style> is blocked by the CSP (DECISIONS.md D3). Use classes from tokens.css.',
        },
        {
          selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value='style']",
          message: "setAttribute('style') is blocked by the CSP (DECISIONS.md D3). Use element.style or classes.",
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'radix-ui',
              importNames: ['Dialog', 'AlertDialog', 'Select', 'DropdownMenu', 'ContextMenu'],
              message: 'Injects a <style> element the CSP blocks (DECISIONS.md D3). Use the native <dialog> element.',
            },
            { name: 'react-remove-scroll', message: 'Injects a <style> element the CSP blocks (DECISIONS.md D3).' },
          ],
          patterns: [
            {
              group: [
                '@radix-ui/react-dialog',
                '@radix-ui/react-alert-dialog',
                '@radix-ui/react-select',
                '@radix-ui/react-dropdown-menu',
                '@radix-ui/react-context-menu',
              ],
              message: 'Injects a <style> element the CSP blocks (DECISIONS.md D3). Use the native <dialog> element.',
            },
          ],
        },
      ],
    },
  },
]);
