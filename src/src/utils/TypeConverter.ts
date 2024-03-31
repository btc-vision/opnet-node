import { Decimal128, ObjectId } from "mongodb";

export class TypeConverter {
    public static bigintToDecimal128(value: bigint): Decimal128 {
        return Decimal128.fromString(value.toString());
    }

    public static decimal128ToBigint(value: Decimal128): bigint {
        return BigInt(value.toString());
    }

    public static numberToDecimal128(value: number): Decimal128 {
        return Decimal128.fromString(value.toString());
    }

    public static stringToObjectId(value: string): ObjectId {
        return new ObjectId(value);
    }

    public static decimal128ToBigintArray(values: Decimal128[]): bigint[] {
        return values.map(value => TypeConverter.decimal128ToBigint(value));
    }

    public static bigintToDecimal128Array(values: bigint[]): Decimal128[] {
        return values.map(value => TypeConverter.bigintToDecimal128(value));
    }
}
