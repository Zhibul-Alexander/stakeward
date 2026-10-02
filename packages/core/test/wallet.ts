// Test-only in-memory wallet: the shape of a WalletPort (an address and "sign these transactions"), backed by a
// CryptoKeyPair that lives only in test memory. Never imported by product code.
import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';

export type TestWallet = {
  readonly address: Address;
  readonly signer: KeyPairSigner;
  /** Adds this wallet's signature to each wire transaction and returns the new wire bytes. */
  signTransactions(transactions: readonly Uint8Array[]): Promise<Uint8Array[]>;
};

export function testWallet(signer: KeyPairSigner): TestWallet {
  return {
    address: signer.address,
    signer,
    async signTransactions(transactions) {
      return Promise.all(
        transactions.map(async (bytes) => {
          const signed = await partiallySignTransaction([signer.keyPair], getTransactionDecoder().decode(bytes));
          return new Uint8Array(getTransactionEncoder().encode(signed));
        }),
      );
    },
  };
}

export async function newTestWallet(): Promise<TestWallet> {
  return testWallet(await generateKeyPairSigner());
}
