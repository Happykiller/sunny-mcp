// src/resource/metadata.ts
// Métadonnées de ressource protégée (RFC 9728).
//
// C'est le point d'entrée de toute la découverte : un client MCP qui reçoit un
// 401 y lit l'adresse du serveur d'autorisation, et sait dès lors où envoyer
// l'utilisateur s'authentifier. Sans ce document, il ne peut rien deviner.
//
// La spécification l'impose : « MCP servers MUST implement OAuth 2.0 Protected
// Resource Metadata. »
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface OptionsMetadonnees {
  /** URI canonique de ce serveur — l'audience que porteront ses jetons. */
  resource: string;
  /** Serveurs d'autorisation habilités à émettre pour cette ressource. */
  authorizationServers: string[];
  /** Scopes minimaux nécessaires au fonctionnement de base. */
  scopesSupported: string[];
  resourceName?: string;
}

export function metadonneesRessource(
  opts: OptionsMetadonnees,
): OAuthProtectedResourceMetadata {
  return {
    resource: opts.resource,
    authorization_servers: opts.authorizationServers,
    scopes_supported: opts.scopesSupported,
    bearer_methods_supported: ["header"],
    resource_name: opts.resourceName,
  };
}

/** Racine du document. Emplacement normatif d'une ressource SANS chemin. */
export const CHEMIN_METADONNEES = "/.well-known/oauth-protected-resource";

/**
 * Où servir le document, pour une ressource donnée.
 *
 * RFC 9728 §3.1 : l'URL des métadonnées se forme en INSÉRANT le well-known
 * entre l'hôte et le chemin de la ressource. Pour `https://hote/mcp`,
 * l'emplacement normatif est donc `/.well-known/oauth-protected-resource/mcp`,
 * et la racine ne vaut que pour une ressource servie à `/`.
 *
 * Ne servir que la racine ne se voit pas tout de suite : le SDK MCP essaie
 * d'abord la forme avec chemin, puis retombe sur la racine devant un 4xx. La
 * conformité repose alors sur le repli d'un client particulier — un client
 * strict, ou une version qui resserre ce repli, ne trouve rien. C'est le même
 * raisonnement que pour la découverte du serveur d'autorisation : le document
 * que lit un client fidèle à la spécification ne doit pas être celui qui manque.
 *
 * Les deux emplacements sont servis, le plus spécifique en premier : monté par
 * préfixe, un handler posé sur la racine capterait le chemin sans savoir y
 * répondre.
 */
export function cheminsMetadonnees(resource: string): string[] {
  let chemin: string;
  try {
    chemin = new URL(resource).pathname.replace(/\/$/, "");
  } catch {
    // Une ressource illisible ne doit pas empêcher de servir le document : la
    // racine reste, et le contrôle d'audience refusera de toute façon.
    return [CHEMIN_METADONNEES];
  }
  return chemin
    ? [`${CHEMIN_METADONNEES}${chemin}`, CHEMIN_METADONNEES]
    : [CHEMIN_METADONNEES];
}

/**
 * URL absolue du document, telle qu'on l'annonce dans `WWW-Authenticate`.
 *
 * Dérivée de la ressource, et non fabriquée en retirant un suffixe supposé :
 * un serveur monté ailleurs que sur `/mcp` recevait sinon une adresse fausse
 * dans le seul en-tête qui dise au client où aller s'authentifier.
 */
export function urlMetadonnees(resource: string): string {
  try {
    const { origin } = new URL(resource);
    return `${origin}${cheminsMetadonnees(resource)[0]}`;
  } catch {
    return CHEMIN_METADONNEES;
  }
}
