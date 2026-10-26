# АВТОДРОП — деплой без ПК власника (ops)

**Ідея.** Сервер (VM у Google Cloud) сам кожні ~2 хв дивиться в приватний GitHub-репозиторій деплою. Асистент у хмарі
публікує туди потрібний коміт гри (гілка `staging` або `deploy`), а VM сама його забирає, перевіряє, перемикає й
за потреби відкочує. SSH і ПК власника для цього більше не потрібні.

```
асистент ── git push ──▶ GitHub: avtodrop-deploy (private)
                           ├─ гілка staging ──▶ VM: avtodrop-staging (порт 3200, копія бази, без бота проду)
                           └─ гілка deploy  ──▶ VM: avtodrop        (порт 3100, гравці)
VM ── бот ──▶ власнику: «Деплой OK / не вдався, відкотив / гра лежить / відновилась»
VM ── https://<host>/_ops/prod.json ──▶ статус (без секретів)
```

---

## 1. Що зробити власнику ОДИН раз (≈5 хв)

1. **Створити порожній приватний репозиторій.** Відкрий https://github.com/new → *Repository name*: `avtodrop-deploy` →
   **Private** → *Create repository*. Більше нічого не додавай.
2. **Дати асистенту право запису в нього** (коли він попросить): у налаштуваннях GitHub-інтеграції Claude додай доступ до
   `avtodrop-deploy` (асистент підкаже точне посилання, якщо GitHub попросить).
3. **Запусти `tools\gcp-run.cmd`** на ПК (як завжди). Асистент заздалегідь поклав у `migration\` файл `cmd.sh` — він
   встановлює все потрібне на сервер. Результат — у `migration\run-log.txt`.
4. **Додай ключ сервера в GitHub.** Бот надішле тобі повідомлення з посиланням і рядком `ssh-ed25519 …`
   (його ж видно в кінці `run-log.txt`):
   - відкрий посилання (`https://github.com/<ти>/avtodrop-deploy/settings/keys/new`);
   - *Title*: `avtodrop-vm`; *Key*: встав рядок `ssh-ed25519 …` повністю;
   - галочку **«Allow write access» НЕ став**; натисни **Add key**.

   За 2 хв бот напише «Доступ до репозиторію деплою є». Готово.

У тому ж повідомленні бота — пароль від staging (логін `tester`). Його не видно в логах.

> Ключ, що ти додаєш, — **публічна** половина; секретна лишається тільки на сервері (`/etc/avtodrop-ops/deploy_key`)
> і дає лише **читання** одного репозиторію `avtodrop-deploy`.

### Необов'язково (можна пізніше)

- **Статуси для асистента в GitHub.** Ще один порожній приватний репо `avtodrop-status`; ключ `status_key.pub`
  (асистент перезапустить setup з `--status-repo`, бот/лог покаже ключ) додати туди **з** «Allow write access». Тоді
  асистент бачить результати деплою прямо в GitHub. Без цього — статус на `https://<host>/_ops/prod.json` і в боті.
- **Тестовий бот для staging** — див. розділ 5.
- **Бекапи в Google Cloud Storage** — див. розділ 4.

---

## 2. Як асистент деплоїть (після кроків вище)

```bash
git remote add deploy https://github.com/<owner>/avtodrop-deploy.git   # один раз
git push deploy <sha>:refs/heads/staging          # 1) спершу staging
#   ~2–4 хв; перевірити https://staging.<host>/ і статус https://<host>/_ops/staging.json
git push deploy <sha>:refs/heads/deploy           # 2) прод
#   ~2–4 хв; статус https://<host>/_ops/prod.json, власнику прийде «Деплой OK»
```

- Гілки можна перезаписувати (`-f`): VM дивиться лише на те, який коміт зараз на гілці.
- **Відкат з хмари:** `git push -f deploy <попередній_sha>:refs/heads/deploy` (старий реліз ще на диску — швидко).
- **Свіжа копія бази проду на staging:** додай `[refresh-db]` у повідомлення коміту, що йде в `staging`.
- Коміт, який не пройшов перевірку або впав, позначається «пропустити» і повторно не пробується. Щоб спробувати ще раз —
  новий коміт (хоч `git commit --allow-empty -m retry`).
- Перед злиттям у `deploy` асистент сам проганяє `npm test` у себе — на сервері тести не запускаються.

### Що робить VM на кожен новий коміт (`avtodrop-deploy prod|staging`)

1. `git fetch --depth=1` гілки → `git archive` у `/opt/avtodrop-releases/<час>-<sha>/` (файли root, лише читання для гри).
2. Перевірка: є `server.js`/`package.json`/`public/`; `node --check` усіх `.js` у `server.js`, `src/`, `public/`; JSON у `src/`.
3. Бекап бази `VACUUM INTO` → `/var/backups/avtodrop/predeploy-prod/` (останні **20**), з `quick_check`.
4. **Пробний запуск** нової версії на тимчасовому порту (3190 / 3290) з **копією** бази, без токена бота, в ізоляції
   `systemd-run` (без мережі назовні, без доступу до `/data` і секретів): `/healthz`, `/api/config`, `/`, `/app.js`.
   Тут же проганяються міграції бази — на копії.
5. Атомарне перемикання symlink `/opt/avtodrop` → новий реліз, `systemctl restart avtodrop`.
6. Перевірка: `/healthz` за 45 с + ще 8 с стабільності (сервіс active, лічильник рестартів не зріс).
7. Збій → symlink назад на попередній реліз, рестарт, перевірка; бот: «не вдався, повернув попередню версію» + хвіст логу
   (токени вирізаються). Якщо й відкат не піднявся — «АВАРІЯ».
8. Успіх → статус, бот «Деплой OK», старі релізи прибираються (лишаються 5 + поточний + попередній).

Збої на кроках 1–4 **не чіпають прод узагалі**. База при відкаті не відновлюється автоматично (міграції лише додають
колонки/таблиці, стара версія з новою базою працює); бекап перед деплоєм лежить поруч, якщо знадобиться.

---

## 3. Команди на сервері (якщо колись зайдеш по SSH)

| Команда | Що робить |
|---|---|
| `avtodrop-ops status` | стан проду/staging/бекапу/сторожа, таймери |
| `sudo avtodrop-rollback` | **відкат однією командою** на попередній реліз (`staging` — для staging; можна вказати реліз) |
| `avtodrop-ops releases` | список релізів (`*` = поточний) |
| `sudo avtodrop-ops deploy-now` | задеплоїти голову гілки зараз, навіть «пропущену» |
| `sudo avtodrop-backup` | бекап зараз |
| `sudo avtodrop-staging-refresh` | база staging ← свіжа копія проду |
| `avtodrop-ops log` | журнал ops (`/var/log/avtodrop-ops.log`) |

Після ручного відкату коміт, з якого відкотились, не задеплоїться знову сам — лише наступний новий коміт.
Старий шлях `tools/gcp/update.sh` (архів з ПК) теж працює: робить з архіву новий реліз з автоповерненням.

**Відновити базу з бекапу (вручну, лише якщо дані зіпсовано):**
```bash
sudo systemctl stop avtodrop
sudo sh -c 'gunzip -c /var/backups/avtodrop/predeploy-prod/<файл>.db.gz > /data/avtodrop.db && rm -f /data/avtodrop.db-wal /data/avtodrop.db-shm && chown avtodrop:avtodrop /data/avtodrop.db'
sudo systemctl start avtodrop
```

---

## 4. Бекапи

- Щодня ~02:40 UTC (`avtodrop-backup.timer`, `Persistent=true` — пропущений через вимкнену VM запуститься після старту).
- Локально: `/var/backups/avtodrop/daily/` (**7**) і `weekly/` (**4**, новий — якщо останньому 6+ днів). Плюс
  `predeploy-*` (по 20). Невдалий бекап → повідомлення ботом.
- **GCS (необов'язково).** Якщо в `/etc/avtodrop-ops/ops.conf` задано `GCS_BUCKET` і VM може писати в Cloud Storage —
  ті самі файли й та сама ротація в `gs://<bucket>/daily/` і `weekly/` (JSON API з токеном сервісного акаунта VM; ключі не потрібні).
  Якщо права запису немає — бекап лишається локальним, бот один раз про це скаже.

  Як увімкнути (Cloud Shell, підстав свої `VM`, `ZONE`, `BUCKET`):
  ```bash
  # 0) ВАЖЛИВО: спершу зроби зовнішню IP статичною (VPC network → IP addresses → Reserve), інакше після stop/start
  #    IP може змінитися, а з ним і адреса гри *.sslip.io.
  gcloud storage buckets create gs://BUCKET --location=europe-central2 --uniform-bucket-level-access
  SA=$(gcloud compute instances describe VM --zone ZONE --format='value(serviceAccounts[0].email)')
  gcloud storage buckets add-iam-policy-binding gs://BUCKET --member=serviceAccount:$SA --role=roles/storage.objectAdmin
  gcloud compute instances stop VM --zone ZONE          # ~1 хв простою
  gcloud compute instances set-service-account VM --zone ZONE --service-account $SA --scopes=default,storage-rw
  gcloud compute instances start VM --zone ZONE
  ```
  Потім асистент перезапускає setup з `--bucket BUCKET` (або на сервері дописати `GCS_BUCKET='BUCKET'` в ops.conf).

---

## 5. Staging

- Сервіс `avtodrop-staging`: порт **3200**, база `/data-staging` (копія проду), окремий системний користувач
  `avtodrop-stg` без доступу до `/data`, секретів проду і бекапів; пам'ять ≤ 350 МБ.
- Адреса: `https://staging.<host>` (Caddy сам отримає сертифікат).
- **Без тестового бота** (за замовчуванням): токена немає → гра в DEV-режимі (вхід `/?as=<id>&name=<ім'я>`), повідомлень
  гравцям немає; тому сторінка закрита логіном `tester` + пароль (`sudo cat /etc/avtodrop-ops/staging-pass`).
- **З тестовим ботом:** створи в @BotFather окремого бота, асистент перезапускає setup із `STAGING_BOT_TOKEN=…`
  (токен проду setup відхилить). Тоді вхід через Telegram, пароль знімається. У BotFather тестового бота вкажи
  Web App URL `https://staging.<host>`.
- Деплой — з гілки `staging` тим самим механізмом; `[refresh-db]` у коміті → свіжа копія бази.

---

## 6. Сторож і логи

- `avtodrop-watchdog.timer` щохвилини: `/healthz` локально і через HTTPS. 3 збої поспіль → бот + рестарт гри (або
  Caddy, якщо падає лише HTTPS), далі рестарт кожні 10 хв; після відновлення — «знову відповідає (простій ~N хв)».
  Під час деплою мовчить. Попереджає, якщо диск > 90%.
- systemd: drop-in `avtodrop.service.d/ops.conf` — `Restart=always`, без ліміту перезапусків (основний unit не змінено).
- logrotate `/etc/logrotate.d/avtodrop`: `avtodrop.log`, `avtodrop-staging.log`, `avtodrop-ops.log` — щодня або > 50 МБ,
  14 архівів, `copytruncate` (гра не перезапускається).

---

## 7. Де що лежить

| Шлях | Що |
|---|---|
| `/usr/local/lib/avtodrop-ops/` | скрипти (`bin/`, `lib/common.sh`); команди-посилання в `/usr/local/bin/` |
| `/etc/avtodrop-ops/ops.conf` | `DEPLOY_REPO`, `STATUS_REPO`, `GCS_BUCKET`, `NOTIFY_IDS`, ліміти |
| `/etc/avtodrop-ops/{prod,staging}.conf` | порти, шляхи (генерує setup) |
| `/etc/avtodrop-ops/deploy_key` | ключ VM (лише читання репо деплою), 600 root |
| `/opt/avtodrop` → `/opt/avtodrop-releases/<id>` | поточний реліз проду (symlink) |
| `/opt/avtodrop-staging` → `/opt/avtodrop-staging-releases/<id>` | staging |
| `/var/lib/avtodrop-ops/<prod|staging>/` | стан: `current_sha`, `previous_release`, `skip_sha`, `history.log` |
| `/var/lib/avtodrop-ops/public/` | статуси без секретів → `https://<host>/_ops/{prod,staging,backup,watchdog}.json` |
| `/var/backups/avtodrop/` | `predeploy-*`, `daily`, `weekly` |
| `/etc/avtodrop-staging.env` | env staging (свій ADMIN_KEY, BOT_TOKEN порожній або тестовий) |

---

## 8. Для асистента: (пере)встановлення і тести

```bash
ops/make-bundle.sh --repo git@github.com:<owner>/avtodrop-deploy.git \
   [--status-repo git@github.com:<owner>/avtodrop-status.git] [--bucket BUCKET] [--no-staging]
# → migration/cmd.sh (самодостатній: base64-архів ops/ + запуск setup-ops.sh). Покласти на ПК власника в
#   <repo>\migration\cmd.sh, власник запускає tools\gcp-run.cmd. Повторний запуск безпечний.
bash ops/test/sim.sh          # симуляція: деплой, синтаксична помилка, падіння в проді → автовідкат, ручний відкат,
                              # сторож, бекап, staging (фейковий systemctl, локальний git, справжній server.js)
bash ops/test/setup-dryrun.sh # сухий прогін setup-ops.sh у тимчасовому корені + ідемпотентність + «секрети не у виводі»
```

Тонкощі: пробний запуск на сервері йде через `systemd-run` з ізоляцією; якщо раптом на VM це не працює (старий systemd) —
`SANDBOX=0` в ops.conf (тоді запуск від користувача гри без ізоляції мережі; порт 3190 і так закритий фаєрволом GCP).
Ключ хоста github.com зашитий (ed25519, `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`) — підміна неможлива.
