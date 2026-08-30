// src/resource/verifier.ts
// Vérification des jetons présentés au serveur MCP.
//
// La spécification MCP est explicite : un serveur MCP est un Resource Server
// OAuth 2.1, et il « MUST validate that access tokens were issued specifically
// for them as the intended audience ». Sans ce contrôle, un jeton obtenu pour
// n'importe quel autre service ouvrirait celui-ci.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';

export interface OptionsVerificateur {
  /** Où le serveur d'autorisation publie ses clés publiques. */
  jwksUri: string;
  /** Émetteur attendu — le claim `iss`. */
  issuer: string;
  /** URI canonique de CE serveur, attendue en audience (RFC 8707). */
  resource: string;
  logger?: Logger;
}

/**
 * Vérificateur adossé au JWKS du serveur d'autorisation.
 *
 * Les clés sont récupérées à distance et mises en cache par `jose`, qui gère
 * aussi leur rotation : une clé inconnue déclenche une nouvelle récupération.
 * C'est ce qui permet au serveur d'autorisation de faire tourner ses clés sans
 * qu'on ait à redéployer ici quoi que ce soit.
 */
export function creerVerificateurJwks(
  opts: OptionsVerificateur,
): OAuthTokenVerifier {
  const logger = opts.logger ?? silentLogger;
  const jwks = createRemoteJWKSet(new URL(opts.jwksUri));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      // `jose` signale tout échec par une exception qui lui est propre :
      // signature invalide, jeton illisible, expiration, audience étrangère.
      // Le middleware du SDK ne sait traduire qu'`InvalidTokenError` en 401 ;
      // toute autre exception ressort en 500, SANS en-tête `WWW-Authenticate`.
      // La nuance n'est pas cosmétique : un client qui reçoit 500 conclut à une
      // panne du serveur, là où un 401 lui dit de refaire son autorisation. Un
      // jeton simplement expiré condamnerait donc la session au lieu de la
      // renouveler.
      let payload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: opts.issuer,
          // C'est LE contrôle qui compte. `jose` rejette le jeton si son `aud`
          // ne contient pas cette valeur — donc s'il était destiné ailleurs.
          audience: opts.resource,
        }));
      } catch (erreur) {
        const motif =
          erreur instanceof Error ? erreur.message : 'jeton invalide';
        logger.info(`jeton refusé — ${motif}`);
        throw new InvalidTokenError(motif);
      }

      const scopes = String(payload.scope ?? '')
        .split(' ')
        .filter(Boolean);

      logger.info(
        `jeton accepté — sub=${payload.sub} scopes=${scopes.join(',') || 'aucun'}`,
      );

      return {
        token,
        clientId: String(payload.client_id ?? payload.azp ?? ''),
        scopes,
        expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
        resource: new URL(opts.resource),
        // Le sujet voyage jusqu'aux outils : c'est lui qui dit AU NOM DE QUI
        // l'action est faite, et c'est ce qui rend l'attribution exacte.
        extra: { sub: payload.sub },
      };
    },
  };
}
