import { EventEmitter } from 'events';
import type { ProviderInterface, ProviderInterfaceCallback, ProviderInterfaceEmitCb, ProviderInterfaceEmitted } from '@polkadot/rpc-provider/types';

// Vara mainnet chain spec URL — fetched once and cached
const VARA_CHAIN_SPEC_RPC = 'https://rpc.vara.network';

let cachedChainSpec: string | null = null;

async function fetchChainSpec(): Promise<string> {
  if (cachedChainSpec) return cachedChainSpec;

  const response = await fetch(VARA_CHAIN_SPEC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'sync_state_genSyncSpec',
      params: [true],
      id: 1,
    }),
  });

  const data = await response.json();
  cachedChainSpec = JSON.stringify(data.result);
  return cachedChainSpec;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface SubscriptionInfo {
  type: string;
  method: string;
  params: unknown[];
  callback: ProviderInterfaceCallback;
  unsubMethod: string;
}

const SUBSCRIPTION_METHODS = new Map<string, string>([
  ['author_submitAndWatchExtrinsic', 'author_unwatchExtrinsic'],
  ['chain_subscribeAllHeads', 'chain_unsubscribeAllHeads'],
  ['chain_subscribeFinalizedHeads', 'chain_unsubscribeFinalizedHeads'],
  ['chain_subscribeFinalisedHeads', 'chain_unsubscribeFinalisedHeads'],
  ['chain_subscribeNewHeads', 'chain_unsubscribeNewHeads'],
  ['chain_subscribeNewHead', 'chain_unsubscribeNewHead'],
  ['chain_subscribeRuntimeVersion', 'chain_unsubscribeRuntimeVersion'],
  ['subscribe_newHead', 'unsubscribe_newHead'],
  ['state_subscribeRuntimeVersion', 'state_unsubscribeRuntimeVersion'],
  ['state_subscribeStorage', 'state_unsubscribeStorage'],
]);

/**
 * Light client provider for Vara Network using smoldot.
 * Implements ProviderInterface for @polkadot/api compatibility.
 */
export class SmoldotProvider implements ProviderInterface {
  private emitter = new EventEmitter();
  private client: any = null;
  private chain: any = null;
  private nextId = 1;
  private requests = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, SubscriptionInfo>();
  private connected = false;
  private pumping = false;

  get hasSubscriptions(): boolean {
    return true;
  }

  get isClonable(): boolean {
    return false;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  clone(): ProviderInterface {
    throw new Error('clone() is not supported');
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const { start } = await import('smoldot');

    const chainSpec = await fetchChainSpec();

    this.client = start({
      maxLogLevel: 3,
      logCallback: (_level: number, _target: string, _message: string) => {
        // Suppress smoldot logs — they're noisy
      },
    });

    this.chain = await this.client.addChain({ chainSpec });
    this.connected = true;
    this.startPump();
    this.emitter.emit('connected');
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.pumping = false;
    this.connected = false;

    // Reject pending requests
    for (const [, req] of this.requests) {
      req.reject(new Error('Disconnected'));
    }
    this.requests.clear();
    this.subscriptions.clear();

    try {
      if (this.chain) {
        this.chain.remove();
        this.chain = null;
      }
      if (this.client) {
        await this.client.terminate();
        this.client = null;
      }
    } catch {
      // Ignore cleanup errors
    }

    this.emitter.emit('disconnected');
  }

  on(type: ProviderInterfaceEmitted, sub: ProviderInterfaceEmitCb): () => void {
    if (type === 'connected' && this.connected) {
      sub();
    }
    this.emitter.on(type, sub);
    return () => {
      this.emitter.removeListener(type, sub);
    };
  }

  async send<T = any>(method: string, params: unknown[]): Promise<T> {
    if (!this.connected || !this.chain) {
      // During shutdown, silently return empty result for subscription methods
      // to avoid noisy @polkadot/api warnings
      if (SUBSCRIPTION_METHODS.has(method) || method.includes('unsubscribe')) {
        return undefined as T;
      }
      throw new Error('Provider is not connected');
    }

    const id = this.nextId++;
    const request = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    return new Promise<T>((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      try {
        this.chain.sendJsonRpc(request);
      } catch (e) {
        this.requests.delete(id);
        reject(e);
      }
    });
  }

  async subscribe(
    type: string,
    method: string,
    params: unknown[],
    callback: ProviderInterfaceCallback,
  ): Promise<number | string> {
    const unsubMethod = SUBSCRIPTION_METHODS.get(method);
    if (!unsubMethod) {
      throw new Error(`Unsupported subscribe method: ${method}`);
    }

    const subId = await this.send<number | string>(method, params);
    const subKey = `${type}::${subId}`;

    const info: SubscriptionInfo = { type, method, params, callback, unsubMethod };
    this.subscriptions.set(subKey, info);

    return subId;
  }

  async unsubscribe(type: string, method: string, id: number | string): Promise<boolean> {
    const subKey = `${type}::${id}`;
    this.subscriptions.delete(subKey);
    return this.send(method, [id]);
  }

  private startPump(): void {
    if (this.pumping) return;
    this.pumping = true;

    const pump = async () => {
      while (this.pumping && this.chain) {
        try {
          const raw = await this.chain.nextJsonRpcResponse();
          const msg = JSON.parse(raw);
          this.handleMessage(msg);
        } catch {
          if (!this.pumping) break;
        }
      }
    };

    pump().catch(() => {
      // Pump ended
    });
  }

  private handleMessage(msg: any): void {
    // Direct RPC response
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.requests.get(msg.id);
      if (pending) {
        this.requests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }
    }

    // Subscription notification
    if (msg.params?.subscription !== undefined && msg.method) {
      const subKey = `${msg.method}::${msg.params.subscription}`;
      const sub = this.subscriptions.get(subKey);
      if (sub) {
        sub.callback(null, msg.params.result);
      }
    }
  }
}
