import { IPluginMetadata, IPluginAuthor } from '../../../src/src/plugins/interfaces/IPluginMetadata.js';
import { IPluginPermissions } from '../../../src/src/plugins/interfaces/IPluginPermissions.js';

export function createMockAuthor(overrides: Partial<IPluginAuthor> = {}): IPluginAuthor {
    return {
        name: 'Test Author',
        email: 'test@example.com',
        ...overrides,
    };
}

export function createMockPermissions(overrides: Partial<IPluginPermissions> = {}): IPluginPermissions {
    // Don't include blockchain by default to avoid triggering "no queries enabled" warning
    const base: IPluginPermissions = {
        database: {
            enabled: false,
            collections: [],
        },
        blocks: {
            preProcess: false,
            postProcess: false,
            onChange: false,
        },
        epochs: {
            onChange: false,
            onFinalized: false,
        },
        mempool: {
            txFeed: false,
            txSubmit: false,
        },
        api: {
            addEndpoints: false,
            addWebsocket: false,
        },
        threading: {
            maxWorkers: 1,
            maxMemoryMB: 256,
        },
        filesystem: {
            configDir: false,
            tempDir: false,
        },
    };
    return {
        ...base,
        ...overrides,
    };
}

export function createMockMetadata(overrides: Partial<IPluginMetadata> = {}): IPluginMetadata {
    return {
        name: 'test-plugin',
        version: '1.0.0',
        opnetVersion: '>=1.0.0',
        main: 'index.jsc',
        target: 'bytenode',
        type: 'plugin',
        checksum: 'sha256:' + 'a'.repeat(64),
        author: createMockAuthor(),
        pluginType: 'standalone',
        permissions: createMockPermissions(),
        ...overrides,
    };
}

export function createInvalidMetadata(): Partial<IPluginMetadata> {
    return {
        name: '', // Invalid: empty name
        version: 'invalid', // Invalid: not semver
        opnetVersion: '', // Invalid: empty
        main: '', // Invalid: empty
        target: 'bytenode',
        type: 'plugin',
        checksum: 'invalid', // Invalid: no sha256 prefix
        author: { name: '' }, // Invalid: empty author name
        pluginType: 'standalone',
    };
}

export function createMetadataWithLongName(): IPluginMetadata {
    return createMockMetadata({
        name: 'a'.repeat(100), // Exceeds MAX_PLUGIN_NAME_LENGTH
    });
}

export function createMetadataWithInvalidName(): IPluginMetadata {
    return createMockMetadata({
        name: 'Invalid-Plugin-Name', // Contains uppercase
    });
}

export function createMetadataWithDependencies(deps: Record<string, string>): IPluginMetadata {
    return createMockMetadata({
        dependencies: deps,
    });
}
