export interface ILogger {
    moduleName: string;
    logColor: string;

    log(...args: any[]): void;

    error(...args: any[]): void;

    warn(...args: any[]): void;

    debug(...args: any[]): void;

    success(...args: any[]): void;

    debugBright(...args: any[]): void;

    important(...args: any[]): void;
}
