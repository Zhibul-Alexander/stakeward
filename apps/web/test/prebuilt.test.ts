// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PREBUILT_CLUSTER_VAR, PREBUILT_DIST_VAR, prebuiltDist } from './support/prebuilt.ts';

describe('prebuiltDist: the build the deploy wrapper hands to the build guards', () => {
  const root = mkdtempSync(join(tmpdir(), 'stakeward-prebuilt-'));
  const dist = join(root, 'dist');
  const empty = join(root, 'empty');
  mkdirSync(dist);
  mkdirSync(empty);
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is null when neither variable is set (the tests build the site themselves)', () => {
    expect(prebuiltDist({})).toBeNull();
    expect(prebuiltDist({ [PREBUILT_DIST_VAR]: '', [PREBUILT_CLUSTER_VAR]: '' })).toBeNull();
  });

  it('returns the folder and its cluster', () => {
    expect(prebuiltDist({ [PREBUILT_DIST_VAR]: dist, [PREBUILT_CLUSTER_VAR]: 'mainnet' })).toEqual({
      dir: dist,
      cluster: 'mainnet',
    });
    expect(prebuiltDist({ [PREBUILT_DIST_VAR]: dist, [PREBUILT_CLUSTER_VAR]: 'devnet' })).toEqual({
      dir: dist,
      cluster: 'devnet',
    });
  });

  it('refuses one variable without the other instead of falling back to a fresh build', () => {
    expect(() => prebuiltDist({ [PREBUILT_DIST_VAR]: dist })).toThrow(PREBUILT_CLUSTER_VAR);
    expect(() => prebuiltDist({ [PREBUILT_CLUSTER_VAR]: 'mainnet' })).toThrow(PREBUILT_DIST_VAR);
  });

  it('refuses a cluster other than devnet or mainnet', () => {
    expect(() => prebuiltDist({ [PREBUILT_DIST_VAR]: dist, [PREBUILT_CLUSTER_VAR]: 'testnet' })).toThrow(
      'devnet or mainnet',
    );
  });

  it('refuses a relative path and a folder without index.html', () => {
    expect(() => prebuiltDist({ [PREBUILT_DIST_VAR]: 'dist', [PREBUILT_CLUSTER_VAR]: 'mainnet' })).toThrow('absolute');
    expect(() => prebuiltDist({ [PREBUILT_DIST_VAR]: empty, [PREBUILT_CLUSTER_VAR]: 'mainnet' })).toThrow('index.html');
  });
});
