export class MutableNumber {
    constructor(initialValue: number = 0) {
        this._value = initialValue;
    }

    private _value: number;

    public get value(): number {
        return this._value;
    }

    public set value(newValue: number) {
        this._value = newValue;
    }

    public increment(by: number = 1): void {
        this._value += by;
    }

    public decrement(by: number = 1): void {
        this._value -= by;
    }
}
