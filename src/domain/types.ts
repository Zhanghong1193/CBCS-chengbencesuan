export type ApplicabilityStatus = "pending" | "applicable" | "not_applicable";

export const SECONDARY_PRODUCT_LINES = [
  "多领域感染",
  "风湿检测",
  "过敏原检测",
  "免疫功能",
  "内分泌检测",
  "皮肤检测",
  "其他分子",
  "神经感染",
  "神经免疫",
  "神经退行",
  "神经遗传",
  "肾病检测",
  "消化检测",
  "眼病检测",
] as const;

export const PROJECT_CATALOGS = ["经典版", "标准版", "探索版", "定制版"] as const;
export const PROJECT_LAUNCH_STATUSES = ["已开展", "待导入", "已退市"] as const;

export interface PriceTierInput {
  id: string;
  name: string;
  unitPrice: string;
}

export interface ReagentItem {
  id?: string;
  name: string;
  model?: string;
  packageQuantity: string;
  currentPurchasePrice: string;
  inquiryPurchasePrice: string;
  baseUsagePerSample: string;
  batchSampleCount: string;
  standardCurveUsage: string;
  qualityControlUsage: string;
  controlUsage: string;
  otherFixedUsage: string;
  usageOverride: string;
  overrideReason: string;
}

export interface ConsumableItem {
  id?: string;
  name: string;
  model?: string;
  packageQuantity: string;
  currentPurchasePrice: string;
  inquiryPurchasePrice: string;
  usagePerSample: string;
}

export interface LaborItem {
  group: string;
  hoursPerSample: string;
  hourlyRate: string;
}

export interface OutsourceItem {
  id?: string;
  name: string;
  unitPrice: string;
  quantity: string;
  note: string;
}

export interface OtherCostItem {
  id?: string;
  name: string;
  amount: string;
}

export interface ProjectCalculationInput {
  sampleCount: number;
  marketPrice: string;
  priceTiers: PriceTierInput[];
  reagents: ReagentItem[];
  consumablesStatus: ApplicabilityStatus;
  consumables: ConsumableItem[];
  labor: LaborItem[];
  outsourcingStatus: ApplicabilityStatus;
  outsourcing: OutsourceItem[];
  otherCosts: OtherCostItem[];
}

export interface CalculatedLine {
  name: string;
  amount: string;
}

export interface CalculatedReagentLine extends CalculatedLine {
  actualUsagePerSample: string;
  purchasePrice: string;
}

export interface PriceResult {
  id: string;
  name: string;
  unitPrice: string;
  discount: string;
  grossProfit: string;
  marginRate: string;
}

export interface ProjectCalculationResult {
  reagentItems: CalculatedReagentLine[];
  consumableItems: CalculatedLine[];
  laborItems: CalculatedLine[];
  outsourcingItems: CalculatedLine[];
  reagentTotal: string;
  consumableTotal: string;
  laborTotal: string;
  otherInternalCost: string;
  selfTestCost: string;
  outsourcingCost: string;
  totalCost: string;
  unitSelfTestCost: string;
  unitOutsourcingCost: string;
  unitTotalCost: string;
  priceResults: PriceResult[];
}

export interface ProjectVersionInput extends ProjectCalculationInput {
  projectCode: string;
  projectName: string;
  secondaryProductLine?: string;
  catalog?: string;
  launchStatus?: string;
  costNote: string;
}
