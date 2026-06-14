import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Shared unused-vars policy: ignore intentionally-unused PascalCase/UPPER vars
// (e.g. imported-for-side-effect components) and _-prefixed args.
const unusedVarsOptions = {
  varsIgnorePattern: '^[A-Z_]',
  argsIgnorePattern: '^_',
}

export default defineConfig([
  // .claude holds agent worktrees (full repo copies) — outside our lint scope.
  globalIgnores(['dist', 'coverage', '.claude']),
  // JS/JSX: tests (src/tests/**), the server, the service worker, and config files.
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', unusedVarsOptions],
    },
  },
  // TS/TSX: all frontend app code under src/. Non-type-checked recommended set
  // (fast, no parserOptions.project) — matches the permissive tsconfig. A future
  // hardening pass can switch to tseslint.configs.recommendedTypeChecked.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Use the TS-aware unused-vars rule with the same ignore policy.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
    },
  },
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    files: ['src/tests/sendPush.test.js', 'src/tests/server/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
