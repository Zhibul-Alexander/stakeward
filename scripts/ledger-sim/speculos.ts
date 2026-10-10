// Minimal client for the Speculos REST API (https://speculos.ledger.com/user/api.html) and the Solana app's APDUs
// (LedgerHQ/app-solana doc/api.md). Only what the Ledger simulation needs: read a public key, sign a message while
// reading every screen the device shows, approve or reject.

const CLA = 0xe0;
const INS_GET_PUBKEY = 0x05;
const INS_SIGN_MESSAGE = 0x06;
const P1_NON_CONFIRM = 0x00;
const P1_CONFIRM = 0x01;
const P2_EXTEND = 0x01;
const P2_MORE = 0x02;
const MAX_CHUNK = 255;

export type ScreenEvent = { text: string; x: number; y: number };
export type Button = 'left' | 'right' | 'both';

export type SpeculosClient = {
  /** Text lines of the screen shown now (no waiting). */
  currentScreen(): Promise<string[]>;
  press(button: Button): Promise<void>;
  getPubkey(path: string): Promise<Uint8Array>;
  /** Sends the message, then calls `drive` with the device; resolves with the status word and response data. */
  signMessage(path: string, message: Uint8Array, drive: (device: Device) => Promise<void>): Promise<ApduResult>;
};

export type ApduResult = { status: number; data: Uint8Array };

export type Device = {
  /** Text lines of the screen currently shown (waits until it settles). */
  screen(): Promise<string[]>;
  press(button: Button): Promise<void>;
  /** True once the APDU answered (the device left the review). */
  answered(): boolean;
};

export function speculosClient(baseUrl: string): SpeculosClient {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Speculos ${path}: HTTP ${String(response.status)}`);
    return response.json() as Promise<{ data?: string }>;
  };

  const apdu = async (ins: number, p1: number, p2: number, data: Uint8Array): Promise<ApduResult> => {
    const bytes = Uint8Array.of(CLA, ins, p1, p2, data.length, ...data);
    const { data: hex = '' } = await post('/apdu', { data: Buffer.from(bytes).toString('hex') });
    const raw = Buffer.from(hex, 'hex');
    return { status: raw.readUInt16BE(raw.length - 2), data: new Uint8Array(raw.subarray(0, raw.length - 2)) };
  };

  const currentScreen = async (): Promise<string[]> => {
    const response = await fetch(`${baseUrl}/events?currentscreenonly=true`);
    const { events } = (await response.json()) as { events: ScreenEvent[] };
    return events.map((event) => event.text);
  };

  const press = async (button: Button) => {
    await post(`/button/${button}`, { action: 'press-and-release' });
  };

  return {
    currentScreen,
    press,
    async getPubkey(path) {
      const result = await apdu(INS_GET_PUBKEY, P1_NON_CONFIRM, 0, serializePath(path));
      if (result.status !== 0x9000) throw new Error(`GET_PUBKEY: status ${result.status.toString(16)}`);
      return result.data;
    },

    async signMessage(path, message, drive) {
      const chunks = [serializeSigners(path)];
      for (let offset = 0; offset < message.length; offset += MAX_CHUNK) chunks.push(message.subarray(offset, offset + MAX_CHUNK));
      // All chunks but the last carry P2_MORE, all but the first P2_EXTEND (tests/application_client/solana.py).
      const lastChunk = chunks.pop() ?? new Uint8Array();
      for (const [index, chunk] of chunks.entries()) {
        const p2 = P2_MORE | (index > 0 ? P2_EXTEND : 0);
        const result = await apdu(INS_SIGN_MESSAGE, P1_CONFIRM, p2, chunk);
        if (result.status !== 0x9000) return result;
      }
      let done = false;
      const last = apdu(INS_SIGN_MESSAGE, P1_CONFIRM, chunks.length > 0 ? P2_EXTEND : 0, lastChunk).finally(() => {
        done = true;
      });
      const device: Device = {
        async screen() {
          let previous = '';
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await sleep(100);
            const lines = await currentScreen();
            const key = lines.join('\n');
            if (lines.length > 0 && key === previous) return lines;
            previous = key;
          }
          return previous === '' ? [] : previous.split('\n');
        },
        press,
        answered: () => done,
      };
      await Promise.all([last, drive(device)]);
      return last;
    },
  };
}

/** "44'/501'/0'" -> count byte + big-endian indices, hardened where marked. */
export function serializePath(path: string): Uint8Array {
  const parts = path.replace(/^m\//, '').split('/');
  const out = Buffer.alloc(1 + 4 * parts.length);
  out[0] = parts.length;
  parts.forEach((part, index) => {
    const hardened = part.endsWith("'");
    const value = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    out.writeUInt32BE((hardened ? 0x80000000 : 0) + value, 1 + 4 * index);
  });
  return new Uint8Array(out);
}

function serializeSigners(path: string): Uint8Array {
  return Uint8Array.of(1, ...serializePath(path));
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
