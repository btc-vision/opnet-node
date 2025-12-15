import * as fs from 'fs/promises';
import * as path from 'path';
import { IPluginFilesystemAPI } from '../context/PluginContext.js';

/**
 * Filesystem error for permission violations and other filesystem issues
 */
export class PluginFilesystemError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly path?: string,
    ) {
        super(message);
        this.name = 'PluginFilesystemError';
    }
}

/**
 * Plugin Filesystem API
 * Restricts plugin filesystem access to their own config and temp directories
 */
export class PluginFilesystemAPI implements IPluginFilesystemAPI {
    private readonly pluginId: string;
    private readonly basePluginsDir: string;
    private readonly configDir: string;
    private readonly tempDir: string;
    private configDirCreated: boolean = false;
    private tempDirCreated: boolean = false;

    constructor(pluginId: string, basePluginsDir: string) {
        this.pluginId = pluginId;
        this.basePluginsDir = path.resolve(basePluginsDir);
        this.configDir = path.join(this.basePluginsDir, pluginId, 'config');
        this.tempDir = path.join(this.basePluginsDir, pluginId, 'temp');
    }

    /**
     * Read a file as a Buffer
     */
    public async readFile(filePath: string): Promise<Buffer> {
        const resolvedPath = await this.validateAndResolvePath(filePath);
        try {
            return await fs.readFile(resolvedPath);
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
                'READ_FAILED',
                filePath,
            );
        }
    }

    /**
     * Write data to a file
     */
    public async writeFile(filePath: string, data: Buffer | string): Promise<void> {
        const resolvedPath = await this.validateAndResolvePath(filePath);

        // Ensure parent directory exists
        const parentDir = path.dirname(resolvedPath);
        await this.ensureDirectoryExists(parentDir);

        try {
            await fs.writeFile(resolvedPath, data);
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
                'WRITE_FAILED',
                filePath,
            );
        }
    }

    /**
     * Check if a file or directory exists
     */
    public async exists(filePath: string): Promise<boolean> {
        try {
            const resolvedPath = await this.validateAndResolvePath(filePath);
            await fs.access(resolvedPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create a directory
     */
    public async mkdir(dirPath: string): Promise<void> {
        const resolvedPath = await this.validateAndResolvePath(dirPath);
        try {
            await fs.mkdir(resolvedPath, { recursive: true });
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`,
                'MKDIR_FAILED',
                dirPath,
            );
        }
    }

    /**
     * Read directory contents
     */
    public async readdir(dirPath: string): Promise<string[]> {
        const resolvedPath = await this.validateAndResolvePath(dirPath);
        try {
            return await fs.readdir(resolvedPath);
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`,
                'READDIR_FAILED',
                dirPath,
            );
        }
    }

    /**
     * Delete a file
     */
    public async unlink(filePath: string): Promise<void> {
        const resolvedPath = await this.validateAndResolvePath(filePath);
        try {
            await fs.unlink(resolvedPath);
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
                'UNLINK_FAILED',
                filePath,
            );
        }
    }

    /**
     * Get file or directory statistics
     */
    public async stat(
        filePath: string,
    ): Promise<{ size: number; isDirectory: boolean; mtime: Date }> {
        const resolvedPath = await this.validateAndResolvePath(filePath);
        try {
            const stats = await fs.stat(resolvedPath);
            return {
                size: stats.size,
                isDirectory: stats.isDirectory(),
                mtime: stats.mtime,
            };
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to get file stats: ${error instanceof Error ? error.message : String(error)}`,
                'STAT_FAILED',
                filePath,
            );
        }
    }

    /**
     * Validate path and resolve it to an absolute path
     * Ensures the path is within the plugin's permitted directories
     */
    private async validateAndResolvePath(filePath: string): Promise<string> {
        // Resolve to absolute path
        let resolvedPath: string;

        if (path.isAbsolute(filePath)) {
            resolvedPath = path.resolve(filePath);
        } else {
            // Relative paths are resolved relative to config directory by default
            resolvedPath = path.resolve(this.configDir, filePath);
        }

        // Normalize to remove any .. or . segments
        resolvedPath = path.normalize(resolvedPath);

        // Check if path is within config or temp directory
        const isInConfigDir = this.isPathInDirectory(resolvedPath, this.configDir);
        const isInTempDir = this.isPathInDirectory(resolvedPath, this.tempDir);

        if (!isInConfigDir && !isInTempDir) {
            throw new PluginFilesystemError(
                `Access denied: Path "${filePath}" is outside plugin directories. ` +
                    `Plugins can only access their config and temp directories.`,
                'ACCESS_DENIED',
                filePath,
            );
        }

        // Ensure the appropriate base directory exists
        if (isInConfigDir) {
            await this.ensureConfigDirExists();
        } else if (isInTempDir) {
            await this.ensureTempDirExists();
        }

        return resolvedPath;
    }

    /**
     * Check if a path is within a directory (prevents directory traversal)
     */
    private isPathInDirectory(targetPath: string, directory: string): boolean {
        const normalizedTarget = path.normalize(targetPath);
        const normalizedDir = path.normalize(directory);

        // Ensure both paths end with separator for accurate comparison
        const dirWithSep = normalizedDir.endsWith(path.sep)
            ? normalizedDir
            : normalizedDir + path.sep;

        return normalizedTarget === normalizedDir || normalizedTarget.startsWith(dirWithSep);
    }

    /**
     * Ensure config directory exists
     */
    private async ensureConfigDirExists(): Promise<void> {
        if (this.configDirCreated) {
            return;
        }

        try {
            await fs.mkdir(this.configDir, { recursive: true });
            this.configDirCreated = true;
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to create config directory: ${error instanceof Error ? error.message : String(error)}`,
                'CONFIG_DIR_CREATION_FAILED',
            );
        }
    }

    /**
     * Ensure temp directory exists
     */
    private async ensureTempDirExists(): Promise<void> {
        if (this.tempDirCreated) {
            return;
        }

        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            this.tempDirCreated = true;
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to create temp directory: ${error instanceof Error ? error.message : String(error)}`,
                'TEMP_DIR_CREATION_FAILED',
            );
        }
    }

    /**
     * Ensure a directory exists (helper for writeFile)
     */
    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            throw new PluginFilesystemError(
                `Failed to create directory: ${error instanceof Error ? error.message : String(error)}`,
                'DIRECTORY_CREATION_FAILED',
                dirPath,
            );
        }
    }
}
