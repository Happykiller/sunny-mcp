import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CHEMIN_METADONNEES, metadonneesRessource } from './metadata.js';

/**
 * Ce document est le point d'entrée de toute la découverte : un client qui
 * reçoit un 401 y lit où aller s'authentifier. Une erreur ici rend le serveur
 * inutilisable sans qu'aucun message ne le dise.
 */
describe('metadonneesRessource', () => {
  const base = {
    resource: 'https://mcp.exemple.test/mcp',
    authorizationServers: ['https://api.exemple.test/oauth'],
    scopesSupported: ['produit:admin'],
  };

  test('rend un document conforme à RFC 9728', () => {
    const d = metadonneesRessource(base);
    assert.equal(d.resource, base.resource);
    assert.deepEqual(d.authorization_servers, base.authorizationServers);
    assert.deepEqual(d.scopes_supported, base.scopesSupported);
  });

  // Le jeton se présente en en-tête, jamais en paramètre d'URL où il
  // atterrirait dans les journaux du proxy et l'historique du navigateur.
  test('n’annonce que la méthode par en-tête', () => {
    assert.deepEqual(metadonneesRessource(base).bearer_methods_supported, [
      'header',
    ]);
  });

  test('le chemin est celui que cherchent les clients', () => {
    assert.equal(CHEMIN_METADONNEES, '/.well-known/oauth-protected-resource');
  });
});
