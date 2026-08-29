// src/graphql/errors.ts
// Les usecases de sunny-apis lèvent des `Error` dont le message EST le code
// (`GET_USER_USECASE_USER_NOT_FOUND`…). GraphQL les rend en INTERNAL_SERVER_ERROR
// avec ce code en message. On les remonte tels quels : un agent doit pouvoir
// distinguer « ce compte n'existe pas » d'une panne, sans lire du français.

export interface GraphQLErreur {
  message: string;
  extensions?: { code?: string };
}

export class GraphQLCallError extends Error {
  constructor(
    readonly code: string,
    readonly details: unknown,
  ) {
    super(code);
    this.name = 'GraphQLCallError';
  }
}

/** Un message tout en MAJUSCULES_AVEC_UNDERSCORES est un code métier, pas une
 *  phrase destinée à un humain. */
const estCodeMetier = (m: string) => /^[A-Z][A-Z0-9_]{3,}$/.test(m.trim());

export function mapGraphQLErrors(erreurs: GraphQLErreur[]): GraphQLCallError {
  const premiere = erreurs[0];
  const message = premiere?.message ?? 'erreur GraphQL sans message';
  const code = estCodeMetier(message)
    ? message.trim()
    : (premiere?.extensions?.code ?? 'GRAPHQL_ERROR');

  return new GraphQLCallError(code, {
    messages: erreurs.map((e) => e.message),
  });
}

/** Le serveur ne distingue pas toujours « jeton absent » de « jeton périmé » :
 *  les deux ressortent en UNAUTHENTICATED, parfois en FORBIDDEN. */
export function estErreurAuth(erreurs: GraphQLErreur[]): boolean {
  return erreurs.some((e) => {
    const code = e.extensions?.code ?? '';
    return (
      code === 'UNAUTHENTICATED' ||
      code === 'FORBIDDEN' ||
      /unauthorized|unauthenticated|jwt|token/i.test(e.message ?? '')
    );
  });
}
