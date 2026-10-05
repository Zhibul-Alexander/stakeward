# Дизайн

Источник истины для токенов и компонентов — код (CLAUDE.md §9). Этот файл говорит, где что лежит, и хранит ссылки на
проект в Claude Design, когда владелец их сделает.

## Claude Design

- Проект дизайн-системы: **владелец** — ссылка после первого `/design-sync`.
- Макеты экранов (шаг 3б): **владелец**. Шаг 3б не начат; предложение из PROGRESS — утверждать экраны по снимкам
  `docs/screens` вместо отдельных макетов. Нужен повторный `/design-sync`: с 05.10 добавились `CommandBlock` и `StatTile`.

## Токены

`apps/web/src/styles/tokens.css` — единственное место с сырыми значениями: цвета светлой и тёмной темы, шрифты (Geist и
Geist Mono в бандле), шкала текста, шаг отступов, радиусы, тени, длительности анимаций. Роли цветов и тона статусов —
в шапке файла и в D28.

- Тёмная тема только для экрана (`@media screen and (prefers-color-scheme: dark)`); на бумаге всегда светлая (D80).
- При `prefers-reduced-motion` длительности нулевые.
- `apps/web/test/design-tokens.test.ts`: контраст обеих тем (текст 4,5:1, элементы управления и фокус 3:1) и запрет
  сырых цветов и произвольных значений вне `tokens.css`.

## Компоненты

Каталог со всеми состояниями — страница `/dev/ui` (только devnet), снимки `docs/screens/dev-ui-{1280,360}.png`.

Примитивы shadcn/ui на токенах (`apps/web/src/components/ui`): Alert, Badge, Button, Card, Checkbox, Input, Label,
Progress, RadioGroup, Separator, Skeleton, Spinner, Tooltip. Dialog, Select, DropdownMenu и другие компоненты Radix со
встроенным `<style>` запрещены CSP (D3, D29).

Компоненты продукта (`apps/web/src/components/product`), у каждого есть обычное состояние, загрузка, пустое и ошибка там,
где они имеют смысл:

| компонент | что показывает |
|---|---|
| StatusBadge | статус защиты словом, цветом и значком |
| AccountRow | стейк-аккаунт: сумма, статус защиты и стейкинга, действия |
| AddressText | адрес коротко или целиком, копирование, ссылка на эксплорер |
| SolAmount | сумма в SOL без потерь точности |
| WalletSlot | слот роли (Main key, Second key, New wallet) и кошелёк в нём |
| TransactionSummary | сводка инспектора: что было и что станет, кто подписывает, комиссия, чего транзакция не может |
| SignerList | кто подписал и кто ещё должен |
| StepProgress | шаги мастера |
| Countdown | обратный отсчёт до конца эпохи или замка |
| RiskNote | риск до действия, с датой |
| EmptyState, ErrorState | пустое состояние с объяснением; ошибка с Details и Try again |
| JobStatusList | исход по каждому стейк-аккаунту |
| LinkCard, QrCode | подпись по ссылке и её QR-код |
| CommandBlock | команда CLI в несколько строк, копирование одной строкой (карточка восстановления) |
| StatTile | число на /stats с пояснением |

## Экраны

Снимки `docs/screens/<экран>-{1280,360}.png` пишет Playwright с `UPDATE_SCREENS=1` (D45):

| снимок | экран |
|---|---|
| landing | лендинг `/` с открытыми ответами FAQ |
| app-accounts, app-empty | аккаунты `/app`: все статусы; пусто |
| protect-start | мастер защиты, шаг 1 |
| dev-ui-signing, dev-ui-protect-result, dev-ui-link | экран подписи, «Готово» защиты, подпись по ссылке (из /dev/ui) |
| withdraw, extend | вывод и продление защищённого аккаунта |
| rescue-start | спасение, шаг 1 с заполненным основным ключом |
| cosign-broken | `/cosign` с испорченной ссылкой |
| recovery | карточка восстановления |
| stats | `/stats` |
| dev-ui, dev-cosign | каталог компонентов; матрица кошельков |

Иконка сайта и логотип: `apps/web/public/favicon.svg`, `docs/logo.png` (замок на щите цвета primary).
