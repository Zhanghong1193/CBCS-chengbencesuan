import ExcelJS from "exceljs";
import type { ProjectRepository } from "./project-repository";

export interface ImportErrorRow {
  row: number;
  code: string;
  reason: string;
}

function cellValue(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) {
    return String(value.result ?? "").trim();
  }
  return String(value ?? "").trim();
}

export async function importProjectWorkbook(
  buffer: Uint8Array,
  repository: ProjectRepository,
  userId: number,
): Promise<{ created: number; errors: ImportErrorRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Excel中没有可读取的工作表");

  const isSummaryTemplate = cellValue(sheet.getCell("A1")) === "检测项目"
    && cellValue(sheet.getCell("A2")) === "项目编码";
  const headerRowNumber = isSummaryTemplate ? 2 : 1;
  const header = sheet.getRow(headerRowNumber);
  const columns = new Map<string, number>();
  header.eachCell((cell, column) => columns.set(cellValue(cell), column));
  const codeColumn = columns.get("项目编码");
  const nameColumn = columns.get("检测项目") ?? columns.get("项目名称");
  if (!codeColumn || !nameColumn) throw new Error("模板必须包含项目编码和项目名称");

  let created = 0;
  const errors: ImportErrorRow[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const code = cellValue(row.getCell(codeColumn));
    const name = cellValue(row.getCell(nameColumn));
    if (!code && !name) continue;
    if (!code) {
      errors.push({ row: rowNumber, code: "", reason: "项目编码不能为空" });
      continue;
    }
    if (!name) {
      errors.push({ row: rowNumber, code, reason: "项目名称不能为空" });
      continue;
    }
    try {
      const draft = repository.createDraft({ projectCode: code, projectName: name, createdBy: userId });
      if (isSummaryTemplate) {
        const selfCost = cellValue(row.getCell(3));
        const outsourceCost = cellValue(row.getCell(4));
        const marketPrice = cellValue(row.getCell(6));
        const kdPrice = cellValue(row.getCell(7));
        const dPrice = cellValue(row.getCell(9));
        const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0;
        const input = {
          ...draft.input,
          projectCode: code,
          projectName: name,
          catalog: cellValue(row.getCell(14)),
          costNote: "由项目汇总测算模板批量导入，成本为汇总金额。",
          sampleCount: 1,
          marketPrice,
          priceTiers: [
            ...(positive(kdPrice) ? [{ id: "kd", name: "KD价", unitPrice: kdPrice }] : []),
            ...(positive(dPrice) ? [{ id: "d", name: "D价", unitPrice: dPrice }] : []),
          ],
          consumablesStatus: "not_applicable" as const,
          outsourcingStatus: positive(outsourceCost) ? "applicable" as const : "not_applicable" as const,
          outsourcing: positive(outsourceCost)
            ? [{ name: "批量导入外包成本", unitPrice: outsourceCost, quantity: "1", note: "来源：项目汇总测算模板" }]
            : [],
          otherCosts: positive(selfCost)
            ? [{ name: "批量导入自检成本", amount: selfCost }]
            : [],
        };
        repository.saveDraft({
          versionId: draft.versionId,
          expectedLockVersion: draft.lockVersion,
          input,
          updatedBy: userId,
        });
      }
      created += 1;
    } catch (error) {
      errors.push({ row: rowNumber, code, reason: error instanceof Error ? error.message : "导入失败" });
    }
  }
  return { created, errors };
}
