// A scripted Telegram Bot API for the monitor tests: records every sendMessage and answers by script, per chat or
// in order of arrival, 200 by default. getWebhookInfo and getMe (the monitor's daily bot check) answer from
// `identity`, apart from the sendMessage scripts, and are recorded in `identityCalls`.

export type TelegramReply = 200 | 403 | 400 | 429 | 500 | 401 | 404 | 'hang' | 'network-error';

export type TelegramRequest = {
  token: string;
  method: string;
  chatId: string;
  text: string;
  /** A link button (`url`) or a rescue kit's callback button (`callbackData`). */
  button: { label: string; url?: string; callbackData?: string } | null;
  linkPreviewDisabled: boolean;
  reply: TelegramReply;
};

const DESCRIPTIONS: Partial<Record<TelegramReply, string>> = {
  400: 'Bad Request: chat not found',
  401: 'Unauthorized',
  403: 'Forbidden: bot was blocked by the user',
  404: 'Not Found',
  429: 'Too Many Requests: retry after 5',
  500: 'Internal Server Error',
};

/**
 * What getWebhookInfo and getMe report; `reply` other than 200 answers both with that error instead. `lastError`
 * is getWebhookInfo's last_error_date (unix s) and last_error_message, left out of the answer when not set.
 */
export type BotIdentityScript = {
  webhookUrl: string;
  username: string;
  reply: TelegramReply;
  lastError?: { date: number; message: string };
};

export class FakeTelegram {
  readonly requests: TelegramRequest[] = [];
  /** getWebhookInfo and getMe calls, in order. */
  readonly identityCalls: { token: string; method: string }[] = [];
  /** The test environment's own webhook and bot (vitest.config.ts) unless a test changes it. */
  identity: BotIdentityScript = {
    webhookUrl: 'https://stakeward.test/api/telegram/webhook',
    username: 'stakeward_test_bot',
    reply: 200,
  };
  private readonly perChat = new Map<string, TelegramReply[]>();
  private readonly always = new Map<string, TelegramReply>();
  private readonly queue: TelegramReply[] = [];
  private messageId = 0;

  /** The next requests to `chatId` get `replies`, one each, in order. */
  replyTo(chatId: string, ...replies: TelegramReply[]): void {
    this.perChat.set(chatId, [...(this.perChat.get(chatId) ?? []), ...replies]);
  }

  /** The next requests to any chat get `replies` (after a chat's own script). */
  replyNext(...replies: TelegramReply[]): void {
    this.queue.push(...replies);
  }

  /** Once the scripts are used up, `chatId` ('*' = every chat) always gets `reply`. */
  replyAlways(chatId: string, reply: TelegramReply): void {
    this.always.set(chatId, reply);
  }

  /** Messages Telegram took (200) for `chatId`, or for every chat. */
  delivered(chatId?: string): TelegramRequest[] {
    return this.requests.filter((r) => r.reply === 200 && (chatId === undefined || r.chatId === chatId));
  }

  async handle(url: URL, body: string, signal: AbortSignal | null | undefined): Promise<Response> {
    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    if (match === null) throw new Error(`FakeTelegram: unexpected path ${url.pathname}`);
    const [, token = '', method = ''] = match;
    if (method === 'getWebhookInfo' || method === 'getMe') return this.identityAnswer(token, method);
    const json = JSON.parse(body) as {
      chat_id: string | number;
      text: string;
      link_preview_options?: { is_disabled?: boolean };
      reply_markup?: { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };
    };
    const chatId = String(json.chat_id);
    const reply = this.replyFor(chatId);
    const key = json.reply_markup?.inline_keyboard[0]?.[0];
    this.requests.push({
      token,
      method,
      chatId,
      text: json.text,
      button:
        key === undefined
          ? null
          : key.callback_data !== undefined
            ? { label: key.text, callbackData: key.callback_data }
            : { label: key.text, url: key.url ?? '' },
      linkPreviewDisabled: json.link_preview_options?.is_disabled === true,
      reply,
    });
    await Promise.resolve();

    if (reply === 'network-error') throw new TypeError('Network connection lost');
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    }
    if (reply === 200) {
      this.messageId += 1;
      return Response.json({ ok: true, result: { message_id: this.messageId, chat: { id: Number(chatId) }, text: json.text } });
    }
    return Response.json({ ok: false, error_code: reply, description: DESCRIPTIONS[reply] ?? 'Error' }, { status: reply });
  }

  private async identityAnswer(token: string, method: string): Promise<Response> {
    this.identityCalls.push({ token, method });
    await Promise.resolve();
    const { reply } = this.identity;
    if (reply === 'network-error') throw new TypeError('Network connection lost');
    if (reply === 'hang') return new Promise<Response>(() => undefined);
    if (reply !== 200) {
      return Response.json({ ok: false, error_code: reply, description: DESCRIPTIONS[reply] ?? 'Error' }, { status: reply });
    }
    const result =
      method === 'getMe'
        ? { id: 123456789, is_bot: true, first_name: 'Stakeward', username: this.identity.username, can_join_groups: false }
        : {
            url: this.identity.webhookUrl,
            has_custom_certificate: false,
            pending_update_count: 0,
            max_connections: 40,
            ...(this.identity.lastError === undefined
              ? {}
              : { last_error_date: this.identity.lastError.date, last_error_message: this.identity.lastError.message }),
          };
    return Response.json({ ok: true, result });
  }

  private replyFor(chatId: string): TelegramReply {
    return this.perChat.get(chatId)?.shift() ?? this.queue.shift() ?? this.always.get(chatId) ?? this.always.get('*') ?? 200;
  }
}
