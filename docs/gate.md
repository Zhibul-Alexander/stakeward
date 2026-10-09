# Проверка механизма

Скрипт `scripts/gate.ts` (CLAUDE.md, шаг 1) проверяет на настоящей стейк-программе правила замка (lockup), на которых
держится Stakeward. Транзакции, которые отправляет и продукт, собирает `buildTransaction` из `packages/core`: формат
из §4 и старый порядок аккаунтов для Ledger (D1). Действия, которых в продукте нет (AuthorizeChecked вора, Split,
Merge), собраны в том же формате. Неудачные транзакции в devnet и mainnet отправляются без preflight, поэтому у них
тоже есть подпись в сети. Ключи: A — основной, B — второй (хранитель замка), X — staker вора, D — новый кошелёк.

- LiteSVM: `pnpm gate:litesvm`. Тот же прогон идёт в CI как тест `scripts/gate/gate.test.ts`.
- Devnet: `pnpm gate:devnet`. Платит ключ-спонсор `.keys/devnet-funder.json`, ключи ролей прогона лежат в `.keys/gate-devnet-<роль>.json`, в конце всё, кроме комиссий, возвращается спонсору.
- Mainnet: `pnpm gate:mainnet`. Одноразовый ключ `.keys/mainnet-gate.json`, неделегированный аккаунт, проверки 2, 3, 4, 5, 6 и 13, в конце всё выводится обратно на этот ключ.

Адрес RPC задаёт переменная `RPC_URL`, по умолчанию — публичный узел кластера. Каждый прогон переписывает только
свой раздел этого файла.

<!-- gate:litesvm:begin -->
## LiteSVM

Прогон 2026-10-02 12:30:22 UTC: 24 из 24 шагов совпали с ожиданием.

- Стейк-программа: загружена в LiteSVM из фикстуры; programdata `6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`, слот развёртывания 447552000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-01 00:00:00 UTC, эпоха 1000.
- Ключи: A `4di5mPweJ4aCrPgQzNBX79hu94r7HRLWf7rgoi3UyTxP`, B `9tqoyYBtbkCchHq4AyQJFD4r4tBSYCLFk8aM7QUsPb14`, X `4dZLYQ6hosuBSiXMGEmhPWf3aXvQE3FNeXiDzYUiB7JZ`, D `Ci7j9ARdgsf5urFhmayM23c7LAfBZidGtt2wMyesgMy`. Спонсор `Bj4dEuVP4ivazEqJUZXnGrMu2oPSy7wuWBbpfzF4sQz4`.
- Делегация на vote-аккаунт `2mL64qC2BuhyWWqEFZSgqB7XDY4YAVciNFik9smGViaa`.
- Транзакций: 33, комиссии сети: 284 800 лампортов (0,0002848 SOL). На старте у плательщика было ровно 1,0122736 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - Sm `5uhuU5ts2hg4jzva3EEU52WrEkbw4hcmpP1rYAdkkFrA`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `2QLxPxB6ndeMFdZtfeGMQxmyV8ce9Y3fWDFTTwCSh3Pq`: Withdraw 0,50166624 SOL плательщику: ok
  - S3 `CS66NFGPsoUFjVBfSr7eCdHzJ85uoPZB4whLh4gym3Th`: Withdraw 0,00166624 SOL плательщику: ok
  - остатки ключей ролей (0,50633984 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | `4s1H…AfNM` |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован 2mL64qC2BuhyWWqEFZSgqB7XDY4YAVciNFik9smGViaa в эпохе 1000 | `5MrW…u57v` |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | `Quqx…GSL4` |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · `4SGd…VbpQ` |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `3jGM…6t2K` |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · `cj7k…HKQr` |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `DTAV…QUZA` |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1000 | `4saq…1dKe` |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `2w7o…XCqQ` |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `4A5m…k58F` |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `NfeL…PPrX` |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · `3iXM…9NiP` |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | `4cP5…n61z` |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `25pu…GzqR` |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `4RkB…XE3i` |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `3DvX…FUs5` |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт 3j5NBE5PEJSHgADYhvFM5SZeUWod8P7LHvFPM2K7N3M2, authority D | `4FdH…E3bi` |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | `2PBf…TaQ9` |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | `2t4y…7UDS` |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | `2bvk…aJVW` |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `21sj…Qc3U` |
| 14a | S4 заперт B до T: Withdraw с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `RXda…R6qf` |
| 14b | Часы переведены за T: SetLockup (unix_timestamp = 0) с подписью только A | успех | совпало: успех; unix_timestamp = 0, хранитель B | `2jFR…PUgp` |
| 14c | Withdraw всего S4 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `KBiD…y1Lu` |
<!-- gate:litesvm:end -->

<!-- gate:devnet:begin -->
## Devnet

Прогон 2026-10-05 19:17:17 UTC: 21 из 21 шагов совпали с ожиданием.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ?cluster=devnet), слот развёртывания 488592000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-05 19:17:16 UTC, эпоха 1175.
- Ключи: A [`DsVicjjukSh4aySPjc2Gcrer5ZYLZe9P3yVEhhrdFDj4`](https://explorer.solana.com/address/DsVicjjukSh4aySPjc2Gcrer5ZYLZe9P3yVEhhrdFDj4?cluster=devnet), B [`4BioE3hQ6pg769nvAHMvooKRF2kFTHEZC3D1eEz9g9oJ`](https://explorer.solana.com/address/4BioE3hQ6pg769nvAHMvooKRF2kFTHEZC3D1eEz9g9oJ?cluster=devnet), X [`Fut4AhBAWjZHNcVa5ATxRAifVtrMstSbBkKuJWta5aNm`](https://explorer.solana.com/address/Fut4AhBAWjZHNcVa5ATxRAifVtrMstSbBkKuJWta5aNm?cluster=devnet), D [`4rEYg3q966k9f4DUDMX42SGErZjhr9yb1VNWi4fvvwzR`](https://explorer.solana.com/address/4rEYg3q966k9f4DUDMX42SGErZjhr9yb1VNWi4fvvwzR?cluster=devnet). Спонсор [`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`](https://explorer.solana.com/address/D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL?cluster=devnet).
- Делегация на vote-аккаунт [`vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG`](https://explorer.solana.com/address/vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG?cluster=devnet).
- Транзакций: 29, комиссии сети: 262 400 лампортов (0,0002624 SOL). На старте у плательщика было ровно 1,01058496 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - Sm `B5BwHCKKHmGhjkqdmmbjJanaeJVNifNRAerNUtgoEhz9`: Withdraw 0,00166624 SOL плательщику: ok
  - S3 `HoZsFZBNDaw3TusK1N5QATxaQAGjx2mFzJivdCoXdye`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `EYusAfswCZn4DedLJzTpVBSQnCbM9qX8bCWfyNS4DxPe`: Withdraw 0,50166624 SOL плательщику: ok
  - остатки ключей ролей (0,5046736 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | [3iRZ…vpYz](https://explorer.solana.com/tx/3iRZJoWuMyX74EaJV2T4hMXuzbXr7kXz1GXtYFB3roe7XSPTtXrreaBvmbbLog5KzrBPrXWk622RV13dU1W5vpYz?cluster=devnet) |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG в эпохе 1175 | [4RD8…ptom](https://explorer.solana.com/tx/4RD8ZStMYcZLq1HJxhLG9wypBzGCqSMK4XogbajvTi9ovL23xvm7pLdYFfAZcXG9VMFzzkwdkKSxTDSkpPsCptom?cluster=devnet) |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-05 20:17:28 UTC, хранитель B | [2ErQ…rYuR](https://explorer.solana.com/tx/2ErQ7wj3SWtQA9zch9p5posjfBY3kuwB78qrjALZZcSSo1UGer1qq6VfkFXYmXvKbEqBm2LfS6feNGEYxZ1TrYuR?cluster=devnet) |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · [2Tbf…oDsu](https://explorer.solana.com/tx/2TbfEvJEX5G8xzpFeZpEFasRh2xvtb8j9Jogc6zTHy6TH4Bw4EQAgVnuJJPwYcoRHgAB87xZJWWtYKa6MqTwoDsu?cluster=devnet) |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-05 20:17:28 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [1WyS…dMda](https://explorer.solana.com/tx/1WySKG8tSfiyENxvxqZRnTb51otPoLnorEc9dkXVvGUP4P27TJsKmout8PKs9Ef1r5gZercDzCyGjBscjRvdMda?cluster=devnet) |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-05 20:17:28 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · [2AyN…aMa9](https://explorer.solana.com/tx/2AyN132wnHcGRYwp57XEbcNiMe3WPzYx1kvfd2QV2UWBYhg3rvSyEVoWtGb7wdXz9HsvU35b1ytuHnYrkQwzaMa9?cluster=devnet) |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-05 21:17:43 UTC, хранитель B | [58sT…vhHA](https://explorer.solana.com/tx/58sTMu8tsY1X13ksmnXr1uSBawULrvG35SzfGSBXH7yY64tfoMtmdkGvig9xAQwJYzZU6g2WCae2cpSPLQFxvhHA?cluster=devnet) |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1175 | [2LD6…gEZH](https://explorer.solana.com/tx/2LD6Y4NJrKR5gcC3yX42CmDicTQX3ixSyPzxgJYm3dPjX9fJiRHzB3LCTnDXqgiULhfzudUhQJZ82tZS1tHJgEZH?cluster=devnet) |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-05 21:17:43 UTC, хранитель B | [5hX6…j7cz](https://explorer.solana.com/tx/5hX6bgMggXMzEvwv5mtXzqi7kKqUfkCcMGpGHBHGt1UPo7Ra3tgD38YCygkoTNQnLkHTdvdfiVS9BVrAvYvKj7cz?cluster=devnet) |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-05 21:17:43 UTC, хранитель B | [UQHS…h23r](https://explorer.solana.com/tx/UQHSThmrMXSL4Es6L9e7ZZgKXoVb3oUh5oYUhKtX7o4AWwMUmWefz78Krm8Zo9WAk9Up74mkAw6ptwviPw5h23r?cluster=devnet) |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · [51ZY…aJE5](https://explorer.solana.com/tx/51ZYZhgcX4sQiaPvAVLSqgiH7HZLtK7VVnhpNo2TPXJ5eVTCRDKHqjCRX8c69F5kgwtp8RD77hybCf5XbYRVaJE5?cluster=devnet) |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · [3bHw…bdyc](https://explorer.solana.com/tx/3bHweAH6mNTeybsPoorLvsUp62vBd4oDxNi53ELMVZUvw5s4mZAXpaiMX3GGNfjU8HNBPC3RosDxACRvdEYtbdyc?cluster=devnet) |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | [5jkf…amtb](https://explorer.solana.com/tx/5jkfXEgfm76SFDZip9VYYD8fKF9NQEUD9U4vWinRm7SxxVRN4S5wHHhqxYWzwG19SiDxgguFJ13xKQH2tRiFamtb?cluster=devnet) |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-05 21:17:43 UTC, хранитель B | [4Fca…Z5fu](https://explorer.solana.com/tx/4FcasDwiXdC38VZr9AyGSFU6371ZEDdMSshwuCDE2NgLaDdRTd3KNLvyfpHWPZgCfBDNARFbBeL5VkHi2R4MZ5fu?cluster=devnet) |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · [5hHE…3PwW](https://explorer.solana.com/tx/5hHESQcbyEytkFsXHVSLoFAWeMFYDAtdGPhKSZG3eoPj1QSLbZNcKbgs2tHuZ6PBwDeqqbsSL2VLeuvuZQDq3PwW?cluster=devnet) |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · [2Zwg…p2Tr](https://explorer.solana.com/tx/2Zwg43RUbKLqq51xNovaWEEXgq8xpx4UmAK93VXUMVNxFj6sDN7z8T9B6x1TU7xj8XTf6PfQuaeF52GkJVgAp2Tr?cluster=devnet) |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт HzGjt6ApGyZvhzy4BNoy3J5S8bot94CnWMdnHW6UHnNm, authority D | [21ym…jxGk](https://explorer.solana.com/tx/21ymzVWX9FPynMov9Yfc7fB7YwT2sKmYvYXNz4HyoXbRgyH8dB2AcqrCA8RUmpidsu2CSSsrUEytaAamcCWEjxGk?cluster=devnet) |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-05 21:18:18 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | [hWuU…KwRt](https://explorer.solana.com/tx/hWuUwKf4gBNBvdeiTj6BNrNyJ5k3d51BPvZsidGWKcNL4LNTKUra8viDTxLq1uuNhC1mL5eyi34Cjq9yyL3KwRt?cluster=devnet) |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | [51z2…1wDq](https://explorer.solana.com/tx/51z2uAJuzAjVGwPHMS9TontMBKwS83wW5KexojvakgBvdWCUPdh6sG5nWhGVSEuSH8YBbtu8TDWDucMYkDKm1wDq?cluster=devnet) |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | [5TpS…6cKK](https://explorer.solana.com/tx/5TpS3pfEqpQ4YqhqhotMU5cWbCWhuD9iFyWWNQDJHsj3JmoPghHutg9yfN7yJDnMuSxRgu9MmdGYB9VuuyUe6cKK?cluster=devnet) |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | [5S2X…9Yo3](https://explorer.solana.com/tx/5S2X6LhHqaFgEd5WXEL1WbJBhcEiSs2g3VpuedN9swXVZ3vc91GPyTW8KCCjSrhZnmxQ7cNfEYS3s4KBvPNo9Yo3?cluster=devnet) |
<!-- gate:devnet:end -->

<!-- gate:mainnet:begin -->
## Mainnet

Прогон 2026-10-05 19:19:14 UTC: 8 из 8 шагов совпали с ожиданием.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ), слот развёртывания 443232000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-05 19:19:13 UTC, эпоха 1050.
- Ключи: A [`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`](https://explorer.solana.com/address/7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v), B [`FqwiJYpUropcknUZjfbFDoHibx9NV5obu6Vxuh37RvKy`](https://explorer.solana.com/address/FqwiJYpUropcknUZjfbFDoHibx9NV5obu6Vxuh37RvKy), X [`5ALW9faRpdoPiCnkhyJwJ2vNhPLkLA8DydSiqCwZA36a`](https://explorer.solana.com/address/5ALW9faRpdoPiCnkhyJwJ2vNhPLkLA8DydSiqCwZA36a). A — одноразовый ключ `.keys/mainnet-gate.json`, он же платит.
- Транзакций: 8, комиссии сети: 64 800 лампортов (0,0000648 SOL). На старте у плательщика было ровно 0,00238128 SOL.
- Возврат средств завершён, ключи ролей пусты.

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать неделегированный стейк-аккаунт S1: staker = withdrawer = A, без замка | успех | совпало: успех; 0,00166624 SOL, staker A, withdrawer A, без замка | [2bh5…S4Qt](https://explorer.solana.com/tx/2bh5rdCVCmaB1pf2U9gw5M66F1pkxukEicUbFSpHL3FVXWFhh8poHggTVTmsLAHA3p9NiBohshZuHaWpoX6CS4Qt) |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | [5w6k…pt9W](https://explorer.solana.com/tx/5w6kvDNJMs83Hb33ZaWS6fo2oSFq1jvazZvCcFfdjAppa7a7nXUGGeUwS2PbxSd9A8NK7Jer14XcSvUGaWNCpt9W) |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · [Antz…jLVw](https://explorer.solana.com/tx/AntzPaGpqwGtJ2cuBDwkUyG8Rqi4UwusuRJbrQA3v7qWwmS66hez8SMHuC5Zy1EE9tq64H54EVVsp3bthETjLVw) |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [5Qxo…LUZo](https://explorer.solana.com/tx/5Qxos9NKwaPu8Ci9eZpjktgfKN31Exktjn9rGmj4UbDiubBTfCoGb3yhDCy71noKoB8wqkviks8A4Lyqja1zLUZo) |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · [2M29…b15r](https://explorer.solana.com/tx/2M29CjDvd2SZLPWoupbdPetQTNXGZTQbiUEMW183Gpx9rfQ12gvkYb7UHpefpwgeqAx8aF6BD1KTimYxPvyfb15r) |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-05 21:19:29 UTC, хранитель B | [5hPW…AiQ2](https://explorer.solana.com/tx/5hPWGAurhptWxaNNn68Zau5h9LkMXxgXDsj1ZDqnie6yD19Lmpi2GHsdP2jJivJRyZx782Rr6LSjWGS7rxy7AiQ2) |
| 13a | B ставит unix_timestamp = 0 на S1 (комиссию платит A) | успех | совпало: успех; unix_timestamp = 0, хранитель B | [3Pzi…r4fB](https://explorer.solana.com/tx/3PzifCBLEpsh27coif52rukB1oic57kBg1QVRaLnqhcWJBxoa5HooQFba8RwNeKoX9KTsoGRMYt9khdo9bTSr4fB) |
| 13b | Withdraw всего S1 с подписью только A, обратно на одноразовый ключ | успех | совпало: успех; аккаунт закрыт, всё выведено | [u4iv…Whg1](https://explorer.solana.com/tx/u4ivXqSoCSjfNwRqYVLoaEfSs9zXdUyggVPPEeAeSRxRkopw6VkQKtREtjtMa4gyzCArMUV2WwEsRNhzrCxWhg1) |
<!-- gate:mainnet:end -->
