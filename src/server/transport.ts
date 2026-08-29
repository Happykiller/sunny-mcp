// src/server/transport.ts
// Deux transports pour un même serveur, choisis par variable d'environnement :
// `stdio` pour un client comme Claude Code, `http` pour le débogage manuel et un
// éventuel déploiement multi-client. Gabarit repris de kalifa.
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';

export type TransportKind = 'stdio' | 'http';

export interface StartOptions {
  transport?: TransportKind;
  port?: number;
  logger?: Logger;
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

  // `sessionIdGenerator: undefined` = mode sans état : aucune session à tenir
  // côté serveur, donc rien à répliquer si l'on déploie plusieurs instances.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const relais = async (req: express.Request, res: express.Response) => {
    await transport.handleRequest(req, res, req.body);
  };
  app.post('/mcp', relais);
  app.get('/mcp', relais);
  app.delete('/mcp', relais);

  const port = opts.port ?? 3000;
  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      logger.info(`transport http prêt sur :${port}/mcp`);
      resolve();
    });
  });
}
