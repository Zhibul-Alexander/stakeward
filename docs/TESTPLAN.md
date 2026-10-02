# Ручной тест-план

Пункты «Проверяю я» из шагов сборки. Перед подачей весь список проходится на prod.
Отметка: `- [x]` и дата, или заметка, что пошло не так.

## Шаг 0. Подготовка

- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` проходят на чистом клоне.
- [ ] GitHub Actions зелёные на последнем push.
- [ ] Заглушка prod открывается по постоянному домену, заголовки безопасности на месте (`curl -I https://<домен>/`).
- [ ] Проверка Helius (getProgramAccounts по стейк-программе на devnet и mainnet) записана в docs/DECISIONS.md.

## Шаг 1. Проверка механизма

- [ ] Devnet: спонсор `.keys/devnet-funder.json` (`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`) пополнен минимум на 1,01058496 SOL (https://faucet.solana.com), `pnpm gate:devnet` прошёл: 21 из 21 шага совпали, возврат средств завершён.
- [ ] Mainnet: на одноразовый ключ `.keys/mainnet-gate.json` (`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`) переведено 0,02 SOL (минимум 0,00238128), `pnpm gate:mainnet` прошёл: 8 из 8 шагов совпали. Остаток выведен: `solana transfer --from .keys/mainnet-gate.json <адрес> ALL --url mainnet-beta`.
- [ ] docs/gate.md прочитан: по каждой проверке есть результат и подпись или код ошибки для LiteSVM, devnet и mainnet.
