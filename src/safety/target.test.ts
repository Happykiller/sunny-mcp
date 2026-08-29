import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AVEU_PROD, resolveTarget, TargetRefusedError } from './target.js';

describe('resolveTarget', () => {
  test('accepte les hôtes locaux sans aveu', () => {
    for (const url of [
      'http://localhost:19090/graphql',
      'http://127.0.0.1:19090/graphql',
      'http://[::1]:19090/graphql',
    ]) {
      const cible = resolveTarget(url);
      assert.equal(cible.isProd, false, url);
    }
  });

  test('refuse un hôte distant sans aveu', () => {
    assert.throws(
      () => resolveTarget('https://api.siguri.happykiller.net/graphql'),
      TargetRefusedError,
    );
  });

  // Le refus doit résister aux valeurs qu'on pose par réflexe.
  test('refuse un aveu approximatif', () => {
    for (const aveu of ['true', '1', 'yes', 'oui', 'YES-I-KNOW', '']) {
      assert.throws(
        () => resolveTarget('https://api.siguri.happykiller.net/graphql', aveu),
        TargetRefusedError,
        `aveu accepté à tort : ${JSON.stringify(aveu)}`,
      );
    }
  });

  test('accepte un hôte distant avec l’aveu exact, et le signale', () => {
    const cible = resolveTarget(
      'https://api.siguri.happykiller.net/graphql',
      AVEU_PROD,
    );
    assert.equal(cible.isProd, true);
    assert.equal(cible.host, 'api.siguri.happykiller.net');
  });

  test('refuse une URL invalide', () => {
    assert.throws(() => resolveTarget('pas-une-url'), TargetRefusedError);
  });
});
