import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules/**', 'tests/Transaction/TransactionGroupFeesSorter.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            include: ['src/src/plugins/**/*.ts'],
            exclude: ['src/src/plugins/types/**', '**/*.d.ts'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 75,
                statements: 80,
            },
        },
        testTimeout: 30000,
        hookTimeout: 30000,
        pool: 'forks',
    },
    resolve: {
        alias: {
            '@': '/root/opnet-node/src',
        },
    },
});
