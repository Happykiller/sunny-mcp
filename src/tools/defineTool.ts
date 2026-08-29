// src/tools/defineTool.ts
// Un outil se décrit une seule fois. Le SDK 1.29 dérive lui-même le JSON Schema
// de découverte depuis le schéma Zod : contrairement au gabarit de kalifa, il
// n'y a plus de `getToolSchema()` à maintenir en parallèle de `validateInput()`,
// donc plus de dérive possible entre ce qu'on annonce et ce qu'on valide.
import type { z } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

import type { Logger } from '../logger.js';
import type { Target } from '../safety/target.js';
import type { GraphQLSession } from '../graphql/session.js';

/**
 * Identité de l'appelant, quand le transport en porte une.
 *
 * Absente en stdio : le serveur y agit sous une seule identité, celle de son
 * environnement. Présente en HTTP, où chaque requête arrive avec son jeton —
 * c'est ce qui permet d'attribuer une action à la personne qui l'a demandée
 * plutôt qu'à un compte de service partagé.
 */
export interface Appelant {
  /** Sujet du jeton : l'identifiant du compte au nom duquel on agit. */
  sub?: string;
  scopes: string[];
  /** Le jeton lui-même, à présenter pour en obtenir un autre en aval. */
  token: string;
}

export interface ToolContext {
  gql: GraphQLSession;
  target: Target;
  appelant?: Appelant;
  /** Interrupteur d'écriture, indépendant de la cible : il faut deux erreurs
   *  pour écrire en production, pas une. */
  allowWrites: boolean;
  logger: Logger;
}

export interface ToolDefinition<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
  /** Marque l'outil comme écrivant. Le socle le refuse tant que `allowWrites`
   *  est faux, sans même émettre de requête. */
  requiresWrite?: boolean;
  /** Rend l'objet métier ; le socle l'enveloppe dans le contrat de réponse. */
  execute(
    args: z.infer<z.ZodObject<S>>,
    ctx: ToolContext,
  ): Promise<unknown>;
}

export const defineTool = <S extends z.ZodRawShape>(d: ToolDefinition<S>) => d;

export type ToolCatalog = ReadonlyArray<ToolDefinition<any>>;
