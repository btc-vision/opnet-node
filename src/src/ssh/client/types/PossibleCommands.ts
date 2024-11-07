import { Command } from '../commands/Command.js';

export enum Commands {
    HELP = 'help',
}

export const CommandsAliases: {
    [key in Commands]: string[];
} = {
    [Commands.HELP]: [],
};

export type PossibleCommands = {
    [key in Commands]: Command<key>;
};
