import type { Document } from 'bson';

export interface CurrentOpOutput {
    inprog: OperationDetails[];
    ok: number;
    operationTime: Timestamp;
    $clusterTime: ClusterTime;
}

export interface OperationDetails {
    shard?: string;
    type: string;
    host: string;
    desc: string;
    connectionId: number;
    client_s: string;
    appName: string;
    clientMetadata: Document;
    lsid: {
        id: string; // UUID
        uid: string; // BinData, convert to base64
    };
    transaction?: {
        parameters: {
            txnNumber: number;
            autocommit: boolean;
            readConcern: {
                level: string;
            };
        };
        readTimestamp: string;
        startWallClockTime: string;
        timeOpenMicros: number;
        timeActiveMicros: number;
        timeInactiveMicros: number;
        expiryTime: string;
    };
    active: boolean;
    currentOpTime: string;
    effectiveUsers: {
        user: string;
        db: string;
    }[];
    runBy: {
        user: string;
        db: string;
    }[];
    twoPhaseCommitCoordinator?: {
        lsid: {
            id: string;
            uid: string;
        };
        txnNumber: number;
        numParticipants: number;
        state: string;
        commitStartTime: string;
        hasRecoveredFromFailover: boolean;
        stepDurations: Document;
        decision: Document;
        deadline: string;
    };
    opid: string;
    secs_running: number;
    microsecs_running: number;
    op: string;
    ns: string;
    command: Document;
    configTime?: Timestamp;
    topologyTime?: Timestamp;
    queryFramework?: string;
    planSummary: string;
    prepareReadConflicts: number;
    writeConflicts: number;
    cursor?: {
        cursorId: number;
        createdDate: string;
        lastAccessDate: string;
        nDocsReturned: number;
        nBatchesReturned: number;
        noCursorTimeout: boolean;
        tailable: boolean;
        awaitData: boolean;
        originatingCommand: Document;
        planSummary: string;
        operationUsingCursorId: number;
    };
    msg: string;
    progress?: {
        done: number;
        total: number;
    };
    killPending: boolean;
    numYields: number;
    dataThroughputLastSecond: number;
    dataThroughputAverage: number;
    waitingForLatch?: {
        timestamp: string;
        captureName: string;
    };
    locks: {
        ParallelBatchWriterMode: string;
        ReplicationStateTransition: string;
        Global: string;
        Database: string;
        Collection: string;
        Metadata: string;
        oplog: string;
    };
    waitingForLock: boolean;
    lockStats: {
        ParallelBatchWriterMode: {
            acquireCount: {
                r: number;
                w: number;
                R: number;
                W: number;
            };
            acquireWaitCount: {
                r: number;
                w: number;
                R: number;
                W: number;
            };
            timeAcquiringMicros: {
                r: number;
                w: number;
                R: number;
                W: number;
            };
            deadlockCount: {
                r: number;
                w: number;
                R: number;
                W: number;
            };
        };
        ReplicationStateTransition?: Document;
        Global?: Document;
        Database?: Document;
        Collection?: Document;
        Metadata?: Document;
        oplog?: Document;
    };
}

export interface Timestamp {
    t: number;
    i: number;
}

export interface ClusterTime {
    clusterTime: Timestamp;
    signature: {
        hash: string;
        keyId: number;
    };
}
