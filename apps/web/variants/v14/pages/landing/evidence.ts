/**
 * The test record behind the landing page's claims: docs/gate.md as of the runs below (scripts/gate.ts against the real
 * stake program). Signatures are copied from that file; LiteSVM runs locally and has no explorer link. Nothing here is
 * computed or estimated: change it only when docs/gate.md changes.
 */

export type Network = 'litesvm' | 'devnet' | 'mainnet';

export const RUNS: Readonly<Record<Network, { label: string; matched: number; total: number; date: string }>> = {
  litesvm: { label: 'LiteSVM', matched: 31, total: 31, date: '11 October 2026' },
  devnet: { label: 'Devnet', matched: 28, total: 28, date: '11 October 2026' },
  mainnet: { label: 'Mainnet', matched: 8, total: 8, date: '5 October 2026' },
};

/** The stake program binary every run used (sha256 of the ELF, docs/gate.md). */
export const PROGRAM = { release: 'program@v5.1.0', sha256: '3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c' };

/** Network fees of the whole mainnet run, 8 transactions (docs/gate.md). */
export const MAINNET_RUN_FEES = '0.0000648 SOL';

export const SIGNATURES: Readonly<Record<string, { devnet?: string; mainnet?: string }>> = {
  '1a': { devnet: '2CGTDpBiFeTn2PRUk7PxehTdUrDPAHb43BJt9RLPcsdXzFWZBuzfnrZNRFJm1RcCXok9YgM9qtXV5aWrvh2iP8ki', mainnet: '2bh5rdCVCmaB1pf2U9gw5M66F1pkxukEicUbFSpHL3FVXWFhh8poHggTVTmsLAHA3p9NiBohshZuHaWpoX6CS4Qt' },
  '1b': { devnet: '3EFRQUTZFXGfW3G1kvcjUdDAdtT1u3HRFfoocN8JLKoYaSV3JFRXNJrcRDrmWvomwvHTmEyB8NMjiVnvKN8RVS9n' },
  '2': { devnet: '5LfkB1NhXRLuFd2NvQJNsu6mfJ6HVC6sw3Nz8BYrbePRHmGXb853pUQZixJ5xfQVrTE1SsCQPjsM5EUmPpLHr1tm', mainnet: '5w6kvDNJMs83Hb33ZaWS6fo2oSFq1jvazZvCcFfdjAppa7a7nXUGGeUwS2PbxSd9A8NK7Jer14XcSvUGaWNCpt9W' },
  '3': { devnet: '3GiK6b9WCSsm9ZNTeLazZ8zTDXSqZbugmznB8XpSP1qLFYFw3LsJA2sLNtjE7cJLbrxpoo8wzo7G8zdChb84ADDd', mainnet: 'AntzPaGpqwGtJ2cuBDwkUyG8Rqi4UwusuRJbrQA3v7qWwmS66hez8SMHuC5Zy1EE9tq64H54EVVsp3bthETjLVw' },
  '4': { devnet: '4SSXi4hEi4x37Wo4ZxoLbhoZDUvDbPVD8nEJAZtRfnif39sgvEE1hQ9cWdv8qjLLZzzW73MkH96F5kbFiHdhHV1M', mainnet: '5Qxos9NKwaPu8Ci9eZpjktgfKN31Exktjn9rGmj4UbDiubBTfCoGb3yhDCy71noKoB8wqkviks8A4Lyqja1zLUZo' },
  '5': { devnet: '332ZxKL2kuUxN2XGYUAxq7oimp21wuohi59eRDQSXEfgBGSGdoaQjE3sss9djR1idZSPKUbJZDavZBnWh4m1ruNH', mainnet: '2M29CjDvd2SZLPWoupbdPetQTNXGZTQbiUEMW183Gpx9rfQ12gvkYb7UHpefpwgeqAx8aF6BD1KTimYxPvyfb15r' },
  '6': { devnet: 'SZQ8z1daX12dcaYCark3vGoNfWZUifwgDqaJGsMVVzL3TUfywQrJsFgRTV9mLKDK1EyrJ8JVQtJejVdxkrxUtnT', mainnet: '5hPWGAurhptWxaNNn68Zau5h9LkMXxgXDsj1ZDqnie6yD19Lmpi2GHsdP2jJivJRyZx782Rr6LSjWGS7rxy7AiQ2' },
  '7a': { devnet: '5DAmyEjLtBCMTAgJcu8RKCa8qaG1iBAaCHRLSj49mPqyhHYK4NiF5vPBrAW9jEZ2znJTN9C254EUoYWcNgGgKQub' },
  '7b': { devnet: '3VkRTbCvJHk263mHzGmXfQiviZ5S4RP8kAt32FNvZN5hg8CRwUeASdKgWF1PV9xQZhoLaRy5VnST8xwN9pcJbvaM' },
  '8a': { devnet: 'kuMiDWeEHjAUpxaHb6sE5KWE5obyQyG23XsmNuSubYz3CE8WjJMYhmympXmjp9S1oaAX2z5QqCVAmnDqEi6SVXz' },
  '8b': { devnet: '5KVLQQmyj4qADYM8JfbVNJYsY3Tm8r9KhrXE9xaCeDPvvSx2rUwku2EBpCzgQa8k8MdXif7WGyMoTCRaHmd4DYmj' },
  '9': { devnet: '67cAp36ZnFrG3JQ9JfLrbXwzUzcEv83LnYvNdyE9GV5gQSLBvYumvuNUK9K42KrZDWfTKvRJfdPifr1AT7UiZ2TC' },
  '10': { devnet: '8uQsaseaZyt7VWQxw8Lx4zYQBhA5cAEURravxDdUWFbFyGNfRiGg15yw1JHK2QCwgfaGJ9HoipCRQCNctxx9HLb' },
  '11a': { devnet: '445sQdWgaNwnviyTqA7XCzAuUojuxL34dK2KXXwPXUtHymTWgHsafam8K8W51M4jGFUMd7nEfEb4VFYCF4nAbdUL' },
  '11b': { devnet: '3NjQXo39vFKowEsAyMrCNtMxKJ88KYbGgH7fsFSqZoBj77eDKkRSDzBsSPwdWBtinqVou5MsgFLf1fqjhyaJ6hJQ' },
  '11c': { devnet: '3bAAB6kyBG2g5j4PgUAm2sj1zKZRAD9ngpjdwm78M2MwiEfiGYWQzK5rQefN7j5yDsfgXBfiwWabZgvWKsFycYLc' },
  '12a': { devnet: '4d1MRoLwohi9MCWcffyxGZV2VMRm8TwZeTjz3AtZW8kTDM5Uwmaig8CEyoGpXv53EbF43RmyBUZxgvgY1jYn6VMP' },
  '12b': { devnet: '44chhSnfopMNHNvBqmWBDphvZ4MVLfsCui8wkbSjQXt3vYtA8uGGK9i6LsMLwK2aMmSZua7VQseRjCfKNsfwSyPi' },
  '12c': { devnet: '2a28Wv7mjF6horebVFsyxE9gft8YDdH5xZRiBmHPqnmwb6Vn6sWhGfjzatkqFL5vqYB2uSizk7EpshUCPP8HoxQ7' },
  '13a': { devnet: 'TUqgKuTTLG7eWFncW1CPtJFnHvYpDaMqdV2SBje5t1Eyg8o24FjUy2PpBfAemNnAkveTsKhb4tiAnk2fVkv1a6S', mainnet: '3PzifCBLEpsh27coif52rukB1oic57kBg1QVRaLnqhcWJBxoa5HooQFba8RwNeKoX9KTsoGRMYt9khdo9bTSr4fB' },
  '13b': { devnet: '5dmVJLTnGizp48LCunJZG2hCCUr84jKe1YoF3Pwg1Kzh7yYP6VyqKkzA6kWkkVzxCtrTCrVmajVxpgVYT4EXjDTc', mainnet: 'u4ivXqSoCSjfNwRqYVLoaEfSs9zXdUyggVPPEeAeSRxRkopw6VkQKtREtjtMa4gyzCArMUV2WwEsRNhzrCxWhg1' },
  '15a': { devnet: 'Vbuq8MwmtKutUhTkPwXq5yXaqk8bS9XWiemnWZzpFgzwRY14iSyMA9o6SVhrD5yUHLfSzSrgH9b5KgFQsqfjbZE' },
  '15b': { devnet: '5Qwd9K8YN4abi1KjX55EMYgiX8Ryy7z1MWZad3BxJPTiAjKEDh2oEp3VEVyupWN3oN2bj5drP471a9Mc6N3a7EAo' },
  '15c': { devnet: '66i46NuK29HZNqXgzgRnCAL8S76MehhQNmA1NwufXVUfez2nJ8xmMNu6co9ftguvTDFAGYZ4kebDcrUxGzAXtTva' },
  '15d': { devnet: '3774SFAsHWxGbS7JDc4XsFQT42oVNKajqejNSt3uqM6xowVxfSrQanXL659eBsoq3M6XLyytJg4htB4UmERCTscF' },
  '15e': { devnet: '4VC1KsEzdhLVTaWYsayeErYnFTDTkKjL16HEnVLg16ekWFNSfSuXqxKtLeygjRB2Btf8C344kew1NASDo2W3mbSu' },
  '15f': { devnet: '3WKdntk7nsyx17CgpW4eRD96DqEmZwHpbiz4TNXfqTaj9ekoJrk6rL4sttxyzPLY7ZN6seQKZdA1qwvM5eJNzuak' },
  '15g': { devnet: 'n9E95S3mopFwy4ZjtwQHn91Yc228giimDxaftiuh7oYEM2xf5QXajTprdkoifuLuvkBG1f2M23Gc8nF1R71MgHH' },
};

export type Check = {
  id: string;
  /** What was tried, in the site's words (Main key, Second key, New wallet). */
  tried: string;
  /** `rejected`: the program refused, with `error`. `accepted`: the transaction went through. */
  outcome: 'rejected' | 'accepted';
  /** The stake program's error, as docs/gate.md records it. */
  error?: string;
  /** Networks this check ran on. Every check ran on LiteSVM. */
  on: readonly Network[];
};

const ALL: readonly Network[] = ['litesvm', 'devnet', 'mainnet'];
const NO_MAINNET: readonly Network[] = ['litesvm', 'devnet'];

export const CHECKS: Readonly<Record<string, Check>> = {
  '2': { id: '2', tried: 'Turn on the lock of an existing stake account. Main key and Second key sign together.', outcome: 'accepted', on: ALL },
  '3': { id: '3', tried: 'Withdraw all SOL, signed by the Main key alone.', outcome: 'rejected', error: 'LockupInForce', on: ALL },
  '4': { id: '4', tried: "Make the thief's wallet the new owner. Main key and thief sign, no Second key.", outcome: 'rejected', error: 'CustodianMissing', on: ALL },
  '5': { id: '5', tried: 'Remove the lock, signed by the Main key alone.', outcome: 'rejected', error: 'MissingRequiredSignature', on: ALL },
  '6': { id: '6', tried: 'Move the lock end one hour later, signed by the Second key alone.', outcome: 'accepted', on: ALL },
  '7a': { id: '7a', tried: 'Stop the stake earning, signed by the Main key alone.', outcome: 'accepted', on: NO_MAINNET },
  '7b': { id: '7b', tried: "Make the thief's wallet the staking key. Main key and thief sign.", outcome: 'accepted', on: NO_MAINNET },
  '8a': { id: '8a', tried: 'Split the locked account in two. The new part comes out with the same lock.', outcome: 'accepted', on: NO_MAINNET },
  '8b': { id: '8b', tried: 'Withdraw the split-off part, signed by the Main key alone.', outcome: 'rejected', error: 'LockupInForce', on: NO_MAINNET },
  '9': { id: '9', tried: 'Merge an unlocked account with the same keys into the locked one.', outcome: 'rejected', error: 'MergeMismatch', on: NO_MAINNET },
  '10': { id: '10', tried: 'Withdraw 0.25 SOL. Main key and Second key sign together.', outcome: 'accepted', on: NO_MAINNET },
  '11a': { id: '11a', tried: 'Rescue: Main key, Second key and a New wallet hand both keys of the stake to the New wallet.', outcome: 'accepted', on: NO_MAINNET },
  '11b': { id: '11b', tried: 'After the rescue, withdraw with the old Main key and the Second key.', outcome: 'rejected', error: 'MissingRequiredSignature', on: NO_MAINNET },
  '12b': { id: '12b', tried: 'The same rescue signed one key at a time, carried between signers as a /cosign link.', outcome: 'accepted', on: NO_MAINNET },
  '13a': { id: '13a', tried: 'End the lock early, signed by the Second key.', outcome: 'accepted', on: ALL },
  '13b': { id: '13b', tried: 'Then withdraw everything, signed by the Main key alone.', outcome: 'accepted', on: ALL },
  '14c': { id: '14c', tried: 'After the end date (clock moved forward), withdraw with the Main key alone.', outcome: 'accepted', on: ['litesvm'] },
  '15a': { id: '15a', tried: 'Change the owner with the older, unchecked Authorize instruction. No Second key.', outcome: 'rejected', error: 'CustodianMissing', on: NO_MAINNET },
  '15b': { id: '15b', tried: "Change the owner with the thief's key in the Second key's place.", outcome: 'rejected', error: 'LockupInForce', on: NO_MAINNET },
  '15c': { id: '15c', tried: 'Change the owner through AuthorizeWithSeed. No Second key.', outcome: 'rejected', error: 'CustodianMissing', on: NO_MAINNET },
  '15d': { id: '15d', tried: 'Change the owner through AuthorizeCheckedWithSeed. No Second key.', outcome: 'rejected', error: 'CustodianMissing', on: NO_MAINNET },
  '15e': { id: '15e', tried: "Withdraw with the thief's key in the Second key's place.", outcome: 'rejected', error: 'LockupInForce', on: NO_MAINNET },
  '15f': { id: '15f', tried: 'Move 0.01 SOL into an unlocked account with the same keys.', outcome: 'rejected', error: 'MergeMismatch', on: NO_MAINNET },
  '15g': { id: '15g', tried: 'Move the stake itself into that unlocked account.', outcome: 'rejected', error: 'MergeMismatch', on: NO_MAINNET },
};

export type Claim = { id: string; claim: string; note?: string; checks: readonly string[] };
export type ClaimGroup = { id: string; title: string; intro: string; claims: readonly Claim[] };

export const GROUPS: readonly ClaimGroup[] = [
  {
    id: 'record-stops',
    title: 'With only your main key, a thief cannot',
    intro: 'Each attempt was sent to the stake program on purpose. The program refused it with the error shown.',
    claims: [
      { id: 'withdraw', claim: 'Withdraw your SOL.', checks: ['3', '8b'] },
      { id: 'owner', claim: 'Make another wallet the owner of the stake.', note: 'Four different instructions were tried.', checks: ['4', '15a', '15c', '15d'] },
      { id: 'unlock', claim: 'Remove or shorten the lock.', checks: ['5'] },
      { id: 'fake', claim: 'Sign with their own key in place of your second key.', checks: ['15b', '15e'] },
      { id: 'around', claim: 'Get around the lock by splitting, merging or moving SOL.', checks: ['9', '15f', '15g', '8a'] },
    ],
  },
  {
    id: 'record-works',
    title: 'With the right keys, you can',
    intro: 'The other side of the same lock: these went through.',
    claims: [
      { id: 'existing', claim: 'Lock a stake account you already have.', note: 'This is what Stakeward rests on. It was the first check run on every network.', checks: ['2'] },
      { id: 'both', claim: 'Withdraw, with both keys signing together.', checks: ['10'] },
      { id: 'rescue', claim: 'Move the stake to a New wallet if your main key is stolen.', note: 'After the move, the old main key no longer works.', checks: ['11a', '11b', '12b'] },
      { id: 'early', claim: 'End the lock early with your second key, then withdraw with the main key.', checks: ['13a', '13b'] },
      { id: 'expiry', claim: 'Withdraw with the main key alone once the end date has passed.', checks: ['14c'] },
    ],
  },
  {
    id: 'record-limits',
    title: 'What the lock does not stop',
    intro: 'Tested the same way. These went through, because the stake program allows them.',
    claims: [
      { id: 'deactivate', claim: 'A thief with your main key can stop your stake earning.', checks: ['7a'] },
      { id: 'staker', claim: 'They can also take the staking key. Your SOL stays locked.', checks: ['7b'] },
      { id: 'freeze', claim: 'Whoever holds your second key can move the lock date on their own.', note: 'So they can keep your stake frozen, even for years. Keep the second key as safe as the main key.', checks: ['6'] },
    ],
  },
];

/** The check shown at the top of the page: the main claim, on mainnet. */
export const HERO_CHECK = '3';
