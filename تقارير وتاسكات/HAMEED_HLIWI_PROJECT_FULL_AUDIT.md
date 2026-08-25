# Hameed Hliwi Jewelry — التدقيق الكامل للحالة الحالية

**تاريخ التدقيق:** 13 أغسطس 2026  
**النطاق:** محتوى المستودع فقط. لم يُفترض وجود أي خدمة أو قاعدة بيانات أو إعداد استضافة خارج ما هو موجود في الملفات.  
**حالة التقرير:** تدقيق وصفي فقط؛ لم يُعدّل سلوك التطبيق، ولم تُضف حزم أو طبقات خادم.

## 1. الملخص التنفيذي

التطبيق الحالي هو واجهة ويب عربية RTL لإدارة عمل تجارة الذهب والمجوهرات. الوظائف المنفذة في الواجهة تشمل المخزون متعدد المستودعات، فواتير البيع والشراء، العملاء/الموردين، ذمم الأوزان، الصناديق والسندات والمصاريف، التقارير، المستخدمين والصلاحيات، الورديات، إعدادات الأسعار والطباعة. هذا الوصف مبني على المكونات والأنواع والمنطق الموجود، لا على اسم المشروع فقط.

هو **Frontend-only SPA** مبني بـ React + Vite + TypeScript. لا توجد ملفات خادم، مسارات HTTP، استدعاءات API للتطبيق، Driver قاعدة بيانات، ORM، أو ملفات مخطط قاعدة بيانات في المستودع. تبعية Express موجودة في `package.json` فقط، لكن لم يُعثر على استعمال لها أو ملف خادم. لذلك **لم يُعثر على Backend حقيقي أو قاعدة بيانات دائمة مركزية**.

المصدر الفعلي للبيانات هو `src/data/initialData.ts` عند البداية، ثم حالة React في `StoreContext`، مع حفظ غالب الحالة في `localStorage` تحت المفتاح `HAMEED_HLIWI_GOLD_STORE_V1`. توجد مفاتيح محلية مستقلة لاختصارات لوحة التحكم والجرد وتصنيفات المصاريف. لا يوجد مزامنة بين الأجهزة أو المتصفحات.

المصادقة الحقيقية **غير موجودة**: لا توجد شاشة دخول أو كلمة مرور أو Session أو Token أو Cookie أو تحقق خلفي. يوجد اختيار مستخدم محلي من الواجهة. الصلاحيات موجودة **جزئياً في الواجهة**: تتحكم في عناصر التنقل والعلامة النشطة، لكنها ليست محمية على خادم ولا تمنع قراءة بيانات السياق في المتصفح.

تحتوي البيانات على `warehouseId` في المخزون والفاتورة وعلى `assignedWarehouseId` في المستخدم، لكن عزل المستودعات الحقيقي **غير موجود**. واجهات المخزون والفواتير والتقارير تتيح اختيار/عرض كافة المستودعات، ولا يوجد ترشيح عالمي وفق المستخدم الحالي. ولذلك لا يصلح التطبيق بصورته الحالية كنظام سحابي متعدد المستخدمين أو كضمان لعزل مدير/موظفي مستودع عن مستودع آخر.

**مستوى النضج:** نموذج واجهة وظيفي محلي متقدم نسبياً في التدفقات المعروضة، مع نموذج بيانات أولي ومنطق عميل؛ ليس نظام تشغيل سحابي متعدد المستخدمين جاهزاً بعد.

**بدء وبناء التطبيق:**

| العملية | الأمر الموجود | النتيجة |
|---|---|---|
| تطوير | `npm run dev` | Vite على `0.0.0.0:3000` |
| بناء إنتاج | `npm run build` | يخرج ملفات `dist/` |
| معاينة البناء | `npm run preview` | معاينة Vite الافتراضية |
| تدقيق TypeScript | `npm run lint` | `tsc --noEmit` |
| معاينة قوالب الفواتير | `npm run preview:invoice-template` و`npm run preview:invoice-template:a5-portrait` | Vite يفتح ملفي HTML الثابتين |

**ملاءمة النشر السحابي كما هي:** يمكن نشر الملفات الثابتة، لكن نظاماً تجارياً سحابياً فعلياً يحتاج طبقة خادم، قاعدة بيانات، مصادقة وصلاحيات خادمية، عزل بيانات، معالجة تعارضات، نسخ احتياطي وسجلات تشغيل. هذه العناصر **Not found in the current repository.**

## 2. بنية المستودع

```text
.
├─ src/
│  ├─ main.tsx                         نقطة الدخول وتسجيل Service Worker
│  ├─ App.tsx                          shell واختيار الأقسام محلياً
│  ├─ types.ts                         نماذج TypeScript للنطاق
│  ├─ index.css                        Tailwind وقواعد الطباعة
│  ├─ context/StoreContext.tsx         الحالة العامة والمنطق المحلي والحفظ
│  ├─ data/initialData.ts              بيانات نموذجية/أولية
│  └─ components/
│     ├─ DashboardView.tsx
│     ├─ InventoryView.tsx
│     ├─ InvoicesView.tsx
│     ├─ PartnersView.tsx
│     ├─ GoldWeightAccountsView.tsx
│     ├─ FinanceView.tsx
│     ├─ ReportsView.tsx
│     ├─ UsersView.tsx
│     ├─ ShiftsView.tsx
│     ├─ SettingsView.tsx
│     ├─ Navbar.tsx / Sidebar.tsx
│     ├─ PrintInvoiceModal.tsx
│     ├─ PrintAccountStatementModal.tsx
│     └─ InstallPrompt.tsx
├─ public/
│  ├─ manifest.webmanifest, sw.js      PWA محلي
│  ├─ icon-192.svg, icon-512.svg
│  ├─ invoice-print-preview.html       نموذج HTML ثابت A5 أفقي
│  └─ invoice-print-preview-a5-portrait.html  نموذج HTML ثابت A5 عمودي
├─ package.json / package-lock.json / bun.lock
├─ vite.config.ts / tsconfig.json / index.html
├─ .env.example
├─ README.md
└─ تاسك.md                             تعليمات التدقيق
```

`node_modules/` و`dist/` موجودان محلياً لكنهما مخرجات اعتماد/بناء وليسا كوداً مملوكاً للمشروع. لا يوجد مجلد `server/` أو `api/` أو `services/` أو `pages/` أو migrations أو schema أو docker/deployment config في المستودع.

## 3. التقنية والاعتمادات

| التقنية/الحزمة | الدليل والاستعمال الفعلي |
|---|---|
| React 19 وReact DOM | تركيب التطبيق في `src/main.tsx` ومكونات JSX. |
| TypeScript | كل كود التطبيق `.ts/.tsx`، والنماذج في `src/types.ts`. |
| Vite 6 | scripts في `package.json` وتهيئة `vite.config.ts`. |
| Tailwind CSS 4 | `@tailwindcss/vite` في Vite و`@import "tailwindcss"` في `src/index.css` وفئات utility في المكونات. |
| Lucide React | أيقونات الواجهة مستخدمة في المكونات. |
| Recharts | مستخدمة في `DashboardView.tsx` لرسوم المبيعات/المشتريات وتوزيع العيارات/الصناديق. |
| Browser localStorage | حفظ الحالة العامة والجرد والاختصارات وتصنيفات المصاريف. |
| PWA Web APIs | Service Worker، Cache API، `beforeinstallprompt` وBrowser Notifications. |
| Printing | `window.print()` وCSS `@page`/`@media print` ومودالات طباعة. |

**غير موجود/غير مستخدم في كود التطبيق:** React Router، Axios، React Query، Redux/Zustand، مكتبة forms، مكتبة validation، PDF generator، Excel/CSV library، database driver أو ORM، auth library، WebSocket/GraphQL. لا يوجد import لـ `@google/genai` أو `express` أو `dotenv` أو `motion` في `src/`؛ لذلك هي تبعيات غير مستخدمة بشكل قابل للتحقق من الكود الحالي. `@google/genai` وExpress موجودتان فقط في الاعتمادات/ملفات القفل.

## 4. نقاط الدخول وتدفق البدء

1. `index.html` يحدد `lang="ar"` و`dir="rtl"` ويحمّل خط Cairo من Google Fonts ويحتوي `#root`.
2. `src/main.tsx` يستورد CSS، يسجّل `/sw.js` عند حدث `load`، ثم يرسم `<App />` داخل `StrictMode`.
3. `App.tsx` يلف التطبيق بـ `StoreProvider`.
4. `StoreProvider` يقرأ الحالة المخزنة محلياً، أو يهيئها من `initialData.ts`، ثم يحفظ التغييرات إلى `localStorage`.
5. `MainAppContent` يحمل `Navbar` و`Sidebar` ويختار الشاشة بالـ state المحلي `activeTab`. لا يوجد URL routing؛ تغيير القسم لا يغيّر المسار ولا يدعم deep links.
6. الاتجاه RTL محدد على حاوية التطبيق أيضاً. لا توجد طبقة localization/i18n أو تبديل لغات.

## 5. الأقسام والتنقل

لا توجد routes/paths فعلية؛ جميع الأقسام هي قيم `activeTab` داخل SPA. يظهر `Sidebar` عناصر بحسب `currentUser.permissions` ويقدم شريطاً أفقياً للشاشات الأكبر وdrawer للهاتف.

| الاسم العربي / المفتاح | المكون | الحالة والوظائف الفعلية |
|---|---|---|
| الرئيسية / `dashboard` | `DashboardView` | مؤشرات ورسوم وعمليات سريعة وإعداد اختصارات وأسعار. |
| المخزون والعيارات / `inventory` | `InventoryView` | قائمة/بطاقات، إضافة وتعديل وحذف ونقل قطعة، مستودعات وجرد وصور. |
| الفواتير والمبيعات / `invoices` | `InvoicesView` | إنشاء بيع/شراء/مرتجع مع معاينة وطباعة وإلغاء ومشاركة. |
| العملاء والموردين / `partners` | `PartnersView` | قائمة وبحث وفلترة وإضافة/تعديل وكشف حساب وذمم ذهب. |
| ذمم الأوزان / `gold-weight-accounts` | `GoldWeightAccountsView` | دفتر مستقل لحسابات وزن وأرصدة حركات تسليم/استلام. |
| الإدارة المالية / `finance-*` | `FinanceView` | أربعة تبويبات: صناديق، سندات، دفتر يومية، مصاريف. |
| التقارير والتحليلات / `reports` | `ReportsView` | اختيار تقرير، فلترة فترة/مستودع وبحث وطباعة/مشاركة. |
| الصلاحيات والمستخدمون / `users` | `UsersView` | بطاقات مستخدمين وإضافة/تعديل محليين وإسناد مستودع وصلاحيات. |
| سجل الورديات / `shifts` | `ShiftsView` | عرض ورديات وتفاصيل فواتيرها؛ البدء/الإغلاق من السياق/الفواتير. |
| الإعدادات العامة / `settings` | `SettingsView` | هوية المنشأة، عملات وهوامش وأسعار العيارات وإعادة ضبط البيانات. |

لا توجد pagination أو تحميل تدريجي في الأقسام. البحث والفلترة تتم داخل Arrays في الذاكرة. النوافذ المنبثقة هي JSX conditional، ولا توجد مكتبة dialog أو toast أو loader/skeleton عام.

## 6. تدقيق الوحدات

### لوحة التحكم

**المصدر:** `src/components/DashboardView.tsx`.

تحسب القيم من `invoices`, `inventory`, `partners`, `cashBoxes`, `goldPrices`, و`activityLogs` في الـ context. بطاقات KPI تشمل المبيعات، المشتريات، صافي الحركة، قيمة المخزون/وزنه، الذمم، والصناديق بحسب الحسابات في الملف. الرسم الخطي/المساحي لحركة المبيعات والمشتريات يبنى من فواتير الذاكرة حسب التاريخ، ورسم توزيع العيارات من المخزون، ورسم الصناديق من أرصدة `cashBoxes`. لا توجد بيانات إحصائية مخزنة عن بعد.

الاختصارات القابلة للتخصيص تحفظ في `HAMEED_HLIWI_DASHBOARD_SHORTCUTS`، وتتضمن فتح فواتير بيع/شراء أو الانتقال للأقسام. توجد نافذة لتعديل سعر شراء/بيع/مصنعية كل عيار، وتستدعي تحديث أسعار الـ context. تعرض آخر النشاطات من `activityLogs`. القيم ديناميكية محلياً لكنها ليست بيانات مركزية.

### المخزون والمستودعات

**المصادر:** `src/components/InventoryView.tsx`, `src/types.ts`, `src/context/StoreContext.tsx`.

الكيانات: `Warehouse` (اسم، موقع، manager كسلسلة نصية، هاتف، isDefault) و`InventoryItem`. القطعة تشمل: code، name، category، karat، وزن قائم/فصوص/صافي، مصنعية للغرام وإجماليها، `warehouseId`، حالة `in_stock|sold|reserved`، صورة اختيارية، ملاحظة وتاريخ إضافة.

المكون يدعم بطاقات هاتف وجدول desktop. أعمدة الجدول: الكود/الاسم، التصنيف، العيار، الوزن القائم، الفصوص، الوزن الصافي، أجرة الغرام، القيمة اليوم، المستودع، الإجراءات. البحث باسم/كود/باركود (الوصف فقط؛ لا يوجد حقل barcode منفصل عن `code`) والفلترة حسب المستودع والعيار والتصنيف تتم في المتصفح. لا يوجد sorting أو pagination.

الإجراءات المنفذة: إضافة وتعديل وحذف قطعة، معاينة صورة، رفع صورة وتحويلها client-side إلى JPEG بحد 1280px وجودة 0.8، نقل القطعة عبر تغيير `warehouseId`، إضافة مستودع، عرض بطاقة كل مستودع، وحفظ snapshot جرد محلي. Modal القطعة يحتوي الاسم، الكود، العيار، التصنيف، الوزن القائم، وزن الفصوص، الوزن الصافي، أجرة الغرام، المستودع، الحالة، الملاحظة والصورة. الحقول تتحقق بصورة بسيطة في الواجهة؛ لا يوجد schema validation. الجرد يكتب إلى `HAMEED_HLIWI_STOCKTAKES` ولا ينشئ تسوية أو حركة مخزون.

لا توجد حركة مخزون/سجل transfer مستقل أو opening stock أو تلف/فقد أو reservation workflow أو موقع رف. النقل مجرد تعديل للحقل ولا يوثق ككيان مستقل؛ النشاط يضاف محلياً فقط.

### الفواتير والمبيعات/المشتريات

**المصادر:** `src/components/InvoicesView.tsx`, `src/context/StoreContext.tsx`, `src/components/PrintInvoiceModal.tsx`.

الكيانات: `Invoice`, `InvoiceItem`, `ScrapGoldItem`، وأنواع فاتورة `sale|purchase|return` وطرق دفع `cash_usd|cash_syp|gold_exchange|debt|mixed`.

القائمة تعرض/تفلتر فواتير الذاكرة بحسب النص والنوع والفترة/المستودع بحسب الكود. هناك أزرار إنشاء بيع وشراء، قائمة خيارات للمعاينة والطباعة/"تصدير PDF" والإرسال عبر WhatsApp والإرجاع والإلغاء. "تصدير PDF" ليس توليد ملف PDF: يفتح معاينة ثم يستدعي `window.print()` ليترك حفظ PDF لمتصفح المستخدم.

تدفق الإنشاء يدعم اختيار عميل/مورد أو إنشاء عميل سريع (اسم مطلوب، هاتف اختياري)، اختيار مستودع، إضافة قطعة من المخزون أو بند حر، كسر ذهب (عيار ووزن وسعر شراء)، خصم، دفعات بالدولار والليرة، طريقة دفع وملاحظات وصورة اختيارية. سعر بيع الغرام مطلوب للقطعة الحرة أو عند إضافة قطعة، ولا يُستخدم سعر البيع المحفوظ كقيمة نهائية تلقائية لكل بند؛ يدخل المستخدم السعر في التدفق. لا توجد ضريبة مطبقة في حساب الفاتورة رغم وجود `taxRatePercent` بالإعدادات.

الحساب الفعلي في الواجهة: قيمة البند = `(الوزن الصافي × سعر الغرام) + (الوزن الصافي × مصنعية الغرام)`. تجمع الفاتورة قيمة الذهب والمصنعية، تخصم قيمة الكسر والخصم، وتحسب المدفوع والباقي. عند الحفظ يولد السياق رقم `INV-السنة-تسلسل` من طول Array الحالي، ويضع `createdBy` و`shiftId` من المستخدم/الوردية المحليين. البيع يغير حالة القطع المخزنية المختارة إلى `sold`؛ الشراء ينشئ قطع مخزون جديدة؛ الفاتورة ذات دين تعدل رصيد الشريك؛ الدفعات تعدل فقط الصندوقين ذوي المعرفين الثابتين `box-usd` و`box-syp`. لا توجد transaction أو atomicity أو تحقق خادمي.

الإلغاء يحذف الفاتورة من Array ويعكس حالة قطع البيع والذمم والصناديق؛ لا يوجد status ملغاة محفوظ أو audit immutable. مسار `return` موجود في النوع وواجهة الإنشاء، لكن `addInvoice` لا يحتوي معالجة مخزون/ذمم/صناديق مخصصة له مثل البيع والشراء؛ لذا هو **Partially implemented**.

الطباعة الحية في `PrintInvoiceModal.tsx` هي قالب فاتورة مرتبط ببيانات الفاتورة، مع CSS A5 landscape في `src/index.css`. تعرض العميل/التاريخ/الرقم/النوع والبنود والوزن والعيار وسعر الذهب والمصنعية والإجمالي والدفعات والمتبقي. لا يوجد A4 أو thermal runtime template.

### العملاء والموردون والذمم

**المصادر:** `src/components/PartnersView.tsx`, `src/components/PrintAccountStatementModal.tsx`.

`Partner` يحمل الاسم، النوع `customer|supplier|both`، الهاتف، العنوان، رصيد USD، رصيد ذهب عيار 21، قيود ذهب اختيارية، ملاحظة/رقم ضريبي وتاريخ إنشاء. المكون يعرض بطاقات هاتف/جدول، بحثاً بالاسم/الهاتف وفلترة بالنوع. إضافة وتعديل الشريك متاحان؛ نموذج الشريك يشمل هذه الحقول والأرصدة الابتدائية.

توجد شاشة كشف حساب/طباعة تجمع الفواتير والسندات الخاصة بالشريك من الذاكرة، وإجراءات طباعة/"PDF" عبر المتصفح ومشاركة WhatsApp. ذمم الذهب يمكن إدخالها وتسويتها محلياً في الشريك. الرصيد ليس ledger مستقل: يتغير أيضاً من فواتير الدين ومن السندات في `StoreContext`. لا توجد صفحة profile منفصلة أو pagination أو API.

### ذمم الأوزان المستقلة

**المصدر:** `src/components/GoldWeightAccountsView.tsx`.

`GoldWeightAccount` مستقل عن `Partner` ويحتوي شخصاً وهاتفاً اختيارياً وقيود `GoldDebtEntry`. يمكن إنشاء الشخص باسم فقط في الواجهة (الحقل phone موجود في النوع والدالة لكنه غير معروض في نافذة الإضافة)، ثم إضافة حركة: اسم قطعة، وزن موجب، اتجاه استلمنا منه/سلمنا له وملاحظة. الرصيد محسوب من القيود. لا يوجد تعديل/حذف/تسوية لحركات هذه الوحدة ولا ربط تلقائي بالفواتير أو الشركاء.

### الإدارة المالية

**المصادر:** `src/components/FinanceView.tsx`, `src/context/StoreContext.tsx`, `src/types.ts`.

التبويبات الفعلية:

| التبويب | الوظائف |
|---|---|
| الصناديق والخزائن | عرض صناديق USD/SYP، إضافة صندوق، والتحويل بين صندوقين بمبلغ مصدر/وجهة وبيان. |
| السندات المالية | إنشاء/تعديل/إلغاء سند قبض أو صرف أو مصروف، اختيار شريك/صندوق ومبالغ USD/SYP وسعر صرف ووزن ذهب/فئة/بيان. معاينة وطباعة ومشاركة. |
| دفتر اليومية العام | قائمة مركبة مشتقة في الواجهة من الفواتير والسندات، مع إجمالي مدين/دائن وطباعة. |
| المصاريف والتشغيل | قائمة سندات `expense`، إضافة مصروف سريع، وتصنيفات مصاريف محفوظة محلياً، وطباعة/مشاركة. |

`Voucher` يملك receipt/payment/expense ورقم سند يولده السياق، شريكاً اختيارياً، صندوقاً، مبالغ وعملة وسعر صرف ووزن/فئة/بيان و`createdBy`. `addVoucher` و`cancelVoucher` يعدلان رصيد الصندوق ورصيد الشريك وفق نوع السند. التحويل ينشئ سندين local (صرف وقبض). لا توجد شجرة حسابات، journal entries مخزنة، حسابات مدينة/دائنة حقيقية، ترحيل، إقفال، بنوك، أو double-entry ledger دائم. "دفتر اليومية" هو **عرض مشتق، لا محاسبة مزدوجة كاملة**.

### التقارير

**المصدر:** `src/components/ReportsView.tsx`.

توجد تعريفات تقارير: نظرة عامة، مبيعات، مبيعات حسب العميل، مبيعات حسب العيار، مشتريات، ربح، مخزون، مخزون حسب العيار، مخزون حسب مستودع، حركة قطعة، عملاء/موردون، ذمم، صناديق، مصاريف، أسعار ذهب، تدقيق، جرد. بياناتها من arrays في الـ context ومن snapshots `localStorage`. يوجد بحث نصي داخل `JSON.stringify`، فلتر فترة (`all/today/month`) وفلتر مستودع، وطباعة/مشاركة WhatsApp. لا توجد استعلامات قاعدة بيانات أو تصدير ملفات بيانات حقيقية أو رسوم ضمن هذه الشاشة. بعض العناوين واسعة، لكن الجسم المولد يعتمد صفوف مبسطة وفق التقرير؛ لذلك التغطية التفصيلية للتقارير **Partially implemented**.

### المستخدمون والصلاحيات

**المصدر:** `src/components/UsersView.tsx`, `src/App.tsx`, `src/components/Navbar.tsx`, `src/components/Sidebar.tsx`.

الأدوار الممثلة: `admin`, `sales`, `inventory_manager`, `accountant`. لكل مستخدم username وfullName ودور و`assignedWarehouseId` وpermissions من ثماني مفاتيح (`dashboard`, `inventory`, `invoices`, `partners`, `finance`, `reports`, `users`, `settings`) وحالة active وlastLogin اختياري. النموذج يدعم إضافة وتعديل هذه البيانات وإسناد مستودع ووضع كل checkbox صلاحية.

التنفيذ محلي فقط: `Navbar` يمكنه تبديل `currentUser` عبر قائمة إذا كانت صلاحية users متاحة، و`App.tsx` يعيد التبويب غير المسموح إلى أول تبويب مسموح و`Sidebar` يخفي عناصر القائمة. لا يوجد login، كلمة مرور، تحقق من active عند الدخول، policy لكل عملية، أو enforcement على خادم. المستخدم الذي يفتح DevTools أو يقرأ localStorage يستطيع الوصول إلى كامل البيانات المخزنة.

### الورديات

**المصادر:** `src/context/StoreContext.tsx`, `src/components/ShiftsView.tsx`.

الوردية تضم المستخدم والاسم ووقت البداية/النهاية وملخص عدد فواتير البيع وإجماليها ووزنها. يبدأ السياق وردية للمستخدم الحالي ويمنع إنشاء ثانية مفتوحة للمستخدم نفسه؛ يغلقها بحساب فواتير البيع ذات `shiftId`. فواتير جديدة تحمل الوردية المفتوحة تلقائياً. شاشة السجل تعرض المفتوحة/المغلقة وmodal بالفواتير. لا يوجد اعتماد مدير أو موقع مستودع للوردية أو منع خادمي.

### الإعدادات والأسعار

**المصادر:** `src/components/SettingsView.tsx`, `src/context/StoreContext.tsx`.

`GeneralSettings` يتضمن اسم المنشأة ووصفاً وعنواناً وهواتف، USD/SYP وسعر الصرف، سعر أونصة 24، هوامش شراء/بيع، تحديث تلقائي معلن وtax rate. الواجهة تسمح بتعديل الهوية/العملات/الهوامش والأسعار. دالة الاحتساب تستخدم `الأونصة / 31.1034768` ثم معاملات عيارات 24/22/21/18/14 وهوامش الشراء/البيع، وتحسب SYP. `autoSyncGoldPrices` موجود كحقل فقط؛ لا توجد مهمة أو API لجلب الذهب. زر إعادة الضبط يعيد بيانات initialData ويمسح مفتاح الحالة المحلي.

## 7. نموذج بيانات الذهب والمجوهرات

المفاهيم الموجودة والمستعملة فعلاً: العيار 24/22/21/18/14، سعر شراء وبيع USD/SYP للغرام، مصنعية USD للغرام، فئات القطع، كود القطعة، الوزن القائم ووزن الفصوص والوزن الصافي، ذهب كسر، سعر الغرام، مستودع، صورة قطعة، مخزون، وفواتير. لا توجد حقول منفصلة للفضة أو الأحجار الكريمة أو purity غير العيار أو QR/serial/manufacturer/collection. حقل الكود هو المعرّف الظاهر وقد يوصف في البحث كـ barcode، لكن لا يوجد توليد أو مسح barcode/QR.

## 8. المستودعات وعزل البيانات

العلاقات المنفذة:

| الجانب | الواقع الحالي | الدليل | القيد |
|---|---|---|---|
| سجل المستودعات | موجود | `Warehouse`, `initialWarehouses`, `addWarehouse` | manager نص لا علاقة User. |
| مخزون المستودع | `InventoryItem.warehouseId` | `InventoryView`, التحويل | كل المستخدمين ذوو صلاحية المخزون يستطيعون اختيار "كافة المستودعات". |
| فاتورة المستودع | `Invoice.warehouseId` وحقول البنود | `InvoicesView` | لا يجبر المستخدم على assignedWarehouseId. |
| مستخدم بمستودع واحد | `User.assignedWarehouseId` | `types.ts`, `UsersView` | واحد فقط، ولا يستخدم لترشيح عام. |
| عدة مستودعات للمستخدم | Not found in the current repository. | لا يوجد array/join model | — |
| مدير مستودع فعلي | دور `inventory_manager` فقط | `UserRole` | لا توجد علاقة مدير-موظفين أو scope. |
| نقل | تغيير `warehouseId` | `transferInventoryItem` | لا يوجد سجل حركة/موافقة. |
| تقارير حسب مستودع | فلتر UI | `ReportsView` | client-side ويمكن اختيار الكل. |
| عزل خادمي | Not found in the current repository. | لا Backend/DB/API | لا يمكن ضمان العزل. |

بالتالي يستطيع مستخدم مخصص لمستودع واحد، إن كان يملك صلاحية القسم، رؤية arrays كاملة واختيار مستودعات أخرى في غالب الواجهات. عزل بيانات مدير نبيل عن أحمد **غير منفذ** ولا يمكن ضمانه تقنياً في تطبيق localStorage بلا خادم.

## 9. طبقة البيانات وBackend وAPI

تدفق البيانات الموجود فعلاً:

```text
initialData.ts أو localStorage
        ↓
StoreProvider / React useState
        ↓
Components (فلترة وحسابات محلية)
        ↓
localStorage في المتصفح
```

لم يُعثر على `fetch` أو Axios أو GraphQL أو WebSocket أو REST client للتطبيق. الاستدعاء الوحيد لـ `fetch` موجود داخل `public/sw.js` لتخزين طلبات GET في Cache API، وليس API أعمال. لا يوجد Express code أو endpoints أو middleware أو CORS أو validation خادمي أو logs خادم. Express وdotenv و`@types/express` تبعيات غير مستخدمة. لم تُعثر على PostgreSQL/MySQL/SQLite/Supabase/Firebase/Prisma/Drizzle/Sequelize/Mongoose أو migrations.

## 10. الطباعة والاستيراد/التصدير

| العنصر | الحالة |
|---|---|
| طباعة فاتورة حيّة | موجودة عبر `PrintInvoiceModal` + `window.print()`، A5 أفقي CSS. |
| كشف حساب شريك | موجود عبر `PrintAccountStatementModal` + `window.print()`. |
| طباعة سند/يومية/مصاريف/تقارير | موجودة كـ `window.print()` من الواجهات. |
| "PDF" | واجهة تطبع وتترك المتصفح يحفظ PDF؛ لا يوجد مولّد PDF أو تنزيل PDF برمجي. |
| A5 static previews | ملفان HTML ثابتان: أفقي وعمودي، بعينات بيانات hardcoded، لغرض المعاينة فقط ولا يرتبطان بفاتورة runtime. |
| A4 أو thermal runtime | Not found in the current repository. |
| CSV/Excel/JSON import/export | Not found in the current repository. |

`public/invoice-print-preview.html` يضبط `@page size: A5 landscape`، و`invoice-print-preview-a5-portrait.html` يضبط `A5 portrait`. كلاهما يقدم قالباً عربياً ثابتاً بأرقام وبنود عينة.

## 11. PWA والتنبيهات

يوجد manifest عربي RTL وأيقونتان SVG. `sw.js` يخزن shell ويخزن كل GET ناجح ثم يعيد cached request أو `/index.html` عند فشل الشبكة. لا توجد offline data sync أو queue أو Push server. `InstallPrompt` يعرض زر تثبيت متى أتاح المتصفح `beforeinstallprompt`، وإغلاقه ضمن state فقط. تتولد Browser Notifications عند بداية/نهاية وردية وعند بيع في الفواتير، بعد منح المستخدم permission؛ لا توجد toast library أو إشعارات مركزية/خادمية.

## 12. UI/UX والتنسيق

الـ shell عربي RTL، header ثم شريط تنقل sticky، وحاوية `max-w-7xl`. التصميم يستخدم Tailwind بفئات متكررة داخل JSX وCSS مركزي مخصص للطباعة. الخط Cairo من Google Fonts. يوجد تصميم responsive: بطاقات أكثر كثافة للهاتف وجداول للشاشات الأكبر، drawer mobile في Sidebar، modals مشروطة، قوائم ثلاث نقاط، حالات فارغة نصية. لا يوجد design-system directory أو مكونات Button/Input/Table عامة أو dark-mode/theme switch أو نظام toast/skeleton/loading.

## 13. المصادقة والأمن والحالة الحالية

### المصادقة

**Not found in the current repository:** صفحة login، password hash، password reset، sessions، bearer tokens، cookies، logout، backend verification. `lastLogin` في بيانات المستخدم قيمة نموذجية معروضة فقط. تبديل المستخدم في Navbar لا يعادل تسجيل دخول.

### الوضع الأمني الحالي

- بيانات الأعمال والمستخدمين والصلاحيات في `localStorage` قابلة للقراءة والتعديل من أي شخص على جهاز/متصفح المستخدم.
- صلاحيات الواجهة تخفي/تعيد توجيه التبويب فقط؛ ليست Authorization خادمية ولا تحمي APIs (لأنه لا توجد APIs).
- لا يوجد validation موحد؛ معظم الإدخال يعتمد `required` HTML أو checks داخل handlers و`alert`.
- لا يوجد rate limiting أو audit immutable أو CSRF/CORS أو تشفير أسرار/بيانات.
- `.env.example` يحتوي placeholder لـ `GEMINI_API_KEY` و`APP_URL` فقط؛ لم توجد قيمة سرية فعلية أو استخدام Vite env في التطبيق. لا يشار إلى `hameed-hliwi.org` في الكود المملوك للمشروع.

## 14. النشاط والتدقيق

يوجد `ActivityLog` محلي يلتقط أحداثاً مثل إضافة/تعديل/حذف/نقل مخزون، فواتير، سندات، مستخدمين وإعدادات. يضم timestamp محلياً واسم المستخدم الحالي والفعل والتفاصيل والنوع. يعرض Dashboard آخر النشاطات. لا يسجل قبل/بعد، لا توجد هوية موثقة، لا يوجد تعديل trail أو deletion trail دائم، ويمكن حذفه مع localStorage أو reset.

## 15. مصفوفة التغطية الحالية

| Module / Feature | Exists | Functional | Data Source | Persistent | Backend Protected | Notes |
|---|---:|---:|---|---:|---:|---|
| Dashboard | Yes | Yes (محلياً) | Context/local data | Browser only | No | KPIs ورسوم محسوبة. |
| Inventory | Yes | Yes (محلياً) | initialData/localStorage | Browser only | No | CRUD ونقل بلا سجل حركة. |
| Warehouses | Yes | Partial | Context/localStorage | Browser only | No | CRUD محدود، no scope enforcement. |
| Sales invoices | Yes | Yes (محلياً) | Context/localStorage | Browser only | No | تغير مخزون/ذمم/صناديق محلياً. |
| Purchases | Yes | Partial | Context/localStorage | Browser only | No | ينشئ قطع مخزون؛ بلا receive workflow. |
| Returns | Yes | Partial | Context/localStorage | Browser only | No | نوع/UI موجودان، معالجة خاصة ناقصة. |
| Partners | Yes | Yes (محلياً) | Context/localStorage | Browser only | No | عملاء/موردون وأرصدة. |
| Gold weight accounts | Yes | Partial | Context/localStorage | Browser only | No | إضافة فقط، مستقل. |
| Cash boxes/vouchers | Yes | Yes (محلياً) | Context/localStorage | Browser only | No | ليست محاسبة مزدوجة. |
| Journal | Yes | Partial | Derived client data | Browser only | No | عرض مشتق. |
| Expenses | Yes | Yes (محلياً) | Context + extra local key | Browser only | No | تصنيفات مستقلة. |
| Reports | Yes | Partial | Client arrays | Browser only | No | مخرجات مبسطة، print/share. |
| Printing | Yes | Yes | Current UI data | N/A | N/A | Browser print، لا PDF generator. |
| Users/permissions | Yes | Partial | Context/localStorage | Browser only | No | UI gate only. |
| Authentication | No | No | — | — | No | Not found. |
| Warehouse isolation | Partial fields | No | Client fields | No | No | `warehouseId` موجود بلا isolation. |
| PWA | Yes | Partial | Cache + local data | Device/browser | No | لا sync. |
| Backend/database | No | No | — | — | No | Not found. |

## 16. مصفوفة الصلاحيات الحالية

الصلاحية تخزن كبوابات Boolean للوحدات، وليست Actions granular. ما يلي هو ما يمكن إثباته فقط:

| Role | Module | View | Create | Edit | Delete/Cancel | Approve | Print | Export | Warehouse Scope |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| أي دور مع Boolean مناسب | القسم المطابق | Yes | ليس مفصولاً | ليس مفصولاً | ليس مفصولاً | Not found | بحسب UI | طباعة المتصفح فقط | لا scope enforced |
| `admin` | مجرد قيمة role | لا قواعد role خاصة مثبتة | — | — | — | No | — | — | لا نطاق خاص |
| `sales` | مجرد قيمة role | يعتمد على permissions المخزنة | — | — | — | No | — | — | assignedWarehouseId لا يفرض |
| `inventory_manager` | مجرد قيمة role | يعتمد على permissions المخزنة | — | — | — | No | — | — | assignedWarehouseId لا يفرض |
| `accountant` | مجرد قيمة role | يعتمد على permissions المخزنة | — | — | — | No | — | — | assignedWarehouseId لا يفرض |

لا توجد صلاحية منفصلة للإنشاء/التعديل/الحذف/الاعتماد/الطباعة/التصدير في `UserPermissions`، ولا يوجد role policy. قسم الورديات مربوط بشكل غير مباشر بـ `permissions.users` في `App.tsx` وSidebar.

## 17. الجاهزية السحابية — حقائق حالية

### متاح

- بناء Vite static (`npm run build`).
- واجهة عربية متجاوبة وPWA shell.
- نماذج أولية واسعة وعمليات محلية واضحة.
- واجهات طباعة متصفح وصور client-side.

### متاح جزئياً

- الصلاحيات: بوابات واجهة لا حماية.
- المستودعات: foreign-key-like IDs في الكائنات لا عزل.
- النشاط/التدقيق: client-side قابل للمسح.
- المحاسبة والتقارير: حسابات/عروض محلية لا ledger دائم.
- الاستمرارية: localStorage على نفس المتصفح فقط.

### مفقود

- Backend/API وقاعدة بيانات وmigrations.
- مصادقة، session management، password management وauthorization خادمي.
- عزل المستودع/المدير/الموظف.
- تعدد المستخدمين والتزامن ومعالجة التعارضات.
- سجلات خادم، monitoring، backup/restore، rate limits وvalidation خادمي.
- إعدادات نشر مملوكة للمستودع (Nginx/PM2/Docker/CI) ودليل production.

## 18. جودة الكود والديون التقنية

- `StoreContext.tsx` مركزي ويحتوي الحالة ومنطق المخزون والفواتير والشركاء والصناديق والمستخدمين والإعدادات؛ الفصل إلى خدمات/طبقات domain **Not found**.
- بعض الشاشات كبيرة جداً: `FinanceView.tsx` و`InvoicesView.tsx` و`InventoryView.tsx`، بمنطق عمل وforms وrender في نفس الملف.
- الحسابات وعمليات العكس تتحقق داخل client state، ولا توجد transaction boundaries.
- البيانات الأولية مدمجة في `initialData.ts` وتظهر عند عدم وجود localStorage؛ لذا هي demo/hardcoded seed وليست قاعدة حقيقية.
- يوجد تكرار لطباعة/"PDF" من خلال `window.print` في عدة وحدات، ولا توجد خدمة تصدير موحدة.
- `clean` يستخدم `rm -rf` في `package.json`، وهو أمر POSIX وليس مضموناً في Windows PowerShell.

## 19. ميزات نموذجية أو غير مكتملة

- بيانات `initialData.ts` سجلات عينة ثابتة (مستودعات، مستخدمون، مخزون، شركاء، صناديق، فواتير، سندات، نشاط).
- معاينات فاتورة HTML الثابتة تضم بيانات ثابتة وليست موصولة بالـ context.
- Express/GenAI/dotenv/motion مثبتة لكنها غير مستخدمة في كود التطبيق.
- `autoSyncGoldPrices` و`taxRatePercent` موجودان في type/settings، لكن لا يوجد جلب أسعار تلقائي أو احتساب ضريبة داخل الفواتير.
- `return` معروض كنوع فاتورة لكن منطق مخزون/مالية خاص به غير مكتمل.
- لم توجد TODO comments بارزة في كود التطبيق، لكن الغياب المذكور أعلاه مدعوم ببنية المستودع ونتائج البحث.

## 20. أهم النتائج

### Already Implemented

- واجهة RTL متجاوبة بوحدات أعمال متعددة.
- CRUD محلي للمخزون/المستودعات/الشركاء/المستخدمين/الصناديق والسندات.
- حسابات ذهب ومصنعية وخصم ودفعات وذمم محلية.
- طباعة فواتير وكشوف وتقارير عبر المتصفح.
- PWA manifest/service worker وورديات/سجل نشاط محلي.

### Partially Implemented

- صلاحيات الأقسام، التقارير، المرتجعات، ذمم الأوزان، دفتر اليومية، PWA offline، وإدارة المستودعات.

### UI-Only / Mocked

- تبديل المستخدم هو محاكاة لا login.
- بيانات البداية والمعاينات الثابتة نموذجية.
- زر PDF يعتمد print dialog ولا ينشئ PDF.
- "دفتر اليومية" عرض مشتق لا دفتر محاسبي دائم.

### Completely Missing

- Backend، Database، API، authentication، server-side authorization، warehouse isolation، multi-device sync، deploy config في المستودع، backups، server logs.

### أعلى مخاطر التحويل السحابي

1. حفظ جميع الأعمال والصلاحيات في `localStorage` بلا مركزية أو نسخ احتياطي.
2. عدم وجود login أو حماية حقيقية أو عزل المستودعات.
3. تغير الفاتورة والمخزون والذمم والصناديق في عدة states محلية من دون transaction.
4. أرقام الفواتير تتولد من طول Array، لذلك غير آمنة للتوازي بين أجهزة.
5. الصور تحفظ ضمن browser state/`localStorage` وقد تتجاوز السعة ولا توجد storage خادمية.

## 21. مراجع الملفات الرئيسية

- الدخول والتطبيق: `src/main.tsx`, `src/App.tsx`, `index.html`.
- الحالة والمنطق المحلي: `src/context/StoreContext.tsx`.
- نماذج المجال: `src/types.ts`; البيانات الأولية: `src/data/initialData.ts`.
- التنقل والصلاحيات المرئية: `src/components/Sidebar.tsx`, `Navbar.tsx`, `UsersView.tsx`.
- الوحدات: `DashboardView.tsx`, `InventoryView.tsx`, `InvoicesView.tsx`, `PartnersView.tsx`, `GoldWeightAccountsView.tsx`, `FinanceView.tsx`, `ReportsView.tsx`, `ShiftsView.tsx`, `SettingsView.tsx`.
- الطباعة: `PrintInvoiceModal.tsx`, `PrintAccountStatementModal.tsx`, `src/index.css`, `public/invoice-print-preview*.html`.
- PWA: `public/manifest.webmanifest`, `public/sw.js`, `src/components/InstallPrompt.tsx`.
- التهيئة والحزم: `package.json`, `vite.config.ts`, `.env.example`, `tsconfig.json`.

