// Flat config. The rule set is deliberately narrow: it catches what the
// TypeScript compiler does not, and takes no position on formatting.
//
// Severity policy:
//   error — almost always a defect, and cheap to fix. `npm run lint` must
//           exit 0, so anything at error level is kept at zero.
//   warn  — worth seeing, judgement required, does not block. `no-explicit-any`
//           and `exhaustive-deps` are here because the honest fix is
//           case-by-case and a blocking gate would just collect inline
//           disables, which is the same as not having the rule.
//
// The `^_` ignore patterns are not a new convention — they are the one this
// codebase already uses (`_filePath`, `_next`).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      // Linted by mobile/eslint.config.mjs, which exists now. This line
      // used to claim that and there was no config there at all, so
      // `cd mobile && npm run lint` walked up to THIS file, found itself
      // ignored, and exited 1 having checked nothing.
      'mobile/**',
      'src/frontend/.vite/**',
      'resources/**',
      '**/*.wasm',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // An unused binding is dead code or a forgotten edit. A leading
      // underscore is the existing way to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // Judgement calls — visible, not blocking. See the severity policy above.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    files: ['src/frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Wrong deps cause stale closures and render loops, but the fix is
      // often a deliberate restructure rather than adding the dep.
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: { globals: globals.browser },
  },

  {
    files: ['src/backend/**/*.ts', 'src/electron/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // This package is "type": "commonjs" and these processes run under
      // CommonJS. Lazy `require()` is the established way here to break import
      // cycles at call time. The rule stays on for the frontend, which is
      // bundled as ESM and where a `require()` is a genuine mistake.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
