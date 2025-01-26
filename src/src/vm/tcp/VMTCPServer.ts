import { Logger } from '@btc-vision/bsi-common';
import { Server } from 'node:net';
import { Socket } from 'net';
import { TCPSocket } from './TCPSocket.js';
import { Opcode } from './Opcodes.js';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';
import { RustContractBinding } from '../isolated/RustContractBindings.js';

export class VMTCPServer extends Logger {
    public readonly logColor: string = '#5e00ff';

    // get first available port
    public socketPort: number = 0;

    private sockets: FastStringMap<TCPSocket> = new FastStringMap();

    constructor(
        private readonly bindings: Map<bigint, RustContractBinding>,
        private readonly enableDebug: boolean = false,
    ) {
        super();
    }

    private _tcpServer: Server | undefined;

    private get tcpServer(): Server {
        if (!this._tcpServer) {
            throw new Error('TCP Server not initialized');
        }

        return this._tcpServer;
    }

    public stop(): void {
        this.tcpServer.close();
    }

    public async start(): Promise<number> {
        this._tcpServer = new Server(this.onConnection.bind(this));
        this.socketPort = await this.listen();

        this.log(`Listening on port ${this.socketPort}`);

        return this.socketPort;
    }

    private listen(port: number = 0): Promise<number> {
        return new Promise((resolve, reject) => {
            this.tcpServer.listen(port, () => {
                const address = this.tcpServer.address();
                if (address && typeof address === 'object') {
                    resolve(address.port);
                } else {
                    reject(new Error('Invalid address'));
                }
            });
        });
    }

    private loadFunction: (contractId: bigint, buffer: Buffer) => Promise<Buffer> = (
        contractId: bigint,
        buffer: Buffer,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('LOAD', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.load(buffer) as Promise<Buffer>;
    };

    private storeJSFunction: (contractId: bigint, buffer: Buffer) => Promise<Buffer> = (
        contractId: bigint,
        buffer: Buffer,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('STORE', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.store(buffer) as Promise<Buffer>;
    };

    private callJSFunction: (contractId: bigint, buffer: Buffer) => Promise<Buffer> = (
        contractId: bigint,
        buffer: Buffer,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('CALL', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.call(buffer) as Promise<Buffer>;
    };

    private emitEventFunction: (contractId: bigint, buffer: Buffer) => void = (
        contractId: bigint,
        buffer: Buffer,
    ): void => {
        if (this.enableDebug) console.log('EMIT', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.emit(buffer);
    };

    private deployFunction: (contractId: bigint, buffer: Buffer) => void = (
        contractId: bigint,
        buffer: Buffer,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('DEPLOY', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.deployContractAtAddress(buffer) as Promise<Buffer>;
    };

    private inputsFunction: (contractId: bigint) => void = (
        contractId: bigint,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('INPUTS');

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.inputs() as Promise<Buffer>;
    };

    private outputsFunction: (contractId: bigint) => void = (
        contractId: bigint,
    ): Promise<Buffer> => {
        if (this.enableDebug) console.log('OUTPUTS');

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.outputs() as Promise<Buffer>;
    };

    private consoleLogFunction: (contractId: bigint, buffer: Buffer) => void = (
        contractId: bigint,
        buffer: Buffer,
    ): void => {
        if (this.enableDebug) console.log('CONSOLE', buffer);

        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.log(buffer);
    };

    /**
     * Parses and handles a given message opcode + payload, then optionally responds.
     * In a real implementation, you’d likely dispatch this to various handlers.
     */
    private async handleOpcode(
        opcode: Opcode,
        contractId: bigint,
        payload: Buffer,
    ): Promise<Buffer | undefined | void> {
        this.info(
            `Received opcode ${opcode} with payload: ${payload.toString('hex')} for contract ${contractId}`,
        );

        switch (opcode) {
            case Opcode.StorageLoad: {
                return await this.loadFunction(contractId, payload);
            }

            case Opcode.StorageStore: {
                return await this.storeJSFunction(contractId, payload);
            }

            case Opcode.CallOtherContract: {
                return await this.callJSFunction(contractId, payload);
            }

            case Opcode.EmitEventExternal: {
                return this.emitEventFunction(contractId, payload);
            }

            case Opcode.DeployFromAddress: {
                return this.deployFunction(contractId, payload);
            }

            case Opcode.InputsExternal: {
                return this.inputsFunction(contractId);
            }

            case Opcode.OutputsExternal: {
                return this.outputsFunction(contractId);
            }

            case Opcode.ConsoleLogExternal: {
                return this.consoleLogFunction(contractId, payload);
            }

            default:
                this.log(
                    `[Contract: ${contractId}] Received opcode ${opcode} with payload: ${payload.toString('hex')}`,
                );
                break;
        }
    }

    private onConnection(socket: Socket): void {
        //if (this.enableDebug)
        this.log(`New connection from ${socket.remoteAddress}:${socket.remotePort}`);

        const id = this.getSocketId(socket);
        const client = new TCPSocket(socket);
        client.handleOpcode = this.handleOpcode.bind(this);
        this.sockets.set(id, client);

        socket.on('disconnect', () => {
            this.onDisconnect(id);
        });
    }

    private getSocketId(socket: Socket): string {
        return `${socket.remoteAddress}:${socket.remotePort}:${socket.localPort}`;
    }

    private onDisconnect(id: string): void {
        this.sockets.delete(id);
    }
}
