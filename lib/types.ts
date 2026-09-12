import type {
  AttachmentCategory,
  CaseSource,
  CaseStatus,
  InvoiceKind,
  InvoiceStatus,
  MemberRole,
  PaymentMethod,
  ProtocolType,
  SubcontractorStatus,
  TaskPriority,
  TaskStatus,
  Unit,
  VatRate
} from "@/lib/domain";
import {
  ACTIVE_BOARD_STATUSES,
  ATTACHMENT_CATEGORIES,
  CASE_SOURCES,
  CASE_STATUSES,
  INVOICE_KIND_IS_VAT,
  INVOICE_KIND_LABELS,
  INVOICE_KIND_PREFIX,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PROTOCOL_TYPES,
  SUBCONTRACTOR_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UNITS,
  VAT_RATES
} from "@/lib/domain";

export type {
  AttachmentCategory,
  CaseSource,
  CaseStatus,
  InvoiceKind,
  InvoiceStatus,
  MemberRole,
  PaymentMethod,
  ProtocolType,
  SubcontractorStatus,
  TaskPriority,
  TaskStatus,
  Unit,
  VatRate
};
export {
  ACTIVE_BOARD_STATUSES,
  ATTACHMENT_CATEGORIES,
  CASE_SOURCES,
  CASE_STATUSES,
  INVOICE_KIND_IS_VAT,
  INVOICE_KIND_LABELS,
  INVOICE_KIND_PREFIX,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PROTOCOL_TYPES,
  SUBCONTRACTOR_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UNITS,
  VAT_RATES
};

export type Organization = {
  id: string;
  name: string;
  created_at: string;
};

export type Crew = {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
};

export type JobPosition = {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type CaseRow = {
  id: string;
  organization_id: string;
  crew_id: string | null;
  client_name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  work_description: string;
  status: CaseStatus;
  source: CaseSource;
  estimated_value: number | null;
  next_contact_date: string | null;
  realization_end_date: string | null;
  contract_number: string | null;
  contract_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AsBuiltLineSnapshot = {
  lp: number;
  label: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  line_total: number;
};

export type CaseAsBuiltEstimate = {
  id: string;
  organization_id: string;
  case_id: string;
  variant_id: string | null;
  variant_name: string;
  title: string;
  contract_number: string | null;
  contract_date: string | null;
  pdf_work_description: string | null;
  settlement_basis: string | null;
  footer_note: string | null;
  net_total: number;
  advances_paid: number;
  /** Pozostało do dopłaty netto — starsze rekordy; nowe liczą saldo brutto. */
  balance_due: number;
  vat_rate?: number | null;
  vat_total?: number | null;
  gross_total?: number | null;
  balance_due_gross?: number | null;
  line_count: number;
  lines_snapshot: AsBuiltLineSnapshot[];
  storage_path: string;
  file_name: string;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
};

export type CaseNote = {
  id: string;
  organization_id: string;
  case_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type CatalogItem = {
  id: string;
  organization_id: string;
  label: string;
  default_unit: Unit;
  category: "material" | "labor";
  suggested_rate: number | null;
  sort_order: number;
  created_at: string;
};

export type OfferVariant = {
  id: string;
  organization_id: string;
  case_id: string;
  name: string;
  scope_notes: string | null;
  sort_order: number;
  created_at: string;
};

export type OfferLine = {
  id: string;
  organization_id: string;
  variant_id: string;
  section: "labor" | "material";
  label: string;
  unit: Unit;
  quantity: number;
  unit_rate: number;
  line_total: number;
  sort_order: number;
  created_at: string;
};

export type CaseScheduleItem = {
  id: string;
  organization_id: string;
  case_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  completed: boolean;
  sort_order: number;
  created_at: string;
};

export type Payment = {
  id: string;
  organization_id: string;
  case_id: string;
  title: string;
  due_date: string | null;
  amount_due: number;
  amount_paid: number;
  paid_at: string | null;
  sort_order: number;
  created_at: string;
};

export type FinancialControlSection =
  | "confirmed_receivable"
  | "potential_scope"
  | "cash_outside_transfer"
  | "dispute"
  | "completion_receivable"
  | "scheduled_build"
  | "crew_settlement"
  | "employee_settlement"
  | "subcontractor_settlement";

export type FinancialControlItem = {
  id: string;
  organization_id: string;
  case_id: string | null;
  payment_id: string | null;
  section: FinancialControlSection;
  location: string;
  address: string | null;
  client_label: string | null;
  title: string | null;
  scope: string | null;
  amount: number | null;
  amount_label: string | null;
  payer: string | null;
  status_action: string | null;
  condition_label: string | null;
  phone: string | null;
  term_label: string | null;
  crew_label: string | null;
  notes: string | null;
  sort_order: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
  organization_id: string;
  case_id: string;
  remind_at: string;
  title: string;
  note: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ExtraWork = {
  id: string;
  organization_id: string;
  case_id: string;
  work_date: string;
  description: string;
  quantity: number;
  unit: Unit;
  unit_rate: number;
  line_total: number;
  accepted: boolean;
  created_at: string;
};

export type CaseProtocol = {
  id: string;
  organization_id: string;
  case_id: string;
  protocol_type: ProtocolType;
  notes: string;
  created_by: string | null;
  created_at: string;
};

export type Attachment = {
  id: string;
  organization_id: string;
  case_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  category: AttachmentCategory;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export type WorkHour = {
  id: string;
  organization_id: string;
  case_id: string | null;
  employee_id?: string | null;
  site_label: string | null;
  worker_name: string;
  work_date: string;
  hours: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseFormValues = {
  client_name: string;
  phone: string;
  email: string;
  location: string;
  work_description: string;
  status: CaseStatus;
  source: CaseSource;
  crew_id: string;
  estimated_value: string;
  next_contact_date: string;
  realization_end_date: string;
  contract_number: string;
  contract_date: string;
  /** Odpowiedzialni (prowadzący sprawę po stronie biura). */
  responsible_user_ids: string[];
  /** Przypisani do realizacji (teren — widzą budowę, powiadomienia). */
  assigned_user_ids: string[];
  /** Wstępny kosztorys z pliku — trafi do oferty po utworzeniu zlecenia. */
  estimate_draft: EstimateImportDraft | null;
};

/** Pozycja kosztorysu przed zapisem do oferty (import CSV/XLSX). */
export type ImportedEstimateLine = {
  section: "labor" | "material";
  name: string;
  unit: Unit;
  quantity: number;
  unitRate: number;
};

export type EstimateImportDraft = {
  sourceLabel: string;
  headerInfo: string;
  lines: ImportedEstimateLine[];
  include: boolean[];
};

/** Reużywalny szablon kosztorysu (biblioteka gotowych zestawów pozycji). */
export type EstimateTemplate = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
};

export type EstimateTemplateLine = {
  id: string;
  organization_id: string;
  template_id: string;
  section: "labor" | "material";
  label: string;
  unit: Unit;
  quantity: number;
  unit_rate: number;
  line_total: number;
  sort_order: number;
  created_at: string;
};

export type Subcontractor = {
  id: string;
  organization_id: string;
  name: string;
  trade: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  default_rate: number | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
};

export type CaseSubcontractor = {
  id: string;
  organization_id: string;
  case_id: string;
  subcontractor_id: string;
  scope: string;
  rate: number | null;
  unit: Unit | null;
  agreed_total: number | null;
  status: SubcontractorStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type EmployeeDepartment =
  | "zarzad"
  | "biuro"
  | "handlowcy"
  | "kierownicy"
  | "brygada"
  | "podwykonawcy"
  | "bhp"
  | "inne";

export type EmployeeEmploymentType = "godzinowka" | "dniowka" | "etat" | "ryczalt" | "b2b" | "podwykonawca" | "akord" | "inne";

export type EmployeeProfile = {
  id: string;
  organization_id: string;
  user_id: string | null;
  crew_id: string | null;
  manager_employee_id: string | null;
  full_name: string;
  role_title: string;
  department: EmployeeDepartment;
  employment_type: EmployeeEmploymentType;
  has_system_access: boolean;
  phone: string | null;
  email: string | null;
  bhp_valid_until: string | null;
  medical_valid_until: string | null;
  notes: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeCompensation = {
  employee_id: string;
  organization_id: string;
  hourly_rate: number | null;
  day_rate: number | null;
  monthly_salary: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeePayrollProfile = EmployeeProfile &
  Pick<EmployeeCompensation, "hourly_rate" | "day_rate" | "monthly_salary">;

export type OperationalPieceworkActivity = Omit<PieceworkActivity, "rate">;
export type OperationalEmployeePieceworkEntry = Omit<EmployeePieceworkEntry, "unit_rate_snapshot">;

export type AggregatedLaborCost = {
  case_id: string;
  cost_date: string;
  amount: number;
};

export type EmployeeDocumentType = "bhp" | "medical" | "training" | "qualification" | "contract" | "annex" | "certificate" | "other";
export type EmployeeDocumentStatus = "active" | "archived";

export type EmployeeDocument = {
  id: string;
  organization_id: string;
  employee_id: string;
  document_type: EmployeeDocumentType;
  title: string;
  document_number: string | null;
  issued_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  requires_renewal: boolean;
  status: EmployeeDocumentStatus;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  source_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeePositionHistory = {
  id: string;
  organization_id: string;
  employee_id: string;
  role_title: string;
  department: EmployeeDepartment;
  employment_type: EmployeeEmploymentType;
  manager_employee_id: string | null;
  valid_from: string;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type EmployeeCrewHistory = {
  id: string;
  organization_id: string;
  employee_id: string;
  crew_id: string | null;
  valid_from: string;
  valid_until: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

/** Słownik czynności akordowych (jednostka + stawka) — analogiczny do `CatalogItem`. */
export type PieceworkActivity = {
  id: string;
  organization_id: string;
  name: string;
  unit: Unit;
  rate: number;
  sort_order: number;
  active: boolean;
  created_at: string;
};

/** Wpis wykonanej pracy akordowej — stawka jest migawką z momentu wpisu. */
export type EmployeePieceworkEntry = {
  id: string;
  organization_id: string;
  employee_id: string;
  activity_id: string;
  case_id: string | null;
  quantity: number;
  unit_rate_snapshot: number;
  entry_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type EmployeeSettlementEntryType = "zaliczka" | "wyplata" | "premia" | "potracenie" | "zwrot_kosztow" | "korekta";

export type EmployeeSettlementEntry = {
  id: string;
  organization_id: string;
  employee_id: string;
  case_id: string | null;
  entry_type: EmployeeSettlementEntryType;
  amount: number;
  entry_date: string;
  title: string;
  notes: string | null;
  direction?: "plus" | "minus";
  created_by: string | null;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string;
};

export type EmployeeMonthlySettlementStatus = "draft" | "approved" | "paid" | "closed";

export type EmployeeMonthlySettlement = {
  id: string;
  organization_id: string;
  employee_id: string;
  period_month: string;
  status: EmployeeMonthlySettlementStatus;
  employment_type_snapshot: EmployeeEmploymentType;
  hourly_rate_snapshot: number;
  day_rate_snapshot: number;
  monthly_salary_snapshot: number;
  hours_total: number;
  work_days_total: number;
  piecework_total: number;
  piecework_quantity_total: number;
  base_amount: number;
  bonuses_total: number;
  reimbursements_total: number;
  corrections_plus_total: number;
  deductions_total: number;
  corrections_minus_total: number;
  advances_total: number;
  previous_payments_total: number;
  gross_earnings: number;
  amount_due: number;
  final_payment_amount: number | null;
  notes: string | null;
  calculated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeSettlementHistory = {
  id: string;
  organization_id: string;
  settlement_id: string | null;
  employee_id: string;
  period_month: string;
  action: string;
  summary: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type SupplierInvoiceCategory = "materialy" | "robocizna" | "sprzet" | "transport" | "podwykonawca" | "inne";
export type SupplierInvoiceStatus = "nieoplacona" | "czesciowo" | "oplacona";

export type SupplierInvoice = {
  id: string;
  organization_id: string;
  case_id: string | null;
  supplier_name: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  category: SupplierInvoiceCategory;
  net_total: number | null;
  gross_total: number;
  paid_amount: number;
  paid_at?: string | null;
  status: SupplierInvoiceStatus;
  notes: string | null;
  attachment_id?: string | null;
  sent_to?: string | null;
  sent_at?: string | null;
  import_batch_id?: string | null;
  source?: "manual" | "csv" | "xlsx" | "ocr";
  category_confidence?: number | null;
  category_reason?: string | null;
  raw_import_data?: Record<string, unknown> | null;
  subcontractor_id?: string | null;
  case_subcontractor_id?: string | null;
  linked_settlement_entry_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseProfitabilityPlan = {
  id: string;
  organization_id: string;
  case_id: string;
  planned_revenue: number;
  planned_material_cost: number;
  planned_labor_cost: number;
  planned_subcontractor_cost: number;
  planned_equipment_cost: number;
  planned_transport_cost: number;
  planned_other_cost: number;
  contingency_pct: number;
  progress_pct: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SupplierInvoiceCategoryRule = {
  id: string;
  organization_id: string;
  pattern: string;
  match_field: "all" | "supplier" | "number" | "notes";
  category: SupplierInvoiceCategory;
  priority: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
};

export type SupplierInvoiceImportBatch = {
  id: string;
  organization_id: string;
  source: "csv" | "xlsx" | "ocr" | "manual";
  file_name: string | null;
  row_count: number;
  duplicate_count: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type SubcontractorSettlementEntryType = "zaliczka" | "wyplata" | "rozliczenie_koncowe" | "dopłata" | "potracenie" | "korekta";

export type SubcontractorSettlementEntry = {
  id: string;
  organization_id: string;
  case_id: string | null;
  subcontractor_id: string | null;
  case_subcontractor_id: string | null;
  entry_type: SubcontractorSettlementEntryType;
  amount: number;
  entry_date: string;
  title: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type CaseDirectCostType = "materialy" | "robocizna" | "podwykonawcy" | "transport" | "sprzet" | "inne";

export type CaseDirectCost = {
  id: string;
  organization_id: string;
  case_id: string;
  cost_type: CaseDirectCostType;
  title: string;
  amount: number;
  cost_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type CaseTask = {
  id: string;
  organization_id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type CaseTaskComment = {
  id: string;
  organization_id: string;
  task_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
};

export type CaseTaskCommentAttachment = {
  id: string;
  organization_id: string;
  comment_id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type CaseTaskRead = {
  organization_id: string;
  task_id: string;
  user_id: string;
  last_read_at: string;
};

export type AiConversationContextType = "global" | "case";

export type AiConversation = {
  id: string;
  organization_id: string;
  case_id: string | null;
  context_type: AiConversationContextType;
  title: string;
  created_by: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

export type AiMessageRole = "user" | "assistant" | "system";

export type AiMessage = {
  id: string;
  organization_id: string;
  conversation_id: string;
  case_id: string | null;
  role: AiMessageRole;
  content: string;
  meta: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export type AiMessageAttachment = {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string | null;
  case_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number;
  extracted_text: string | null;
  extraction_status: "ready" | "partial" | "failed";
  extraction_error: string | null;
  created_by: string | null;
  created_at: string;
};

export type AiGeneratedArtifact = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  case_id: string | null;
  artifact_type: "pdf" | "xlsx";
  report_type: string;
  title: string;
  storage_path: string | null;
  file_name: string;
  created_by: string | null;
  created_at: string;
};

export type OrgMemberProfile = {
  organization_id: string;
  user_id: string;
  role: MemberRole;
  email: string | null;
  /** Bezpieczna nazwa z katalogu organizacji; fallbackiem pozostaje email. */
  display_name?: string | null;
};

export type CaseAssigneeRole = "lead" | "field";

export type CaseAssignee = {
  case_id: string;
  user_id: string;
  assignment_role?: CaseAssigneeRole;
};

/** Wiersz z select case_assignees (user_id + assignment_role). */
export type CaseAssigneeRow = {
  user_id: string;
  assignment_role: CaseAssigneeRole;
};

export type Vehicle = {
  id: string;
  organization_id: string;
  name: string;
  registration_number: string | null;
  make_model: string | null;
  notes: string | null;
  /** Stare wspólne pole ubezpieczenia (zachowane dla zgodności). */
  insurance_expires: string | null;
  insurance_oc_expires: string | null;
  insurance_ac_expires: string | null;
  inspection_expires: string | null;
  created_at: string;
  updated_at: string;
};

export const COMPANY_POLICY_TYPES = [
  "OC działalności",
  "Polisa majątkowa",
  "Ubezpieczenie OC zawodowe",
  "Gwarancja ubezpieczeniowa",
  "Inne"
] as const;
export type CompanyPolicyType = (typeof COMPANY_POLICY_TYPES)[number];

export type CompanyPolicy = {
  id: string;
  organization_id: string;
  policy_type: string;
  policy_number: string | null;
  insurer: string | null;
  coverage_end: string | null;
  payment_due: string | null;
  amount: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type VehicleServiceEntry = {
  id: string;
  organization_id: string;
  vehicle_id: string;
  service_date: string;
  title: string;
  description: string | null;
  cost: number | null;
  vendor: string | null;
  created_at: string;
};

export type WarehouseItem = {
  id: string;
  organization_id: string;
  catalog_item_id: string | null;
  label: string;
  unit: Unit;
  quantity: number;
  min_quantity: number;
  location: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type WarehouseMovement = {
  id: string;
  organization_id: string;
  warehouse_item_id: string;
  movement_type: "in" | "out";
  quantity: number;
  note: string | null;
  case_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type WarehouseAuditLog = {
  id: string;
  organization_id: string;
  warehouse_item_id: string | null;
  action: "item_created" | "items_imported" | "min_quantity_changed";
  label: string;
  details: string | null;
  created_by: string | null;
  created_at: string;
};

export const EQUIPMENT_CATEGORIES = ["rusztowanie", "maszyna", "narzędzie", "sprzęt", "inne"] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export type Equipment = {
  id: string;
  organization_id: string;
  name: string;
  category: EquipmentCategory;
  unit: string;
  total_quantity: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type EquipmentAssignment = {
  id: string;
  organization_id: string;
  equipment_id: string;
  case_id: string | null;
  site_label: string | null;
  quantity: number;
  assigned_date: string;
  returned: boolean;
  returned_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** Faktura (proforma / zaliczkowa / końcowa / VAT) powiązana ze sprawą. */
export type Invoice = {
  id: string;
  organization_id: string;
  case_id: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string;
  number_seq: number;
  number_year: number;
  issue_date: string;
  sale_date: string | null;
  due_date: string | null;
  payment_method: PaymentMethod;
  buyer_name: string;
  buyer_nip: string | null;
  buyer_address: string | null;
  buyer_city: string | null;
  buyer_email: string | null;
  notes: string | null;
  with_receipt: boolean;
  receipt_date: string | null;
  receipt_amount: number | null;
  sent_at: string | null;
  sent_to: string | null;
  net_total: number;
  vat_total: number;
  gross_total: number;
  paid_amount: number;
  paid_at?: string | null;
  source_variant_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLine = {
  id: string;
  organization_id: string;
  invoice_id: string;
  name: string;
  unit: Unit;
  quantity: number;
  unit_price_net: number;
  discount_pct: number;
  vat_rate: number;
  net_total: number;
  sort_order: number;
  created_at: string;
};

/** Preferencje powiadomień e-mail (owner edytuje w Zespół). */
export type DigestEmailPref = {
  organization_id: string;
  user_id: string;
  digest_enabled: boolean;
  include_reminders: boolean;
  include_overdue_contact: boolean;
  include_schedule: boolean;
  include_payments: boolean;
  include_tasks: boolean;
  include_fleet: boolean;
  include_warehouse: boolean;
  include_profitability_alerts: boolean;
  include_cost_invoices: boolean;
  include_employee_compliance: boolean;
  include_settlements: boolean;
  include_stale_cases: boolean;
  notify_new_case: boolean;
  notify_task_comment: boolean;
  notify_financial_alerts: boolean;
  push_enabled: boolean;
  updated_at: string;
};

export type InstantNotificationType =
  | "new_case"
  | "case_assigned"
  | "task_created"
  | "task_comment"
  | "financial_alert"
  | "employee_compliance";

export type UserNotification = {
  id: string;
  organization_id: string;
  user_id: string;
  type: InstantNotificationType;
  title: string;
  body: string;
  href: string;
  entity_id: string | null;
  event_key?: string | null;
  read_at: string | null;
  created_at: string;
};
