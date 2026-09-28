import { describe, expect, it } from "vitest";
import { createDatabase } from "../server/db";
import { ProjectRepository, VersionConflictError } from "../server/project-repository";
import type { ProjectVersionInput } from "../src/domain/types";

function input(code = "LAB-001"): ProjectVersionInput {
  return {
    projectCode: code,
    projectName: "认知障碍检测",
    secondaryProductLine: "神经退行",
    catalog: "经典版",
    launchStatus: "已开展",
    costNote: "",
    sampleCount: 1,
    marketPrice: "1000",
    priceTiers: [{ id: "d", name: "D价", unitPrice: "800" }],
    reagents: [],
    consumablesStatus: "not_applicable",
    consumables: [],
    labor: [
      { group: "样本组", hoursPerSample: "0", hourlyRate: "7.81" },
      { group: "实验组", hoursPerSample: "0", hourlyRate: "9.77" },
      { group: "报告组", hoursPerSample: "0", hourlyRate: "9.77" },
    ],
    outsourcingStatus: "not_applicable",
    outsourcing: [],
    otherCosts: [],
  };
}

describe("ProjectRepository", () => {
  it("软删除项目后可撤回并恢复到汇总", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const draft = repo.createDraft({ projectName: "待删除项目", createdBy: 1 });
    const saved = repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: draft.lockVersion,
      input: { ...draft.input, projectName: "待删除项目" },
      updatedBy: 1,
    });

    expect(repo.listProjects()).toHaveLength(1);
    repo.deleteProject(saved.projectId);
    expect(repo.listProjects()).toHaveLength(0);
    repo.restoreProject(saved.projectId);
    expect(repo.listProjects()).toEqual([
      expect.objectContaining({ projectId: saved.projectId, name: "待删除项目" }),
    ]);
  });

  it("复用空白未命名草稿且不在项目汇总中显示", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const first = repo.createDraft({ projectName: "未命名项目", createdBy: 1 });
    const second = repo.createDraft({ projectName: "未命名项目", createdBy: 1 });

    expect(second.versionId).toBe(first.versionId);
    expect(repo.listProjects()).toEqual([]);

    const emptyRows = repo.saveDraft({
      versionId: first.versionId,
      expectedLockVersion: first.lockVersion,
      input: {
        ...first.input,
        reagents: [{
          name: "", model: "", packageQuantity: "", currentPurchasePrice: "",
          inquiryPurchasePrice: "", baseUsagePerSample: "", batchSampleCount: "",
          standardCurveUsage: "0", qualityControlUsage: "0", controlUsage: "0",
          otherFixedUsage: "0", usageOverride: "", overrideReason: "",
        }],
        consumablesStatus: "applicable",
        consumables: [{
          name: "", model: "", packageQuantity: "", currentPurchasePrice: "",
          inquiryPurchasePrice: "", usagePerSample: "",
        }],
      },
      updatedBy: 1,
    });
    expect(repo.listProjects()).toEqual([]);
    expect(repo.createDraft({ projectName: "未命名项目", createdBy: 1 }).versionId).toBe(first.versionId);

    repo.saveDraft({
      versionId: first.versionId,
      expectedLockVersion: emptyRows.lockVersion,
      input: { ...emptyRows.input, projectName: "已开始填写的项目" },
      updatedBy: 1,
    });
    expect(repo.listProjects()).toEqual([
      expect.objectContaining({ name: "已开始填写的项目", latestVersionId: first.versionId }),
    ]);
  });

  it("完成版本后不可修改，并可复制为新草稿", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const draft = repo.createDraft({ projectName: "认知障碍检测", createdBy: 1 });
    const saved = repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: draft.lockVersion,
      input: input(),
      updatedBy: 1,
    });
    const completed = repo.completeDraft({
      versionId: draft.versionId,
      expectedLockVersion: saved.lockVersion,
      updatedBy: 1,
    });

    expect(completed.status).toBe("completed");
    expect(() => repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: completed.lockVersion,
      input: input(),
      updatedBy: 1,
    })).toThrow("已完成版本不可修改");

    const revision = repo.cloneCompletedVersion(draft.versionId, 1);
    expect(revision.versionNumber).toBe(2);
    expect(revision.status).toBe("draft");
    expect(revision.input.projectCode).toBe("LAB-001");
  });

  it("检测并发保存冲突", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const draft = repo.createDraft({ projectName: "项目A", createdBy: 1 });
    repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: 0,
      input: input(),
      updatedBy: 1,
    });

    expect(() => repo.saveDraft({
      versionId: draft.versionId,
      expectedLockVersion: 0,
      input: input(),
      updatedBy: 1,
    })).toThrow(VersionConflictError);
  });

  it("项目编码在完成版本时必须唯一", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    for (const name of ["项目A", "项目B"]) {
      const draft = repo.createDraft({ projectName: name, createdBy: 1 });
      const saved = repo.saveDraft({
        versionId: draft.versionId,
        expectedLockVersion: 0,
        input: { ...input(), projectName: name },
        updatedBy: 1,
      });
      if (name === "项目A") {
        repo.completeDraft({
          versionId: draft.versionId,
          expectedLockVersion: saved.lockVersion,
          updatedBy: 1,
        });
      } else {
        expect(() => repo.completeDraft({
          versionId: draft.versionId,
          expectedLockVersion: saved.lockVersion,
          updatedBy: 1,
        })).toThrow("项目编码已存在");
      }
    }
  });

  it("允许多个项目不填写项目编码并完成测算", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    for (const name of ["无编码项目A", "无编码项目B"]) {
      const draft = repo.createDraft({ projectName: name, createdBy: 1 });
      const saved = repo.saveDraft({
        versionId: draft.versionId,
        expectedLockVersion: draft.lockVersion,
        input: { ...input(""), projectName: name },
        updatedBy: 1,
      });
      expect(repo.completeDraft({
        versionId: draft.versionId,
        expectedLockVersion: saved.lockVersion,
        updatedBy: 1,
      }).status).toBe("completed");
    }
  });

  it("汇总列表仅取最新已完成版本", () => {
    const repo = new ProjectRepository(createDatabase(":memory:"));
    const first = repo.createDraft({ projectName: "项目A", createdBy: 1 });
    const firstSaved = repo.saveDraft({
      versionId: first.versionId,
      expectedLockVersion: 0,
      input: input(),
      updatedBy: 1,
    });
    repo.completeDraft({ versionId: first.versionId, expectedLockVersion: firstSaved.lockVersion, updatedBy: 1 });
    const second = repo.cloneCompletedVersion(first.versionId, 1);
    const secondSaved = repo.saveDraft({
      versionId: second.versionId,
      expectedLockVersion: second.lockVersion,
      input: { ...second.input, marketPrice: "1200" },
      updatedBy: 1,
    });
    repo.completeDraft({ versionId: second.versionId, expectedLockVersion: secondSaved.lockVersion, updatedBy: 1 });

    const rows = repo.listLatestCompleted({ query: "LAB-001" });
    expect(rows).toHaveLength(1);
    expect(rows[0].versionNumber).toBe(2);
    expect(rows[0].input.marketPrice).toBe("1200");
    expect(rows[0].input.secondaryProductLine).toBe("神经退行");
    expect(rows[0].input.catalog).toBe("经典版");
    expect(rows[0].input.launchStatus).toBe("已开展");
  });
});
