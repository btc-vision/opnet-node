import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { EcKeyPair } from '@btc-vision/transaction';
import { Network } from '@btc-vision/bitcoin';
import { createHash, Hash, randomBytes } from 'crypto';
import { OPNetTransactionTypes } from '../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../../src/src/blockchain-indexer/processor/transaction/transaction-factory/TransactionFactory.js';
import { Transaction } from '../../src/src/blockchain-indexer/processor/transaction/Transaction.js';
import { vitest } from 'vitest';

export function createFakeAddress(network: Network): string {
    const wallet: {
        address: string;
        privateKey: string;
        publicKey: string;
    } = EcKeyPair.generateWallet(network);

    return wallet.address;
}

export function generateRandomSHA256Hash(): string {
    // Generate a random buffer of 256 bits (32 bytes)
    const randomBuffer: Buffer = randomBytes(32);

    // Create a SHA-256 hash of the random buffer
    const hash: Hash = createHash('sha256');
    hash.update(randomBuffer);
    return hash.digest('hex'); // returns the hash in hexadecimal format
}

export async function CreateFakeTransaction(
    network: Network,
    fees: bigint,
    blockHash: string | null = null,
    vInTxId: string | null = null,
    address: string | null = null,
    computedHash: Buffer | null = null,
): Promise<Transaction<OPNetTransactionTypes>> {
    const transactionFactory: TransactionFactory = new TransactionFactory();
    const finalBlockHash: string = blockHash === null ? generateRandomSHA256Hash() : blockHash;
    const finalvInTxId: string = vInTxId === null ? generateRandomSHA256Hash() : vInTxId;
    const finalAddress: string = address === null ? createFakeAddress(network) : address;

    const transactionData: TransactionData = {
        in_active_chain: true,
        hex: '',
        txid: generateRandomSHA256Hash(),
        hash: generateRandomSHA256Hash(),
        size: 0,
        vsize: 0,
        weight: 0,
        version: 0,
        locktime: 0,
        vin: [
            {
                txid: finalvInTxId,
                vout: 0,
                scriptSig: {
                    asm: '',
                    hex: '',
                },
                sequence: 4294967295,
            },
        ],
        vout: [
            {
                value: 0.000123,
                n: 0,
                scriptPubKey: {
                    hex: generateRandomSHA256Hash(),
                    address: finalAddress, //'bcrt1py2dhdrrf4s72gau3mkdw0mpnkgzp63qfdc0j7nah3luhmfcwf8kq4r44ef',
                },
            },
        ],
        blockhash: finalBlockHash,
        confirmations: 0,
        blocktime: 0,
        time: 0,
    };

    const transaction: Transaction<OPNetTransactionTypes> = transactionFactory.parseTransaction(
        transactionData,
        finalBlockHash,
        0n,
        network,
        [],
        false,
    );

    vitest.spyOn(transaction, 'burnedFee', 'get').mockReturnValue(fees);
    // @ts-ignore
    vitest.spyOn(transaction, 'from', 'get').mockReturnValue('');

    if (computedHash !== null) {
        vitest.spyOn(transaction, 'computedIndexingHash', 'get').mockReturnValue(computedHash);
    }

    return transaction;
}
