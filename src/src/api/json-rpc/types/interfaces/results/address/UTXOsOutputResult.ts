import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { RawUTXOsOutputTransactions } from './UTXOsOutputTransactions.js';

export type UTXOsOutputResult = JSONRpc2ResultData<JSONRpcMethods.GET_UTXOS> &
    RawUTXOsOutputTransactions;
