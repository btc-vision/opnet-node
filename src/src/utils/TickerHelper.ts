export class TickerHelper {
    private static readonly TICKER_REGEX: RegExp = /^[A-Z0-9]{3,32}$/;

    public static isValidTicker(ticker: string): boolean {
        if (!ticker || typeof ticker !== 'string') {
            return false;
        }
        return TickerHelper.TICKER_REGEX.test(ticker.toUpperCase());
    }

    public static getTickerChecksum(ticker: string): string {
        if (this.isValidTicker(ticker)) {
            return '0x' + Buffer.from(ticker.toUpperCase()).toString('hex').toUpperCase();
        } else {
            return '';
        }
    }
}
