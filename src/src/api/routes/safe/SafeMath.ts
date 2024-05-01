import {
    BlockByHashParamsAsArray,
    BlockByHashParamsAsObject,
} from '../../json-rpc/types/interfaces/params/BlockByHashParams.js';
import {
    BlockByIdParamsAsArray,
    BlockByIdParamsAsObject,
} from '../../json-rpc/types/interfaces/params/BlockByIdParams.js';

export type SafeBigInt = -1 | bigint;
export type SafeString = string | null;

export class SafeMath {
    public static getParameterAsBigInt(
        params: BlockByIdParamsAsObject | BlockByIdParamsAsArray,
    ): SafeBigInt {
        const isArray = Array.isArray(params);

        let height;
        if (isArray) {
            height = params.shift();
        } else {
            height = params.height;
        }

        if (typeof height === 'undefined' || height === null) {
            height = -1;
        }

        if (height == -1) {
            return -1;
        }

        return BigInt(height);
    }

    public static getParameterAsString(
        params: BlockByHashParamsAsObject | BlockByHashParamsAsArray,
    ): SafeString {
        const isArray = Array.isArray(params);

        let blockHash;
        if (isArray) {
            blockHash = params.shift();

            if (typeof blockHash !== 'string') {
                blockHash = null;
            }
        } else {
            blockHash = params.blockHash;
        }

        return blockHash;
    }
}
