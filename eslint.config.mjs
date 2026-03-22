import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier,
    },
    rules: {
      // Prettier runs as an ESLint rule
      'prettier/prettier': [
        'error',
        {
          semi: true,
          trailingComma: 'es5',
          singleQuote: true,
          printWidth: 100,
          tabWidth: 2,
          useTabs: false,
          bracketSpacing: true,
          arrowParens: 'avoid',
          endOfLine: 'lf',
          quoteProps: 'as-needed',
          bracketSameLine: false,
          proseWrap: 'preserve',
        },
      ],

      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-var-requires': 'off',

      // Disable no-undef for TypeScript — tsc handles this far more accurately
      // See: https://typescript-eslint.io/troubleshooting/faqs/eslint#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',

      // Block NaCl re-introduction (Phase 4 cleanup)
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'tweetnacl',
              message: 'TweetNaCl removed — use Signal Protocol via @signalapp/libsignal-client',
            },
            {
              name: 'tweetnacl-util',
              message: 'TweetNaCl removed — use Signal Protocol via @signalapp/libsignal-client',
            },
          ],
          patterns: [
            {
              group: ['**/key-migration*'],
              message: 'key-migration.ts deleted — use signal-keygen.ts instead',
            },
            {
              group: ['**/migration-flow*'],
              message: 'migration-flow.ts deleted — legacy migration code removed',
            },
            {
              group: ['**/epoch-service*', '**/epoch-history-service*'],
              message: 'Epoch placeholder services deleted — use history-crypto-service.ts',
            },
            {
              group: ['**/invite-ephemeral-key-service*'],
              message: 'invite-ephemeral-key-service.ts deleted — placeholder removed',
            },
          ],
        },
      ],

      // General JavaScript rules
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-unused-vars': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'release/**',
      'test-results/**',
      'test-results-report/**',
      'native/**',
      'scripts/**',
      '*.js',
    ],
  },
];
