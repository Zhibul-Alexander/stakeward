import { AskAi, alertEventText, alertLockEndText, alertStatusText, alertTimeText, scanPromptFacts, verdictText } from '@stakeward/design-system';
import { aiPrompt } from '@stakeward/core';
import { SAMPLE, SAMPLE_SCANS } from '../../apps/web/src/pages/dev-ui/samples';

const watched = {
  address: SAMPLE.stakeA,
  roles: ['main' as const],
  lockUntil: 1_807_315_200n,
  lock: 'in-force' as const,
  daysLeft: 183,
  lamports: 1_250_500_000_000n,
  state: 'delegated' as const,
};

// The question is built as each page builds it (core aiPrompt): public facts only, the page's verdict last.

/** Under /check's result: its own line under the title, the question from the bytes the page read. */
export const OnCheckPage = () => (
  <AskAi
    body="Opens this question in your own ChatGPT or Claude account, with what this page found. Stakeward sends nothing, stores nothing and holds no AI key. The AI only explains; this page's reading of the bytes stays the truth."
    prompt={aiPrompt({
      task: 'Explain in plain words what this Solana transaction would do to my stake, and whether I should sign it.',
      facts: scanPromptFacts(SAMPLE_SCANS.danger),
      verdict: verdictText(SAMPLE_SCANS.danger.risk),
    })}
  />
);

/** Under "About this alert" (also after /app's Protection check and on /proof): the default line under the title. */
export const AfterAlert = () => (
  <AskAi
    prompt={aiPrompt({
      task: 'Explain what this stake alert means for me and what I should do now.',
      facts: [
        ['Event', `${alertEventText('DEACTIVATED')} (DEACTIVATED)`],
        ['Stake account', SAMPLE.stakeA],
        ['Seen at', alertTimeText(new Date(1_791_504_000_000 - 25 * 60_000))],
        ['Current status', alertStatusText(watched)],
        ['Lock ends', alertLockEndText(watched)],
      ],
    })}
  />
);
