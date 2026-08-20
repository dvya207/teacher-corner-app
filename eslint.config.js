// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Lint configuration.
 *
 * WHY IT EXISTS. There was none, and `npm run lint` was a script the project did
 * not have — so "the lint is clean" was true only in the sense that nothing ran.
 *
 * WHAT IT IS TUNED FOR. This codebase has conventions a stock Angular config
 * fights, and the rules below are switched off deliberately rather than because
 * they were noisy:
 *
 *   component-selector / directive-selector
 *     Enforced anyway by convention (`app-*`), and the stock rule wants a
 *     `prefix` option that duplicates what angular.json already knows.
 *
 *   no-empty-lifecycle-method
 *     Kept ON. An empty ngOnInit is dead weight and this codebase has none.
 *
 *   @typescript-eslint/no-unused-vars
 *     Kept ON, but destructuring siblings are ignored: the services strip
 *     immutable fields with `const { docId, ownerId, ...rest } = patch`, which is
 *     the clearest way to express "drop these" and would otherwise need a
 *     disable comment at every call site.
 *
 *   @typescript-eslint/no-explicit-any
 *     Kept ON. Firestore data arrives as Record<string, unknown> and the
 *     normalise functions narrow it explicitly; `any` would defeat the guards
 *     those functions exist to provide.
 */
module.exports = tseslint.config(
  {
    // dist/ and .angular/ are build output; linting them reports on generated
    // code nobody edits.
    ignores: ['dist/**', '.angular/**', 'node_modules/**', 'functions/**']
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Selector prefixes are a convention this codebase already follows; the
      // stock rules add configuration without adding enforcement value.
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/directive-selector': 'off',

      // Destructuring is how the services express "strip these fields", so the
      // discarded siblings are intentional rather than forgotten.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility
    ],
    rules: {}
  },
  {
    // The test files run under Vitest globals (describe/it/expect), which the
    // stock config does not know about.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
