import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'netlify/server-bundle/index.mjs', '**/node_modules/**', 'playwright-report/**', 'test-results/**', '.netlify/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    // The web app talks to the server only through the typed API client.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/server/**', '@app/server', '@app/server/*', '**/netlify/**'], message: 'The web app may import only the API client and @app/contract, never server code.' }] }],
    },
  },
);
