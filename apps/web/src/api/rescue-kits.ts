import type { Address, Signature } from '@solana/kit';

/**
 * The worker's one-tap rescue kits (D118): POST /api/rescue-kits stores a fully signed rescue of one stake account and
 * answers with a one-time Telegram link; GET /api/rescue-kits?account= tells where it stands. Only the chat that opened
 * that link can send the kit (the alert's Rescue now), and the monitor sends it by itself when the staker changes. The
 * bytes can only move the stake to the owner's own new wallet; the worker checks every one against the chain first.
 */
export type RescueKitStatus = {
  stakeAccount: Address;
  status: 'none' | 'ready' | 'sent' | 'stale';
  newWallet: Address | null;
  signature: Signature | null;
  /** Unix ms. */
  sentAt: number | null;
  /** A chat opened the kit's one-time Telegram link. */
  telegramLinked: boolean;
  /** When the monitor sends the kit by itself (D120); null without a kit. Set from the linked chat's /kits. */
  autoMode: 'off' | 'staker' | 'any' | null;
};

export type StoredRescueKit = {
  /** `https://t.me/<bot>?start=kit-<secret>`: links this kit to the chat that opens it, once. Null without a bot. */
  telegramUrl: string | null;
};

export type RescueKitPort = {
  /** Rejects with RescueKitHttpError when the worker refuses the bytes (its `error` code tells why). */
  store(transaction: Uint8Array): Promise<StoredRescueKit>;
  status(stakeAccount: Address): Promise<RescueKitStatus>;
};

/** The worker answered with a status other than 200; `code` is its `error` field (`http-<status>` without one). */
export class RescueKitHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RescueKitHttpError';
    this.status = status;
    this.code = code;
  }
}

const URL_BASE = '/api/rescue-kits';
/** The worker reads the chain and simulates before it answers a store. */
const TIMEOUT_MS = 15_000;

export function createRescueKitPort(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): RescueKitPort {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  async function call(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
      timeout.name = 'TimeoutError';
      controller.abort(timeout);
    }, timeoutMs);
    try {
      const response = await fetchImpl(path, {
        ...init,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status !== 200) {
        const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        const code = typeof fields.error === 'string' && fields.error !== '' ? fields.error : `http-${String(response.status)}`;
        const message = typeof fields.message === 'string' ? fields.message : `HTTP ${String(response.status)}`;
        throw new RescueKitHttpError(response.status, code, message);
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async store(transaction) {
      const body = await call(URL_BASE, { method: 'POST', body: JSON.stringify({ transaction: toBase64(transaction) }) });
      const url = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).telegramUrl : null;
      return { telegramUrl: typeof url === 'string' && url.startsWith('https://t.me/') ? url : null };
    },
    async status(stakeAccount) {
      return parseStatus(await call(`${URL_BASE}?account=${encodeURIComponent(stakeAccount)}`, { method: 'GET' }));
    },
  };
}

const STATUSES: readonly RescueKitStatus['status'][] = ['none', 'ready', 'sent', 'stale'];

function parseStatus(body: unknown): RescueKitStatus {
  if (typeof body !== 'object' || body === null) throw new Error('Malformed rescue kit status');
  const b = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const status = STATUSES.find((s) => s === b.status);
  const stakeAccount = text(b.stakeAccount);
  if (status === undefined || stakeAccount === null) throw new Error('Malformed rescue kit status');
  return {
    stakeAccount: stakeAccount as Address,
    status,
    newWallet: text(b.newWallet) as Address | null,
    signature: text(b.signature) as Signature | null,
    sentAt: typeof b.sentAt === 'number' ? b.sentAt : null,
    telegramLinked: b.telegramLinked === true,
    autoMode: b.autoMode === 'off' || b.autoMode === 'staker' || b.autoMode === 'any' ? b.autoMode : null,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
