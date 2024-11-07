import { Commands } from '../types/PossibleCommands.js';
import { ChalkInstance } from 'chalk';
import { Channel } from 'ssh2';

export abstract class Command<T extends Commands> {
    public abstract readonly command: T;

    public constructor(protected readonly chalk: ChalkInstance) {}

    public abstract execute(cli: Channel, args: string[]): Promise<void> | void;
}
