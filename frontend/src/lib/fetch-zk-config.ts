import {
  createProverKey,
  createVerifierKey,
  createZKIR,
  ZKConfigProvider,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';

/**
 * Serves compiled-Circuit zkir/prover/verifier artifacts straight from the
 * bundle's `public/zk/simple-dao` directory (populated by
 * `scripts/copy-artifacts.mjs`), using plain `fetch`.
 *
 * The abstract base class implements `get()`, `getVerifierKeys()` and
 * `asKeyMaterialProvider()` in terms of the three hooks below, so these are the
 * only methods a subclass needs to provide.
 */
export class FetchZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  constructor(private readonly baseUrl: string) {
    super();
  }

  private resourcePath(circuitId: string, kind: 'zkir' | 'prover' | 'verifier'): string {
    const dir = kind === 'zkir' ? 'zkir' : 'keys';
    const file =
      kind === 'zkir' ? `${circuitId}.bzkir` : kind === 'prover' ? `${circuitId}.prover` : `${circuitId}.verifier`;
    return `${this.baseUrl.replace(/\/$/, '')}/${dir}/${file}`;
  }

  private async fetchBytes(circuitId: string, kind: 'zkir' | 'prover' | 'verifier'): Promise<Uint8Array> {
    const url = this.resourcePath(circuitId, kind);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${kind} artifact for circuit "${circuitId}" from ${url} (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  override async getZKIR(circuitId: K): Promise<ZKIR> {
    return createZKIR(await this.fetchBytes(circuitId, 'zkir'));
  }

  override async getProverKey(circuitId: K): Promise<ProverKey> {
    return createProverKey(await this.fetchBytes(circuitId, 'prover'));
  }

  override async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return createVerifierKey(await this.fetchBytes(circuitId, 'verifier'));
  }
}