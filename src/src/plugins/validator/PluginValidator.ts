import { Logger } from '@btc-vision/bsi-common';
import { MessageSigner, MLDSASecurityLevel, QuantumBIP32Factory } from '@btc-vision/transaction';
import { Network } from '@btc-vision/bitcoin';
import * as semver from 'semver';

import { IParsedPluginFile, MLDSALevel } from '../interfaces/IPluginFile.js';
import {
    IPluginMetadata,
    MAX_DESCRIPTION_LENGTH,
    MAX_PLUGIN_NAME_LENGTH,
    PLUGIN_NAME_REGEX,
} from '../interfaces/IPluginMetadata.js';
import { IPluginPermissions } from '../interfaces/IPluginPermissions.js';

/**
 * Validation error
 */
export class PluginValidationError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly field?: string,
    ) {
        super(message);
        this.name = 'PluginValidationError';
    }
}

/**
 * Validation result
 */
export interface IValidationResult {
    readonly valid: boolean;
    readonly errors: PluginValidationError[];
    readonly warnings: string[];
}

/**
 * Plugin Validator
 */
export class PluginValidator extends Logger {
    public readonly logColor: string = '#FF9800';

    private readonly network: Network;
    private readonly nodeVersion: string;

    constructor(network: Network, nodeVersion: string) {
        super();
        this.network = network;
        this.nodeVersion = nodeVersion;
    }

    /**
     * Validate a parsed plugin file
     */
    public validate(plugin: IParsedPluginFile): IValidationResult {
        const errors: PluginValidationError[] = [];
        const warnings: string[] = [];

        // Validate metadata
        const metadataResult = this.validateMetadata(plugin.metadata);
        errors.push(...metadataResult.errors);
        warnings.push(...metadataResult.warnings);

        // Validate permissions
        const permissionsResult = this.validatePermissions(plugin.metadata.permissions);
        errors.push(...permissionsResult.errors);
        warnings.push(...permissionsResult.warnings);

        // Validate signature
        try {
            const signatureValid = this.validateSignature(plugin);
            if (!signatureValid) {
                errors.push(
                    new PluginValidationError('Invalid MLDSA signature', 'INVALID_SIGNATURE'),
                );
            }
        } catch (error) {
            errors.push(
                new PluginValidationError(
                    `Signature validation failed: ${error}`,
                    'SIGNATURE_VALIDATION_FAILED',
                ),
            );
        }

        // Validate version compatibility
        const versionResult = this.validateVersionCompatibility(plugin.metadata);
        errors.push(...versionResult.errors);
        warnings.push(...versionResult.warnings);

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Validate plugin metadata
     */
    public validateMetadata(metadata: IPluginMetadata): IValidationResult {
        const errors: PluginValidationError[] = [];
        const warnings: string[] = [];

        // Required fields
        if (!metadata.name) {
            errors.push(
                new PluginValidationError('Plugin name is required', 'MISSING_NAME', 'name'),
            );
        } else {
            if (!PLUGIN_NAME_REGEX.test(metadata.name)) {
                errors.push(
                    new PluginValidationError(
                        'Plugin name must start with lowercase letter and contain only lowercase letters, numbers, and hyphens',
                        'INVALID_NAME_FORMAT',
                        'name',
                    ),
                );
            }
            if (metadata.name.length > MAX_PLUGIN_NAME_LENGTH) {
                errors.push(
                    new PluginValidationError(
                        `Plugin name too long: ${metadata.name.length} (max: ${MAX_PLUGIN_NAME_LENGTH})`,
                        'NAME_TOO_LONG',
                        'name',
                    ),
                );
            }
        }

        if (!metadata.version) {
            errors.push(
                new PluginValidationError(
                    'Plugin version is required',
                    'MISSING_VERSION',
                    'version',
                ),
            );
        } else if (!semver.valid(metadata.version)) {
            errors.push(
                new PluginValidationError(
                    'Plugin version must be valid semver',
                    'INVALID_VERSION',
                    'version',
                ),
            );
        }

        if (!metadata.opnetVersion) {
            errors.push(
                new PluginValidationError(
                    'OPNet version requirement is required',
                    'MISSING_OPNET_VERSION',
                    'opnetVersion',
                ),
            );
        } else if (!semver.validRange(metadata.opnetVersion)) {
            errors.push(
                new PluginValidationError(
                    'OPNet version must be valid semver range',
                    'INVALID_OPNET_VERSION',
                    'opnetVersion',
                ),
            );
        }

        if (!metadata.main) {
            errors.push(
                new PluginValidationError('Main entry point is required', 'MISSING_MAIN', 'main'),
            );
        }

        if (metadata.target !== 'bytenode') {
            errors.push(
                new PluginValidationError(
                    `Invalid target: ${metadata.target} (must be "bytenode")`,
                    'INVALID_TARGET',
                    'target',
                ),
            );
        }

        if (metadata.type !== 'plugin') {
            errors.push(
                new PluginValidationError(
                    `Invalid type: ${metadata.type} (must be "plugin")`,
                    'INVALID_TYPE',
                    'type',
                ),
            );
        }

        if (!metadata.checksum) {
            errors.push(
                new PluginValidationError('Checksum is required', 'MISSING_CHECKSUM', 'checksum'),
            );
        } else if (!metadata.checksum.startsWith('sha256:')) {
            errors.push(
                new PluginValidationError(
                    'Checksum must start with "sha256:"',
                    'INVALID_CHECKSUM_FORMAT',
                    'checksum',
                ),
            );
        } else {
            // Validate hex portion is valid and has correct length (64 chars for SHA256)
            const hashPart = metadata.checksum.slice(7);
            if (!/^[a-f0-9]{64}$/i.test(hashPart)) {
                errors.push(
                    new PluginValidationError(
                        'Checksum must be valid SHA256 hex (64 lowercase/uppercase hex characters)',
                        'INVALID_CHECKSUM_HEX',
                        'checksum',
                    ),
                );
            }
        }

        // Author
        if (!metadata.author || !metadata.author.name) {
            errors.push(
                new PluginValidationError('Author name is required', 'MISSING_AUTHOR', 'author'),
            );
        }

        // Plugin type
        if (!metadata.pluginType) {
            errors.push(
                new PluginValidationError(
                    'Plugin type is required',
                    'MISSING_PLUGIN_TYPE',
                    'pluginType',
                ),
            );
        } else if (!['standalone', 'library'].includes(metadata.pluginType)) {
            errors.push(
                new PluginValidationError(
                    `Invalid plugin type: ${metadata.pluginType}`,
                    'INVALID_PLUGIN_TYPE',
                    'pluginType',
                ),
            );
        }

        // Optional field validation
        if (metadata.description && metadata.description.length > MAX_DESCRIPTION_LENGTH) {
            warnings.push(
                `Description exceeds recommended length (${metadata.description.length}/${MAX_DESCRIPTION_LENGTH})`,
            );
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate plugin permissions
     */
    public validatePermissions(permissions?: IPluginPermissions): IValidationResult {
        const errors: PluginValidationError[] = [];
        const warnings: string[] = [];

        if (!permissions) {
            return { valid: true, errors, warnings };
        }

        // Database permissions
        if (permissions.database?.enabled) {
            if (
                !permissions.database.collections ||
                permissions.database.collections.length === 0
            ) {
                errors.push(
                    new PluginValidationError(
                        'Database enabled but no collections specified',
                        'NO_COLLECTIONS',
                        'permissions.database.collections',
                    ),
                );
            }

            // Validate index definitions - just check collections are declared
            if (permissions.database.indexes) {
                for (const collection of Object.keys(permissions.database.indexes)) {
                    if (!permissions.database.collections.includes(collection)) {
                        errors.push(
                            new PluginValidationError(
                                `Index defined for undeclared collection: ${collection}`,
                                'INDEX_UNDECLARED_COLLECTION',
                                `permissions.database.indexes.${collection}`,
                            ),
                        );
                    }
                }
            }
        }

        // API permissions
        if (permissions.api?.addEndpoints) {
            if (!permissions.api.basePath) {
                warnings.push('API endpoints enabled but no basePath specified');
            }
        }

        if (permissions.api?.addWebsocket) {
            if (!permissions.api.websocket?.protoFile) {
                errors.push(
                    new PluginValidationError(
                        'WebSocket enabled but no proto file specified',
                        'NO_PROTO_FILE',
                        'permissions.api.websocket.protoFile',
                    ),
                );
            }
        }

        // Threading permissions
        if (permissions.threading) {
            if (permissions.threading.maxWorkers > 16) {
                warnings.push(`High worker count requested: ${permissions.threading.maxWorkers}`);
            }
            if (permissions.threading.maxMemoryMB > 2048) {
                warnings.push(
                    `High memory limit requested: ${permissions.threading.maxMemoryMB}MB`,
                );
            }
        }

        // Blockchain permissions
        if (permissions.blockchain) {
            const bc = permissions.blockchain;
            if (!bc.blocks && !bc.transactions && !bc.contracts && !bc.utxos) {
                warnings.push('Blockchain permission declared but no specific queries enabled');
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate MLDSA signature
     */
    public validateSignature(plugin: IParsedPluginFile): boolean {
        const securityLevel = this.mldsaLevelToSecurityLevel(plugin.mldsaLevel);

        try {
            const keyPair = QuantumBIP32Factory.fromPublicKey(
                plugin.publicKey,
                Buffer.alloc(32), // Chain code can be zeroed for verification
                this.network,
                securityLevel,
            );

            return MessageSigner.verifyMLDSASignature(keyPair, plugin.checksum, plugin.signature);
        } catch (error) {
            this.error(`MLDSA verification error: ${error}`);
            return false;
        }
    }

    /**
     * Validate version compatibility with node
     */
    public validateVersionCompatibility(metadata: IPluginMetadata): IValidationResult {
        const errors: PluginValidationError[] = [];
        const warnings: string[] = [];

        if (metadata.opnetVersion && !semver.satisfies(this.nodeVersion, metadata.opnetVersion)) {
            errors.push(
                new PluginValidationError(
                    `Plugin requires OPNet ${metadata.opnetVersion}, but node is ${this.nodeVersion}`,
                    'VERSION_INCOMPATIBLE',
                    'opnetVersion',
                ),
            );
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Convert MLDSALevel enum to MLDSASecurityLevel
     */
    private mldsaLevelToSecurityLevel(level: MLDSALevel): MLDSASecurityLevel {
        switch (level) {
            case MLDSALevel.MLDSA44:
                return MLDSASecurityLevel.LEVEL2;
            case MLDSALevel.MLDSA65:
                return MLDSASecurityLevel.LEVEL3;
            case MLDSALevel.MLDSA87:
                return MLDSASecurityLevel.LEVEL5;
            default:
                throw new Error(`Unknown MLDSA level: ${level}`);
        }
    }
}
