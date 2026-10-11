import { describe, expect, it } from 'vitest';
import { AI_PROMPT_URL_MAX_CHARS, aiPrompt, aiPromptUrl } from './ai-prompt.ts';

describe('aiPrompt', () => {
  it('puts the task, the facts and the verdict in plain text with the safety rules', () => {
    const prompt = aiPrompt({ task: 'Explain this alert.', facts: [['Stake account', 'Abc'], ['Event', 'Unstaked']], verdict: 'Locked until 1 May 2027' });
    expect(prompt).toContain('Explain this alert.');
    expect(prompt).toContain('- Stake account: Abc\n- Event: Unstaked');
    expect(prompt).toContain('Stakeward says: Locked until 1 May 2027');
    expect(prompt).toContain('Do not ask for or mention typing any seed phrase');
  });

  it('leaves the verdict out when there is none', () => {
    expect(aiPrompt({ task: 'x', facts: [] })).not.toContain('Stakeward says');
  });
});

describe('aiPromptUrl', () => {
  it('opens the prompt in the chosen account', () => {
    expect(aiPromptUrl('chatgpt', 'a b')).toBe('https://chatgpt.com/?q=a%20b');
    expect(aiPromptUrl('claude', 'a&b')).toBe('https://claude.ai/new?q=a%26b');
  });

  it('cuts a long prompt on a line end', () => {
    const long = Array.from({ length: 2000 }, (_, index) => `line ${String(index)}`).join('\n');
    const url = aiPromptUrl('claude', long);
    const text = decodeURIComponent(url.slice('https://claude.ai/new?q='.length));
    expect(text.length).toBeLessThanOrEqual(AI_PROMPT_URL_MAX_CHARS + 20);
    expect(text.endsWith('\n[cut for length]')).toBe(true);
    expect(long.startsWith(text.replace('\n[cut for length]', ''))).toBe(true);
  });
});
