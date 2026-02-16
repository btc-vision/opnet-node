import Long from 'long';
import { Type } from 'protobufjs';
import {
    WebSocketOpcode,
    WebSocketRequestOpcode,
    WebSocketResponseOpcode,
} from '../types/opcodes/WebSocketOpcodes.js';

/**
 * Convert bigint values to Long recursively for protobuf compatibility.
 * This allows the rest of the codebase to use bigint while protobuf uses Long.
 */
function convertBigIntToLong(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'bigint') {
        return Long.fromString(obj.toString(), true);
    }

    if (Array.isArray(obj)) {
        return obj.map(convertBigIntToLong);
    }

    if (obj instanceof Long || obj instanceof Uint8Array) {
        return obj;
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertBigIntToLong(value);
        }
        return result;
    }

    return obj;
}

/**
 * Base type for all packed/unpacked WebSocket messages.
 * Use specific request/response types that extend this for type safety.
 */
export type PackedMessage<T extends object = object> = T;

/**
 * Base abstract class for all WebSocket API packets.
 * Follows the same pattern as the P2P Packet class for consistency.
 *
 * @template T - The typed output interface
 * @template U - The intermediate protobuf object type
 * @template I - The input type before casting
 */
export abstract class APIPacket<
    T extends PackedMessage,
    U extends PackedMessage = T,
    I extends PackedMessage = T,
> {
    /**
     * The opcode identifying this packet type
     */
    protected readonly opcode: WebSocketOpcode | null = null;

    /**
     * The protobuf type for this packet
     */
    protected readonly packet: Type;

    protected constructor(
        protobufType: Type,
        opcode: WebSocketRequestOpcode | WebSocketResponseOpcode | null = null,
    ) {
        this.packet = protobufType;
        if (opcode !== null) {
            this.opcode = opcode;
        }
    }

    /**
     * Get the opcode for this packet
     */
    public getOpcode(): WebSocketOpcode {
        if (this.opcode === null) {
            throw new Error('Opcode is null');
        }
        return this.opcode;
    }

    /**
     * Serialize a message object to a binary buffer with opcode prefix.
     * Automatically converts bigint to Long for protobuf compatibility.
     *
     * @param msgToPack - The message object to serialize
     * @returns Uint8Array with opcode as first byte followed by protobuf payload
     */
    public pack(msgToPack: T): Uint8Array {
        // Convert bigint to Long before casting/verification
        const withLongValues = convertBigIntToLong(msgToPack) as T;
        const convertedMsgToPack = this.castInputAs(withLongValues as unknown as T);
        const verificationError = this.packet.verify(convertedMsgToPack);

        if (verificationError) {
            throw new Error(`Error while verifying message: ${verificationError}`);
        }

        const schema = this.packet.create(convertedMsgToPack);
        const message = this.packet.encode(schema).finish();

        if (this.opcode === null) {
            throw new Error('Opcode is null');
        }

        return new Uint8Array([this.opcode, ...message]);
    }

    /**
     * Serialize a message without the opcode prefix.
     * Useful when you need to control the opcode separately.
     * Automatically converts bigint to Long for protobuf compatibility.
     *
     * @param msgToPack - The message object to serialize
     * @returns Uint8Array containing only the protobuf payload
     */
    public packPayload(msgToPack: T): Uint8Array {
        // Convert bigint to Long before casting/verification
        const withLongValues = convertBigIntToLong(msgToPack) as T;
        const convertedMsgToPack = this.castInputAs(withLongValues as unknown as T);
        const verificationError = this.packet.verify(convertedMsgToPack);

        if (verificationError) {
            throw new Error(`Error while verifying message: ${verificationError}`);
        }

        const schema = this.packet.create(convertedMsgToPack);
        return this.packet.encode(schema).finish();
    }

    /**
     * Deserialize a binary buffer to a message object.
     * The buffer should NOT include the opcode byte.
     *
     * @param msgToUnpack - The binary buffer to deserialize (without opcode)
     * @returns The deserialized message object
     */
    public unpack(msgToUnpack: Uint8Array): T {
        const message = this.packet.decode(msgToUnpack);
        const objOutput = this.packet.toObject(message, {
            longs: Long,
            enums: Number,
            bytes: Uint8Array,
            defaults: true,
            arrays: true,
            objects: true,
            oneofs: true,
        }) as U;

        return this.castOutputAs(objOutput);
    }

    /**
     * Cast the deserialized output to the target type.
     * Override this method to perform custom type transformations.
     */
    protected castOutputAs(currentOutput: U): T {
        return currentOutput as unknown as T;
    }

    /**
     * Cast the input to the protobuf input type.
     * Override this method to perform custom type transformations.
     */
    protected castInputAs(currentInput: T): I {
        return currentInput as unknown as I;
    }
}

/**
 * Interface for incoming WebSocket messages
 */
export interface WebSocketMessage {
    readonly opcode: WebSocketOpcode;
    readonly payload: Uint8Array;
}

/**
 * Extract opcode and payload from a raw WebSocket message
 */
export function parseWebSocketMessage(raw: Uint8Array): WebSocketMessage {
    if (raw.length < 1) {
        throw new Error('Message too short: must contain at least opcode byte');
    }

    const opcode = raw[0] as WebSocketOpcode;
    const payload = raw.slice(1);

    return { opcode, payload };
}
