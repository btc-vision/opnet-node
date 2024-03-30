import type { Config } from '@jest/types';

const esModules = ['chalk', 'supports-color'].join('|');

// @ts-ignore
const config: Config.InitialOptions = {
    verbose: true,
    rootDir: './',
    transform: { '\\.[jt]s?$': ['ts-jest', { tsconfig: { allowJs: true } }] },
    modulePathIgnorePatterns: ['packages', 'build', 'node_modules'],
    testMatch: [
        '<rootPath>/tests/**/*.test.ts',
        '<rootPath>/tests/*.test.ts',
        '<rootDir>/tests/**',
    ],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.[jt]s$': '$1',
    },
    moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx'],
    moduleDirectories: ['node_modules', 'src', 'build'],
    testEnvironment: 'node',
    transformIgnorePatterns: [`/node_modules/(?!${esModules})`, `/build/`],
};

export default config;
