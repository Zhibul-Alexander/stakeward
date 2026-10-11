import { isAddress } from '@solana/kit';
import { aiPrompt, scanTransactionText } from '@stakeward/core';
import { LockKeyholeIcon, SearchIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useSearchParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { AskAi } from '@/components/product/ask-ai';
import { scanPromptFacts, TransactionCheck, verdictText, type TransactionCheckState } from '@/components/product/transaction-check';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n';

/**
 * /check (DECISIONS.md D126): paste a transaction from any site and see, from its bytes alone, whether it touches
 * stake accounts and how. Decoding runs in this browser with core `scanTransactionText`; the page makes no request
 * (nothing is sent, not even to Stakeward's own API) and renders everything it read as text. `?address=` fills
 * "Your wallet", whose role is then marked in each instruction.
 */
export function CheckPage() {
  const [params] = useSearchParams();
  const [text, setText] = useState('');
  const [wallet, setWallet] = useState(params.get('address') ?? '');
  const [textProblem, setTextProblem] = useState(false);
  const [walletProblem, setWalletProblem] = useState(false);
  const [state, setState] = useState<TransactionCheckState>({ status: 'idle' });
  const run = useRef(0);
  const ids = { text: useId(), textHint: useId(), textError: useId(), wallet: useId(), walletHint: useId(), walletError: useId() };

  const check = async () => {
    const walletText = wallet.trim();
    const walletAddress = walletText !== '' && isAddress(walletText) ? walletText : null;
    const walletOk = walletText === '' || walletAddress !== null;
    setWalletProblem(!walletOk);
    if (text.trim() === '') {
      setTextProblem(true);
      return;
    }
    setTextProblem(false);
    if (!walletOk) return;
    const id = ++run.current;
    setState({ status: 'checking' });
    const result = await scanTransactionText(text, { wallet: walletAddress });
    if (id !== run.current) return;
    if (result.ok) {
      setState({ status: 'ready', report: result.report });
      return;
    }
    if (result.code === 'empty') {
      setTextProblem(true);
      setState({ status: 'idle' });
      return;
    }
    // A private key or a recovery phrase never stays on screen.
    if (result.code === 'secret') setText('');
    setState({ status: 'error', code: result.code, detail: result.code === 'secret' ? '' : result.message });
  };

  return (
    <Page width="flow">
      <PageHeader title={t('check.title')} lead={t('check.lead')} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.text}>{t('check.inputLabel')}</Label>
          <Textarea
            id={ids.text}
            value={text}
            rows={6}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono break-all"
            aria-invalid={textProblem}
            aria-describedby={textProblem ? `${ids.textError} ${ids.textHint}` : ids.textHint}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          {textProblem ? (
            <p id={ids.textError} className="text-sm text-danger">
              {t('check.errors.empty')}
            </p>
          ) : null}
          <p id={ids.textHint} className="text-sm text-muted">
            {t('check.inputHint')}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.wallet}>{t('check.walletLabel')}</Label>
          <Input
            id={ids.wallet}
            value={wallet}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={walletProblem}
            aria-describedby={walletProblem ? `${ids.walletError} ${ids.walletHint}` : ids.walletHint}
            onChange={(event) => {
              setWallet(event.target.value);
            }}
          />
          {walletProblem ? (
            <p id={ids.walletError} className="text-sm text-danger">
              {t('check.walletInvalid')}
            </p>
          ) : null}
          <p id={ids.walletHint} className="text-sm text-muted">
            {t('check.walletHint')}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" className="w-full sm:w-fit" disabled={state.status === 'checking'}>
            <SearchIcon aria-hidden="true" />
            {t('check.submit')}
          </Button>
          <p className="flex items-center gap-2 text-sm text-muted">
            <LockKeyholeIcon aria-hidden="true" className="size-4 shrink-0" />
            {t('check.local')}
          </p>
        </div>
        <p className="text-sm text-muted">{t('check.neverSeed')}</p>
      </form>
      <Section title={t('check.resultTitle')}>
        <TransactionCheck state={state} />
        {state.status === 'ready' ? (
          <AskAi
            body={t('check.askAiBody')}
            prompt={aiPrompt({
              task: t('check.ai.task'),
              facts: scanPromptFacts(state.report),
              verdict: verdictText(state.report.risk),
            })}
          />
        ) : null}
      </Section>
    </Page>
  );
}
