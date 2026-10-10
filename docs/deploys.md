# Деплои

Каждый `pnpm deploy:dev` и `pnpm deploy:prod` (обёртка `scripts/deploy.ts`, SECURITY-CHECK П18 и П19) дописывает
сюда раздел: окружение, коммит, version id Cloudflare и sha256 каждого выгруженного файла сайта (`apps/web/dist`).
Обёртка деплоит только чистое дерево, HEAD которого совпадает с origin/<ветка> (для dev можно `--allow-unpushed`, это
отмечено в разделе); prod — только после успешной задачи CI `check` на этом коммите (DECISIONS D96). Обёртка ставит
зависимости с frozen lockfile, собирает сайт без секретов в окружении и прогоняет `build-output.test.ts` и
`test-code-guard.test.ts` на этой самой папке. Токен Cloudflare и id аккаунта получает только `wrangler deploy`.

Сверить живой сайт с коммитом: `pnpm verify-deploy --env <dev|prod> --commit <sha>`. Скрипт заново собирает коммит во
временной копии репозитория, сравнивает sha256 каждого файла сборки с тем, что отдаёт сайт, и проверяет, что каждый
ответ несёт заголовки из `_headers` сборки без изменений. Код воркера (`apps/worker`) wrangler собирает сам при
выгрузке; его хеша здесь нет.

## dev · 2026-10-06 03:29:37 UTC

- Коммит: `8beb55d6ca5252bf8a2f48380f2f717db582e16d`, ветка `build/ops`, не на origin/build/ops (`--allow-unpushed`).
- Version ID: `30af32e6-86a9-4511-a2df-26328f07f2fb`.
- Цели: `https://stakeward-dev.zhibul-alexander.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit 8beb55d6ca5252bf8a2f48380f2f717db582e16d`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-DkLI0CBE.js` | 11910 | `9b8b69665afa8e733251c5df45472c62054e7c88f90fe9bbf64721971526a8e3` |
| `assets/DevCosignPage-Ce4z0lsv.js` | 43806 | `54986c97efae6b90c45222b2df41ea39e41409e4e1a94a4bc7067e4fc15e9f0b` |
| `assets/DevUiPage-D3q7JoBN.js` | 23539 | `9d270791ee7ab1bd62232c5cb069714031f211504c7be6a29f8d4ad3c4d1d87f` |
| `assets/FlowsSection-BWDuQ3Im.js` | 10368 | `720c26cd22c1290cd8aaf415b474806b44959a65b301b2ceecc2057804729bfa` |
| `assets/checkbox-CUbhD4Li.js` | 4700 | `554985ff616159463617805266623f951192969047a21eb493c3fdf5ec89d0cc` |
| `assets/command-block-DSE55qfY.js` | 31714 | `8395fbb6353cb41f97c61871dc9f643f7174410c39e4e0b1a784e6750a530f5a` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-Bi7a-6Wa.css` | 37411 | `d096f74c9553bc6b51d7256ec11479e8878ef964cd6acd4ef05197a08543e2bf` |
| `assets/index-Cn_SCz5E.js` | 468774 | `d4a9a2a12645a6ddbdddc33f8e4768371bacc1958603c46cfb921ccd0a55c2f4` |
| `assets/info-C43ZfN7v.js` | 233 | `e0fe7b3b5ea040b8b604ad24be7eb3672bb78ad22187d58d1a59055bbc9b2608` |
| `assets/label-Pv1wVSY_.js` | 159743 | `6f8b5c084cf5b0021e56e7b9fbd509a206d60f935f9a0e8f335609e08775a677` |
| `assets/nonce-Dks4qy4D.js` | 3861 | `6331ee63696cd63a163e64b4307a2e7a8bf52c26ffac7d422b8911573198e6eb` |
| `assets/samples-CHAXlA_M.js` | 9185 | `6aa078e2310ddf86723286af556edd491fc93db767b8699648ece85ee49406d1` |
| `assets/use-load-bbVmgy0E.js` | 173969 | `56b99fd95b8334040191ebc5baf26b8bb641c52462f5035ef4c533ee73913a4a` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1034 | `82dd555c9c0f9585227177cf2c32ba08441bb016a1c697cbbdc100a57c0eb50f` |

## dev · 2026-10-06 16:58:13 UTC

- Коммит: `27af77c99428ccaa20a9432c6b556c7ace6bb46b`, ветка `build/product`, совпадает с origin/build/product.
- CI: не проверялся (dev).
- Version ID: `4cc35690-2846-4b7a-86be-2bc472e1237d`.
- Цели: `https://stakeward-dev.zhibul-alexander.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit 27af77c99428ccaa20a9432c6b556c7ace6bb46b`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-DmN9Sz_v.js` | 12190 | `7d4c8ea0c0711426e28ebee0c7c3b180b80b2d4b159f7785850223c85fe5b39d` |
| `assets/DevCosignPage-Le9_0L9Y.js` | 43827 | `a352fd13431630df4b2a61eae8caa9eddf4e93aa9044c737301fb831093af113` |
| `assets/DevUiPage-HThhe8aX.js` | 23612 | `69af1371e9868349201b9bcc5fee76863ed264a23a331e77cb8c23faedc38a69` |
| `assets/FlowsSection-BislARAa.js` | 10496 | `5d06935aa645ab74af3ed86390daeaa714ee9e2c31835d2462c5f35d19d3f4fc` |
| `assets/checkbox-EVGrCpHi.js` | 4700 | `da3fd3488d6a7e780c34f1d3abfe27226917d528d9ef73485a9746b25331046f` |
| `assets/command-block-Boe1k9Gw.js` | 28705 | `981417d3ef08d9a3832fb534b89dfb623c580a898af21bff6015d3063a575bd8` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-Bi7a-6Wa.css` | 37411 | `d096f74c9553bc6b51d7256ec11479e8878ef964cd6acd4ef05197a08543e2bf` |
| `assets/index-DvTJ_1FS.js` | 473411 | `025c9e4e9fcd55038a42629bbd245a1c49cfc3b84243681e2c9085054f74618e` |
| `assets/info-B9yJGbMO.js` | 233 | `9a31b5db3a74d363037d9d46c9c89b163b2150599e10eb2268e1d4985f14ee3c` |
| `assets/label-BxNKg0TY.js` | 165482 | `58854fb50d76b96555d1a4a3d5ddaca796bf2b7b2304aa1fdd37f00257073576` |
| `assets/nonce-Bkatxbk_.js` | 3861 | `0677e367cc6e7683aeac5b5a7879a2cf7d03c72148797763c902fadb18677dab` |
| `assets/samples-BJiaFl92.js` | 9472 | `ed11427a1cedcaf88fdbc62909bb630bd05a1fd9635c5db35abd056d65972a88` |
| `assets/use-load-DT9ATTCJ.js` | 180807 | `a41689be93dd932fdb833fc4310ee9ca59dba5e0286b7aa002e748fbfcd657e4` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1034 | `8df7d35f5eef4d81a5242eda9854839c2954fbe7395467fa7a63b61614720425` |

## dev · 2026-10-08 18:12:35 UTC

- Коммит: `98a8bcf092fcaf46fc3b117979a4665dc5b9ff6c`, ветка `build/product`, совпадает с origin/build/product.
- CI: не проверялся (dev).
- Version ID: `0500d635-86a8-4506-a5e2-5c596bcb09c9`.
- Цели: `https://stakeward-dev.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit 98a8bcf092fcaf46fc3b117979a4665dc5b9ff6c`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-aqhB7aHz.js` | 12191 | `229efa24c5914488a926dbebbe7317a6a4ebb6ccbb59efe84bab7473948e6e5f` |
| `assets/DevCosignPage-PPs3b4LO.js` | 43831 | `722e88828e4540f357c53ae7e771f28b8f5221a30ce98bc6531588dee6824dba` |
| `assets/DevUiPage-CsxM4HcW.js` | 23612 | `fe6d0dca02270f1da76906a4d50cadd0867870dd15391157803b071a91acbf39` |
| `assets/FlowsSection-BOeG82Z-.js` | 10568 | `0d275dfdab5b827e4d9b47d77a312d1bfe3c3bce302158363d4b2b079e9abdc3` |
| `assets/checkbox-DPmz-jBq.js` | 4700 | `01cc1879d71505fdbc5870736a92e456db1ab99b70d8f0d421f6e09a4b2b8c89` |
| `assets/command-block-GqAt3_3e.js` | 28704 | `c007635de64ba9b7880d38d6fc8ba5e78493cb38d2cff696076b63d5d66afe18` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-Bi7a-6Wa.css` | 37411 | `d096f74c9553bc6b51d7256ec11479e8878ef964cd6acd4ef05197a08543e2bf` |
| `assets/index-CVXVMk8c.js` | 473480 | `b47fcdc3a8354f0b7b4536d8ec7627183e89b13434a2802a58949e6918c4456a` |
| `assets/info-Cn2sRaiR.js` | 233 | `ffe7afdb991b39145fc6b974d88d1f999193ed121d2b0fcdf3dc8585a350dca6` |
| `assets/label-CEIjRbm8.js` | 165599 | `9c68ee35f6a068807b28a74c00e58a6fad78aff07ddd1a22a87f7e01ebca47d1` |
| `assets/nonce-D8jLtlaz.js` | 3861 | `2e8516655043e2d1d8332f2361ba1ff58398eebb6542ee3765674b656a856b9f` |
| `assets/samples-Cwys7LiL.js` | 9472 | `341943fa09d40f37ba1a6439e2187063af245d1ea9221387c60e16acf2f8312e` |
| `assets/use-load-DG8NeVyx.js` | 181050 | `74c038c7991567dd2ce3ca107ef6ada0d19ed004f672e0e8b52aa397be1fecb3` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1034 | `2932ea68eaf86e96fe77868c34b5ad71802807d51bb477dbc75ce88f0ffde0ae` |

## dev · 2026-10-08 19:54:10 UTC

- Коммит: `2c6207a2b33e0f51370b5a169c150956e63ae638`, ветка `build/product`, совпадает с origin/build/product.
- CI: не проверялся (dev).
- Version ID: `e95b8b86-b510-40bc-acce-f51ce76db3f3`.
- Цели: `https://stakeward-dev.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit 2c6207a2b33e0f51370b5a169c150956e63ae638`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-Cbjb8Gze.js` | 12191 | `76a674dab6214f9d470f7a23bfc69f8bd7b3c66d95d2c2a5179d095617535729` |
| `assets/DevCosignPage-B-bknMHg.js` | 43884 | `24034f040ad94def14e3786d75b335257d473baea82b5b75104c3af86bd0575a` |
| `assets/DevUiPage-CxlSvvHv.js` | 23612 | `816a186b422101dba3577256f3262a62ad7730208655f694855d7a86f04a9e28` |
| `assets/FlowsSection-COse3qxw.js` | 10568 | `62c1e2ef8ab3ac504a05e1caa28cacd6c3765f3490273e3c0c354d4518fae951` |
| `assets/checkbox-DPmz-jBq.js` | 4700 | `01cc1879d71505fdbc5870736a92e456db1ab99b70d8f0d421f6e09a4b2b8c89` |
| `assets/command-block-GqAt3_3e.js` | 28704 | `c007635de64ba9b7880d38d6fc8ba5e78493cb38d2cff696076b63d5d66afe18` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-0RBq1IpC.js` | 473286 | `de3e1166800709bffb4f5bb118daa552d86eb8ac8583903476ad83e61c5ba6aa` |
| `assets/index-BnmEQcbk.css` | 37435 | `229180aaca01407e0d3849e48d7db59c2945feec0b83149053ac9f61760ccbb0` |
| `assets/info-Cn2sRaiR.js` | 233 | `ffe7afdb991b39145fc6b974d88d1f999193ed121d2b0fcdf3dc8585a350dca6` |
| `assets/label-CEIjRbm8.js` | 165599 | `9c68ee35f6a068807b28a74c00e58a6fad78aff07ddd1a22a87f7e01ebca47d1` |
| `assets/nonce-D40SsfhB.js` | 3989 | `392f16fb35965bf5e7462c3d43fb9c8d3afd1bcc2259e7d153e8b704a7b949c3` |
| `assets/samples-Cwys7LiL.js` | 9472 | `341943fa09d40f37ba1a6439e2187063af245d1ea9221387c60e16acf2f8312e` |
| `assets/use-load-DG8NeVyx.js` | 181050 | `74c038c7991567dd2ce3ca107ef6ada0d19ed004f672e0e8b52aa397be1fecb3` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1034 | `54aec9e2e3d19ce6813b2bea6dc99bccc0ab7010841118686a50271e72cbff37` |

## dev · 2026-10-09 09:57:32 UTC

- Коммит: `cc439c06df8393e57c63f7dd198a91f3cb4eaf94`, ветка `main`, совпадает с origin/main.
- CI: не проверялся (dev).
- Version ID: `7c2a4078-986b-46bf-8694-0cc67503534b`.
- Цели: `https://stakeward-dev.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit cc439c06df8393e57c63f7dd198a91f3cb4eaf94`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-C14I4Khn.js` | 23373 | `e90996f2934f8dbd9193047cfc047a20cadfaa17dbc96ac6ddd5ca02c2f15ae8` |
| `assets/DevCosignPage-CWjoDIrS.js` | 43614 | `276387401ca31c32d3109999f24da102f0e4f8bd388e906c53959bc1ca207fed` |
| `assets/DevUiPage-hnixkn_z.js` | 31075 | `a704e9ee254a12e5df5bb29de576e76548a4c7f8cab8e960b600e3ed90ccf525` |
| `assets/FlowsSection-Bfhc2s0U.js` | 10692 | `549b0809bc03a60eaf54cecd94e618de534dddd1f0b3a0dc5bfbe67f3d6ae767` |
| `assets/action-bar-BYazf6_b.js` | 4011 | `1a9f91c6406bc50343943e8f798499bb000a4b70b7fcb301cfa011297e9d5168` |
| `assets/command-block-DjdvhVHB.js` | 31684 | `f6812618b4b10c3ef5cbc6fe673c9a3bcc748356bd7d730e1bbecb6f00270224` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-BXjlKwG-.js` | 506099 | `db0b12ca97e8aa9453305ee63d70694faa389fb4c1419e80960e0f116dd1a1fc` |
| `assets/index-D_XFECCg.css` | 50105 | `9fffcedf372b5ed23d74c7d8f9ec33fce991fc4597a7285e01254507f8836bf4` |
| `assets/info-DYZDieJC.js` | 238 | `9a2ba6ab9c73c0311e0e956314749735f60f5aeba803c3fe7c488e3d56c18132` |
| `assets/nonce-CbP_fUrq.js` | 3995 | `043ede9ddb38224541a5c5a023a345009b203b1644216d9b8892f76b1ce1c1cf` |
| `assets/risk-note-BhrKf1uW.js` | 316202 | `ab040893222c0adf9d12c3ac65f56d4dff0d45d55d92dfc76656158ea55fa536` |
| `assets/rolldown-runtime-hePW80VL.js` | 716 | `580ad8c58061a4dde99bde0a56905e382f0568516ee2f5b84dbfb52085709021` |
| `assets/samples-D3NqsYMz.js` | 9634 | `dda538c5d8d1da1afe7ae7554505b1f7bcfc7fe2ab596d6016b969b779dd0bb5` |
| `assets/use-load-CCIf0XO2.js` | 45368 | `cde60d7515ab6f0883d95e978b6d3aa768b82c76ac7aacf9452ebfb3336748cd` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1127 | `2bc7f27874dae480c8f897571d2c7e4829f7123bffebe26517f0ccf5c62656e0` |

## prod · 2026-10-09 10:05:07 UTC

- Коммит: `9e5ced029cad57171ead3f3a46a1b6ff62461ca9`, ветка `main`, совпадает с origin/main.
- CI: задача `check` на этом коммите прошла (GitHub Actions).
- Version ID: `2da2df53-6472-4693-b6b8-99f732ba266b`.
- Цели: `https://stakeward-prod.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: mainnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env prod --commit 9e5ced029cad57171ead3f3a46a1b6ff62461ca9`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-Cji37Q4o.js` | 859453 | `2d5e08e28cc3ea91cf3c648300254045c95b627bc00bd86f5ba1b8aae805bc7c` |
| `assets/index-D_XFECCg.css` | 50105 | `9fffcedf372b5ed23d74c7d8f9ec33fce991fc4597a7285e01254507f8836bf4` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 565 | `cf7d9fbcd7a57e4b3617faabeb81d6cd1390bacbffddc9e33ae11dccadaaa6f4` |

## dev · 2026-10-10 14:52:10 UTC

- Коммит: `f8027657ffa149a6a68760d92ad90864cc978ca1`, ветка `main`, совпадает с origin/main.
- CI: не проверялся (dev).
- Version ID: `75ff9ab4-c2fb-451b-8960-fc8786af5b1a`.
- Запуск: GitHub Actions deploy (D115).
- Цели: `https://stakeward-dev.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: devnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env dev --commit f8027657ffa149a6a68760d92ad90864cc978ca1`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/ComponentsSection-C14I4Khn.js` | 23373 | `e90996f2934f8dbd9193047cfc047a20cadfaa17dbc96ac6ddd5ca02c2f15ae8` |
| `assets/DevCosignPage-CWjoDIrS.js` | 43614 | `276387401ca31c32d3109999f24da102f0e4f8bd388e906c53959bc1ca207fed` |
| `assets/DevUiPage-hnixkn_z.js` | 31075 | `a704e9ee254a12e5df5bb29de576e76548a4c7f8cab8e960b600e3ed90ccf525` |
| `assets/FlowsSection-Bfhc2s0U.js` | 10692 | `549b0809bc03a60eaf54cecd94e618de534dddd1f0b3a0dc5bfbe67f3d6ae767` |
| `assets/action-bar-BYazf6_b.js` | 4011 | `1a9f91c6406bc50343943e8f798499bb000a4b70b7fcb301cfa011297e9d5168` |
| `assets/command-block-DjdvhVHB.js` | 31684 | `f6812618b4b10c3ef5cbc6fe673c9a3bcc748356bd7d730e1bbecb6f00270224` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-BXjlKwG-.js` | 506099 | `db0b12ca97e8aa9453305ee63d70694faa389fb4c1419e80960e0f116dd1a1fc` |
| `assets/index-D_XFECCg.css` | 50105 | `9fffcedf372b5ed23d74c7d8f9ec33fce991fc4597a7285e01254507f8836bf4` |
| `assets/info-DYZDieJC.js` | 238 | `9a2ba6ab9c73c0311e0e956314749735f60f5aeba803c3fe7c488e3d56c18132` |
| `assets/nonce-CbP_fUrq.js` | 3995 | `043ede9ddb38224541a5c5a023a345009b203b1644216d9b8892f76b1ce1c1cf` |
| `assets/risk-note-BhrKf1uW.js` | 316202 | `ab040893222c0adf9d12c3ac65f56d4dff0d45d55d92dfc76656158ea55fa536` |
| `assets/rolldown-runtime-hePW80VL.js` | 716 | `580ad8c58061a4dde99bde0a56905e382f0568516ee2f5b84dbfb52085709021` |
| `assets/samples-D3NqsYMz.js` | 9634 | `dda538c5d8d1da1afe7ae7554505b1f7bcfc7fe2ab596d6016b969b779dd0bb5` |
| `assets/use-load-CCIf0XO2.js` | 45368 | `cde60d7515ab6f0883d95e978b6d3aa768b82c76ac7aacf9452ebfb3336748cd` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 1127 | `2bc7f27874dae480c8f897571d2c7e4829f7123bffebe26517f0ccf5c62656e0` |

## prod · 2026-10-10 14:53:29 UTC

- Коммит: `f8027657ffa149a6a68760d92ad90864cc978ca1`, ветка `main`, совпадает с origin/main.
- CI: задача `check` на этом коммите прошла (GitHub Actions).
- Version ID: `fcdda220-6e9a-44eb-ada8-c4a49fb42862`.
- Запуск: GitHub Actions deploy (D115).
- Цели: `https://stakeward-prod.stakeward.workers.dev`, `schedule: */2 * * * *`.
- Сборка сайта: mainnet; Node v24.21.0, pnpm 12.8.1, wrangler 4.146.0.
- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.
- Сверить сайт с коммитом: `pnpm verify-deploy --env prod --commit f8027657ffa149a6a68760d92ad90864cc978ca1`.

| файл | байт | sha256 |
|---|---|---|
| `_headers` | 710 | `53fa331e2041fd9fa0cee0eafd85263b3c396891499e4cf93819bf1e727b6bd0` |
| `assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2` | 7420 | `2317fa4bb293c9c0b110e18315d529235c47a0ddd3338cea3d8c7955e927899e` |
| `assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2` | 15084 | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2` | 16512 | `824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f` |
| `assets/geist-latin-wght-normal-BgDaEnEv.woff2` | 29400 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `assets/geist-mono-cyrillic-ext-wght-normal-X_5orZeX.woff2` | 6176 | `cd8800999070b729e1cc0bf7a48da6c3ac096a044251171b9a7574b56d96d4b4` |
| `assets/geist-mono-cyrillic-wght-normal-DiZS0aHC.woff2` | 12940 | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `assets/geist-mono-latin-ext-wght-normal-Bwz-egvJ.woff2` | 14696 | `1a189eb997c3e2ece68373e387afaec9e8617424186c4b1ab3cff7c54ba6223b` |
| `assets/geist-mono-latin-wght-normal-XN7g48iV.woff2` | 23128 | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `assets/geist-mono-symbols2-wght-normal-CO5SzqOn.woff2` | 5812 | `5bb66d8319ba1602bb2eb67dce8d79c2b4687be8ce183a0574433e949b3c60ad` |
| `assets/geist-mono-vietnamese-wght-normal-DadHysG0.woff2` | 7696 | `d39b60889a94a527a7f73c7988a2d6efb6c081614aef683b0b386c02d74c2175` |
| `assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2` | 8004 | `8fa40e5d248247735eb97a0bd593b8852440430600d6ba01364c31fe0abc1fe1` |
| `assets/index-Cji37Q4o.js` | 859453 | `2d5e08e28cc3ea91cf3c648300254045c95b627bc00bd86f5ba1b8aae805bc7c` |
| `assets/index-D_XFECCg.css` | 50105 | `9fffcedf372b5ed23d74c7d8f9ec33fce991fc4597a7285e01254507f8836bf4` |
| `favicon.svg` | 325 | `7c88716d99402fcf990c7d778fdfefccb7581c467c8dee53354f4c4686c3be24` |
| `index.html` | 565 | `cf7d9fbcd7a57e4b3617faabeb81d6cd1390bacbffddc9e33ae11dccadaaa6f4` |
