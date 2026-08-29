// src/graphql/tokenCache.ts
// Cache de jeton sur disque, hors du dépôt. Reprend la logique éprouvée de
// `siguri-admin/scripts/sgql.sh` : on décode `exp` sans vérifier la signature —
// le client n'a pas le secret et n'en a pas besoin, la vérification est
// l'affaire du serveur. Le seul but est d'éviter de rejouer `auth`, bridé à
// 10 requêtes par minute.
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

/** Marge avant expiration : un jeton qui expire pendant le vol de la requête
 *  coûte un aller-retour inutile et une erreur trompeuse. */
const MARGE_SECONDES = 60;

export function jwtExpiration(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const charge = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    return typeof charge?.exp === 'number' ? charge.exp : null;
  } catch {
    return null;
  }
}

export function tokenEncoreValide(token: string, maintenant = Date.now()): boolean {
  const exp = jwtExpiration(token);
  // Un jeton sans `exp` est indatable : on préfère se reconnecter plutôt que de
  // parier sur sa validité.
  if (exp === null) return false;
  return exp * 1000 > maintenant + MARGE_SECONDES * 1000;
}

/** Le cache vit hors du dépôt : un `.token` déposé dans un dossier de projet
 *  finit par être copié, partagé ou committé. */
export function cheminCache(produit: string, cle: string): string {
  const base =
    process.env.XDG_CACHE_HOME ??
    (homedir() ? join(homedir(), '.cache') : tmpdir());
  const empreinte = createHash('sha256').update(cle).digest('hex').slice(0, 32);
  return join(base, 'sunny-mcp', `${produit}-${empreinte}.token`);
}

export class TokenCache {
  constructor(private readonly chemin: string) {}

  lire(): string | null {
    try {
      if (!existsSync(this.chemin)) return null;
      const token = readFileSync(this.chemin, 'utf8').trim();
      return token && tokenEncoreValide(token) ? token : null;
    } catch {
      // Un cache illisible n'est pas une panne : on se reconnecte.
      return null;
    }
  }

  ecrire(token: string): void {
    try {
      mkdirSync(join(this.chemin, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(this.chemin, token, { encoding: 'utf8', mode: 0o600 });
      chmodSync(this.chemin, 0o600);
    } catch {
      // Un cache non écrit dégrade la performance, pas la correction.
    }
  }

  vider(): void {
    try {
      rmSync(this.chemin, { force: true });
    } catch {
      /* idem */
    }
  }
}
