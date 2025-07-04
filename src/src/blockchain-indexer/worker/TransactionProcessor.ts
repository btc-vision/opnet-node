import { MessagePort, parentPort } from 'node:worker_threads';

import { InteractionTransaction } from '../processor/transaction/transactions/InteractionTransaction.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { MsgError, MsgFromMain, MsgResult, MsgToMain } from './interfaces.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';

const port: MessagePort = (() => {
    if (parentPort == null) {
        throw new Error('TxParseWorker must run in a worker thread.');
    }
    return parentPort;
})();

OPNetConsensus.setBlockHeight(0n);

const network = NetworkConverter.getNetwork();
port.on('message', (msg: MsgFromMain): void => {
    try {
        const data = msg.data;
        const itx = new InteractionTransaction(
            msg.data,
            msg.vIndexIn,
            msg.blockHash,
            msg.blockHeight,
            network,
            undefined,
        );

        const buf = msg.allowedPreimages.map((preimage) => Buffer.from(preimage, 'hex'));
        itx.verifyPreImage = (preimage: Buffer) => {
            const isValid = buf.some((allowedPreimage) => allowedPreimage.equals(preimage));

            if (!isValid) {
                throw new Error('Invalid preimage');
            }
        };

        itx.parseTransaction(data.vin, data.vout);

        const out: MsgResult = {
            id: msg.id,
            result: itx.toThreadSafe(),
        };
        port.postMessage(out satisfies MsgToMain);
    } catch (err) {
        console.log(err);

        const out: MsgError = {
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
        };
        port.postMessage(out);
    }
});
