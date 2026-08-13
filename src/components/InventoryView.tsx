import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  PackageSearch, 
  Plus, 
  Search, 
  Filter, 
  Building2, 
  ArrowRightLeft, 
  Trash2, 
  Edit, 
  Check, 
  X, 
  Sparkles, 
  Scale, 
  Layers, 
  Coins,
  QrCode,
  Tag,
  Camera,
  Upload,
  Image as ImageIcon,
  MoreVertical
} from 'lucide-react';
import { GoldKarat, ItemCategory, InventoryItem, Warehouse } from '../types';

export const InventoryView: React.FC = () => {
  const { 
    inventory, 
    warehouses, 
    goldPrices, 
    addInventoryItem, 
    updateInventoryItem, 
    deleteInventoryItem, 
    transferInventoryItem,
    addWarehouse,
    formatMoney,
    activeCurrency
  } = useStore();

  const [activeSubTab, setActiveSubTab] = useState<'items' | 'warehouses'>('items');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [selectedKarat, setSelectedKarat] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Modals
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [showTransferModal, setShowTransferModal] = useState<InventoryItem | null>(null);
  const [imagePreviewItem, setImagePreviewItem] = useState<InventoryItem | null>(null);
  const [activeItemMenu, setActiveItemMenu] = useState<{ item: InventoryItem; top: number; left: number } | null>(null);
  const [targetWarehouseForTransfer, setTargetWarehouseForTransfer] = useState('');
  
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);

  // Form State for Add/Edit Gold Item
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ItemCategory>('أطقم');
  const [formKarat, setFormKarat] = useState<GoldKarat>('21');
  const [formGrossWeight, setFormGrossWeight] = useState('');
  const [formStoneWeight, setFormStoneWeight] = useState('0');
  const [formLaborFeePerGram, setFormLaborFeePerGram] = useState('');
  const [formWarehouseId, setFormWarehouseId] = useState(warehouses[0]?.id || 'wh-main');
  const [formCode, setFormCode] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [imageError, setImageError] = useState('');

  // Form State for Warehouse
  const [whName, setWhName] = useState('');
  const [whLocation, setWhLocation] = useState('حلب - سوريا');
  const [whManager, setWhManager] = useState('');
  const [whPhone, setWhPhone] = useState('');

  const resetItemForm = () => {
    setFormName('');
    setFormCategory('أطقم');
    setFormKarat('21');
    setFormGrossWeight('');
    setFormStoneWeight('0');
    setFormLaborFeePerGram('');
    setFormWarehouseId(warehouses[0]?.id || 'wh-main');
    setFormCode(`GLD-21-${Math.floor(100 + Math.random() * 900)}`);
    setFormNotes('');
    setFormImageUrl('');
    setEditingItem(null);
  };

  const handleOpenEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormCategory(item.category);
    setFormKarat(item.karat);
    setFormGrossWeight(item.grossWeightGrams.toString());
    setFormStoneWeight(item.stoneWeightGrams.toString());
    setFormLaborFeePerGram(item.laborFeeUSDPerGram.toString());
    setFormWarehouseId(item.warehouseId);
    setFormCode(item.code);
    setFormNotes(item.notes || '');
    setFormImageUrl(item.imageUrl || '');
    setShowAddItemModal(true);
  };

  const handleItemImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('يرجى اختيار ملف صورة فقط.');
      return;
    }

    setImageError('');
    setIsCompressingImage(true);
    const reader = new FileReader();
    reader.onerror = () => { setImageError('تعذر قراءة الصورة.'); setIsCompressingImage(false); };
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => { setImageError('تعذر معالجة الصورة.'); setIsCompressingImage(false); };
      image.onload = () => {
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) { setImageError('تعذر ضغط الصورة.'); setIsCompressingImage(false); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setFormImageUrl(canvas.toDataURL('image/jpeg', 0.8));
        setIsCompressingImage(false);
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    const gross = parseFloat(formGrossWeight);
    const stone = parseFloat(formStoneWeight) || 0;
    const labor = parseFloat(formLaborFeePerGram) || 0;

    if (isNaN(gross) || gross <= 0) return;

    const net = Math.max(0, gross - stone);
    const totalLabor = net * labor;

    if (editingItem) {
      updateInventoryItem(editingItem.id, {
        name: formName,
        category: formCategory,
        karat: formKarat,
        grossWeightGrams: gross,
        stoneWeightGrams: stone,
        netWeightGrams: net,
        laborFeeUSDPerGram: labor,
        totalLaborFeeUSD: totalLabor,
        warehouseId: formWarehouseId,
        code: formCode,
        notes: formNotes,
        imageUrl: formImageUrl
      });
    } else {
      addInventoryItem({
        name: formName,
        category: formCategory,
        karat: formKarat,
        grossWeightGrams: gross,
        stoneWeightGrams: stone,
        netWeightGrams: net,
        laborFeeUSDPerGram: labor,
        totalLaborFeeUSD: totalLabor,
        warehouseId: formWarehouseId,
        status: 'in_stock',
        code: formCode,
        notes: formNotes,
        imageUrl: formImageUrl
      });
    }

    setShowAddItemModal(false);
    resetItemForm();
  };

  const handleSaveWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim()) return;
    addWarehouse({
      name: whName,
      location: whLocation,
      manager: whManager,
      phone: whPhone
    });
    setWhName('');
    setWhManager('');
    setWhPhone('');
    setShowAddWarehouseModal(false);
  };

  const handleExecuteTransfer = () => {
    if (showTransferModal && targetWarehouseForTransfer) {
      transferInventoryItem(showTransferModal.id, targetWarehouseForTransfer);
      setShowTransferModal(null);
      setTargetWarehouseForTransfer('');
    }
  };

  const saveStocktakeSnapshot = () => {
    const snapshot = { id: `stk-${Date.now()}`, date: new Date().toLocaleString('ar-SY'), itemCount: filteredInventory.length, netWeight: totalFilteredGrams };
    const stored = JSON.parse(localStorage.getItem('HAMEED_HLIWI_STOCKTAKES') || '[]');
    localStorage.setItem('HAMEED_HLIWI_STOCKTAKES', JSON.stringify([snapshot, ...stored]));
    setShowStocktakeModal(false);
  };

  const toggleItemMenu = (event: React.MouseEvent<HTMLButtonElement>, item: InventoryItem) => {
    event.stopPropagation();
    if (activeItemMenu?.item.id === item.id) {
      setActiveItemMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveItemMenu({ item, top: rect.bottom + 6, left: Math.max(8, rect.left - 168) });
  };

  // Filtered Inventory Items
  const filteredInventory = inventory.filter(item => {
    if (item.status !== 'in_stock') return false;
    if (selectedWarehouse !== 'all' && item.warehouseId !== selectedWarehouse) return false;
    if (selectedKarat !== 'all' && item.karat !== selectedKarat) return false;
    if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Totals for filtered list
  const totalFilteredGrams = filteredInventory.reduce((acc, i) => acc + i.netWeightGrams, 0);
  const totalFilteredValueUSD = filteredInventory.reduce((acc, i) => {
    const p = goldPrices.find(g => g.karat === i.karat);
    const pricePerGram = p ? p.sellPriceUSDPerGram : 75;
    return acc + (i.netWeightGrams * pricePerGram + i.totalLaborFeeUSD);
  }, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header & Sub-tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-white p-3 sm:p-5 rounded-sm border border-slate-200 shadow-sm">
        <div>
          <div className="hidden sm:flex items-center gap-2 text-amber-600 font-bold text-xs uppercase mb-1">
            <PackageSearch className="w-4 h-4" />
            <span>إدارة الذهب والمخزون الحقيقي</span>
          </div>
          <h2 className="text-base sm:text-2xl font-black text-slate-900 tracking-tight">
            مخزون الذهب والمستودعات
          </h2>
        </div>

        <div className="grid grid-cols-3 sm:flex items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <div className="col-span-2 bg-slate-100 p-1 rounded-sm border border-slate-200 grid grid-cols-2 sm:flex items-center text-xs font-bold w-full sm:w-auto">
            <button
              onClick={() => setActiveSubTab('items')}
              className={`px-2 sm:px-4 py-2 rounded-sm transition leading-4 ${
                activeSubTab === 'items'
                  ? 'bg-amber-400 text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              قطع ومجوهرات الذهب ({inventory.filter(i => i.status === 'in_stock').length})
            </button>

            <button
              onClick={() => setActiveSubTab('warehouses')}
              className={`px-2 sm:px-4 py-2 rounded-sm transition leading-4 ${
                activeSubTab === 'warehouses'
                  ? 'bg-amber-400 text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              المستودعات بالفروع ({warehouses.length})
            </button>
          </div>

          {activeSubTab === 'items' ? (
            <button
              onClick={() => {
                resetItemForm();
                setShowAddItemModal(true);
              }}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2.5 rounded-sm font-bold text-xs shadow flex items-center justify-center gap-2 transition w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة قطعة جديدة</span>
            </button>
          ) : (
            <button
              onClick={() => setShowAddWarehouseModal(true)}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2.5 rounded-sm font-bold text-xs shadow flex items-center justify-center gap-2 transition w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مستودع جديد</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'items' && (
        <>
          {/* Filters Bar */}
          <div className="bg-white p-3 sm:p-4 rounded-sm border border-slate-200 shadow-sm grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3 text-xs">
            {/* Search Input */}
            <div className="col-span-2 lg:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="ابحث باسم القطعة، الكود، الباركود..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-sm focus:outline-none focus:border-amber-400 text-slate-800 font-medium"
              />
            </div>

            <button type="button" onClick={() => setShowMobileFilters(value => !value)} className="sm:hidden col-span-1 flex items-center justify-center gap-1 rounded-sm border border-slate-200 bg-slate-50 py-2 text-[10px] font-bold text-slate-700 whitespace-nowrap"><Filter className="w-3.5 h-3.5 text-amber-700" />{showMobileFilters ? 'إخفاء' : 'تصفية النتائج'}</button>

            {/* Warehouse Filter */}
            <div className={showMobileFilters ? '' : 'hidden sm:block'}>
              <select
                value={selectedWarehouse}
                onChange={e => setSelectedWarehouse(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-sm focus:outline-none focus:border-amber-400 text-slate-800 font-medium"
              >
                <option value="all">كافة المستودعات والفروع</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Karat Filter */}
            <div className={showMobileFilters ? '' : 'hidden sm:block'}>
              <select
                value={selectedKarat}
                onChange={e => setSelectedKarat(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-sm focus:outline-none focus:border-amber-400 text-slate-800 font-medium"
              >
                <option value="all">كافة العيارات</option>
                <option value="24">عيار 24</option>
                <option value="22">عيار 22</option>
                <option value="21">عيار 21</option>
                <option value="18">عيار 18</option>
                <option value="14">عيار 14</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className={showMobileFilters ? '' : 'hidden sm:block'}>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-sm focus:outline-none focus:border-amber-400 text-slate-800 font-medium"
              >
                <option value="all">كافة التصنيفات</option>
                <option value="أطقم">أطقم ذهب</option>
                <option value="خواتم ومحابس">خواتم ومحابس</option>
                <option value="أساور ومبارم">أساور ومبارم</option>
                <option value="قلائد وسلاسل">قلائد وسلاسل</option>
                <option value="أقراط">أقراط</option>
                <option value="سبائك وليرات">سبائك وليرات</option>
                <option value="ذهب كسر">ذهب كسر</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end"><button type="button" onClick={() => setShowStocktakeModal(true)} className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 flex items-center gap-1.5"><Scale className="w-4 h-4" />جرد</button></div>

          {/* Filter Summary Banner */}
          <div className="hidden sm:flex bg-slate-900 border border-slate-800 text-white rounded-sm p-3 px-4 flex-wrap items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-amber-400" />
              <span>نتائج العرض: <strong className="text-amber-400 font-mono">{filteredInventory.length}</strong> قطعة بالمخزن</span>
            </div>
            <div className="flex items-center gap-6 font-bold font-mono">
              <span className="text-slate-300 font-sans">
                الأوزان الصافية: <span className="text-amber-400 font-mono text-sm">{totalFilteredGrams.toFixed(2)} غرام</span>
              </span>
              <span className="text-slate-300 font-sans">
                القيمة الإجمالية: <span className="text-amber-400 font-mono text-sm">{formatMoney(totalFilteredValueUSD)}</span>
              </span>
            </div>
          </div>

          {/* Inventory Items Table (Desktop) & Cards (Mobile) */}
          <div className="bg-white rounded-sm border border-slate-200 shadow-sm overflow-hidden">
            {/* MOBILE CARDS VIEW */}
            <div className="block sm:hidden divide-y divide-slate-200">
              {filteredInventory.length === 0 ? (
                <div className="py-10 text-center text-slate-400 font-medium">
                  لا يوجد قطع مطابقة لمعايير البحث الحالية
                </div>
              ) : (
                filteredInventory.map(item => {
                  const p = goldPrices.find(g => g.karat === item.karat);
                  const pricePerGram = p ? p.sellPriceUSDPerGram : 75;
                  const estimatedTotalUSD = item.netWeightGrams * pricePerGram + item.totalLaborFeeUSD;
                  const wh = warehouses.find(w => w.id === item.warehouseId);

                  return (
                    <div key={item.id} className="p-4 space-y-3 bg-white hover:bg-amber-50/30 transition">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {item.imageUrl && <button type="button" onClick={() => setImagePreviewItem(item)} aria-label={`عرض صورة ${item.name}`} className="h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-amber-300 bg-amber-50"><img src={item.imageUrl} alt="" className="h-full w-full object-cover" /></button>}
                          <span className="font-mono text-[10px] bg-slate-900 text-amber-400 px-2 py-0.5 rounded font-bold">
                            {item.code}
                          </span>
                          <span className="font-extrabold text-slate-900 text-sm">{item.name}</span>
                        </div>
                        <span className="bg-amber-400 text-slate-900 font-black px-2 py-0.5 rounded text-[10px]">
                          عيار {item.karat}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-50 p-2.5 rounded border border-slate-100">
                        <div>
                          <span className="text-[10px] text-slate-400 block font-sans">التصنيف:</span>
                          <span className="font-bold text-slate-800 font-sans">{item.category}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block font-sans">المستودع:</span>
                          <span className="font-bold text-slate-800 font-sans">{wh?.name || 'الرئيسي'}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block font-sans">الوزن الصافي:</span>
                          <span className="font-black text-amber-900">{item.netWeightGrams.toFixed(2)} غ</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block font-sans">القيمة التقديرية:</span>
                          <span className="font-black text-emerald-800">{formatMoney(estimatedTotalUSD)}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <div className="text-[10px] text-slate-500 font-mono">
                          أجرة/غ: ${item.laborFeeUSDPerGram}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setShowTransferModal(item);
                              setTargetWarehouseForTransfer(item.warehouseId);
                            }}
                            className="hidden p-1.5 bg-slate-100 text-slate-800 hover:bg-slate-200 rounded text-xs flex items-center gap-1"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span className="text-[10px]">نقل</span>
                          </button>

                          <button
                            onClick={() => handleOpenEditItem(item)}
                            className="hidden p-1.5 bg-amber-100 text-amber-900 hover:bg-amber-200 rounded text-xs flex items-center gap-1 font-bold"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span className="text-[10px]">تعديل</span>
                          </button>

                          <button
                            onClick={() => deleteInventoryItem(item.id)}
                            className="hidden p-1.5 bg-rose-100 text-rose-800 hover:bg-rose-200 rounded text-xs"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={(event) => toggleItemMenu(event, item)} className={`p-1.5 rounded-sm transition flex items-center justify-center border shadow-sm ${activeItemMenu?.item.id === item.id ? 'bg-amber-400 text-slate-900 border-amber-500' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'}`} title="خيارات القطعة">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* DESKTOP TABLE VIEW */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-900 text-amber-400 font-bold uppercase border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الكود / اسم القطعة</th>
                    <th className="py-3 px-3">التصنيف</th>
                    <th className="py-3 px-3 text-center">العيار</th>
                    <th className="py-3 px-3 text-center">الوزن القائم (غ)</th>
                    <th className="py-3 px-3 text-center">الفصوص (غ)</th>
                    <th className="py-3 px-3 text-center">الوزن الصافي (غ)</th>
                    <th className="py-3 px-3 text-center">أجرة الجرام ($)</th>
                    <th className="py-3 px-3">القيمة اليوم ($)</th>
                    <th className="py-3 px-3">المستودع</th>
                    <th className="py-3 px-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800 font-mono">
                  {filteredInventory.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400 font-medium font-sans">
                        لا يوجد قطع مطابقة لمعايير البحث الحالية
                      </td>
                    </tr>
                  ) : (
                    filteredInventory.map(item => {
                      const p = goldPrices.find(g => g.karat === item.karat);
                      const pricePerGram = p ? p.sellPriceUSDPerGram : 75;
                      const estimatedTotalUSD = item.netWeightGrams * pricePerGram + item.totalLaborFeeUSD;
                      const wh = warehouses.find(w => w.id === item.warehouseId);

                      return (
                        <tr key={item.id} className="hover:bg-amber-50/50 transition">
                          <td className="py-3 px-4 font-bold text-slate-900 font-sans">
                            <div className="flex items-center gap-2">
                              {item.imageUrl && <button type="button" onClick={() => setImagePreviewItem(item)} aria-label={`عرض صورة ${item.name}`} className="h-9 w-9 shrink-0 overflow-hidden rounded-sm border border-amber-300 bg-amber-50"><img src={item.imageUrl} alt="" className="h-full w-full object-cover" /></button>}
                              <span className="font-mono text-[10px] bg-slate-900 text-amber-400 px-1.5 py-0.5 rounded-sm">
                                {item.code}
                              </span>
                              <span>{item.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-600 font-sans font-medium">{item.category}</td>
                          <td className="py-3 px-3 text-center font-sans">
                            <span className="bg-amber-400 text-slate-900 font-bold px-2 py-0.5 rounded-sm text-[11px]">
                              عيار {item.karat}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-bold">{item.grossWeightGrams.toFixed(2)}</td>
                          <td className="py-3 px-3 text-center text-slate-500">{item.stoneWeightGrams.toFixed(2)}</td>
                          <td className="py-3 px-3 text-center font-black text-amber-700 bg-amber-50">
                            {item.netWeightGrams.toFixed(2)} غ
                          </td>
                          <td className="py-3 px-3 text-center text-slate-600">${item.laborFeeUSDPerGram}</td>
                          <td className="py-3 px-3 font-extrabold text-slate-900">
                            {formatMoney(estimatedTotalUSD)}
                          </td>
                          <td className="py-3 px-3 text-slate-600 text-[11px] font-sans font-medium">{wh?.name || 'الرئيسي'}</td>
                          <td className="py-3 px-4 text-center font-sans">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => {
                                  setShowTransferModal(item);
                                  setTargetWarehouseForTransfer(item.warehouseId);
                                }}
                                title="نقل إلى مستودع آخر"
                                className="hidden p-1.5 bg-slate-100 text-slate-800 hover:bg-slate-200 rounded-sm transition"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleOpenEditItem(item)}
                                title="تعديل القطعة"
                                className="hidden p-1.5 bg-amber-100 text-amber-900 hover:bg-amber-200 rounded-sm transition"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => deleteInventoryItem(item.id)}
                                title="حذف القطعة"
                                className="hidden p-1.5 bg-rose-100 text-rose-800 hover:bg-rose-200 rounded-sm transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={(event) => toggleItemMenu(event, item)} className={`p-1.5 rounded-sm transition flex items-center justify-center border shadow-sm ${activeItemMenu?.item.id === item.id ? 'bg-amber-400 text-slate-900 border-amber-500' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'}`} title="خيارات القطعة">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeSubTab === 'warehouses' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {warehouses.map(wh => {
            const whItems = inventory.filter(i => i.status === 'in_stock' && i.warehouseId === wh.id);
            const totalGrams = whItems.reduce((acc, i) => acc + i.netWeightGrams, 0);

            return (
              <div key={wh.id} className="bg-white rounded-sm border border-slate-200 border-r-4 border-r-amber-400 p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-sm bg-slate-900 text-amber-400 flex items-center justify-center font-bold">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">{wh.name}</h3>
                      <p className="text-xs text-slate-500">{wh.location}</p>
                    </div>
                  </div>
                  {wh.isDefault && (
                    <span className="text-[10px] bg-amber-400 text-slate-900 font-bold px-2 py-0.5 rounded-sm">
                      الفرع الرئيسي
                    </span>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-sm border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between text-slate-600">
                    <span>مسؤول المستودع:</span>
                    <span className="font-bold text-slate-900">{wh.manager}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 font-mono">
                    <span className="font-sans">الهاتف:</span>
                    <span className="font-bold text-slate-900" dir="ltr">{wh.phone}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 font-mono">
                    <span className="font-sans">عدد القطع المخزنة:</span>
                    <span className="font-bold text-amber-700">{whItems.length} قطعة</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between font-mono">
                  <span className="text-xs text-slate-500 font-sans">إجمالي أوزان الذهب:</span>
                  <span className="text-base font-black text-amber-700">{totalGrams.toFixed(1)} غ</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Gold Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 shadow-2xl max-w-2xl w-full p-6 text-right space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3">
              <h3 className="text-lg font-black text-slate-900">
                {editingItem ? 'تعديل قطعة ذهب بالمخزون' : 'إضافة قطعة ذهب جديدة للمخزون'}
              </h3>
              <button
                onClick={() => {
                  setShowAddItemModal(false);
                  resetItemForm();
                }}
                className="text-slate-400 hover:text-slate-900 p-1 rounded-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">اسم القطعة / المنتج *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: طقم ملكي 21، سبيكة 100غ..."
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm focus:border-amber-400 focus:outline-none font-medium"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">الكود / الباركود</label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={e => setFormCode(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">العيار (Karat) *</label>
                  <select
                    value={formKarat}
                    onChange={e => setFormKarat(e.target.value as GoldKarat)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-bold text-amber-800"
                  >
                    <option value="21">عيار 21 (الأكثر انتشاراً)</option>
                    <option value="24">عيار 24 (سبائك وعملات)</option>
                    <option value="22">عيار 22</option>
                    <option value="18">عيار 18 (صياغة ناعمة)</option>
                    <option value="14">عيار 14 (أقفال وسلاسل ناعمة)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">التصنيف *</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value as ItemCategory)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-medium"
                  >
                    <option value="أطقم">أطقم ذهب</option>
                    <option value="خواتم ومحابس">خواتم ومحابس</option>
                    <option value="أساور ومبارم">أساور ومبارم</option>
                    <option value="قلائد وسلاسل">قلائد وسلاسل</option>
                    <option value="أقراط">أقراط</option>
                    <option value="سبائك وليرات">سبائك وليرات</option>
                    <option value="ذهب كسر">ذهب كسر</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">الوزن القائم بالجرام (مع الفصوص) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={formGrossWeight}
                    onChange={e => setFormGrossWeight(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">وزن الأحجار / الزركون (غرام)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formStoneWeight}
                    onChange={e => setFormStoneWeight(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">المصنعية / الأجرة للجرام ($)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="0.00"
                    value={formLaborFeePerGram}
                    onChange={e => setFormLaborFeePerGram(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">المستودع أو الفرع التابع له *</label>
                  <select
                    value={formWarehouseId}
                    onChange={e => setFormWarehouseId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-medium"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ملاحظات إضافية</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="وصف النقش، الشحنة، مصدر القطعة..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div className="rounded-sm border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-amber-700" />
                    <div>
                      <p className="text-xs font-black text-slate-900">صورة القطعة</p>
                      <p className="text-[10px] text-slate-500">تُضغط تلقائياً حتى 1280px لتكون مناسبة للحفظ السحابي لاحقاً.</p>
                    </div>
                  </div>
                  {formImageUrl && <button type="button" onClick={() => setFormImageUrl('')} className="text-[11px] font-bold text-rose-700 hover:text-rose-800">حذف الصورة</button>}
                </div>

                {formImageUrl ? (
                  <div className="mt-3 flex items-center gap-3">
                    <img src={formImageUrl} alt="معاينة القطعة" className="h-20 w-20 rounded-sm border border-amber-300 object-cover bg-white" />
                    <label className="cursor-pointer text-xs font-bold text-amber-900 hover:text-amber-700">استبدال الصورة<input type="file" accept="image/*" onChange={handleItemImageUpload} className="hidden" /></label>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="cursor-pointer rounded-sm bg-slate-900 px-3 py-2 text-center text-xs font-bold text-amber-400 hover:bg-slate-800 flex items-center justify-center gap-1.5"><Camera className="w-4 h-4" />التقاط بالكاميرا<input type="file" accept="image/*" capture="environment" onChange={handleItemImageUpload} className="hidden" /></label>
                    <label className="cursor-pointer rounded-sm border border-amber-300 bg-white px-3 py-2 text-center text-xs font-bold text-slate-800 hover:bg-amber-100 flex items-center justify-center gap-1.5"><Upload className="w-4 h-4" />رفع من الهاتف<input type="file" accept="image/*" onChange={handleItemImageUpload} className="hidden" /></label>
                  </div>
                )}
                {isCompressingImage && <p className="mt-2 text-[11px] font-bold text-amber-800">يتم ضغط الصورة...</p>}
                {imageError && <p className="mt-2 text-[11px] font-bold text-rose-700">{imageError}</p>}
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddItemModal(false);
                    resetItemForm();
                  }}
                  className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-sm font-bold shadow"
                >
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Item Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 shadow-2xl max-w-md w-full p-6 text-right space-y-4">
            <h3 className="text-base font-black text-slate-900">
              نقل القطعة ({showTransferModal.name}) إلى فرع آخر
            </h3>
            <p className="text-xs text-slate-600">
              المستودع الحالي: <strong className="text-slate-900">{warehouses.find(w => w.id === showTransferModal.warehouseId)?.name}</strong>
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اختر المستودع الوجهة:</label>
              <select
                value={targetWarehouseForTransfer}
                onChange={e => setTargetWarehouseForTransfer(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm text-xs font-medium"
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowTransferModal(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold text-xs"
              >
                إلغاء
              </button>
              <button
                onClick={handleExecuteTransfer}
                className="px-5 py-2 bg-amber-400 text-slate-900 rounded-sm font-bold text-xs shadow"
              >
                تأكيد النقل الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {showStocktakeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-sm border-2 border-slate-900 bg-white p-5 shadow-2xl text-right space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3"><h3 className="flex items-center gap-2 font-black text-slate-900"><Scale className="w-5 h-5 text-amber-700" />جرد المخزون</h3><button onClick={() => setShowStocktakeModal(false)} className="p-1 text-slate-500"><X className="w-5 h-5" /></button></div>
            <p className="text-xs leading-5 text-slate-600">سيُحفظ تقرير جرد محلي من حالة المخزون الظاهرة حالياً، ويمكن مراجعته من قسم التقارير.</p>
            <div className="grid grid-cols-2 gap-2"><div className="rounded-sm bg-amber-50 p-3"><p className="text-[10px] text-slate-500">عدد القطع</p><p className="font-mono font-black text-amber-900">{filteredInventory.length}</p></div><div className="rounded-sm bg-amber-50 p-3"><p className="text-[10px] text-slate-500">الوزن الصافي</p><p className="font-mono font-black text-amber-900">{totalFilteredGrams.toFixed(2)} غ</p></div></div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button onClick={() => setShowStocktakeModal(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button onClick={saveStocktakeSnapshot} className="rounded-sm bg-amber-400 px-5 py-2 text-xs font-black text-slate-900">حفظ تقرير الجرد</button></div>
          </div>
        </div>
      )}

      {activeItemMenu && (
        <div className="fixed inset-0 z-50">
          <div className="fixed inset-0 bg-slate-900/10" onClick={() => setActiveItemMenu(null)} />
          <div style={{ top: `${activeItemMenu.top}px`, left: `${activeItemMenu.left}px` }} className="fixed w-52 bg-white border-2 border-slate-900 rounded-sm shadow-2xl z-50 py-1 text-right text-xs divide-y divide-slate-100 font-medium animate-in fade-in zoom-in-95 duration-100">
            <div className="py-0.5">
              <button onClick={() => { setShowTransferModal(activeItemMenu.item); setTargetWarehouseForTransfer(activeItemMenu.item.warehouseId); setActiveItemMenu(null); }} className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"><ArrowRightLeft className="w-4 h-4 text-blue-600 shrink-0" />نقل إلى مستودع آخر</button>
              <button onClick={() => { handleOpenEditItem(activeItemMenu.item); setActiveItemMenu(null); }} className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"><Edit className="w-4 h-4 text-amber-700 shrink-0" />تعديل بيانات القطعة</button>
            </div>
            <div className="pt-1">
              <button onClick={() => { deleteInventoryItem(activeItemMenu.item.id); setActiveItemMenu(null); }} className="w-full px-3 py-2 text-rose-700 hover:bg-rose-50 flex items-center gap-2 transition font-bold"><Trash2 className="w-4 h-4 text-rose-600 shrink-0" />حذف القطعة</button>
            </div>
          </div>
        </div>
      )}

      {imagePreviewItem?.imageUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4" onClick={() => setImagePreviewItem(null)} role="dialog" aria-modal="true" aria-label={`صورة ${imagePreviewItem.name}`}>
          <div className="relative max-h-full max-w-3xl" onClick={event => event.stopPropagation()}>
            <button type="button" onClick={() => setImagePreviewItem(null)} className="absolute -top-3 -left-3 z-10 rounded-full bg-white p-2 text-slate-900 shadow-lg hover:bg-amber-100" aria-label="إغلاق الصورة"><X className="h-5 w-5" /></button>
            <img src={imagePreviewItem.imageUrl} alt={`صورة ${imagePreviewItem.name}`} className="max-h-[85vh] max-w-full rounded-sm border-2 border-amber-400 bg-white object-contain shadow-2xl" />
            <p className="mt-2 text-center text-xs font-bold text-amber-300">{imagePreviewItem.name}</p>
          </div>
        </div>
      )}

      {/* Add Warehouse Modal */}
      {showAddWarehouseModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 shadow-2xl max-w-md w-full p-6 text-right space-y-4">
            <h3 className="text-base font-black text-slate-900">إضافة مستودع / فرع جديد</h3>

            <form onSubmit={handleSaveWarehouse} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المستودع / الفرع *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: فرع الفرقان، الخزنة الثانوية"
                  value={whName}
                  onChange={e => setWhName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">العنوان والموقع</label>
                <input
                  type="text"
                  value={whLocation}
                  onChange={e => setWhLocation(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">مسؤول الفرع / المستودع</label>
                <input
                  type="text"
                  placeholder="اسم المسؤول"
                  value={whManager}
                  onChange={e => setWhManager(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  placeholder="+963..."
                  value={whPhone}
                  onChange={e => setWhPhone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddWarehouseModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-400 text-slate-900 rounded-sm font-bold shadow"
                >
                  حفظ الفرع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
