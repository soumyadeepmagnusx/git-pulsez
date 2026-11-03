import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'backend', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Req 23.7: the frontend must not import from backend/ or any AWS SDK package.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['backend', 'backend/*', '**/backend', '**/backend/*', '**/backend/**'],
              message: 'Frontend code must not import from backend/ (Req 23.7).',
            },
            {
              group: ['@aws-sdk/*'],
              message: 'Frontend code must not import AWS SDK packages (Req 23.7).',
            },
          ],
        },
      ],
    },
  },
);
