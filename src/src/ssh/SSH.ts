import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { BtcIndexerConfig } from '../config/BtcIndexerConfig.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';

import ssh2, { ServerConfig } from 'ssh2';
import { SSHClient } from './client/SSHClient.js';
import figlet, { Fonts } from 'figlet';

import { Chalk } from 'chalk';
import { BlockchainInfoRepository } from '../db/repositories/BlockchainInfoRepository.js';
import { Config } from '../config/Config.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { OPNetIdentity } from '../poa/identity/OPNetIdentity.js';
import { AuthorityManager } from '../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../poa/configurations/P2PVersion.js';
import { TrustedAuthority } from '../poa/configurations/manager/TrustedAuthority.js';
import fs from 'fs';

const chalk = new Chalk({ level: 3 });

export class SSH extends Logger {
    public readonly logColor: string = '#68f8de';
    private readonly clients: SSHClient[] = [];

    private readonly sshMsgPrefix: string = `Please authenticate to\n`;
    private banner: string = this.generateBanner();

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    private readonly identity: OPNetIdentity;
    private hostKey: string | undefined;

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getAuthority(P2PVersion);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.identity = new OPNetIdentity(this.config, this.currentAuthority);
        this.generateHostKey();
    }

    private _ssh2: ssh2.Server | undefined;

    protected get ssh2(): ssh2.Server {
        if (!this._ssh2) {
            throw new Error('SSH2 not initialized');
        }

        return this._ssh2;
    }

    private get blockchainInformationRepository(): BlockchainInfoRepository {
        if (!this.#blockchainInformationRepository) {
            throw new Error('BlockchainInformationRepository not created.');
        }

        return this.#blockchainInformationRepository;
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async init(): Promise<void> {
        this.log(`Starting SSH...`);

        await this.connect();
        await this.createSSHServer();
        this.listenEvents();
    }

    public handleBitcoinIndexerMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        switch (m.type) {
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }
    }

    private async connect(): Promise<void> {
        this.db.setup();
        await Promise.all([this.db.connect(), this.bitcoinRPC.init(Config.BLOCKCHAIN)]);

        if (!this.db.db) throw new Error('Database connection not established.');

        this.#blockchainInformationRepository = new BlockchainInfoRepository(this.db.db);

        await Promise.all([this.watchBlockchain()]);
    }

    private async watchBlockchain(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges((blockHeight: bigint) => {
            try {
                OPNetConsensus.setBlockHeight(blockHeight);
            } catch (e) {}
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BITCOIN.NETWORK,
        );
    }

    private saveHostKey(): void {
        if (!this.hostKey) {
            throw new Error('Host key not generated');
        }

        fs.writeFileSync('./bin/host.bin', this.hostKey, { encoding: 'utf-8' });
    }

    private generateHostKey(): void {
        if (fs.existsSync('./bin/host.bin')) {
            try {
                this.hostKey = fs.readFileSync('./bin/host.bin', { encoding: 'utf-8' });
            } catch {
                this.panic(`Failed to read host key. Aborting...`);
            }
        } else {
            this.hostKey = ssh2.utils.generateKeyPairSync('ed25519').private;

            this.saveHostKey();
        }
    }

    private notifyArt(
        enableColors: boolean,
        type: 'info' | 'warn' | 'success' | 'panic',
        text: string,
        font: Fonts,
        prefix: string,
        ...suffix: string[]
    ): string {
        let artVal: string = figlet.textSync(text, {
            font: font, //'Doh',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        if (enableColors) {
            switch (type) {
                case 'info':
                    prefix = chalk.hex('#68f8de')(prefix);
                    break;
                case 'warn':
                    prefix = chalk.hex('#ff8c00')(prefix);
                    break;
                case 'success':
                    prefix = chalk.hex('#00ff00')(prefix);
                    break;
                case 'panic':
                    prefix = chalk.hex('#ff0000')(prefix);
                    break;
            }

            artVal = chalk.hex('#ff8c00')(artVal);

            suffix = suffix.map((s) => chalk.hex('#68f8de')(s));
        }

        return `${prefix}${artVal}${suffix.join('\n')}`;
    }

    private generateBanner(): string {
        return this.notifyArt(
            false,
            'info',
            `OPNet`,
            'Big Money-sw',
            this.sshMsgPrefix,
            'v1.0.0\n',
        );
    }

    private ssh2Configs(): ServerConfig {
        if (!this.hostKey) {
            this.panic(`Host key not found for SSH server. Aborting...`);

            throw new Error('Host key not found');
        }

        return {
            hostKeys: [this.hostKey],
            keepaliveInterval: 5000,
            banner: this.banner,
            ident: 'OPNet 1.0.0',
            algorithms: {
                kex: [
                    'curve25519-sha256',
                    'curve25519-sha256@libssh.org',
                    'ecdh-sha2-nistp256',
                    'ecdh-sha2-nistp384',
                    'ecdh-sha2-nistp521',
                    //'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group14-sha256',
                    'diffie-hellman-group15-sha512',
                    'diffie-hellman-group16-sha512',
                    'diffie-hellman-group17-sha512',
                    'diffie-hellman-group18-sha512',
                ],
                cipher: [
                    'chacha20-poly1305@openssh.com',
                    'aes128-gcm',
                    'aes128-gcm@openssh.com',
                    'aes256-gcm',
                    'aes256-gcm@openssh.com',
                    'aes128-ctr',
                    'aes192-ctr',
                    'aes256-ctr',
                ],
                serverHostKey: [
                    'ssh-ed25519',
                    'ecdsa-sha2-nistp256',
                    'ecdsa-sha2-nistp384',
                    'ecdsa-sha2-nistp521',
                    'rsa-sha2-512',
                    'rsa-sha2-256',
                    'ssh-rsa',
                    'ssh-rsa',
                ],
                hmac: [
                    'hmac-sha2-256-etm@openssh.com',
                    'hmac-sha2-512-etm@openssh.com',
                    'hmac-sha1-etm@openssh.com',
                    'hmac-sha2-256',
                    'hmac-sha2-512',
                    'hmac-sha1',
                ],
                compress: ['zlib', 'zlib@openssh.com', 'none'],
            },
            debug: (message) => {
                //this.debug(message);
            },
        };
    }

    private addClient(client: ssh2.Connection, info: ssh2.ClientInfo): void {
        const sshClient = new SSHClient(client, info, this.config.SSH, this.identity);
        sshClient.onDisconnect = () => {
            this.removeClient(client);
        };

        this.clients.push(sshClient);
    }

    private removeClient(client: ssh2.Connection): void {
        const index = this.clients.findIndex((c) => c.is(client));
        if (index !== -1) {
            this.clients.splice(index, 1);
        }
    }

    private listenEvents(): void {
        this.ssh2.on('connection', (client: ssh2.Connection, info: ssh2.ClientInfo) => {
            const ip = info.ip;
            if (this.config.SSH.ALLOWED_IPS.length && !this.config.SSH.ALLOWED_IPS.includes(ip)) {
                this.log(`Client ${ip} not allowed`);
                client.end();

                return;
            }

            this.addClient(client, info);
        });

        this.ssh2.on('error', () => {});
    }

    private async createSSHServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this._ssh2 = new ssh2.Server(this.ssh2Configs());

            this.ssh2.listen(this.config.SSH.PORT, this.config.SSH.HOST, () => {
                this.log(`SSH server listening on port: ${this.config.SSH.PORT}`);
                resolve();
            });
        });
    }
}
