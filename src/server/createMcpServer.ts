// src/server/createMcpServer.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ok, fail } from './contract.js';
import { GraphQLCallError } from '../graphql/errors.js';
import type { ToolCatalog, ToolContext } from '../tools/defineTool.js';

export interface CreateServerOptions {
  name: string;
  version: string;
  catalog: ToolCatalog;
  ctx: ToolContext;
}

/** Préfixe apposé en clair sur les outils écrivant en production : la seule
 *  chose que l'agent lit avant d'agir, c'est la description. */
const PREFIXE_PROD = '[PRODUCTION] ';

export function createMcpServer(opts: CreateServerOptions): McpServer {
  const { catalog, ctx } = opts;
  const server = new McpServer({ name: opts.name, version: opts.version });

  const noms = new Set<string>();
  for (const tool of catalog) {
    if (noms.has(tool.name)) {
      throw new Error(`Outil déclaré deux fois : ${tool.name}`);
    }
    noms.add(tool.name);

    const description =
      ctx.target.isProd && tool.requiresWrite
        ? PREFIXE_PROD + tool.description
        : tool.description;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: any) => {
        if (tool.requiresWrite && !ctx.allowWrites) {
          // Refus AVANT toute requête : rien ne part sur le réseau.
          return fail('WRITES_DISABLED', {
            tool: tool.name,
            target: ctx.target.url,
            hint: 'Poser SUNNY_MCP_ALLOW_WRITES=true pour autoriser les écritures.',
          });
        }

        try {
          const resultat = await tool.execute(args, ctx);
          // Chaque réponse rappelle où elle a agi : l'agent et le lecteur de la
          // transcription voient la cible sans avoir à la deviner.
          return ok({
            ...(resultat as object),
            target: ctx.target.url,
            is_prod: ctx.target.isProd,
          });
        } catch (e: any) {
          ctx.logger.error(`${tool.name} : ${e?.message ?? e}`);
          if (e instanceof GraphQLCallError) {
            return fail(e.code, { ...(e.details as object), tool: tool.name });
          }
          return fail(e?.code ?? 'TOOL_FAILED', {
            message: e?.message ?? String(e),
            tool: tool.name,
          });
        }
      },
    );
  }

  return server;
}
