import { IOPNetConsensus, IOPNetConsensusObj } from './types/IOPNetConsensus.js';
import { Consensus } from './consensus/Consensus.js';
import { RoswellConsensus } from './consensus/RoswellConsensus.js';

export const currentConsensus: Consensus = Consensus.Roswell;

export const OPNetConsensus: IOPNetConsensusObj = {
    [Consensus.Roswell]: RoswellConsensus,
};

export const currentConsensusConfig: IOPNetConsensus<Consensus> = OPNetConsensus[currentConsensus];
