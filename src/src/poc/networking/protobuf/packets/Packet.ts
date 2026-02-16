import Long from 'long';
import { Type } from 'protobufjs';
import { PossiblePackets, ServerInBound, ServerOutBound } from '../types/messages/OPNetMessages.js';

export type PackedMessage = object;

export abstract class Packet<
    T extends PackedMessage,
    U extends PackedMessage,
    I extends PackedMessage,
> {
    protected readonly opcode: PossiblePackets | null = null;
    protected readonly packet: Type;

    protected constructor(
        protobufType: Type,
        opcode: ServerInBound | ServerOutBound | null = null,
    ) {
        this.packet = protobufType;
        if (opcode) this.opcode = opcode;
    }

    public pack(msgToPack: T): Uint8Array {
        const convertedMsgToPack = this.castInputAs(msgToPack as unknown as T);
        const verificationError = this.packet.verify(convertedMsgToPack);

        if (verificationError) {
            throw new Error(`Error while verifying message: ${verificationError}`);
        } else {
            const schema = this.packet.create(convertedMsgToPack);
            const message = this.packet.encode(schema).finish();

            if (this.opcode === null) throw new Error(`Opcode is null.`);

            return new Uint8Array([this.opcode, ...message]);
        }
    }

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

    protected castOutputAs(currentOutput: U): T {
        return currentOutput as unknown as T;
    }

    protected castInputAs(currentInput: T): I {
        return currentInput as unknown as I;
    }
}
