import React, { useState } from 'react';
import {
  FileText,
  Upload,
  Plus,
  Download,
  Filter,
  Search,
  Package,
  Truck,
  Factory,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Layers,
  Trash2,
  Loader2,
  FileSpreadsheet,
  Info,
  X
} from 'lucide-react';
import { MB51TransactionItem, MB51Classification, WeekDefinition } from '../../types';
import { getWeekForTransaction } from '../../utils/weeklyMrpEngine';
import { mb51Service } from '../../services/mb51Service';

interface MB51ReportManagerProps {
  mb51List: MB51TransactionItem[];
  onUpdateMB51: (items: MB51TransactionItem[]) => void;
  weeks: WeekDefinition[];
  selectedMonth: string;
}

export const MB51ReportManager: React.FC<MB51ReportManagerProps> = ({
  mb51List,
  onUpdateMB51,
  weeks,
  selectedMonth
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<
    'ALL' | '101_FG' | '101_RMPM' | '601_DISPATCH'
  >('ALL');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<MB51TransactionItem>>({
    materialDocument: '',
    postingDate: new Date().toISOString().slice(0, 10),
    movementType: '101',
    partNumber: '',
    materialDescription: '',
    quantity: 1000,
    uom: 'PC',
    storageLocation: 'FG01',
    plant: '1001',
    vendorOrCustomer: '',
    poOrOrderNumber: ''
  });

  const [csvInput, setCsvInput] = useState('');

  const monthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  // Derive Classification
  const deriveClassification = (mvt: string, part: string): MB51Classification => {
    if (mvt === '101') {
      return part.startsWith('7') ? 'FG_PRODUCTION_RECEIPT' : 'RMPM_RECEIPT';
    }
    if (mvt === '601') {
      return 'FG_DISPATCH';
    }
    return 'OTHER';
  };

  // Filtered List
  const filteredList = mb51List.filter((tx) => {
    const matchesSearch =
      tx.materialDocument.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.materialDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.vendorOrCustomer || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesWeek =
      selectedWeekFilter === 'ALL' ||
      tx.weekId === selectedWeekFilter ||
      (tx.postingDate && tx.postingDate.startsWith(selectedMonth));

    let matchesTab = true;
    if (selectedTab === '101_FG') {
      matchesTab = tx.classification === 'FG_PRODUCTION_RECEIPT';
    } else if (selectedTab === '101_RMPM') {
      matchesTab = tx.classification === 'RMPM_RECEIPT';
    } else if (selectedTab === '601_DISPATCH') {
      matchesTab = tx.classification === 'FG_DISPATCH';
    }

    return matchesSearch && matchesWeek && matchesTab;
  });

  // KPI Calculations
  const fgProductionQty = mb51List
    .filter((tx) => tx.classification === 'FG_PRODUCTION_RECEIPT')
    .reduce((sum, tx) => sum + tx.quantity, 0);

  const rmpmReceiptQty = mb51List
    .filter((tx) => tx.classification === 'RMPM_RECEIPT')
    .reduce((sum, tx) => sum + tx.quantity, 0);

  const fgDispatchQty = mb51List
    .filter((tx) => tx.classification === 'FG_DISPATCH')
    .reduce((sum, tx) => sum + tx.quantity, 0);

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.materialDocument || !formData.partNumber || !formData.quantity) {
      alert('Please fill material document, part number, and quantity.');
      return;
    }

    const mvt = formData.movementType || '101';
    if (mvt !== '101' && mvt !== '601') {
      alert("Manual transaction creation only supports movement types '101' and '601'.");
      return;
    }

    setIsSubmitting(true);
    try {
      const createdItem = await mb51Service.createTransaction({
        materialDocument: formData.materialDocument.trim(),
        postingDate: formData.postingDate || new Date().toISOString().slice(0, 10),
        movementType: mvt as '101' | '601',
        partNumber: formData.partNumber.trim(),
        materialDescription: formData.materialDescription?.trim() || 'Material Item',
        quantity: Number(formData.quantity) || 0,
        uom: formData.uom || 'PC',
        storageLocation: formData.storageLocation || 'SL01',
        plant: formData.plant || '1001',
        vendorOrCustomer: formData.vendorOrCustomer?.trim() || '',
        poOrOrderNumber: formData.poOrOrderNumber?.trim() || ''
      });
      onUpdateMB51([createdItem, ...mb51List]);
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.warn('Backend create failed, falling back to local creation:', err);
      const classification = deriveClassification(mvt, formData.partNumber || '');
      const mappedWeek = getWeekForTransaction(
        { ...formData, classification } as MB51TransactionItem,
        weeks
      );

      const newItem: MB51TransactionItem = {
        id: `mb51-${Date.now()}`,
        materialDocument: formData.materialDocument.trim(),
        postingDate: formData.postingDate || new Date().toISOString().slice(0, 10),
        movementType: mvt,
        partNumber: formData.partNumber.trim(),
        materialDescription: formData.materialDescription?.trim() || 'Material Item',
        quantity: Number(formData.quantity) || 0,
        uom: formData.uom || 'PC',
        storageLocation: formData.storageLocation || 'SL01',
        plant: formData.plant || '1001',
        vendorOrCustomer: formData.vendorOrCustomer?.trim() || '',
        poOrOrderNumber: formData.poOrOrderNumber?.trim() || '',
        classification,
        weekId: mappedWeek?.id
      };

      onUpdateMB51([newItem, ...mb51List]);
      setIsAddModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      'Material Document,Posting Date,Movement Type,Part Number,Material Description,Quantity,UOM,Storage Location,Partner / Vendor / Line,PO / Order No\n' +
      '5000210031,2026-08-05,101,7.06496.03.0,Vacuum Pump Panther 2.0L,1500,PC,FG01,Line A-PMP2,PRD-88201\n' +
      '5000210032,2026-08-06,101,100201,Die-Cast Aluminum Housing,3000,PC,SL01,Endurance Technologies,PO-4500091211\n' +
      '5000210033,2026-08-07,601,7.06496.03.0,Vacuum Pump Panther 2.0L,2600,PC,FG01,Tata Motors PV & EV,SO-9021102\n' +
      '5000210034,2026-08-08,101,100202,Precision Rotor Assembly,2200,PC,SL01,Bosch India,PO-4500091244\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `SAP_MB51_Template_${selectedMonth || new Date().toISOString().slice(0, 7)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !csvInput.trim()) {
      alert('Please select a file (.csv, .xlsx, .tsv) or paste SAP MB51 export rows.');
      return;
    }

    setIsSubmitting(true);
    setUploadWarnings([]);
    try {
      const resp = await mb51Service.bulkUpload({
        file: selectedFile || undefined,
        csv_text: selectedFile ? undefined : csvInput.trim(),
        month: selectedMonth
      });

      const refreshed = await mb51Service.getTransactions({ month: selectedMonth });
      if (refreshed && Array.isArray(refreshed)) {
        onUpdateMB51(refreshed);
      }
      if (resp.warnings && resp.warnings.length > 0) {
        setUploadWarnings(resp.warnings);
      }
      alert(
        `SAP MB51 Movement Report processed successfully!\n` +
        `• Total Rows: ${resp.total_rows}\n` +
        `• Successfully Imported: ${resp.imported_rows}\n` +
        `• Errors / Skipped: ${resp.error_rows}` +
        (resp.warnings && resp.warnings.length > 0 ? `\n• Warnings: ${resp.warnings.length}` : '')
      );
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setCsvInput('');
    } catch (err: any) {
      console.warn('Backend bulk upload failed, parsing locally as fallback:', err);
      // Fallback local parse for CSV text if provided
      const rawText = csvInput.trim();
      if (!rawText && selectedFile) {
        alert(err?.message || 'Server upload failed. Please ensure the backend server is running.');
        setIsSubmitting(false);
        return;
      }

      const lines = rawText.split('\n');
      const parsed: MB51TransactionItem[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (
          i === 0 &&
          (line.toLowerCase().includes('mat') ||
            line.toLowerCase().includes('mvt') ||
            line.toLowerCase().includes('doc'))
        ) {
          continue;
        }

        const delimiter = line.includes('\t') ? '\t' : ',';
        const parts = line.split(delimiter).map((s) => s.replace(/^"|"$/g, '').trim());

        if (parts.length >= 4) {
          const matDoc = parts[0];
          const date = parts.length >= 2 ? parts[1] : new Date().toISOString().slice(0, 10);
          const mvt = parts.length >= 3 ? parts[2] : '101';
          const partNo = parts.length >= 4 ? parts[3] : '';
          const desc = parts.length >= 5 ? parts[4] : `Material ${partNo}`;
          const qtyStr = parts.length >= 6 ? parts[5] : '100';
          const qty = parseFloat(qtyStr.replace(/,/g, '')) || 0;
          const uom = parts.length >= 7 ? parts[6] : 'PC';
          const sloc = parts.length >= 8 ? parts[7] : 'SL01';
          const partner = parts.length >= 9 ? parts[8] : '';

          if (partNo && qty > 0) {
            const classification = deriveClassification(mvt, partNo);
            const mappedWeek = getWeekForTransaction(
              { postingDate: date, partNumber: partNo } as any,
              weeks
            );

            parsed.push({
              id: `mb51-${Date.now()}-${i}`,
              materialDocument: matDoc,
              postingDate: date,
              movementType: mvt,
              partNumber: partNo,
              materialDescription: desc,
              quantity: qty,
              uom,
              storageLocation: sloc,
              plant: '1001',
              vendorOrCustomer: partner,
              classification,
              weekId: mappedWeek?.id
            });
          }
        }
      }

      if (parsed.length === 0) {
        alert('No valid MB51 records found. Check columns format.');
        return;
      }

      onUpdateMB51([...parsed, ...mb51List]);
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setCsvInput('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this MB51 transaction record?')) {
      try {
        if (!id.startsWith('mb51-') && !isNaN(Number(id))) {
          await mb51Service.deleteTransaction(id);
        }
      } catch (err) {
        console.warn('Backend delete failed, removing locally:', err);
      }
      onUpdateMB51(mb51List.filter((tx) => tx.id !== id));
    }
  };

  const handleExportCSV = () => {
    const headers = [
      'Material Document',
      'Posting Date',
      'Movement Type',
      'Classification',
      'Part Number',
      'Description',
      'Quantity',
      'UOM',
      'Storage Location',
      'Partner / Vendor / Line',
      'PO / Order No'
    ];

    const rows = filteredList.map((tx) => [
      `"${tx.materialDocument}"`,
      `"${tx.postingDate}"`,
      `"${tx.movementType}"`,
      `"${tx.classification}"`,
      `"${tx.partNumber}"`,
      `"${tx.materialDescription}"`,
      tx.quantity,
      `"${tx.uom}"`,
      `"${tx.storageLocation}"`,
      `"${tx.vendorOrCustomer || ''}"`,
      `"${tx.poOrOrderNumber || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SAP_MB51_Movement_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Monday Upload: SAP MB51 Movement Report</h1>
            <p className="text-sm text-slate-500">
              Parses 101 FG Production Receipts (prefix 7), 101 RM/PM Inward Receipts (non-7), and 601 FG Dispatches
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <Upload className="w-4 h-4 text-blue-600" />
            Upload MB51 CSV / Excel
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export CSV
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Material Doc
          </button>
        </div>
      </div>

      {/* Upload Notices / Duplicate Warnings */}
      {uploadWarnings.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm flex items-start gap-3 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold mb-1">
              Upload Completed with Warnings ({uploadWarnings.length}):
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

      {/* SAP Movement Logic Specification Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: 101 FG */}
        <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm flex items-start gap-3">
          <div className="p-2.5 bg-blue-50 rounded-lg text-blue-700 font-bold text-xs shrink-0">
            101 (7xxx)
          </div>
          <div>
            <div className="text-xs font-bold text-blue-900 uppercase">101 FG Production Receipts</div>
            <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
              {fgProductionQty.toLocaleString()} <span className="text-xs font-normal text-slate-500">Units</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Part starts with '7' (Finished Goods)</div>
          </div>
        </div>

        {/* Card 2: 101 RM/PM */}
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm flex items-start gap-3">
          <div className="p-2.5 bg-emerald-50 rounded-lg text-emerald-700 font-bold text-xs shrink-0">
            101 (Non-7)
          </div>
          <div>
            <div className="text-xs font-bold text-emerald-900 uppercase">101 RM/PM Inward Receipts</div>
            <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
              {rmpmReceiptQty.toLocaleString()} <span className="text-xs font-normal text-slate-500">Units</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Part starts other than '7' (Vendor receipts)</div>
          </div>
        </div>

        {/* Card 3: 601 FG Dispatch */}
        <div className="bg-white p-4 rounded-xl border border-purple-200 shadow-sm flex items-start gap-3">
          <div className="p-2.5 bg-purple-50 rounded-lg text-purple-700 font-bold text-xs shrink-0">
            601 Mvt
          </div>
          <div>
            <div className="text-xs font-bold text-purple-900 uppercase">601 Finished Good Dispatches</div>
            <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
              {fgDispatchQty.toLocaleString()} <span className="text-xs font-normal text-slate-500">Units</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Goods issue to customer delivery</div>
          </div>
        </div>
      </div>

      {/* Tabs and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setSelectedTab('ALL')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selectedTab === 'ALL'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Movements ({mb51List.length})
            </button>
            <button
              onClick={() => setSelectedTab('101_FG')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                selectedTab === '101_FG'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Factory className="w-3.5 h-3.5 text-blue-600" />
              101 FG Production
            </button>
            <button
              onClick={() => setSelectedTab('101_RMPM')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                selectedTab === '101_RMPM'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600" />
              101 RM/PM Inward
            </button>
            <button
              onClick={() => setSelectedTab('601_DISPATCH')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                selectedTab === '601_DISPATCH'
                  ? 'bg-white text-purple-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-purple-600" />
              601 FG Dispatches
            </button>
          </div>

          <select
            value={selectedWeekFilter}
            onChange={(e) => setSelectedWeekFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Weeks</option>
            {monthWeeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.weekLabel}
              </option>
            ))}
          </select>
        </div>

        <div className="relative min-w-[240px] w-full md:w-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search Doc No, Part, Partner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Material Doc</th>
                <th className="py-3.5 px-4">Posting Date</th>
                <th className="py-3.5 px-4 text-center">Movement Type</th>
                <th className="py-3.5 px-4">Classification</th>
                <th className="py-3.5 px-4">Part Number</th>
                <th className="py-3.5 px-4">Material Description</th>
                <th className="py-3.5 px-4 text-right">Quantity</th>
                <th className="py-3.5 px-4 text-center">UOM</th>
                <th className="py-3.5 px-4">SLOC</th>
                <th className="py-3.5 px-4">Partner / Line / Vendor</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    No SAP MB51 material documents found.
                  </td>
                </tr>
              ) : (
                filteredList.map((tx) => {
                  const isFG101 = tx.classification === 'FG_PRODUCTION_RECEIPT';
                  const isRM101 = tx.classification === 'RMPM_RECEIPT';
                  const isDisp601 = tx.classification === 'FG_DISPATCH';

                  return (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 text-xs">
                        {tx.materialDocument}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-600">
                        {tx.postingDate}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded font-mono text-xs font-bold ${
                            tx.movementType === '101'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {tx.movementType}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {isFG101 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold border border-blue-200">
                            <Factory className="w-3 h-3 text-blue-600" />
                            101 FG Production
                          </span>
                        )}
                        {isRM101 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-semibold border border-emerald-200">
                            <ArrowDownLeft className="w-3 h-3 text-emerald-600" />
                            101 RM/PM Inward
                          </span>
                        )}
                        {isDisp601 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-semibold border border-purple-200">
                            <Truck className="w-3 h-3 text-purple-600" />
                            601 FG Dispatch
                          </span>
                        )}
                        {!isFG101 && !isRM101 && !isDisp601 && (
                          <span className="text-xs text-slate-500 font-medium">Other</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 text-xs">
                        {tx.partNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium text-xs">
                        {tx.materialDescription}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {tx.quantity.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-center text-xs font-medium text-slate-500">
                        {tx.uom}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-slate-600">
                        {tx.storageLocation}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {tx.vendorOrCustomer || '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleDelete(tx.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                          title="Delete transaction"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Add SAP MB51 Material Document
            </h2>

            <form onSubmit={handleSaveTransaction} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Material Document No *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.materialDocument || ''}
                    onChange={(e) => setFormData({ ...formData, materialDocument: e.target.value })}
                    placeholder="e.g. 5000210080"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Posting Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.postingDate || ''}
                    onChange={(e) => setFormData({ ...formData, postingDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Movement Type *
                  </label>
                  <select
                    value={formData.movementType || '101'}
                    onChange={(e) => setFormData({ ...formData, movementType: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white font-mono font-bold"
                  >
                    <option value="101">101 - Goods Receipt</option>
                    <option value="601">601 - Goods Issue / Dispatch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Part Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.partNumber || ''}
                    onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
                    placeholder="e.g. 7.06496.03.0 (FG) or 100201 (RM)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Material Description
                </label>
                <input
                  type="text"
                  value={formData.materialDescription || ''}
                  onChange={(e) => setFormData({ ...formData, materialDescription: e.target.value })}
                  placeholder="e.g. Vacuum Pump Panther 2.0L"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.quantity ?? 1000}
                    onChange={(e) =>
                      setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    UOM *
                  </label>
                  <input
                    type="text"
                    value={formData.uom || 'PC'}
                    onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Storage Location
                  </label>
                  <input
                    type="text"
                    value={formData.storageLocation || 'SL01'}
                    onChange={(e) => setFormData({ ...formData, storageLocation: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Partner / Vendor / Line
                  </label>
                  <input
                    type="text"
                    value={formData.vendorOrCustomer || ''}
                    onChange={(e) => setFormData({ ...formData, vendorOrCustomer: e.target.value })}
                    placeholder="e.g. Endurance Technologies / Tata Motors"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    PO / Prod Order No
                  </label>
                  <input
                    type="text"
                    value={formData.poOrOrderNumber || ''}
                    onChange={(e) => setFormData({ ...formData, poOrOrderNumber: e.target.value })}
                    placeholder="e.g. PO-4500091211"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
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
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Material Doc
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Upload SAP MB51 Movement Report
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Import SAP MB51 material documents (.csv, .xlsx, .tsv). Auto-classifies 101 receipts and 601 dispatches.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                title="Download sample MB51 CSV template"
              >
                <Download className="w-3.5 h-3.5" />
                Template
              </button>
            </div>

            <form onSubmit={handleCSVUpload} className="space-y-4">
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
                    ? 'border-blue-500 bg-blue-50/70 scale-[1.01]'
                    : selectedFile
                    ? 'border-emerald-400 bg-emerald-50/40'
                    : 'border-slate-300 hover:border-blue-400 bg-slate-50/60'
                }`}
              >
                <input
                  type="file"
                  id="mb51-file-input"
                  accept=".csv, .xlsx, .xlsm, .tsv, .txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                />
                <label
                  htmlFor="mb51-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center gap-1.5"
                >
                  <FileSpreadsheet
                    className={`w-9 h-9 ${
                      selectedFile ? 'text-emerald-600' : 'text-blue-600'
                    }`}
                  />
                  <div className="text-xs font-semibold text-slate-800">
                    {selectedFile ? (
                      <span className="text-emerald-800 font-bold">{selectedFile.name}</span>
                    ) : (
                      'Click to browse or drag & drop SAP MB51 file (.csv, .xlsx)'
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
                      : `MatDoc,PostingDate,Mvt,PartNumber,Description,Qty,UOM,SLOC,Partner\n5000210031,2026-08-05,101,7.06496.03.0,Vacuum Pump Panther,1500,PC,FG01,Line A-PMP2\n5000210032,2026-08-06,101,100201,Die-Cast Aluminum Housing,3000,PC,SL01,Endurance Tech\n5000210033,2026-08-07,601,7.06496.03.0,Vacuum Pump Panther,2600,PC,FG01,Tata Motors`
                  }
                  className={`w-full p-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono ${
                    selectedFile ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'
                  }`}
                />
              </div>

              {/* Ingestion Rules Guide */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-600" />
                  SAP Movement Classification Rules:
                </div>
                <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                  <li><strong>101 Movement + Prefix '7'</strong>: Finished Goods Production Receipt</li>
                  <li><strong>101 Movement + Non-'7'</strong>: RM / PM Inward Vendor Receipt</li>
                  <li><strong>601 Movement</strong>: Finished Goods Customer Dispatch / Issue</li>
                  <li>All files are stored in MinIO storage and tracked with a unique Upload Batch ID</li>
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
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Uploading & Processing...' : 'Process MB51 Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
