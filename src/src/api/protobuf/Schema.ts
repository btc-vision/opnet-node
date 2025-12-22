import fs from 'fs';
import path from 'path';

class ProtobufSchemaBase {
    readonly #schemaPath: string = path.join(__dirname, '../../protocols/OPNetProtocolV1.proto');
    readonly #apiSchemaPath: string = path.join(
        __dirname,
        '../../protocols/OPNetAPIProtocol.proto',
    );

    readonly #schema: string = fs.readFileSync(this.#schemaPath)?.toString();
    readonly #apiSchema: string = fs.readFileSync(this.#apiSchemaPath)?.toString();

    public get schema(): string {
        return this.#schema;
    }

    public get apiSchema(): string {
        return this.#apiSchema;
    }
}

export const Schema: ProtobufSchemaBase = new ProtobufSchemaBase();
