// src/logger.ts
// En transport stdio, stdout porte le protocole JSON-RPC : y écrire un log
// corrompt la session. Tout part donc sur stderr, que le client affiche à part.
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export const stderrLogger = (prefixe: string): Logger => ({
  info: (m) => process.stderr.write(`[${prefixe}] ${m}\n`),
  error: (m) => process.stderr.write(`[${prefixe}] ERREUR ${m}\n`),
});

export const silentLogger: Logger = { info: () => {}, error: () => {} };
