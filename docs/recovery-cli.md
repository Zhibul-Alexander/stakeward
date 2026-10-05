# Команды карточки восстановления

Скрипт `scripts/recovery-cli.ts` (шаг 8, DECISIONS D78) выполняет каждую команду Solana CLI из карточки
восстановления (`recoveryCommands` в `packages/core/src/recovery.ts`) на настоящем кластере. Команда набирается так,
как её набирает человек: строка карточки, вместо каждого `<…>` — путь к файлу ключа, адрес или дата в двойных
кавычках, запуск через `bash -c` (и `zsh -c`, если zsh установлен). HOME и рабочая папка команд — пустая папка,
поэтому им не нужны ни конфигурация CLI, ни ключ по умолчанию. Перед запуском скрипт проверяет, что каждая оболочка
разбирает строку ровно в те аргументы, которые должна получить программа.

Ключи прогона одноразовые и лежат в `.keys/recovery-<кластер>/`: A — основной ключ, K — второй, K2 — новый второй,
D — новый кошелёк, X — вор с украденным A. Проверки C должны пройти; проверки N должны упасть с тем сообщением, которое
объясняет карточка; H сверяет флаги шаблонов с `solana <команда> --help`; S1 — вид с переносами строк; I1 — адрес
установщика. В конце всё, кроме комиссий сети, возвращается спонсору.

- Localnet: запустить `solana-test-validator`, затем `pnpm recovery-cli --url localhost --funder <файл ключа с SOL>`.
- Devnet: `pnpm recovery-cli --url devnet`, спонсор `.keys/devnet-funder.json` (около 1,15 SOL; около 0,13 SOL с
  `--skip-delegated`, тогда N3, N9 и C8 не выполняются).

Mainnet скрипт не запускает (проверка по genesis hash). Каждый прогон переписывает только свой раздел этого файла.
Адрес RPC провайдера (`--url <адрес>`) этот файл и консоль показывают только началом, `https://<хост>/…`: ключ API из
адреса никуда не записывается.

<!-- recovery-cli:localnet:begin -->
## Localnet (solana-test-validator)

Прогон 2026-10-05 15:27:17 UTC: 26 из 26 проверок прошли.

- solana-cli 4.3.0 (src:44b42d45; feat:c9ad34d2, client:Agave); RPC `http://127.0.0.1:8899`.
- Оболочки: GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu).
- Ключи: A (основной) `DVZsrZfgBihLBwiUAGc136Mmj9TBuQ71nqvd4E94r9kL`, K (второй) `8YiG4GgPxVZf4VBxbqdwGERvyApjUr7521iUFTLEb3U`, K2 (новый второй) `EN4YJn4NDEMUHjgYG84bgsHs6QSPv6LvYJa2CMx72ydJ`, D (новый кошелёк) `2aMUx3KL4sEMoUJS6sWnLFvKYoVYotM2w3otdp4ckDVX`, X (вор) `FnXrY9SnHma655UZreNoEeey95rsDRncB97UdjAdvigN`. Спонсор `DYQEDkUXPzKUhZhMcgKPJxDTDYUFzo8XtmW8fJfK1XLN`.
- Замки по часам кластера: T = 2026-10-05T17:27:25Z, T2 = 2026-10-05T19:27:25Z, T3 = 2026-10-05T21:27:25Z, короткий (short) = 2026-10-05T15:28:55Z.
- Потрачено спонсором: 375 000 лампортов (0,000375 SOL); остальное вернулось.
- C12: split-stake без флагов: «Error: Bad parameter: need at least ◎1.000000000 for minimum stake delegation, provided: ◎0.003282880»; с `--rent-exempt-reserve-sol 0.00228288` CLI эту проверку пропускает. На split′ 0,00556576 SOL: 0,00328288 SOL из split и залог 0,00228288 SOL, который CLI сам перевёл с плательщика X в той же транзакции (X потратил 0,00229288 SOL). Split копирует замок: хранитель K.
- Сообщения `CLI_ERROR_MESSAGES`, которые вызвали проверки N: `lockup`, `custodian`, `authority`, `fee`, `date`, `file`, `funds`, `signature`, `device`; не вызваны: `rewards`.
- Возврат спонсору: rescue 0,01228288 SOL, split 0,009 SOL, split2 0,00556576 SOL, кошельки 1,1020894 SOL.
- На ключах прогона ничего не осталось.

| № | Команда карточки | Ожидание | Результат | Подпись или сообщение |
|---|---|---|---|---|
| I1 | Установщик из карточки: HEAD https://release.anza.xyz/v4.3.0/install | HTTP 200 | прошла: HTTP 200 |  |
| H | `solana <команда> --help` для каждого шаблона карточки и `solana-keygen pubkey --help` | каждый флаг шаблона описан | прошла: шаблонов: 10, подкоманд: 8, флагов: 33 |  |
| C0 | find: `solana stakes --withdraw-authority <адрес A>` | все 7 аккаунтов подготовки | прошла: найдены все 7 |  |
| N1 | withdraw-alone на запертом `withdraw` (подпись только A) | ошибка `lockup has not yet expired` | прошла: ошибка | `Error: lockup has not yet expired` |
| C2 | withdraw на `withdraw` подписями A и K; получатель `<MAIN_KEY>` — файл ключа A | успех: аккаунт закрыт, баланс A вырос | прошла: аккаунт закрыт, баланс A +0,01227288 SOL | `WtH1…jmpZ` |
| N2 | Вор (обычная команда): `stake-authorize-checked rescue --withdraw-authority A --new-withdraw-authority X --fee-payer X` | ошибка `custodian address not present` | прошла: ошибка | `Error: custodian address not present` |
| C3 | Вор (обычная команда) забирает staker у `rescue`; затем rescue: подписи A, D, K, платит D | успех: staker = withdrawer = D, замок прежний, баланс A не изменился | прошла: staker D, withdrawer D, замок прежний (K, T), баланс A не изменился | `5hVA…JQqz` · `4Wim…5nNM` |
| C12 | Вор (обычные команды, подпись X): забирает staker у `split`, `split-stake split split′`; затем find и rescue `split′` | успех: find видит split′; staker = withdrawer = D | прошла: find видит split′; staker D, withdrawer D | `4YCL…m75s` · `2vox…Gf9k` · `pmWL…5mNj` |
| N5 | rescue на `extend` с `--custodian` = файл ключа X | ошибка `lockup has not yet expired` | прошла: ошибка | `Error: lockup has not yet expired` |
| N4 | extend на `extend` с `--custodian <MAIN_KEY>` | ошибка `Invalid authority provided` | прошла: ошибка | `Error: RPC request error: Invalid authority provided: DVZsrZfgBihLBwiUAGc136Mmj9TBuQ71nqvd4E94r9kL, expected [8YiG4GgPxVZf4VBxbqdwGERvyApjUr7521iUFTLEb3U]` |
| C4 | extend на `extend` до T2, платит K | успех: дата замка = T2 | прошла: дата замка 2026-10-05T19:27:25Z | `46Hq…4pDo` |
| C5 | extend на `extend` до T3, платит A (`--fee-payer <MAIN_KEY>`) | успех: дата замка = T3, комиссию заплатил A | прошла: дата замка 2026-10-05T21:27:25Z; A -0,00001 SOL, K 0 SOL | `xwKK…TChP` |
| N7 | extend с новым пустым `--fee-payer` | ошибка `insufficient funds for fee` | прошла: ошибка | `Error: Account FUApE7qwXqs84rqugRuj7MzC6hFAfjMKiPovrA8CYkPT has insufficient funds for fee (0.00001 SOL)` |
| N8 | extend с `<NEW_END_DATE>` = `2027-01-01` (без времени) | ошибка `premature end of input` | прошла: ошибка | `error: Invalid value for '--lockup-date <RFC3339 DATETIME>': premature end of input` |
| N10a | extend с `--custodian` = путь к несуществующему файлу | ошибка `No such file or directory` | прошла: ошибка | `error: Invalid value for '--custodian <KEYPAIR>': No such file or directory (os error 2)` |
| N10b | extend, `<SECOND_KEY>` не заменён, через bash в пустой папке | ошибка `No such file or directory` от оболочки, файлов не появилось | прошла: сообщение оболочки; папка пуста | `bash: line 1: SECOND_KEY: No such file or directory` |
| C6 | remove-lock на `extend` (K), show, затем withdraw-alone (A) | успех: в show нет строк Lockup; аккаунт закрыт | прошла: show без строк Lockup; аккаунт закрыт | `4LaL…4kgS` · `26MC…Ctjr` |
| C7 | change-second-key на `swap` → K2 (платит K2), затем withdraw с `<SECOND_KEY>` = K2 | успех: хранитель K2, дата прежняя; аккаунт закрыт | прошла: хранитель K2, дата прежняя; аккаунт закрыт | `2Yfm…T9ms` · `5Xcf…BibZ` |
| N3 | withdraw (A и K) на делегированном `delegated` | ошибка `insufficient funds for instruction` | прошла: ошибка | `Error: RPC response error -32002: Transaction simulation failed: Error processing Instruction 0: insufficient funds for instruction; 5 log messages:` |
| N9 | deactivate (подпись A) на `delegated` после того, как вор (обычная команда) забрал у него staker | ошибка `missing required signature for instruction` | прошла: ошибка; затем A (withdrawer) вернул себе staker | `Error: RPC response error -32002: Transaction simulation failed: Error processing Instruction 0: missing required signature for instruction; 5 log messages:` |
| C8 | deactivate `delegated`, затем withdraw (A и K) | успех: аккаунт закрыт | прошла: аккаунт закрыт; вывод сразу после снятия (та же эпоха) | `CiaJ…YJa7` · `3Zs5…Hoxg` |
| C9 | Дождаться по часам кластера конца короткого замка `short`, затем withdraw-alone (A) | успех: аккаунт закрыт | прошла: аккаунт закрыт | `aEid…xMai` |
| C10 | show на спасённом `rescue` | `Withdraw Authority: D`, `Lockup Custodian: K`, `Lockup Timestamp: T` | прошла: все три строки на месте |  |
| C11 | epoch | `Epoch Completed Time` | прошла: строка на месте | `Epoch Completed Time: 31m 39s/3days 20h 45m 41s (3days 20h 14m 2s remaining)` |
| S1 | Вид карточки с ` \` в конце строк (по аргументу на строку): show и epoch | тот же вывод, что у команды в одну строку | прошла: bash: совпадает |  |
| N6 | `solana-keygen pubkey "usb://ledger?key=0"` без Ledger | ошибка `no device found` или адрес | прошла: ошибка | `Error: no device found` |
<!-- recovery-cli:localnet:end -->

<!-- recovery-cli:devnet:begin -->
## Devnet

Ещё не запускался.
<!-- recovery-cli:devnet:end -->
