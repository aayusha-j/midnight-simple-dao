import type { SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type {
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  ImportPrivateStatesResult,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

/**
 * A minimal in-memory private state store for the browser. The Simple DAO
 * contract has no witnesses, so its private state is always the empty object.
 *
 * IMPORTANT (privacy): secret member credentials and ballot choices are NOT
 * private-state material on this contract — they are one-shot circuit inputs.
 * This store is never populated with them, and nothing here is ever persisted.
 */
export class InMemoryPrivateStateProvider<PSI extends PrivateStateId, PS>
  implements PrivateStateProvider<PSI, PS>
{
  private readonly states = new Map<PSI, PS | null>();
  private readonly signingKeys = new Map<string, SigningKey>();
  private contractAddress: string | null = null;

  setContractAddress(address: string): void {
    this.contractAddress = address;
  }

  private requireAddress(): void {
    if (this.contractAddress === null) {
      throw new Error('setContractAddress must be called before private state access');
    }
  }

  async set(privateStateId: PSI, state: PS): Promise<void> {
    this.states.set(privateStateId, state);
  }

  async get(privateStateId: PSI): Promise<PS | null> {
    this.requireAddress();
    return this.states.get(privateStateId) ?? null;
  }

  async remove(privateStateId: PSI): Promise<void> {
    this.states.delete(privateStateId);
  }

  async clear(): Promise<void> {
    this.states.clear();
  }

  async setSigningKey(address: string, signingKey: SigningKey): Promise<void> {
    this.signingKeys.set(address, signingKey);
  }

  async getSigningKey(address: string): Promise<SigningKey | null> {
    return this.signingKeys.get(address) ?? null;
  }

  async removeSigningKey(address: string): Promise<void> {
    this.signingKeys.delete(address);
  }

  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
  }

  async exportPrivateStates(_options?: { password?: string }): Promise<PrivateStateExport> {
    throw new NotImplementedError('exportPrivateStates');
  }

  async importPrivateStates(
    _exportData: PrivateStateExport,
    _options?: { password?: string },
  ): Promise<ImportPrivateStatesResult> {
    throw new NotImplementedError('importPrivateStates');
  }

  async exportSigningKeys(_options?: { password?: string }): Promise<SigningKeyExport> {
    throw new NotImplementedError('exportSigningKeys');
  }

  async importSigningKeys(
    _exportData: SigningKeyExport,
    _options?: { password?: string },
  ): Promise<{ imported: number; skipped: number; overwritten: number }> {
    throw new NotImplementedError('importSigningKeys');
  }
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`InMemoryPrivateStateProvider does not implement ${method} (not used by the Simple DAO dApp)`);
  }
}