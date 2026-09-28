import {
  PROJECT_CATALOGS, PROJECT_LAUNCH_STATUSES, SECONDARY_PRODUCT_LINES,
  type ProjectVersionInput,
} from "./types";

export interface ValidationIssue {
  field: string;
  message: string;
}

function positive(value: string | number): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function nonNegative(value: string | number): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function validateForCompletion(
  input: ProjectVersionInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  if (!input.projectName.trim()) add("projectName", "请填写项目名称");
  if (!input.secondaryProductLine?.trim()) {
    add("secondaryProductLine", "请选择二级产品线");
  } else if (!SECONDARY_PRODUCT_LINES.includes(input.secondaryProductLine as typeof SECONDARY_PRODUCT_LINES[number])) {
    add("secondaryProductLine", "请选择有效的二级产品线");
  }
  if (!input.catalog?.trim()) {
    add("catalog", "请选择所属目录");
  } else if (!PROJECT_CATALOGS.includes(input.catalog as typeof PROJECT_CATALOGS[number])) {
    add("catalog", "请选择有效的所属目录");
  }
  if (!input.launchStatus?.trim()) {
    add("launchStatus", "请选择开展状态");
  } else if (!PROJECT_LAUNCH_STATUSES.includes(input.launchStatus as typeof PROJECT_LAUNCH_STATUSES[number])) {
    add("launchStatus", "请选择有效的开展状态");
  }
  if (!positive(input.sampleCount)) add("sampleCount", "送检例数必须大于0");
  if (!positive(input.marketPrice)) add("marketPrice", "市场指导价必须大于0");
  input.priceTiers.forEach((tier) => {
    if (!positive(tier.unitPrice)) {
      add(`priceTiers.${tier.id}`, `${tier.name}必须大于0`);
    }
  });

  input.reagents.forEach((item, index) => {
    const prefix = `reagents.${index}`;
    if (!item.name.trim()) add(`${prefix}.name`, "请填写试剂名称");
    if (!positive(item.packageQuantity)) {
      add(`${prefix}.packageQuantity`, "包装可检测数量必须大于0");
    }
    if (!positive(item.currentPurchasePrice) && !positive(item.inquiryPurchasePrice)) {
      add(`${prefix}.purchasePrice`, "请填写现有采购价或新询采购价");
    }
    if (!positive(item.batchSampleCount)) {
      add(`${prefix}.batchSampleCount`, "批量样本数必须大于0");
    }
    if (item.usageOverride.trim() && !item.overrideReason.trim()) {
      add(`${prefix}.overrideReason`, "调整实际用量时请填写原因");
    }
  });

  if (input.consumablesStatus === "pending") {
    add("consumablesStatus", "请确认是否涉及耗材成本");
  }
  if (input.consumablesStatus === "applicable" && input.consumables.length === 0) {
    add("consumables", "涉及耗材时请至少填写一条明细");
  }
  input.consumables.forEach((item, index) => {
    const prefix = `consumables.${index}`;
    if (!item.name.trim()) add(`${prefix}.name`, "请填写耗材名称");
    if (!positive(item.packageQuantity)) {
      add(`${prefix}.packageQuantity`, "包装数量必须大于0");
    }
    if (!positive(item.currentPurchasePrice) && !positive(item.inquiryPurchasePrice)) {
      add(`${prefix}.purchasePrice`, "请填写现有采购价或新询采购价");
    }
    if (!positive(item.usagePerSample)) {
      add(`${prefix}.usagePerSample`, "每例实际用量必须大于0");
    }
  });

  if (input.labor.length !== 3) add("labor", "请完整填写三道实验室工序");
  input.labor.forEach((item, index) => {
    if (!nonNegative(item.hoursPerSample)) {
      add(`labor.${index}.hoursPerSample`, "工序用时不能小于0");
    }
    if (!positive(item.hourlyRate)) {
      add(`labor.${index}.hourlyRate`, "单位工时价必须大于0");
    }
  });

  if (input.outsourcingStatus === "pending") {
    add("outsourcingStatus", "请确认是否涉及外包成本");
  }
  if (input.outsourcingStatus === "applicable" && input.outsourcing.length === 0) {
    add("outsourcing", "涉及外包时请至少填写一条明细");
  }
  input.outsourcing.forEach((item, index) => {
    const prefix = `outsourcing.${index}`;
    if (!item.name.trim()) add(`${prefix}.name`, "请填写外包服务名称");
    if (!positive(item.unitPrice)) add(`${prefix}.unitPrice`, "外包单价必须大于0");
    if (!positive(item.quantity)) add(`${prefix}.quantity`, "外包数量必须大于0");
  });

  input.otherCosts.forEach((item, index) => {
    if (!item.name.trim()) add(`otherCosts.${index}.name`, "请填写成本名称");
    if (!positive(item.amount)) add(`otherCosts.${index}.amount`, "成本金额必须大于0");
  });

  return issues;
}
