import { Logger } from '@btc-vision/bsi-common';
import ssh2, {
    AcceptConnection,
    AuthenticationType,
    ClientErrorExtensions,
    ExecInfo,
    RejectConnection,
    ServerChannel,
} from 'ssh2';
import { AuthMethods } from './enums/AuthMethods.js';
import { SSHConfig } from '../../config/interfaces/IBtcIndexerConfig.js';
import { Buffer } from 'buffer';
import * as readline from 'node:readline';
import figlet, { FontName } from 'figlet';
import { OPNetSysInfo } from './custom/OPNetSysInfo.js';
import { CustomOperationCommand } from './custom/CustomOperationCommand.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';
import { OPNetIdentity } from '../../poa/identity/OPNetIdentity.js';
import { Commands, CommandsAliases, PossibleCommands } from './types/PossibleCommands.js';
import { HelpCommand } from './commands/HelpCommand.js';
import { Command } from './commands/Command.js';
import { Config } from '../../config/Config.js';
import { PeerInfoCommand } from './commands/PeerInfoCommand.js';
import { SendMessageToThreadFunction } from '../../threading/thread/Thread.js';
import { timingSafeEqual } from 'node:crypto';

export class SSHClient extends Logger {
    public readonly logColor: string = '#c33ce8';

    private readonly allowedKeys: ssh2.ParsedKey[];
    private readonly allowedAuthMethods: AuthMethods[] = [
        AuthMethods.PASSWORD,
        AuthMethods.PUBLIC_KEY,
    ];

    private readonly allowedUsername: string = 'opnet';
    private isAuthorized: boolean = false;

    //private ptyInfo: ssh2.PseudoTtyOptions | undefined;
    //private windowSize: ssh2.WindowChangeInfo | undefined;

    private readonly commands: PossibleCommands;

    private customCommands: CustomOperationCommand[] = [new OPNetSysInfo()];

    constructor(
        private readonly client: ssh2.Connection,
        private readonly clientInfo: ssh2.ClientInfo,
        private readonly sshConfig: SSHConfig,
        private readonly identity: OPNetIdentity,
        private readonly sendMessageToThread: SendMessageToThreadFunction,
    ) {
        super();

        this.allowedKeys = this.loadPublicKeys();

        this.commands = {
            [Commands.HELP]: new HelpCommand(this.chalk, this.sendMessageToThread),
            [Commands.PEER_INFO]: new PeerInfoCommand(this.chalk, this.sendMessageToThread),
        };

        this.init();
    }

    private _cli: readline.Interface | undefined;

    private get cli(): readline.Interface {
        if (!this._cli) {
            throw new Error('CLI not initialized');
        }

        return this._cli;
    }

    private _shell: ServerChannel | undefined;

    private get shell(): ServerChannel {
        if (!this._shell) {
            throw new Error('Shell not initialized');
        }

        return this._shell;
    }

    private _session: ssh2.Session | undefined;

    private get session(): ssh2.Session {
        if (!this._session) {
            throw new Error('Session not initialized');
        }

        return this._session;
    }

    private get password(): Buffer {
        if (!this.sshConfig.PASSWORD) {
            throw new Error('Password not set');
        }

        return Buffer.from(this.sshConfig.PASSWORD, 'utf8');
    }

    public is(client: ssh2.Connection): boolean {
        return this.client === client;
    }

    public onDisconnect(): void {
        throw new Error('Method not implemented.');
    }

    private loadPublicKeys(): ssh2.ParsedKey[] {
        const pubKeys: string[] = [this.sshConfig.PUBLIC_KEY];

        const publicKeys: ssh2.ParsedKey[] = [];
        for (const key of pubKeys) {
            if (!key) continue;

            const parsedKey = ssh2.utils.parseKey(key);
            if (parsedKey instanceof Error) {
                this.error(`Error parsing public key: ${parsedKey.message}`);
                continue;
            }

            publicKeys.push(parsedKey);
        }

        return publicKeys;
    }

    private getUnusedAuthMethods(method: AuthMethods): AuthenticationType[] {
        return this.allowedAuthMethods.filter((m) => m !== method) as AuthenticationType[];
    }

    private onAuthUnsupported(ctx: ssh2.AuthContext): void {
        this.warn(`Unsupported authentication method: ${ctx.method}`);

        this.rejectAuth(ctx);
    }

    private rejectAuth(ctx: ssh2.AuthContext): void {
        ctx.reject(this.getUnusedAuthMethods(ctx.method as AuthMethods), false);
    }

    private onPasswordAuth(ctx: ssh2.PasswordAuthContext): void {
        if (Config.DEV_MODE) {
            this.log('Client attempting password authentication');
        }

        if (!this.sshConfig.PASSWORD) {
            this.rejectAuth(ctx);
            return;
        }

        const password: Buffer = Buffer.from(ctx.password, 'utf8');

        if (this.verifySafeBuffer(password, this.password)) {
            this.authorize(ctx);
        } else {
            ctx.requestChange('Password incorrect', (newPassword: string) => {
                if (this.verifySafeBuffer(Buffer.from(newPassword, 'utf8'), this.password)) {
                    this.authorize(ctx);
                } else {
                    ctx.reject();
                }
            });
        }
    }

    private authorize(ctx: ssh2.AuthContext): void {
        this.isAuthorized = true;
        ctx.accept();
    }

    private allowedUser(username: string): boolean {
        return username === this.allowedUsername;
    }

    // AUDIT FIX: Timing Attack
    private verifySafeBuffer(buffer: Buffer, buffer2: Buffer): boolean {
        // too big. reject
        if (buffer.length > 1024 || buffer2.length > 1024) {
            return false;
        }

        const maxLen = Math.max(buffer.length, buffer2.length);

        const paddedBuffer1 = Buffer.alloc(maxLen, 0);
        const paddedBuffer2 = Buffer.alloc(maxLen, 0);

        buffer.copy(paddedBuffer1);
        buffer2.copy(paddedBuffer2);

        // Perform a constant-time comparison on equally sized buffers
        const isMatch = timingSafeEqual(paddedBuffer1, paddedBuffer2);

        // Only if lengths are also the same do we consider them truly equal
        return isMatch && buffer.length === buffer2.length;
    }

    private onPublicKeyAuth(ctx: ssh2.PublicKeyAuthContext): void {
        this.log('Client attempting public key authentication');

        if (!this.allowedKeys.length || !ctx.blob || !ctx.signature) {
            this.rejectAuth(ctx);
            return;
        }

        const key: ssh2.PublicKey = ctx.key;
        const algo = key.algo;

        // Filter all keys with matching type, then find one that matches the provided key
        const matchingKeys = this.allowedKeys.filter((k) => k.type === algo);
        if (matchingKeys.length === 0) {
            this.rejectAuth(ctx);
            return;
        }

        const allowedKey = matchingKeys.find((k) => this.verifySafeBuffer(key.data, k.getPublicSSH()));
        if (!allowedKey) {
            return this.rejectAuth(ctx);
        }

        // signature verification
        const hasValidSignature: boolean =
            ctx.signature && allowedKey.verify(ctx.blob, ctx.signature, algo);

        if (!hasValidSignature) {
            this.rejectAuth(ctx);
            return;
        }

        this.authorize(ctx);
    }

    private onAuth(ctx: ssh2.AuthContext): void {
        const authMethod = ctx.method;
        const username = ctx.username;

        if (!this.allowedUser(username)) {
            this.rejectAuth(ctx);
            return;
        }

        switch (authMethod) {
            case 'none': {
                if (this.sshConfig.NO_AUTH) {
                    this.authorize(ctx);
                } else {
                    this.rejectAuth(ctx);
                }
                break;
            }
            case 'password': {
                this.onPasswordAuth(ctx);
                break;
            }
            case 'hostbased': {
                this.rejectAuth(ctx);
                break;
            }
            case 'publickey': {
                this.onPublicKeyAuth(ctx);
                break;
            }
            case 'keyboard-interactive': {
                this.rejectAuth(ctx);
                break;
            }
            default: {
                return this.onAuthUnsupported(ctx);
            }
        }
    }

    private onReady(): void {
        this.success(`Client connected from ${this.clientInfo.ip}`);
    }

    private onSession(accept: () => ssh2.Session, reject: () => void): void {
        if (!this.isAuthorized) {
            reject();
            return;
        }

        if (this._session && !this._session.closed) {
            if ('close' in this._session) {
                this._session.close();
            }
        }

        this._session = accept();

        this.listenToSession();
    }

    private disconnect(): void {
        this.cli.close();
        this.client.end();
    }

    private listenToSession(): void {
        this.session.on('close', () => {
            this._session = undefined;
        });

        this.session.on('pty', (accept, _reject, _info) => {
            //this.ptyInfo = info;
            this.setWindowSize();

            accept();
        });

        this.session.on('subsystem', (_accept, reject, _info) => {
            reject();
        });

        this.session.on('x11', (accept, _reject, _info) => {
            accept();
        });

        this.session.on('window-change', (accept, reject, _info) => {
            if (this._shell) {
                //this.windowSize = info;
                this.setWindowSize();

                if (typeof accept === 'function') {
                    accept();
                }
            } else if (typeof reject === 'function') {
                reject();
            }
        });

        this.session.on('shell', (accept, _reject) => {
            if (this._shell && !this._shell.destroyed) {
                this._shell.end();
            }

            this._shell = accept();
            this.onShellCreated();
        });

        this.session.on('error', (err: Error & ClientErrorExtensions) => {
            this.error(`Session error ${err}`);
        });

        this.session.on('end', () => {
            this._session = undefined;
        });

        this.session.on('exit', () => {
            this._session = undefined;
        });

        this.session.on('exec', this.onSessionExec.bind(this));
    }

    private createCommandLineInterface(
        stdin: ssh2.ServerChannel,
        stdout: ssh2.ServerChannel,
    ): void {
        if (this._cli) {
            this._cli.close();
        }

        /*stdin.on('data', (data: Buffer) => {
            if (data.toString().includes('\x03')) {
                this.disconnect();

                return;
            }

            const firstChar = data[0];
            if (firstChar === 0x08) {
                stdout.write('\b \b');
                return;
            } else if (firstChar === 0x0d) {
                data = Buffer.from('\r\n', 'utf8');
            }

            stdout.write(data);
        });*/

        this.setWindowSize();

        this._cli = readline.createInterface({ input: stdin, output: stdout, terminal: true });
        this.cli.on('SIGINT', () => {
            this.disconnect();
        });

        this.cli.on('line', this.onCommand.bind(this));

        this.cli.on('SIGTSTP', this.onSIGTSTP.bind(this));
    }

    private setWindowSize(): void {
        if (!this._shell) return;
    }

    private notifyArt(
        enableColors: boolean,
        type: 'info' | 'warn' | 'success' | 'panic',
        text: string,
        font: FontName,
        prefix: string,
        ...suffix: string[]
    ): string {
        let artVal: string = figlet
            .textSync(text, {
                font: font, //'Doh',
                horizontalLayout: 'default',
                verticalLayout: 'default',
            })
            .split('\n')
            .join('\r\n');

        if (enableColors) {
            switch (type) {
                case 'info':
                    prefix = this.chalk.hex('#68c6f8')(prefix);
                    break;
                case 'warn':
                    prefix = this.chalk.hex('#ff8c00')(prefix);
                    break;
                case 'success':
                    prefix = this.chalk.hex('#00ff00')(prefix);
                    break;
                case 'panic':
                    prefix = this.chalk.hex('#ff0000')(prefix);
                    break;
            }

            artVal = this.chalk.hex('#ff8c00')(artVal);
        }

        return `${prefix}${artVal}${suffix.join('\n\r')}`;
    }

    private defaultPrompt(): void {
        this.cli.setPrompt(this.chalk.whiteBright('opnet>') + ' ');
        this.cli.prompt(true);
    }

    private warnCommandNotFound(): void {
        this.shell.stdout.write(
            this.chalk.hex('#ff8c00')(
                'Command not found. Type "help" for a list of available commands\r\n',
            ),
        );

        this.cli.prompt(true);
    }

    private async onCommand(line: string): Promise<void> {
        try {
            const args: string[] = line.trim().split(' ');
            const command: Commands | undefined = args.shift() as Commands | undefined;
            if (!command) {
                this.warnCommandNotFound();
                return;
            }

            await this.executeCommand(command, args);
        } catch (e) {
            this.error(`Error executing command: ${(e as Error).stack}`);

            this.shell.stdout.write(
                this.chalk.hex('#ff1e00')(
                    `Something went wrong while executing the command. Consult server log for details.\r\n`,
                ),
            );
        }
    }

    private findCommand<T extends Commands>(command: T): Command<T> | undefined {
        if (this.commands[command]) {
            return this.commands[command];
        }

        const keys = Object.keys(CommandsAliases);
        for (const cmd of keys) {
            const commandObj = CommandsAliases[cmd as Commands];

            if (commandObj.includes(command)) {
                return this.commands[cmd as Commands] as Command<T>;
            }
        }

        return;
    }

    private async executeCommand(command: Commands, args: string[]): Promise<void> {
        command = command.toLowerCase() as Commands;

        const cmd = this.findCommand(command);
        if (!cmd) {
            this.warnCommandNotFound();
            return;
        }

        await cmd.execute(this.shell.stdout, args);

        this.cli.prompt(true);
    }

    private async onSIGTSTP(): Promise<void> {}

    private onShellCreated(): void {
        this.createCommandLineInterface(this.shell.stdin, this.shell.stdout);

        this.sendOPNETBanner();
        this.defaultPrompt();
    }

    private sendOPNETBanner(): void {
        const currentConsensusLine = this.chalk.hex('#c868f8')(
            `Current consensus: ${this.chalk.underline.bold.hex('#ddadfc')(OPNetConsensus.consensus.CONSENSUS_NAME)}`,
        );

        const currentBlockHeight = this.chalk.hex('#c868f8')(
            `Block height: ${this.chalk.underline.bold.hex('#ddadfc')(OPNetConsensus.getBlockHeight())}`,
        );

        const opnetAddress = [
            this.chalk.hex('#68d6f8')('This node Bitcoin addresses are:'),
            `  - ${this.chalk.hex('#afe9fc').underline.bold(this.identity.pubKey)} (Public Key)`,
            `  - ${this.chalk.hex('#afe9fc').underline.bold(this.identity.tapAddress)} (Taproot)`,
            `  - ${this.chalk.hex('#afe9fc').underline.bold(this.identity.segwitAddress)} (Segwit)\r\n`,
        ].join('\r\n');

        const opnetIdentifier = this.chalk.hex('#68d6f8')(
            `Your OPNet identity is ${this.chalk.underline.bold.hex('#afe9fc')(this.identity.opnetAddress)}.`,
        );

        const opnetTrustedCertificate = this.chalk.hex('#68d6f8')(
            `Your OPNet trusted certificate is\r\n\r\n${this.chalk.underline.bold.hex('#afe9fc')(this.identity.trustedPublicKey)}.`,
        );

        const nodeInfoHeader = this.chalk.underline.bold.hex('#00beff')('Node Information:');
        const networkInfoHeader = this.chalk.underline.bold.hex('#f868cf')('Network Information:');

        const banner = this.notifyArt(
            true,
            'info',
            'OPNet',
            'Doh',
            'You are now connected to\r\n',
            `\r\n${this.chalk.hex('#68c6f8')('You have full control over your OPNet node. Logged in as')} ${this.chalk.underline.bold.hex('#91f868')('administrator')}\r\n\r\n`,
            nodeInfoHeader,
            '',
            opnetAddress,
            opnetIdentifier,
            '',
            opnetTrustedCertificate,
            '',
            networkInfoHeader,
            currentConsensusLine,
            currentBlockHeight,
            '',
            this.chalk.whiteBright('Type "help" for a list of available commands\r\n\r\n'),
        );

        this.shell.stdout.write(banner);
    }

    private onSessionExec(
        accept: AcceptConnection<ServerChannel>,
        reject: RejectConnection,
        info: ExecInfo,
    ): void {
        const command = info.command;
        for (const cmd of this.customCommands) {
            if (cmd.command === command) {
                const accepted = accept();

                cmd.execute(accepted);
                return;
            }
        }

        reject();
    }

    private onGreeting(): void {}

    private listenEvents(): void {
        this.client.on('greeting', this.onGreeting.bind(this));
        this.client.on('session', this.onSession.bind(this));
        this.client.on('ready', this.onReady.bind(this));
        this.client.on('authentication', this.onAuth.bind(this));

        this.client.on('close', () => {
            this.onDisconnect();
        });

        this.client.on('error', (err) => {
            this.error(`Client error: ${err.stack}`);

            this.onDisconnect();
        });
    }

    private init(): void {
        this.listenEvents();
    }
}
