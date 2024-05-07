import { IContractAPIDocument } from '../../../../../../db/documents/interfaces/IContractDocument.js';
import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export type GetCodeResult = JSONRpc2ResultData<JSONRpcMethods.GET_CODE> &
    (
        | IContractAPIDocument
        | {
              bytecode: string;
          }
    );
