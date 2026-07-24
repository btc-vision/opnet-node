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
            exclude: [
                'src/src/plugins/types/**',
                '**/*.d.ts',
            ],
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
        server: {
            deps: {
                // @btc-vision/op-vm is installed as `file:../op-vm`, so it resolves
                // through a symlink pointing outside the project root. Vite inlines
                // linked packages by default and rewrites import.meta.url when it
                // does, which breaks the package's own native-binary lookup
                // ("Could not find native module for linux-x64") even though the
                // .node file is present. Externalise it so Node loads it directly.
                // Both spellings matter: the specifier is @btc-vision/op-vm, but the
                // symlink resolves to /root/op-vm/index.js, which contains no
                // @btc-vision segment for a specifier-shaped pattern to match.
                external: [/@btc-vision[\\/]op-vm/, /[\\/]op-vm[\\/]/],
            },
        },
    },
    forks: {
        singleFork: true,
    },
    resolve: {
        alias: {
            '@': '/root/opnet-node/src',
        },
    },
});
