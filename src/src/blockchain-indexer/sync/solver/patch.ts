import type { Context, Z3HighLevel, Z3LowLevel } from 'z3-solver';
import { init as initZ3 } from 'z3-solver';

type Z3Module = Z3HighLevel & Z3LowLevel;

let modP: Promise<Z3Module> | null = null;
let ctx: Context<'main'> | null = null;
let solver: InstanceType<Context['Solver']> | null = null;

/**  Lazily initialises the module, context and solver – once per process. */
export async function getSolver(timeoutMs = 20_000) {
    if (!modP) modP = initZ3();
    const mod = await modP;

    if (!ctx) {
        ctx = mod.Context('main');
        solver = new ctx.Solver();
    }

    if (!solver) throw new Error('Solver is not initialized');

    solver.reset();
    solver.set('timeout', timeoutMs);

    return { mod, ctx: ctx, solver: solver };
}
