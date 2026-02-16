import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginLoader, PluginLoadError } from '../../../src/src/plugins/loader/PluginLoader.js';
import { MLDSALevel, PLUGIN_MAGIC_BYTES } from '../../../src/src/plugins/interfaces/IPluginFile.js';
import {
    createMockMetadata,
    createPluginFileBuffer,
    createTruncatedPluginFileBuffer,
} from '../mocks/index.js';

describe('PluginLoader', () => {
    let loader: PluginLoader;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
        loader = new PluginLoader(tempDir);
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('constructor', () => {
        it('should create loader with plugins directory', () => {
            expect(loader).toBeInstanceOf(PluginLoader);
        });
    });

    describe('discoverPlugins', () => {
        it('should return empty array for non-existent directory', () => {
            const nonExistentDir = path.join(tempDir, 'non-existent');
            const newLoader = new PluginLoader(nonExistentDir);
            const plugins = newLoader.discoverPlugins();
            expect(plugins).toEqual([]);
            // Directory should be created
            expect(fs.existsSync(nonExistentDir)).toBe(true);
        });

        it('should return empty array for empty directory', () => {
            const plugins = loader.discoverPlugins();
            expect(plugins).toEqual([]);
        });

        it('should discover .opnet files', () => {
            const pluginPath = path.join(tempDir, 'test-plugin.opnet');
            fs.writeFileSync(pluginPath, 'dummy');

            const plugins = loader.discoverPlugins();
            expect(plugins).toHaveLength(1);
            expect(plugins[0]).toBe(pluginPath);
        });

        it('should discover multiple .opnet files', () => {
            fs.writeFileSync(path.join(tempDir, 'plugin-a.opnet'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'plugin-b.opnet'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'plugin-c.opnet'), 'dummy');

            const plugins = loader.discoverPlugins();
            expect(plugins).toHaveLength(3);
        });

        it('should exclude disabled plugins (.opnet.disabled)', () => {
            fs.writeFileSync(path.join(tempDir, 'enabled.opnet'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'disabled.opnet.disabled'), 'dummy');

            const plugins = loader.discoverPlugins();
            expect(plugins).toHaveLength(1);
            expect(plugins[0]).toContain('enabled.opnet');
        });

        it('should ignore non-plugin files', () => {
            fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'config.json'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'plugin.opnet'), 'dummy');

            const plugins = loader.discoverPlugins();
            expect(plugins).toHaveLength(1);
        });
    });

    describe('discoverAllPlugins', () => {
        it('should include both enabled and disabled plugins', () => {
            fs.writeFileSync(path.join(tempDir, 'enabled.opnet'), 'dummy');
            fs.writeFileSync(path.join(tempDir, 'disabled.opnet.disabled'), 'dummy');

            const plugins = loader.discoverAllPlugins();
            expect(plugins).toHaveLength(2);

            const enabledPlugin = plugins.find((p) => !p.isDisabled);
            const disabledPlugin = plugins.find((p) => p.isDisabled);

            expect(enabledPlugin).toBeDefined();
            expect(enabledPlugin?.pluginId).toBe('enabled');
            expect(disabledPlugin).toBeDefined();
            expect(disabledPlugin?.pluginId).toBe('disabled');
        });

        it('should extract plugin ID from filename', () => {
            fs.writeFileSync(path.join(tempDir, 'my-awesome-plugin.opnet'), 'dummy');

            const plugins = loader.discoverAllPlugins();
            expect(plugins[0].pluginId).toBe('my-awesome-plugin');
        });
    });

    describe('isPluginFileDisabled', () => {
        it('should return true for disabled files', () => {
            expect(loader.isPluginFileDisabled('/path/to/plugin.opnet.disabled')).toBe(true);
        });

        it('should return false for enabled files', () => {
            expect(loader.isPluginFileDisabled('/path/to/plugin.opnet')).toBe(false);
        });
    });

    describe('disablePluginFile', () => {
        it('should rename file to disabled', () => {
            const enabledPath = path.join(tempDir, 'plugin.opnet');
            fs.writeFileSync(enabledPath, 'dummy');

            const disabledPath = loader.disablePluginFile(enabledPath);

            expect(disabledPath).toBe(enabledPath + '.disabled');
            expect(fs.existsSync(disabledPath)).toBe(true);
            expect(fs.existsSync(enabledPath)).toBe(false);
        });

        it('should return same path if already disabled', () => {
            const disabledPath = path.join(tempDir, 'plugin.opnet.disabled');
            fs.writeFileSync(disabledPath, 'dummy');

            const result = loader.disablePluginFile(disabledPath);

            expect(result).toBe(disabledPath);
        });
    });

    describe('enablePluginFile', () => {
        it('should rename file to enabled', () => {
            const disabledPath = path.join(tempDir, 'plugin.opnet.disabled');
            fs.writeFileSync(disabledPath, 'dummy');

            const enabledPath = loader.enablePluginFile(disabledPath);

            expect(enabledPath).toBe(path.join(tempDir, 'plugin.opnet'));
            expect(fs.existsSync(enabledPath)).toBe(true);
            expect(fs.existsSync(disabledPath)).toBe(false);
        });

        it('should return same path if already enabled', () => {
            const enabledPath = path.join(tempDir, 'plugin.opnet');
            fs.writeFileSync(enabledPath, 'dummy');

            const result = loader.enablePluginFile(enabledPath);

            expect(result).toBe(enabledPath);
        });
    });

    describe('parsePluginFile', () => {
        it('should parse valid plugin file', () => {
            const metadata = createMockMetadata({ name: 'test-plugin' });
            const buffer = createPluginFileBuffer(metadata);
            const filePath = path.join(tempDir, 'test-plugin.opnet');
            fs.writeFileSync(filePath, buffer);

            const parsed = loader.parsePluginFile(filePath);

            expect(parsed.metadata.name).toBe('test-plugin');
            expect(parsed.bytecode).toBeDefined();
            expect(parsed.checksum).toBeDefined();
        });

        it('should throw for non-existent file', () => {
            const filePath = path.join(tempDir, 'non-existent.opnet');

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
            expect(() => loader.parsePluginFile(filePath)).toThrow('Failed to read plugin file');
        });

        it('should throw for file too small', () => {
            const filePath = path.join(tempDir, 'small.opnet');
            fs.writeFileSync(filePath, createTruncatedPluginFileBuffer());

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
        });

        it('should throw for invalid magic bytes', () => {
            const metadata = createMockMetadata();
            const buffer = createPluginFileBuffer(metadata, { invalidMagic: true });
            const filePath = path.join(tempDir, 'invalid-magic.opnet');
            fs.writeFileSync(filePath, buffer);

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
            expect(() => loader.parsePluginFile(filePath)).toThrow('Invalid magic bytes');
        });

        it('should throw for unsupported version', () => {
            const metadata = createMockMetadata();
            const buffer = createPluginFileBuffer(metadata, { invalidVersion: true });
            const filePath = path.join(tempDir, 'invalid-version.opnet');
            fs.writeFileSync(filePath, buffer);

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
            expect(() => loader.parsePluginFile(filePath)).toThrow('Unsupported format version');
        });

        it('should throw for checksum mismatch', () => {
            const metadata = createMockMetadata();
            const buffer = createPluginFileBuffer(metadata, { invalidChecksum: true });
            const filePath = path.join(tempDir, 'invalid-checksum.opnet');
            fs.writeFileSync(filePath, buffer);

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
            expect(() => loader.parsePluginFile(filePath)).toThrow('Checksum mismatch');
        });

        it('should parse file with proto', () => {
            const metadata = createMockMetadata();
            const buffer = createPluginFileBuffer(metadata, { includeProto: true });
            const filePath = path.join(tempDir, 'with-proto.opnet');
            fs.writeFileSync(filePath, buffer);

            const parsed = loader.parsePluginFile(filePath);

            expect(parsed.proto).toBeDefined();
            expect(new TextDecoder().decode(parsed.proto)).toContain('proto3');
        });

        it('should parse file without proto', () => {
            const metadata = createMockMetadata();
            const buffer = createPluginFileBuffer(metadata, { includeProto: false });
            const filePath = path.join(tempDir, 'no-proto.opnet');
            fs.writeFileSync(filePath, buffer);

            const parsed = loader.parsePluginFile(filePath);

            expect(parsed.proto).toBeUndefined();
        });

        it('should handle different MLDSA levels', () => {
            for (const level of [MLDSALevel.MLDSA44, MLDSALevel.MLDSA65, MLDSALevel.MLDSA87]) {
                const metadata = createMockMetadata({ name: `plugin-level-${level}` });
                const buffer = createPluginFileBuffer(metadata, { mldsaLevel: level });
                const filePath = path.join(tempDir, `plugin-level-${level}.opnet`);
                fs.writeFileSync(filePath, buffer);

                const parsed = loader.parsePluginFile(filePath);
                expect(parsed.mldsaLevel).toBe(level);
            }
        });

        it('should throw for invalid JSON metadata', () => {
            // Create a buffer with invalid JSON in metadata section
            const parts: Buffer[] = [];
            parts.push(PLUGIN_MAGIC_BYTES);

            const versionBuf = Buffer.alloc(4);
            versionBuf.writeUInt32LE(1, 0);
            parts.push(versionBuf);

            const levelBuf = Buffer.alloc(1);
            levelBuf.writeUInt8(MLDSALevel.MLDSA44, 0);
            parts.push(levelBuf);

            parts.push(Buffer.alloc(1312, 0x01)); // public key
            parts.push(Buffer.alloc(2420, 0x02)); // signature

            const invalidJson = 'not valid json{{{';
            const metadataLenBuf = Buffer.alloc(4);
            metadataLenBuf.writeUInt32LE(invalidJson.length, 0);
            parts.push(metadataLenBuf);
            parts.push(Buffer.from(invalidJson));

            const bytecodeLenBuf = Buffer.alloc(4);
            bytecodeLenBuf.writeUInt32LE(10, 0);
            parts.push(bytecodeLenBuf);
            parts.push(Buffer.alloc(10, 0x03));

            const protoLenBuf = Buffer.alloc(4);
            protoLenBuf.writeUInt32LE(0, 0);
            parts.push(protoLenBuf);

            parts.push(Buffer.alloc(32, 0xff));

            const filePath = path.join(tempDir, 'invalid-json.opnet');
            fs.writeFileSync(filePath, Buffer.concat(parts));

            expect(() => loader.parsePluginFile(filePath)).toThrow(PluginLoadError);
            expect(() => loader.parsePluginFile(filePath)).toThrow('Invalid metadata JSON');
        });
    });

    describe('createPluginDataDir', () => {
        it('should create data directory for plugin', () => {
            const dataDir = loader.createPluginDataDir('my-plugin');

            expect(dataDir).toBe(path.join(tempDir, 'my-plugin'));
            expect(fs.existsSync(dataDir)).toBe(true);
        });

        it('should return existing directory if already exists', () => {
            const existingDir = path.join(tempDir, 'existing-plugin');
            fs.mkdirSync(existingDir);

            const dataDir = loader.createPluginDataDir('existing-plugin');

            expect(dataDir).toBe(existingDir);
        });
    });

    describe('getPluginDataDir', () => {
        it('should return correct path', () => {
            const dataDir = loader.getPluginDataDir('my-plugin');
            expect(dataDir).toBe(path.join(tempDir, 'my-plugin'));
        });
    });

    describe('PluginLoadError', () => {
        it('should create error with message and code', () => {
            const error = new PluginLoadError('Test error', 'TEST_CODE');
            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('PluginLoadError');
        });

        it('should create error with file path', () => {
            const error = new PluginLoadError('Test error', 'TEST_CODE', '/path/to/file');
            expect(error.filePath).toBe('/path/to/file');
        });
    });
});
