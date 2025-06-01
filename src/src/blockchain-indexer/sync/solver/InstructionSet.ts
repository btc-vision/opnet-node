import type {
    AuthenticationProgramBCH,
    AuthenticationProgramStateBCHCHIPs,
    InstructionSet,
    Operation,
    ResolvedTransactionBCH,
} from '@bitauth/libauth';
import { createInstructionSetBCHCHIPs, OpcodesBCH as Op } from '@bitauth/libauth';

const DISABLED_OPCODES: readonly number[] = [
    Op.OP_REVERSEBYTES,
    Op.OP_CHECKDATASIG,
    Op.OP_CHECKDATASIGVERIFY,
    Op.OP_SPLIT,
    Op.OP_CAT,
    Op.OP_NUM2BIN,
    Op.OP_BIN2NUM,
    Op.OP_INPUTINDEX,
    Op.OP_INPUTBYTECODE,
    Op.OP_TXVERSION,
    Op.OP_TXINPUTCOUNT,
    Op.OP_TXOUTPUTCOUNT,
    Op.OP_TXLOCKTIME,
    Op.OP_UTXOTOKENCATEGORY,
    Op.OP_UTXOTOKENCOMMITMENT,
];

/* ─────────────────────────  helper that marks failure  ─────────────────── */
const opDisabled: Operation<AuthenticationProgramStateBCHCHIPs> = (state) => {
    state.error = 'disabled opcode';
    return state;
};

export function createInstructionSetBTC(
    standard = true,
): InstructionSet<
    ResolvedTransactionBCH,
    AuthenticationProgramBCH,
    AuthenticationProgramStateBCHCHIPs
> {
    const btc = createInstructionSetBCHCHIPs(standard);

    /* 1 ▪ turn BCH-only opcodes into failures */
    for (const code of DISABLED_OPCODES) btc.operations[code] = opDisabled;

    /* 2 ▪ Bitcoin success rule: “stack non-empty & top item truthy” */
    btc.success = (state) => {
        if (state.error) return state.error;
        const { stack } = state;
        if (stack.length === 0) return 'empty stack';
        const top = stack[stack.length - 1];
        return top.some((b) => b !== 0) ? true : 'top stack item is false';
    };

    return btc;
}
