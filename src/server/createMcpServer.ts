// src/server/createMcpServer.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ok, fail } from "./contract.js";
import { GraphQLCallError } from "../graphql/errors.js";
import type {
  Appelant,
  ToolCatalog,
  ToolContext,
} from "../tools/defineTool.js";

/**
 * Contexte des outils : une valeur fixe, ou une fabrique appelée à CHAQUE
 * requête.
 *
 * La fabrique existe pour le transport HTTP, où l'identité varie d'un appel à
 * l'autre : un contexte figé y ferait agir tout le monde sous la même identité.
 * En stdio, la valeur fixe suffit.
 */
export type FabriqueContexte = (
  appelant: Appelant | undefined,
) => ToolContext | Promise<ToolContext>;

export interface CreateServerOptions {
  name: string;
  version: string;
  catalog: ToolCatalog;
  ctx: ToolContext | FabriqueContexte;
}

/** Préfixe apposé en clair sur les outils écrivant en production : la seule
 *  chose que l'agent lit avant d'agir, c'est la description. */
const PREFIXE_PROD = "[PRODUCTION] ";

export function createMcpServer(opts: CreateServerOptions): McpServer {
  const { catalog } = opts;
  const server = new McpServer({ name: opts.name, version: opts.version });

  const resoudreContexte = async (
    appelant: Appelant | undefined,
  ): Promise<ToolContext> =>
    typeof opts.ctx === "function" ? opts.ctx(appelant) : opts.ctx;

  // La cible et l'interrupteur d'écriture ne dépendent pas de l'appelant : on
  // les lit une fois, pour décider des descriptions à l'enregistrement.
  const ctx = typeof opts.ctx === "function" ? undefined : opts.ctx;

  const noms = new Set<string>();
  for (const tool of catalog) {
    if (noms.has(tool.name)) {
      throw new Error(`Outil déclaré deux fois : ${tool.name}`);
    }
    noms.add(tool.name);

    const description =
      ctx?.target.isProd === true && tool.requiresWrite
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
      async (args: any, extra: any) => {
        // L'identité vient du transport : le middleware Bearer la dépose sur la
        // requête, et le SDK la relaie jusqu'ici.
        const info = extra?.authInfo;
        const appelant: Appelant | undefined = info
          ? {
              sub: (info.extra?.sub as string) ?? undefined,
              scopes: info.scopes ?? [],
              token: info.token,
            }
          : undefined;

        const contexte = await resoudreContexte(appelant);

        if (tool.requiresWrite && !contexte.allowWrites) {
          // Refus AVANT toute requête : rien ne part sur le réseau.
          return fail("WRITES_DISABLED", {
            tool: tool.name,
            target: contexte.target.url,
            hint: "Poser SUNNY_MCP_ALLOW_WRITES=true pour autoriser les écritures.",
          });
        }

        try {
          const resultat = await tool.execute(args, contexte);
          // Chaque réponse rappelle où elle a agi : l'agent et le lecteur de la
          // transcription voient la cible sans avoir à la deviner.
          return ok({
            ...(resultat as object),
            target: contexte.target.url,
            // Omis quand la cible ne sait pas : mieux vaut ne rien dire que
            // répondre « non » à côté de données de production.
            ...(contexte.target.isProd === undefined
              ? {}
              : { is_prod: contexte.target.isProd }),
          });
        } catch (e: any) {
          contexte.logger.error(`${tool.name} : ${e?.message ?? e}`);
          if (e instanceof GraphQLCallError) {
            return fail(e.code, { ...(e.details as object), tool: tool.name });
          }
          return fail(e?.code ?? "TOOL_FAILED", {
            message: e?.message ?? String(e),
            tool: tool.name,
          });
        }
      },
    );
  }

  return server;
}
