import { CustomOperationCommand } from './CustomOperationCommand.js';
import { P2PVersion } from '../../../poa/configurations/P2PVersion.js';
import * as os from 'node:os';
import { clearInterval } from 'node:timers';

const startedAt: number = Date.now();

export class OPNetSysInfo extends CustomOperationCommand {
    public readonly version: string = P2PVersion;
    public readonly name: string = 'OPNetSysInfo';
    public readonly command: string =
        "while true; do sleep 1;head -v -n 8 /proc/meminfo; head -v -n 2 /proc/stat /proc/version /proc/uptime /proc/loadavg /proc/sys/fs/file-nr /proc/sys/kernel/hostname; tail -v -n 16 /proc/net/dev;echo '==> /proc/df <==';df -l;echo '==> /proc/who <==';who;echo '==> /proc/end <==';echo '##Moba##'; done";

    private interval: string | number | NodeJS.Timeout | null = null;

    public constructor() {
        super();
    }

    protected onExecute(): void {
        this.interval = setInterval(() => {
            try {
                this.runCommand();
            } catch {
                this.channel.close();
                clearInterval(this.interval as NodeJS.Timeout);
            }
        }, 1000);

        this.channel.on('close', () => {
            if (this.interval) {
                clearInterval(this.interval);
            }
        });
    }

    private runCommand(): void {
        this.channel.write(this.generateSysInfo());
    }

    private fakeProcVersion(): string {
        return `==> /proc/version <==\n` + `OPNet ${P2PVersion}`;
    }

    private generateCustomUptimeString(): string {
        const uptimeSeconds = (Date.now() - startedAt) / 1000;
        const idleTimeSeconds = 0;

        // Convert seconds to a fixed-point number with two decimal places
        const uptimeFormatted = uptimeSeconds.toFixed(2);
        const idleTimeFormatted = idleTimeSeconds.toFixed(2);

        // Construct the custom uptime string
        return `==> /proc/uptime <==\n${uptimeFormatted} ${idleTimeFormatted}`;
    }

    private getCpuLoadInfo() {
        const loadAvg = os.loadavg();
        const processCount = 2; // Placeholder for running/total processes, to be dynamically set if available
        const totalProcesses = 199; // Placeholder, to be dynamically set if available
        const pid = process.pid;

        return `==> /proc/loadavg <==
${loadAvg[0].toFixed(2)} ${loadAvg[1].toFixed(2)} ${loadAvg[2].toFixed(2)} ${processCount}/${totalProcesses} ${pid}`;
    }

    private getCpuStatInfo() {
        const cpus = os.cpus();

        // Summarize the total CPU statistics
        const totalCpu = cpus.reduce(
            (acc, cpu) => {
                acc.user += cpu.times.user;
                acc.nice += cpu.times.nice;
                acc.sys += cpu.times.sys;
                acc.idle += cpu.times.idle;
                acc.irq += cpu.times.irq;
                return acc;
            },
            { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        );

        const formatCpuLine = (label: string, times: typeof totalCpu) => {
            return `${label}  ${times.user} ${times.nice} ${times.sys} ${times.idle} ${times.irq} 0 0 0 0 0`;
        };

        // Construct the /proc/stat-like output
        let output = '==> /proc/stat <==\n';
        output += formatCpuLine('cpu', totalCpu) + '\n';

        cpus.forEach((cpu, index) => {
            const cpuLabel = `cpu${index}`;
            output += formatCpuLine(cpuLabel, cpu.times) + '\n';
        });

        return output.trim();
    }

    private getRamUsage(): string {
        const totalMem = os.totalmem() / 1024;
        const freeMem = os.freemem() / 1024;
        const processMemoryUsage = process.memoryUsage();
        const usedMem = processMemoryUsage.rss / 1024; // Resident Set Size (RSS) for the current Node.js process

        const buffers = 0; // Not directly available via os module
        const cached = 0; // Not directly available via os module
        const swapCached = 0; // Not directly available via os module
        const active = 0; // Not directly available via os module
        const inactive = 0; // Not directly available via os module

        return `==> /proc/meminfo <==
MemTotal:        ${totalMem.toFixed(0)} kB
MemFree:         ${freeMem.toFixed(0)} kB
MemAvailable:    ${(freeMem + usedMem).toFixed(0)} kB
Buffers:         ${buffers.toFixed(0)} kB
Cached:          ${cached.toFixed(0)} kB
SwapCached:      ${swapCached.toFixed(0)} kB
Active:          ${active.toFixed(0)} kB
Inactive:        ${inactive.toFixed(0)} kB
NodeJsProcessMemory: ${usedMem.toFixed(0)} kB`;
    }

    private generateSysInfo(): string {
        return `${this.getRamUsage()}
${this.getCpuStatInfo()}

${this.fakeProcVersion()}

${this.generateCustomUptimeString()}

${this.getCpuLoadInfo()}

==> /proc/sys/kernel/hostname <==
OP_NET
==> /proc/net/dev <==
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 0  0    0    0    0     0          0         0 0  0    0    0    0     0       0          0
  eth0: 0 0    0    0    0     0          0       0 0 0    0    0    0     0       0          0
 wlan0:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
==> /proc/who <==
opnet     tty1         2024-05-14 22:35
==> /proc/end <==
##Moba##`;
    }
}
