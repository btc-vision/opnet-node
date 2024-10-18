import { createReadStream, createWriteStream } from 'fs';
import { pipeline, Transform } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

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
        const jsonStream = new Transform({
            writableObjectMode: true,
            transform(chunk, _encoding, callback) {
                try {
                    const jsonString = JSON.stringify(chunk, null, 2);
                    callback(null, jsonString);
                } catch (err) {
                    callback(err as Error);
                }
            },
        });

        const writeStream = createWriteStream(outputPath);

        // Pipeline to ensure streams are handled correctly
        await pipelineAsync(
            jsonStream, // JSON transform stream
            writeStream, // Output file stream
        );

        jsonStream.end(jsonObject); // Push the JSON object to the stream
    }

    /**
     * Parse large JSON from a file in chunks and reconstruct the JSON object.
     * @param inputPath - The path to the input JSON file.
     * @returns Reconstructed JSON object.
     */
    public async parseFromFile(inputPath: string): Promise<T> {
        let jsonString = '';

        return new Promise<T>((resolve, reject) => {
            const readStream = createReadStream(inputPath, { highWaterMark: this.chunkSize });

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

    public async stringifyToStream(jsonObject: T, writeStream: Transform): Promise<void> {
        const jsonStream = new Transform({
            writableObjectMode: true,
            transform(chunk, _encoding, callback) {
                try {
                    const jsonString = JSON.stringify(chunk, null, 2);
                    callback(null, jsonString);
                } catch (err) {
                    callback(err as Error);
                }
            },
        });

        // Pipeline to ensure streams are handled correctly
        await pipelineAsync(
            jsonStream, // JSON transform stream
            writeStream, // Output file stream
        );

        jsonStream.end(jsonObject); // Push the JSON object to the stream
    }

    public parseFromStream(readStream: Transform): Promise<T> {
        throw new Error('Not implemented');
    }
}
