import { describe, expect, it } from "vitest";
import { calculateProject, choosePurchasePrice } from "../src/domain/calculation";

describe("choosePurchasePrice", () => {
  it("优先使用现有采购价，缺失时使用新询采购价", () => {
    expect(choosePurchasePrice("120", "90").toString()).toBe("120");
    expect(choosePurchasePrice("", "90").toString()).toBe("90");
  });
});

describe("calculateProject", () => {
  it("按批次固定消耗计算试剂每例用量", () => {
    const result = calculateProject({
      sampleCount: 20,
      marketPrice: "1000",
      priceTiers: [],
      reagents: [{
        name: "检测试剂",
        packageQuantity: "48",
        currentPurchasePrice: "4800",
        inquiryPurchasePrice: "",
        baseUsagePerSample: "1",
        batchSampleCount: "20",
        standardCurveUsage: "1",
        qualityControlUsage: "1",
        controlUsage: "1",
        otherFixedUsage: "1",
        usageOverride: "",
        overrideReason: "",
      }],
      consumablesStatus: "not_applicable",
      consumables: [],
      labor: [],
      outsourcingStatus: "not_applicable",
      outsourcing: [],
      otherCosts: [],
    });

    expect(result.reagentItems[0].actualUsagePerSample).toBe("1.2");
    expect(result.reagentTotal).toBe("2400");
    expect(result.unitTotalCost).toBe("120");
  });

  it("复算现有模板示例并输出多档价格结果", () => {
    const result = calculateProject({
      sampleCount: 1,
      marketPrice: "1650",
      priceTiers: [{ id: "d", name: "D价", unitPrice: "990" }],
      reagents: [5280, 4320, 8640, 4320, 4320].map((price, index) => ({
        name: `试剂${index + 1}`,
        packageQuantity: "48",
        currentPurchasePrice: String(price),
        inquiryPurchasePrice: "",
        baseUsagePerSample: "1",
        batchSampleCount: "1",
        standardCurveUsage: "0",
        qualityControlUsage: "0",
        controlUsage: "0",
        otherFixedUsage: "0",
        usageOverride: "1.16",
        overrideReason: "模板已确认用量",
      })),
      consumablesStatus: "not_applicable",
      consumables: [],
      labor: [
        { group: "样本组", hoursPerSample: "0.25", hourlyRate: "7.81" },
        { group: "实验组", hoursPerSample: "0.17", hourlyRate: "9.77" },
        { group: "报告组", hoursPerSample: "0.17", hourlyRate: "9.77" },
      ],
      outsourcingStatus: "not_applicable",
      outsourcing: [],
      otherCosts: [],
    });

    expect(result.reagentTotal).toBe("649.6");
    expect(result.laborTotal).toBe("5.2743");
    expect(result.totalCost).toBe("654.8743");
    expect(result.priceResults[0].grossProfit).toBe("995.1257");
    expect(result.priceResults[0].marginRate).toBe(
      "0.6031064848484848484848484848",
    );
    expect(result.priceResults[1].discount).toBe("6");
    expect(result.priceResults[1].grossProfit).toBe("335.1257");
  });

  it("支持外包、自检拆分和负毛利", () => {
    const result = calculateProject({
      sampleCount: 2,
      marketPrice: "100",
      priceTiers: [],
      reagents: [],
      consumablesStatus: "not_applicable",
      consumables: [],
      labor: [{ group: "报告组", hoursPerSample: "1", hourlyRate: "20" }],
      outsourcingStatus: "applicable",
      outsourcing: [{ name: "外包检测", unitPrice: "100", quantity: "2", note: "" }],
      otherCosts: [{ name: "运营成本", amount: "40" }],
    });

    expect(result.selfTestCost).toBe("80");
    expect(result.outsourcingCost).toBe("200");
    expect(result.unitTotalCost).toBe("140");
    expect(result.priceResults[0].grossProfit).toBe("-40");
    expect(result.priceResults[0].marginRate).toBe("-0.4");
  });
});
