import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { JSONRpcMethods } from '../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../JSONRpc2ResultData.js';

export type BlockHeadersByIdResult = JSONRpc2ResultData<JSONRpcMethods.BLOCK_HEIGHT_BY_ID> &
    BlockHeaderAPIBlockDocument;
