import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CHEMIN_METADONNEES,
  cheminsMetadonnees,
  metadonneesRessource,
  urlMetadonnees,
} from "./metadata.js";

/**
 * Ce document est le point d'entrée de toute la découverte : un client qui
 * reçoit un 401 y lit où aller s'authentifier. Une erreur ici rend le serveur
 * inutilisable sans qu'aucun message ne le dise.
 */
describe("metadonneesRessource", () => {
  const base = {
    resource: "https://mcp.exemple.test/mcp",
    authorizationServers: ["https://api.exemple.test/oauth"],
    scopesSupported: ["produit:admin"],
  };

  test("rend un document conforme à RFC 9728", () => {
    const d = metadonneesRessource(base);
    assert.equal(d.resource, base.resource);
    assert.deepEqual(d.authorization_servers, base.authorizationServers);
    assert.deepEqual(d.scopes_supported, base.scopesSupported);
  });

  // Le jeton se présente en en-tête, jamais en paramètre d'URL où il
  // atterrirait dans les journaux du proxy et l'historique du navigateur.
  test("n’annonce que la méthode par en-tête", () => {
    assert.deepEqual(metadonneesRessource(base).bearer_methods_supported, [
      "header",
    ]);
  });

  test("le chemin est celui que cherchent les clients", () => {
    assert.equal(CHEMIN_METADONNEES, "/.well-known/oauth-protected-resource");
  });
});

/**
 * RFC 9728 §3.1 : l'URL des métadonnées s'obtient en INSÉRANT le well-known
 * entre l'hôte et le chemin de la ressource. Ne servir que la racine ne se voit
 * pas tout de suite — le SDK MCP retombe dessus devant un 4xx — mais la
 * conformité repose alors sur le repli d'un client particulier.
 */
describe("cheminsMetadonnees", () => {
  test("sert d'abord l'emplacement normatif, puis la racine", () => {
    assert.deepEqual(cheminsMetadonnees("https://mcp.exemple.test/mcp"), [
      "/.well-known/oauth-protected-resource/mcp",
      CHEMIN_METADONNEES,
    ]);
  });

  test("accepte un chemin de plusieurs segments", () => {
    assert.deepEqual(
      cheminsMetadonnees("https://exemple.test/a/b")[0],
      "/.well-known/oauth-protected-resource/a/b",
    );
  });

  // Sans chemin, la racine EST l'emplacement normatif : la dédoubler ferait
  // monter deux fois le même handler.
  test("ne rend que la racine pour une ressource sans chemin", () => {
    assert.deepEqual(cheminsMetadonnees("https://exemple.test"), [
      CHEMIN_METADONNEES,
    ]);
    assert.deepEqual(cheminsMetadonnees("https://exemple.test/"), [
      CHEMIN_METADONNEES,
    ]);
  });

  test("ne casse pas sur une ressource illisible", () => {
    assert.deepEqual(cheminsMetadonnees("pas-une-url"), [CHEMIN_METADONNEES]);
  });
});

/**
 * Cette URL est le seul endroit qui dise au client où aller s'authentifier.
 * Elle était fabriquée en retirant un suffixe `/mcp` supposé : un serveur monté
 * ailleurs recevait une adresse fausse.
 */
describe("urlMetadonnees", () => {
  test("désigne l'emplacement normatif, en absolu", () => {
    assert.equal(
      urlMetadonnees("https://mcp.exemple.test/mcp"),
      "https://mcp.exemple.test/.well-known/oauth-protected-resource/mcp",
    );
  });

  test("vaut pour un serveur monté ailleurs que sur /mcp", () => {
    assert.equal(
      urlMetadonnees("https://exemple.test/outils/agent"),
      "https://exemple.test/.well-known/oauth-protected-resource/outils/agent",
    );
  });
});
