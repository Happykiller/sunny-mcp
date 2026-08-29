// src/graphql/session.ts
// Session GraphQL authentifiée, réutilisable par n'importe quel produit : le
// document d'authentification et le nom de l'en-tête de rafraîchissement sont
// des paramètres, pas des constantes.
import {
  GraphQLCallError,
  estErreurAuth,
  mapGraphQLErrors,
  type GraphQLErreur,
} from './errors.js';
import { TokenCache } from './tokenCache.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';

export interface SessionOptions {
  url: string;
  /** Document d'authentification du produit. Doit accepter les variables
   *  `login` / `password` et rendre un jeton à `extraireToken`. */
  authDocument: string;
  extraireToken: (data: any) => string | undefined;
  login?: string;
  password?: string;
  /** Jeton fixé d'avance : court-circuite toute connexion. */
  token?: string;
  cache?: TokenCache;
  /** En-tête par lequel le serveur réémet un jeton frais à chaque requête
   *  authentifiée (`seguri-refresh-token` chez Siguri). L'adopter évite de
   *  repasser par `auth`, dont le quota est serré. */
  refreshHeader?: string;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export class GraphQLSession {
  private token?: string;
  private readonly logger: Logger;
  private readonly appel: typeof fetch;

  constructor(private readonly opts: SessionOptions) {
    this.logger = opts.logger ?? silentLogger;
    this.appel = opts.fetchImpl ?? fetch;
    this.token = opts.token;
  }

  async request<T = any>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const token = await this.jeton();
    const premiere = await this.envoyer(document, variables, token);

    if (premiere.erreurs && estErreurAuth(premiere.erreurs)) {
      // Le jeton a été refusé côté serveur : révoqué, compte désactivé, ou
      // secret tourné. Une seule reprise — jamais de boucle.
      this.logger.info('jeton refusé, reconnexion');
      this.token = undefined;
      this.opts.cache?.vider();
      const frais = await this.connexion();
      const seconde = await this.envoyer(document, variables, frais);
      if (seconde.erreurs) throw mapGraphQLErrors(seconde.erreurs);
      return seconde.data as T;
    }

    if (premiere.erreurs) throw mapGraphQLErrors(premiere.erreurs);
    return premiere.data as T;
  }

  /** Jeton courant, sans forcer de connexion si l'on en a déjà un valide. */
  async jeton(): Promise<string> {
    if (this.opts.token) return this.opts.token;
    if (this.token) return this.token;

    const encache = this.opts.cache?.lire();
    if (encache) {
      this.token = encache;
      return encache;
    }
    return this.connexion();
  }

  async connexion(): Promise<string> {
    if (!this.opts.login || !this.opts.password) {
      throw new GraphQLCallError('MISSING_CREDENTIALS', {
        hint: "Ni jeton fixé ni couple login/mot de passe n'a été fourni.",
      });
    }

    const { data, erreurs } = await this.envoyer(this.opts.authDocument, {
      login: this.opts.login,
      password: this.opts.password,
    });

    if (erreurs) throw mapGraphQLErrors(erreurs);

    const token = this.opts.extraireToken(data);
    if (!token) {
      throw new GraphQLCallError('AUTH_NO_TOKEN', {
        hint: "L'authentification a répondu sans jeton.",
      });
    }

    this.token = token;
    this.opts.cache?.ecrire(token);
    return token;
  }

  private async envoyer(
    document: string,
    variables: Record<string, unknown>,
    token?: string,
  ): Promise<{ data?: unknown; erreurs?: GraphQLErreur[] }> {
    const reponse = await this.appel(this.opts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query: document, variables }),
    });

    // Le quota d'authentification est serré (10/min chez Siguri) : mieux vaut le
    // dire franchement que laisser l'agent réessayer en aveugle.
    if (reponse.status === 429) {
      throw new GraphQLCallError('TOO_MANY_REQUESTS', {
        retryAfter: reponse.headers.get('retry-after'),
      });
    }

    this.adopterRafraichissement(reponse);

    const texte = await reponse.text();
    if (!texte) {
      throw new GraphQLCallError('EMPTY_RESPONSE', { status: reponse.status });
    }

    let corps: any;
    try {
      corps = JSON.parse(texte);
    } catch {
      throw new GraphQLCallError('INVALID_RESPONSE', {
        status: reponse.status,
        body: texte.slice(0, 400),
      });
    }

    return {
      data: corps.data,
      erreurs: corps.errors?.length ? corps.errors : undefined,
    };
  }

  private adopterRafraichissement(reponse: Response): void {
    if (!this.opts.refreshHeader) return;
    const frais = reponse.headers.get(this.opts.refreshHeader);
    if (frais && frais !== this.token) {
      this.token = frais;
      this.opts.cache?.ecrire(frais);
    }
  }
}
