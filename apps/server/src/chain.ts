import type { Address, PublicClient, WalletClient } from 'viem';
import { hardhat } from 'viem/chains';
import { abi, clients, type ContractName } from '@pc/contracts';
import { Reason, type Deployment } from '@pc/shared';

/** Thin, typed-enough access layer over the deployed system for the issuer. */
export class Chain {
  readonly publicClient: PublicClient;
  readonly issuer: WalletClient;

  constructor(readonly deployment: Deployment) {
    const c = clients(deployment.rpcUrl);
    this.publicClient = c.publicClient;
    this.issuer = c.issuer;
  }

  get addresses() {
    return this.deployment.contracts;
  }

  read<T = unknown>(address: Address, name: ContractName, functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<T> {
    return this.publicClient.readContract({ address, abi: abi(name), functionName, args, blockNumber }) as Promise<T>;
  }

  /** Simulates (to surface typed reverts), sends as the issuer, and waits for the receipt. */
  async write(address: Address, name: ContractName, functionName: string, args: readonly unknown[]) {
    const account = this.issuer.account!;
    await this.publicClient.simulateContract({ address, abi: abi(name), functionName, args, account });
    const hash = await this.issuer.writeContract({ address, abi: abi(name), functionName, args, account, chain: hardhat });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${name}.${functionName} reverted`);
    return receipt;
  }

  async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.publicClient.request({ method: method as never, params: params as never }) as Promise<T>;
  }
}

/** Maps a contract custom error to the audit-trail reason code. */
export const ERROR_REASON: Record<string, Reason> = {
  StaleRegistryRoot: Reason.StaleRegistryRoot,
  RecipientNotEligible: Reason.RecipientNotEligible,
  MaxBalanceExceeded: Reason.MaxBalance,
  InvalidProof: Reason.InvalidProof,
  ProofRequired: Reason.ProofRequired,
  ProofTimestampOutOfRange: Reason.InvalidProof,
  AuditEnvelopeRequired: Reason.AuditEnvelopeMissing,
};

export { revertErrorName as revertNameOf } from '@pc/contracts';
