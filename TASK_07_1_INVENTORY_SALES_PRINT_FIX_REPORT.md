# TASK 07.1 — Inventory Image, Sales Item Count & Invoice Preview Fix Report

Status: **TASK 07.1 = CLOSED / PASSED** — all three reported defects are fixed, deployed and verified against the user's real production records on `https://hameed-hliwi.org/`. Final visual acceptance belongs to the user.

Every diagnosis below was made by reading the actual production rows and responses first. **No production business data was changed, repaired or deleted.**

## Root Cause of the Inventory Image Defect

The images were never lost. Both uploaded files existed on disk with correct database references:

| Product | Stored `image_path` | File on disk |
| --- | --- | --- |
| `12345` اسوارة برم حلبية | `93fbdd7e-…-8e2bed1d60e0.jpg` | present, 14,497 bytes |
| `12346` محبس خطوبة | `7ff1b26f-…-ec0b8091d517.jpg` | present, 56,775 bytes |

Tracing the full path isolated two independent faults:

1. **Nginx had no `/uploads/` route.** The server block proxied `/api/v1/`, `/socket.io/` and `/realtime/` to the API on `:3006`, and everything else to the SPA on `:3005`. Image requests therefore fell into the catch-all and the SPA answered every one of them with `index.html`. Measured directly on the VPS:

   ```
   backend  :3006/uploads/inventory/93fbdd7e….jpg  → 200 image/jpeg 14497 bytes
   frontend :3005/uploads/inventory/93fbdd7e….jpg  → 200 text/html
   ```

   The browser received HTML where it expected an image, and drew the broken-image icon.

2. **Cloudflare had cached that wrong answer.** After the nginx route was added, the public URL still returned `text/html` with `cf-cache-status: HIT`, `Age: 1659`, `Cache-Control: max-age=14400` — a four-hour cached copy of the SPA shell pinned to the image URL.

## Image Storage / API / Public URL Fix

* Added the missing route to the site's own server block (backup kept at `/etc/nginx/sites-available/hameed-hliwi.org.bak-task071`):

  ```nginx
  location ^~ /uploads/ { proxy_pass http://127.0.0.1:3006; … }
  ```

* Introduced **one** image URL contract in `backend/src/config/upload-path.ts`. The static handler, the inventory DTO and nginx now all reference the same prefix, so no component builds its own image URL.
* The published URL carries a version token derived from the row's own `updated_at` (`…jpg?v=1786656112650`). This defeats the poisoned cache entry immediately and makes any future stale copy self-healing, while still allowing aggressive caching.
* Static image requests are exempted from the API rate limiter, so an inventory page full of photos cannot exhaust a user's API budget. Verified: three consecutive image loads all returned `200`.
* The inventory edit form now strips the version token before writing the file name back, so a re-save can never corrupt `image_path`.

## Existing Image Repair

**None was required and none was performed.** The files and their database references were already correct; only the delivery path was broken. The user does not need to re-upload anything. No file was found missing.

## Root Cause of the `0` Item Count

The sales list DTO builds its rows with `dto(invoice)` and never passes lines, so **every list row carries `items: []` by design** — the list is a summary endpoint. The invoice table rendered `inv.items.length`, which is therefore always `0`. The backend's own `itemCount` was already correct and simply unused by the screen.

## Correct Definition of Item Count

The column shows the **number of pieces sold**, not the number of database rows:

```sql
(select coalesce(sum(quantity), 0)::float8 from sales_invoice_items where sales_invoice_id = …)
```

An aggregate line selling 2 pieces counts as 2 even though it is one row; lines of 2 and 3 pieces total 5. `lineCount` is exposed separately for anything that needs the row count. The same correction was applied to purchases. It is an efficient correlated aggregate — no lines are shipped to the browser and there is no N+1 query.

## Root Cause of the Blank Print Rows

Identical cause, different symptom. `PrintInvoiceModal` was handed the summary list row, whose `items` array is empty — which is exactly why the header, customer, totals, scrap, paid and remaining all rendered correctly (they live on the master row) while the item table was blank.

The database was never at fault. `INV-2026-002` holds two complete line snapshots:

```
#1 manual  محبس خطوبة   karat 21  qty 1.000  gross 5.600  net 5.600  price 122.0000  labor 5.0000  total 711.20
#2 manual  خاتم سهرة    karat 21  qty 1.000  gross 11.220 net 11.220 price 122.0000  labor 12.0000 total 1503.48
scrap: 9.100 g k21 = $1101.10 · payments: cash_usd 500.00, cash_syp 132,000
```

## Sales Detail API and Print Adapter

`GET /api/v1/sales/:id` already returned every line with all print-required snapshot fields; no backend shape change was needed. The frontend now uses it:

* preview, print, PDF export and WhatsApp sharing all call `loadInvoiceDocument()` first and render the returned document;
* printing awaits that document, so a sheet can never reach paper with a filled header and empty rows;
* one invoice shape feeds the print modal — the legacy localStorage invoice model is no longer involved.

Printing uses the immutable sale-line snapshots, never the current inventory record, so renaming a product tomorrow leaves old invoices printing their original name, code, karat and weight.

## Manual-Item Compatibility

Manual lines are never filtered. Both of the user's real invoices consist entirely of `line_type = manual` rows, and they now count and print correctly. The regression test asserts a manual line survives into the printed payload.

## Aggregate-Item Compatibility

An aggregate sale of 2 pieces / 20.000 g reports `itemCount 2` with `lineCount 1`; an individual item contributes 1. Both are covered by tests.

## Invoice Attachment Verification

Verified end to end and found **already working**. `INV-2026-002` carries an 85,723-character documentation image in `item_photo_data`. The test uploads an attachment, confirms it is returned on create, persisted in PostgreSQL and returned again by the detail endpoint after reload. No fix was needed.

## Tests

`npm run test:task071` (`backend/test/task071-regression.spec.ts`) — all pass:

* **image**: PNG and JPEG upload → bare file name stored → `imageUrl` uses the public contract with a version token → the URL is served by the API with the right content type and byte-identical content → list and detail publish the same URL → a non-image upload is rejected → images still resolve after a restart;
* **item count**: inventory line + manual line → `2`; aggregate line selling 2 pieces on 1 row → `itemCount 2`, `lineCount 1`; purchase lines of 2 and 3 → `5`;
* **print payload**: a sale with an aggregate line, a manual line, scrap exchange, a discount and both USD and SYP payments returns two lines, each carrying every print-required field, plus scrap, discount and both paid currencies;
* **attachment**: persisted and returned on reload;
* **persistence**: invoice lines and product images survive a backend restart.

`npm run test:integration` (Tasks 01–06) and `npm run test:finance` (Task 07) both still pass unchanged.

## Production Deployment

* Commit `15cee16` pushed and pulled on the VPS.
* **No migration was required** — this was a delivery-path and presentation defect, not a schema one. The Drizzle ledger is untouched and still reports nothing pending. `drizzle-kit push` was not used.
* Nginx route added with a config backup, `nginx -t` passed, reloaded.
* Backend and frontend rebuilt; only `hameed-hliwi-api` and `hameed-hliwi` restarted. `abooerp-backend`, `clotexerp-server` and `obada-server` untouched.
* No database backup was needed because no migration or data change was performed; the Task 07 pre-migration dump remains at `~/backups/hh_pre_task07.dump`.

## Production Verification

| Check | Result |
| --- | --- |
| Real image `12345` اسوارة برم حلبية | `https://hameed-hliwi.org/uploads/inventory/93fbdd7e….jpg?v=1786656112650` → **`200 image/jpeg`** |
| Real image `12346` محبس خطوبة | `…/7ff1b26f….jpg?v=1786704540615` → **`200 image/jpeg`** |
| Repeated image loads | 3 consecutive requests all `200` — images no longer spend the API rate limit |
| `INV-2026-002` item count | API aggregate returns `2` pieces (`lineCount 2`) — no longer `0` |
| `INV-2026-001` item count | API aggregate returns `2` pieces |
| Invoice lines intact | both invoices hold 2 complete line snapshots in PostgreSQL |
| Deployed bundle | `index-BqJyfU4P.js` contains the `itemCount` aggregate, the saved-document loader and the version-token stripper |
| Frontend root / health | `200` · `{"status":"ok","database":"ok"}` |
| Existing modules | Sales, Purchases, Returns, Inventory, Partners, Finance all still `401` unauthenticated |
| Backend logs | started cleanly; the only `ERROR` lines predate this deploy |

**No browser automation was available in this environment, so no visual verification is claimed.** Everything verifiable by API, database and HTTP was checked programmatically; the on-screen confirmation is the user's.

## Real-Data Repair Performed

**None.** No invoice, line, inventory row, image file or financial record was modified. The database contained no malformed data — all three defects were outside it.

## Remaining Risks

1. **Cloudflare may still serve the old cached HTML for the un-versioned image URL** (`…jpg` with no `?v=`) until its four-hour TTL expires. The application only ever requests the versioned URL, so this does not affect the app; a Cloudflare cache purge would clear it entirely.
2. **The two real products carry `quantity = 0`** because they were created as aggregate items with the optional quantity box left blank. They display as 0 pieces available. This is existing behaviour, not one of the reported defects — worth confirming whether the intended quantity should be entered.
3. **Invoice attachments are stored as base64 in the invoice row** (85 KB for `INV-2026-002`). It works and is returned correctly, but at scale these belong in the uploads directory like product images. Left unchanged deliberately, as §13 asked only for verification.
4. **The nginx route is server-side configuration** and lives outside the repository. If the server block is ever recreated, the `/uploads/` location must be included.
5. **Static images are exempt from the API rate limiter.** They are served from a fixed directory by file name only, so this is not an access-control change, but it does mean image requests are not throttled by the app.

## Scope Discipline

No General Ledger, Chart of Accounts, accounting journals or reports were implemented. Task 07's financial integration is untouched and its full test suite still passes: automatic vouchers, cashbox postings, partner ledger, currencies and exchange rates all continue to behave exactly as verified in Task 07.
