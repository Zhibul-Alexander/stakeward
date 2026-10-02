export const SOURCE_CODE_URL = 'https://github.com/Zhibul-Alexander/stakeward';

export function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-neutral-900">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">Stakeward</h1>
        <p className="text-lg text-neutral-700">
          Lock your natively staked SOL with a second key you control, so a stolen wallet key cannot withdraw it.
        </p>
        <p className="font-medium">Coming soon</p>
      </main>
      <footer className="mx-auto flex w-full max-w-xl flex-wrap gap-x-4 gap-y-1 px-4 py-6 text-sm text-neutral-600">
        <a className="underline underline-offset-4 hover:text-neutral-900" href={SOURCE_CODE_URL}>
          Source code
        </a>
        <span>No warranty. MIT license.</span>
      </footer>
    </div>
  );
}
