import { crypto as btcCrypto, opcodes } from '@btc-vision/bitcoin';
import { TransactionOutput } from '../../processor/transaction/inputs/TransactionOutput.js';

import {
    AuthenticationProgramCommon,
    AuthenticationProgramStateBCHCHIPs,
    AuthenticationVirtualMachine,
    createVirtualMachine,
    OpcodesBCH as Op,
    ResolvedTransactionCommon,
} from '@bitauth/libauth';
import { LRUCache } from 'lru-cache';
import { Logger } from '@btc-vision/bsi-common';
import { createInstructionSetBTC } from './InstructionSet.js';

export enum AnyoneCanSpendReason {
    ConstantTrueBare = 1,
    SuccessOpcodeBare = 2,
    ZeroOfNMultisig = 3,
    TimeLockTrue = 4,
    KeylessAnchor = 5,
    UnknownWitnessProgram = 6,
    P2SH_True = 7,
    P2WSH_True = 8,
    GenericAlwaysTrue = 9,
    ProvablyUnspendable = 10,
}

export interface AnyoneCanSpendHit {
    reason: AnyoneCanSpendReason;

    lockType?: 'CLTV' | 'CSV';
    lockValue?: bigint;
    lockMatured?: boolean;

    multisigKeys?: number;
    dummyPushes?: number;

    witnessVersion?: number;
    programLength?: number;

    policyUnsafe?: boolean;

    unspendable?: boolean;
}

const DISABLED_OPS = new Set<number>([
    Number(Op.OP_RESERVED),
    Number(Op.OP_VER),
    Number(Op.OP_VERIF),
    Number(Op.OP_VERNOTIF),
    Number(Op.OP_RESERVED1),
    Number(Op.OP_CAT),
    Number(Op.OP_INVERT),
    Number(Op.OP_AND),
    Number(Op.OP_OR),
    Number(Op.OP_XOR),
    Number(Op.OP_2MUL),
    Number(Op.OP_2DIV),
    Number(Op.OP_MUL),
    Number(Op.OP_DIV),
    Number(Op.OP_MOD),
    Number(Op.OP_LSHIFT),
    Number(Op.OP_RSHIFT),
    Number(Op.OP_NIP),
    Number(Op.OP_TUCK),
]);

const isEnabledLegacyOpcode = (code: number): boolean => {
    if (code <= 0x4e) return true; // data-push range
    if (DISABLED_OPS.has(code)) return false;

    return (Op as unknown as Record<number, string>)[code] !== undefined;
};

export class AnyoneCanSpendDetector extends Logger {
    public logColor = '#00ffff';

    private readonly truthCache = new LRUCache<string, boolean>({ max: 65_536 });
    private readonly ENABLED_WITNESS_VERSIONS = new Set<number>([0, 1]);
    private readonly TRUE_SCRIPTS: Buffer[] = [
        Buffer.from([opcodes.OP_1]),
        Buffer.from([0x01, 0x01]),
        Buffer.from([0x50]),
        Buffer.from([opcodes.OP_0, opcodes.OP_0, opcodes.OP_WITHIN]),
    ];
    private readonly P2SH_H160: Set<string>;
    private readonly P2WSH_SHA256: Set<string>;

    constructor() {
        super();

        this.P2SH_H160 = new Set();
        this.P2WSH_SHA256 = new Set();
        for (const b of this.TRUE_SCRIPTS) {
            this.P2SH_H160.add(btcCrypto.hash160(b).toString('hex'));
            this.P2WSH_SHA256.add(btcCrypto.sha256(b).toString('hex'));
        }
    }

    private _vm?: AuthenticationVirtualMachine<
        ResolvedTransactionCommon,
        AuthenticationProgramCommon,
        AuthenticationProgramStateBCHCHIPs
    >;

    private get vm() {
        if (!this._vm) {
            this.log('[vm] creating BCH VM instance');
            this._vm = createVirtualMachine(createInstructionSetBTC(false));
        }
        return this._vm;
    }

    public detect(
        output: TransactionOutput,
        height: number = Number.MAX_SAFE_INTEGER,
        mtp: number = Number.MAX_SAFE_INTEGER,
    ): AnyoneCanSpendHit | undefined {
        const asm = output.script;
        const buf = output.scriptPubKeyBuffer;

        if (buf[0] === opcodes.OP_RETURN) {
            return { reason: AnyoneCanSpendReason.ProvablyUnspendable, unspendable: true };
        }

        if (buf[0] > 0x4e && !isEnabledLegacyOpcode(buf[0])) {
            return {
                reason: AnyoneCanSpendReason.ProvablyUnspendable,
                unspendable: true,
            };
        }

        this.log(
            `[detect] start – value=${output.value} sat, scriptLen=${output.scriptPubKeyBuffer.length}`,
        );

        const hit =
            this.detectOpSuccessBare(asm) ??
            this.detectConstantTrue(asm) ??
            this.detectZeroOfN(asm) ??
            this.detectTimelockTrue(asm, height, mtp) ??
            this.detectFutureWitness(asm) ??
            this.detectHashedTrue(output);

        if (hit) {
            this.log(`[detect] positive match (${AnyoneCanSpendReason[hit.reason]})`);
            return hit;
        }

        if (this.evaluatesTrue(buf)) {
            const policyUnsafe = buf.length > 10_000 || this.countBigPushes(asm) > 0;
            this.log(
                `[detect] script evaluates TRUE in VM (policyUnsafe=${policyUnsafe}) – generic reason`,
            );
            return { reason: AnyoneCanSpendReason.GenericAlwaysTrue, policyUnsafe };
        }

        this.log('[detect] no ACS pattern matched');
        return undefined;
    }

    private detectOpSuccessBare(asm: (number | Buffer)[] | null): AnyoneCanSpendHit | undefined {
        if (!asm || asm.length === 0) return;
        let i = 0;
        while (i < asm.length && asm[i] === opcodes.OP_NOP) i++;
        if (i !== asm.length - 1) return;
        const op = asm[i];
        if (typeof op === 'number' && op >= 0xb0 && op <= 0xf7) {
            this.log('[detectOpSuccessBare] matched OP_SUCCESSx bare script');
            return { reason: AnyoneCanSpendReason.SuccessOpcodeBare };
        }
    }

    private detectConstantTrue(asm: (number | Buffer)[] | null): AnyoneCanSpendHit | undefined {
        if (!asm || asm.length === 0) return;
        let i = 0;
        while (i < asm.length && asm[i] === opcodes.OP_NOP) i++;
        if (i !== asm.length - 1) return;
        const op = asm[i];
        if (typeof op === 'number' && op >= opcodes.OP_1 && op <= opcodes.OP_16) {
            this.log('[detectConstantTrue] matched OP_N constant true');
            return { reason: AnyoneCanSpendReason.ConstantTrueBare };
        }
        if (Buffer.isBuffer(op) && op.length && !op.every((b) => b === 0)) {
            this.log('[detectConstantTrue] matched non-zero push constant true');
            return { reason: AnyoneCanSpendReason.ConstantTrueBare };
        }
    }

    private detectZeroOfN(asm: (number | Buffer)[] | null): AnyoneCanSpendHit | undefined {
        if (!asm || asm.length < 4) return;
        let p = 0;
        while (p < asm.length && asm[p] === opcodes.OP_NOP) p++;
        if (asm[p] !== opcodes.OP_0) return;
        const last = asm[asm.length - 1];
        if (last !== opcodes.OP_CHECKMULTISIG && last !== opcodes.OP_CHECKMULTISIGVERIFY) return;
        const nOp = asm[asm.length - 2];
        if (typeof nOp !== 'number' || nOp < opcodes.OP_1 || nOp > opcodes.OP_16) return;
        const keys = nOp - opcodes.OP_0;
        if (keys !== asm.length - (p + 3)) return;

        const policyUnsafe = keys > 3;
        this.log(`[detectZeroOfN] matched 0-of-${keys} multisig (policyUnsafe=${policyUnsafe})`);
        return {
            reason: AnyoneCanSpendReason.ZeroOfNMultisig,
            multisigKeys: keys,
            dummyPushes: keys + 1,
            policyUnsafe,
        };
    }

    private detectTimelockTrue(
        asm: (number | Buffer)[] | null,
        height: number,
        mtp: number,
    ): AnyoneCanSpendHit | undefined {
        if (!asm || asm.length < 4) return;
        let i = 0;
        while (i < asm.length && asm[i] === opcodes.OP_NOP) i++;
        const push = asm[i],
            opLock = asm[i + 1],
            opDrop = asm[i + 2],
            last = asm[i + 3];

        if (
            !Buffer.isBuffer(push) ||
            opDrop !== opcodes.OP_DROP ||
            (last !== opcodes.OP_1 && last !== opcodes.OP_TRUE)
        )
            return;

        const lt =
            opLock === opcodes.OP_CHECKLOCKTIMEVERIFY
                ? 'CLTV'
                : opLock === opcodes.OP_CHECKSEQUENCEVERIFY
                  ? 'CSV'
                  : undefined;
        if (!lt) return;

        const val = this.readScriptNum(push);
        const matured = lt === 'CLTV' ? val <= BigInt(height) : val <= BigInt(mtp);
        this.log(`[detectTimelockTrue] matched ${lt}=${val.toString()} (matured=${matured})`);
        return {
            reason: AnyoneCanSpendReason.TimeLockTrue,
            lockType: lt,
            lockValue: val,
            lockMatured: matured,
        };
    }

    private detectFutureWitness(asm: (number | Buffer)[] | null): AnyoneCanSpendHit | undefined {
        if (!asm || asm.length !== 2) return;
        const [vOp, prog] = asm;
        if (typeof vOp !== 'number' || !Buffer.isBuffer(prog)) return;

        const ver =
            vOp === opcodes.OP_0
                ? 0
                : vOp >= opcodes.OP_1 && vOp <= opcodes.OP_16
                  ? vOp - opcodes.OP_1 + 1
                  : -1;

        const len = prog.length;
        if (ver === 1 && len === 2) {
            this.log('[detectFutureWitness] matched keyless anchor (v1, len 2)');
            return {
                reason: AnyoneCanSpendReason.KeylessAnchor,
                witnessVersion: 1,
                programLength: 2,
            };
        }

        if (
            ver >= 2 &&
            ver <= 16 &&
            len >= 2 &&
            len <= 40 &&
            !this.ENABLED_WITNESS_VERSIONS.has(ver)
        ) {
            this.log(`[detectFutureWitness] matched future witness v${ver}, progLen=${len}`);
            return {
                reason: AnyoneCanSpendReason.UnknownWitnessProgram,
                witnessVersion: ver,
                programLength: len,
            };
        }
    }

    private detectHashedTrue(out: TransactionOutput): AnyoneCanSpendHit | undefined {
        const t = out.scriptPubKey.type;
        if (t === 'scripthash') {
            const h = out.scriptPubKeyBuffer.subarray(2, 22).toString('hex');
            if (this.P2SH_H160.has(h)) {
                this.log('[detectHashedTrue] matched P2SH hash of known TRUE script');
                return { reason: AnyoneCanSpendReason.P2SH_True };
            }
        }

        if (t === 'witness_v0_scripthash') {
            const h = out.scriptPubKeyBuffer.subarray(2, 34).toString('hex');
            if (this.P2WSH_SHA256.has(h)) {
                this.log('[detectHashedTrue] matched P2WSH hash of known TRUE script');
                return { reason: AnyoneCanSpendReason.P2WSH_True };
            }
        }
    }

    private evaluatesTrue(lock: Buffer): boolean {
        const key = lock.length > 80 ? '' : lock.toString('hex');
        if (key) {
            const memo = this.truthCache.get(key);
            if (memo !== undefined) {
                this.log(`[evaluatesTrue] cache hit ${key}=${memo}`);
                return memo;
            }
        }

        let ok = false;
        try {
            const program: AuthenticationProgramCommon = {
                inputIndex: 0,
                sourceOutputs: [{ lockingBytecode: lock, valueSatoshis: 0n }],
                transaction: {
                    version: 2,
                    inputs: [
                        {
                            outpointTransactionHash: new Uint8Array(32),
                            outpointIndex: 0xffffffff,
                            sequenceNumber: 0xffffffff,
                            unlockingBytecode: new Uint8Array(),
                        },
                    ],
                    outputs: [{ valueSatoshis: 0n, lockingBytecode: new Uint8Array() }],
                    locktime: 0,
                },
            };

            const finalState = this.vm.evaluate(program);
            ok = this.vm.stateSuccess(finalState) === true;
        } catch (e) {
            this.warn(`[evaluatesTrue] VM evaluation threw (${(e as Error).message})`);
        }

        if (key) this.truthCache.set(key, ok);
        this.log(`[evaluatesTrue] VM result=${ok}`);
        return ok;
    }

    private countBigPushes(asm: (number | Buffer)[] | null): number {
        if (!asm) return 0;
        let n = 0;
        for (const x of asm) if (Buffer.isBuffer(x) && x.length > 520) n++;
        return n;
    }

    private readScriptNum(buf: Buffer): bigint {
        if (!buf.length) return 0n;
        const neg = (buf[buf.length - 1] & 0x80) !== 0;
        const clone = Buffer.from(buf);
        clone[clone.length - 1] &= 0x7f;
        let v = 0n;
        for (let i = 0; i < clone.length; i++) v |= BigInt(clone[i]) << (8n * BigInt(i));
        return neg ? -v : v;
    }
}
