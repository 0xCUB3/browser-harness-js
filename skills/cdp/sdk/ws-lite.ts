import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

export class WebSocketPeer {
  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private closed = false;
  private messageListeners: Array<(text: string) => void> = [];
  private closeListeners: Array<() => void> = [];
  private socket: Duplex;

  constructor(socket: Duplex) {
    this.socket = socket;
    socket.on('data', chunk => this.consume(Buffer.from(chunk)));
    socket.on('close', () => this.emitClose());
    socket.on('end', () => this.emitClose());
    socket.on('error', () => this.emitClose());
  }

  onMessage(fn: (text: string) => void): () => void {
    this.messageListeners.push(fn);
    return () => { this.messageListeners = this.messageListeners.filter(x => x !== fn); };
  }

  onClose(fn: () => void): () => void {
    this.closeListeners.push(fn);
    return () => { this.closeListeners = this.closeListeners.filter(x => x !== fn); };
  }

  send(value: string | object): void {
    if (this.closed) return;
    const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    this.socket.write(frame(0x1, payload));
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    const reasonBytes = Buffer.from(reason).subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.socket.write(frame(0x8, payload));
    this.socket.end();
    this.emitClose();
  }

  private emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.closeListeners.splice(0)) fn();
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0]!;
      const second = this.buffer[1]!;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const n = this.buffer.readBigUInt64BE(2);
        if (n > BigInt(Number.MAX_SAFE_INTEGER)) { this.close(1009, 'message too large'); return; }
        length = Number(n);
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.socket.write(frame(0xA, payload)); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2) {
        this.fragments = [payload];
        this.fragmentOpcode = opcode;
      } else if (opcode === 0x0 && this.fragments.length) {
        this.fragments.push(payload);
      } else {
        this.close(1002, 'bad frame');
        return;
      }
      if (fin) {
        const complete = Buffer.concat(this.fragments);
        const completeOpcode = this.fragmentOpcode;
        this.fragments = [];
        this.fragmentOpcode = 0;
        if (completeOpcode === 0x1) {
          const text = complete.toString('utf8');
          for (const fn of this.messageListeners) fn(text);
        }
      }
    }
  }
}

function frame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): WebSocketPeer | undefined {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return undefined;
  }
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const peer = new WebSocketPeer(socket);
  if (head.length) socket.unshift(head);
  return peer;
}
