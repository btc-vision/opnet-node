import {
    type AuthenticationInstruction,
    type AuthenticationInstructionPush,
    AuthenticationProgramCommon,
    createVirtualMachine,
    decodeAuthenticationInstructions,
    isVmNumberError,
    OpcodesBCH as Op,
    type OpcodesBCH2023,
    vmNumberToBigInt,
} from '@bitauth/libauth';

import type {
    BitVec,
    BitVecNum,
    Bool,
    Context,
    FuncDecl,
    Model as Z3Model,
    Z3HighLevel,
    Z3LowLevel,
} from 'z3-solver';
import { init as initZ3 } from 'z3-solver';

import { Logger } from '@btc-vision/bsi-common';
import { createInstructionSetBTC } from './InstructionSet.js';
import { createHash } from 'crypto';
//import bip39Words from 'bip39/src/wordlists/english.json' with { type: 'json' };

type Const = { tag: 'const'; v: bigint };
type Placeholder = { tag: 'ph'; i: number };
type App = { tag: 'app'; op: string; args: Expr[] };
type Expr = Const | Placeholder | App;

const sha256Hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

const preimageDict = new Map<string /*256-bit hex*/, string /*word*/>();
/*for (const w of bip39Words) {
    preimageDict.set(sha256Hex(w), w);
}*/

const C = (v: bigint): Const => ({ tag: 'const', v });
const P = (i: number): Placeholder => ({ tag: 'ph', i });
const app = (op: string, ...args: Expr[]): App => ({ tag: 'app', op, args });
const sha256 = (e: Expr): App => app('sha256', e);
const ripemd160 = (e: Expr): App => app('ripemd160', e);

interface SymOpts {
    tapscript: boolean;
}

interface Frame {
    pc: number;
    stack: number[];
    nextId: number;
}

class SymState {
    stack: Expr[] = [];
    alt: Expr[] = [];
    pc = 0;
    constraints: Expr[] = [];

    constructor(
        readonly code: Uint8Array,
        readonly ph: Placeholder[],
        readonly opts: SymOpts,
    ) {}
}

type BV256 = BitVec<number, 'main'>;
type Z3Module = Z3HighLevel & Z3LowLevel;

const isPush = (x: AuthenticationInstruction): x is AuthenticationInstructionPush =>
    Object.hasOwn(x, 'data');

const NOOP_SET = new Set<number>([Op.OP_NOP, Op.OP_CODESEPARATOR]);

const isOpSuccessX = (code: number) => code >= 0xb0 && code <= 0xf7;

const ALWAYS_FAIL_SET = new Set<number>([
    Op.OP_RESERVED,
    Op.OP_VER,
    Op.OP_VERIF,
    Op.OP_VERNOTIF,
    Op.OP_RESERVED1,
    Op.OP_RESERVED2,
    Op.OP_NOP1,
    Op.OP_NOP4,
    Op.OP_NOP5,
    Op.OP_NOP6,
    Op.OP_NOP7,
    Op.OP_NOP8,
    Op.OP_NOP9,
    Op.OP_NOP10,
]);

const isNoop = (c: number) => NOOP_SET.has(c);
const isAlwaysFail = (c: number) => ALWAYS_FAIL_SET.has(c);
const isOpReturnX = (code: number) => code >= 0xda && code <= 0xfe;

export const estimateMinPlaceholders = (bytecode: Uint8Array): number => {
    const prog = decodeAuthenticationInstructions(bytecode);

    const work: Frame[] = [{ pc: 0, stack: [], nextId: 0 }];
    let maxId = 0;

    const pushId = (stack: number[], next: number): number => {
        stack.push(next);
        return next + 1;
    };

    while (work.length) {
        const elem = work.pop();
        if (!elem) {
            throw new Error('work queue underflow – no more frames to process');
        }

        const { pc, stack, nextId } = elem;
        if (pc >= prog.length) continue;

        const op = prog[pc].opcode as OpcodesBCH2023;

        const s = [...stack];
        let id = nextId;
        const popN = (n: number) => {
            while (n-- && s.length) s.pop();
        };

        if ((op as number) <= 0x4e || op === Op.OP_0) {
            id = pushId(s, id);
        } else if (op === Op.OP_1NEGATE || (op >= Op.OP_1 && op <= Op.OP_16)) {
            id = pushId(s, id);
        } else {
            switch (op) {
                case Op.OP_DUP:
                    popN(1);
                    id = pushId(s, id);
                    id = pushId(s, id);
                    break;
                case Op.OP_IFDUP:
                    popN(1);
                    id = pushId(s, id);
                    id = pushId(s, id);
                    break;
                case Op.OP_DROP:
                    popN(1);
                    break;
                case Op.OP_NIP:
                    popN(2);
                    id = pushId(s, id);
                    break;
                case Op.OP_OVER:
                    popN(2);
                    id = pushId(s, id);
                    id = pushId(s, id);
                    id = pushId(s, id);
                    break;
                case Op.OP_2DUP:
                    popN(2);
                    for (let i = 0; i < 4; ++i) id = pushId(s, id);
                    break;
                case Op.OP_3DUP:
                    popN(3);
                    for (let i = 0; i < 6; ++i) id = pushId(s, id);
                    break;
                case Op.OP_2OVER:
                    popN(4);
                    for (let i = 0; i < 6; ++i) id = pushId(s, id);
                    break;

                case Op.OP_SWAP:
                case Op.OP_ROT:
                case Op.OP_TUCK:
                case Op.OP_AND:
                case Op.OP_OR:
                case Op.OP_XOR:
                case Op.OP_LSHIFT:
                case Op.OP_RSHIFT:
                case Op.OP_MUL:
                case Op.OP_DIV:
                case Op.OP_MOD:
                case Op.OP_NUM2BIN:
                case Op.OP_BIN2NUM:
                case Op.OP_CAT:
                case Op.OP_REVERSEBYTES:
                case Op.OP_SHA1:
                case Op.OP_HASH256:
                case Op.OP_1ADD:
                case Op.OP_1SUB:
                case Op.OP_NEGATE:
                case Op.OP_ABS:
                case Op.OP_NOT:
                case Op.OP_0NOTEQUAL:
                case Op.OP_SIZE:
                    popN(1);
                    id = pushId(s, id);
                    if (op === Op.OP_CAT || op === Op.OP_SWAP || op === Op.OP_NUM2BIN) popN(1);
                    if (op === Op.OP_CAT) {
                    }
                    break;

                case Op.OP_SPLIT:
                    popN(2);
                    id = pushId(s, id);
                    id = pushId(s, id);
                    break;

                case Op.OP_TOALTSTACK:
                    popN(1);
                    break;
                case Op.OP_FROMALTSTACK:
                    id = pushId(s, id);
                    break;

                case Op.OP_DEPTH:
                    id = pushId(s, id);
                    break;

                case Op.OP_BOOLAND:
                case Op.OP_BOOLOR:
                case Op.OP_NUMEQUAL:
                case Op.OP_EQUAL:
                case Op.OP_ADD:
                case Op.OP_SUB:
                case Op.OP_LESSTHAN:
                case Op.OP_GREATERTHAN:
                case Op.OP_MIN:
                case Op.OP_MAX:
                    popN(2);
                    id = pushId(s, id);
                    break;

                case Op.OP_NUMEQUALVERIFY:
                case Op.OP_EQUALVERIFY:
                    popN(2);
                    break;

                case Op.OP_WITHIN:
                    popN(3);
                    id = pushId(s, id);
                    break;

                case Op.OP_SHA256:
                case Op.OP_HASH160:
                    popN(1);
                    id = pushId(s, id);
                    break;

                case Op.OP_VERIFY:
                    popN(1);
                    break;

                case Op.OP_PICK:
                case Op.OP_ROLL:
                    popN(s.length + 1);
                    id = pushId(s, id);
                    break;

                case Op.OP_CHECKSIG:
                    popN(2);
                    id = pushId(s, id);
                    break;
                case Op.OP_CHECKSIGVERIFY:
                    popN(2);
                    break;
                case Op.OP_CHECKMULTISIG:
                case Op.OP_CHECKMULTISIGVERIFY:
                    popN(s.length + 1);
                    if (op === Op.OP_CHECKMULTISIG) id = pushId(s, id);
                    break;

                default:
                    continue;
            }
        }

        maxId = Math.max(maxId, id);

        const schedule = (newPc: number, newStack: number[], newNextId: number) =>
            work.push({ pc: newPc, stack: newStack, nextId: newNextId });

        const nextPc = pc + 1;

        if (op === Op.OP_IF || op === Op.OP_NOTIF) {
            schedule(findMatchingElseOrEnd(prog, pc) ?? findMatchingEnd(prog, pc), [...s], id);
            schedule(nextPc, [...s], id);
        } else if (op === Op.OP_ELSE) {
            schedule(findMatchingEnd(prog, pc), s, id);
        } else if (op === Op.OP_ENDIF) {
            schedule(nextPc, s, id);
        } else if (isOpReturnX(op) || isAlwaysFail(op)) {
        } else {
            schedule(nextPc, s, id);
        }
    }

    return Math.max(1, maxId);
};

function findMatchingEnd(
    prog: ReturnType<typeof decodeAuthenticationInstructions>,
    start: number,
): number {
    let depth = 0;
    for (let pc = start + 1; pc < prog.length; ++pc) {
        const o = prog[pc].opcode as OpcodesBCH2023;
        if (o === Op.OP_IF || o === Op.OP_NOTIF) depth++;
        else if (o === Op.OP_ENDIF) {
            if (depth === 0) return pc + 1;
            depth--;
        }
    }
    return prog.length;
}

function findMatchingElseOrEnd(
    prog: ReturnType<typeof decodeAuthenticationInstructions>,
    start: number,
): number | undefined {
    let depth = 0;
    for (let pc = start + 1; pc < prog.length; ++pc) {
        const o = prog[pc].opcode as OpcodesBCH2023;
        if (o === Op.OP_IF || o === Op.OP_NOTIF) depth++;
        else if (o === Op.OP_ELSE && depth === 0) return pc + 1;
        else if (o === Op.OP_ENDIF) {
            if (depth === 0) return pc + 1;
            depth--;
        }
    }
    return undefined;
}

export class ScriptSolver extends Logger {
    public logColor = '#7b00ff';

    private readonly SMT_MS = 20_000;
    private readonly vm = createVirtualMachine(createInstructionSetBTC(false));
    private z3Init: Z3Module | null = null;

    private enableBrute: boolean = false;

    public async solve(
        lockHex: string,
        bruteMax: bigint = 32n,
        tapscript = false,
    ): Promise<{ solved: boolean; stack?: Uint8Array[]; reason?: string }> {
        this.info(`solve() ▶ lockHex=${lockHex}, bruteMax=${bruteMax}`);

        const lock = Uint8Array.from(Buffer.from(lockHex, 'hex'));
        const minPH = Math.max(2, estimateMinPlaceholders(lock));
        const seed = new SymState(lock, [...Array(minPH).keys()].map(P), { tapscript });

        for (let i = 0; i < minPH; i++) seed.stack.push(seed.ph[i]);

        this.debug('phase 1/3 – symbolic execution');
        const pathSets: Expr[][] = [];
        this.symExec(seed, pathSets);

        const containsSymSha = seed.constraints.some(function walk(e): boolean {
            if (e.tag === 'app' && e.op === 'sha256' && e.args[0].tag === 'ph') return true;
            return e.tag === 'app' && e.args.some(walk);
        });

        if (containsSymSha) {
            if (!this.enableBrute) {
                return { solved: false, reason: 'require brute force' };
            }

            this.info('symbolic sha256 detected — skip SMT, use brute mode');

            const brute = this.bruteHashes(lock, seed, bruteMax);
            return brute ?? { solved: false, reason: 'dictionary + brute failed' };
        }

        this.debug('phase 2/3 – SMT solving');
        const z3 = await this.getZ3();

        const ctx = z3.Context('main');

        const ONE = ctx.BitVec.val(1n, 256);
        const ZERO = ctx.BitVec.val(0n, 256);
        const INT_MIN = ctx.BitVec.val(-(1n << 31n), 256);
        const INT_MAXp = ctx.BitVec.val(1n << 31n, 256);

        const solver = new ctx.Solver();
        solver.set('timeout', this.SMT_MS);

        const used = new Set<number>();
        const walk = (e: Expr): void => {
            if (e.tag === 'ph') used.add(e.i);
            else if (e.tag === 'app') e.args.forEach(walk);
        };

        seed.constraints.forEach(walk);

        if (used.size === 0) used.add(0);

        const phIndex = [...used].sort((a, b) => a - b);
        const phMap = new Map<number, ReturnType<typeof ctx.BitVec.const>>();
        const phVars = phIndex.map((i) => {
            const v = ctx.BitVec.const(`ph${i}`, 256);
            phMap.set(i, v);
            return v;
        });

        /*phVars.forEach((v) => {
            solver.add(v.sge(INT_MIN));
            solver.add(v.slt(INT_MAXp));

            const signBit = v.extract(31, 31);
            const top224 = v.extract(255, 32);

            solver.add(top224.eq(signBit.repeat(224)));
            solver.add(signBit.eq(ctx.BitVec.val(0, 1)));
        });*/

        phVars.forEach((v) => {
            solver.add(v.sge(INT_MIN));
            solver.add(v.slt(INT_MAXp));

            const signBit = v.extract(31, 31); // 1-bit vector
            const top224 = v.extract(255, 32); // 224-bit vector

            solver.add(top224.eq(signBit.repeat(224))); // ordinary sign-extend
            //solver.add(signBit.eq(ctx.BitVec.val(0, 1))); // but force it to 0
            solver.add(v.neq(ctx.BitVec.val(INT_MIN.value(), 256)));
        });

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
            if (e.tag === 'ph') {
                const v2 = phMap.get(e.i);
                if (!v2) throw new Error(`Placeholder ph${e.i} not found in map`);

                return v2;
            }
            switch (e.op) {
                case 'neg': {
                    // OP_NEGATE
                    const [x] = e.args.map(enc);
                    return x.neg(); //   0 - x
                }
                case 'abs': {
                    // OP_ABS
                    const [x] = e.args.map(enc);
                    return ctx.If(x.slt(ZERO), x.neg(), x);
                }
                case 'add1': {
                    // OP_1ADD
                    const [x] = e.args.map(enc);
                    return x.add(ONE);
                }
                case 'sub1': {
                    // OP_1SUB
                    const [x] = e.args.map(enc);
                    return x.sub(ONE);
                }
                case 'iszero': {
                    // OP_NOT
                    const [x] = e.args.map(enc);
                    return boolToBV(x.eq(ZERO)); // 1 if x==0 else 0
                }
                case 'neq0': {
                    // OP_0NOTEQUAL
                    const [x] = e.args.map(enc);
                    return boolToBV(x.neq(ZERO));
                }
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
                    return boolToBV(a.neq(ZERO).and(b.neq(ZERO)));
                }
                case 'boolor': {
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.neq(ZERO).or(b.neq(ZERO)));
                }
                case 'within': {
                    const [a, b, c] = e.args.map(enc);
                    return boolToBV(a.sge(b).and(a.slt(c)));
                }
                case 'min': {
                    const [a, b] = e.args.map(enc);
                    return ctx.If(a.slt(b), a, b);
                }
                case 'max': {
                    const [a, b] = e.args.map(enc);
                    return ctx.If(a.sgt(b), a, b);
                }
                case 'sha256': {
                    return fun('sha256').call(enc(e.args[0])) as BV256;
                }
                case 'ripemd160':
                    return fun('ripemd160').call(enc(e.args[0])) as BV256;

                case 'sha1':
                    return fun('sha1').call(enc(e.args[0])) as BV256;
                case 'hash256':
                    return fun('hash256').call(enc(e.args[0])) as BV256;
                case 'mul': {
                    // OP_MUL
                    const [a, b] = e.args.map(enc);
                    return a.mul(b);
                }

                case 'div': {
                    // OP_DIV – signed, trunc. toward 0
                    const [a, b] = e.args.map(enc);
                    return a.sdiv(b);
                }

                case 'mod': {
                    // OP_MOD – signed remainder
                    const [a, b] = e.args.map(enc);
                    return a.srem(b);
                }

                case 'band': {
                    // OP_AND
                    const [a, b] = e.args.map(enc);
                    return a.and(b);
                }

                case 'bor': {
                    // OP_OR
                    const [a, b] = e.args.map(enc);
                    return a.or(b);
                }

                case 'bxor': {
                    // OP_XOR
                    const [a, b] = e.args.map(enc);
                    return a.xor(b);
                }
                case 'lsh': {
                    // logical left-shift  (OP_LSHIFT)
                    const [a, b] = e.args.map(enc); // a,b : BV256
                    // VM keeps only the low 32 bits of the shift-amount
                    const amount = b.extract(31, 0).zeroExt(256 - 32);
                    return a.shl(amount) as BV256;
                }

                case 'rsh': {
                    // arithmetic right-shift (OP_RSHIFT)
                    const [a, b] = e.args.map(enc); // a,b : BV256
                    const amount = b.extract(31, 0).zeroExt(256 - 32);
                    return a.shr(amount) as BV256; // <- use the BitVec.shr method
                }
                case 'le': {
                    // OP_LESSTHANOREQUAL
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.sle(b));
                }
                case 'ge': {
                    // OP_GREATERTHANOREQUAL
                    const [a, b] = e.args.map(enc);
                    return boolToBV(a.sge(b));
                }
                case 'cat':
                case 'splitL':
                case 'splitR':
                case 'rev':
                case 'n2b':
                case 'b2n':
                case 'len':
                case 'quot':
                case 'rem': {
                    const f = fun(e.op);
                    return f.call(...e.args.map(enc)) as BV256;
                }
            }

            throw new Error(`unhandled op ${e.op}`);
        };

        const pathBool = pathSets.map((cs) => ctx.And(...cs.map((c) => enc(c).neq(ZERO))));
        if (pathBool.length === 0) {
            solver.add(ctx.Bool.val(false));
        } else {
            solver.add(ctx.Or(...pathBool));
        }

        const sat = await solver.check();
        this.debug(`SMT solver responded: ${sat}`);

        if (sat === 'sat') {
            const modelStack = this.modelToStack(solver.model(), ctx, phIndex);

            if (!this.runConcrete(lock, modelStack)) {
                const brute = this.enableBrute ? this.bruteHashes(lock, seed, bruteMax) : null;
                return brute ?? { solved: false, reason: 'model failed concrete VM' };
            }

            return { solved: true, stack: modelStack };
        }

        if (sat === 'unknown') {
            const brute = this.enableBrute ? this.bruteHashes(lock, seed, bruteMax) : null;
            if (brute) return brute;
        }

        return { solved: false, reason: sat };
    }

    private async getZ3(): Promise<Z3Module> {
        if (!this.z3Init) this.z3Init = await initZ3();
        return this.z3Init;
    }

    private bytesToUintLE(b: Uint8Array): bigint {
        let x = 0n;
        for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]);
        return x;
    }

    private symExec(seed: SymState, paths: Expr[][]): void {
        const prog = decodeAuthenticationInstructions(seed.code);

        const findBoundaries = (start: number) => {
            let depth = 0,
                elsePc: number | undefined;
            for (let pc = start + 1; pc < prog.length; pc++) {
                const op = prog[pc].opcode as OpcodesBCH2023;

                switch (op) {
                    case Op.OP_IF:
                    case Op.OP_NOTIF:
                        depth++;
                        break;

                    case Op.OP_ENDIF:
                        if (depth === 0) return { elsePc, endPc: pc + 1 };
                        depth--;
                        break;

                    case Op.OP_ELSE:
                        if (depth === 0) elsePc = pc + 1;
                        break;
                }
            }
            throw new Error('unmatched IF/ENDIF');
        };

        const queue: SymState[] = [seed];

        const fork = (src: SymState, pcTarget: number, extraConstraint: Expr) => {
            const ns = new SymState(src.code, src.ph, src.opts);
            ns.pc = pcTarget;
            ns.stack = [...src.stack];
            ns.constraints = [...src.constraints, extraConstraint];
            queue.push(ns);
        };

        while (queue.length) {
            const st = queue.pop();
            if (!st) {
                this.fail('queue underflow – no more states to process');
                break;
            }

            let phPtr = 0;
            const pop = (): Expr => {
                if (st.stack.length === 0) {
                    if (phPtr >= st.ph.length) throw 'placeholder exhausted';
                    st.stack.push(st.ph[phPtr++]);
                }

                const elem = st.stack.pop();
                if (!elem) throw new Error('unhandled op');

                return elem;
            };

            const pop2 = () => ({ b: pop(), a: pop() });
            const pop3 = () => ({ c: pop(), b: pop(), a: pop() });

            while (st.pc < prog.length) {
                const ins = prog[st.pc++];
                const opNum = ins.opcode;
                const op = opNum as OpcodesBCH2023;

                if (opNum <= 0x4e) {
                    let num = 0n;

                    if (isPush(ins) && ins.data.length) {
                        const d = ins.data;
                        if (d.length <= 4) {
                            const decoded = vmNumberToBigInt(d);

                            if (!isVmNumberError(decoded)) {
                                num = decoded;
                            } else {
                                num = this.bytesToUintLE(d);
                            }
                        } else {
                            num = this.bytesToUintLE(d);
                        }
                    }

                    st.stack.push(C(num));
                    continue;
                }

                if (op === Op.OP_MIN || op === Op.OP_MAX) {
                    const { a, b } = pop2();
                    st.stack.push(app(op === Op.OP_MIN ? 'min' : 'max', a, b));
                    continue;
                }

                if (isOpSuccessX(opNum)) {
                    if (st.opts.tapscript) {
                        st.constraints.push(C(1n));
                    } else {
                        st.constraints.push(C(0n));
                    }
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
                    const negate = op === Op.OP_NOTIF;
                    const cur = st.pc - 1;
                    const { elsePc, endPc } = findBoundaries(cur);

                    const takenConst =
                        cond.tag === 'const' ? (cond.v !== 0n) !== negate : undefined;

                    const condIsTrue = negate ? app('eq', cond, C(0n)) : cond;
                    const condIsFalse = negate ? cond : app('eq', cond, C(0n));

                    if (takenConst !== undefined) {
                        if (!takenConst) {
                            st.pc = elsePc ?? endPc;
                            continue;
                        }

                        if (!(cond.tag === 'const' && cond.v === 0n))
                            st.constraints.push(condIsTrue);
                        continue;
                    }

                    fork(st, elsePc ?? endPc, condIsFalse);

                    st.constraints.push(condIsTrue);
                    continue;
                }

                if (op === Op.OP_ELSE) {
                    const { endPc } = findBoundaries(st.pc);
                    st.pc = endPc;
                    continue;
                }

                if (op === Op.OP_ENDIF) continue;

                if (op === Op.OP_2DUP) {
                    const { a: y, b: x } = pop2();
                    st.stack.push(y, x, y, x);
                    continue;
                }

                if (op === Op.OP_SWAP) {
                    const { a, b } = pop2();
                    st.stack.push(a, b);
                    continue;
                }
                if (op === Op.OP_ROT) {
                    const { a, b, c } = pop3();
                    st.stack.push(b, a, c);
                    continue;
                }
                if (op === Op.OP_TUCK) {
                    const { a: y, b: x } = pop2();
                    st.stack.push(x, y, x);
                    continue;
                }

                if (op === Op.OP_TOALTSTACK) {
                    st.alt.push(pop());
                    continue;
                }
                if (op === Op.OP_FROMALTSTACK) {
                    st.stack.push(st.alt.pop() ?? P(phPtr));
                    continue;
                }

                if (
                    op === Op.OP_1ADD ||
                    op === Op.OP_1SUB ||
                    op === Op.OP_NEGATE ||
                    op === Op.OP_ABS ||
                    op === Op.OP_NOT ||
                    op === Op.OP_0NOTEQUAL
                ) {
                    const x = pop();
                    const fn =
                        op === Op.OP_1ADD
                            ? 'add1'
                            : op === Op.OP_1SUB
                              ? 'sub1'
                              : op === Op.OP_NEGATE
                                ? 'neg'
                                : op === Op.OP_ABS
                                  ? 'abs'
                                  : op === Op.OP_NOT
                                    ? 'iszero'
                                    : 'neq0';
                    st.stack.push(app(fn, x));
                    continue;
                }

                if (
                    op === Op.OP_MUL ||
                    op === Op.OP_DIV ||
                    op === Op.OP_MOD ||
                    op === Op.OP_AND ||
                    op === Op.OP_OR ||
                    op === Op.OP_XOR ||
                    op === Op.OP_LSHIFT ||
                    op === Op.OP_RSHIFT
                ) {
                    const { a, b } = pop2();
                    const fn =
                        op === Op.OP_MUL
                            ? 'mul'
                            : op === Op.OP_DIV
                              ? 'div'
                              : op === Op.OP_MOD
                                ? 'mod'
                                : op === Op.OP_AND
                                  ? 'band'
                                  : op === Op.OP_OR
                                    ? 'bor'
                                    : op === Op.OP_XOR
                                      ? 'bxor'
                                      : op === Op.OP_LSHIFT
                                        ? 'lsh'
                                        : 'rsh';
                    st.stack.push(app(fn, a, b));
                    continue;
                }

                if (op === Op.OP_LESSTHANOREQUAL || op === Op.OP_GREATERTHANOREQUAL) {
                    const { a, b } = pop2();
                    const fn = op === Op.OP_LESSTHANOREQUAL ? 'le' : 'ge';
                    st.stack.push(app(fn, a, b));
                    continue;
                }

                if (op === Op.OP_CAT) {
                    const { a, b } = pop2();
                    st.stack.push(app('cat', a, b));
                    continue;
                }
                if (op === Op.OP_SPLIT) {
                    const { a: n, b: x } = pop2();
                    st.stack.push(app('splitL', x, n), app('splitR', x, n));
                    continue;
                }
                if (op === Op.OP_REVERSEBYTES) {
                    st.stack.push(app('rev', pop()));
                    continue;
                }
                if (op === Op.OP_SIZE) {
                    const x = pop();
                    st.stack.push(x, app('len', x));
                    continue;
                }
                if (op === Op.OP_NUM2BIN) {
                    const { a: size, b: num } = pop2();
                    st.stack.push(app('n2b', num, size));
                    continue;
                }
                if (op === Op.OP_BIN2NUM) {
                    st.stack.push(app('b2n', pop()));
                    continue;
                }

                if (op === Op.OP_SHA1) {
                    st.stack.push(app('sha1', pop()));
                    continue;
                }
                if (op === Op.OP_HASH256) {
                    st.stack.push(app('hash256', pop()));
                    continue;
                }

                if (op === Op.OP_2DROP) {
                    pop();
                    pop();
                    continue;
                }

                if (op === Op.OP_3DUP) {
                    const x = pop(),
                        y = pop(),
                        z = pop();
                    st.stack.push(z, y, x, z, y, x);
                    continue;
                }

                if (op === Op.OP_2OVER) {
                    const a = pop(),
                        b = pop(),
                        c = pop();
                    st.stack.push(c, b, a, c, b);
                    continue;
                }

                if (op === Op.OP_2ROT) {
                    const a = pop(),
                        b = pop(),
                        c = pop(),
                        d = pop(),
                        e = pop();
                    st.stack.push(c, b, a, e, d);
                    continue;
                }

                if (op === Op.OP_2SWAP) {
                    const a = pop(),
                        b = pop(),
                        c = pop(),
                        d = pop();
                    st.stack.push(b, a, d, c);
                    continue;
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
                    const c = pop(),
                        b = pop(),
                        a = pop();
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

                if (op === Op.OP_RETURN || isOpReturnX(opNum)) {
                    st.constraints.push(C(0n));
                    break;
                }

                if (op === Op.OP_PICK || op === Op.OP_ROLL) {
                    const nExpr = pop();
                    const depth = st.stack.length;
                    const roll = op === Op.OP_ROLL;

                    const copyElem = (idx: number, target: SymState) => {
                        const elem = target.stack[target.stack.length - 1 - idx];
                        if (roll) target.stack.splice(target.stack.length - 1 - idx, 1);
                        target.stack.push(elem);
                    };

                    if (nExpr.tag === 'const') {
                        const idx = Number(nExpr.v);
                        if (idx < 0 || idx >= depth) {
                            st.stack.length = 0;
                            break;
                        }
                        copyElem(idx, st);
                    } else {
                        for (let i = 0; i < depth; i++) {
                            const ns = new SymState(st.code, st.ph, st.opts);
                            Object.assign(ns, JSON.parse(JSON.stringify(st)));
                            copyElem(i, ns);
                            ns.constraints.push(app('eq', nExpr, C(BigInt(i))));
                            queue.push(ns);
                        }
                        break;
                    }
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

                if (
                    op === Op.OP_CHECKSIG ||
                    op === Op.OP_CHECKSIGVERIFY ||
                    op === Op.OP_CHECKMULTISIG ||
                    op === Op.OP_CHECKMULTISIGVERIFY
                ) {
                    if (op === Op.OP_CHECKMULTISIG || op === Op.OP_CHECKMULTISIGVERIFY) {
                        const n = pop(),
                            m = pop();
                        const within20 = (e: Expr) => app('within', e, C(0n), C(21n));
                        st.constraints.push(
                            within20(m),
                            within20(n),
                            app('lt', m, app('add', n, C(1n))),
                        );

                        const popMany = (e: Expr) =>
                            e.tag === 'const'
                                ? st.stack.splice(-Number(e.v), Number(e.v))
                                : (st.stack.length = 0);

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

                if (op === Op.OP_IFDUP) {
                    const v = pop();

                    st.stack.push(v);

                    {
                        const ns = new SymState(st.code, st.ph, st.opts);
                        Object.assign(ns, JSON.parse(JSON.stringify(st)));
                        ns.stack.push(v);
                        ns.constraints.push(v);
                        queue.push(ns);
                    }

                    st.constraints.push(app('eq', v, C(0n)));
                    continue;
                }

                if (op === Op.OP_VERIFY) {
                    st.constraints.push(pop());
                    continue;
                }

                this.fail(`unimplemented opcode 0x${opNum.toString(16)} – treating as OP_FAILURE`);
                st.constraints.push(C(0n));
                break;
            }

            if (st.stack.length === 0) {
                st.constraints.push(C(0n));
            } else {
                const last = st.stack[st.stack.length - 1];

                st.constraints.push(last);
            }

            seed.constraints.push(...st.constraints);
            paths.push([...st.constraints]);
        }
    }

    private modelToStack(model: Z3Model, ctx: Context, phIndex: number[]): Uint8Array[] {
        const pushes: Uint8Array[] = [];
        for (const i of phIndex) {
            const bv: BitVecNum<256, 'main'> = model.eval(ctx.BitVec.const(`ph${i}`, 256), true);
            let val = bv.value();

            // if the sign bit (bit 255) is set, interpret as negative
            if (val >> 255n === 1n) {
                val -= 1n << 256n; // two’s-complement to signed range
            }

            console.log(`modelToStack() ▶ ph${i} = ${val}`);

            pushes.push(this.encodeMinimal(val));
        }
        return pushes;
    }

    private bruteHashes(
        lock: Uint8Array,
        st: SymState,
        max: bigint,
    ): { solved: true; stack: Uint8Array[] } | null {
        this.log(`bruteHashes() ▶ lock=${Buffer.from(lock).toString('hex')}, max=${max}`);

        const ids = new Set<number>();
        const walk = (e: Expr): void => {
            if (e.tag === 'ph') ids.add(e.i);
            else if (e.tag === 'app') e.args.forEach(walk);
        };

        st.constraints.forEach(walk);
        const idx = [...ids];

        const sha256eq: Array<{ index: number; target: bigint }> = [];
        const collectSha = (e: Expr): void => {
            if (e.tag === 'app' && e.op === 'eq') {
                const [l, r] = e.args;
                const is256 = (x: Expr): x is App =>
                    x.tag === 'app' && x.op === 'sha256' && x.args[0].tag === 'ph';
                if (is256(l) && r.tag === 'const') {
                    sha256eq.push({ index: (l.args[0] as Placeholder).i, target: r.v });
                } else if (is256(r) && l.tag === 'const') {
                    sha256eq.push({ index: (r.args[0] as Placeholder).i, target: l.v });
                }
            } else if (e.tag === 'app') e.args.forEach(collectSha);
        };

        st.constraints.forEach(collectSha);

        const asciiToBig = (s: string) =>
            [...Buffer.from(s, 'ascii')].reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n);

        const MAX_TRIES = 5_000;
        let tries: number = 0;

        if (idx.length === 0) return null;
        const vals: bigint[] = Array<bigint>(idx.length).fill(0n);
        const dfs = (pos: number): Uint8Array[] | null => {
            console.log(`dfs() ▶ pos=${pos}, vals=${vals}`);

            if (++tries > MAX_TRIES) return null;

            if (pos === idx.length) {
                const stack = idx.map((i) => this.encodeMinimal(vals[idx.indexOf(i)]));
                return this.runConcrete(lock, stack) ? stack : null;
            }

            for (const pre of sha256eq) {
                if (pre.index === idx[pos]) {
                    const hit = preimageDict.get(pre.target.toString(16).padStart(64, '0'));
                    if (hit !== undefined) {
                        vals[pos] = asciiToBig(hit);
                        const r = dfs(pos + 1);
                        if (r) return r;
                    }

                    const CHARS =
                        'abcdefghijklmnopqrstuvwxyz' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '0123456789';
                    for (let len = 1; len <= 8; len++) {
                        const rec = (pref: string): Uint8Array[] | null => {
                            if (pref.length === len) {
                                if (
                                    '0x' + sha256Hex(pref) ===
                                    '0x' + pre.target.toString(16).padStart(64, '0')
                                ) {
                                    vals[pos] = asciiToBig(pref);
                                    return dfs(pos + 1);
                                }
                                return null;
                            }
                            for (const ch of CHARS) {
                                const r2 = rec(pref + ch);
                                if (r2) return r2;
                            }
                            return null;
                        };
                        const done = rec('');
                        if (done) return done;
                    }
                }
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

    private encodePush256(n: bigint): Uint8Array {
        const bytes = Uint8Array.from(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
        return Uint8Array.of(0x4c, 32, ...bytes);
    }

    private runConcrete(lock: Uint8Array, stack: Uint8Array[]): boolean {
        console.log('runConcrete() ▶ lock=', lock, 'stack=', stack);
        const unlock = Uint8Array.from(stack.reduce<number[]>((a, b) => (a.push(...b), a), []));
        if (unlock.length > 10_000) return false;

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

        const result = this.vm.evaluate(prog);
        const ok = this.vm.stateSuccess(result);
        if (typeof ok !== 'boolean') {
            console.dir(prog, { depth: 10 });
            console.log(result);

            this.error(`runConcrete() failed with non-boolean result: ${ok}`);

            return false;
        } else {
            this.success(`Found solution: ${Buffer.from(unlock).toString('hex')}`);
        }

        return true;
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
