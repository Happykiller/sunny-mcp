// src/index.ts — surface publique du socle.
export { ok, fail } from './server/contract.js';
export { createMcpServer } from './server/createMcpServer.js';
export type { CreateServerOptions } from './server/createMcpServer.js';
export { startTransport } from './server/transport.js';
export type { StartOptions, TransportKind } from './server/transport.js';

export { defineTool } from './tools/defineTool.js';
export type {
  ToolCatalog,
  ToolContext,
  ToolDefinition,
} from './tools/defineTool.js';

export { GraphQLSession } from './graphql/session.js';
export type { SessionOptions } from './graphql/session.js';
export {
  GraphQLCallError,
  estErreurAuth,
  mapGraphQLErrors,
} from './graphql/errors.js';
export type { GraphQLErreur } from './graphql/errors.js';
export {
  TokenCache,
  cheminCache,
  jwtExpiration,
  tokenEncoreValide,
} from './graphql/tokenCache.js';

export {
  AVEU_PROD,
  TargetRefusedError,
  resolveTarget,
} from './safety/target.js';
export type { Target } from './safety/target.js';

export { silentLogger, stderrLogger } from './logger.js';
export type { Logger } from './logger.js';
