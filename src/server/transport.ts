// src/server/transport.ts
// Deux transports pour un même serveur, choisis par variable d'environnement :
// `stdio` pour un client comme Claude Code, `http` pour le débogage manuel et un
// éventuel déploiement multi-client. Gabarit repris de kalifa.
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { metadataHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/metadata.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';

import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { CHEMIN_METADONNEES, metadonneesRessource } from '../resource/metadata.js';
import type { OptionsMetadonnees } from '../resource/metadata.js';

export type TransportKind = 'stdio' | 'http';

export interface StartOptions {
  transport?: TransportKind;
  port?: number;
  logger?: Logger;
  /**
   * Protection du transport HTTP. Absente, `/mcp` est ouvert — ce qui n'est
   * défendable qu'en réseau strictement privé.
   *
   * Sans objet en stdio : la spécification écarte explicitement ce transport du
   * régime OAuth, les identifiants venant alors de l'environnement.
   */
  resourceServer?: {
    verifier: OAuthTokenVerifier;
    /** Scopes exigés sur toute requête. Un manque donne un 403, pas un 401. */
    requiredScopes?: string[];
    metadata: OptionsMetadonnees;
  };
}

export async function startTransport(
  server: McpServer,
  opts: StartOptions = {},
): Promise<void> {
  const logger = opts.logger ?? silentLogger;
  const kind = opts.transport ?? 'stdio';

  if (kind === 'stdio') {
    await server.connect(new StdioServerTransport());
    logger.info('transport stdio prêt');
    return;
  }

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const protection = opts.resourceServer;
  if (protection) {
    // Le document de découverte reste PUBLIC : c'est par lui qu'un client non
    // authentifié apprend où aller s'authentifier. L'exiger authentifié
    // rendrait la découverte impossible.
    app.get(
      CHEMIN_METADONNEES,
      metadataHandler(metadonneesRessource(protection.metadata)),
    );
    logger.info(`métadonnées de ressource sur ${CHEMIN_METADONNEES}`);
  }

  // `sessionIdGenerator: undefined` = mode sans état : aucune session à tenir
  // côté serveur, donc rien à répliquer si l'on déploie plusieurs instances.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const relais = async (req: express.Request, res: express.Response) => {
    await transport.handleRequest(req, res, req.body);
  };

  // Le middleware du SDK produit lui-même le 401 et son en-tête
  // `WWW-Authenticate`, porteur de l'adresse des métadonnées : c'est ce qui
  // permet à un client de découvrir le serveur d'autorisation à partir d'un
  // simple refus. Un scope manquant donne un 403 `insufficient_scope`.
  const garde: express.RequestHandler[] = protection
    ? [
        requireBearerAuth({
          verifier: protection.verifier,
          requiredScopes: protection.requiredScopes,
          resourceMetadataUrl: `${protection.metadata.resource.replace(/\/mcp$/, '')}${CHEMIN_METADONNEES}`,
        }),
      ]
    : [];

  app.post('/mcp', ...garde, relais);
  app.get('/mcp', ...garde, relais);
  app.delete('/mcp', ...garde, relais);

  const port = opts.port ?? 3000;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      logger.info(`transport http prêt sur :${port}/mcp`);
      resolve();
    });
  });
}
