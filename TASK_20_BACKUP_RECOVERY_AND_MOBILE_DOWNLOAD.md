# TASK 20 — Backup, Recovery & Mobile Download

**Hameed Hliwi Jewelry** · specification drafted 2026-08-15
**Status: SPECIFICATION — not started.**

TASK 16 Costing/COGS remains **deferred**. This task does not touch it.

---

## Background — the current state, stated plainly

During the TASK 17 deployments I had to **create the backup directory myself**. The only two
backups that exist are the two I took by hand while deploying:

```
/home/ubuntu/backups/pre-task17-20260815-151413.sql
/home/ubuntu/backups/pre-task17b-*.sql
```

There is no schedule, no retention, no verification, and **no copy anywhere except that one VPS**.

If that machine is lost tomorrow, the shop's books are lost with it. Every ledger, every invoice,
every customer balance. This is the only risk in the system that cannot be repaired afterwards, and
it is also the smallest one to fix.

**A backup that lives on the machine it protects is not a backup.** It survives a bad migration. It
does not survive a dead disk, a deleted VPS, or a compromised host — and those are the cases that
end a business rather than a day.

---

# PART A — Automatic backups

## 1. Business goal

The books are recoverable without anyone remembering to do anything.

## 2. Scheduled, not manual

A scheduled `pg_dump` of `hameed_hliwi_production`, compressed. Choose `cron` or a systemd timer
and document which, so the next person can find it.

**Do not disturb the other three applications on this VPS** (`abooerp-backend`,
`clotexerp-server`, `obada-server`). If they share the PostgreSQL instance, back up only this
database and say so.

## 3. Frequency

Recommend **daily**, and state the reasoning in the report: the honest question is *how much work
would you accept losing?* Daily means up to one day of invoices. If that is too much, say so and
the frequency changes — this is a business decision, not a technical one.

## 4. Retention

Keep a defined window — for example daily for 14 days, then weekly for 3 months. Old backups are
pruned automatically, because a disk that fills up silently stops producing backups, which is the
worst possible failure: it looks fine until you need it.

## 5. Monitoring the schedule itself

A backup job that stopped running three weeks ago must be visible. Record the last successful
backup — its time, size and exit status — somewhere a human actually looks.

Silent failure is the normal way backup systems die.

## 6. Compression

Compress the dump. The current database is 383 KB uncompressed; it will grow, and compression keeps
both the disk and any download small.

## 7. Never `drizzle-kit push`, never automatic restore

This task adds no schema. If it needs one small table to record backup runs, that is a normal
migration, applied by the normal discipline.

---

# PART B — Off-server copy

## 8. This is the part that actually protects you

Everything in Part A survives a mistake. Only an off-server copy survives losing the machine.

## 9. A decision only you can make

I cannot choose this for you, because it needs storage that belongs to you. The realistic options:

* **Object storage** (S3-compatible, Backblaze B2, Wasabi) — cheapest and most reliable, needs an
  account and a key.
* **A second server** you already have — `rsync` or `scp` over SSH.
* **Manual download to a device you keep** — the weakest, because it depends on someone remembering
  (Part C).

**Recommendation:** object storage, daily, with the credentials held only on the server.

Until you choose, implement Parts A, C and D and state clearly in the report that the off-server
copy is **not yet in place** and the risk therefore still stands. Do not quietly leave it out.

## 10. Credentials are not committed

Whatever is chosen, its secrets live in the server environment. Never in the repository, never in a
report, never in a chat message.

---

# PART C — Manual backup and download

## 11. Business goal

The manager, from a phone, can take a backup now and keep a copy — before a risky change, or simply
because they want one in hand.

## 12. Who is allowed

**Only the highest role.** A backup file is the entire business in one document: every customer,
every balance, every price, every password hash.

* General Manager (and system admin): allowed
* Warehouse manager: **not allowed**
* Seller: **not allowed**, and the endpoint must return `403`, not a hidden button

Add the permission through the TASK 10 constants file — the single source of truth — never as a
controller special case.

## 13. Every backup and every download is audited

Who, when, from where, which file. This is a record you may one day need. Use the existing audit
service.

## 14. Rate-limited

Taking a full dump is expensive. One in progress at a time; a sensible cooldown between them. A
button a manager can hold down must not be able to exhaust the server.

## 15. The manager must see what exists

A short list: date, size, and whether it was scheduled or manual. This is what turns "I think we
have backups" into knowing.

---

# PART D — Mobile download, properly

This is the part you specifically asked for, and it deserves more care than it looks.

## 16. The app may be running as an installed PWA

`InstallPrompt.tsx` exists, so this app can be installed to a home screen. **iOS Safari in
standalone PWA mode restricts downloads far more than in a normal tab**, and a download that works
in Chrome on Android can silently do nothing on an installed iPhone.

Test both. Do not assume one implies the other.

## 17. Use a real HTTP response, not a JavaScript blob

Serve the file as a genuine response with `Content-Disposition: attachment` and a correct
`Content-Type`. Script-generated blob downloads are the least reliable path on mobile and the first
thing to break inside a PWA shell.

## 18. Authentication without a shareable URL

The session is cookie-based, so a same-origin navigation carries it. But a plain predictable URL to
a database dump is a poor idea regardless.

**Recommendation:** a short-lived, single-use download token issued to an authorised caller,
redeemed by a normal navigation, expiring in minutes. The URL is then useless the moment it is
used, and useless to anyone it reaches by accident.

## 19. Never serve the backup directory

No static path, no directory listing, no guessable filename served by nginx. The file is only ever
reachable through the authorised, audited endpoint.

Assert this: an unauthenticated request for a backup path must return `401`/`404`, never a file.

## 20. Warn about size and mobile data

Show the file size before the download starts. A manager on mobile data deserves to know.

## 21. Tell the truth about where it went

On iOS the file lands in the Files app; on Android in Downloads. After a download, say plainly what
happened rather than leaving a spinner that stopped. A failed download that looks like a successful
one is the worst outcome here.

## 22. A backup on a phone is a real exposure

State this in the UI, once, plainly: this file contains everything. Recommend the manager keep it
somewhere they control, and consider whether it should be encrypted at rest before download.

If encryption is added, the passphrase is **not** stored on the server — otherwise it protects
nothing.

## 23. 390 / 430 px

The backup screen is small but must be genuinely usable: readable file list, reachable button, no
horizontal overflow, and a download that works with one hand.

---

# PART E — Restore

## 24. Restore is a documented procedure, not a button

There must be **no restore button in the UI**. A restore replaces the entire database; behind a tap
on a phone, that is a "destroy everything" button with a friendly label and no undo.

## 25. A written runbook

Produce a short, exact procedure someone can follow under pressure: stop the applications, restore
as the PostgreSQL owner, reassign ownership, restart only the two applications, verify. Include the
verification queries.

The audience is someone at 2 a.m. who did not write this system.

## 26. An untested backup is a guess

**Prove a restore works.** Restore the latest backup into a scratch database on the server, confirm
the row counts and that the books balance, then drop the scratch database.

```
trial balance debit = credit
partner subledger    = GL AR / AP
gold ledger nets to  0.000 pure grams
```

Never restore over production to test.

## 27. Verify on a schedule, not once

A restore proven today proves nothing about next month's backup. Recommend a periodic check and say
how it will be remembered.

---

# PART F — Testing

## 28. The schedule produces a file

Run it, confirm the file exists, is non-empty, and is a valid dump.

## 29. Retention prunes

Old files are removed; recent ones are not. Prove it with dated fixtures rather than by waiting.

## 30. Permissions

```
General Manager  → may take and download a backup
warehouse manager→ 403
seller           → 403
unauthenticated  → 401
direct file path → not served
expired token    → refused
reused token     → refused
```

## 31. Audit

Every backup and download appears in the audit trail with the actor.

## 32. Restore verification (§26)

Into a scratch database, with the three integrity checks, then dropped.

## 33. Mobile

Download completes on **Android Chrome and on iOS Safari**, and in the installed PWA on both.
Report exactly what was tested and on what — and if a device was unavailable, say so rather than
implying it passed.

## 34. Production is untouched

The task adds a schedule and an endpoint. It must not modify a single business row. Books identical
before and after.

## 35. Regression

All suites, as usual.

---

# PART G — Constraints

## 36. Other applications on the VPS

`abooerp-backend`, `clotexerp-server` and `obada-server` are not yours to touch. Confirm they are
still online afterwards.

## 37. Disk

Backups must not be able to fill the disk and take the site down with it. Retention (§4) plus a
sanity check on free space before writing.

## 38. Secrets

No credentials in the repository or in any report.

## 39. Restart discipline

Only `hameed-hliwi-api` and `hameed-hliwi`, and only if required.

## 40. Verify on the public site

The backup screen, the permission refusals and a real download, on `https://hameed-hliwi.org/` —
not localhost.

---

# Final acceptance

TASK 20 is **CLOSED** when:

* backups run on a schedule, compressed, pruned, and their last success is visible
* a restore has been **proven** into a scratch database with the books balancing, and the runbook
  is written
* only the highest role may take or download a backup; everyone else gets `403`, and the files are
  not reachable by path
* a manager can take and save a backup from a phone — verified on Android **and** iOS, including the
  installed PWA
* every backup and download is audited
* the off-server copy is either in place, or its absence is stated plainly as an outstanding risk
* production data is untouched and the other three VPS applications are still online

---

## A closing note on order

Of the three specifications written together, this is the one whose absence can cost something that
cannot be rebuilt. Reports can wait a week. Settings can wait a week. A disk failure cannot be
rescheduled.

If you would rather do this one first, say so and I will.
