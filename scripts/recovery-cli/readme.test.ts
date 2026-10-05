// README.md "## Recover without Stakeward": every command a reader copies from it is a recovery card command from
// core (recoveryCommands, the installer and the Ledger command), exactly and in the card's display form, so the README
// cannot drift from what the card prints and scripts/recovery-cli runs.
import { readFileSync } from 'node:fs';
import {
  commandDisplayLines,
  commandLine,
  INSTALL_CLI_COMMAND,
  LEDGER_PUBKEY_COMMAND,
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
/** The landing links to this heading's anchor (#recover-without-stakeward). */
const HEADING = '## Recover without Stakeward';
const FENCE = '```';

/** What the README shows: the card's templates for mainnet, with the main key's address as a placeholder. */
const EXPECTED: readonly (readonly string[])[] = [
  ...Object.values(recoveryCommands({ mainKeyAddress: RECOVERY_PLACEHOLDERS.mainKeyAddress, url: 'mainnet-beta' })),
  INSTALL_CLI_COMMAND,
  LEDGER_PUBKEY_COMMAND,
];

/** The lines from the heading up to the next level-2 heading. */
function sectionLines(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error(`README.md has no "${HEADING}" line`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The body of every ```sh block in the section. */
function shBlocks(lines: readonly string[]): string[] {
  const blocks: string[] = [];
  let body: string[] | null = null;
  for (const line of lines) {
    if (body === null) {
      if (line === `${FENCE}sh`) body = [];
    } else if (line === FENCE) {
      blocks.push(body.join('\n'));
      body = null;
    } else {
      body.push(line);
    }
  }
  if (body !== null) throw new Error('README.md: a ```sh block is not closed');
  return blocks;
}

/** A block as one command line: each ` \` line ending and the next line's indent become one space. */
function joinContinuations(block: string): string {
  return block.replace(/ \\\n\s*/g, ' ');
}

const SECTION = sectionLines(README);
const BLOCKS = shBlocks(SECTION);

describe('README: Recover without Stakeward', () => {
  it('has the heading exactly once', () => {
    expect(README.split('\n').filter((line) => line === HEADING)).toHaveLength(1);
  });

  it('opens every code block in the section as an unindented ```sh fence, so the check below sees all of them', () => {
    const fences = SECTION.filter((line) => line.trimStart().startsWith(FENCE));
    expect(fences.length).toBeGreaterThan(0);
    expect(fences.length % 2).toBe(0);
    for (const [index, fence] of fences.entries()) expect(fence).toBe(index % 2 === 0 ? `${FENCE}sh` : FENCE);
    expect(BLOCKS).toHaveLength(fences.length / 2);
  });

  it('holds exactly the card commands: none missing, none extra', () => {
    const shown = new Set(BLOCKS.map(joinContinuations));
    const expected = EXPECTED.map(commandLine);
    const missing = expected.filter((line) => !shown.has(line));
    const extra = [...shown].filter((line) => !expected.includes(line));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('shows each command in the card display form, one command per block', () => {
    for (const block of BLOCKS) {
      expect(joinContinuations(block)).not.toContain('\n');
      const argv = EXPECTED.find((candidate) => commandLine(candidate) === joinContinuations(block));
      expect(argv, block).toBeDefined();
      if (argv !== undefined) expect(block).toBe(commandDisplayLines(argv).join('\n'));
    }
  });

  it('names only the placeholders core fills', () => {
    const known = new Set<string>(Object.values(RECOVERY_PLACEHOLDERS));
    const named = SECTION.join('\n').match(/<[A-Z][A-Z_]*>/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((placeholder) => !known.has(placeholder))).toEqual([]);
  });
});

/** The lines of a level-3 subsection of "Recover without Stakeward". */
function subsection(heading: string): string {
  const start = SECTION.indexOf(`### ${heading}`);
  if (start === -1) throw new Error(`README.md has no "### ${heading}" line`);
  const end = SECTION.findIndex((line, index) => index > start && line.startsWith('### '));
  return SECTION.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

describe('README: the security advice a reader follows', () => {
  it('never offers another account on a Ledger the reader already has as a new seed phrase', () => {
    const stolen = subsection('Main key stolen');
    // Every account on one Ledger comes from its one seed phrase (CLAUDE.md section 1: seed phrases phished from
    // Ledger owners), so the new wallet must not share a device with the main key or the second key.
    expect(stolen).not.toMatch(/account you have never used/i);
    expect(stolen).not.toMatch(/second key and the new wallet on a Ledger/i);
    expect(stolen).toContain('each on its own Ledger');
    expect(stolen).toContain('Never use the Ledger that holds your main key or your second key');
  });

  it('says the thief with the main key is held back only while the lock holds', () => {
    const limits = subsection('What no one can undo');
    const thief = limits.split('\n').find((line) => line.startsWith('- A thief with only the main key'));
    expect(thief).toBeDefined();
    expect(thief).toContain('While the lock holds, they cannot withdraw');
  });
});
