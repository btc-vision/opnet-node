import { Logger } from '@btc-vision/bsi-common';
import Long from 'long';
import path from 'path';
import protobuf, { Root } from 'protobufjs';
import { ProtocolFileNames } from './const/ProtocolFileNames.js';

protobuf.util.Long = Long;
protobuf.util.Buffer = Buffer;
protobuf.configure();

const schemaPath: string = path.join(
    __dirname,
    '../',
    `../protocols/${ProtocolFileNames.OPNetProtocolV1}`,
);

export class ProtobufLoader extends Logger {
    protected packetBuilder: Root = protobuf.loadSync(schemaPath).root;
}
