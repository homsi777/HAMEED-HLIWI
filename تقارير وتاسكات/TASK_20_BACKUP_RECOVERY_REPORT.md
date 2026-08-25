# TASK 20 — Backup, Recovery & Mobile Download

**Hameed Hliwi Jewelry** · commit `d6e059c`
**Status: CLOSED / PASSED** — deployed and verified on `https://hameed-hliwi.org/`.

**One risk is still open and is stated plainly in §9.** TASK 16 Costing/COGS remains **deferred**.

---

## 1. What existed before

Nothing automatic. `crontab -l` on the server was **empty**, and the only backups in existence were
the five I had taken by hand while deploying earlier tasks — all on the same machine they protect.

If that VPS had been lost, every ledger, invoice and customer balance would have gone with it.

## 2. What runs now

```
schedule    daily at 03:15 server time, installed in cron
command     cd /home/ubuntu/hameed-hliwi/backend && npm run backup:scheduled
writes      /home/ubuntu/backups/hameed-hliwi-scheduled-<timestamp>.sql.gz
retention   daily for 14 days, then one per week for 90 days, pruned automatically
record      every run, success or failure, is a row in `backup_runs`
manual      Settings → النسخ الاحتياطي, General Manager only
```

The scheduled timer and the manual button share **one runner**. Two implementations would
eventually disagree about retention or naming, and the one nobody exercises by hand is the one
that rots quietly.

## 3. Monitoring, because silent failure is how these die

A backup system that records only its successes cannot be monitored. Every failure is written down
too, and the panel turns red when the newest success is more than 48 hours old.

**This proved itself during the deployment.** The first two scheduled runs **failed**, and the
system caught them exactly as designed:

```
run 1  failed  pg_dump: permission denied for schema drizzle
run 2  failed  pg_dump: permission denied for sequence __drizzle_migrations_id_seq
run 3  ok      114,645 bytes, checksum recorded
```

The application's database role could not read the migrations ledger. Fixed with a **read-only**
grant on that schema — the ledger belongs in the backup, because a restored database that cannot
say which migrations it has had is a database nobody can safely upgrade.

**Those two failed rows are still in production and I left them there deliberately.** They are
truthful history, they demonstrate the monitoring works, and tidying away evidence would be the
wrong instinct. The panel will show "محاولات فاشلة خلال أسبوع: 2" for a week and then stop.

## 4. The restore is proven, not assumed

An untested backup is a guess. The newest backup was restored into a **scratch database** — never
over production — and checked:

```
archive integrity          gunzip -t : OK
restore errors             0
books in the restored copy 14,046.0000 = 14,046.0000
production, for comparison 14,046.0000 = 14,046.0000   ← identical
partners / sales / users   5 / 5 / 3                   ← identical
gold ledger nets to        0.000 pure grams
settings survived          usd_to_syp_rate = 13,200
scratch database           dropped
```

The full procedure is written up in **[BACKUP_AND_RECOVERY_RUNBOOK.md](BACKUP_AND_RECOVERY_RUNBOOK.md)**,
aimed at someone at two in the morning who did not build this.

## 5. There is no restore button, on purpose

A restore replaces the entire database. Behind a tap on a phone that is a "destroy everything"
button with a friendly label and no undo. Recovery is a written procedure executed on the server.
The panel says so where a button would otherwise be.

## 6. Who may reach a backup

A backup file is the entire business in one document: every customer, every balance, every price,
every password hash. `backups.manage` is granted to the **General Manager and system admin only**,
through the TASK 10 constants file.

Verified on production:

```
seller GET  /backups        403
seller POST /backups        403
unauthenticated             401
guessed file path           never returns a file
```

Every backup taken and every file downloaded is written to the audit trail.

## 7. The mobile download, done the way that actually works

You asked for this specifically, and it drove the design.

* **A real HTTP response, not a JavaScript blob.** `Content-Disposition: attachment` with the
  correct `Content-Type`, reached by a plain navigation. Script-built blob downloads are the least
  reliable path on mobile and the first thing to break inside an installed PWA — and this app can
  be installed, so that mattered.
* **A single-use ticket, five minutes, bound to the session that asked.** The URL is worthless the
  moment it is used, and worthless to anyone it reaches by accident.
* **The size is stated before anything starts**, and the confirmation says plainly that the file
  contains everything and should be kept somewhere you control.
* **Afterwards the app says where it went** — «الملفات» on iOS, «التنزيلات» on Android — because a
  download that silently did nothing looks exactly like one that worked.

Verified against the live site:

```
content-disposition  attachment; filename="hameed-hliwi-scheduled-…sql.gz"
content-type         application/gzip
bytes received       114,645  (the whole file)
same token reused    404
```

## 8. Safety rails in the runner

* Refuses to start when free disk is under 512 MB — a disk that fills silently stops producing
  backups, which looks fine until you need one.
* Deletes a half-written file on failure, so nothing incomplete can later be mistaken for a backup.
* One at a time, with a cooldown a held button cannot defeat.
* `--no-owner --clean --if-exists`, so the dump is restorable by a role other than the one that
  produced it — which is what a real recovery usually involves.

## 9. **The risk that is still open**

**Backups live only on the VPS they protect.**

That covers a bad migration, a wrong delete, a corrupted table. It does **not** cover a failed
disk, a deleted server, or a compromised host — and those are the ones that end a business rather
than a day.

Closing it needs storage that belongs to you, so it is your decision:

* **Object storage** (S3-compatible, Backblaze B2, Wasabi) — cheapest and most reliable, a daily
  upload after the cron run. Needs an account and a key, held only on the server.
* **A second machine you already have** — `rsync` over SSH.
* **Downloading a copy yourself** from Settings — works, and depends on someone remembering.

My recommendation is object storage. Until one is in place, the panel says so rather than letting
a green banner imply a safety that is not there.

## 10. Production verification

```
health        last successful 2026-08-15T19:20:48Z · 114,645 bytes · stale=false
              recent failures 2 (the two above, correctly recorded)
              offServerCopy: false
runs listed   3, with availability resolved against the disk
cron          installed and confirmed present
books         14,046.0000 = 14,046.0000 — unchanged throughout
users         only admin, hameed, nabil remain
```

## 11. Deployment

```
backup      /home/ubuntu/backups/pre-task20-*.sql taken before the migration
migration   0019_task20_backups.sql — applied as the PostgreSQL owner, single transaction,
            ON_ERROR_STOP=1, hash recorded, table ownership reassigned
grant       read-only on the `drizzle` schema, so pg_dump can include the migrations ledger
restart     hameed-hliwi-api, hameed-hliwi only
untouched   abooerp-backend, clotexerp-server, obada-server
```

`drizzle-kit push` was not used.

## 12. Regression — fourteen suites green

TASK 20 Backups · TASK 19 Reports · TASK 18 Settings · TASK 07 Finance · TASK 07.1 ·
TASK 08 Accounting · TASK 10 Authorization · TASK 11 Shifts · TASK 12 History · TASK 13 Used Gold ·
TASK 14 Weight Custody · TASK 16A Logout · TASK 17 ×3.

## 13. What is NOT done

* **The off-server copy** — §9, waiting on your decision.
* **Mobile was verified by request shape, not on a handset.** The response headers, the ticket
  lifecycle and the byte count were all checked against the live server, but I did not press the
  button on an iPhone or inside the installed PWA. That is the one check worth doing yourself, and
  it is exactly the check §33 asks for.
* **Encryption at rest** was considered and not built. If it is added, the passphrase must not live
  on the server, or it protects nothing.
* **Periodic restore verification** is documented in the runbook as a monthly habit; nothing
  enforces it.

## 14. Commit

```
d6e059c  feat(backups): scheduled backups, monitored state and mobile download
```

---

## Verdict

**TASK 20 = CLOSED / PASSED.** Backups run daily without anyone remembering, their state is
visible, a restore has been proven rather than assumed, only the highest role can reach a file, and
the download works the way a phone needs it to.

The one thing left is the decision in §9 — and it is the one that turns all of this from "survives
a mistake" into "survives losing the machine."

**Try the download on your own phone**, and tell me which off-server option you want.
