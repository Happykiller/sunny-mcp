import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { creerVerificateurJwks } from './verifier.js';

/**
 * Le vérificateur est la seule barrière entre internet et le back-office. Ce
 * qu'on éprouve ici n'est pas seulement qu'il refuse, mais COMMENT il refuse :
 * le middleware du SDK ne traduit en 401 que les `InvalidTokenError`, et rend
 * 500 pour tout le reste. Or un client ne relance son autorisation que sur un
 * 401 — un 500 lui fait conclure à une panne, et la session reste morte.
 */
describe('creerVerificateurJwks', () => {
  const ISSUER = 'https://as.exemple.test/oauth';
  const RESOURCE = 'https://mcp.exemple.test/mcp';

  let serveur: Server;
  let jwksUri: string;
  let cle: { privateKey: KeyLike; publicKey: KeyLike };

  const demarrer = async () => {
    cle = (await generateKeyPair('RS256')) as any;
    const jwk = await exportJWK(cle.publicKey);
    jwk.kid = 'test';
    jwk.alg = 'RS256';
    serveur = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
    const { port } = serveur.address() as { port: number };
    jwksUri = `http://127.0.0.1:${port}/jwks`;
  };

  const jeton = async (surcharge: Record<string, unknown> = {}) =>
    new SignJWT({ scope: 'produit:admin', client_id: 'c1', ...surcharge })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer((surcharge.iss as string) ?? ISSUER)
      .setAudience((surcharge.aud as string) ?? RESOURCE)
      .setSubject('user-1')
      .setExpirationTime('5m')
      .sign(cle.privateKey);

  const verificateur = () =>
    creerVerificateurJwks({ jwksUri, issuer: ISSUER, resource: RESOURCE });

  test('accepte un jeton bien émis et en expose le sujet', async () => {
    await demarrer();
    try {
      const info = await verificateur().verifyAccessToken(await jeton());
      assert.deepEqual(info.scopes, ['produit:admin']);
      // Le sujet voyage jusqu'aux outils : c'est lui qui porte l'attribution.
      assert.equal((info.extra as { sub: string }).sub, 'user-1');
    } finally {
      serveur.close();
    }
  });

  // Le cœur de RFC 8707 : un jeton parfaitement valide, mais délivré pour un
  // AUTRE service, ne doit pas ouvrir celui-ci.
  test("refuse un jeton dont l'audience désigne un autre service", async () => {
    await demarrer();
    try {
      await assert.rejects(
        verificateur().verifyAccessToken(
          await jeton({ aud: 'https://autre.exemple.test/mcp' }),
        ),
        InvalidTokenError,
      );
    } finally {
      serveur.close();
    }
  });

  test("refuse un jeton venu d'un autre émetteur", async () => {
    await demarrer();
    try {
      await assert.rejects(
        verificateur().verifyAccessToken(
          await jeton({ iss: 'https://pirate.exemple.test/oauth' }),
        ),
        InvalidTokenError,
      );
    } finally {
      serveur.close();
    }
  });

  // Le cas qui rendait 500 : une chaîne qui n'est même pas un JWT. `jose` lève
  // alors sa propre erreur, que le SDK ne sait pas reconnaître.
  test('refuse une chaîne illisible en InvalidTokenError, non en panne', async () => {
    await demarrer();
    try {
      await assert.rejects(
        verificateur().verifyAccessToken('pas-un-jeton'),
        InvalidTokenError,
      );
    } finally {
      serveur.close();
    }
  });
});
