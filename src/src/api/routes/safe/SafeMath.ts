export type SafeBigInt = -1 | bigint;

export class SafeMath {
    public static getParameterAsBigInt(
        params: [string | bigint | -1] | { height: string | bigint | -1 },
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
}
