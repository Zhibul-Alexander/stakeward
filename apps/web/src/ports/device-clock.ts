/** This device's clock in unix seconds (whole seconds, rounded down). */
export type DeviceClock = () => bigint;

/** The system clock: what the browser says the time is. The production ports use it (createBrowserPorts). */
export const systemDeviceClock: DeviceClock = () => BigInt(Math.floor(Date.now() / 1000));
