export class BufferHelper {
    public static bufferToUint8Array(buffer: Buffer): Uint8Array {
        const arrayBuffer = new ArrayBuffer(buffer.length);

        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < buffer.length; ++i) {
            view[i] = buffer[i];
        }

        return view;
    }
}