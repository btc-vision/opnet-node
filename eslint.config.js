// @ts-check

import tseslint from 'typescript-eslint';
import eslint from '@eslint/js';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigDirName: import.meta.dirname,
            },
        },
        rules: {
            'no-undef': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-empty': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/only-throw-error': 'off',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/unbound-method': 'warn',
            '@typescript-eslint/no-confusing-void-expression': 'off',
            '@typescript-eslint/no-extraneous-class': 'off',
            'no-async-promise-executor': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-unnecessary-type-parameters': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'off',
            'prefer-spread': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/related-getter-setter-pairs': 'off',
            'max-depth': ['error', 8],
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/no-unnecessary-type-arguments': 'off',
            'no-debugger': 'off',
            '@typescript-eslint/no-unnecessary-type-conversion': 'warn',
        },
    },
    {
        files: ['**/*.js'],
        ...tseslint.configs.disableTypeChecked,
    },
);
