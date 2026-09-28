import { describe, expect, it } from "vitest";
import { validateForCompletion } from "../src/domain/validation";
import type { ProjectVersionInput } from "../src/domain/types";

function validInput(): ProjectVersionInput {
  return {
    projectCode: "LAB-001",
    projectName: "认知障碍检测",
    secondaryProductLine: "神经退行",
    catalog: "经典版",
    launchStatus: "已开展",
    costNote: "",
    sampleCount: 10,
    marketPrice: "1000",
    priceTiers: [{ id: "d", name: "D价", unitPrice: "800" }],
    reagents: [{
      name: "检测试剂",
      model: "48T",
      packageQuantity: "48",
      currentPurchasePrice: "4800",
      inquiryPurchasePrice: "",
      baseUsagePerSample: "1",
      batchSampleCount: "20",
      standardCurveUsage: "1",
      qualityControlUsage: "1",
      controlUsage: "0",
      otherFixedUsage: "0",
      usageOverride: "",
      overrideReason: "",
    }],
    consumablesStatus: "not_applicable",
    consumables: [],
    labor: [
      { group: "样本组", hoursPerSample: "0.2", hourlyRate: "7.81" },
      { group: "实验组", hoursPerSample: "0.3", hourlyRate: "9.77" },
      { group: "报告组", hoursPerSample: "0.1", hourlyRate: "9.77" },
    ],
    outsourcingStatus: "not_applicable",
    outsourcing: [],
    otherCosts: [],
  };
}

describe("validateForCompletion", () => {
  it("允许项目只使用市场指导价而不选择其他价格档位", () => {
    const input = validInput();
    input.priceTiers = [];
    expect(validateForCompletion(input)).toEqual([]);
  });

  it("接受完整测算，即使其中一个档位为负毛利", () => {
    const input = validInput();
    input.priceTiers[0].unitPrice = "10";
    expect(validateForCompletion(input)).toEqual([]);
  });

  it("阻止缺少基础信息和非正数价格的项目完成", () => {
    const input = validInput();
    input.projectCode = "";
    input.projectName = "";
    input.secondaryProductLine = "";
    input.catalog = "";
    input.launchStatus = "";
    input.sampleCount = 0;
    input.marketPrice = "0";
    input.priceTiers[0].unitPrice = "";

    const fields = validateForCompletion(input).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining([
      "projectName",
      "secondaryProductLine",
      "catalog",
      "launchStatus",
      "sampleCount",
      "marketPrice",
      "priceTiers.d",
    ]));
    expect(fields).not.toContain("projectCode");
  });

  it("区分未确认、不涉及和涉及但无明细", () => {
    const pending = validInput();
    pending.consumablesStatus = "pending";
    pending.outsourcingStatus = "pending";
    expect(validateForCompletion(pending).map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["consumablesStatus", "outsourcingStatus"]),
    );

    const applicable = validInput();
    applicable.consumablesStatus = "applicable";
    applicable.outsourcingStatus = "applicable";
    expect(validateForCompletion(applicable).map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["consumables", "outsourcing"]),
    );
  });

  it("校验试剂除数、采购价和用量调整原因", () => {
    const input = validInput();
    const reagent = input.reagents[0];
    reagent.packageQuantity = "0";
    reagent.currentPurchasePrice = "";
    reagent.inquiryPurchasePrice = "";
    reagent.batchSampleCount = "0";
    reagent.usageOverride = "1.2";
    reagent.overrideReason = "";

    const fields = validateForCompletion(input).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining([
      "reagents.0.packageQuantity",
      "reagents.0.purchasePrice",
      "reagents.0.batchSampleCount",
      "reagents.0.overrideReason",
    ]));
  });
});
