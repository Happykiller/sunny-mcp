// src/server/contract.ts
// Contrat de réponse commun à tous les serveurs MCP maison : le résultat métier
// voyage en JSON sérialisé dans un unique bloc texte, et l'échec porte un code
// stable plutôt qu'une phrase. Un agent peut brancher dessus ; une phrase, non.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const ok = (result: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
});

export const fail = (code: string, details?: unknown): CallToolResult => ({
  isError: true,
  content: [
    { type: 'text', text: JSON.stringify({ error: code, details }, null, 2) },
  ],
});
