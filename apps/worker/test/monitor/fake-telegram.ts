// A scripted Telegram Bot API for the monitor tests: records every sendMessage and answers by script, per chat or
// in order of arrival, 200 by default.

export type TelegramReply = 200 | 403 | 400 | 429 | 500 | 401 | 404 | 'hang' | 'network-error';

export type TelegramRequest = {
  token: string;
  method: string;
  chatId: string;
  text: string;
  button: { label: string; url: string } | null;
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

export class FakeTelegram {
  readonly requests: TelegramRequest[] = [];
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
    const json = JSON.parse(body) as {
      chat_id: string | number;
      text: string;
      link_preview_options?: { is_disabled?: boolean };
      reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
    };
    const chatId = String(json.chat_id);
    const reply = this.replyFor(chatId);
    const key = json.reply_markup?.inline_keyboard[0]?.[0];
    this.requests.push({
      token,
      method,
      chatId,
      text: json.text,
      button: key === undefined ? null : { label: key.text, url: key.url },
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

  private replyFor(chatId: string): TelegramReply {
    return this.perChat.get(chatId)?.shift() ?? this.queue.shift() ?? this.always.get(chatId) ?? this.always.get('*') ?? 200;
  }
}
