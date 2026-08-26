// The single place where roles, permission codes and module visibility are defined.
// The SQL migration, the users API, the seed and the frontend navigation all read the
// same lists from here so a role can never mean one thing in the database and another
// thing on screen.

export const GLOBAL_SCOPE_PERMISSION = 'warehouses.scope.all';
export const OWN_SCOPE_PERMISSION = 'data.scope.own';

export const SYSTEM_ADMIN_ROLE = 'system_admin';
export const GENERAL_MANAGER_ROLE = 'general_manager';
export const WAREHOUSE_MANAGER_ROLE = 'warehouse_manager';
export const SELLER_ROLE = 'sales';

export type DataScope = 'global' | 'warehouses' | 'own';

export const ALL_PERMISSION_CODES = [
  'inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete', 'inventory.transfer', 'inventory.adjust',
  'sales.view', 'sales.create', 'sales.update', 'sales.cancel', 'sales.return', 'sales.discount', 'sales.approve',
  'purchases.view', 'purchases.create', 'purchases.cancel',
  'returns.view', 'returns.create', 'returns.cancel',
  'customers.view', 'customers.create', 'customers.update', 'customers.archive',
  'suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.archive',
  'reports.view', 'users.view', 'users.manage',
  'warehouses.view', 'warehouses.manage', GLOBAL_SCOPE_PERMISSION,
  'finance.view', 'finance.cashbox.manage', 'finance.voucher.create', 'finance.voucher.cancel', 'finance.transfer',
  // `accounting.journal.post` is seeded but not yet required by any endpoint; it is listed so
  // the General Manager holds everything the internal technical role holds.
  'accounting.view', 'accounting.accounts.manage', 'accounting.journal.create', 'accounting.journal.post', 'accounting.journal.reverse',
  'gold_accounts.view', 'gold_accounts.transaction.create', 'gold_accounts.adjust', 'gold_accounts.convert', 'gold_accounts.reverse',
  'gold_accounts.used_inventory.convert', 'gold_accounts.used_inventory.reverse',
  'shifts.view', 'shifts.open', 'shifts.close.request', 'shifts.approve', 'shifts.manage',
  'employees.view', 'employees.manage', 'employees.payroll',
  // TASK 18: company-wide operating parameters - the exchange rate, gold prices and store
  // identity. Reading them needs no permission at all: a seller cannot price a sale without
  // the gold price. Changing them is a commercial act and belongs to whoever runs the company.
  'settings.manage',
  // TASK 20: a backup file is the whole business in one document. Highest role only.
  'backups.manage',
  OWN_SCOPE_PERMISSION,
] as const;

// The General Manager runs the company: every operational permission plus global scope.
// `data.scope.own` is deliberately absent — it is a restriction, not a capability.
export const GENERAL_MANAGER_PERMISSIONS = ALL_PERMISSION_CODES.filter(code => code !== OWN_SCOPE_PERMISSION);

// A branch manager owns everything happening inside the warehouses assigned to them,
// including every seller's work there, but never company-wide configuration.
export const WAREHOUSE_MANAGER_PERMISSIONS = [
  'inventory.view', 'inventory.create', 'inventory.update', 'inventory.transfer', 'inventory.adjust',
  'sales.view', 'sales.create', 'sales.update', 'sales.cancel', 'sales.return', 'sales.discount',
  'purchases.view', 'purchases.create', 'purchases.cancel',
  'returns.view', 'returns.create', 'returns.cancel',
  'customers.view', 'customers.create', 'customers.update',
  'suppliers.view', 'suppliers.create', 'suppliers.update',
  'reports.view', 'users.view', 'users.manage', 'warehouses.view',
  'finance.view', 'finance.voucher.create',
  'accounting.view',
  'gold_accounts.view', 'gold_accounts.transaction.create', 'gold_accounts.used_inventory.convert',
  'shifts.view', 'shifts.approve', 'shifts.manage',
  'employees.view', 'employees.manage', 'employees.payroll',
];

// A seller sells. `data.scope.own` is what keeps two sellers standing at the same counter
// from reading each other's invoices; `customers.*` exists only so the invoice form works.
export const SELLER_PERMISSIONS = [
  'sales.view', 'sales.create',
  'returns.view', 'returns.create',
  'customers.view', 'customers.create',
  'warehouses.view',
  'shifts.view', 'shifts.open', 'shifts.close.request',
  OWN_SCOPE_PERMISSION,
];

export interface RolePreset {
  name: string;
  displayName: string;
  description: string;
  scope: DataScope;
  warehouseSelection: 'none' | 'single' | 'multiple';
  permissions: string[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    name: GENERAL_MANAGER_ROLE,
    displayName: 'المدير العام',
    description: 'صلاحية كاملة على كل فروع الشركة الحالية والمستقبلية دون ربط بمستودع.',
    scope: 'global',
    warehouseSelection: 'none',
    permissions: [...GENERAL_MANAGER_PERMISSIONS],
  },
  {
    name: WAREHOUSE_MANAGER_ROLE,
    displayName: 'مدير مستودع',
    description: 'إدارة كاملة لحركة المستودعات المسندة إليه ومتابعة عمل البائعين داخلها.',
    scope: 'warehouses',
    warehouseSelection: 'multiple',
    permissions: [...WAREHOUSE_MANAGER_PERMISSIONS],
  },
  {
    name: SELLER_ROLE,
    displayName: 'بائع',
    description: 'قسم الفواتير فقط داخل مستودع واحد، ولا يرى إلا فواتيره هو.',
    scope: 'own',
    warehouseSelection: 'single',
    permissions: [...SELLER_PERMISSIONS],
  },
];

// Which permission codes make a navigation module visible. A module appears when the user
// holds ANY of its codes. `partners` intentionally requires `customers.update`: a seller can
// pick or add a customer from inside the invoice form without the partners screen appearing.
export const MODULE_PERMISSIONS: Record<string, string[]> = {
  dashboard: ['reports.view'],
  inventory: ['inventory.view'],
  invoices: ['sales.view'],
  history: ['sales.view'],
  purchases: ['purchases.view'],
  returns: ['returns.view'],
  partners: ['customers.update', 'suppliers.view'],
  'gold-weight-accounts': ['gold_accounts.view'],
  finance: ['finance.view'],
  accounting: ['accounting.view'],
  reports: ['reports.view'],
  users: ['users.view'],
  shifts: ['shifts.manage'],
  employees: ['employees.view'],
  settings: ['settings.manage'],
};

export function visibleModules(permissions: string[]): string[] {
  const held = new Set(permissions);
  return Object.entries(MODULE_PERMISSIONS).filter(([, codes]) => codes.some(code => held.has(code))).map(([module]) => module);
}
