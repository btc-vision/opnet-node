import { Chalk } from 'chalk';
import readline from 'readline';
import supportsColor from 'supports-color';
import { ILogger } from './interfaces/ILogger.js';

let colorLevel: number = 0;
if (supportsColor.stdout) {
    colorLevel = 1;
}
// @ts-ignore
if (supportsColor.stdout.has256) {
    colorLevel = 2;
}
// @ts-ignore
if (supportsColor.stdout.has16m) {
    colorLevel = 3;
}

// @ts-ignore
const chalk: any = new Chalk({ level: colorLevel });

let lightenColor = function (color: string, percent: number) {
    color = color.replace('#', '');
    let num = parseInt(color, 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = ((num >> 8) & 0x00ff) + amt,
        G = (num & 0x0000ff) + amt;
    return (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (B < 255 ? (B < 1 ? 0 : B) : 255) * 0x100 +
        (G < 255 ? (G < 1 ? 0 : G) : 255)
    )
        .toString(16)
        .slice(1);
};

export class Logger implements ILogger {
    public readonly moduleName: string = '';
    public readonly logColor: string = '#00bfff';
    protected enableLogs: boolean = true;
    protected hideLogs: boolean = false;
    private readonly pink: string = '#ff00ff';
    private readonly lightPink: string = lightenColor(this.pink, 75);
    private readonly purple: string = '#9400d3';
    private readonly lightPurple: string = lightenColor(this.purple, 15);
    private readonly lighterPurple: string = lightenColor(this.lightPurple, 15);
    private readonly green: string = '#7cfc00';
    private readonly lightGreen: string = lightenColor(this.green, 15);
    private readonly moca: string = '#ffdead';
    private readonly lightMoca: string = lightenColor(this.moca, 15);
    private readonly orange: string = '#ff8c00';
    private readonly lightOrange: string = lightenColor(this.orange, 15);
    private readonly red: string = '#ff4500';
    private readonly lightRed: string = lightenColor(this.red, 15);
    private readonly white: string = '#ffffff';
    private readonly lightWhite: string = lightenColor(this.white, 15);
    private readonly darkred: string = '#8b0000';
    private readonly lightdarkred: string = lightenColor(this.darkred, 15);

    constructor() {
        this.moduleName = this.constructor.name;
    }

    public getStartPrefix(): string {
        return '';
    }

    public losses(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.red)(`${this.getStartPrefix()}[${this.moduleName} LOSS]: `) +
                chalk.hex(this.lightRed)(...args),
        );
    }

    public gain(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.green)(`${this.getStartPrefix()}[${this.moduleName} GAIN]: `) +
                chalk.hex(this.lightGreen)(...args),
        );
    }

    public notProfitable(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.pink)(`${this.getStartPrefix()}[${this.moduleName} NOT PROFITABLE]: `) +
                chalk.hex(this.lightPink)(...args),
        );
    }

    public fancyLog(
        msg1: string,
        highlight1: string,
        msg2: string,
        highlight2: string,
        msg3: string,
    ): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.pink)(`${this.getStartPrefix()}[${this.moduleName} INFO]: `) +
                chalk.hex(this.white)(msg1) +
                ' ' +
                chalk.hex(this.lightOrange)(highlight1) +
                ' ' +
                chalk.hex(this.white)(msg2) +
                ' ' +
                chalk.hex(this.lighterPurple)(highlight2) +
                ' ' +
                chalk.hex(this.white)(msg3),
        );
    }

    public log(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            let light = lightenColor(this.logColor, 15);
            console.log(
                chalk.hex(this.logColor)(`${this.getStartPrefix()}[${this.moduleName} LOG]: `) +
                    chalk.hex(light)(...args),
            );
        }
    }

    public lightOrangeLog(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            console.log(
                chalk.hex(this.lightOrange)(`${this.getStartPrefix()}[${this.moduleName} LOG]: `) +
                    chalk.hex(this.white)(...args),
            );
        }
    }

    public error(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.red)(`${this.getStartPrefix()}[${this.moduleName} ERROR]: `) +
                chalk.hex(this.lightRed)(...args),
        );
    }

    public warn(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.orange)(`${this.getStartPrefix()}[${this.moduleName} WARN]: `) +
                chalk.hex(this.lightOrange)(...args),
        );
    }

    public debug(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            console.log(
                chalk.hex(this.moca)(`${this.getStartPrefix()}[${this.moduleName} DEBUG]: `) +
                    chalk.hex(this.lightMoca)(...args),
            );
        }
    }

    public success(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            console.log(
                chalk.hex(this.green)(`${this.getStartPrefix()}[${this.moduleName} SUCCESS]: `) +
                    chalk.hex(this.lightGreen)(...args),
            );
        }
    }

    public fail(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            console.log(
                chalk.hex(this.red)(`${this.getStartPrefix()}[${this.moduleName} FAIL]: `) +
                    chalk.hex(this.lightRed)(...args),
            );
        }
    }

    public debugBright(...args: any[]): void {
        if (!this.enableLogs) return;

        if (!this.hideLogs) {
            console.log(
                chalk.hex(this.purple)(`${this.getStartPrefix()}[${this.moduleName} DEBUG]: `) +
                    chalk.hex(this.lightPurple)(...args),
            );
        }
    }

    public important(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.pink)(`${this.getStartPrefix()}[${this.moduleName} IMPORTANT]: `) +
                chalk.hex(this.lightPink)(...args),
        );
    }

    public panic(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.darkred)(`${this.getStartPrefix()}[${this.moduleName} HELP PANIC]: `) +
                chalk.hex(this.lightdarkred)(...args),
        );
    }

    public info(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex(this.pink)(`${this.getStartPrefix()}[${this.moduleName} INFO]: `) +
                chalk.hex(this.white)(...args),
        );
    }

    public securityNotice(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex('#22d8e6')(`${this.getStartPrefix()}[${this.moduleName} SECURITY NOTICE]: `) +
                chalk.hex('#22e3e6')(...args),
        );
    }

    public traceLog(...args: any[]): void {
        if (!this.enableLogs) return;

        console.log(
            chalk.hex('#ffffff')(`${this.getStartPrefix()}[${this.moduleName} TRACE LOG]: `) +
                chalk.hex(this.lightWhite)(...args),
        );
    }

    protected clearConsole(): void {
        const blank = '\n'.repeat(process.stdout.rows);
        console.log(blank);
        readline.cursorTo(process.stdout, 0, 0);
        readline.clearScreenDown(process.stdout);
    }
}
