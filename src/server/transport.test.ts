import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

import { createMcpServer } from './createMcpServer.js';
import { startTransport } from './transport.js';
import { silentLogger } from '../logger.js';

/**
 * Ces cas exercent le serveur par de VRAIES requêtes HTTP.
 *
 * Ils existent parce qu'un montage incorrect du document de découverte — Router
 * monté en `get` au lieu de `use` — rendait 404 sans que rien ne le signale :
 * les journaux annonçaient la route, et l'en-tête des refus désignait une
 * adresse qui n'existait pas. Aucun test unitaire ne pouvait le voir.
 */
describe('transport http protégé', () => {
  const RESSOURCE = 'http://127.0.0.1:19099/mcp';
  let httpServer: Server;
  let base: string;

  before(async () => {
    const server = createMcpServer({
      name: 'essai',
      version: '0',
      catalog: [],
      ctx: {
        gql: {} as never,
        target: { url: 'http://x.test', host: 'x.test', isProd: false },
        allowWrites: false,
        logger: silentLogger,
      },
    });

    await startTransport(server, {
      transport: 'http',
      port: 19099,
      logger: silentLogger,
      resourceServer: {
        verifier: {
          async verifyAccessToken() {
            throw new Error('aucun jeton n’est valide dans cet essai');
          },
        },
        requiredScopes: ['essai:scope'],
        metadata: {
          resource: RESSOURCE,
          authorizationServers: ['https://as.test/oauth'],
          scopesSupported: ['essai:scope'],
        },
      },
    });
    base = 'http://127.0.0.1:19099';
  });

  after(() => httpServer?.close());

  test('le document de découverte est servi, et PUBLIC', async () => {
    const r = await fetch(`${base}/.well-known/oauth-protected-resource`);

    assert.equal(r.status, 200);
    const d: any = await r.json();
    assert.equal(d.resource, RESSOURCE);
    assert.deepEqual(d.authorization_servers, ['https://as.test/oauth']);
  });

  test('/mcp sans jeton répond 401 et indique où s’authentifier', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    assert.equal(r.status, 401);
    const defi = r.headers.get('www-authenticate') ?? '';
    assert.match(defi, /Bearer/);
    // Ces deux mentions sont ce qui permet à un client de se débrouiller seul.
    assert.match(defi, /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
    assert.match(defi, /scope="essai:scope"/);
  });

  // Le lien doit être suivable : c'est tout l'intérêt de l'annoncer.
  test('l’adresse annoncée dans le refus mène bien au document', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
    const defi = r.headers.get('www-authenticate') ?? '';
    const url = /resource_metadata="([^"]+)"/.exec(defi)?.[1];
    assert.ok(url, 'aucune adresse annoncée');

    const suivi = await fetch(url!);
    assert.equal(suivi.status, 200);
  });
});
