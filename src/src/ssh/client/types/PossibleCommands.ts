import { Command } from '../commands/Command.js';

export enum Commands {
    HELP = 'help',
    PEER_INFO = 'peerinfo',
}

export const CommandsAliases: {
    [key in Commands]: string[];
} = {
    [Commands.HELP]: [],
    [Commands.PEER_INFO]: [],
};

export type PossibleCommands = {
    [key in Commands]: Command<key>;
};
