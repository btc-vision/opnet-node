declare global {
    namespace NodeJS {
        interface Global {
            gc: () => void;
        }
    }
}

export default global;
