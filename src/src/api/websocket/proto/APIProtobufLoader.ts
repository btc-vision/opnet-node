import { Logger } from '@btc-vision/bsi-common';
import Long from 'long';
import path from 'path';
import protobuf, { Root, Type } from 'protobufjs';
import { fileURLToPath } from 'url';

// Configure protobuf for Long support
protobuf.util.Long = Long;
protobuf.util.Buffer = Buffer;
protobuf.configure();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath: string = path.join(__dirname, '../../../', `../protocols/OPNetAPIProtocol.proto`);

/**
 * Loads and manages the WebSocket API protobuf schema.
 * This is separate from the P2P protobuf loader as the API serves different purposes.
 */
export class APIProtobufLoader extends Logger {
    public readonly logColor: string = '#7b68ee';

    protected readonly packetBuilder: Root;

    public constructor() {
        super();

        try {
            this.packetBuilder = protobuf.loadSync(schemaPath).root;
        } catch (error) {
            this.error(`Failed to load API protobuf schema from ${schemaPath}: ${error}`);
            throw error;
        }
    }

    /**
     * Get a protobuf type by name
     */
    protected getProtobufType(typeName: string): Type {
        const fullPath = `OPNetAPIProtocol.${typeName}`;
        try {
            return this.packetBuilder.lookupType(fullPath);
        } catch (error) {
            this.error(`Failed to lookup protobuf type: ${fullPath}`);
            throw error;
        }
    }
}
