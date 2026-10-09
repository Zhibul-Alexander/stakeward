import { Progress } from '@stakeward/design-system';

// A DS state only: no product screen draws a progress bar (signing shows a spinner and words, waits show a countdown).

/** The value axis: empty, part-way and full; the primary fill on a subtle track, named by aria-label. */
export const Values = () => (
  <div className="flex max-w-md flex-col gap-4">
    <Progress value={0} aria-label="Progress" />
    <Progress value={40} aria-label="Progress" />
    <Progress value={100} aria-label="Progress" />
  </div>
);

/** With a visible label and value above the bar; the label names the bar through aria-labelledby. */
export const WithLabel = () => (
  <div className="flex max-w-md flex-col gap-2">
    <div className="flex items-center justify-between gap-2 text-sm">
      <span id="progress-with-label" className="font-medium">
        Progress
      </span>
      <span className="text-muted tabular-nums">40%</span>
    </div>
    <Progress value={40} aria-labelledby="progress-with-label" />
  </div>
);
