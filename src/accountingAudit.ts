export type AuditSeverity = 'confirmed' | 'review' | 'information';
export interface AuditSourceRef {
  kind: 'contract' | 'payment' | 'expense' | 'account' | 'income';
  id: string;
  label: string;
  contractId?: string;
}
export interface AuditFinding {
  id: string;
  code: string;
  severity: AuditSeverity;
  title: string;
  explanation: string;
  customer?: string;
  product?: string;
  accountName?: string;
  facts: { label: string; value: string | number; format: 'money' | 'text' }[];
  sources: AuditSourceRef[];
  difference?: number;
  nextStep: string;
  reviewedAt?: string | null;
  repairable?: boolean;
}
export interface AuditSummary {
  id: string;
  version?: number;
  calculatedAt: string;
  scope: { accountIds: string[] | null; label: string; includesArchived?: boolean };
  counts: { confirmed: number; review: number; information: number; affectedRecords: number; reviewed?: number };
  checked: {
    accounts: number;
    contracts: number;
    payments: number;
    expenses: number;
    stockDocuments: number;
  };
  summary: string;
  stale?: boolean;
}
export interface AuditReport extends AuditSummary {
  findings: AuditFinding[];
  findingsTotal: number;
  offset: number;
  hasMore: boolean;
  limitations: string[];
  financialDataChanged: false;
}
export interface AuditSource {
  kind: AuditSourceRef['kind'];
  id: string;
  contractId?: string;
  title: string;
  customer?: string;
  customerId?: string;
  accountName: string;
  amount: number;
  date?: string;
  category?: string;
  discountAmount: number;
  remainingAmount?: number;
  stale: boolean;
}
export interface AccountingAuditRequest {
  requestId: string;
  accountIds: string[] | null;
}
export interface AuditRepairPreview {
  id:string;status:'pending'|'done'|'undone'|'cancelled'|'stale'|'expired';expiresAt:string;undoUntil?:string|null;contractId:string;customer:string;product:string;
  price:number;received:number;remaining:number;beforeTotal:number;afterTotal:number;
  rows:{id:string;date:string;before:number;after:number}[];actualPaymentsChanged:false;
}
