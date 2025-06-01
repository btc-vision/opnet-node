import {
    type AuthenticationInstruction,
    type AuthenticationInstructionPush,
    AuthenticationProgramCommon,
    createVirtualMachine,
    decodeAuthenticationInstructions,
    OpcodesBCH as Op,
    type OpcodesBCH2023,
} from '@bitauth/libauth';

import type { BitVec, Bool, Z3HighLevel, Z3LowLevel } from 'z3-solver';
import { init as initZ3 } from 'z3-solver';

import { Logger } from '@btc-vision/bsi-common';
import { createInstructionSetBTC } from './InstructionSet.js';

type IntConst = { tag: 'int'; v: bigint };
type BytesConst = { tag: 'bytes'; b: Uint8Array };
type Const = IntConst | BytesConst;

type Placeholder = { tag: 'ph'; i: number };
type App = { tag: 'app'; op: string; args: Expr[] };
type Expr = Const | Placeholder | App;

const I = (v: bigint): IntConst => ({ tag: 'int', v });
const B = (b: Uint8Array): BytesConst => ({ tag: 'bytes', b });
const P = (i: number): Placeholder => ({ tag: 'ph', i });
const A = (op: string, ...args: Expr[]): App => ({ tag: 'app', op, args });

const sha256 = (e: Expr) => A('sha256', e);
const ripemd160 = (e: Expr) => A('ripemd160', e);

interface SymOpts {
    tapscript: boolean;
}

class SymState {
    stack: Expr[] = [];
    pc = 0;
    constraints: Expr[] = [];

    constructor(
        readonly code: Uint8Array,
        readonly ph: Placeholder[],
        readonly opts: SymOpts,
    ) {}
}

function bvToPush(v: bigint): Uint8Array {
    const len = Number(v & 0xffn);
    let tmp = v >> 8n;
    const data = new Uint8Array(len);
    for (let i = 0; i < len; ++i) {
        data[i] = Number(tmp & 0xffn);
        tmp >>= 8n;
    }
    return Uint8Array.of(len, ...data);
}

const isPush = (x: AuthenticationInstruction): x is AuthenticationInstructionPush => 'data' in x;

const NOOP_SET = new Set<number>([Op.OP_NOP, Op.OP_CODESEPARATOR]);
const isNoop = (c: number) => NOOP_SET.has(c);
const isOpSuccessX = (c: number) => c >= 0xb0 && c <= 0xf7;
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
const isAlwaysFail = (c: number) => ALWAYS_FAIL_SET.has(c);
const isOpReturnX = (c: number) => c >= 0xda && c <= 0xfe;

interface Frame {
    pc: number;
    stack: number[];
    nextId: number;
}

export const estimateMinPlaceholders = (bytecode: Uint8Array): number => {
    const prog = decodeAuthenticationInstructions(bytecode);
    const work: Frame[] = [{ pc: 0, stack: [], nextId: 0 }];
    let maxId = 0;

    const pushId = (stk: number[], n: number) => (stk.push(n), n + 1);

    while (work.length) {
        const m = work.pop();

        if (!m) throw new Error('ScriptSolver: empty work stack');
        const { pc, stack, nextId } = m;

        if (pc >= prog.length) continue;
        const op = prog[pc].opcode as OpcodesBCH2023;

        const s = [...stack];
        let id = nextId;
        const popN = (n: number) => {
            for (let i = 0; i < n && s.length; ++i) s.pop();
        };

        const push = (n = 1) => {
            for (let i = 0; i < n; ++i) id = pushId(s, id);
        };
        const pushScalar = () => push(1);

        if ((op as number) <= 0x4e || op === Op.OP_0) pushScalar();
        else if (op === Op.OP_1NEGATE || (op >= Op.OP_1 && op <= Op.OP_16)) pushScalar();
        else {
            switch (op) {
                case Op.OP_DUP:
                    popN(1);
                    push(2);
                    break;
                case Op.OP_IFDUP:
                    popN(1);
                    push(2);
                    break;
                case Op.OP_DROP:
                    popN(1);
                    break;
                case Op.OP_NIP:
                    popN(2);
                    push(1);
                    break;
                case Op.OP_OVER:
                    popN(2);
                    push(3);
                    break;
                case Op.OP_2DUP:
                    popN(2);
                    push(4);
                    break;
                case Op.OP_3DUP:
                    popN(3);
                    push(6);
                    break;
                case Op.OP_2OVER:
                    popN(4);
                    push(6);
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
                    push(1);
                    break;

                case Op.OP_NUMEQUALVERIFY:
                case Op.OP_EQUALVERIFY:
                    popN(2);
                    break;

                case Op.OP_WITHIN:
                    popN(3);
                    push(1);
                    break;

                case Op.OP_SHA256:
                case Op.OP_HASH160:
                    popN(1);
                    push(1);
                    break;

                case Op.OP_VERIFY:
                    popN(1);
                    break;

                case Op.OP_PICK:
                case Op.OP_ROLL:
                    popN(s.length + 1);
                    pushScalar();
                    break;

                case Op.OP_CHECKSIG:
                    popN(2);
                    push(1);
                    break;
                case Op.OP_CHECKSIGVERIFY:
                    popN(2);
                    break;
                case Op.OP_CHECKMULTISIG:
                case Op.OP_CHECKMULTISIGVERIFY:
                    popN(s.length + 1);
                    if (op === Op.OP_CHECKMULTISIG) pushScalar();
                    break;

                default:
                    continue;
            }
        }

        maxId = Math.max(maxId, id);

        const next = pc + 1;
        const pushFrame = (p: number, st: number[], n: number) =>
            work.push({ pc: p, stack: st, nextId: n });

        if (op === Op.OP_IF || op === Op.OP_NOTIF) {
            pushFrame(findElseOrEnd(prog, pc) ?? findEnd(prog, pc), [...s], id);
            pushFrame(next, [...s], id);
        } else if (op === Op.OP_ELSE) pushFrame(findEnd(prog, pc), s, id);
        else if (op === Op.OP_ENDIF) pushFrame(next, s, id);
        else if (!isOpReturnX(op) && !isAlwaysFail(op)) pushFrame(next, s, id);
    }
    return Math.max(1, maxId);
};

const findEnd = (p: ReturnType<typeof decodeAuthenticationInstructions>, start: number) => {
    let d = 0;
    for (let pc = start + 1; pc < p.length; ++pc) {
        const o = p[pc].opcode as OpcodesBCH2023;
        if (o === Op.OP_IF || o === Op.OP_NOTIF) ++d;
        else if (o === Op.OP_ENDIF && d-- === 0) return pc + 1;
    }
    return p.length;
};
const findElseOrEnd = (
    p: ReturnType<typeof decodeAuthenticationInstructions>,
    start: number,
): number | undefined => {
    let d = 0;
    for (let pc = start + 1; pc < p.length; ++pc) {
        const o = p[pc].opcode as OpcodesBCH2023;
        if (o === Op.OP_IF || o === Op.OP_NOTIF) ++d;
        else if (o === Op.OP_ELSE && d === 0) return pc + 1;
        else if (o === Op.OP_ENDIF && d-- === 0) return pc + 1;
    }
    return undefined;
};

const BV_BITS = 264;

type Z3Module = Z3HighLevel & Z3LowLevel;
type BV = BitVec<264, 'main'>;

export class ScriptSolver extends Logger {
    public logColor = '#7b00ff';
    private readonly SMT_MS = 20_000;
    private readonly vm = createVirtualMachine(createInstructionSetBTC(false));
    private z3Init: Z3Module | null = null;

    public async solve(
        lockHex: string,
        bruteMax: bigint = 32n,
        tapscript = false,
    ): Promise<{ solved: boolean; stack?: Uint8Array[]; reason?: string }> {
        this.log(`solve() ▶ lockHex=${lockHex}`);

        const lock = Uint8Array.from(Buffer.from(lockHex, 'hex'));
        const minPH = Math.min(32, estimateMinPlaceholders(lock));

        const seed = new SymState(lock, [...Array(minPH).keys()].map(P), { tapscript });
        seed.stack.push(...seed.ph);

        const paths: Expr[][] = [];
        this.symExec(seed, paths);

        const z3 = await this.getZ3();
        const ctx = z3.Context('main');

        const phUsed = new Set<number>();
        seed.constraints.forEach((c) =>
            this.walk(c, (e) => {
                if (e.tag === 'ph') phUsed.add(e.i);
            }),
        );

        if (!phUsed.size) phUsed.add(0);

        const BV_SORT = ctx.BitVec.sort(BV_BITS);

        const phMap = new Map<number, BV>();
        const phVars = [...phUsed]
            .sort((a, b) => a - b)
            .map((i) => {
                const v = ctx.BitVec.const(`ph${i}`, BV_BITS);
                phMap.set(i, v);
                return v;
            });

        const fun = (name: string) => ctx.Function.declare(name, BV_SORT, BV_SORT);

        const enc = (e: Expr): BV => {
            if (e.tag === 'ph') {
                const a = phMap.get(e.i);
                if (!a) throw new Error(`placeholder ${e.i} not found`);

                return a;
            }

            if (e.tag === 'bytes') {
                let payload = 0n;
                for (let i = e.b.length - 1; i >= 0; --i)
                    payload = (payload << 8n) | BigInt(e.b[i]);
                return ctx.BitVec.val((payload << 8n) | BigInt(e.b.length), BV_BITS);
            }

            if (e.tag === 'int') return ctx.BitVec.val(e.v, BV_BITS);

            const bv = (x: Expr) => enc(x);
            const bool = (b: Bool<'main'>) =>
                ctx.If(b, ctx.BitVec.val(1n, BV_BITS), ctx.BitVec.val(0n, BV_BITS));

            switch (e.op) {
                case 'eq': {
                    const [a, b] = e.args;
                    return bool(bv(a).eq(bv(b)));
                }
                case 'lt': {
                    const [a, b] = e.args;
                    return bool(bv(a).ult(bv(b)));
                }
                case 'gt': {
                    const [a, b] = e.args;
                    return bool(bv(a).ugt(bv(b)));
                }
                case 'add': {
                    const [a, b] = e.args;
                    if (a.tag !== 'int' || b.tag !== 'int') return ctx.BitVec.val(0n, BV_BITS);
                    return bv(a).add(bv(b));
                }
                case 'sub': {
                    const [a, b] = e.args;
                    if (a.tag !== 'int' || b.tag !== 'int') return ctx.BitVec.val(0n, BV_BITS);
                    return bv(a).sub(bv(b));
                }
                case 'booland': {
                    const [a, b] = e.args;
                    return bool(bv(a).and(bv(b)).neq(ctx.BitVec.val(0n, BV_BITS)));
                }
                case 'boolor': {
                    const [a, b] = e.args;
                    return bool(bv(a).or(bv(b)).neq(ctx.BitVec.val(0n, BV_BITS)));
                }
                case 'within': {
                    const [x, a, b] = e.args;
                    return bool(
                        bv(x)
                            .uge(bv(a))
                            .and(bv(x).ult(bv(b))),
                    );
                }
                case 'min': {
                    const [a, b] = e.args;
                    return ctx.If(bv(a).ult(bv(b)), bv(a), bv(b));
                }
                case 'max': {
                    const [a, b] = e.args;
                    return ctx.If(bv(a).ugt(bv(b)), bv(a), bv(b));
                }
                case 'sha256':
                    return fun('sha256').call(bv(e.args[0])) as BV;
                case 'ripemd160':
                    return fun('ripemd160').call(bv(e.args[0])) as BV;
            }
            throw new Error(`unknown op ${e.op}`);
        };

        const solver = new ctx.Solver();
        solver.set('timeout', this.SMT_MS);

        const LEN8 = (v: BV) => v.extract(7, 0);
        const LEN_LIM = ctx.BitVec.val(0x4bn, 8);
        phVars.forEach((v) => solver.add(LEN8(v).ule(LEN_LIM)));

        const pathBv = paths.map((cs) =>
            ctx.And(...cs.map((c) => enc(c).neq(ctx.BitVec.val(0n, BV_BITS)))),
        );

        solver.add(pathBv.length ? ctx.Or(...pathBv) : ctx.Bool.val(false));

        const sat = await solver.check();
        if (sat !== 'sat') return { solved: false, reason: sat };

        const model = solver.model();
        const pushes = [...phUsed].map((i) => {
            const v = phMap.get(i);
            if (!v) throw new Error(`placeholder ${i} not found in model`);

            return bvToPush(model.eval(v, true).value());
        });

        return this.runConcrete(lock, pushes)
            ? { solved: true, stack: pushes }
            : { solved: false, reason: 'model failed VM (bug)' };
    }

    private async getZ3(): Promise<Z3Module> {
        if (!this.z3Init) this.z3Init = await initZ3();
        return this.z3Init;
    }

    private walk(e: Expr, f: (x: Expr) => void) {
        f(e);
        if (e.tag === 'app') e.args.forEach((a) => this.walk(a, f));
    }

    private symExec(seed: SymState, paths: Expr[][]): void {
        const prog = decodeAuthenticationInstructions(seed.code);

        const findBlock = (start: number) => {
            let depth = 0,
                elsePc: number | undefined;
            for (let pc = start + 1; pc < prog.length; ++pc) {
                const o = prog[pc].opcode as OpcodesBCH2023;
                if (o === Op.OP_IF || o === Op.OP_NOTIF) ++depth;
                else if (o === Op.OP_ENDIF && depth-- === 0) return { elsePc, endPc: pc + 1 };
                else if (o === Op.OP_ELSE && depth === 0) elsePc = pc + 1;
            }
            throw new Error('unmatched IF/ENDIF');
        };

        const queue: SymState[] = [seed];

        const fork = (src: SymState, pcTarget: number, extra: Expr) => {
            const ns = new SymState(src.code, src.ph, src.opts);
            ns.pc = pcTarget;
            ns.stack = [...src.stack];
            ns.constraints = [...src.constraints, extra];
            queue.push(ns);
        };

        while (queue.length) {
            const st = queue.pop();
            if (!st) {
                throw new Error('ScriptSolver: empty queue');
            }

            let phPtr = 0;

            const pop = (): Expr => {
                if (!st.stack.length) {
                    if (phPtr >= st.ph.length) throw new Error('placeholder exhausted');
                    st.stack.push(st.ph[phPtr++]);
                }

                const p = st.stack.pop();
                if (!p) {
                    throw new Error('ScriptSolver: pop from empty stack');
                }

                return p;
            };

            const pop2 = () => ({ b: pop(), a: pop() });

            for (; st.pc < prog.length; ++st.pc) {
                const ins = prog[st.pc];
                const opNum = ins.opcode;
                const op = opNum as OpcodesBCH2023;
                st.pc += 1;

                if (opNum <= 0x4e) {
                    const raw = isPush(ins) ? ins.data : new Uint8Array();
                    st.stack.push(B(raw));
                    continue;
                }

                if (op === Op.OP_1NEGATE) {
                    st.stack.push(I(-1n));
                    continue;
                }
                if (op >= Op.OP_1 && op <= Op.OP_16) {
                    st.stack.push(I(BigInt(op - Op.OP_1 + 1)));
                    continue;
                }

                if (isNoop(op)) continue;
                if (isAlwaysFail(op)) {
                    st.constraints.push(I(0n));
                    break;
                }

                if (isOpSuccessX(op)) {
                    st.constraints.push(st.opts.tapscript ? I(1n) : I(0n));
                    break;
                }

                if (op === Op.OP_IF || op === Op.OP_NOTIF) {
                    const cond = pop();
                    const negate = op === Op.OP_NOTIF;
                    const { elsePc, endPc } = findBlock(st.pc - 1);

                    const isConst = cond.tag === 'int';
                    const condNZ = negate ? A('eq', cond, I(0n)) : cond;
                    const condZ = negate ? cond : A('eq', cond, I(0n));

                    if (isConst) {
                        const takeTrue = cond.v !== 0n;
                        if (takeTrue !== negate) {
                            st.constraints.push(condNZ);
                        } else {
                            st.pc = elsePc ?? endPc;
                        }
                        continue;
                    }

                    fork(st, elsePc ?? endPc, condZ);
                    st.constraints.push(condNZ);
                    continue;
                }

                if (op === Op.OP_ELSE) {
                    st.pc = findBlock(st.pc - 1).endPc;
                    continue;
                }
                if (op === Op.OP_ENDIF) continue;

                if (op === Op.OP_DUP) {
                    const v = pop();
                    st.stack.push(v, v);
                    continue;
                }
                if (op === Op.OP_DROP) {
                    pop();
                    continue;
                }
                if (op === Op.OP_IFDUP) {
                    const v = pop();
                    st.stack.push(v);

                    const ns = new SymState(st.code, st.ph, st.opts);
                    Object.assign(ns, JSON.parse(JSON.stringify(st)));
                    ns.stack.push(v);
                    ns.constraints.push(v);
                    queue.push(ns);

                    st.constraints.push(A('eq', v, I(0n)));
                    continue;
                }

                const bin = (name: string) => {
                    const { a, b } = pop2();
                    st.stack.push(A(name, a, b));
                };
                switch (op) {
                    case Op.OP_ADD:
                        bin('add');
                        continue;
                    case Op.OP_SUB:
                        bin('sub');
                        continue;
                    case Op.OP_BOOLAND:
                        bin('booland');
                        continue;
                    case Op.OP_BOOLOR:
                        bin('boolor');
                        continue;
                    case Op.OP_LESSTHAN:
                        bin('lt');
                        continue;
                    case Op.OP_GREATERTHAN:
                        bin('gt');
                        continue;
                    case Op.OP_MIN:
                        bin('min');
                        continue;
                    case Op.OP_MAX:
                        bin('max');
                        continue;
                    case Op.OP_NUMEQUAL:
                    case Op.OP_EQUAL:
                        bin('eq');
                        continue;
                    case Op.OP_NUMEQUALVERIFY:
                    case Op.OP_EQUALVERIFY: {
                        const { a, b } = pop2();
                        st.constraints.push(A('eq', a, b));
                        continue;
                    }
                }

                if (op === Op.OP_WITHIN) {
                    const c = pop(),
                        b = pop(),
                        a = pop();
                    st.stack.push(A('within', a, b, c));
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

                this.fail(`unimplemented opcode 0x${opNum.toString(16)}`);
                st.constraints.push(I(0n));
                break;
            }

            st.constraints.push(st.stack.length ? st.stack[st.stack.length - 1] : I(0n));

            seed.constraints.push(...st.constraints);
            paths.push([...st.constraints]);
        }
    }

    private runConcrete(lock: Uint8Array, stack: Uint8Array[]): boolean {
        const unlock = Uint8Array.from(stack.flat());
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
        return !!this.vm.stateSuccess(this.vm.evaluate(prog));
    }
}
