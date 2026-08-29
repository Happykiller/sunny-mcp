// src/resource/metadata.ts
// Métadonnées de ressource protégée (RFC 9728).
//
// C'est le point d'entrée de toute la découverte : un client MCP qui reçoit un
// 401 y lit l'adresse du serveur d'autorisation, et sait dès lors où envoyer
// l'utilisateur s'authentifier. Sans ce document, il ne peut rien deviner.
//
// La spécification l'impose : « MCP servers MUST implement OAuth 2.0 Protected
// Resource Metadata. »
import type { OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

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
    bearer_methods_supported: ['header'],
    resource_name: opts.resourceName,
  };
}

/** Chemin normalisé du document, tel que le cherchent les clients. */
export const CHEMIN_METADONNEES = '/.well-known/oauth-protected-resource';
