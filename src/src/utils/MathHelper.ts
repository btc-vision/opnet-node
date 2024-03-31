import Decimal from 'decimal.js';
import { Logger } from '../logger/Logger';

Decimal.set({ precision: 18, rounding: Decimal.ROUND_DOWN });

const logger = new Logger();

export const castTokenValue = (value: string | number | Decimal, dec = undefined) => {
    if (typeof dec === 'undefined') {
        return new Decimal(value);
    }

    if (isNaN(dec)) {
        logger.warn(`Invalid decimal value: ${dec}`);
        return new Decimal(0);
    }

    if (typeof value === 'string') {
        value = value.trim();
        if (value.charAt(0) === '-') {
            return new Decimal(0);
        }
    }

    const n = new Decimal(value);
    const precised = n.toDecimalPlaces(dec, Decimal.ROUND_DOWN);

    const Idec = Decimal.clone({ precision: dec });

    const out = new Idec(precised);

    const dust = n.minus(out);

    Object.assign(out, { dust });

    return out;
};
