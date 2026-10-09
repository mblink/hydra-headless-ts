import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePinnedLookup } from './cimd.js';
import type { AddressInfo } from 'node:net';

// cimd.test.ts mocks https and dns, so this drives the pinned lookup through a real connect,
// the way https.request uses it
describe('makePinnedLookup', () => {
  let server: net.Server;
  let port: number;

  beforeAll(async () => {
    server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const connect = (autoSelectFamily: boolean) =>
    new Promise<string | undefined>((resolve, reject) => {
      const socket = net.connect({
        // Never resolved: the pinned lookup answers instead of DNS
        host: 'cimd.example.test',
        port,
        autoSelectFamily,
        lookup: makePinnedLookup([{ address: '127.0.0.1', family: 4 }]),
      });
      socket.once('connect', () => {
        resolve(socket.remoteAddress);
        socket.destroy();
      });
      socket.once('error', reject);
    });

  it('connects to the pinned address when Node asks for every address (happy eyeballs)', async () => {
    await expect(connect(true)).resolves.toBe('127.0.0.1');
  });

  it('connects to the pinned address when Node asks for one', async () => {
    await expect(connect(false)).resolves.toBe('127.0.0.1');
  });
});
