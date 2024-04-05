export interface ChainTipInfo {
    height: number;
    hash: string;
    branchlen: number;
    status: "invalid" | "headers-only" | "valid-headers" | "valid-fork" | "active";
}
