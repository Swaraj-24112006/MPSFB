import React, { useState, useRef, useEffect } from 'react';
import {
  Package,
  Upload,
  Plus,
  Download,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Boxes,
  ShieldCheck,
  Edit2,
  Trash2,
  Layers,
  FileSpreadsheet,
  Info,
  X,
  Loader2,
  Calendar,
  CheckSquare,
  Square
} from 'lucide-react';
import { StockReportItem } from '../../types';
import { stockService } from '../../services/stockService';

interface StockReportManagerProps {
  stockList: StockReportItem[];
  onUpdateStock: (items: StockReportItem[]) => void;
  openingStockDate?: string;
  onUpdateOpeningStockDate?: (date: string) => void;
}

export const StockReportManager: React.FC<StockReportManagerProps> = ({
  stockList,
  onUpdateStock,
  openingStockDate = new Date().toISOString().slice(0, 10),
  onUpdateOpeningStockDate
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'FG' | 'RM' | 'PM'>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockReportItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState<'replace' | 'append'>('replace');
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [uploadStockDate, setUploadStockDate] = useState<string>(
    openingStockDate || new Date().toISOString().slice(0, 10)
  );

  useEffect(() => {
    if (openingStockDate) {
      setUploadStockDate(openingStockDate);
    }
  }, [openingStockDate]);

  // Checkbox selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<StockReportItem>>({
    partNumber: '',
    materialDescription: '',
    materialType: 'RM',
    unrestrictedStock: 1000,
    inQualityInsp: 0,
    blocked: 0,
    storageLocation: 'SL01',
    uom: 'PC',
    safetyStock: 500,
    plant: '1001',
    stockDate: openingStockDate || new Date().toISOString().slice(0, 10)
  });

  const [csvInput, setCsvInput] = useState('');

  // Auto derive material type based on user requirement: startsWith('7') -> FG, else RM/PM
  const deriveMaterialType = (part: string, category?: string): 'FG' | 'RM' | 'PM' => {
    if (part.startsWith('7')) return 'FG';
    if (category === 'PM' || part.startsWith('8')) return 'PM';
    return 'RM';
  };

  const filteredStocks = stockList.filter((item) => {
    const matchesSearch =
      item.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.materialDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.storageLocation.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'ALL' || item.materialType === typeFilter;

    return matchesSearch && matchesType;
  });

  // Checkbox selection logic
  const isAllSelected =
    filteredStocks.length > 0 &&
    filteredStocks.every((item) => selectedIds.has(item.id));
  const isSomeSelected =
    filteredStocks.some((item) => selectedIds.has(item.id)) && !isAllSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const next = new Set(selectedIds);
      filteredStocks.forEach((item) => next.delete(item.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredStocks.forEach((item) => next.add(item.id));
      setSelectedIds(next);
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (
      window.confirm(
        `Are you sure you want to delete ${count} selected stock record${
          count > 1 ? 's' : ''
        }?`
      )
    ) {
      const remaining = stockList.filter((item) => !selectedIds.has(item.id));
      onUpdateStock(remaining);
      setSelectedIds(new Set());
    }
  };

  // KPI calculations
  const totalFGStock = stockList
    .filter((s) => s.materialType === 'FG')
    .reduce((sum, s) => sum + s.unrestrictedStock, 0);

  const totalRMStock = stockList
    .filter((s) => s.materialType === 'RM')
    .reduce((sum, s) => sum + s.unrestrictedStock, 0);

  const totalPMStock = stockList
    .filter((s) => s.materialType === 'PM')
    .reduce((sum, s) => sum + s.unrestrictedStock, 0);

  const lowStockCount = stockList.filter(
    (s) => s.unrestrictedStock < s.safetyStock
  ).length;

  const handleOpenAddModal = (existing?: StockReportItem) => {
    if (existing) {
      setEditingItem(existing);
      setFormData({
        ...existing,
        stockDate: existing.stockDate || openingStockDate || new Date().toISOString().slice(0, 10)
      });
    } else {
      setEditingItem(null);
      setFormData({
        partNumber: '',
        materialDescription: '',
        materialType: 'RM',
        unrestrictedStock: 1000,
        inQualityInsp: 0,
        blocked: 0,
        storageLocation: 'SL01-Raw Materials',
        uom: 'PC',
        safetyStock: 500,
        plant: '1001',
        stockDate: openingStockDate || new Date().toISOString().slice(0, 10)
      });
    }
    setIsAddModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.partNumber || formData.unrestrictedStock === undefined) {
      alert('Please fill part number and unrestricted stock quantity.');
      return;
    }

    const type = deriveMaterialType(
      formData.partNumber,
      formData.materialType
    );
    const itemStockDate = formData.stockDate || openingStockDate || new Date().toISOString().slice(0, 10);

    setIsSubmitting(true);
    try {
      if (editingItem && !editingItem.id.startsWith('stk-') && !isNaN(Number(editingItem.id))) {
        await stockService.updateStockItem(editingItem.id, {
          partNumber: formData.partNumber.trim(),
          materialDescription: formData.materialDescription?.trim() || 'Material',
          unrestrictedStock: Number(formData.unrestrictedStock) || 0,
          inQualityInsp: Number(formData.inQualityInsp) || 0,
          blocked: Number(formData.blocked) || 0,
          storageLocation: formData.storageLocation || 'SL01',
          uom: formData.uom || 'PC',
          safetyStock: Number(formData.safetyStock) || 500,
          plant: formData.plant || '1001',
          stockDate: itemStockDate
        });
      } else {
        await stockService.createStockItem({
          partNumber: formData.partNumber.trim(),
          materialDescription: formData.materialDescription?.trim() || 'Material',
          unrestrictedStock: Number(formData.unrestrictedStock) || 0,
          inQualityInsp: Number(formData.inQualityInsp) || 0,
          blocked: Number(formData.blocked) || 0,
          storageLocation: formData.storageLocation || 'SL01',
          uom: formData.uom || 'PC',
          safetyStock: Number(formData.safetyStock) || 500,
          plant: formData.plant || '1001',
          stockDate: itemStockDate
        });
      }

      const refreshed = await stockService.getStockReport();
      if (refreshed && Array.isArray(refreshed)) {
        onUpdateStock(refreshed);
      }
      setIsAddModalOpen(false);
    } catch (err) {
      console.warn('Backend stock save error, falling back to local state:', err);
      if (editingItem) {
        const updated = stockList.map((s) =>
          s.id === editingItem.id
            ? ({
                ...s,
                ...formData,
                materialType: type,
                stockDate: itemStockDate,
                lastUpdated: itemStockDate
              } as StockReportItem)
            : s
        );
        onUpdateStock(updated);
      } else {
        const newItem: StockReportItem = {
          id: `stk-${Date.now()}`,
          partNumber: formData.partNumber.trim(),
          materialDescription: formData.materialDescription?.trim() || 'Material',
          materialType: type,
          unrestrictedStock: Number(formData.unrestrictedStock) || 0,
          inQualityInsp: Number(formData.inQualityInsp) || 0,
          blocked: Number(formData.blocked) || 0,
          storageLocation: formData.storageLocation || 'SL01',
          uom: formData.uom || 'PC',
          safetyStock: Number(formData.safetyStock) || 500,
          plant: formData.plant || '1001',
          stockDate: itemStockDate,
          lastUpdated: itemStockDate
        };
        onUpdateStock([newItem, ...stockList]);
      }
      setIsAddModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this stock record?')) {
      try {
        if (!id.startsWith('stk-') && !isNaN(Number(id))) {
          await stockService.deleteStockItem(id);
        }
      } catch (err) {
        console.warn('Backend stock delete error, falling back to local state:', err);
      }
      onUpdateStock(stockList.filter((s) => s.id !== id));
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      'Part Number,Material Description,Unrestricted Stock,In Quality Insp,Blocked,Safety Stock,UOM,Storage Location,Plant\n' +
      '7.06496.03.0,Vacuum Pump Panther 2.0L,1200,0,0,500,PC,FG01,1001\n' +
      '7.09629.01.0,FAM B Tandem Pump,950,0,0,400,PC,FG01,1001\n' +
      '100201,Die-Cast Aluminum Housing,2200,100,0,1000,PC,SL01,1001\n' +
      '100202,Precision Rotor Assembly,3100,50,0,1500,PC,SL01,1001\n' +
      '800101,Corrugated Shipping Box 5-Ply,15000,0,0,5000,PC,PM01,1001\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `SAP_MB52_Stock_Template_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !csvInput.trim()) {
      alert('Please select a file (.csv, .xlsx, .tsv) or paste SAP MB52 stock export rows.');
      return;
    }

    setIsSubmitting(true);
    setUploadWarnings([]);
    try {
      const resp = await stockService.bulkUpload({
        file: selectedFile || undefined,
        csv_text: selectedFile ? undefined : csvInput.trim(),
        mode: uploadMode,
        opening_stock_date: uploadStockDate
      });

      const refreshed = await stockService.getStockReport();
      if (refreshed && Array.isArray(refreshed)) {
        onUpdateStock(refreshed);
      }
      onUpdateOpeningStockDate?.(uploadStockDate);
      if (resp.warnings && resp.warnings.length > 0) {
        setUploadWarnings(resp.warnings);
      }

      alert(
        `SAP MB52 Stock Report imported successfully!\n` +
        `• Total Rows: ${resp.total_rows}\n` +
        `• Successfully Processed: ${resp.imported_rows}\n` +
        `• Errors / Skipped: ${resp.error_rows}\n` +
        `• Baseline Date: ${uploadStockDate}\n` +
        `• Mode: ${uploadMode === 'replace' ? 'Replace / Upsert' : 'Append'}` +
        (resp.warnings && resp.warnings.length > 0 ? `\n• Warnings: ${resp.warnings.length}` : '')
      );
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setCsvInput('');
    } catch (err: any) {
      console.warn('Backend bulk upload failed, parsing locally as fallback:', err);
      const rawText = csvInput.trim();
      if (!rawText && selectedFile) {
        alert(err?.message || 'Server upload failed. Please ensure the backend server is running.');
        setIsSubmitting(false);
        return;
      }

      const lines = rawText.split('\n');
      const parsed: StockReportItem[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (
          i === 0 &&
          (line.toLowerCase().includes('part') ||
            line.toLowerCase().includes('stock') ||
            line.toLowerCase().includes('material'))
        ) {
          continue;
        }

        const delimiter = line.includes('\t') ? '\t' : ',';
        const parts = line.split(delimiter).map((s) => s.replace(/^"|"$/g, '').trim());

        if (parts.length >= 2) {
          const partNo = parts[0];
          const desc = parts.length >= 3 ? parts[1] : `Material ${partNo}`;
          const stockStr = parts.length >= 3 ? parts[2] : parts[1];
          const stock = parseFloat(stockStr.replace(/,/g, '')) || 0;
          const safetyStr = parts.length >= 6 ? parts[5] : '500';
          const safety = parseFloat(safetyStr.replace(/,/g, '')) || 500;
          const uom = parts.length >= 7 ? parts[6] : 'PC';
          const sloc = parts.length >= 8 ? parts[7] : 'SL01';

          if (partNo) {
            const type = deriveMaterialType(partNo);
            parsed.push({
              id: `stk-${Date.now()}-${i}`,
              partNumber: partNo,
              materialDescription: desc,
              materialType: type,
              unrestrictedStock: stock,
              inQualityInsp: 0,
              blocked: 0,
              safetyStock: safety,
              storageLocation: sloc,
              uom,
              plant: '1001',
              stockDate: uploadStockDate,
              lastUpdated: uploadStockDate || new Date().toISOString().slice(0, 10)
            });
          }
        }
      }

      if (parsed.length === 0) {
        alert('No valid stock records found.');
        return;
      }

      onUpdateStock([...parsed, ...stockList]);
      onUpdateOpeningStockDate?.(uploadStockDate);
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setCsvInput('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Part Number',
      'Material Description',
      'Type',
      'Opening Stock Date',
      'Unrestricted Stock',
      'In Quality Insp',
      'Blocked Stock',
      'Safety Stock',
      'UOM',
      'Storage Location',
      'Plant'
    ];

    const rows = filteredStocks.map((s) => [
      `"${s.partNumber}"`,
      `"${s.materialDescription}"`,
      `"${s.materialType}"`,
      `"${s.stockDate || s.lastUpdated?.slice(0, 10) || openingStockDate}"`,
      s.unrestrictedStock,
      s.inQualityInsp,
      s.blocked,
      s.safetyStock,
      `"${s.uom}"`,
      `"${s.storageLocation}"`,
      `"${s.plant}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Stock_Report_MB52_${uploadStockDate || new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
          <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">Monday Upload: Stock Report (SAP MB52)</h1>
              {/* Baseline Opening Stock Date Badge */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200 rounded-lg text-xs font-semibold">
                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                <span>Opening Stock As Of:</span>
                <input
                  type="date"
                  value={openingStockDate}
                  onChange={(e) => onUpdateOpeningStockDate?.(e.target.value)}
                  className="bg-white border border-teal-300 rounded px-1.5 py-0.5 text-xs font-mono font-bold text-teal-900 focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer"
                  title="Click to change baseline opening stock date for all calculations"
                />
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Current on-hand unrestricted inventory balances. Calculations across Weekly MRP, Monday Review & Shortages roll forward from this baseline date.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-teal-800 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
          >
            <Upload className="w-4 h-4 text-teal-600" />
            Upload Stock CSV / Excel
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export CSV
          </button>
          <button
            onClick={() => handleOpenAddModal()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Stock Item
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              Delete Selected ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {/* Upload Notices / Warnings */}
      {uploadWarnings.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm flex items-start gap-3 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold mb-1">
              Stock Upload Notices ({uploadWarnings.length}):
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-xs text-amber-800">
              {uploadWarnings.slice(0, 5).map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
              {uploadWarnings.length > 5 && (
                <li>...and {uploadWarnings.length - 5} more warnings</li>
              )}
            </ul>
          </div>
          <button
            onClick={() => setUploadWarnings([])}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Finished Goods (FG) Stock</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalFGStock.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-blue-600 font-semibold mt-1">Part prefix starting with '7'</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Raw Materials (RM) Stock</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalRMStock.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">On-hand usable stock</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Packaging Materials (PM)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalPMStock.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Liner bags, cartons & boxes</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Below Safety Stock</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">
            {lowStockCount} Materials
          </div>
          <div className="text-xs text-slate-500 mt-1">Requires buyer replenishment</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setTypeFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === 'ALL'
                ? 'bg-white text-teal-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Inventory ({stockList.length})
          </button>
          <button
            onClick={() => setTypeFilter('FG')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === 'FG'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Finished Goods (FG)
          </button>
          <button
            onClick={() => setTypeFilter('RM')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === 'RM'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Raw Materials (RM)
          </button>
          <button
            onClick={() => setTypeFilter('PM')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              typeFilter === 'PM'
                ? 'bg-white text-purple-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Packaging (PM)
          </button>
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search part number, description, SLOC..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                {/* Select All Checkbox */}
                <th className="py-3.5 px-4 w-12 text-center">
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      ref={selectAllCheckboxRef}
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
                      title={isAllSelected ? 'Deselect all visible records' : 'Select all visible records'}
                    />
                  </div>
                </th>
                <th className="py-3.5 px-4">Part Number</th>
                <th className="py-3.5 px-4">Material Description</th>
                <th className="py-3.5 px-4 text-center">Type</th>
                <th className="py-3.5 px-4 text-right">Unrestricted Stock</th>
                <th className="py-3.5 px-4 text-right">In Quality</th>
                <th className="py-3.5 px-4 text-right">Safety Stock</th>
                <th className="py-3.5 px-4 text-center">UOM</th>
                <th className="py-3.5 px-4">Storage Location</th>
                <th className="py-3.5 px-4 text-center">Opening Date</th>
                <th className="py-3.5 px-4 text-center">Stock Health</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStocks.length === 0 ? (
                <tr>
                <td colSpan={12} className="py-8 text-center text-slate-400">
                    No stock records match your search or filter.
                  </td>
                </tr>
              ) : (
                filteredStocks.map((stock) => {
                  const isLow = stock.unrestrictedStock < stock.safetyStock;
                  const isSelected = selectedIds.has(stock.id);

                  return (
                    <tr
                      key={stock.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-teal-50/70 hover:bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Row Checkbox */}
                      <td className="py-3 px-4 w-12 text-center">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(stock.id)}
                            className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
                            aria-label={`Select ${stock.partNumber}`}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 text-xs">
                        <span
                          className={`px-1.5 py-0.5 rounded border ${
                            stock.materialType === 'FG'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-50 text-slate-800 border-slate-200'
                          }`}
                        >
                          {stock.partNumber}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-800 font-medium text-xs">
                        {stock.materialDescription}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            stock.materialType === 'FG'
                              ? 'bg-blue-100 text-blue-800'
                              : stock.materialType === 'PM'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {stock.materialType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {stock.unrestrictedStock.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500 text-xs">
                        {stock.inQualityInsp.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600 text-xs">
                        {stock.safetyStock.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-center text-xs font-medium text-slate-500">
                        {stock.uom}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-600">
                        {stock.storageLocation}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs text-slate-600">
                        {stock.stockDate || stock.lastUpdated?.slice(0, 10) || openingStockDate}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isLow ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-semibold border border-amber-200">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-semibold border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Adequate
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenAddModal(stock)}
                            className="p-1.5 text-slate-400 hover:text-teal-600 rounded transition-colors"
                            title="Edit Stock"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(stock.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Boxes className="w-5 h-5 text-teal-600" />
              {editingItem ? 'Edit Stock Balance' : 'Add On-Hand Stock Record'}
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Part Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.partNumber || ''}
                    onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
                    placeholder="e.g. 7.06496.03.0 or 100201"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Prefix '7' = FG, other = RM/PM
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Material Description *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.materialDescription || ''}
                    onChange={(e) => setFormData({ ...formData, materialDescription: e.target.value })}
                    placeholder="e.g. Vacuum Pump Panther 2.0L"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unrestricted Stock *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.unrestrictedStock ?? 1000}
                    onChange={(e) =>
                      setFormData({ ...formData, unrestrictedStock: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    In Quality Insp
                  </label>
                  <input
                    type="number"
                    value={formData.inQualityInsp ?? 0}
                    onChange={(e) =>
                      setFormData({ ...formData, inQualityInsp: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Safety Stock
                  </label>
                  <input
                    type="number"
                    value={formData.safetyStock ?? 500}
                    onChange={(e) =>
                      setFormData({ ...formData, safetyStock: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Storage Location (SLOC)
                  </label>
                  <input
                    type="text"
                    value={formData.storageLocation || 'SL01'}
                    onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    UOM
                  </label>
                  <input
                    type="text"
                    value={formData.uom || 'PC'}
                    onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Stock Date (Baseline Snapshot Date)
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-teal-600" />
                  <input
                    type="date"
                    value={formData.stockDate || openingStockDate || new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setFormData({ ...formData, stockDate: e.target.value })}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono"
                    title="Snapshot date when this physical inventory was verified"
                  />
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Transactions prior to this date are already counted in physical stock.
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
                >
                  Save Stock Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload CSV / Excel Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-teal-600" />
                  Upload Stock Report (SAP MB52)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Import on-hand stock records (.csv, .xlsx, .tsv). Automatically classifies Finished Goods and RM/PM parts.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200 transition-colors"
                title="Download sample Stock CSV template"
              >
                <Download className="w-3.5 h-3.5" />
                Template
              </button>
            </div>

            <form onSubmit={handleCSVUpload} className="space-y-4">
              {/* Baseline Opening Stock Date Selector */}
              <div className="bg-teal-50/70 border border-teal-200 rounded-lg p-3">
                <label className="block text-xs font-semibold text-teal-900 mb-1">
                  Opening Stock Baseline Date (Snapshot As Of) *
                </label>
                <div className="relative max-w-xs">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-teal-600" />
                  <input
                    type="date"
                    required
                    value={uploadStockDate}
                    onChange={(e) => setUploadStockDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs font-mono font-bold text-teal-900 border border-teal-300 rounded-lg focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                </div>
                <p className="text-[11px] text-teal-700 mt-1">
                  All MB51 receipts and dispatches prior to this date are considered already counted inside this snapshot and will not be double-adjusted.
                </p>
              </div>

              {/* Upload Mode Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Upload Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setUploadMode('replace')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      uploadMode === 'replace'
                        ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">Replace / Upsert (Recommended)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Updates matching Part + SLOC balances
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode('append')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      uploadMode === 'append'
                        ? 'border-teal-500 bg-teal-50/60 ring-1 ring-teal-500'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">Append Only</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Adds all entries as new rows
                    </div>
                  </button>
                </div>
              </div>

              {/* File Upload Drag & Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    setSelectedFile(e.dataTransfer.files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-5 text-center transition-all ${
                  isDragging
                    ? 'border-teal-500 bg-teal-50/70 scale-[1.01]'
                    : selectedFile
                    ? 'border-emerald-400 bg-emerald-50/40'
                    : 'border-slate-300 hover:border-teal-400 bg-slate-50/60'
                }`}
              >
                <input
                  type="file"
                  id="stock-file-input"
                  accept=".csv, .xlsx, .xlsm, .tsv, .txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                />
                <label
                  htmlFor="stock-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center gap-1.5"
                >
                  <FileSpreadsheet
                    className={`w-9 h-9 ${
                      selectedFile ? 'text-emerald-600' : 'text-teal-600'
                    }`}
                  />
                  <div className="text-xs font-semibold text-slate-800">
                    {selectedFile ? (
                      <span className="text-emerald-800 font-bold">{selectedFile.name}</span>
                    ) : (
                      'Click to browse or drag & drop SAP MB52 file (.csv, .xlsx)'
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(1)} KB — Ready to upload`
                      : 'Supports Excel spreadsheets and standard CSV / TSV exports'}
                  </div>
                </label>
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Remove file
                  </button>
                )}
              </div>

              {/* Paste Text Area */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Or Paste CSV / Tab-Separated Data
                </label>
                <textarea
                  rows={4}
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                  disabled={selectedFile !== null}
                  placeholder={
                    selectedFile
                      ? 'File selected above. Clear file to paste raw text manually.'
                      : `PartNumber,Description,UnrestrictedStock,SafetyStock,UOM,SLOC\n7.06496.03.0,Vacuum Pump Panther 2.0L,1200,500,PC,FG01\n100201,Die-Cast Aluminum Housing,2200,1000,PC,SL01\n100202,Precision Rotor Assembly,3100,1500,PC,SL01`
                  }
                  className={`w-full p-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 font-mono ${
                    selectedFile ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>

              {/* Ingestion Rules Guide */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-teal-600" />
                  SAP MB52 Stock Classification Rules:
                </div>
                <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                  <li><strong>Part number starting with '7'</strong>: Finished Goods (FG)</li>
                  <li><strong>Part number starting with '8' / PM</strong>: Packaging Materials (PM)</li>
                  <li><strong>Other part numbers</strong>: Raw Materials (RM)</li>
                  <li>Required column: <strong>Part Number</strong>. Unrestricted stock defaults to 0 if omitted.</li>
                  <li>All files are uploaded to MinIO storage and tracked with a unique Upload Batch ID.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setSelectedFile(null);
                    setCsvInput('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || (!selectedFile && !csvInput.trim())}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Uploading & Processing...' : 'Import Stock Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
