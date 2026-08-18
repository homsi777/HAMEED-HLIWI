import React, { useEffect, useState } from 'react';
import { ArrowRight, Scale } from 'lucide-react';
import { WeightCustodyPanel } from './WeightCustodyPanel';
import { inventoryApi } from '../services/inventoryApi';

/**
 * ذمم الأوزان — عهدة الوزن لدى أشخاص، بشاشة مستقلة.
 *
 * الشاشة لا تُضيف منطقاً: اللوحة نفسها هي التي كانت داخل صفحة ذمم الأوزان، ونقلها إلى هنا
 * لا يغيّر حركاتها ولا صلاحياتها. الشاشة ليست في القائمة الجانبية، لذلك زر الرجوع إلزامي.
 */
export const WeightCustodyView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [warehouseId, setWarehouseId] = useState('');
  useEffect(() => { void inventoryApi.warehouses().then(rows => setWarehouseId(current => current || rows[0]?.id || '')).catch(() => undefined); }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 bg-white p-3 shadow-sm sm:p-4">
        <button onClick={onBack} aria-label="رجوع" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-slate-200 text-slate-600 transition active:scale-95">
          <ArrowRight className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-900 sm:text-lg">
            <Scale className="h-5 w-5 shrink-0 text-amber-600" />ذمم أوزان
          </h2>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">وزن لنا أو علينا عند صائغ أو ملمّع أو عامل — لا علاقة له بذهب المحل ولا بالذمم التجارية.</p>
        </div>
      </div>

      <WeightCustodyPanel warehouseId={warehouseId || undefined} />
    </div>
  );
};
