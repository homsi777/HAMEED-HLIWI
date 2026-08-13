import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  ShieldCheck, 
  UserPlus, 
  UserCheck, 
  UserX, 
  Building2, 
  Key, 
  CheckCircle2, 
  X, 
  Edit, 
  Lock,
  Building
} from 'lucide-react';
import { User, UserRole, UserPermissions } from '../types';

export const UsersView: React.FC = () => {
  const { users, warehouses, addUser, updateUser, currentUser, setCurrentUser } = useStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Form State
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [assignedWarehouseId, setAssignedWarehouseId] = useState(warehouses[0]?.id || 'wh-main');

  const [perms, setPerms] = useState<UserPermissions>({
    dashboard: true,
    inventory: true,
    invoices: true,
    partners: true,
    finance: false,
    reports: false,
    users: false,
    settings: false
  });

  const resetForm = () => {
    setUsername('');
    setFullName('');
    setRole('sales');
    setAssignedWarehouseId(warehouses[0]?.id || 'wh-main');
    setPerms({
      dashboard: true,
      inventory: true,
      invoices: true,
      partners: true,
      finance: false,
      reports: false,
      users: false,
      settings: false
    });
    setEditingUser(null);
  };

  const handleOpenEdit = (u: User) => {
    setEditingUser(u);
    setUsername(u.username);
    setFullName(u.fullName);
    setRole(u.role);
    setAssignedWarehouseId(u.assignedWarehouseId);
    setPerms(u.permissions);
    setShowAddModal(true);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !fullName.trim()) return;

    if (editingUser) {
      updateUser(editingUser.id, {
        username,
        fullName,
        role,
        assignedWarehouseId,
        permissions: perms
      });
    } else {
      addUser({
        username,
        fullName,
        role,
        assignedWarehouseId,
        permissions: perms,
        active: true
      });
    }

    setShowAddModal(false);
    resetForm();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-sm border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-amber-600 font-bold text-xs uppercase mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>نظام الصلاحيات والأدوار بالفروع</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            إدارة المستخدمين والصلاحيات والمستودعات
          </h2>
        </div>

        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-2 transition"
        >
          <UserPlus className="w-4 h-4" />
          <span>إنشاء مستخدم جديد</span>
        </button>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {users.map(u => {
          const wh = warehouses.find(w => w.id === u.assignedWarehouseId);
          const isCurrent = u.id === currentUser.id;

          return (
            <div
              key={u.id}
              className={`bg-white rounded-sm border p-5 shadow-sm space-y-4 transition ${
                isCurrent ? 'border-amber-400 border-r-4 border-r-amber-400' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-sm bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-lg">
                    {u.fullName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{u.fullName}</h3>
                    <p className="text-xs text-slate-500 font-mono">@{u.username}</p>
                  </div>
                </div>

                {isCurrent && (
                  <span className="text-[10px] bg-amber-400 text-slate-900 font-extrabold px-2 py-0.5 rounded-sm shadow-sm">
                    الحساب الحالي
                  </span>
                )}
              </div>

              <div className="bg-slate-50 p-3 rounded-sm border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>الدور الوظيفي:</span>
                  <span className="font-bold text-slate-900">
                    {u.role === 'admin' ? 'مدير عام' : u.role === 'accountant' ? 'محاسب' : u.role === 'inventory_manager' ? 'مدير مستودع' : 'موظف مبيعات'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>المستودع المرتبط:</span>
                  <span className="font-bold text-amber-900">{wh?.name || 'كافة المستودعات'}</span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>آخر دخول:</span>
                  <span className="font-bold text-slate-700 font-mono">{u.lastLogin || 'الآن'}</span>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">الأقسام المصرح بها:</span>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  {u.permissions.dashboard && <span className="bg-slate-100 px-2 py-0.5 rounded-sm text-slate-700">الرئيسية</span>}
                  {u.permissions.inventory && <span className="bg-amber-100 px-2 py-0.5 rounded-sm text-amber-900 font-bold">المخزون</span>}
                  {u.permissions.invoices && <span className="bg-slate-100 px-2 py-0.5 rounded-sm text-slate-700">الفواتير</span>}
                  {u.permissions.partners && <span className="bg-slate-100 px-2 py-0.5 rounded-sm text-slate-700">العملاء</span>}
                  {u.permissions.finance && <span className="bg-emerald-100 px-2 py-0.5 rounded-sm text-emerald-900 font-bold">المالية</span>}
                  {u.permissions.reports && <span className="bg-slate-100 px-2 py-0.5 rounded-sm text-slate-700">التقارير</span>}
                  {u.permissions.users && <span className="bg-purple-100 px-2 py-0.5 rounded-sm text-purple-900 font-bold">المستخدمين</span>}
                  {u.permissions.settings && <span className="bg-slate-100 px-2 py-0.5 rounded-sm text-slate-700">الإعدادات</span>}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <button
                  onClick={() => setCurrentUser(u)}
                  className="text-xs font-bold text-amber-700 hover:underline"
                >
                  التبديل لهذا المستخدم
                </button>

                <button
                  onClick={() => handleOpenEdit(u)}
                  className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-sm text-xs font-bold flex items-center gap-1 transition"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>تعديل الصلاحيات</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 shadow-2xl max-w-md w-full p-6 text-right space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3">
              <h3 className="text-base font-black text-slate-900">
                {editingUser ? 'تعديل مستخدم وصلاحياته' : 'إنشاء حساب مستخدم جديد'}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-900 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المستخدم (Username) *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: ahmad_hliwi"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم الكامل الظاهر *</label>
                <input
                  type="text"
                  required
                  placeholder="اسم الموظف"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">المسمى الوظيفي *</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as UserRole)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-bold"
                >
                  <option value="admin">مدير عام للنظام</option>
                  <option value="inventory_manager">مدير مستودع وفرع</option>
                  <option value="accountant">محاسب صائغ</option>
                  <option value="sales">موظف مبيعات</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الربط بالفرع / المستودع *</label>
                <select
                  value={assignedWarehouseId}
                  onChange={e => setAssignedWarehouseId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-medium"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Permissions Checkboxes */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block font-bold text-slate-800 mb-2">الصلاحيات حسب الأقسام:</label>
                <div className="grid grid-cols-2 gap-2 text-slate-700 font-medium">
                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.dashboard}
                      onChange={e => setPerms({ ...perms, dashboard: e.target.checked })}
                    />
                    <span>1. الرئيسية</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.inventory}
                      onChange={e => setPerms({ ...perms, inventory: e.target.checked })}
                    />
                    <span>2. المخزون</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.invoices}
                      onChange={e => setPerms({ ...perms, invoices: e.target.checked })}
                    />
                    <span>3. الفواتير</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.partners}
                      onChange={e => setPerms({ ...perms, partners: e.target.checked })}
                    />
                    <span>4. العملاء</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.finance}
                      onChange={e => setPerms({ ...perms, finance: e.target.checked })}
                    />
                    <span>5. المالية</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.reports}
                      onChange={e => setPerms({ ...perms, reports: e.target.checked })}
                    />
                    <span>6. التقارير</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.users}
                      onChange={e => setPerms({ ...perms, users: e.target.checked })}
                    />
                    <span>7. المستخدمين</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-sm border border-slate-200">
                    <input
                      type="checkbox"
                      checked={perms.settings}
                      onChange={e => setPerms({ ...perms, settings: e.target.checked })}
                    />
                    <span>8. الإعدادات</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-400 text-slate-900 rounded-sm font-bold shadow-sm"
                >
                  حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
