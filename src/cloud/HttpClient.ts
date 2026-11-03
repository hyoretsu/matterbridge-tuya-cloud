import { RateLimitError } from '../errors/index.js';
import { object, type CloudTransport } from './types.js';
/** Owns all network resources. Never logs request bodies, tokens, or credentials. */
export class HttpClient {
  private closed = false;
  private pending = new Set<AbortController>();
  constructor(private transport: CloudTransport = fetch) {}
  async request(url: string, init: RequestInit = {}, allowFailure = false): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error('Tuya client is shut down');
    const abort = new AbortController(); this.pending.add(abort);
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await this.transport(url, {...init, signal: abort.signal});
      if (this.closed) throw new Error('Tuya client is shut down');
      if (response.status === 429) throw new RateLimitError('Tuya HTTP rate limit');
      if (!response.ok) throw new Error('Tuya HTTP ' + response.status);
      const body = object(await response.json());
      if (this.closed) throw new Error('Tuya client is shut down');
      if (body.success !== true && !allowFailure) {
        const code = String(body.code ?? 'unknown');
        if (['1015', '1114', '28841002', '28841104'].includes(code)) throw new RateLimitError('Tuya rate limit ' + code);
        throw new Error('Tuya API rejected request (' + code + '); check account authorization and API permissions');
      }
      return body;
    } finally { clearTimeout(timeout); this.pending.delete(abort); }
  }
  shutdown(): void { this.closed = true; for (const controller of this.pending) controller.abort(); this.pending.clear(); }
}
