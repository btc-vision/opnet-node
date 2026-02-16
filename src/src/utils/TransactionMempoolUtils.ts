import { IMempoolTransactionObj } from '../db/interfaces/IMempoolTransaction.js';
import bitcoin, { toHex, Transaction } from '@btc-vision/bitcoin';
import { Long } from 'mongodb';
import { NetworkConverter } from '../config/network/NetworkConverter.js';

const network = NetworkConverter.getNetwork();

export function getOutputAddressForScript(script: Buffer): string | null {
    try {
        let address: string;
        if (bitcoin.script.toASM(script).startsWith('OP_1')) {
            // Taproot address (P2TR) starts with OP_1
            const taprootPubKey = script.subarray(2); // Removing the OP_1 byte
            address = bitcoin.address.toBech32(taprootPubKey, 1, network.bech32); // Taproot uses bech32m
        } else {
            // Non-Taproot (P2PKH, P2SH, P2WPKH, etc.)
            address = bitcoin.address.fromOutputScript(script, network);
        }

        return address;
    } catch {
        return null;
    }
}

export function parseAndStoreInputOutputs(data: Buffer, transaction: IMempoolTransactionObj): void {
    try {
        const decoded = Transaction.fromBuffer(data);

        for (const input of decoded.ins) {
            transaction.inputs.push({
                transactionId: toHex(Buffer.from(input.hash).reverse()),
                outputIndex: input.index,
            });
        }

        for (let i = 0; i < decoded.outs.length; i++) {
            const out = decoded.outs[i];

            const outputAddress = getOutputAddressForScript(Buffer.from(out.script));
            transaction.outputs.push({
                data: Buffer.from(out.script),
                outputIndex: i,
                value: Long.fromBigInt(out.value, true),
                address: outputAddress,
            });
        }
    } catch {}
}
