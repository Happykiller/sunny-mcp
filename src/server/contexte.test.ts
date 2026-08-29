import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { createMcpServer } from './createMcpServer.js';
import { defineTool } from '../tools/defineTool.js';
import { silentLogger } from '../logger.js';
import type { Appelant, ToolContext } from '../tools/defineTool.js';

const cible = {
  url: 'https://mcp.exemple.test/mcp',
  host: 'mcp.exemple.test',
  isProd: true,
};

/** Invoque un outil en simulant ce que le transport dépose sur la requête. */
const invoquer = async (
  ctx: ToolContext | ((a: Appelant | undefined) => ToolContext),
  authInfo: unknown,
  outil: any,
) => {
  const rappels = new Map<string, Function>();
  const proto: any = Object.getPrototypeOf(
    createMcpServer({ name: 't', version: '0', catalog: [], ctx: ctx as any }),
  );
  const original = proto.registerTool;
  proto.registerTool = function (n: string, _c: any, cb: Function) {
    rappels.set(n, cb);
    return original.call(this, n, _c, cb);
  };
  try {
    createMcpServer({ name: 't', version: '0', catalog: [outil], ctx: ctx as any });
  } finally {
    proto.registerTool = original;
  }
  const r: any = await rappels.get(outil.name)!({}, { authInfo });
  return JSON.parse(r.content[0].text);
};

describe('contexte par appelant', () => {
  const sonde = (vu: { appelant?: Appelant }) =>
    defineTool({
      name: 'sonde',
      title: 'Sonde',
      description: 'Rend l’appelant vu par l’outil.',
      inputSchema: {},
      execute: async (_a, ctx) => {
        vu.appelant = ctx.appelant;
        return { ok: true };
      },
    });

  // Sans cela, tout le monde agirait sous la même identité sur un transport
  // partagé, et aucune action ne serait attribuable.
  test('transmet le sujet et les scopes du jeton à l’outil', async () => {
    const vu: { appelant?: Appelant } = {};
    const fabrique = (appelant: Appelant | undefined): ToolContext => ({
      gql: {} as never,
      target: cible,
      allowWrites: true,
      logger: silentLogger,
      appelant,
    });

    await invoquer(fabrique, {
      token: 'jeton-abc',
      scopes: ['produit:admin'],
      extra: { sub: 'compte-42' },
    }, sonde(vu));

    assert.equal(vu.appelant?.sub, 'compte-42');
    assert.deepEqual(vu.appelant?.scopes, ['produit:admin']);
    assert.equal(vu.appelant?.token, 'jeton-abc');
  });

  test('sans jeton — cas du transport stdio — l’appelant est absent', async () => {
    const vu: { appelant?: Appelant } = {};
    const fabrique = (appelant: Appelant | undefined): ToolContext => ({
      gql: {} as never,
      target: cible,
      allowWrites: true,
      logger: silentLogger,
      appelant,
    });

    await invoquer(fabrique, undefined, sonde(vu));

    assert.equal(vu.appelant, undefined);
  });

  // La fabrique doit être consultée à CHAQUE appel : un contexte mémorisé
  // ferait agir le second appelant sous l'identité du premier.
  test('la fabrique est rappelée à chaque invocation', async () => {
    let appels = 0;
    const fabrique = (appelant: Appelant | undefined): ToolContext => {
      appels += 1;
      return {
        gql: {} as never,
        target: cible,
        allowWrites: true,
        logger: silentLogger,
        appelant,
      };
    };
    const vu: { appelant?: Appelant } = {};
    const outil = sonde(vu);

    await invoquer(fabrique, { token: 'a', scopes: [], extra: { sub: 'un' } }, outil);
    await invoquer(fabrique, { token: 'b', scopes: [], extra: { sub: 'deux' } }, outil);

    assert.equal(appels, 2);
    assert.equal(vu.appelant?.sub, 'deux');
  });

  test('un contexte fixe reste accepté', async () => {
    const vu: { appelant?: Appelant } = {};
    const fixe: ToolContext = {
      gql: {} as never,
      target: cible,
      allowWrites: true,
      logger: silentLogger,
    };

    const corps = await invoquer(fixe, undefined, sonde(vu));

    assert.equal(corps.ok, true);
    assert.equal(vu.appelant, undefined);
  });
});
