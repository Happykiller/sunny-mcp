
## Note sur les tests

`npm test` passe `--test-force-exit` : le transport HTTP du SDK garde des
ressources que la fermeture du serveur n'emporte pas toutes, et le lanceur ne
rendait jamais la main alors que tous les cas passaient. Le drapeau est prévu
pour cela. Les assertions, elles, ne sont pas affaiblies : les cas de
`transport.test.ts` exercent de vraies requêtes HTTP.
