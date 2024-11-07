import { Commands } from '../types/PossibleCommands.js';
import { ChalkInstance } from 'chalk';
import { Channel } from 'ssh2';
import { SendMessageToThreadFunction } from '../../../threading/thread/Thread.js';

export abstract class Command<T extends Commands> {
    public abstract readonly command: T;

    public constructor(
        protected readonly chalk: ChalkInstance,
        protected sendMessageToThread: SendMessageToThreadFunction,
    ) {}

    public abstract execute(cli: Channel, args: string[]): Promise<void> | void;
}
