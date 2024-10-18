import { createReadStream, createWriteStream } from 'fs';
import { WriteStream } from 'node:fs';

export class LargeJSONProcessor<T> {
    private readonly chunkSize: number;

    public constructor() {
        this.chunkSize = 1024 * 1024 * 10; // 10 MB chunks
    }

    /**
     * Stringify large JSON object and write it to a file in chunks.
     * @param jsonObject - The JSON object to stringify.
     * @param outputPath - The path to the output file.
     */
    public async stringifyToFile(jsonObject: T, outputPath: string): Promise<void> {
        const writeStream = createWriteStream(outputPath);

        const recurseWrite = async (obj: unknown) => {
            if (Array.isArray(obj)) {
                await this.writeChunk(writeStream, '[');
                for (let i = 0; i < obj.length; i++) {
                    await recurseWrite(obj[i]);
                    if (i < obj.length - 1) {
                        await this.writeChunk(writeStream, ',');
                    }
                }
                await this.writeChunk(writeStream, ']');
            } else if (typeof obj === 'object' && obj !== null) {
                await this.writeChunk(writeStream, '{');
                const keys = Object.keys(obj);
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    await this.writeChunk(writeStream, `"${key}":`);

                    // @ts-expect-error - TS doesn't know that obj[key] is of type T
                    await recurseWrite(obj[key]);

                    if (i < keys.length - 1) {
                        await this.writeChunk(writeStream, ',');
                    }
                }
                await this.writeChunk(writeStream, '}');
            } else {
                await this.writeChunk(writeStream, JSON.stringify(obj));
            }
        };

        try {
            await recurseWrite(jsonObject);
        } catch (error) {
            console.error('Error writing JSON:', error);
        } finally {
            writeStream.end();
        }
    }

    /**
     * Parse large JSON from a file in chunks and reconstruct the JSON object.
     * @param inputPath - The path to the input JSON file.
     * @returns Reconstructed JSON object.
     */
    public async parseFromFile(inputPath: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const readStream = createReadStream(inputPath, { highWaterMark: this.chunkSize });
            let jsonString = '';

            readStream.on('data', (chunk) => {
                jsonString += chunk.toString();
            });

            readStream.on('end', () => {
                try {
                    const jsonObject = JSON.parse(jsonString) as T;
                    resolve(jsonObject);
                } catch (err) {
                    reject(err as Error);
                }
            });

            readStream.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Helper function to write data in chunks
     * @param stream - The stream to write to
     * @param data - The chunk of data to write
     */
    private async writeChunk(stream: WriteStream, data: string): Promise<void> {
        return new Promise((resolve, reject) => {
            stream.write(data, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
