import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    PluginFilesystemAPI,
    PluginFilesystemError,
} from '../../../src/src/plugins/api/PluginFilesystemAPI.js';

describe('PluginFilesystemAPI', () => {
    let tempDir: string;
    let api: PluginFilesystemAPI;
    const pluginId = 'test-plugin';

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-fs-test-'));
        api = new PluginFilesystemAPI(pluginId, tempDir);
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('PluginFilesystemError', () => {
        it('should create error with message and code', () => {
            const error = new PluginFilesystemError('Test error', 'TEST_CODE');
            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('PluginFilesystemError');
        });

        it('should create error with path', () => {
            const error = new PluginFilesystemError('Test error', 'TEST_CODE', '/path/to/file');
            expect(error.path).toBe('/path/to/file');
        });
    });

    describe('path validation', () => {
        it('should reject paths outside plugin directories', async () => {
            await expect(api.readFile('/etc/passwd')).rejects.toThrow(PluginFilesystemError);
            await expect(api.readFile('/etc/passwd')).rejects.toThrow('Access denied');
        });

        it('should reject directory traversal attempts', async () => {
            await expect(api.readFile('../../../etc/passwd')).rejects.toThrow(PluginFilesystemError);
            await expect(api.readFile('../../../etc/passwd')).rejects.toThrow('Access denied');
        });

        it('should reject path with .. in the middle', async () => {
            await expect(api.readFile('subdir/../../../etc/passwd')).rejects.toThrow(
                PluginFilesystemError,
            );
        });

        it('should allow relative paths within config directory', async () => {
            // Write a file first
            await api.writeFile('test.txt', 'test content');

            // Should be able to read it
            const content = await api.readFile('test.txt');
            expect(content.toString()).toBe('test content');
        });

        it('should allow paths within temp directory', async () => {
            const tempPath = path.join(tempDir, pluginId, 'temp', 'test.txt');

            // Write using absolute path to temp directory
            await api.writeFile(tempPath, 'temp content');

            // Should be able to read it
            const content = await api.readFile(tempPath);
            expect(content.toString()).toBe('temp content');
        });
    });

    describe('readFile', () => {
        it('should read file contents', async () => {
            const configDir = path.join(tempDir, pluginId, 'config');
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(path.join(configDir, 'data.txt'), 'hello world');

            const content = await api.readFile('data.txt');

            expect(content.toString()).toBe('hello world');
        });

        it('should throw for non-existent file', async () => {
            await expect(api.readFile('nonexistent.txt')).rejects.toThrow(PluginFilesystemError);
            await expect(api.readFile('nonexistent.txt')).rejects.toThrow('Failed to read file');
        });

        it('should read binary files', async () => {
            const configDir = path.join(tempDir, pluginId, 'config');
            fs.mkdirSync(configDir, { recursive: true });
            const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff]);
            fs.writeFileSync(path.join(configDir, 'binary.bin'), binaryData);

            const content = await api.readFile('binary.bin');

            expect(content).toEqual(binaryData);
        });
    });

    describe('writeFile', () => {
        it('should write string content', async () => {
            await api.writeFile('test.txt', 'hello world');

            const configDir = path.join(tempDir, pluginId, 'config');
            const content = fs.readFileSync(path.join(configDir, 'test.txt'), 'utf8');
            expect(content).toBe('hello world');
        });

        it('should write Buffer content', async () => {
            const binaryData = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
            await api.writeFile('binary.bin', binaryData);

            const configDir = path.join(tempDir, pluginId, 'config');
            const content = fs.readFileSync(path.join(configDir, 'binary.bin'));
            expect(content).toEqual(binaryData);
        });

        it('should create parent directories', async () => {
            await api.writeFile('subdir/nested/file.txt', 'nested content');

            const configDir = path.join(tempDir, pluginId, 'config');
            const content = fs.readFileSync(
                path.join(configDir, 'subdir', 'nested', 'file.txt'),
                'utf8',
            );
            expect(content).toBe('nested content');
        });

        it('should overwrite existing files', async () => {
            await api.writeFile('test.txt', 'original');
            await api.writeFile('test.txt', 'updated');

            const configDir = path.join(tempDir, pluginId, 'config');
            const content = fs.readFileSync(path.join(configDir, 'test.txt'), 'utf8');
            expect(content).toBe('updated');
        });
    });

    describe('exists', () => {
        it('should return true for existing file', async () => {
            await api.writeFile('exists.txt', 'content');

            const result = await api.exists('exists.txt');

            expect(result).toBe(true);
        });

        it('should return false for non-existent file', async () => {
            const result = await api.exists('nonexistent.txt');

            expect(result).toBe(false);
        });

        it('should return true for existing directory', async () => {
            await api.mkdir('testdir');

            const result = await api.exists('testdir');

            expect(result).toBe(true);
        });

        it('should return false for path outside plugin directories', async () => {
            const result = await api.exists('/etc/passwd');

            expect(result).toBe(false);
        });
    });

    describe('mkdir', () => {
        it('should create directory', async () => {
            await api.mkdir('newdir');

            const configDir = path.join(tempDir, pluginId, 'config');
            expect(fs.existsSync(path.join(configDir, 'newdir'))).toBe(true);
        });

        it('should create nested directories', async () => {
            await api.mkdir('a/b/c');

            const configDir = path.join(tempDir, pluginId, 'config');
            expect(fs.existsSync(path.join(configDir, 'a', 'b', 'c'))).toBe(true);
        });

        it('should not throw if directory already exists', async () => {
            await api.mkdir('existing');

            // Should not throw
            await expect(api.mkdir('existing')).resolves.not.toThrow();
        });
    });

    describe('readdir', () => {
        it('should list directory contents', async () => {
            await api.writeFile('file1.txt', 'content1');
            await api.writeFile('file2.txt', 'content2');
            await api.mkdir('subdir');

            const contents = await api.readdir('.');

            expect(contents).toContain('file1.txt');
            expect(contents).toContain('file2.txt');
            expect(contents).toContain('subdir');
        });

        it('should return empty array for empty directory', async () => {
            await api.mkdir('emptydir');

            const contents = await api.readdir('emptydir');

            expect(contents).toEqual([]);
        });

        it('should throw for non-existent directory', async () => {
            await expect(api.readdir('nonexistent')).rejects.toThrow(PluginFilesystemError);
            await expect(api.readdir('nonexistent')).rejects.toThrow('Failed to read directory');
        });
    });

    describe('unlink', () => {
        it('should delete file', async () => {
            await api.writeFile('todelete.txt', 'content');
            expect(await api.exists('todelete.txt')).toBe(true);

            await api.unlink('todelete.txt');

            expect(await api.exists('todelete.txt')).toBe(false);
        });

        it('should throw for non-existent file', async () => {
            await expect(api.unlink('nonexistent.txt')).rejects.toThrow(PluginFilesystemError);
            await expect(api.unlink('nonexistent.txt')).rejects.toThrow('Failed to delete file');
        });

        it('should throw when trying to delete directory', async () => {
            await api.mkdir('adir');

            await expect(api.unlink('adir')).rejects.toThrow(PluginFilesystemError);
        });
    });

    describe('stat', () => {
        it('should return file stats', async () => {
            await api.writeFile('file.txt', 'hello');

            const stats = await api.stat('file.txt');

            expect(stats.size).toBe(5);
            expect(stats.isDirectory).toBe(false);
            expect(stats.mtime).toBeInstanceOf(Date);
        });

        it('should return directory stats', async () => {
            await api.mkdir('mydir');

            const stats = await api.stat('mydir');

            expect(stats.isDirectory).toBe(true);
        });

        it('should throw for non-existent path', async () => {
            await expect(api.stat('nonexistent')).rejects.toThrow(PluginFilesystemError);
            await expect(api.stat('nonexistent')).rejects.toThrow('Failed to get file stats');
        });
    });

    describe('config vs temp directory', () => {
        it('should auto-create config directory on first access', async () => {
            const configDir = path.join(tempDir, pluginId, 'config');
            expect(fs.existsSync(configDir)).toBe(false);

            await api.writeFile('test.txt', 'content');

            expect(fs.existsSync(configDir)).toBe(true);
        });

        it('should auto-create temp directory on first access', async () => {
            const tempPath = path.join(tempDir, pluginId, 'temp');
            expect(fs.existsSync(tempPath)).toBe(false);

            await api.writeFile(path.join(tempPath, 'test.txt'), 'content');

            expect(fs.existsSync(tempPath)).toBe(true);
        });

        it('should only create config dir once (caching)', async () => {
            await api.writeFile('file1.txt', 'content1');
            await api.writeFile('file2.txt', 'content2');
            await api.writeFile('file3.txt', 'content3');

            // All files should exist
            expect(await api.exists('file1.txt')).toBe(true);
            expect(await api.exists('file2.txt')).toBe(true);
            expect(await api.exists('file3.txt')).toBe(true);
        });
    });

    describe('absolute vs relative paths', () => {
        it('should resolve relative paths to config directory', async () => {
            await api.writeFile('relative.txt', 'content');

            const configDir = path.join(tempDir, pluginId, 'config');
            expect(fs.existsSync(path.join(configDir, 'relative.txt'))).toBe(true);
        });

        it('should allow absolute paths within permitted directories', async () => {
            const configDir = path.join(tempDir, pluginId, 'config');
            const absolutePath = path.join(configDir, 'absolute.txt');

            await api.writeFile(absolutePath, 'absolute content');

            expect(fs.existsSync(absolutePath)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle empty file', async () => {
            await api.writeFile('empty.txt', '');

            const content = await api.readFile('empty.txt');
            expect(content.toString()).toBe('');
        });

        it('should handle files with special characters in name', async () => {
            await api.writeFile('file with spaces.txt', 'content');

            const content = await api.readFile('file with spaces.txt');
            expect(content.toString()).toBe('content');
        });

        it('should handle files with unicode content', async () => {
            const unicodeContent = 'Hello \u4e16\u754c \ud83c\udf0d';
            await api.writeFile('unicode.txt', unicodeContent);

            const content = await api.readFile('unicode.txt');
            expect(content.toString()).toBe(unicodeContent);
        });

        it('should handle large files', async () => {
            const largeContent = 'x'.repeat(1024 * 1024); // 1MB
            await api.writeFile('large.txt', largeContent);

            const content = await api.readFile('large.txt');
            expect(content.length).toBe(1024 * 1024);
        });
    });
});
