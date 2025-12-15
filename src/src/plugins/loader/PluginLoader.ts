import { Logger } from '@btc-vision/bsi-common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import {
    IParsedPluginFile,
    IPluginFileHeader,
    MLDSALevel,
    MLDSA_PUBLIC_KEY_SIZES,
    MLDSA_SIGNATURE_SIZES,
    PLUGIN_MAGIC_BYTES,
    PLUGIN_FORMAT_VERSION,
    MIN_PLUGIN_FILE_SIZE,
    MAX_METADATA_SIZE,
    MAX_BYTECODE_SIZE,
    MAX_PROTO_SIZE,
    calculateHeaderSize,
} from '../interfaces/IPluginFile.js';
import { IPluginMetadata } from '../interfaces/IPluginMetadata.js';

/**
 * Plugin loader error
 */
export class PluginLoadError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly filePath?: string,
    ) {
        super(message);
        this.name = 'PluginLoadError';
    }
}

/**
 * Plugin Loader
 * Discovers and parses .opnet plugin files
 */
export class PluginLoader extends Logger {
    public readonly logColor: string = '#4CAF50';

    private readonly pluginsDir: string;

    constructor(pluginsDir: string) {
        super();
        this.pluginsDir = pluginsDir;
    }

    /**
     * Discover all .opnet files in the plugins directory
     */
    public discoverPlugins(): string[] {
        try {
            // Ensure plugins directory exists
            if (!fs.existsSync(this.pluginsDir)) {
                this.info(`Creating plugins directory: ${this.pluginsDir}`);
                fs.mkdirSync(this.pluginsDir, { recursive: true });
                return [];
            }

            const files = fs.readdirSync(this.pluginsDir);
            const pluginFiles = files
                .filter((f) => f.endsWith('.opnet'))
                .map((f) => path.join(this.pluginsDir, f));

            this.info(`Discovered ${pluginFiles.length} plugin file(s)`);
            return pluginFiles;
        } catch (error) {
            this.error(`Failed to discover plugins: ${error}`);
            throw new PluginLoadError(
                `Failed to scan plugins directory: ${error}`,
                'DISCOVERY_FAILED',
            );
        }
    }

    /**
     * Parse a .opnet plugin file
     */
    public parsePluginFile(filePath: string): IParsedPluginFile {
        this.info(`Parsing plugin file: ${filePath}`);

        // Read file
        let buffer: Buffer;
        try {
            buffer = fs.readFileSync(filePath);
        } catch (error) {
            throw new PluginLoadError(`Failed to read plugin file: ${error}`, 'READ_FAILED', filePath);
        }

        // Validate minimum size
        if (buffer.length < MIN_PLUGIN_FILE_SIZE) {
            throw new PluginLoadError(
                `Plugin file too small: ${buffer.length} bytes (minimum: ${MIN_PLUGIN_FILE_SIZE})`,
                'FILE_TOO_SMALL',
                filePath,
            );
        }

        // Parse header
        const header = this.parseHeader(buffer, filePath);

        // Calculate offsets
        const headerSize = calculateHeaderSize(header.mldsaLevel);
        let offset = headerSize;

        // Parse metadata
        const metadataLength = buffer.readUInt32LE(offset);
        offset += 4;

        if (metadataLength > MAX_METADATA_SIZE) {
            throw new PluginLoadError(
                `Metadata too large: ${metadataLength} bytes (maximum: ${MAX_METADATA_SIZE})`,
                'METADATA_TOO_LARGE',
                filePath,
            );
        }

        const rawMetadata = buffer.subarray(offset, offset + metadataLength).toString('utf8');
        offset += metadataLength;

        let metadata: IPluginMetadata;
        try {
            metadata = JSON.parse(rawMetadata) as IPluginMetadata;
        } catch (error) {
            throw new PluginLoadError(
                `Invalid metadata JSON: ${error}`,
                'INVALID_METADATA_JSON',
                filePath,
            );
        }

        // Parse bytecode
        const bytecodeLength = buffer.readUInt32LE(offset);
        offset += 4;

        if (bytecodeLength > MAX_BYTECODE_SIZE) {
            throw new PluginLoadError(
                `Bytecode too large: ${bytecodeLength} bytes (maximum: ${MAX_BYTECODE_SIZE})`,
                'BYTECODE_TOO_LARGE',
                filePath,
            );
        }

        const bytecode = buffer.subarray(offset, offset + bytecodeLength);
        offset += bytecodeLength;

        // Parse proto (optional)
        const protoLength = buffer.readUInt32LE(offset);
        offset += 4;

        let proto: Buffer | undefined;
        if (protoLength > 0) {
            if (protoLength > MAX_PROTO_SIZE) {
                throw new PluginLoadError(
                    `Proto too large: ${protoLength} bytes (maximum: ${MAX_PROTO_SIZE})`,
                    'PROTO_TOO_LARGE',
                    filePath,
                );
            }
            proto = buffer.subarray(offset, offset + protoLength);
            offset += protoLength;
        }

        // Parse checksum (last 32 bytes)
        const checksum = buffer.subarray(offset, offset + 32);
        if (checksum.length !== 32) {
            throw new PluginLoadError(
                `Invalid checksum length: ${checksum.length} (expected: 32)`,
                'INVALID_CHECKSUM_LENGTH',
                filePath,
            );
        }

        // Verify checksum
        const computedChecksum = this.computeChecksum(rawMetadata, bytecode, proto);
        if (!checksum.equals(computedChecksum)) {
            throw new PluginLoadError(
                `Checksum mismatch: expected ${checksum.toString('hex')}, got ${computedChecksum.toString('hex')}`,
                'CHECKSUM_MISMATCH',
                filePath,
            );
        }

        this.info(`Successfully parsed plugin: ${metadata.name} v${metadata.version}`);

        return {
            formatVersion: header.version,
            mldsaLevel: header.mldsaLevel,
            publicKey: header.publicKey,
            signature: header.signature,
            metadata,
            rawMetadata,
            bytecode,
            proto,
            checksum,
        };
    }

    /**
     * Parse the file header
     */
    private parseHeader(buffer: Buffer, filePath: string): IPluginFileHeader {
        let offset = 0;

        // Magic bytes
        const magic = buffer.subarray(offset, offset + 8);
        offset += 8;

        if (!magic.equals(PLUGIN_MAGIC_BYTES)) {
            throw new PluginLoadError(
                `Invalid magic bytes: expected ${PLUGIN_MAGIC_BYTES.toString('hex')}, got ${magic.toString('hex')}`,
                'INVALID_MAGIC',
                filePath,
            );
        }

        // Version
        const version = buffer.readUInt32LE(offset);
        offset += 4;

        if (version !== PLUGIN_FORMAT_VERSION) {
            throw new PluginLoadError(
                `Unsupported format version: ${version} (supported: ${PLUGIN_FORMAT_VERSION})`,
                'UNSUPPORTED_VERSION',
                filePath,
            );
        }

        // MLDSA level
        const mldsaLevel = buffer.readUInt8(offset) as MLDSALevel;
        offset += 1;

        if (!(mldsaLevel in MLDSALevel)) {
            throw new PluginLoadError(
                `Invalid MLDSA level: ${mldsaLevel}`,
                'INVALID_MLDSA_LEVEL',
                filePath,
            );
        }

        // Public key
        const publicKeySize = MLDSA_PUBLIC_KEY_SIZES[mldsaLevel];
        const publicKey = buffer.subarray(offset, offset + publicKeySize);
        offset += publicKeySize;

        if (publicKey.length !== publicKeySize) {
            throw new PluginLoadError(
                `Invalid public key size: ${publicKey.length} (expected: ${publicKeySize})`,
                'INVALID_PUBLIC_KEY_SIZE',
                filePath,
            );
        }

        // Signature
        const signatureSize = MLDSA_SIGNATURE_SIZES[mldsaLevel];
        const signature = buffer.subarray(offset, offset + signatureSize);

        if (signature.length !== signatureSize) {
            throw new PluginLoadError(
                `Invalid signature size: ${signature.length} (expected: ${signatureSize})`,
                'INVALID_SIGNATURE_SIZE',
                filePath,
            );
        }

        return {
            magic,
            version,
            mldsaLevel,
            publicKey,
            signature,
        };
    }

    /**
     * Compute SHA-256 checksum of metadata + bytecode + proto
     */
    private computeChecksum(rawMetadata: string, bytecode: Buffer, proto?: Buffer): Buffer {
        const hash = crypto.createHash('sha256');
        hash.update(rawMetadata);
        hash.update(bytecode);
        if (proto) {
            hash.update(proto);
        }
        return hash.digest();
    }

    /**
     * Create plugin data directory
     */
    public createPluginDataDir(pluginName: string): string {
        const dataDir = path.join(this.pluginsDir, pluginName);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        return dataDir;
    }

    /**
     * Get plugin data directory path
     */
    public getPluginDataDir(pluginName: string): string {
        return path.join(this.pluginsDir, pluginName);
    }
}
