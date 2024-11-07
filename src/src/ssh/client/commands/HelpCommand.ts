import { Command } from './Command.js';
import { Commands, CommandsAliases } from '../types/PossibleCommands.js';
import { Channel } from 'ssh2';

interface HelpDescription {
    readonly description: string;
    readonly aliases: string[];
    readonly examples: string[];
}

export class HelpCommand extends Command<Commands.HELP> {
    public readonly command: Commands.HELP = Commands.HELP;

    private readonly availableCommands: { [key in Commands]: HelpDescription } = {
        [Commands.HELP]: {
            description: 'Display help message',
            aliases: CommandsAliases[Commands.HELP],
            examples: [],
        },
    };

    public execute(cli: Channel, args: string[]): void {
        if (args.length === 0) {
            this.writeHelpMessageWithAllAvailableCommands(cli);
            return;
        }

        const command = args[0] as Commands;

        if (this.availableCommands[command]) {
            this.writeHelpMessageForCommand(cli, command);
            return;
        }

        cli.write(this.chalk.red(`Command ${command} not found!`));
    }

    private writeHelpMessageForCommand(cli: Channel, command: Commands): void {
        const metadata = this.availableCommands[command];
        const aliases = metadata.aliases.join(', ');

        const message = [
            this.chalk.whiteBright(`Command: ${command} (${aliases})`),
            `Description: ${metadata.description}`,
        ];

        if (metadata.examples.length > 0) {
            message.push(`Examples:`);
            metadata.examples.forEach((example) => {
                message.push(`- ${example}`);
            });
        }

        cli.write(message.join('\n\r'));
    }

    private writeHelpMessageWithAllAvailableCommands(cli: Channel): void {
        const message: string[] = [
            '\n\r',
            this.chalk.whiteBright(`List Available commands:`),
            `----------------------------------------`,
        ];

        for (const command in this.availableCommands) {
            const metadata = this.availableCommands[command as Commands];
            const description = metadata.description;
            const aliases = metadata.aliases.join(', ');
            const aliasesString = aliases.length > 0 ? ` (${aliases})` : '';

            message.push(this.chalk.white(`${command}${aliasesString}: ${description}`));

            if (metadata.examples.length > 0) {
                message.push(`Examples:`);
                metadata.examples.forEach((example) => {
                    message.push(`- ${example}`);
                });
            }
        }

        cli.write(message.join('\n\r') + '\n\r\n\r');
    }
}
