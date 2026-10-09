# Stake program build for LiteSVM tests

`stake-v5.1.0.so` is the stake program ELF that mainnet and devnet run (DECISIONS.md D4). LiteSVM 1.5.0 bundles the
older v5.0.0, so the test harness (`test/svm.ts`) loads this file over it.

- Source: https://github.com/solana-program/stake/releases/download/program%40v5.1.0/solana_stake_program.so
- Size: 212056 bytes
- sha256: `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`

On 2026-10-02 the release asset, the mainnet programdata (deploy slot 443232000) and the devnet programdata
(deploy slot 488592000), each with the 45-byte programdata header removed, had this same hash.
`test/svm.test.ts` checks the hash before the file is used.

When the program is upgraded on mainnet (the programdata deploy slot changes), replace the file and the hash.
