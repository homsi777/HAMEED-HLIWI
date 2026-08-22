# Backup & Recovery Runbook

**Hameed Hliwi Jewelry** · TASK 20

Written for someone at two in the morning who did not build this system. Follow it in order.

---

## What exists

```
schedule    a daily cron entry on the VPS, 03:15 server time
command     cd /home/ubuntu/hameed-hliwi/backend && npm run backup:scheduled
writes to   /home/ubuntu/backups/hameed-hliwi-scheduled-<timestamp>.sql.gz
retention   daily for 14 days, then one per week for 90 days, pruned automatically
record      every run — success or failure — is a row in `backup_runs`
manual      Settings → النسخ الاحتياطي، for the General Manager only
```

**There is no off-server copy yet.** Everything above survives a bad migration or a mistaken
delete. None of it survives losing the machine. See "The gap" at the end.

---

## Taking a backup by hand

On the server:

```bash
cd /home/ubuntu/hameed-hliwi/backend
npm run backup:scheduled
```

Or from the app: **Settings → النسخ الاحتياطي → إنشاء نسخة احتياطية الآن**, then the download
arrow to keep a copy on your phone or laptop.

---

## Checking that backups are actually running

Open Settings and read the banner. Or on the server:

```bash
echo '<password>' | sudo -S -u postgres psql hameed_hliwi_production -c \
  "select file_name, kind, status, size_bytes, started_at from backup_runs order by started_at desc limit 10;"
```

A schedule that stopped three weeks ago is the normal way backup systems fail. The banner turns
red once the newest successful backup is more than 48 hours old.

---

## Restoring — read this whole section before typing anything

A restore **replaces the entire database**. There is deliberately no button for it.

### 1. Stop the application first

```bash
pm2 stop hameed-hliwi-api hameed-hliwi
```

Leave the other three applications on this VPS alone: `abooerp-backend`, `clotexerp-server`,
`obada-server`.

### 2. Take a backup of the current state, however broken it looks

```bash
cd /home/ubuntu/hameed-hliwi/backend && npm run backup:scheduled
```

If you are restoring because something went wrong, the broken state is still evidence. Do not
overwrite it.

### 3. Choose the backup and check it is readable

```bash
ls -la /home/ubuntu/backups/
gunzip -t /home/ubuntu/backups/<file>.sql.gz && echo "archive is intact"
```

### 4. Restore into a scratch database first — always

Never restore straight over production. Prove the file first.

```bash
RESTORE_FILE=/home/ubuntu/backups/<file>.sql.gz
RESTORE_STAGE=/var/tmp/hameed_restore_check.sql.gz
sudo install -o postgres -g postgres -m 600 "$RESTORE_FILE" "$RESTORE_STAGE"
sudo -u postgres createdb hameed_restore_check
sudo -u postgres bash -c "gunzip -c '$RESTORE_STAGE' | psql hameed_restore_check"
```

The backups directory belongs to `ubuntu`, while PostgreSQL runs as `postgres`. The protected
temporary copy above is required on this server; do not loosen the permissions of the backups
directory just to make the restore command shorter.

Then check the books balance in the restored copy:

```bash
sudo -u postgres psql hameed_restore_check -c \
  "select round(sum(total_debit_usd),4) as debit, round(sum(total_credit_usd),4) as credit from journal_entries;"

sudo -u postgres psql hameed_restore_check -c \
  "select count(*) as partners from partners;"

sudo -u postgres psql hameed_restore_check -c \
  "select round(sum(debit_grams - credit_grams),3) as net_gold from gold_ledger_entries;"
```

Debit must equal credit. If it does not, **stop** and use an older backup.

Drop the scratch copy when you are satisfied:

```bash
sudo -u postgres dropdb hameed_restore_check
```

Keep `$RESTORE_STAGE` only while proceeding immediately to step 5; otherwise remove it with
`sudo rm -f "$RESTORE_STAGE"`.

### 5. Restore over production

Only after step 4 passed.

```bash
sudo -u postgres bash -c "gunzip -c '$RESTORE_STAGE' | psql hameed_hliwi_production"
sudo rm -f "$RESTORE_STAGE"
```

The dumps are taken with `--clean --if-exists`, so the file drops and recreates the objects it
owns. It does not touch other databases on this instance.

### 6. Put ownership back

```bash
sudo -u postgres psql hameed_hliwi_production -c \
  "select 'alter table ' || tablename || ' owner to hameed_hliwi_app;' from pg_tables where schemaname='public';" -t -A \
  | sudo -u postgres psql hameed_hliwi_production
```

### 7. Start the application and verify

```bash
pm2 start hameed-hliwi-api hameed-hliwi
curl -s -o /dev/null -w "%{http_code}\n" https://hameed-hliwi.org/api/v1/health
```

Then sign in and check three things: the trial balance is balanced, customer balances look right,
and a recent invoice opens.

---

## Verifying a backup on a quiet day

A backup proven in March proves nothing about April's file. Every month or so, run step 4 alone —
restore the newest backup into a scratch database, check the books balance, drop it. It takes two
minutes and it is the only thing that turns a backup into a guarantee.

---

## The gap that is still open

**Backups live only on the VPS they protect.**

That is enough for a bad migration, a wrong delete, a corrupted table. It is not enough for a
failed disk, a deleted server, or a compromised host — and those are the cases that end a business
rather than a day.

Closing it needs storage that belongs to you. The realistic options, cheapest first:

* **Object storage** — S3-compatible, Backblaze B2, Wasabi. A daily upload after the cron run.
  Needs an account and a key, held only on the server.
* **A second machine you already have** — `rsync` over SSH.
* **Downloading a copy yourself** — from Settings, onto a device you keep. It works, and it
  depends on someone remembering.

Until one of those is in place, the panel in Settings says so plainly rather than letting the
green banner imply a safety that is not there.
