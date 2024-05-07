import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { UTXOsOutputTransactions } from './UTXOsOutputTransactions.js';

export type UTXOsOutputResult = JSONRpc2ResultData<JSONRpcMethods.GET_UTXOS> &
    UTXOsOutputTransactions;
