declare module 'bytenode' {
    export function compileCode(code: string): Buffer;
    export function compileFile(options: {
        filename: string;
        output?: string;
        compileAsModule?: boolean;
        electron?: boolean;
        electronPath?: string;
    }): Promise<string>;
    export function compileElectronCode(code: string, options?: { electronPath?: string }): Promise<Buffer>;
    export function runBytecode(bytecode: Buffer): unknown;
    export function registerExtension(): void;
}
