import { Logger } from '@btc-vision/logger';
import inspector from 'inspector';

export class Inspector extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly inspector: Disposable;
    private readonly session: inspector.Session;

    constructor() {
        super();

        this.inspector = inspector.open(0, 'localhost', false);
        this.session = new inspector.Session();

        this.session.connectToMainThread();

        this.session.post('Debugger.enable');

        this.logInspector();
    }

    public logInspector() {
        this.info(`Inspector URL: ${inspector.url()}`);
    }

    /** programmatically trigger a breakpoint */
    public pause(): void {
        this.session.post('Debugger.pause', (err) => {
            if (err) this.error(err.message);
        });
    }

    public dispose(): void {
        this.session.disconnect();
        inspector.close(); // disposes the port opened above
    }
}
