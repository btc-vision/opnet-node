import bytenode from 'bytenode';

export class ProxiedVM {
    public runBytecode(bytecode: Buffer): void {
        this.runBytecode = () => {};

        bytenode.runBytecode(bytecode);
    }
}
