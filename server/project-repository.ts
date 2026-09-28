import type { AppDatabase } from "./db";
import { calculateProject } from "../src/domain/calculation";
import { validateForCompletion } from "../src/domain/validation";
import { SECONDARY_PRODUCT_LINES, type ProjectCalculationResult, type ProjectVersionInput } from "../src/domain/types";

export class VersionConflictError extends Error {
  constructor() {
    super("该草稿已被其他人更新，请刷新后重试");
  }
}

export interface VersionRecord {
  projectId: number;
  versionId: number;
  versionNumber: number;
  status: "draft" | "completed";
  lockVersion: number;
  input: ProjectVersionInput;
  calculation: ProjectCalculationResult | null;
  updatedAt: string;
}

function parseVersion(row: Record<string, unknown>): VersionRecord {
  return {
    projectId: Number(row.project_id),
    versionId: Number(row.id),
    versionNumber: Number(row.version_number),
    status: row.status as "draft" | "completed",
    lockVersion: Number(row.lock_version),
    input: JSON.parse(String(row.input_json)) as ProjectVersionInput,
    calculation: row.calculation_json
      ? JSON.parse(String(row.calculation_json)) as ProjectCalculationResult
      : null,
    updatedAt: String(row.updated_at),
  };
}

function isBlankPlaceholder(input: ProjectVersionInput): boolean {
  const hasReagentData = input.reagents.some((item) => [
    item.name, item.model, item.packageQuantity, item.currentPurchasePrice,
    item.inquiryPurchasePrice, item.baseUsagePerSample, item.batchSampleCount,
    item.usageOverride, item.overrideReason,
  ].some((value) => value?.trim()) || [
    item.standardCurveUsage, item.qualityControlUsage, item.controlUsage, item.otherFixedUsage,
  ].some((value) => Number(value) > 0));
  const hasConsumableData = input.consumables.some((item) => [
    item.name, item.model, item.packageQuantity, item.currentPurchasePrice,
    item.inquiryPurchasePrice, item.usagePerSample,
  ].some((value) => value?.trim()));
  const hasOutsourceData = input.outsourcing.some((item) => [
    item.name, item.unitPrice, item.note,
  ].some((value) => value?.trim()) || (item.quantity.trim() !== "" && Number(item.quantity) !== 1));
  const hasOtherCostData = input.otherCosts.some((item) => item.name.trim() || item.amount.trim());

  return !input.projectCode.trim()
    && (!input.projectName.trim() || input.projectName.trim() === "未命名项目")
    && !input.secondaryProductLine?.trim()
    && !input.catalog?.trim()
    && !input.launchStatus?.trim()
    && !input.costNote.trim()
    && Number(input.sampleCount) === 1
    && !String(input.marketPrice).trim()
    && !input.priceTiers.some((tier) => tier.unitPrice.trim())
    && !hasReagentData
    && !hasConsumableData
    && input.labor.every((item) => !item.hoursPerSample.trim() || Number(item.hoursPerSample) === 0)
    && !hasOutsourceData
    && !hasOtherCostData;
}

export class ProjectRepository {
  constructor(private readonly db: AppDatabase) {}

  private defaultInput(projectName: string, projectCode = ""): ProjectVersionInput {
    const labor = this.db.prepare(`SELECT group_name, hourly_rate FROM labor_rates
      ORDER BY sort_order`).all() as Array<Record<string, unknown>>;
    return {
      projectCode,
      projectName,
      secondaryProductLine: "",
      catalog: "",
      launchStatus: "",
      costNote: "",
      sampleCount: 1,
      marketPrice: "",
      priceTiers: [],
      reagents: [],
      consumablesStatus: "pending",
      consumables: [],
      labor: labor.map((row) => ({
        group: String(row.group_name),
        hoursPerSample: "0",
        hourlyRate: String(row.hourly_rate),
      })),
      outsourcingStatus: "pending",
      outsourcing: [],
      otherCosts: [],
    };
  }

  private findReusablePlaceholder(createdBy: number): VersionRecord | null {
    const rows = this.db.prepare(`SELECT v.* FROM project_versions v
      JOIN projects p ON p.id = v.project_id
      WHERE p.created_by = ? AND p.code IS NULL AND p.name = '未命名项目'
        AND p.deleted_at IS NULL
        AND v.status = 'draft'
        AND v.version_number = (
          SELECT MAX(v2.version_number) FROM project_versions v2 WHERE v2.project_id = p.id
        )
      ORDER BY v.updated_at DESC`).all(createdBy) as Array<Record<string, unknown>>;
    return rows.map(parseVersion).find((version) => isBlankPlaceholder(version.input)) ?? null;
  }

  createDraft(input: { projectCode?: string; projectName: string; createdBy: number }): VersionRecord {
    const projectCode = input.projectCode?.trim() || "";
    const projectName = input.projectName.trim() || "未命名项目";
    const transaction = () => {
      if (!projectCode && projectName === "未命名项目") {
        const reusable = this.findReusablePlaceholder(input.createdBy);
        if (reusable) return reusable;
      }
      let project;
      try {
        project = this.db.prepare(`INSERT INTO projects (code, name, created_by)
          VALUES (?, ?, ?)`).run(
          projectCode || null,
          projectName,
          input.createdBy,
        );
      } catch (error) {
        if (String(error).includes("UNIQUE")) throw new Error("项目编码已存在");
        throw error;
      }
      const projectId = Number(project.lastInsertRowid);
      const versionInput = this.defaultInput(projectName, projectCode);
      const version = this.db.prepare(`INSERT INTO project_versions
        (project_id, version_number, status, input_json, created_by, updated_by)
        VALUES (?, 1, 'draft', ?, ?, ?)`)
        .run(projectId, JSON.stringify(versionInput), input.createdBy, input.createdBy);
      return this.getVersion(Number(version.lastInsertRowid));
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = transaction();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getVersion(versionId: number): VersionRecord {
    const row = this.db.prepare("SELECT * FROM project_versions WHERE id = ?")
      .get(versionId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("未找到项目版本");
    return parseVersion(row);
  }

  saveDraft(input: {
    versionId: number;
    expectedLockVersion: number;
    input: ProjectVersionInput;
    updatedBy: number;
  }): VersionRecord {
    const existing = this.getVersion(input.versionId);
    if (existing.status !== "draft") throw new Error("已完成版本不可修改");
    const result = this.db.prepare(`UPDATE project_versions SET
      input_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP,
      lock_version = lock_version + 1
      WHERE id = ? AND status = 'draft' AND lock_version = ?`)
      .run(JSON.stringify(input.input), input.updatedBy, input.versionId, input.expectedLockVersion);
    if (result.changes !== 1) throw new VersionConflictError();
    this.db.prepare("UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.input.projectName.trim() || "未命名项目", existing.projectId);
    return this.getVersion(input.versionId);
  }

  completeDraft(input: {
    versionId: number;
    expectedLockVersion: number;
    updatedBy: number;
  }): VersionRecord {
    const version = this.getVersion(input.versionId);
    if (version.status !== "draft") throw new Error("该版本已经完成");
    if (version.lockVersion !== input.expectedLockVersion) throw new VersionConflictError();
    const issues = validateForCompletion(version.input);
    if (issues.length) throw new Error(issues[0].message);
    const projectCode = version.input.projectCode.trim();
    if (projectCode) {
      const duplicate = this.db.prepare("SELECT id FROM projects WHERE code = ? AND id != ?")
        .get(projectCode, version.projectId);
      if (duplicate) throw new Error("项目编码已存在");
    }
    const calculation = calculateProject(version.input);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`UPDATE projects SET code = ?, name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`).run(
        projectCode || null,
        version.input.projectName.trim(),
        version.projectId,
      );
      const result = this.db.prepare(`UPDATE project_versions SET
        status = 'completed', calculation_json = ?, updated_by = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        lock_version = lock_version + 1
        WHERE id = ? AND status = 'draft' AND lock_version = ?`)
        .run(JSON.stringify(calculation), input.updatedBy, input.versionId, input.expectedLockVersion);
      if (result.changes !== 1) throw new VersionConflictError();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getVersion(input.versionId);
  }

  cloneCompletedVersion(versionId: number, userId: number): VersionRecord {
    const source = this.getVersion(versionId);
    if (source.status !== "completed") throw new Error("只能从已完成版本创建修订");
    const next = this.db.prepare(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next
      FROM project_versions WHERE project_id = ?`).get(source.projectId) as { next: number };
    const result = this.db.prepare(`INSERT INTO project_versions
      (project_id, version_number, status, input_json, created_by, updated_by)
      VALUES (?, ?, 'draft', ?, ?, ?)`)
      .run(source.projectId, next.next, JSON.stringify(source.input), userId, userId);
    return this.getVersion(Number(result.lastInsertRowid));
  }

  deleteProject(projectId: number): void {
    const result = this.db.prepare(`UPDATE projects
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL`).run(projectId);
    if (result.changes !== 1) throw new Error("项目不存在或已被删除");
  }

  restoreProject(projectId: number): void {
    const result = this.db.prepare(`UPDATE projects
      SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NOT NULL`).run(projectId);
    if (result.changes !== 1) throw new Error("项目不存在或无需恢复");
  }

  listLatestCompleted(filters: { query?: string } = {}): VersionRecord[] {
    const query = `%${filters.query?.trim() ?? ""}%`;
    const rows = this.db.prepare(`SELECT v.* FROM project_versions v
      JOIN projects p ON p.id = v.project_id
      WHERE v.status = 'completed' AND p.deleted_at IS NULL
        AND v.version_number = (
          SELECT MAX(v2.version_number) FROM project_versions v2
          WHERE v2.project_id = v.project_id AND v2.status = 'completed'
        )
        AND (COALESCE(p.code, '') LIKE ? OR p.name LIKE ?)
      ORDER BY p.updated_at DESC`).all(query, query) as Array<Record<string, unknown>>;
    return rows.map(parseVersion);
  }

  listProjects(filters: { query?: string } = {}): Array<{
    projectId: number;
    code: string;
    name: string;
    latestStatus: string;
    latestVersionId: number;
    versionNumber: number;
    updatedAt: string;
    createdBy: string;
    unitTotalCost: string | null;
    unitSelfTestCost: string | null;
    unitOutsourcingCost: string | null;
    marketMarginRate: string | null;
    costType: string;
    secondaryProductLine: string;
    catalog: string;
    launchStatus: string;
    createdAt: string;
    priceResults: ProjectCalculationResult["priceResults"];
  }> {
    const query = `%${filters.query?.trim() ?? ""}%`;
    const rows = this.db.prepare(`SELECT p.id AS projectId, COALESCE(p.code, '') AS code,
      p.name, v.status AS latestStatus, v.id AS latestVersionId,
      v.version_number AS versionNumber, v.updated_at AS updatedAt,
      COALESCE(u.display_name, '') AS createdBy, p.created_at AS createdAt,
      v.input_json AS latestInput, cv.input_json AS completedInput,
      cv.calculation_json AS completedCalculation
      FROM projects p JOIN project_versions v ON v.id = (
        SELECT id FROM project_versions v2 WHERE v2.project_id = p.id
        ORDER BY v2.version_number DESC LIMIT 1
      ) LEFT JOIN project_versions cv ON cv.id = (
        SELECT id FROM project_versions v3 WHERE v3.project_id = p.id AND v3.status = 'completed'
        ORDER BY v3.version_number DESC LIMIT 1
      ) LEFT JOIN users u ON u.id = p.created_by
      WHERE p.deleted_at IS NULL
        AND (COALESCE(p.code, '') LIKE ? OR p.name LIKE ?)
      ORDER BY p.updated_at DESC`).all(query, query) as Array<Record<string, unknown>>;
    return rows.filter((row) => {
      if (String(row.latestStatus) !== "draft") return true;
      return !isBlankPlaceholder(JSON.parse(String(row.latestInput)) as ProjectVersionInput);
    }).map((row) => {
      const calculation = row.completedCalculation
        ? JSON.parse(String(row.completedCalculation)) as ProjectCalculationResult
        : null;
      const market = calculation?.priceResults.find((price) => price.id === "market");
      const latestInput = JSON.parse(String(row.latestInput)) as ProjectVersionInput;
      const completedInput = row.completedInput
        ? JSON.parse(String(row.completedInput)) as ProjectVersionInput
        : null;
      const self = Number(calculation?.unitSelfTestCost ?? 0);
      const outsource = Number(calculation?.unitOutsourcingCost ?? 0);
      const latestLegacyCatalog = latestInput.catalog ?? "";
      const completedLegacyCatalog = completedInput?.catalog ?? "";
      const secondaryProductLine = latestInput.secondaryProductLine
        || (SECONDARY_PRODUCT_LINES.includes(latestLegacyCatalog as typeof SECONDARY_PRODUCT_LINES[number]) ? latestLegacyCatalog : "")
        || completedInput?.secondaryProductLine
        || (SECONDARY_PRODUCT_LINES.includes(completedLegacyCatalog as typeof SECONDARY_PRODUCT_LINES[number]) ? completedLegacyCatalog : "");
      const catalog = SECONDARY_PRODUCT_LINES.includes(latestLegacyCatalog as typeof SECONDARY_PRODUCT_LINES[number])
        ? ""
        : latestLegacyCatalog || completedLegacyCatalog;
      return {
        projectId: Number(row.projectId), code: String(row.code), name: String(row.name),
        latestStatus: String(row.latestStatus), latestVersionId: Number(row.latestVersionId),
        versionNumber: Number(row.versionNumber), updatedAt: String(row.updatedAt),
        createdBy: String(row.createdBy), unitTotalCost: calculation?.unitTotalCost ?? null,
        unitSelfTestCost: calculation?.unitSelfTestCost ?? null,
        unitOutsourcingCost: calculation?.unitOutsourcingCost ?? null,
        marketMarginRate: market?.marginRate ?? null,
        costType: self > 0 && outsource > 0 ? "自检+外包" : outsource > 0 ? "外包" : self > 0 ? "自检" : "待测算",
        secondaryProductLine,
        catalog,
        launchStatus: latestInput.launchStatus ?? completedInput?.launchStatus ?? "",
        createdAt: String(row.createdAt),
        priceResults: calculation?.priceResults ?? [],
      };
    });
  }
}
