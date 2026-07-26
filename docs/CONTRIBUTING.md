# Contributing — facilitatorx402

Merci de contribuer à facilitatorx402. Ce guide couvre les conventions, le workflow de développement et les exigences de qualité.

## Prérequis

- Node.js 20+
- Docker + docker-compose
- pnpm (recommandé) ou npm

## Setup local

```bash
git clone https://github.com/OrizonLab/facilitatorx402.git
cd facilitatorx402
cp .env.example .env        # adapter les valeurs
docker-compose up -d        # PostgreSQL + Redis
npx prisma migrate dev      # migrations + client
npm install
npm run dev                 # démarrage avec hot reload
```

## Structure des branches

| Branche | Rôle |
|---|---|
| `main` | Code stable, deployable |
| `feat/<name>` | Nouvelle fonctionnalité |
| `fix/<name>` | Correction de bug |
| `chore/<name>` | Maintenance (deps, CI, docs) |
| `test/<name>` | Ajout de tests uniquement |

## Conventions de commit

Nous suivons [Conventional Commits](https://www.conventionalcommits.org/) :

```
feat(verify): add expiration buffer config
fix(settle): prevent double lock on retry
test(webhook): add HMAC replay protection test
chore(deps): upgrade viem to 2.x
docs(api): add settle payload examples
```

Types valides : `feat`, `fix`, `test`, `docs`, `chore`, `refactor`, `perf`, `ci`

## Tests

```bash
npm test              # tous les tests (vitest)
npm run test:watch    # mode watch
npm run test:coverage # rapport de couverture
```

### Tests obligatoires pour chaque PR

- [ ] Les tests existants passent tous
- [ ] Nouveau code couvert par des tests unitaires ou d'intégration
- [ ] Les cas d'erreur sont testés (pas seulement le happy path)
- [ ] L'idempotence est testée si la PR touche `/settle`
- [ ] L'anti-replay est testé si la PR touche `/verify`

### Organisation des tests

```
src/tests/
  verify.unit.test.ts        # tests unitaires du moteur verify
  settle.unit.test.ts        # tests unitaires du moteur settle
  anti-replay.test.ts        # protection anti-replay
  idempotence.test.ts        # idempotence settle
  webhook.integration.test.ts # livraison webhook
  seller.integration.test.ts  # CRUD seller
  receipts.test.ts            # persistance reçus
  health.test.ts              # endpoint health
  supported.test.ts           # endpoint supported
```

## Lint et typage

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
```

Les deux doivent passer sans erreur avant de soumettre une PR.

## Ajouter un nouveau réseau

1. Ajouter l'entrée dans `src/protocol/supported-networks.ts`
2. Ajouter les variables RPC dans `.env.example`
3. Ajouter les tests de vérification pour ce réseau
4. Documenter dans `docs/api-reference.md` (section `GET /supported`)

## Ajouter un nouveau asset

1. Ajouter l'entrée dans `src/protocol/supported-assets.ts`
2. Vérifier la compatibilité EIP-3009 du contrat ERC20
3. Ajouter l'adresse de contrat pour chaque réseau supporté
4. Ajouter les tests de vérification de signature pour ce token

## Modifier le schéma Prisma

```bash
# Modifier prisma/schema.prisma
npx prisma migrate dev --name describe_your_change
npx prisma generate
```

Toute migration doit être réversible ou accompagnée d'un script de rollback.

## Sécurité

- Ne jamais commiter de vraies clés ou secrets
- Utiliser `.env` (gitignore) pour les valeurs locales
- Les secrets de production sont gérés via des variables d'environnement injectées au déploiement
- Signaler les vulnérabilités via GitHub Security Advisories (pas en issue publique)

## Process de PR

1. Créer une branche depuis `main`
2. Développer + tester localement
3. `npm run lint && npm run typecheck && npm test`
4. Pousser et ouvrir une PR avec description du changement
5. La PR doit être approuvée avant merge
6. Squash merge sur `main`

## Questions

Ouvrir une discussion GitHub ou une issue avec le label `question`.
