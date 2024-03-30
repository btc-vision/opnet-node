import murmurhash from "murmurhash";

export class TickerHelper {
    private static readonly TICKER_REGEX: RegExp = /^[A-Z0-9.$][A-Z0-9]{2,31}$/;

    public static isValidTicker(ticker: string): boolean {
        // Regex explanation:
        // ^[A-Z0-9.$] - Starts with alphanumericals or "." or "$"
        // [A-Z0-9]{2,31}$ - Followed by 2 to 31 ASCII alphanumerical characters (letters and numbers)
        // The entire length check (3 to 32 characters) is implicit in the {2,31} following the first character requirement
        return TickerHelper.TICKER_REGEX.test(ticker.toUpperCase());
    }

    public static getTickerChecksum(ticker: string): string {
        if (this.isValidTicker(ticker)) {
            return '0x' + murmurhash.v3(ticker.toUpperCase()).toString(16).toUpperCase();
        } else {
            return '';
        }
    }
}
