import type { GoodsReceipt, IndentApproval, IndentStatus, SupplierPayment } from '@app/contract';

export interface IndentView {
  id: string;
  number: string;
  poNumber?: string;
  date: string;
  supplierId: string;
  supplier: string;
  status: IndentStatus;
  total: number;
  note: string;
  raisedBy: string;
  rev: number;
  lines: { rawMaterialId: string; name: string; unit: string; qty: number; rate: number; amount: number; received: number }[];
  trail: (IndentApproval & { by: string })[];
  receipts: GoodsReceipt[];
  payments: SupplierPayment[];
  receivedValue: number;
  paid: number;
}

export interface PickItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  lastRate: number;
  stock: number;
  supplierId?: string;
  supplier?: string;
}
