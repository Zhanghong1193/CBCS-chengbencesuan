import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import type { VersionRecord } from "./project-repository";

export interface ExportOptions {
  fields: string[];
}

export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "检测项目成本与毛利测算系统";
  const sheet = workbook.addWorksheet("项目汇总测算", { views: [{ state: "frozen", ySplit: 2, xSplit: 2 }] });
  const widths = [22, 42, 14, 14, 14, 16, 14, 12, 14, 12, 16, 14, 14, 16, 16, 22];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.addRow(["检测项目", "", "成本", "", "", "市场指导价", "结算价", "", "", "", "毛利", "", "", "所属目录", "创建人", "创建时间"]);
  sheet.addRow(["项目编码", "检测项目", "自检", "外包", "累计成本", "市场指导价", "KD价", "KD折扣", "D价", "D折扣", "市场指导价", "KD价", "D价", "", "", ""]);
  sheet.mergeCells("A1:B1"); sheet.mergeCells("C1:E1"); sheet.mergeCells("G1:J1"); sheet.mergeCells("K1:M1");
  sheet.mergeCells("N1:N2"); sheet.mergeCells("O1:O2"); sheet.mergeCells("P1:P2");
  sheet.getRow(1).height = 25; sheet.getRow(2).height = 25;
  for (const row of [sheet.getRow(1), sheet.getRow(2)]) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } };
    row.alignment = { vertical: "middle", horizontal: "center" };
  }
  sheet.autoFilter = { from: "A2", to: "P2" };
  sheet.getColumn(3).numFmt = "#,##0.00"; sheet.getColumn(4).numFmt = "#,##0.00"; sheet.getColumn(5).numFmt = "#,##0.00";
  sheet.getColumn(6).numFmt = "#,##0.00"; sheet.getColumn(7).numFmt = "#,##0.00"; sheet.getColumn(9).numFmt = "#,##0.00";
  sheet.getColumn(8).numFmt = '0.0"折"'; sheet.getColumn(10).numFmt = '0.0"折"';
  sheet.getColumn(11).numFmt = "0.00%"; sheet.getColumn(12).numFmt = "0.00%"; sheet.getColumn(13).numFmt = "0.00%";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function money(value: string): number {
  return new Decimal(value || 0).toDecimalPlaces(2).toNumber();
}

function costNote(version: VersionRecord): string {
  const calculation = version.calculation!;
  const selfParts = [
    ["试剂", calculation.reagentTotal],
    ["耗材", calculation.consumableTotal],
    ["人工", calculation.laborTotal],
    ["其他", calculation.otherInternalCost],
  ]
    .filter(([, amount]) => !new Decimal(amount).isZero())
    .map(([name, amount]) => `${name}${money(new Decimal(amount).div(version.input.sampleCount).toString()).toFixed(2)}元`)
    .join("、");
  const outsourceNames = version.input.outsourcing.map((item) => item.name).filter(Boolean).join("、");
  const parts = [
    `自检${money(calculation.unitSelfTestCost).toFixed(2)}元${selfParts ? `（${selfParts}）` : ""}`,
    `外包${money(calculation.unitOutsourcingCost).toFixed(2)}元${outsourceNames ? `（${outsourceNames}）` : ""}`,
  ];
  if (version.input.costNote.trim()) parts.push(`补充：${version.input.costNote.trim()}`);
  return parts.join("；");
}

export async function buildSummaryWorkbook(
  versions: VersionRecord[],
  options: ExportOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "检测项目成本与毛利测算系统";
  const sheet = workbook.addWorksheet("项目汇总", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
  });

  const columns: Array<{ header: string; key: string; width: number }> = [
    { header: "项目编码", key: "projectCode", width: 20 },
    { header: "项目名称", key: "projectName", width: 36 },
  ];
  const costFields: Record<string, { header: string; width: number }> = {
    unitTotalCost: { header: "单例总成本", width: 15 },
    unitSelfTestCost: { header: "单例自检成本", width: 15 },
    unitOutsourcingCost: { header: "单例外包成本", width: 15 },
    costNote: { header: "成本组成备注", width: 48 },
  };
  Object.entries(costFields).forEach(([key, config]) => {
    if (options.fields.includes(key)) columns.push({ ...config, key });
  });

  const tiers = new Map<string, { name: string; suffixes: Set<string> }>();
  versions.forEach((version) => version.calculation?.priceResults.forEach((tier) => {
    const legacySelection = options.fields.includes(tier.id);
    const suffixes = ["unitPrice", "discount", "grossProfit", "marginRate"]
      .filter((suffix) => legacySelection || options.fields.includes(`price:${tier.id}:${suffix}`));
    if (suffixes.length) tiers.set(tier.id, { name: tier.name, suffixes: new Set(suffixes) });
  }));
  tiers.forEach(({ name, suffixes }, id) => {
    if (suffixes.has("unitPrice")) columns.push({ header: `${name}-单价`, key: `${id}_price`, width: 14 });
    if (suffixes.has("discount")) columns.push({ header: `${name}-折扣`, key: `${id}_discount`, width: 12 });
    if (suffixes.has("grossProfit")) columns.push({ header: `${name}-单例毛利`, key: `${id}_profit`, width: 15 });
    if (suffixes.has("marginRate")) columns.push({ header: `${name}-毛利率`, key: `${id}_margin`, width: 13 });
  });
  sheet.columns = columns;

  versions.forEach((version) => {
    const calculation = version.calculation!;
    const row: Record<string, unknown> = {
      projectCode: version.input.projectCode,
      projectName: version.input.projectName,
      unitTotalCost: money(calculation.unitTotalCost),
      unitSelfTestCost: money(calculation.unitSelfTestCost),
      unitOutsourcingCost: money(calculation.unitOutsourcingCost),
      costNote: costNote(version),
    };
    calculation.priceResults.forEach((tier) => {
      const selected = tiers.get(tier.id);
      if (!selected) return;
      if (selected.suffixes.has("unitPrice")) row[`${tier.id}_price`] = money(tier.unitPrice);
      if (selected.suffixes.has("discount")) row[`${tier.id}_discount`] = new Decimal(tier.discount).toDecimalPlaces(1).toNumber();
      if (selected.suffixes.has("grossProfit")) row[`${tier.id}_profit`] = money(tier.grossProfit);
      if (selected.suffixes.has("marginRate")) row[`${tier.id}_margin`] = new Decimal(tier.marginRate).toDecimalPlaces(4).toNumber();
    });
    sheet.addRow(row);
  });

  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B5B" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(columns.length).address };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", wrapText: rowNumber > 1 };
    row.eachCell((cell) => {
      if (rowNumber > 1 && typeof cell.value === "number") {
        cell.numFmt = "#,##0.00";
      }
    });
  });
  columns.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    if (column.key.endsWith("_margin")) col.numFmt = "0.00%";
    if (column.key.endsWith("_discount")) col.numFmt = '0.0"折"';
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
