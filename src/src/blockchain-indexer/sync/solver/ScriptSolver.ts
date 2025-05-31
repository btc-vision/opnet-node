import {
    type AuthenticationInstruction,
    type AuthenticationInstructionPush,
    AuthenticationProgramCommon,
    binToHex,
    createVirtualMachineBCH,
    decodeAuthenticationInstructions,
    OpcodesBCH as Op,
    type OpcodesBCH2023,
} from '@bitauth/libauth';

import type {
    BitVec,
    Bool,
    Context,
    FuncDecl,
    Model as Z3Model,
    Z3HighLevel,
    Z3LowLevel,
} from 'z3-solver';
import { init as initZ3 } from 'z3-solver';

import { Logger } from '@btc-vision/bsi-common';

type Const = { tag: 'const'; v: bigint };
type Placeholder = { tag: 'ph'; i: number };
type App = { tag: 'app'; op: string; args: Expr[] };
type Expr = Const | Placeholder | App;

const C = (v: bigint): Const => ({ tag: 'const', v });
const P = (i: number): Placeholder => ({ tag: 'ph', i });
const app = (op: string, ...args: Expr[]): App => ({ tag: 'app', op, args });
const sha256 = (e: Expr): App => app('sha256', e);
const ripemd160 = (e: Expr): App => app('ripemd160', e);

interface Branch {
    elsePc?: number;
    cond: Expr;
    negate: boolean;
}

class SymState {
    stack: Expr[] = [];
    pc = 0;
    constraints: Expr[] = [];
    branches: Branch[] = [];

    constructor(
        readonly code: Uint8Array,
        readonly ph: Placeholder[],
    ) {}
}

type BV256 = BitVec<256, 'main'>;
type Z3Module = Z3HighLevel & Z3LowLevel;

const isPush = (x: AuthenticationInstruction): x is AuthenticationInstructionPush =>
    Object.hasOwn(x, 'data');

const NOOP_SET = new Set<number>([
    Op.OP_NOP,
    Op.OP_CODESEPARATOR,
    ...Array.from({ length: 10 }, (_, i) => 0xb0 + i),
]);

const isOpSuccessX = (code: number) => code >= 0xb0 && code <= 0xf7;

const ALWAYS_FAIL_SET = new Set<number>([
    Op.OP_RESERVED,
    Op.OP_VER,
    Op.OP_VERIF,
    Op.OP_VERNOTIF,
    Op.OP_RESERVED1,
    Op.OP_RESERVED2,
]);

export class ScriptSolver extends Logger {
    public logColor = '#7b00ff';
    private readonly MAX_PH = 16;
    private readonly SMT_MS = 20_000;
    private readonly vm = createVirtualMachineBCH();
    private z3Init: Z3Module | null = null;

    public async solve(
        lockHex: string,
        bruteMax: bigint = 32n,
    ): Promise<{ solved: boolean; stack?: Uint8Array[]; reason?: string }> {
        this.log(`solve() ▶ lockHex=${lockHex}, bruteMax=${bruteMax}`);
        const lock = Uint8Array.from(Buffer.from(lockHex, 'hex'));
        const seed = new SymState(lock, [...Array(this.MAX_PH).keys()].map(P));
        this.debug('phase 1/3 – symbolic execution');
        this.symExec(seed);
        this.debug(`symbolic execution produced ${seed.constraints.length} constraint(s)`);
        this.debug('phase 2/3 – SMT solving');
        const z3 = await this.getZ3();
        const ctx = z3.Context('main');
        const ONE = ctx.BitVec.val(1n, 256);
        const ZERO = ctx.BitVec.val(0n, 256);
        const solver = new ctx.Solver();
        solver.set('timeout', this.SMT_MS);
        const phVars = seed.ph.map((ph) => ctx.BitVec.const(`ph${ph.i}`, 256));
        const boolToBV = (b: Bool<'main'>) => ctx.If(b, ONE, ZERO);
        const funCache = new Map<string, FuncDecl<'main'>>();
        const fun = (name: string) => {
            let f = funCache.get(name);
            if (!f) {
                f = ctx.Function.declare(name, ctx.BitVec.sort(256), ctx.BitVec.sort(256));
                funCache.set(name, f);
            }
            return f;
        };
        const enc = (e: Expr): BV256 => {
            if (e.tag === 'const') return ctx.BitVec.val(e.v, 256);
            if (e.tag === 'ph') return phVars[e.i];
            switch (e.op) {
                case 'eq': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.eq(b));
                }
                case 'lt': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.slt(b));
                }
                case 'gt': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.sgt(b));
                }
                case 'add': {
                    const [a, b] = e.args.map(enc);
                    return a.add(b);
                }
                case 'sub': {
                    const [a, b] = e.args.map(enc);
                    return a.sub(b);
                }
                case 'booland': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.and(b).neq(ZERO));
                }
                case 'boolor': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.or(b).neq(ZERO));
                }
                case 'within': {
                    const [a, b, c] = e.args.map(enc);
                    return boolToBV(a.sge(b).and(a.slt(c)));
                }
                case 'sha256':
                    return fun('sha256').call(enc(e.args[0])) as BV256;
                case 'ripemd160':
                    return fun('ripemd160').call(enc(e.args[0])) as BV256;
            }
            throw new Error(`unhandled op ${e.op}`);
        };

        seed.constraints.forEach((c) => solver.add(enc(c).neq(ZERO)));
        this.debug('calling solver.check() …');

        const sat = await solver.check();
        this.debug(`SMT solver responded: ${sat}`);

        if (sat === 'sat') {
            const modelStack = this.modelToStack(solver.model(), ctx);
            this.success(`SAT – model produced ${modelStack.length} push(es)`);
            return this.runConcrete(lock, modelStack)
                ? { solved: true, stack: modelStack }
                : { solved: false, reason: 'model failed concrete VM (bug)' };
        }
        if (sat === 'unknown') {
            this.warn('SMT returned unknown – entering brute-force mode');
            const brute = this.bruteHashes(lock, seed, bruteMax);
            if (brute) {
                this.success(`bruteHashes succeeded with ${brute.stack.length} push(es)`);
                return brute;
            }
        }
        this.warn(`unsat/unknown; reason=${sat}`);
        return { solved: false, reason: sat };
    }

    private async getZ3(): Promise<Z3Module> {
        if (!this.z3Init) this.z3Init = await initZ3();
        return this.z3Init;
    }

    private symExec(seed: SymState): void {
        const queue: SymState[] = [seed];
        const fork = (src: SymState, pcTarget: number, cond: Expr, negate: boolean): void => {
            const ns = new SymState(src.code, src.ph);
            ns.pc = pcTarget;
            ns.stack = [...src.stack];
            ns.constraints = [...src.constraints, negate ? app('eq', cond, C(0n)) : cond];
            ns.branches = src.branches.map((b) => ({ ...b }));
            queue.push(ns);
            this.debug(`forked  → pc=${pcTarget}, negate=${negate}`);
        };
        const isNoop = (code: number): boolean => NOOP_SET.has(code);
        const isAlwaysFail = (code: number): boolean => ALWAYS_FAIL_SET.has(code);
        const execOne = (st: SymState): void => {
            const prog = decodeAuthenticationInstructions(st.code);
            if (st.pc === 0 && st.stack.length === 0) st.ph.forEach((ph) => st.stack.push(ph));
            const branches = st.branches;
            const pop = (): Expr => {
                const v = st.stack.pop();
                if (!v) throw new Error('stack underflow');
                return v;
            };
            const pop2 = () => {
                const b = pop();
                const a = pop();
                return { a, b };
            };
            while (st.pc < prog.length) {
                const ins = prog[st.pc];
                const opNum = ins.opcode;
                const op = opNum as OpcodesBCH2023;
                st.pc += 1;
                if (opNum <= 0x4e) {
                    const data = isPush(ins) ? ins.data : new Uint8Array();
                    const num = data.length === 0 ? 0n : BigInt(`0x${binToHex(data)}`);
                    st.stack.push(C(num));
                    continue;
                }
                if (isOpSuccessX(opNum)) {
                    st.stack.push(C(1n));
                    break;
                }
                if (op === Op.OP_1NEGATE) {
                    st.stack.push(C(-1n));
                    continue;
                }
                if (op >= Op.OP_1 && op <= Op.OP_16) {
                    st.stack.push(C(BigInt(op - Op.OP_1 + 1)));
                    continue;
                }
                if (isNoop(opNum)) continue;
                if (isAlwaysFail(opNum)) {
                    st.constraints.push(C(0n));
                    break;
                }
                if (op === Op.OP_IF || op === Op.OP_NOTIF) {
                    const cond = pop();
                    branches.push({ cond, negate: op === Op.OP_NOTIF });
                    continue;
                }
                if (op === Op.OP_ELSE) {
                    const b = branches.at(-1);
                    if (!b) throw new Error('ELSE w/o IF');
                    b.elsePc = st.pc;
                    continue;
                }
                if (op === Op.OP_ENDIF) {
                    const b = branches.pop();
                    if (!b) throw new Error('ENDIF w/o IF');
                    if (b.elsePc !== undefined) fork(st, b.elsePc, b.cond, !b.negate);
                    else st.constraints.push(b.negate ? app('eq', b.cond, C(0n)) : b.cond);
                    continue;
                }
                if (op === Op.OP_RETURN) {
                    st.constraints.push(C(0n));
                    break;
                }
                if (
                    op === Op.OP_ADD ||
                    op === Op.OP_SUB ||
                    op === Op.OP_BOOLAND ||
                    op === Op.OP_BOOLOR ||
                    op === Op.OP_LESSTHAN ||
                    op === Op.OP_GREATERTHAN
                ) {
                    const { a, b } = pop2();
                    const res =
                        op === Op.OP_ADD
                            ? app('add', a, b)
                            : op === Op.OP_SUB
                              ? app('sub', a, b)
                              : op === Op.OP_BOOLAND
                                ? app('booland', a, b)
                                : op === Op.OP_BOOLOR
                                  ? app('boolor', a, b)
                                  : op === Op.OP_LESSTHAN
                                    ? app('lt', a, b)
                                    : app('gt', a, b);
                    st.stack.push(res);
                    continue;
                }
                if (op === Op.OP_WITHIN) {
                    const c = pop();
                    const b = pop();
                    const a = pop();
                    st.stack.push(app('within', a, b, c));
                    continue;
                }
                if (
                    op === Op.OP_NUMEQUAL ||
                    op === Op.OP_NUMEQUALVERIFY ||
                    op === Op.OP_EQUAL ||
                    op === Op.OP_EQUALVERIFY
                ) {
                    const { a, b } = pop2();
                    const eq = app('eq', a, b);
                    if (op === Op.OP_NUMEQUALVERIFY || op === Op.OP_EQUALVERIFY)
                        st.constraints.push(eq);
                    else st.stack.push(eq);
                    continue;
                }
                if (op === Op.OP_DUP) {
                    const v = pop();
                    st.stack.push(v, v);
                    continue;
                }
                if (op === Op.OP_DROP) {
                    pop();
                    continue;
                }
                if (op === Op.OP_SHA256) {
                    st.stack.push(sha256(pop()));
                    continue;
                }
                if (op === Op.OP_HASH160) {
                    st.stack.push(ripemd160(sha256(pop())));
                    continue;
                }
                if (op === Op.OP_VERIFY) {
                    st.constraints.push(pop());
                    continue;
                }
                if (
                    op === Op.OP_CHECKSIG ||
                    op === Op.OP_CHECKSIGVERIFY ||
                    op === Op.OP_CHECKMULTISIG ||
                    op === Op.OP_CHECKMULTISIGVERIFY
                ) {
                    if (op === Op.OP_CHECKMULTISIG || op === Op.OP_CHECKMULTISIGVERIFY) {
                        const n = pop();
                        const m = pop();
                        const le20 = (x: Expr) => app('within', x, C(0n), C(21n));
                        st.constraints.push(le20(m), le20(n), app('lt', m, app('add', n, C(1n))));
                        const popMany = (e: Expr) => {
                            if (e.tag === 'const') for (let i = 0; i < Number(e.v); i++) pop();
                            else st.stack.length = 0;
                        };
                        popMany(m);
                        popMany(n);
                        pop();
                    } else {
                        pop();
                        pop();
                    }
                    if (op === Op.OP_CHECKSIGVERIFY || op === Op.OP_CHECKMULTISIGVERIFY)
                        st.constraints.push(C(1n));
                    else st.stack.push(C(1n));
                    continue;
                }
                this.fail(
                    `unimplemented opcode 0x${opNum.toString(16)} – treating as legacy OP_FAILURE`,
                );
                st.constraints.push(C(0n));
                break;
            }
            const last = st.stack.pop();
            if (last) st.constraints.push(last);
        };
        while (queue.length) {
            const s = queue.pop();
            if (!s) throw new Error('queue underflow');
            execOne(s);
        }
    }

    private modelToStack(model: Z3Model, ctx: Context): Uint8Array[] {
        const out: Uint8Array[] = [];
        for (let i = 0; i < this.MAX_PH; i++) {
            const v = model.eval(ctx.BitVec.const(`ph${i}`, 256), true);
            if (!ctx.isBitVecVal(v)) break;
            out.push(this.encodeMinimal(v.value()));
        }
        return out;
    }

    private bruteHashes(
        lock: Uint8Array,
        st: SymState,
        max: bigint,
    ): { solved: true; stack: Uint8Array[] } | null {
        const ids = new Set<number>();
        const walk = (e: Expr): void => {
            if (e.tag === 'ph') ids.add(e.i);
            else if (e.tag === 'app') e.args.forEach(walk);
        };
        st.constraints.forEach(walk);
        const idx = [...ids];
        if (idx.length === 0) return null;
        const vals: bigint[] = Array<bigint>(idx.length).fill(0n);
        const dfs = (pos: number): Uint8Array[] | null => {
            if (pos === idx.length) {
                const stack = idx.map((i) => this.encodeMinimal(vals[idx.indexOf(i)]));
                return this.runConcrete(lock, stack) ? stack : null;
            }
            for (let g = 0n; g <= max; g++) {
                vals[pos] = g;
                const r = dfs(pos + 1);
                if (r) return r;
            }
            return null;
        };
        const found = dfs(0);
        return found ? { solved: true, stack: found } : null;
    }

    private runConcrete(lock: Uint8Array, stack: Uint8Array[]): boolean {
        const unlock = Uint8Array.from(stack.flat());
        if (unlock.length > 50_000) return false;
        const prog: AuthenticationProgramCommon = {
            inputIndex: 0,
            sourceOutputs: [{ lockingBytecode: lock, valueSatoshis: 0n }],
            transaction: {
                version: 2,
                inputs: [
                    {
                        outpointTransactionHash: new Uint8Array(32),
                        outpointIndex: 0xffffffff,
                        sequenceNumber: 0xffffffff,
                        unlockingBytecode: unlock,
                    },
                ],
                outputs: [{ valueSatoshis: 0n, lockingBytecode: new Uint8Array() }],
                locktime: 0,
            },
        };
        const ok = this.vm.stateSuccess(this.vm.evaluate(prog)) === true;
        this.debug(`concrete VM result: ${ok}`);
        return ok;
    }

    private encodeMinimal(n: bigint): Uint8Array {
        if (n === 0n) return Uint8Array.of(0x00);
        if (n === -1n) return Uint8Array.of(0x4f);
        if (n >= 1n && n <= 16n) return Uint8Array.of(Number(n) + 0x50);
        const neg = n < 0n;
        let hex = (neg ? -n : n).toString(16);
        if (hex.length & 1) hex = '0' + hex;
        let buf = Uint8Array.from(Buffer.from(hex, 'hex')).reverse();
        if (buf[buf.length - 1] & 0x80) buf = Uint8Array.of(...buf, 0x00);
        if (neg) buf[buf.length - 1] |= 0x80;
        const len = buf.length;
        if (len < 0x4c) return Uint8Array.of(len, ...buf);
        if (len <= 255) return Uint8Array.of(0x4c, len, ...buf);
        if (len <= 65_535) return Uint8Array.of(0x4d, len & 0xff, len >> 8, ...buf);
        return Uint8Array.of(
            0x4e,
            len & 0xff,
            (len >> 8) & 0xff,
            (len >> 16) & 0xff,
            (len >> 24) & 0xff,
            ...buf,
        );
    }
}
