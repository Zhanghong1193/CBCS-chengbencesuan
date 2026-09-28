import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../server/db";
import { ProjectRepository } from "../server/project-repository";
import { importProjectWorkbook } from "../server/import-projects";
import { buildImportTemplate, buildSummaryWorkbook } from "../server/export-projects";
import type { ProjectVersionInput } from "../src/domain/types";

async function importBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("项目基础信息");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function completedInput(code: string): ProjectVersionInput {
  return {
    projectCode: code,
    projectName: `项目${code}`,
    secondaryProductLine: "神经退行",
    catalog: "经典版",
    launchStatus: "已开展",
    costNote: "含特殊质控",
    sampleCount: 2,
    marketPrice: "1000",
    priceTiers: [{ id: "d", name: "D价", unitPrice: "800" }],
    reagents: [],
    consumablesStatus: "not_applicable",
    consumables: [],
    labor: [
      { group: "样本组", hoursPerSample: "1", hourlyRate: "10" },
      { group: "实验组", hoursPerSample: "0", hourlyRate: "10" },
      { group: "报告组", hoursPerSample: "0", hourlyRate: "10" },
    ],
    outsourcingStatus: "applicable",
    outsourcing: [{ name: "外包测序", unitPrice: "100", quantity: "2", note: "" }],
    otherCosts: [],
  };
}

describe("项目批量导入", () => {
  it("生成项目汇总测算模板的两级表头", async () => {
    const output = await buildImportTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as never);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining([
      "检测项目", "成本", "市场指导价", "结算价", "毛利", "所属目录", "创建人", "创建时间",
    ]));
    expect(sheet.getRow(2).values).toEqual(expect.arrayContaining([
      "项目编码", "检测项目", "自检", "外包", "累计成本", "KD价", "KD折扣", "D价", "D折扣",
    ]));
    expect(sheet.model.merges).toEqual(expect.arrayContaining(["A1:B1", "C1:E1", "G1:J1", "K1:M1"]));
  });

  it("按汇总模板导入价格、成本和所属目录到草稿", async () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const buffer = await importBuffer([
      ["检测项目", "", "成本", "", "", "市场指导价", "结算价", "", "", "", "毛利", "", "", "所属目录", "创建人", "创建时间"],
      ["项目编码", "检测项目", "自检", "外包", "累计成本", "市场指导价", "KD价", "KD折扣", "D价", "D折扣", "市场指导价", "KD价", "D价", "", "", ""],
      ["LAB-FULL-01", "全外显子组测序", 527.76, 120, 647.76, 4500, 1800, 4, 2250, 5, 0.85, 0.64, 0.71, "经典版", "管理员", "2026-09-26"],
    ]);

    const result = await importProjectWorkbook(buffer, repo, 1);
    expect(result).toEqual({ created: 1, errors: [] });
    const list = repo.listProjects({ query: "LAB-FULL-01" });
    const draft = repo.getVersion(list[0].latestVersionId);
    expect(draft.input.marketPrice).toBe("4500");
    expect(draft.input.priceTiers).toEqual([
      { id: "kd", name: "KD价", unitPrice: "1800" },
      { id: "d", name: "D价", unitPrice: "2250" },
    ]);
    expect(draft.input.otherCosts[0].amount).toBe("527.76");
    expect(draft.input.outsourcing[0].unitPrice).toBe("120");
    expect(draft.input.catalog).toBe("经典版");
  });

  it("部分成功并返回重复编码与空名称错误", async () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    repo.createDraft({ projectCode: "LAB-001", projectName: "已存在", createdBy: 1 });
    const buffer = await importBuffer([
      ["项目编码", "项目名称"],
      ["LAB-001", "重复项目"],
      ["LAB-002", "新项目"],
      ["LAB-003", ""],
    ]);

    const result = await importProjectWorkbook(buffer, repo, 1);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { row: 2, code: "LAB-001", reason: "项目编码已存在" },
      { row: 4, code: "LAB-003", reason: "项目名称不能为空" },
    ]);
    expect(repo.listProjects({ query: "LAB-002" })).toHaveLength(1);
  });
});

describe("项目汇总导出", () => {
  it("按选择字段输出单例成本和价格结果", async () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const draft = repo.createDraft({ projectName: "项目LAB-010", createdBy: 1 });
    const saved = repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: 0,
      input: completedInput("LAB-010"),
      updatedBy: 1,
    });
    repo.completeDraft({ versionId: draft.versionId, expectedLockVersion: saved.lockVersion, updatedBy: 1 });

    const output = await buildSummaryWorkbook(repo.listLatestCompleted(), {
      fields: ["unitTotalCost", "unitSelfTestCost", "unitOutsourcingCost", "costNote", "market", "d"],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);
    const sheet = workbook.getWorksheet("项目汇总")!;
    const headers = sheet.getRow(1).values as unknown[];
    expect(headers).toEqual(expect.arrayContaining([
      "项目编码",
      "项目名称",
      "单例总成本",
      "单例自检成本",
      "单例外包成本",
      "成本组成备注",
      "市场指导价-单价",
      "D价-折扣",
      "D价-单例毛利",
      "D价-毛利率",
    ]));
    expect(sheet.getRow(2).getCell(1).value).toBe("LAB-010");
    expect(sheet.getRow(2).values).toEqual(expect.arrayContaining([110, 10, 100]));
    expect(String(sheet.getRow(2).values)).toContain("外包测序");
  });
});
