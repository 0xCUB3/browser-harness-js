import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptWebSocket, WebSocketPeer } from './ws-lite.ts';

export type RelayTab = {
  tabId: number;
  targetId: string;
  title: string;
  url: string;
  attached: boolean;
  active?: boolean;
};

type PendingExtension = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type CdpRequest = { id: number; method: string; params?: any; sessionId?: string };

export class ExtensionRelay {
  private extension?: WebSocketPeer;
  private cdpPeers = new Set<WebSocketPeer>();
  private tabs = new Map<string, RelayTab>();
  private sessions = new Map<string, number>();
  private nextSession = 1;
  private nextExtensionId = 1;
  private pendingExtension = new Map<number, PendingExtension>();

  get extensionConnected(): boolean { return this.extension !== undefined; }

  handleUpgrade(pathname: string, req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (pathname !== '/extension' && pathname !== '/cdp') return false;
    if (!isLocal(req.socket.remoteAddress)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return true;
    }
    if (pathname === '/extension') {
      const origin = req.headers.origin;
      if (origin && !origin.startsWith('chrome-extension://')) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return true;
      }
    }
    const peer = acceptWebSocket(req, socket, head);
    if (!peer) return true;
    if (pathname === '/extension') this.setExtension(peer);
    else this.addCdpPeer(peer);
    return true;
  }

  private setExtension(peer: WebSocketPeer): void {
    const previous = this.extension;
    this.extension = peer;
    peer.onMessage(raw => this.onExtensionMessage(raw));
    peer.onClose(() => {
      if (this.extension !== peer) return;
      this.extension = undefined;
      this.tabs.clear();
      this.sessions.clear();
      for (const [, pending] of this.pendingExtension) {
        clearTimeout(pending.timer);
        pending.reject(new Error('extension disconnected'));
      }
      this.pendingExtension.clear();
    });
    peer.send({ type: 'sync' });
    previous?.close(1012, 'replaced');
  }

  private addCdpPeer(peer: WebSocketPeer): void {
    this.cdpPeers.add(peer);
    peer.onMessage(raw => this.onCdpMessage(peer, raw));
    peer.onClose(() => this.cdpPeers.delete(peer));
  }

  private onExtensionMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'state' && Array.isArray(msg.tabs)) {
      this.tabs.clear();
      for (const value of msg.tabs) {
        const tab = normalizeTab(value);
        if (tab) this.tabs.set(tab.targetId, tab);
      }
      return;
    }
    if (msg.type === 'event' && typeof msg.method === 'string' && Number.isInteger(msg.tabId)) {
      for (const [sessionId, tabId] of this.sessions) {
        if (tabId === msg.tabId) this.broadcast({ method: msg.method, params: msg.params ?? {}, sessionId });
      }
      return;
    }
    if (typeof msg.id === 'number') {
      const pending = this.pendingExtension.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingExtension.delete(msg.id);
      if (msg.error) pending.reject(new Error(String(msg.error.message ?? msg.error)));
      else pending.resolve(msg.result);
    }
  }

  private async onCdpMessage(peer: WebSocketPeer, raw: string): Promise<void> {
    let request: CdpRequest;
    try { request = JSON.parse(raw); } catch { return; }
    if (typeof request.id !== 'number' || typeof request.method !== 'string') return;
    try {
      const result = await this.dispatch(request);
      peer.send({ id: request.id, result: result ?? {} });
    } catch (error) {
      peer.send({
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async dispatch(request: CdpRequest): Promise<any> {
    if (!this.extension) throw new Error('no extension connected');
    const params = request.params ?? {};
    switch (request.method) {
      case 'Target.getTargets':
        await this.refreshState();
        return {
          targetInfos: [...this.tabs.values()].filter(tab => isRelayPage(tab)).map(tab => ({
            targetId: tab.targetId,
            type: 'page',
            title: tab.title,
            url: tab.url,
            attached: tab.attached,
            canAccessOpener: false,
          })),
        };
      case 'Target.attachToTarget': {
        if (params.flatten !== true) throw new Error('extension relay requires flatten:true');
        let tab = this.tabs.get(String(params.targetId));
        if (!tab || !isRelayPage(tab, true)) throw new Error(`unknown page target: ${params.targetId}`);
        if (!tab.attached) {
          const result = await this.extensionCall('attachTarget', { tabId: tab.tabId });
          const attachedTab = normalizeTab(result);
          if (!attachedTab?.attached) throw new Error(`could not attach target: ${params.targetId}`);
          this.tabs.set(attachedTab.targetId, attachedTab);
          tab = attachedTab;
        }
        const sessionId = `extension-session-${this.nextSession++}`;
        this.sessions.set(sessionId, tab.tabId);
        return { sessionId };
      }
      case 'Target.detachFromTarget':
        if (params.sessionId) this.sessions.delete(String(params.sessionId));
        else if (params.targetId) this.deleteSessionsForTarget(String(params.targetId));
        return {};
      case 'Target.closeTarget': {
        const tab = this.tabs.get(String(params.targetId));
        if (!tab) return { success: false };
        await this.extensionCall('closeTarget', { tabId: tab.tabId });
        this.tabs.delete(tab.targetId);
        this.deleteSessionsForTab(tab.tabId);
        return { success: true };
      }
      case 'Target.createTarget': {
        const result = await this.extensionCall('createTarget', { url: params.url ?? 'about:blank' });
        const tab = normalizeTab(result);
        if (!tab) throw new Error('extension returned an invalid target');
        this.tabs.set(tab.targetId, tab);
        return { targetId: tab.targetId };
      }
      case 'Target.activateTarget': {
        const tab = this.tabs.get(String(params.targetId));
        if (!tab) throw new Error(`unknown target: ${params.targetId}`);
        await this.extensionCall('activateTarget', { tabId: tab.tabId });
        return {};
      }
      default: {
        const tabId = request.sessionId ? this.sessions.get(request.sessionId) : undefined;
        if (tabId == null) throw new Error(`no attached target session for ${request.method}`);
        return await this.extensionCall('cdp', { tabId, method: request.method, params });
      }
    }
  }

  private async refreshState(): Promise<void> {
    const result = await this.extensionCall('getState', {});
    if (!Array.isArray(result?.tabs)) return;
    this.tabs.clear();
    for (const value of result.tabs) {
      const tab = normalizeTab(value);
      if (tab) this.tabs.set(tab.targetId, tab);
    }
  }

  private extensionCall(type: string, payload: object): Promise<any> {
    if (!this.extension) return Promise.reject(new Error('no extension connected'));
    const id = this.nextExtensionId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingExtension.delete(id);
        reject(new Error(`extension timed out handling ${type}`));
      }, 15_000);
      this.pendingExtension.set(id, { resolve, reject, timer });
      this.extension!.send({ id, type, ...payload });
    });
  }

  private deleteSessionsForTarget(targetId: string): void {
    const tab = this.tabs.get(targetId);
    if (tab) this.deleteSessionsForTab(tab.tabId);
  }

  private deleteSessionsForTab(tabId: number): void {
    for (const [sessionId, mappedTab] of this.sessions) {
      if (mappedTab === tabId) this.sessions.delete(sessionId);
    }
  }

  private broadcast(message: object): void {
    for (const peer of this.cdpPeers) peer.send(message);
  }
}

function normalizeTab(value: any): RelayTab | undefined {
  if (!value || !Number.isInteger(value.tabId)) return undefined;
  return {
    tabId: value.tabId,
    targetId: typeof value.targetId === 'string' ? value.targetId : `chrome-tab-${value.tabId}`,
    title: String(value.title ?? ''),
    url: String(value.url ?? ''),
    attached: value.attached === true,
    active: value.active === true,
  };
}

function isRelayPage(tab: RelayTab, includeUnattachedBlank = false): boolean {
  if (/^(chrome|chrome-extension|devtools|edge|brave):/i.test(tab.url)) return false;
  if (/^https?:\/\//.test(tab.url)) return true;
  const pending = !tab.url || tab.url === 'about:blank';
  if (!pending) return false;
  return tab.attached || includeUnattachedBlank;
}

function isLocal(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
