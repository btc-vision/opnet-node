import crypto from 'crypto';

export function shuffleArray<T>(array: T[]): T[] {
    const shuffledArray = array.slice();

    // Use Fisher-Yates (Knuth) shuffle algorithm
    for (let i = shuffledArray.length - 1; i > 0; i--) {
        const j = Math.floor(
            (crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1)) * (i + 1),
        );

        [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
    }

    return shuffledArray;
}
