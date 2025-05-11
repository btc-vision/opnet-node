# Re-implementing Disabled Bitcoin Script Opcodes with **Stack Gymnastics**

## Context

Bitcoin's earliest releases offered convenience opcodes such as `OP_CAT`, `OP_XOR`, `OP_AND`, `OP_LEFT`, `OP_RIGHT`, and
friends. In mid-2010 they were disabled to plug denial-of-service vectors.

With Tapscript (§Nov 2021) two historical limits disappeared: the 201-opcode cap and the 10 kB script-size ceiling. The
only consensus resource budgets that still matter during execution are:

* max 1000 elements (main + alt stack) after **every** opcode
* max 520 bytes per element
* normal sig-operation limits and block weight

Given those budgets, every disabled opcode can be emulated today on Bitcoin L1. The technique is colloquially called
"stack gymnastics".

---

## What *is* stack gymnastics?

Rather than manipulating a byte-array directly, data are first exploded into a **bit vector** – one bit per stack
element – using only still-valid primitives. Once individual bits live on the stack, boolean and positional operations
can be expressed through:

* `OP_DUP`, `OP_PICK`, `OP_ROLL`          (move any element anywhere)
* `OP_TOALTSTACK`, `OP_FROMALTSTACK`       (swap working sets cheaply)
* `OP_NUMNOTEQUAL`, `OP_BOOLAND`, `OP_BOOLOR`, `OP_NOT`   (bit-wise logic)
* `OP_ADD`, `OP_SUB`, `OP_GREATERTHANOREQUAL`             (integer arithmetic)

Because Bitcoin Script has **no run-time loops**, every algorithm is **compile-time unrolled**: the code generator
counts the required iterations and writes them out as straight-line opcode sequences.

---

## Building the Primitive Helpers

### NUM2BIN

*Input*: integer `n`, width `w` bits.
*Action*: pushes exactly `w` single-bit elements onto the ALT stack, MSB first.

Algorithm (fully unrolled):

1. Duplicate `n`.
2. Mask with `2^(w-1-i)`.
3. Convert the comparison result into `OP_0` / `OP_1`.
4. Move the bit to ALT (`OP_TOALTSTACK`).

### BIN2NUM

Re-assembles the `w` bits on ALT back into one integer on the main stack by repeated `OP_ADD` and doubling.

### reverseBitsN

Moves the top `w` bits on ALT back to ALT in reverse order, restoring MSB→LSB ordering after per-bit work is done.

---

## Re-creating Specific Disabled Opcodes

### OP\_XOR

```pseudocode
NUM2BIN(a, w)
NUM2BIN(b, w)
for i = 0 → w-1
    Xᵢ  = OP_FROMALTSTACK      ; bit aᵢ
    Yᵢ  = OP_FROMALTSTACK      ; bit bᵢ
    Zᵢ  = OP_NUMNOTEQUAL       ; XOR = aᵢ ⊕ bᵢ
    OP_TOALTSTACK(Zᵢ)
reverseBitsN(w)
BIN2NUM(w)                     ; integer result
```

The loop is unrolled at compile time; peak stack use ≈ 2*w + constant ≤ 1000 ⇒ `w ≤ 498` without chunking. For larger
widths, XOR halves separately and `OP_CAT` the results.

### OP\_CAT

With bit vectors `A` (aBits) and `B` (bBits) already parked on ALT:

1. Pop **B** then **A** back to the main stack.
2. Push `aBits` times: `aBits OP_ROLL OP_TOALTSTACK` (moves **A** back to ALT preserving order).
3. Push `bBits times` directly to ALT.
4. The concatenated vector `[A | B]` now lives on ALT with correct order; width tracker stores `aBits + bBits`.

Because every step respects the 520-byte element cap and keeps element count below 1000, the emulation is
consensus-valid.

### OP\_EQUAL

`OP_EQUAL_FROM_STACK_XY` computes `(A == B)` without the native opcode:

1. XOR the two vectors (per-bit `OP_NUMNOTEQUAL`).
2. OR-reduce all bits to one accumulator (`OP_BOOLOR`).
3. `OP_NOT` the accumulator – zero → true, non-zero → false.

---

## Worked examples with stack diagrams

### XOR of two three‑bit numbers (`a = 101₂`, `b = 011₂`)

```
Initial ALT  ──➤  (empty)

◆ NUM2BIN(a,3)   ALT = 1 0 1
◆ NUM2BIN(b,3)   ALT = 1 0 1 0 1 1   (top at right)

◆ getXorN(3)     pop 1,1 ➜ 0; 0,1 ➜1; 1,0 ➜1
                 ALT = 0 1 1

◆ reverseBitsN(3) ALT = 1 1 0
◆ BIN2NUM(3)      main stack top = 110₂ = 6
```

Peak element count = 6 (≪1000). Final script length after unrolling `3` iterations = 55 opcodes.

### Concatenation (OP\_CAT) of 4‑bit A and 4‑bit B

ALT after `NUM2BIN` calls:

```
A₍3₎ A₍2₎ A₍1₎ A₍0₎ B₍3₎ B₍2₎ B₍1₎ B₍0₎
```

Stack gymnastic sequence:

* Pop B then A back to main (`OP_FROMALTSTACK`).
* Push A back to ALT **using `OP_ROLL` depth = aBits‑1 ...0**: preserves original order.
* Push B directly (`OP_TOALTSTACK`).

ALT ends as `A₍3₎  ... A₍0₎ B₍3₎  ... B₍0₎`. Width tracker records `aBits + bBits` (= 8).

```ts
class Builder {
    public compileCustom(): (number | Buffer | Buffer[])[] {
        return [
            ...this.getScriptSenderOnly(),
            opcodes.OP_CODESEPARATOR,

            /** OP_CAT */
            ...this.customOperators.NUM2BIN(0xfffffffffffffffffffffffffffffffen, 128),
            ...this.customOperators.NUM2BIN(0xfffffffffffffeffffffffffffffffffn, 128),

            ...this.customOperators.CAT_FROM_STACK_XY(),
            ...this.customOperators.REVERSE_STACK(256),
            ...this.customOperators.OP_EQUAL_FROM_STACK_X(
                0xfffffffffffffffffffffffffffffffefffffffffffffeffffffffffffffffffn,
            ),
        ];
    }
}
```

---

## Scaling beyond 498 bits and the 1000-element wall

The formula for peak elements while XOR-ing two vectors is roughly

```
2*w   (bits)  + 30 (housekeeping) < 1000
```

⇒ safe single-pass limit ≈498 bits.

For 512-bit Ed25519 keys or 1024-bit RSA fragments:

```pseudocode
split operand into 256-bit limbs
for each limb      // four times for 1024-bit values
    NUM2BIN limbA
    NUM2BIN limbB
    getXorN(256)
    reverseBitsN(256)
    OP_TOALTSTACK   ; park result limb
roll up four XOR-ed limbs with OP_CAT emulation
```

Chunking keeps every phase ≤ 512 elements.


---

## Generalisation

Any transformation that:

* touches a finite amount of data (≤ 520 bytes per item)
* can be expressed as a pure function without loops

...is reducible to stack gymnastics under Taproot. Examples already proven in the field:

* `OP_AND`, `OP_OR`, `OP_INVERT` → same per-bit template as XOR
* `OP_LEFT`, `OP_RIGHT`, `OP_SUBSTR` → chain of conditional picks & rolls
* constant-time barrel shifters, Barrett reduction, 256-bit modular multiply

The only scripts that **cannot** be reproduced are those that inherently need **unbounded iteration** (e.g., Euclidean
GCD with unknown-length inputs). Bitcoin Script forbids loops regardless of the opcode set.
