import React, { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Plus,
  Search,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { employeesApi, type Employee } from "../services/employeesApi";
import { inventoryApi } from "../services/inventoryApi";
import type { Warehouse } from "../types";
const empty = {
  fullName: "",
  phone: "",
  warehouseId: "",
  schedule: "monthly",
  salaryCurrency: "USD",
  salaryAmount: "",
  notes: "",
  photoDataUrl: "",
};
type QuickState = {
  type: "advance" | "salary_payment";
  employeeId?: string;
} | null;
export const EmployeesView: React.FC<{
  initialQuickType?: "advance" | "salary_payment";
  onQuickFinished?: () => void;
}> = ({ initialQuickType, onQuickFinished }) => {
  const [rows, setRows] = useState<Employee[]>([]),
    [warehouses, setWarehouses] = useState<Warehouse[]>([]),
    [search, setSearch] = useState(""),
    [quick, setQuick] = useState<QuickState>(
      initialQuickType ? { type: initialQuickType } : null,
    ),
    [form, setForm] = useState<Employee | null | undefined>(undefined),
    [details, setDetails] = useState<Employee | null>(null),
    [error, setError] = useState("");
  const load = async () => {
    try {
      const [a, b] = await Promise.all([
        employeesApi.list(search),
        inventoryApi.warehouses(),
      ]);
      setRows(a);
      setWarehouses(b);
    } catch (e: any) {
      setError(e.message || "تعذر التحميل");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [search]);
  return (
    <div className="space-y-4">
      <header className="rounded-sm border-2 border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center bg-slate-900 text-amber-400">
            <UserRound />
          </span>
          <div>
            <h2 className="font-black">الموظفين</h2>
            <p className="text-[11px] text-slate-500">سلف ورواتب وصناديق</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            className="action-primary text-xs"
            onClick={() => setForm(null)}
          >
            <Plus />
            موظف جديد
          </button>
          <button
            className="action-dark text-xs"
            onClick={() => setQuick({ type: "advance" })}
          >
            <Banknote />
            سلفة
          </button>
          <button
            className="action-success text-xs"
            onClick={() => setQuick({ type: "salary_payment" })}
          >
            <WalletCards />
            تسليم راتب
          </button>
        </div>
      </header>
      <div className="relative">
        <Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث باسم الموظف"
          className="h-10 w-full border-2 border-slate-200 bg-white px-3 pr-9"
        />
      </div>
      {error && <p className="text-rose-600">{error}</p>}
      <div className="space-y-2">
        {rows.map((e) => (
          <button
            type="button"
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-2 border-slate-200 bg-white p-3 text-right transition hover:border-amber-300 hover:bg-amber-50"
            key={e.id}
            onClick={() => setDetails(e)}
          >
            <span className="min-w-0">
              <b className="block truncate">{e.fullName}</b>
              <small className="block truncate text-slate-500">
                {e.warehouseName} · راتب {e.salaryAmount} {e.salaryCurrency}
              </small>
            </span>
            <span className="text-left">
              <small className="block text-slate-500">المستحق</small>
              <b className="text-emerald-700">
                {e.payroll
                  ? `${e.payroll.remaining} ${e.payroll.currency}`
                  : "—"}
              </b>
            </span>
          </button>
        ))}
      </div>
      {quick && (
        <Quick
          {...quick}
          rows={rows}
          close={() => {
            setQuick(null);
            onQuickFinished?.();
          }}
          done={() => {
            setQuick(null);
            void load();
            onQuickFinished?.();
          }}
        />
      )}
      {form !== undefined && (
        <Form
          value={form}
          warehouses={warehouses}
          close={() => setForm(undefined)}
          done={() => {
            setForm(undefined);
            void load();
          }}
        />
      )}
      {details && (
        <EmployeeDetails
          employee={details}
          openQuick={(type) => {
            setDetails(null);
            setQuick({ type, employeeId: details.id });
          }}
          close={() => setDetails(null)}
        />
      )}
    </div>
  );
};
const EmployeeDetails = ({
  employee,
  close,
  openQuick,
}: {
  employee: Employee;
  close: () => void;
  openQuick: (type: "advance" | "salary_payment") => void;
}) => {
  const p = employee.payroll;
  return (
    <Modal title="بيانات الموظف" close={close}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <b>الاسم</b>
        <span>{employee.fullName}</span>
        <b>المستودع</b>
        <span>{employee.warehouseName}</span>
        <b>نظام الدوام</b>
        <span>
          {
            { daily: "يومي", weekly: "أسبوعي", monthly: "شهري" }[
              employee.schedule
            ]
          }
        </span>
        <b>الراتب</b>
        <span>
          {employee.salaryAmount} {employee.salaryCurrency}
        </span>
        {employee.phone && (
          <>
            <b>الهاتف</b>
            <span>{employee.phone}</span>
          </>
        )}
      </div>
      {p && (
        <div className="border border-amber-200 bg-amber-50 p-3 text-xs">
          <b>ملخص الفترة</b>
          <br />
          المسلّم: {p.salaryPayments} {p.currency} — السلف القائمة:{" "}
          {p.openAdvanceBalance} {p.currency}
          <br />
          <strong>
            المستحق: {p.remaining} {p.currency}
          </strong>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="action-dark" onClick={() => openQuick("advance")}>
          <Banknote />
          سلفة
        </button>
        <button
          className="action-success"
          onClick={() => openQuick("salary_payment")}
        >
          <WalletCards />
          تسليم راتب
        </button>
      </div>
      <button className="action-primary w-full" onClick={close}>
        إغلاق
      </button>
    </Modal>
  );
};
const Quick = ({
  type,
  employeeId,
  rows,
  close,
  done,
}: {
  type: "advance" | "salary_payment";
  employeeId?: string;
  rows: Employee[];
  close: () => void;
  done: () => void;
}) => {
  const [id, setId] = useState(employeeId || ""),
    [currency, setCurrency] = useState<"USD" | "SYP">("USD"),
    [cashboxId, setCashboxId] = useState(""),
    [amount, setAmount] = useState(""),
    [deductAdvances, setDeductAdvances] = useState(true),
    [note, setNote] = useState(""),
    [boxes, setBoxes] = useState<
      Awaited<ReturnType<typeof employeesApi.cashboxes>>
    >([]),
    [error, setError] = useState("");
  const employee = rows.find((x) => x.id === id),
    payroll = employee?.payroll;
  useEffect(() => {
    void employeesApi
      .cashboxes()
      .then(setBoxes)
      .catch((e: any) => setError(e.message || "تعذر تحميل الصناديق"));
  }, []);
  const available = useMemo(
    () =>
      boxes.filter(
        (b) =>
          b.currency === "USD" &&
          (!b.warehouseId || b.warehouseId === employee?.warehouseId),
      ),
    [boxes, employee?.warehouseId],
  );
  useEffect(() => {
    if (employee) {
      setCurrency(employee.salaryCurrency);
      setCashboxId("");
    }
  }, [employee?.id]);
  useEffect(() => {
    if (type !== "salary_payment" || !payroll) return;
    const deduction = deductAdvances
      ? Math.min(payroll.openAdvanceBalance, payroll.salaryDue)
      : 0;
    const due = Math.max(
      0,
      payroll.salaryDue - payroll.advanceDeductions - deduction,
    );
    const paid =
      currency === payroll.currency
        ? due
        : currency === "SYP"
          ? due * payroll.exchangeRateSypPerUsd
          : due / payroll.exchangeRateSypPerUsd;
    setAmount(String(paid));
  }, [
    type,
    payroll?.salaryDue,
    payroll?.advanceDeductions,
    payroll?.openAdvanceBalance,
    payroll?.currency,
    payroll?.exchangeRateSypPerUsd,
    deductAdvances,
    currency,
  ]);
  const save = async () => {
    if (!employee || !cashboxId || !amount)
      return setError("اختر الموظف والصندوق وأدخل المبلغ.");
    try {
      await employeesApi.transaction(id, {
        type,
        currency,
        cashboxId,
        amount,
        deductAdvances: type === "salary_payment" ? deductAdvances : undefined,
        note,
        idempotencyKey: crypto.randomUUID(),
      });
      done();
    } catch (e: any) {
      setError(e.message || "تعذر الحفظ");
    }
  };
  return (
    <Modal
      title={type === "advance" ? "سلفة موظف" : "تسليم راتب"}
      close={close}
    >
      <select
        className="field"
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        <option value="">اختر الموظف</option>
        {rows.map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName}
          </option>
        ))}
      </select>
      {payroll && (
        <div className="border border-amber-200 bg-amber-50 p-3 text-xs">
          <b>
            راتب الفترة: {payroll.salary} {payroll.currency}
          </b>
          <br />
          المسلّم سابقاً: {payroll.salaryPayments} — سلف غير مسددة:{" "}
          {payroll.openAdvanceBalance}
          <br />
          <strong>
            الراتب المستحق: {payroll.salaryDue} {payroll.currency}
          </strong>
          <br />
          سعر الصرف: 1 $ = {payroll.exchangeRateSypPerUsd} ل.س
        </div>
      )}
      {type === "salary_payment" &&
        payroll &&
        payroll.openAdvanceBalance > 0 && (
          <label className="flex items-center gap-2 border border-slate-200 p-3 text-xs">
            <input
              type="checkbox"
              checked={deductAdvances}
              onChange={(e) => setDeductAdvances(e.target.checked)}
            />
            خصم السلفة من راتب هذه الفترة (
            {Math.min(payroll.openAdvanceBalance, payroll.salaryDue)}{" "}
            {payroll.currency})
          </label>
        )}
      <div className="grid grid-cols-2 gap-2">
        <select
          className="field"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as any)}
        >
          <option value="USD">دولار</option>
          <option value="SYP">ليرة سورية</option>
        </select>
        <input
          className="field"
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={type === "salary_payment" ? "يُملأ تلقائياً" : "المبلغ"}
        />
      </div>
      <select
        className="field"
        value={cashboxId}
        onChange={(e) => setCashboxId(e.target.value)}
      >
        <option value="">اختر صندوق الرواتب والسلف (دولار)</option>
        {available.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} — الرصيد {b.balanceAmount} $
          </option>
        ))}
      </select>
      <input
        className="field"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ملاحظة"
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <button
        className={
          type === "advance" ? "action-dark w-full" : "action-success w-full"
        }
        onClick={() => void save()}
      >
        {type === "advance"
          ? "حفظ السلفة وإنشاء سند خروج"
          : "تسليم الراتب وإنشاء سند خروج"}
      </button>
    </Modal>
  );
};
const Form = ({
  value,
  warehouses,
  close,
  done,
}: {
  value: Employee | null;
  warehouses: Warehouse[];
  close: () => void;
  done: () => void;
}) => {
  const [f, setF] = useState<any>(
    value ? { ...value, salaryAmount: String(value.salaryAmount) } : empty,
  );
  const save = async () => {
    try {
      value
        ? await employeesApi.update(value.id, f)
        : await employeesApi.create(f);
      done();
    } catch {}
  };
  return (
    <Modal title={value ? "تعديل موظف" : "موظف جديد"} close={close}>
      <input
        className="field"
        value={f.fullName}
        onChange={(e) => setF({ ...f, fullName: e.target.value })}
        placeholder="الاسم"
      />
      <select
        className="field"
        value={f.warehouseId}
        onChange={(e) => setF({ ...f, warehouseId: e.target.value })}
      >
        <option value="">اختر المستودع</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <select
        className="field"
        value={f.schedule}
        onChange={(e) => setF({ ...f, schedule: e.target.value })}
      >
        <option value="daily">يومي</option>
        <option value="weekly">أسبوعي</option>
        <option value="monthly">شهري</option>
      </select>
      <select
        className="field"
        value={f.salaryCurrency}
        onChange={(e) => setF({ ...f, salaryCurrency: e.target.value })}
      >
        <option value="USD">دولار</option>
        <option value="SYP">ليرة سورية</option>
      </select>
      <input
        className="field"
        type="number"
        value={f.salaryAmount}
        onChange={(e) => setF({ ...f, salaryAmount: e.target.value })}
        placeholder="الراتب"
      />
      <button className="action-primary w-full" onClick={() => void save()}>
        حفظ
      </button>
    </Modal>
  );
};
const Modal = ({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) => (
  <div
    className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center"
    onClick={close}
  >
    <div
      className="w-full max-w-lg space-y-3 bg-white p-4 sm:rounded-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex justify-between border-b pb-3">
        <b>{title}</b>
        <button onClick={close}>
          <X />
        </button>
      </header>
      {children}
    </div>
  </div>
);
