import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, UserPlus, UserCheck, UserX, Building2, Key, CheckCircle2, X, Edit,
  Lock, Globe2, Store, Search, ChevronLeft, ChevronRight, Loader2, AlertTriangle, SlidersHorizontal,
} from 'lucide-react';
import { usersApi, type ManagedUser, type RolePreset, type UsersCatalog } from '../services/infrastructureApi';

const SCOPE_LABEL: Record<string, string> = { global: 'كل فروع الشركة', warehouses: 'مستودعات محددة', own: 'فواتيره فقط' };
const STEPS = ['المستخدم', 'الدور', 'النطاق', 'الوصول'];

interface FormState { fullName: string; username: string; password: string; roleName: string; warehouseIds: string[]; extraPermissions: string[]; }
const EMPTY: FormState = { fullName: '', username: '', password: '', roleName: '', warehouseIds: [], extraPermissions: [] };

export const UsersView: React.FC = () => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [catalog, setCatalog] = useState<UsersCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [list, meta] = await Promise.all([usersApi.list(), usersApi.catalog()]);
      setUsers(list); setCatalog(meta);
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل المستخدمين.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(user => user.fullName.toLowerCase().includes(needle) || user.username.includes(needle));
  }, [users, search]);

  const openCreate = () => { setEditing(null); setWizardOpen(true); };
  const openEdit = (user: ManagedUser) => { setEditing(user); setWizardOpen(true); };

  const toggleStatus = async (user: ManagedUser) => {
    setError('');
    try { await usersApi.setStatus(user.id, !user.isActive); await load(); }
    catch (reason: any) { setError(reason?.message || 'تعذر تغيير حالة الحساب.'); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border-2 border-slate-200 rounded-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-slate-900 border-2 border-amber-400 rounded-sm grid place-items-center shrink-0">
            <ShieldCheck className="w-4.5 h-4.5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black text-slate-900 leading-tight">الصلاحيات والمستخدمين</h2>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">الأدوار والنطاق وصلاحية الوصول تُحفظ على الخادم</p>
          </div>
        </div>
        <button onClick={openCreate} className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-extrabold text-xs px-4 py-2.5 rounded-sm flex items-center justify-center gap-2 transition active:scale-[.98] shrink-0">
          <UserPlus className="w-4 h-4" />
          <span>مستخدم جديد</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو اسم المستخدم"
          className="w-full h-10 rounded-sm border-2 border-slate-200 bg-white pr-9 pl-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
      </div>

      {error && (
        <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-5 text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </p>
      )}

      {loading ? (
        <div className="bg-white border-2 border-slate-200 rounded-sm p-10 grid place-items-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* MOBILE: one card per user */}
          <div className="space-y-2.5 sm:hidden">
            {filtered.map(user => <UserCard key={user.id} user={user} onEdit={openEdit} onPassword={setPasswordTarget} onToggle={toggleStatus} />)}
            {!filtered.length && <p className="bg-white border-2 border-slate-200 rounded-sm p-6 text-center text-xs font-bold text-slate-400">لا يوجد مستخدمون مطابقون.</p>}
          </div>

          {/* DESKTOP: table */}
          <div className="hidden sm:block bg-white border-2 border-slate-200 rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-900 text-amber-400">
                  <tr>
                    <th className="px-3 py-2.5 font-extrabold">المستخدم</th>
                    <th className="px-3 py-2.5 font-extrabold">الدور</th>
                    <th className="px-3 py-2.5 font-extrabold">النطاق</th>
                    <th className="px-3 py-2.5 font-extrabold">الحالة</th>
                    <th className="px-3 py-2.5 font-extrabold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(user => (
                    <tr key={user.id} className={user.isActive ? '' : 'bg-slate-50/80 text-slate-400'}>
                      <td className="px-3 py-2.5">
                        <p className="font-black text-slate-900">{user.fullName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">@{user.username}</p>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-700">{user.roles.filter(role => !role.isSystem).map(role => role.displayName).join('، ') || '—'}</td>
                      <td className="px-3 py-2.5"><ScopeChip user={user} /></td>
                      <td className="px-3 py-2.5">
                        {user.isActive
                          ? <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700 border border-emerald-200"><UserCheck className="w-3 h-3" />نشط</span>
                          : <span className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-500 border border-slate-200"><UserX className="w-3 h-3" />معطّل</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <IconAction onClick={() => openEdit(user)} icon={Edit} label="تعديل" />
                          <IconAction onClick={() => setPasswordTarget(user)} icon={Key} label="كلمة المرور" />
                          <IconAction onClick={() => void toggleStatus(user)} icon={user.isActive ? Lock : CheckCircle2} label={user.isActive ? 'تعطيل' : 'تفعيل'} danger={user.isActive} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400 font-bold">لا يوجد مستخدمون مطابقون.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {wizardOpen && catalog && (
        <UserWizard catalog={catalog} editing={editing} onClose={() => setWizardOpen(false)} onSaved={async () => { setWizardOpen(false); await load(); }} />
      )}
      {passwordTarget && (
        <PasswordModal user={passwordTarget} onClose={() => setPasswordTarget(null)} onSaved={async () => { setPasswordTarget(null); await load(); }} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- pieces

const IconAction: React.FC<{ onClick: () => void; icon: typeof Edit; label: string; danger?: boolean }> = ({ onClick, icon: Icon, label, danger }) => (
  <button onClick={onClick} title={label} aria-label={label}
    className={`p-1.5 rounded-sm border transition active:scale-95 ${danger ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
    <Icon className="w-3.5 h-3.5" />
  </button>
);

const ScopeChip: React.FC<{ user: ManagedUser }> = ({ user }) => {
  if (user.scope === 'global') return <span className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-2 py-1 text-[10px] font-extrabold text-amber-800 border border-amber-300"><Globe2 className="w-3 h-3" />كل فروع الشركة</span>;
  const names = user.warehouses.map(warehouse => warehouse.name).join('، ') || '—';
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-700 border border-slate-200">
      <Store className="w-3 h-3" />{names}{user.scope === 'own' && ' • فواتيره فقط'}
    </span>
  );
};

const UserCard: React.FC<{ user: ManagedUser; onEdit: (user: ManagedUser) => void; onPassword: (user: ManagedUser) => void; onToggle: (user: ManagedUser) => void }> = ({ user, onEdit, onPassword, onToggle }) => (
  <div className={`bg-white border-2 rounded-sm p-3 ${user.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50/80'}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-black text-slate-900 text-sm leading-tight truncate">{user.fullName}</p>
        <p className="text-[10px] text-slate-500 font-mono mt-0.5">@{user.username}</p>
      </div>
      {user.isActive
        ? <span className="shrink-0 inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700 border border-emerald-200"><UserCheck className="w-3 h-3" />نشط</span>
        : <span className="shrink-0 inline-flex items-center gap-1 rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-500 border border-slate-200"><UserX className="w-3 h-3" />معطّل</span>}
    </div>
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="rounded-sm bg-slate-900 px-2 py-1 text-[10px] font-extrabold text-amber-400">{user.roles.filter(role => !role.isSystem).map(role => role.displayName).join('، ') || '—'}</span>
      <ScopeChip user={user} />
    </div>
    <div className="mt-3 grid grid-cols-3 gap-1.5">
      <button onClick={() => onEdit(user)} className="flex items-center justify-center gap-1 rounded-sm border border-slate-200 py-2 text-[11px] font-extrabold text-slate-700 transition active:scale-95"><Edit className="w-3.5 h-3.5" />تعديل</button>
      <button onClick={() => onPassword(user)} className="flex items-center justify-center gap-1 rounded-sm border border-slate-200 py-2 text-[11px] font-extrabold text-slate-700 transition active:scale-95"><Key className="w-3.5 h-3.5" />كلمة المرور</button>
      <button onClick={() => onToggle(user)} className={`flex items-center justify-center gap-1 rounded-sm border py-2 text-[11px] font-extrabold transition active:scale-95 ${user.isActive ? 'border-rose-200 text-rose-600' : 'border-emerald-200 text-emerald-700'}`}>
        {user.isActive ? <><Lock className="w-3.5 h-3.5" />تعطيل</> : <><CheckCircle2 className="w-3.5 h-3.5" />تفعيل</>}
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------- wizard

const UserWizard: React.FC<{ catalog: UsersCatalog; editing: ManagedUser | null; onClose: () => void; onSaved: () => Promise<void> }> = ({ catalog, editing, onClose, onSaved }) => {
  const presetOf = (name: string) => catalog.presets.find(preset => preset.name === name);
  const [form, setForm] = useState<FormState>(() => {
    if (!editing) return { ...EMPTY, roleName: catalog.presets[catalog.presets.length - 1]?.name ?? '' };
    const role = editing.roles.find(entry => !entry.isSystem)?.name ?? '';
    const preset = catalog.presets.find(entry => entry.name === role);
    return {
      fullName: editing.fullName, username: editing.username, password: '', roleName: role,
      warehouseIds: editing.warehouses.map(warehouse => warehouse.id),
      extraPermissions: preset ? editing.permissions.filter(code => !preset.permissions.includes(code)) : [],
    };
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const preset = presetOf(form.roleName);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(previous => ({ ...previous, [key]: value }));

  const stepValid = (index: number) => {
    if (index === 0) return form.fullName.trim().length > 1 && /^[\p{L}\p{M}\p{N}_.-]{3,80}$/u.test(form.username.trim()) && (editing ? true : form.password.length >= 8);
    if (index === 1) return Boolean(preset);
    if (index === 2) return preset?.warehouseSelection === 'none' || form.warehouseIds.length > 0;
    return true;
  };
  const canAdvance = stepValid(stepIndex);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const warehouseIds = preset?.warehouseSelection === 'none' ? [] : form.warehouseIds;
      if (editing) await usersApi.update(editing.id, { fullName: form.fullName.trim(), roleName: form.roleName, warehouseIds, permissions: form.extraPermissions });
      else await usersApi.create({ username: form.username.trim(), fullName: form.fullName.trim(), password: form.password, roleName: form.roleName, warehouseIds, permissions: form.extraPermissions });
      await onSaved();
    } catch (reason: any) { setError(reason?.message || 'تعذر حفظ المستخدم.'); setBusy(false); }
  };

  const field = 'h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400';

  return (
    <Sheet title={editing ? `تعديل: ${editing.fullName}` : 'مستخدم جديد'} onClose={onClose}>
      {/* Step indicator */}
      <div className="flex items-center gap-1 px-3 sm:px-4 pt-3">
        {STEPS.map((label, index) => (
          <button key={label} onClick={() => index <= stepIndex && setStepIndex(index)} disabled={index > stepIndex}
            className={`flex-1 rounded-sm px-1 py-1.5 text-[10px] font-extrabold transition ${index === stepIndex ? 'bg-amber-400 text-slate-900' : index < stepIndex ? 'bg-slate-900 text-amber-400' : 'bg-slate-100 text-slate-400'}`}>
            <span className="hidden xs:inline">{index + 1}. </span>{label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4">
        {/* ---- 1. user ---- */}
        {stepIndex === 0 && (
          <>
            <label className="block text-xs font-extrabold text-slate-700">الاسم الكامل
              <input value={form.fullName} onChange={event => set('fullName', event.target.value)} placeholder="مثال: أحمد حليوي" className={`${field} mt-1.5`} />
            </label>
            <label className="block text-xs font-extrabold text-slate-700">اسم المستخدم
              <input value={form.username} onChange={event => set('username', event.target.value)} disabled={Boolean(editing)} dir="ltr" autoComplete="off"
                placeholder="ahmad_seller" className={`${field} mt-1.5 text-left disabled:bg-slate-100 disabled:text-slate-500`} />
              <span className="mt-1 block text-[10px] font-medium text-slate-400">حروف عربية أو إنكليزية وأرقام و . _ - فقط، ولا يمكن تغييره لاحقاً.</span>
            </label>
            {!editing && (
              <label className="block text-xs font-extrabold text-slate-700">كلمة المرور
                <input type="password" value={form.password} onChange={event => set('password', event.target.value)} autoComplete="new-password" placeholder="8 أحرف على الأقل" className={`${field} mt-1.5`} />
              </label>
            )}
          </>
        )}

        {/* ---- 2. role ---- */}
        {stepIndex === 1 && (
          <div className="space-y-2.5">
            {catalog.presets.map(entry => (
              <button key={entry.name} onClick={() => { set('roleName', entry.name); if (entry.warehouseSelection === 'none') set('warehouseIds', []); }}
                className={`w-full text-right rounded-sm border-2 p-3 transition ${form.roleName === entry.name ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-slate-900 text-sm">{entry.displayName}</span>
                  <span className="rounded-sm bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold text-amber-400 shrink-0">{SCOPE_LABEL[entry.scope]}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 font-medium text-slate-500">{entry.description}</p>
              </button>
            ))}
          </div>
        )}

        {/* ---- 3. scope ---- */}
        {stepIndex === 2 && preset && (
          preset.warehouseSelection === 'none' ? (
            <div className="rounded-sm border-2 border-amber-300 bg-amber-50 p-4 text-center">
              <Globe2 className="mx-auto mb-2 h-7 w-7 text-amber-700" />
              <p className="text-sm font-black text-slate-900">النطاق: كل مستودعات الشركة</p>
              <p className="mt-1.5 text-[11px] font-medium leading-5 text-slate-600">لا حاجة لاختيار مستودع. أي فرع يُضاف مستقبلاً يصبح ضمن نطاقه تلقائياً.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-slate-700">{preset.warehouseSelection === 'single' ? 'اختر المستودع (واحد فقط)' : 'اختر المستودعات المسموحة'}</p>
              {catalog.warehouses.map(warehouse => {
                const selected = form.warehouseIds.includes(warehouse.id);
                return (
                  <button key={warehouse.id} onClick={() => set('warehouseIds', preset.warehouseSelection === 'single' ? [warehouse.id] : selected ? form.warehouseIds.filter(id => id !== warehouse.id) : [...form.warehouseIds, warehouse.id])}
                    className={`w-full flex items-center justify-between gap-2 rounded-sm border-2 p-3 text-right transition ${selected ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <span className="flex items-center gap-2 min-w-0">
                      <Building2 className={`h-4 w-4 shrink-0 ${selected ? 'text-amber-700' : 'text-slate-400'}`} />
                      <span className="truncate text-sm font-bold text-slate-800">{warehouse.name}</span>
                    </span>
                    {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-700" />}
                  </button>
                );
              })}
              {!catalog.warehouses.length && <p className="rounded-sm bg-slate-100 p-3 text-center text-[11px] font-bold text-slate-500">لا توجد مستودعات ضمن نطاقك.</p>}
            </div>
          )
        )}

        {/* ---- 4. access ---- */}
        {stepIndex === 3 && preset && (
          <div className="space-y-3">
            <div className="rounded-sm border-2 border-slate-200 bg-slate-50 p-3 space-y-2">
              <Row label="الاسم" value={form.fullName} />
              <Row label="اسم المستخدم" value={`@${form.username}`} />
              <Row label="الدور" value={preset.displayName} />
              <Row label="النطاق" value={preset.warehouseSelection === 'none' ? 'كل فروع الشركة' : catalog.warehouses.filter(warehouse => form.warehouseIds.includes(warehouse.id)).map(warehouse => warehouse.name).join('، ')} />
              {preset.scope === 'own' && <Row label="رؤية الفواتير" value="فواتيره هو فقط" />}
            </div>

            <button onClick={() => setAdvanced(value => !value)} className="w-full flex items-center justify-between rounded-sm border-2 border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-700">
              <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-slate-400" />صلاحيات إضافية (اختياري)</span>
              <span className="text-[10px] font-bold text-slate-400">{advanced ? 'إخفاء' : `${form.extraPermissions.length} مُضافة`}</span>
            </button>

            {advanced && (
              <div className="rounded-sm border-2 border-slate-200 bg-white p-2 max-h-64 overflow-y-auto space-y-1">
                {catalog.permissions.filter(code => !preset.permissions.includes(code) && code !== 'warehouses.scope.all' && code !== 'data.scope.own').map(code => {
                  const checked = form.extraPermissions.includes(code);
                  return (
                    <button key={code} onClick={() => set('extraPermissions', checked ? form.extraPermissions.filter(entry => entry !== code) : [...form.extraPermissions, code])}
                      className={`w-full flex items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-right transition ${checked ? 'bg-amber-50 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                      <span dir="ltr" className="font-mono text-[11px] font-bold">{code}</span>
                      {checked && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-amber-700" />}
                    </button>
                  );
                })}
              </div>
            )}

            {editing && (
              <p className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800">
                تغيير الدور أو النطاق ينهي جلسات هذا المستخدم فوراً ويطلب منه تسجيل الدخول من جديد.
              </p>
            )}
          </div>
        )}

        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-5 text-rose-700">{error}</p>}
      </div>

      {/* Sticky footer: the save button is always reachable on a phone. */}
      <div className="border-t-2 border-slate-200 bg-white p-3 flex items-center gap-2">
        {stepIndex > 0 && (
          <button onClick={() => setStepIndex(stepIndex - 1)} className="flex h-11 items-center justify-center gap-1 rounded-sm border-2 border-slate-200 px-4 text-xs font-extrabold text-slate-600 transition active:scale-95">
            <ChevronRight className="h-4 w-4" />السابق
          </button>
        )}
        {stepIndex < STEPS.length - 1 ? (
          <button disabled={!canAdvance} onClick={() => setStepIndex(stepIndex + 1)}
            className="flex h-11 flex-1 items-center justify-center gap-1 rounded-sm bg-slate-900 text-xs font-extrabold text-amber-400 transition active:scale-[.98] disabled:opacity-40">
            التالي<ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <button disabled={busy || !stepValid(0) || !stepValid(2)} onClick={() => void submit()}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {editing ? 'حفظ التعديلات' : 'إنشاء المستخدم'}
          </button>
        )}
      </div>
    </Sheet>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 text-xs">
    <span className="font-bold text-slate-500 shrink-0">{label}</span>
    <span className="font-black text-slate-900 text-left break-words">{value || '—'}</span>
  </div>
);

const PasswordModal: React.FC<{ user: ManagedUser; onClose: () => void; onSaved: () => Promise<void> }> = ({ user, onClose, onSaved }) => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await usersApi.resetPassword(user.id, password); await onSaved(); }
    catch (reason: any) { setError(reason?.message || 'تعذر تعيين كلمة المرور.'); setBusy(false); }
  };
  return (
    <Sheet title={`كلمة مرور: ${user.fullName}`} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
          تُعيَّن كلمة مرور جديدة ولا تُعرض كلمة المرور السابقة. ستنتهي جلسات هذا المستخدم فوراً.
        </p>
        <label className="block text-xs font-extrabold text-slate-700">كلمة المرور الجديدة
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder="8 أحرف على الأقل"
            className="mt-1.5 h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
        </label>
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <div className="border-t-2 border-slate-200 bg-white p-3">
        <button disabled={busy || password.length < 8} onClick={() => void submit()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}تعيين كلمة المرور
        </button>
      </div>
    </Sheet>
  );
};

/** Rises from the bottom on a phone, centres as a dialog from `sm` up. */
const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
    <div onClick={event => event.stopPropagation()}
      className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:h-auto sm:max-h-[88vh] sm:max-w-lg sm:rounded-sm sm:border-2 sm:border-slate-300">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-200 bg-slate-900 px-3 py-3">
        <h3 className="truncate text-sm font-black text-amber-400">{title}</h3>
        <button onClick={onClose} aria-label="إغلاق" className="rounded-sm p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </div>
);
