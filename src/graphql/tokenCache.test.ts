import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TokenCache, jwtExpiration, tokenEncoreValide } from './tokenCache.js';

const jeton = (charge: object) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify(charge)).toString('base64url'),
    'signature-non-verifiee',
  ].join('.');

describe('jeton', () => {
  test('lit exp sans vérifier la signature', () => {
    assert.equal(jwtExpiration(jeton({ exp: 1893456000 })), 1893456000);
  });

  test('un jeton malformé ne lève pas', () => {
    assert.equal(jwtExpiration('pas-un-jwt'), null);
    assert.equal(jwtExpiration('a.b'), null);
    assert.equal(jwtExpiration('a.@@@.c'), null);
  });

  test('un jeton expiré est rejeté', () => {
    const passe = Math.floor(Date.now() / 1000) - 10;
    assert.equal(tokenEncoreValide(jeton({ exp: passe })), false);
  });

  // Marge de 60 s : un jeton qui meurt en vol coûte un aller-retour et une
  // erreur trompeuse.
  test('un jeton expirant dans 30 s est rejeté par la marge', () => {
    const bientot = Math.floor(Date.now() / 1000) + 30;
    assert.equal(tokenEncoreValide(jeton({ exp: bientot })), false);
  });

  test('un jeton valide deux heures est accepté', () => {
    const plusTard = Math.floor(Date.now() / 1000) + 7200;
    assert.equal(tokenEncoreValide(jeton({ exp: plusTard })), true);
  });

  test('un jeton sans exp est rejeté plutôt que pariéu dessus', () => {
    assert.equal(tokenEncoreValide(jeton({ sub: 'x' })), false);
  });
});

describe('TokenCache', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'sunny-mcp-'));

  test('écrit en 0600 et relit', () => {
    const chemin = join(dossier, 'a.token');
    const cache = new TokenCache(chemin);
    const valide = jeton({ exp: Math.floor(Date.now() / 1000) + 7200 });

    cache.ecrire(valide);
    assert.equal(readFileSync(chemin, 'utf8'), valide);
    assert.equal(statSync(chemin).mode & 0o777, 0o600);
    assert.equal(cache.lire(), valide);
  });

  test('ne rend pas un jeton périmé', () => {
    const chemin = join(dossier, 'b.token');
    const cache = new TokenCache(chemin);
    cache.ecrire(jeton({ exp: Math.floor(Date.now() / 1000) - 10 }));
    assert.equal(cache.lire(), null);
  });

  test('un cache absent rend null sans lever', () => {
    assert.equal(new TokenCache(join(dossier, 'jamais-ecrit')).lire(), null);
  });

  test('vider est idempotent', () => {
    const cache = new TokenCache(join(dossier, 'c.token'));
    cache.ecrire(jeton({ exp: Math.floor(Date.now() / 1000) + 7200 }));
    cache.vider();
    cache.vider();
    assert.equal(cache.lire(), null);
  });
});
