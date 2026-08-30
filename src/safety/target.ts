// src/safety/target.ts
// Garde-fou de cible : transposition du cran d'arrêt de `bin/dev-mongo.sh`, qui
// refuse d'écrire sans `--write`. Il ne protège pas contre un attaquant — il
// protège contre soi-même, un soir où l'on croit viser le local.

const HOTES_LOCAUX = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

export interface Target {
  url: string;
  host: string;
  /**
   * Vise-t-on la production ? **Facultatif, et l'absence a un sens** : elle
   * dit qu'on ne sait pas, ce qui n'est pas la même chose que « non ».
   *
   * `resolveTarget` tranche à partir de l'hôte, ce qui vaut pour un serveur
   * local. En transport http la question n'a pas de réponse fiable : la cible
   * est atteinte par un nom de service interne, identique en développement et
   * en production. Y répondre `false` par défaut publiait « is_prod: false »
   * au-dessus de comptes réels — constaté en recette. Un exploitant lit ce
   * champ comme une réponse à « suis-je en production ? », et s'y fie.
   */
  isProd?: boolean;
}

/** Le mot de passe est volontairement long et non devinable : on ne le pose pas
 *  par distraction, contrairement à `true` ou `1`. */
export const AVEU_PROD = "yes-i-know";

export class TargetRefusedError extends Error {
  readonly code = "TARGET_REFUSED";
}

export function resolveTarget(rawUrl: string, aveu?: string): Target {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetRefusedError(
      `URL d'API invalide : ${JSON.stringify(rawUrl)}`,
    );
  }

  const host = url.hostname;
  const isProd = !HOTES_LOCAUX.has(host);

  if (isProd && aveu !== AVEU_PROD) {
    throw new TargetRefusedError(
      `Cible non locale (${host}). Pour l'autoriser délibérément, poser ` +
        `SUNNY_MCP_ALLOW_PROD=${AVEU_PROD}. Toute autre valeur est refusée.`,
    );
  }

  return { url: url.toString(), host, isProd };
}
