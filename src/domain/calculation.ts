import Decimal from "decimal.js";
import type {
  ProjectCalculationInput,
  ProjectCalculationResult,
  ReagentItem,
} from "./types";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const zero = new Decimal(0);

function decimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return zero;
  try {
    return new Decimal(value);
  } catch {
    return zero;
  }
}

function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), zero);
}

function divideOrZero(value: Decimal, divisor: Decimal): Decimal {
  return divisor.isZero() ? zero : value.dividedBy(divisor);
}

export function choosePurchasePrice(
  currentPurchasePrice: string,
  inquiryPurchasePrice: string,
): Decimal {
  return currentPurchasePrice.trim()
    ? decimal(currentPurchasePrice)
    : decimal(inquiryPurchasePrice);
}

function reagentUsage(item: ReagentItem): Decimal {
  if (item.usageOverride.trim()) return decimal(item.usageOverride);
  const batch = decimal(item.batchSampleCount);
  const sampleUsage = decimal(item.baseUsagePerSample).times(batch);
  const fixedUsage = sum([
    decimal(item.standardCurveUsage),
    decimal(item.qualityControlUsage),
    decimal(item.controlUsage),
    decimal(item.otherFixedUsage),
  ]);
  return divideOrZero(sampleUsage.plus(fixedUsage), batch);
}

export function calculateProject(
  input: ProjectCalculationInput,
): ProjectCalculationResult {
  const sampleCount = decimal(input.sampleCount);

  const reagentItems = input.reagents.map((item) => {
    const price = choosePurchasePrice(
      item.currentPurchasePrice,
      item.inquiryPurchasePrice,
    );
    const usage = reagentUsage(item);
    const amount = divideOrZero(price, decimal(item.packageQuantity))
      .times(usage)
      .times(sampleCount);
    return {
      name: item.name,
      purchasePrice: price.toString(),
      actualUsagePerSample: usage.toString(),
      amount: amount.toString(),
    };
  });

  const consumableItems = input.consumables.map((item) => {
    const price = choosePurchasePrice(
      item.currentPurchasePrice,
      item.inquiryPurchasePrice,
    );
    const amount = divideOrZero(price, decimal(item.packageQuantity))
      .times(decimal(item.usagePerSample))
      .times(sampleCount);
    return { name: item.name, amount: amount.toString() };
  });

  const laborItems = input.labor.map((item) => ({
    name: item.group,
    amount: decimal(item.hoursPerSample)
      .times(decimal(item.hourlyRate))
      .times(sampleCount)
      .toString(),
  }));

  const outsourcingItems = input.outsourcing.map((item) => ({
    name: item.name,
    amount: decimal(item.unitPrice).times(decimal(item.quantity)).toString(),
  }));

  const reagentTotal = sum(reagentItems.map((item) => decimal(item.amount)));
  const consumableTotal = sum(
    consumableItems.map((item) => decimal(item.amount)),
  );
  const laborTotal = sum(laborItems.map((item) => decimal(item.amount)));
  const otherInternalCost = sum(
    input.otherCosts.map((item) => decimal(item.amount)),
  );
  const outsourcingCost = sum(
    outsourcingItems.map((item) => decimal(item.amount)),
  );
  const selfTestCost = reagentTotal
    .plus(consumableTotal)
    .plus(laborTotal)
    .plus(otherInternalCost);
  const totalCost = selfTestCost.plus(outsourcingCost);
  const unitSelfTestCost = divideOrZero(selfTestCost, sampleCount);
  const unitOutsourcingCost = divideOrZero(outsourcingCost, sampleCount);
  const unitTotalCost = divideOrZero(totalCost, sampleCount);
  const marketPrice = decimal(input.marketPrice);

  const priceResults = [
    { id: "market", name: "市场指导价", unitPrice: input.marketPrice },
    ...input.priceTiers,
  ].map((tier) => {
    const unitPrice = decimal(tier.unitPrice);
    const grossProfit = unitPrice.minus(unitTotalCost);
    return {
      id: tier.id,
      name: tier.name,
      unitPrice: unitPrice.toString(),
      discount: divideOrZero(unitPrice, marketPrice).times(10).toString(),
      grossProfit: grossProfit.toString(),
      marginRate: divideOrZero(grossProfit, unitPrice).toString(),
    };
  });

  return {
    reagentItems,
    consumableItems,
    laborItems,
    outsourcingItems,
    reagentTotal: reagentTotal.toString(),
    consumableTotal: consumableTotal.toString(),
    laborTotal: laborTotal.toString(),
    otherInternalCost: otherInternalCost.toString(),
    selfTestCost: selfTestCost.toString(),
    outsourcingCost: outsourcingCost.toString(),
    totalCost: totalCost.toString(),
    unitSelfTestCost: unitSelfTestCost.toString(),
    unitOutsourcingCost: unitOutsourcingCost.toString(),
    unitTotalCost: unitTotalCost.toString(),
    priceResults,
  };
}
