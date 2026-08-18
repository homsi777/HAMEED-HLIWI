TASK 22 — Split Weight Custody and Used/Scrap Gold Out of "ذمم الأوزان" Into Their Own Mobile-First Screens

Hameed Hliwi Jewelry — status: OPEN, not started. Project path (local, for Claude Code to operate on): C:\Users\Homsi\Desktop\projects\hameed

Numbering note for Nabil: the highest CLOSED task found in the repository was TASK 21 (Dashboard, see TASKS_19_20_21_COMPREHENSIVE_REPORT.md). This task is numbered 22 on that basis. If another task is already in progress under a different number, rename this file before handing it to Claude Code — do not let two tasks share a number.

Supersedes: an earlier draft of this same task number existed in the repository root. That draft proposed a 4-way split including the commercial partner ledger. This version replaces it — the commercial partner ledger is explicitly out of scope here (§4). Delete the old file content before committing this one; do not keep both.

0. Ground rule for this task

Do not guess. Every claim about what currently exists in this codebase in this document is based on files actually read during this discussion (listed with paths below). Where something is not yet verified — mainly the manual weight-adjustment mechanism in §3.3 — this document says so explicitly and tells you what to check before building it. If inspection finds the assumption below is wrong, stop and describe what you found instead of building around a guess.

1. Why this task exists

The shop manager and most employees open this system primarily from mobile phones, not desktop computers. Every screen and change in this task must be designed mobile-first and be fully usable at 390–430px width — this is a hard requirement, not a nice-to-have.

The manager's complaint: the ذمم الأوزان section (single sidebar entry, single component src/components/GoldWeightAccountsView.tsx) currently stacks multiple independent workflows in one long scrolling page. Two of them — weight custody with individual people, and scrap/barter gold conversion — are being pulled out into their own dedicated screens in this task. A third piece (physical gold holdings) is being redesigned into a simple overview card at the top of the same page, per the manager's description in §3. The commercial partner ledger is left untouched (§4) — its placement is a separate, not-yet-decided task.

2. Evidence — current state, as actually read

File: src/components/GoldWeightAccountsView.tsx (293 lines), rendered when activeTab === 'gold-weight-accounts' in src/App.tsx (line 95), reached from the single sidebar entry { id: 'gold-weight-accounts', label: 'ذمم الأوزان', icon: Coins, ... } in src/components/Sidebar.tsx (line 74).

Inside that one component today, in this order:

Header + 4 action buttons (استلام ذهب / تسليم ذهب / تحويل عيار / رصيد افتتاحي) — commercial partner actions, call goldApi.receipt/payment/conversion/opening, all require picking a partner (formPartnerId, required — see line 70 if (!formPartnerId) { setError('اختر الطرف أولاً.'); return; }).
<WeightCustodyPanel warehouseId={warehouseId || undefined} /> (line 119) — full source read, src/components/WeightCustodyPanel.tsx, 322 lines. Self-contained: fetches its own data via goldApi.custodyBalances/custodySearch/custodyPerson, needs only a warehouseId prop. Backend: backend/src/gold/weight-custody.service.ts (WeightCustodyService), routes /gold/custody/* in backend/src/gold/gold.controller.ts, permission gold_accounts.transaction.create for hand-out/receive, gold_accounts.view for reads. Per TASK 14's report, the person is explicitly not a commercial partner — typing a name creates a weight_custody_people row and never touches the partners table.
<UsedGoldPanel onConverted={() => { void refresh(); }} /> (line 122) — not read in full for this task, but its usage and the code's own comment on line 121 ("كسر المقايضة القابل للتحويل — منفصل عن ذمم الأوزان ولا يمسّها") confirm it is a separate concern. Backend: backend/src/gold/used-inventory.service.ts (UsedInventoryService), routes /gold/holdings/scrap and /gold/used-conversions*, permissions gold_accounts.used_inventory.convert / .reverse — used nowhere else on this screen.
"الذهب الموجود فعلياً في المحل" block (lines 125–171) — physical holdings in the shop. Fetched via goldApi.holdings({ limit: 50 }), which returns pureGoldTotalGrams, a per-account, per-karat breakdown, and a movements list where each row carries a date, a source ('scrap_exchange' or otherwise), inGrams/outGrams, karat, and a description. This is the same concept the manager calls "رصيد افتتاحي / الذهب الموجود في المحل" — confirmed directly by Nabil in this discussion ("نعم صحيح رصيد افتتاحي هوة نفسه الذهب موجود في المحل").
Partner balance card grid + statement modal (with print) + "مطابقة الأوزان" reconciliation panel (lines 173–291) — part of the commercial partner ledger, §4.
3. What to build — the new Overview screen and the two extracted screens
3.1 Navigation model — hub, not a flat sidebar dropdown

This is different from the finance section's pattern (Sidebar.tsx financeSubItems, flat dropdown of siblings) — do not copy that pattern here. Follow this instead, because it is what the manager described directly:

The ذمم الأوزان sidebar entry keeps pointing at the same tab id gold-weight-accounts and the same component (GoldWeightAccountsView.tsx stays the landing screen — see §3.2).
From that landing screen, two buttons/cards open two new screens that are not sidebar entries themselves — the same "set activeTab to a value not in the sidebar" pattern src/App.tsx already uses for drill-downs (see openShift, openInvoice, openHistoryForShift, lines 53–58). Use two new activeTab values, e.g. gold-custody and gold-used, each rendering its own top-level view component. Add both to TAB_MODULE in App.tsx mapped to the module gold-weight-accounts (same module as today — this is a navigation change, not a permission change).
Each new screen needs its own way back (a back button/header), since it is not reachable from the sidebar directly.
3.2 The Overview screen (redesign of the existing landing content)

Keep this as the content of GoldWeightAccountsView.tsx (rename the component if you judge it clearer, but keep the same file/tab as the entry point). Redesign it, mobile-first, into:

A simple summary card: total company gold weight in grams (from holdings.pureGoldTotalGrams or equivalent — verify against §3.3 before assuming this is the final source), per-karat breakdown available if there's room, but the headline is the total.
Directly under it: "حركة أوزان اليوم" — today's weight movements only. holdings.movements already carries a date per row; filter to the current calendar day. If the current /gold/holdings endpoint does not support a date filter server-side, filtering client-side from the existing limit: 50 fetch is acceptable for this task; note in the report if that is a scaling risk worth a future backend filter.
A button at the top of the page for manual weight addition/adjustment — see §3.3, this needs verification before implementation.
Two clear entry points (buttons or cards) to the two new screens: "ذمم أوزان" (§3.4) and "كسر المقايضة" (§3.5).
Remove the inline <WeightCustodyPanel> and <UsedGoldPanel> renders from this component — they move to their own screens.
Leave the commercial partner ledger content in this same file exactly as it is today (§4) — it can sit below the new Overview section, or you may judge a cleaner in-file split for readability, but its behavior, fields, and API calls must not change.
3.3 The manual add/adjust button — verify before building, do not guess

Nabil described this precisely: the total is not a classic single-number field. When adding weight, the manager should be able to optionally break the amount into sub-lines, each a weight plus a short note (e.g. "14500 g total, of which 2200 g note: X, 3500 g note: Y..."), or leave it as one plain number. He confirmed explicitly that these sub-lines are free-text notes only — they must NOT create real per-person ledger entries. Do not wire this into WeightCustodyService or create weight_custody_people rows from it.

He also stated: this total increases only when gold is purchased through the Invoices/Purchases module — never from scrap/barter gold, which is excluded and lives entirely on its own screen (§3.5).

Before implementing the button, inspect and report back on:

Whether backend/src/gold/gold.service.ts / gold.controller.ts already support a company-level (not partner-scoped) balance adjustment. TASK 14's report documents a gold_accounts.kind enum that already includes 'company' (alongside 'partner' and 'custody_person') with a constraint requiring partner_id IS NULL for that kind — so the data model may already support this. The current frontend opening flow (GoldWeightAccountsView.tsx submit handler, line 69–76) always requires a formPartnerId before submitting, so as far as was verified in this discussion, the UI path to adjust a kind='company' account without a partner does not currently exist.
Whether purchase invoices in the Purchases/Invoices module currently post anything into this gold holdings ledger automatically today, or whether that link does not exist yet. This directly determines whether "increases only via purchases" is already true or still needs to be built.
If a safe, existing mechanism does not cover this, do not invent new backend behavior for this task. Build the button to call whatever adjustment mechanism is confirmed to exist and is safe for a company-level total, note in the report exactly what you found, and flag anything that looks like it needs its own backend task before the feature can be fully correct. A half-correct manual-adjustment button that quietly misuses the partner-opening flow is worse than a clearly flagged gap.
3.4 The "ذمم أوزان" screen (weight custody with individual people)

This is WeightCustodyPanel.tsx, moved to its own screen (activeTab === 'gold-custody'). Its existing behavior already matches what Nabil described for this screen: create a receivable either direction (لنا/علينا — the panel already supports hand_out and receive for any person, existing or typed on the spot), record weight + note, and tapping an existing person's card opens PersonSheet to see balances/history and (via the two top buttons) record another hand-out or receive against them, which increases or decreases their outstanding balance depending on which action is taken. Confirm this still behaves identically after being moved to its own screen — no logic change is expected or wanted here, only relocation.

3.5 The "كسر المقايضة" screen (used/scrap gold conversion)

UsedGoldPanel.tsx, moved to its own screen (activeTab === 'gold-used'). It was not read in full for this task — read it before moving it, confirm it is genuinely self-contained the way WeightCustodyPanel is, and note anything it depends on from its current parent (GoldWeightAccountsView) beyond the onConverted callback. Since it no longer shares a page with the partner ledger, the onConverted={() => void refresh()} coupling can be dropped — the ledger screen already re-fetches holdings/reconciliation/partnerBalances on its own mount (GoldWeightAccountsView.tsx line 50), so returning to it after a conversion will show correct data naturally. Only remove this coupling if UsedGoldPanel does not need the callback for its own internal state — check before removing.

4. Explicitly out of scope — do not touch
The commercial partner ledger stays exactly where it is, in GoldWeightAccountsView.tsx/the Overview screen: the 4 action buttons, partner balance cards, statement modal with print, and "مطابقة الأوزان" reconciliation panel. Do not move it, redesign it, rename it, or change any of its calculations, fields, or API calls. Its future placement is a separate task Nabil has not decided on yet.
Do not touch gold.service.ts, gold.controller.ts beyond what §3.3 requires you to inspect (read-only investigation, report findings — do not add new endpoints without flagging first).
Do not touch weight-custody.service.ts or used-inventory.service.ts at all — both panels move as-is.
Do not invent new permission modules or permission codes.
Do not redesign the internal UI/copy of WeightCustodyPanel beyond what's needed to fit it into its own screen (header, back button, spacing). Its existing markup, fields, and flows stay as they are.
5. Verification before closing this task
Build and npm run lint (tsc --noEmit) pass with no new errors.
Every action that existed on the old merged page still works from its new location: custody hand-out/receive/reverse, used-gold conversion/reversal, and every commercial-ledger action (receipt/payment/conversion/opening/statement/print/reconciliation) untouched and unaffected.
A seller (no gold_accounts.* permissions, per TASK 14) is still refused on all screens exactly as before.
The new Overview screen, "ذمم أوزان" screen, and "كسر المقايضة" screen are all usable at 390–430px width with no horizontal scrolling, consistent with how WeightCustodyPanel already handles mobile (bottom sheets, sticky submit buttons) per TASK 14.
Report exactly what was found for §3.3 (company-level adjustment mechanism, purchase-to-holdings link) — do not report a check as passed if it was not actually run.
6. Deliverable
The screens described in §3, implemented and verified per §5.
A report file at the repository root, TASK_22_GOLD_WEIGHT_ACCOUNTS_SCREEN_SPLIT_REPORT.md, following the structure of the existing task reports (problem, what was found, what changed, what was verified, remaining risks/notes for Nabil — especially the §3.3 findings).

At the end, confirm the exact file paths changed and the path of the generated report.

See task progress for longer tasks.

TASK_22_GOLD_WEIGHT_ACCOUNTS_SCREEN_SPLIT.md
حميد-حليوي---نظام-إدارة-تجارة-الذهب-والمجوهرات