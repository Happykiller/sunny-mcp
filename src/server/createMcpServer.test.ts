import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { createMcpServer } from './createMcpServer.js';
import { defineTool } from '../tools/defineTool.js';
import { GraphQLCallError } from '../graphql/errors.js';
import { silentLogger } from '../logger.js';
import type { ToolContext } from '../tools/defineTool.js';

const contexte = (over: Partial<ToolContext> = {}): ToolContext => ({
  gql: {} as any,
  target: { url: 'http://localhost:19090/graphql', host: 'localhost', isProd: false },
  allowWrites: false,
  logger: silentLogger,
  ...over,
});

const lecture = defineTool({
  name: 'lire',
  title: 'Lire',
  description: 'Rend une valeur.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
  execute: async () => ({ valeur: 42 }),
});

/** Compte ses appels : sert à prouver qu'un refus n'exécute rien. */
const fabriqueEcriture = () => {
  let appels = 0;
  const outil = defineTool({
    name: 'ecrire',
    title: 'Écrire',
    description: 'Modifie quelque chose.',
    inputSchema: { cible: z.string() },
    annotations: { destructiveHint: true },
    requiresWrite: true,
    execute: async () => {
      appels += 1;
      return { fait: true };
    },
  });
  return { outil, appels: () => appels };
};

/** Le SDK n'offre pas d'introspection publique du registre : on invoque le
 *  rappel enregistré en interceptant `registerTool` sur le prototype. */
const invoquer = async (catalog: any[], ctx: ToolContext, nom: string, args: any) => {
  const rappels = new Map<string, Function>();
  const proto: any = Object.getPrototypeOf(
    createMcpServer({ name: 't', version: '0', catalog: [], ctx }),
  );
  const original = proto.registerTool;
  proto.registerTool = function (n: string, cfg: any, cb: Function) {
    rappels.set(n, cb);
    return original.call(this, n, cfg, cb);
  };
  try {
    createMcpServer({ name: 't', version: '0', catalog, ctx });
  } finally {
    proto.registerTool = original;
  }
  return rappels.get(nom)!(args, {} as any);
};

const corps = (r: any) => JSON.parse(r.content[0].text);

describe('createMcpServer', () => {
  test('enveloppe le résultat et rappelle la cible', async () => {
    const r = await invoquer([lecture], contexte(), 'lire', {});
    assert.equal(r.isError, undefined);
    assert.deepEqual(corps(r), {
      valeur: 42,
      target: 'http://localhost:19090/graphql',
      is_prod: false,
    });
  });

  // Le refus doit précéder toute exécution : rien ne part sur le réseau.
  test('refuse une écriture sans exécuter quoi que ce soit', async () => {
    const { outil, appels } = fabriqueEcriture();
    const r = await invoquer([outil], contexte({ allowWrites: false }), 'ecrire', { cible: 'x' });

    assert.equal(r.isError, true);
    assert.equal(corps(r).error, 'WRITES_DISABLED');
    assert.equal(appels(), 0);
  });

  test('laisse passer l’écriture quand elle est autorisée', async () => {
    const { outil, appels } = fabriqueEcriture();
    const r = await invoquer([outil], contexte({ allowWrites: true }), 'ecrire', { cible: 'x' });

    assert.equal(r.isError, undefined);
    assert.equal(appels(), 1);
  });

  test('rend le code métier d’une erreur GraphQL', async () => {
    const outil = defineTool({
      name: 'casse',
      title: 'Casse',
      description: 'Lève.',
      inputSchema: {},
      execute: async () => {
        throw new GraphQLCallError('GET_USER_USECASE_USER_NOT_FOUND', { messages: ['…'] });
      },
    });
    const r = await invoquer([outil], contexte(), 'casse', {});

    assert.equal(r.isError, true);
    assert.equal(corps(r).error, 'GET_USER_USECASE_USER_NOT_FOUND');
  });

  test('une erreur inattendue ne fait pas tomber le serveur', async () => {
    const outil = defineTool({
      name: 'boum',
      title: 'Boum',
      description: 'Lève n’importe quoi.',
      inputSchema: {},
      execute: async () => {
        throw new Error('surprise');
      },
    });
    const r = await invoquer([outil], contexte(), 'boum', {});

    assert.equal(r.isError, true);
    assert.equal(corps(r).error, 'TOOL_FAILED');
  });

  test('refuse un catalogue qui déclare deux fois le même nom', () => {
    assert.throws(
      () => createMcpServer({ name: 't', version: '0', catalog: [lecture, lecture], ctx: contexte() }),
      /deux fois/,
    );
  });

  test('marque en clair les écritures visant la production', async () => {
    const { outil } = fabriqueEcriture();
    const vues: string[] = [];
    const proto: any = Object.getPrototypeOf(
      createMcpServer({ name: 't', version: '0', catalog: [], ctx: contexte() }),
    );
    const original = proto.registerTool;
    proto.registerTool = function (n: string, cfg: any, cb: Function) {
      vues.push(cfg.description);
      return original.call(this, n, cfg, cb);
    };
    try {
      createMcpServer({
        name: 't',
        version: '0',
        catalog: [lecture, outil],
        ctx: contexte({
          target: { url: 'https://api.siguri.happykiller.net/graphql', host: 'api.siguri.happykiller.net', isProd: true },
        }),
      });
    } finally {
      proto.registerTool = original;
    }

    assert.ok(vues[1].startsWith('[PRODUCTION] '), vues[1]);
    // La lecture n'est pas préfixée : le signal doit rester rare pour compter.
    assert.ok(!vues[0].startsWith('[PRODUCTION] '), vues[0]);
  });
});
