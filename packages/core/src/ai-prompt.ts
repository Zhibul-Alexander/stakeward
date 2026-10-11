/**
 * "Ask your AI" (D122): Stakeward never calls an AI and holds no AI key. A page builds a plain-text prompt from public
 * data it already shows, and the person opens it in their own ChatGPT or Claude account, or copies it. The AI only
 * explains; what the screen says (from the bytes and the network) stays the truth.
 */

/** Longest prompt put into a link; past it the link carries a shortened prompt and Copy carries the whole. */
export const AI_PROMPT_URL_MAX_CHARS = 6000;

export type AiPromptInput = {
  /** What the person wants explained, one sentence, e.g. "Explain what this stake alert means for me." */
  task: string;
  /** Facts as label/value lines, public on-chain data only (addresses, amounts, dates, statuses). */
  facts: readonly (readonly [label: string, value: string])[];
  /** Stakeward's own verdict, if the screen shows one; the AI is told to explain it, not to override it. */
  verdict?: string | undefined;
};

const PREAMBLE = [
  'I use Stakeward, a non-custodial site that puts a Solana stake-program lockup on my native stake accounts.',
  'While the lock is in force, withdrawing SOL or changing the withdraw authority also needs the lockup custodian signature.',
  'In Stakeward words: "Main key" is my wallet (staker and withdrawer), "Second key" is the lockup custodian (my other wallet),',
  '"New wallet" is a fresh wallet used only to rescue the stake if the main key is stolen.',
  'A thief with only the main key can unstake, redelegate, split and change the staker, but cannot withdraw or take the withdraw authority.',
].join(' ');

const RULES = [
  'Answer in plain words, short, for a non-developer.',
  'Do not ask for or mention typing any seed phrase or private key anywhere.',
  'Do not tell me to sign anything you have not seen; if something looks wrong, tell me to stop and check on stakeward and on a block explorer.',
].join(' ');

/** The whole prompt: context, the facts, the verdict, the rules. Plain text, no markup. */
export function aiPrompt(input: AiPromptInput): string {
  const lines = [PREAMBLE, '', input.task, '', 'Facts (public on-chain data):'];
  for (const [label, value] of input.facts) lines.push(`- ${label}: ${value}`);
  if (input.verdict !== undefined) lines.push('', `Stakeward says: ${input.verdict}`);
  lines.push('', RULES);
  return lines.join('\n');
}

export type AiProvider = 'chatgpt' | 'claude';

const PROVIDER_URL: Record<AiProvider, string> = {
  chatgpt: 'https://chatgpt.com/?q=',
  claude: 'https://claude.ai/new?q=',
};

/** A link that opens the prompt in the person's own account. Over the limit, the prompt is cut on a line end. */
export function aiPromptUrl(provider: AiProvider, prompt: string): string {
  let text = prompt;
  if (text.length > AI_PROMPT_URL_MAX_CHARS) {
    const cut = text.slice(0, AI_PROMPT_URL_MAX_CHARS);
    const end = cut.lastIndexOf('\n');
    text = `${end > 0 ? cut.slice(0, end) : cut}\n[cut for length]`;
  }
  return PROVIDER_URL[provider] + encodeURIComponent(text);
}
