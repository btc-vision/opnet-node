import { describe, expect, it } from 'vitest';
import { generateRequestId } from '../../../src/src/plugins/workers/WorkerMessages.js';

// Test WorkerMessages utilities and configurations
describe('WorkerMessages', () => {
    describe('generateRequestId', () => {
        it('should generate unique request IDs', () => {
            const id1 = generateRequestId();
            const id2 = generateRequestId();
            const id3 = generateRequestId();

            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
            expect(id1).not.toBe(id3);
        });

        it('should generate string IDs', () => {
            const id = generateRequestId();
            expect(typeof id).toBe('string');
        });
    });
});
