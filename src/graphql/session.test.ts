import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { GraphQLSession } from './session.js';
import { GraphQLCallError } from './errors.js';

const AUTH_DOC = 'query Auth($login:String!,$password:String!){ auth(dto:{login:$login,password:$password}){ access_token } }';
const extraireToken = (d: any) => d?.auth?.access_token;

const jeton = (exp: number) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ exp })).toString('base64url'),
    'sig',
  ].join('.');

const VALIDE = jeton(Math.floor(Date.now() / 1000) + 7200);

/** fetch de laboratoire : journalise les appels et rejoue des réponses. */
const faussefetch = (reponses: Array<{ body: any; status?: number; headers?: Record<string, string> }>) => {
  const appels: Array<{ body: any; auth?: string }> = [];
  let i = 0;
  const impl = (async (_url: any, init: any) => {
    appels.push({
      body: JSON.parse(init.body),
      auth: init.headers?.authorization,
    });
    const r = reponses[Math.min(i++, reponses.length - 1)];
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, appels };
};

const session = (impl: typeof fetch, extra: any = {}) =>
  new GraphQLSession({
    url: 'http://localhost:19090/graphql',
    authDocument: AUTH_DOC,
    extraireToken,
    login: 'admin',
    password: 'secret',
    fetchImpl: impl,
    ...extra,
  });

describe('GraphQLSession', () => {
  test('se connecte puis réutilise le jeton', async () => {
    const { impl, appels } = faussefetch([
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { data: { systemInfo: { version: '2.3.0' } } } },
      { body: { data: { systemInfo: { version: '2.3.0' } } } },
    ]);
    const s = session(impl);

    await s.request('{ systemInfo { version } }');
    await s.request('{ systemInfo { version } }');

    // 1 connexion + 2 requêtes : pas de reconnexion inutile.
    assert.equal(appels.length, 3);
    assert.equal(appels[1].auth, `Bearer ${VALIDE}`);
    assert.equal(appels[2].auth, `Bearer ${VALIDE}`);
  });

  // Le guard réémet un jeton frais à chaque requête : l'adopter évite de
  // repasser par `auth`, dont le quota est serré.
  test('adopte le jeton réémis dans l’en-tête de rafraîchissement', async () => {
    const FRAIS = jeton(Math.floor(Date.now() / 1000) + 9000);
    const { impl, appels } = faussefetch([
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { data: { ping: 1 } }, headers: { 'seguri-refresh-token': FRAIS } },
      { body: { data: { ping: 1 } } },
    ]);
    const s = session(impl, { refreshHeader: 'seguri-refresh-token' });

    await s.request('{ ping }');
    await s.request('{ ping }');

    assert.equal(appels[2].auth, `Bearer ${FRAIS}`);
  });

  test('un jeton refusé déclenche UNE seule reconnexion', async () => {
    const { impl, appels } = faussefetch([
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] } },
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { data: { users: [] } } },
    ]);
    const s = session(impl);

    await s.request('{ users { code } }');

    // connexion, requête refusée, reconnexion, requête rejouée — pas de boucle.
    assert.equal(appels.length, 4);
  });

  test('un refus persistant remonte l’erreur, sans boucler', async () => {
    const { impl, appels } = faussefetch([
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] } },
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] } },
    ]);
    const s = session(impl);

    await assert.rejects(() => s.request('{ users { code } }'), GraphQLCallError);
    assert.equal(appels.length, 4);
  });

  test('remonte le code métier plutôt qu’une phrase', async () => {
    const { impl } = faussefetch([
      { body: { data: { auth: { access_token: VALIDE } } } },
      { body: { errors: [{ message: 'GET_USER_USECASE_USER_NOT_FOUND', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } },
    ]);
    const s = session(impl);

    await assert.rejects(
      () => s.request('{ user(dto:{code:"absent"}){ code } }'),
      (e: any) => e.code === 'GET_USER_USECASE_USER_NOT_FOUND',
    );
  });

  test('signale le bridage plutôt que de laisser réessayer en aveugle', async () => {
    const { impl } = faussefetch([
      { body: {}, status: 429, headers: { 'retry-after': '42' } },
    ]);
    const s = session(impl);

    await assert.rejects(
      () => s.request('{ ping }'),
      (e: any) => e.code === 'TOO_MANY_REQUESTS' && e.details.retryAfter === '42',
    );
  });

  test('un jeton fixé court-circuite toute connexion', async () => {
    const { impl, appels } = faussefetch([{ body: { data: { ping: 1 } } }]);
    const s = session(impl, { token: 'jeton-impose' });

    await s.request('{ ping }');

    assert.equal(appels.length, 1);
    assert.equal(appels[0].auth, 'Bearer jeton-impose');
  });

  test('refuse de deviner sans identifiants', async () => {
    const { impl } = faussefetch([{ body: { data: {} } }]);
    const s = new GraphQLSession({
      url: 'http://localhost:19090/graphql',
      authDocument: AUTH_DOC,
      extraireToken,
      fetchImpl: impl,
    });

    await assert.rejects(
      () => s.request('{ ping }'),
      (e: any) => e.code === 'MISSING_CREDENTIALS',
    );
  });
});
