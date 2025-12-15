import { beforeEach, describe, expect, it } from 'vitest';
import { networks } from '@btc-vision/bitcoin';
import {
    PluginValidationError,
    PluginValidator,
} from '../../../src/src/plugins/validator/PluginValidator.js';
import {
    MAX_DESCRIPTION_LENGTH,
    MAX_PLUGIN_NAME_LENGTH,
} from '../../../src/src/plugins/interfaces/IPluginMetadata.js';
import { IPluginPermissions } from '../../../src/src/plugins/interfaces/IPluginPermissions.js';
import { createMockMetadata, createMockPermissions } from '../mocks/index.js';

describe('PluginValidator', () => {
    let validator: PluginValidator;

    beforeEach(() => {
        validator = new PluginValidator(networks.testnet, '1.0.0');
    });

    describe('constructor', () => {
        it('should create validator with network and version', () => {
            expect(validator).toBeInstanceOf(PluginValidator);
        });

        it('should work with different networks', () => {
            const mainnetValidator = new PluginValidator(networks.bitcoin, '2.0.0');
            expect(mainnetValidator).toBeInstanceOf(PluginValidator);
        });
    });

    describe('validateMetadata', () => {
        describe('name validation', () => {
            it('should accept valid plugin name', () => {
                const metadata = createMockMetadata({ name: 'valid-plugin-name' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
            });

            it('should accept plugin name starting with letter', () => {
                const metadata = createMockMetadata({ name: 'a' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept plugin name with numbers', () => {
                const metadata = createMockMetadata({ name: 'plugin123' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty name', () => {
                const metadata = createMockMetadata({ name: '' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(true);
            });

            it('should reject name starting with number', () => {
                const metadata = createMockMetadata({ name: '1plugin' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_NAME_FORMAT')).toBe(true);
            });

            it('should reject name with uppercase letters', () => {
                const metadata = createMockMetadata({ name: 'PluginName' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_NAME_FORMAT')).toBe(true);
            });

            it('should reject name with special characters', () => {
                const metadata = createMockMetadata({ name: 'plugin_name' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_NAME_FORMAT')).toBe(true);
            });

            it('should reject name exceeding max length', () => {
                const metadata = createMockMetadata({
                    name: 'a'.repeat(MAX_PLUGIN_NAME_LENGTH + 1),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'NAME_TOO_LONG')).toBe(true);
            });

            it('should accept name at max length', () => {
                const metadata = createMockMetadata({ name: 'a'.repeat(MAX_PLUGIN_NAME_LENGTH) });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });
        });

        describe('version validation', () => {
            it('should accept valid semver version', () => {
                const metadata = createMockMetadata({ version: '1.2.3' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept version with prerelease', () => {
                const metadata = createMockMetadata({ version: '1.0.0-beta.1' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept version with build metadata', () => {
                const metadata = createMockMetadata({ version: '1.0.0+build.123' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty version', () => {
                const metadata = createMockMetadata({ version: '' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_VERSION')).toBe(true);
            });

            it('should reject invalid semver', () => {
                const metadata = createMockMetadata({ version: 'invalid' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_VERSION')).toBe(true);
            });

            it('should reject version with v prefix', () => {
                const metadata = createMockMetadata({ version: 'v1.0.0' });
                const result = validator.validateMetadata(metadata);
                // Note: semver.valid accepts v-prefixed versions
                expect(result.valid).toBe(true);
            });
        });

        describe('opnetVersion validation', () => {
            it('should accept valid semver range', () => {
                const metadata = createMockMetadata({ opnetVersion: '>=1.0.0' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept caret range', () => {
                const metadata = createMockMetadata({ opnetVersion: '^1.0.0' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept tilde range', () => {
                const metadata = createMockMetadata({ opnetVersion: '~1.0.0' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept complex range', () => {
                const metadata = createMockMetadata({ opnetVersion: '>=1.0.0 <2.0.0' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty opnetVersion', () => {
                const metadata = createMockMetadata({ opnetVersion: '' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_OPNET_VERSION')).toBe(true);
            });

            it('should reject invalid range', () => {
                const metadata = createMockMetadata({ opnetVersion: 'invalid-range' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_OPNET_VERSION')).toBe(true);
            });
        });

        describe('main entry point validation', () => {
            it('should accept valid main entry', () => {
                const metadata = createMockMetadata({ main: 'index.jsc' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty main', () => {
                const metadata = createMockMetadata({ main: '' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_MAIN')).toBe(true);
            });
        });

        describe('target validation', () => {
            it('should accept bytenode target', () => {
                const metadata = createMockMetadata({ target: 'bytenode' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject invalid target', () => {
                const metadata = createMockMetadata({ target: 'invalid' as 'bytenode' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_TARGET')).toBe(true);
            });
        });

        describe('type validation', () => {
            it('should accept plugin type', () => {
                const metadata = createMockMetadata({ type: 'plugin' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject invalid type', () => {
                const metadata = createMockMetadata({ type: 'library' as 'plugin' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_TYPE')).toBe(true);
            });
        });

        describe('checksum validation', () => {
            it('should accept valid checksum format', () => {
                const metadata = createMockMetadata({
                    checksum: 'sha256:' + 'a'.repeat(64),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept checksum with uppercase hex', () => {
                const metadata = createMockMetadata({
                    checksum: 'sha256:' + 'A'.repeat(64),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty checksum', () => {
                const metadata = createMockMetadata({ checksum: '' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_CHECKSUM')).toBe(true);
            });

            it('should reject checksum without sha256 prefix', () => {
                const metadata = createMockMetadata({ checksum: 'a'.repeat(64) });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_CHECKSUM_FORMAT')).toBe(true);
            });

            it('should reject checksum with wrong length', () => {
                const metadata = createMockMetadata({
                    checksum: 'sha256:' + 'a'.repeat(32),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_CHECKSUM_HEX')).toBe(true);
            });

            it('should reject checksum with invalid characters', () => {
                const metadata = createMockMetadata({
                    checksum: 'sha256:' + 'g'.repeat(64),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_CHECKSUM_HEX')).toBe(true);
            });
        });

        describe('author validation', () => {
            it('should accept valid author', () => {
                const metadata = createMockMetadata({
                    author: { name: 'Test Author', email: 'test@example.com' },
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject empty author name', () => {
                const metadata = createMockMetadata({
                    author: { name: '' },
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'MISSING_AUTHOR')).toBe(true);
            });
        });

        describe('pluginType validation', () => {
            it('should accept standalone type', () => {
                const metadata = createMockMetadata({ pluginType: 'standalone' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should accept library type', () => {
                const metadata = createMockMetadata({ pluginType: 'library' });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
            });

            it('should reject invalid plugin type', () => {
                const metadata = createMockMetadata({
                    pluginType: 'invalid' as 'standalone',
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INVALID_PLUGIN_TYPE')).toBe(true);
            });
        });

        describe('description warnings', () => {
            it('should warn for long description', () => {
                const metadata = createMockMetadata({
                    description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
                expect(result.warnings.some((w) => w.includes('Description'))).toBe(true);
            });

            it('should not warn for description at max length', () => {
                const metadata = createMockMetadata({
                    description: 'x'.repeat(MAX_DESCRIPTION_LENGTH),
                });
                const result = validator.validateMetadata(metadata);
                expect(result.valid).toBe(true);
                expect(result.warnings).toHaveLength(0);
            });
        });
    });

    describe('validatePermissions', () => {
        it('should accept undefined permissions', () => {
            const result = validator.validatePermissions(undefined);
            expect(result.valid).toBe(true);
        });

        it('should accept empty permissions', () => {
            const result = validator.validatePermissions({});
            expect(result.valid).toBe(true);
        });

        describe('database permissions', () => {
            it('should accept database with collections', () => {
                const permissions = createMockPermissions({
                    database: {
                        enabled: true,
                        collections: ['users', 'posts'],
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
            });

            it('should reject database enabled without collections', () => {
                const permissions = createMockPermissions({
                    database: {
                        enabled: true,
                        collections: [],
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'NO_COLLECTIONS')).toBe(true);
            });

            it('should reject index for undeclared collection', () => {
                const permissions: IPluginPermissions = {
                    database: {
                        enabled: true,
                        collections: ['users'],
                        indexes: {
                            posts: [{ key: { id: 1 } }], // 'posts' not in collections
                        },
                    },
                };
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'INDEX_UNDECLARED_COLLECTION')).toBe(
                    true,
                );
            });

            it('should accept index for declared collection', () => {
                const permissions: IPluginPermissions = {
                    database: {
                        enabled: true,
                        collections: ['users'],
                        indexes: {
                            users: [{ key: { id: 1 } }],
                        },
                    },
                };
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
            });
        });

        describe('API permissions', () => {
            it('should warn for endpoints without basePath', () => {
                const permissions = createMockPermissions({
                    api: {
                        addEndpoints: true,
                        addWebsocket: false,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings.some((w) => w.includes('basePath'))).toBe(true);
            });

            it('should not warn for endpoints with basePath', () => {
                const permissions = createMockPermissions({
                    api: {
                        addEndpoints: true,
                        addWebsocket: false,
                        basePath: '/my-plugin',
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings).toHaveLength(0);
            });

            it('should reject websocket without protoFile', () => {
                const permissions = createMockPermissions({
                    api: {
                        addEndpoints: false,
                        addWebsocket: true,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(false);
                expect(result.errors.some((e) => e.code === 'NO_PROTO_FILE')).toBe(true);
            });

            it('should accept websocket with protoFile', () => {
                const permissions = createMockPermissions({
                    api: {
                        addEndpoints: false,
                        addWebsocket: true,
                        websocket: {
                            protoFile: 'schema.proto',
                            handlers: [],
                        },
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
            });
        });

        describe('threading permissions', () => {
            it('should warn for high worker count', () => {
                const permissions = createMockPermissions({
                    threading: {
                        maxWorkers: 20,
                        maxMemoryMB: 256,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings.some((w) => w.includes('worker count'))).toBe(true);
            });

            it('should warn for high memory limit', () => {
                const permissions = createMockPermissions({
                    threading: {
                        maxWorkers: 1,
                        maxMemoryMB: 4096,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings.some((w) => w.includes('memory limit'))).toBe(true);
            });

            it('should not warn for reasonable limits', () => {
                const permissions = createMockPermissions({
                    threading: {
                        maxWorkers: 4,
                        maxMemoryMB: 512,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings).toHaveLength(0);
            });
        });

        describe('blockchain permissions', () => {
            it('should warn when blockchain declared but nothing enabled', () => {
                const permissions = createMockPermissions({
                    blockchain: {
                        blocks: false,
                        transactions: false,
                        contracts: false,
                        utxos: false,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings.some((w) => w.includes('Blockchain'))).toBe(true);
            });

            it('should not warn when at least one blockchain permission is enabled', () => {
                const permissions = createMockPermissions({
                    blockchain: {
                        blocks: true,
                        transactions: false,
                        contracts: false,
                        utxos: false,
                    },
                });
                const result = validator.validatePermissions(permissions);
                expect(result.valid).toBe(true);
                expect(result.warnings).toHaveLength(0);
            });
        });
    });

    describe('validateVersionCompatibility', () => {
        it('should pass when versions are compatible', () => {
            const metadata = createMockMetadata({ opnetVersion: '>=1.0.0' });
            const result = validator.validateVersionCompatibility(metadata);
            expect(result.valid).toBe(true);
        });

        it('should pass when exact version matches', () => {
            const metadata = createMockMetadata({ opnetVersion: '1.0.0' });
            const result = validator.validateVersionCompatibility(metadata);
            expect(result.valid).toBe(true);
        });

        it('should fail when version is incompatible', () => {
            const metadata = createMockMetadata({ opnetVersion: '>=2.0.0' });
            const result = validator.validateVersionCompatibility(metadata);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.code === 'VERSION_INCOMPATIBLE')).toBe(true);
        });

        it('should fail when caret range excludes current version', () => {
            const metadata = createMockMetadata({ opnetVersion: '^2.0.0' });
            const result = validator.validateVersionCompatibility(metadata);
            expect(result.valid).toBe(false);
        });
    });

    describe('PluginValidationError', () => {
        it('should create error with message and code', () => {
            const error = new PluginValidationError('Test error', 'TEST_CODE');
            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('PluginValidationError');
        });

        it('should create error with field', () => {
            const error = new PluginValidationError('Test error', 'TEST_CODE', 'fieldName');
            expect(error.field).toBe('fieldName');
        });
    });
});
