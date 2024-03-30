import fs from 'fs';
import path from 'path';

class ProtobufSchemaBase {
    readonly #schemaPath: string = path.join(__dirname, '../../protocols/Bitcoin.proto');
    readonly #schema: string = fs.readFileSync(this.#schemaPath)?.toString();

    constructor() {}

    public get schema(): string {
        return this.#schema;
    }
}

export const Schema: ProtobufSchemaBase = new ProtobufSchemaBase();
