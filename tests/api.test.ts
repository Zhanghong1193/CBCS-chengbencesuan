import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../server/db";
import { AuthService } from "../server/auth";
import { createApp } from "../server/app";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function setup(role: "admin" | "user" = "admin") {
  const db = createDatabase(":memory:");
  new AuthService(db).createUser({
    username: role,
    displayName: role === "admin" ? "管理员" : "普通用户",
    password: "Password123!",
    role,
  });
  const server = createApp(db).listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" ? address!.port : 0}`;
  return { base };
}

async function login(base: string, username: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "Password123!" }),
  });
  return { response, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}

describe("API权限与项目流程", () => {
  it("未登录用户无法读取项目", async () => {
    const { base } = await setup();
    const response = await fetch(`${base}/api/projects`);
    expect(response.status).toBe(401);
  });

  it("普通用户不能修改管理配置", async () => {
    const { base } = await setup("user");
    const { cookie } = await login(base, "user");
    const response = await fetch(`${base}/api/admin/price-types`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: "partner", name: "合作价", sortOrder: 50 }),
    });
    expect(response.status).toBe(403);
  });

  it("可以下载项目汇总测算格式的批量导入模板", async () => {
    const { base } = await setup();
    const { cookie } = await login(base, "admin");
    const response = await fetch(`${base}/api/projects/import-template`, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
  });

  it("完成新建、保存和提交，并返回最新项目列表", async () => {
    const { base } = await setup();
    const { cookie } = await login(base, "admin");
    const createdResponse = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectName: "项目A" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { versionId: number; lockVersion: number; input: Record<string, unknown> };

    const projectInput = {
      ...created.input,
      projectCode: "LAB-API-01",
      projectName: "项目A",
      secondaryProductLine: "神经退行",
      catalog: "经典版",
      launchStatus: "已开展",
      sampleCount: 1,
      marketPrice: "1000",
      priceTiers: [{ id: "d", name: "D价", unitPrice: "800" }],
      consumablesStatus: "not_applicable",
      outsourcingStatus: "not_applicable",
    };
    const savedResponse = await fetch(`${base}/api/projects/${created.versionId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ expectedLockVersion: created.lockVersion, input: projectInput }),
    });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json() as { lockVersion: number };

    const completedResponse = await fetch(`${base}/api/projects/${created.versionId}/complete`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ expectedLockVersion: saved.lockVersion }),
    });
    expect(completedResponse.status).toBe(200);

    const listResponse = await fetch(`${base}/api/projects`, { headers: { cookie } });
    const projects = await listResponse.json() as Array<{ code: string; latestStatus: string }>;
    expect(projects).toEqual([expect.objectContaining({ code: "LAB-API-01", latestStatus: "completed" })]);
  });

  it("旧锁版本保存返回409", async () => {
    const { base } = await setup();
    const { cookie } = await login(base, "admin");
    const created = await (await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectName: "项目A" }),
    })).json() as { versionId: number; lockVersion: number; input: Record<string, unknown> };
    const body = JSON.stringify({ expectedLockVersion: 0, input: { ...created.input, projectName: "项目A-更新" } });
    await fetch(`${base}/api/projects/${created.versionId}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body });
    const conflict = await fetch(`${base}/api/projects/${created.versionId}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body });
    expect(conflict.status).toBe(409);
  });

  it("项目可软删除并通过撤回接口恢复", async () => {
    const { base } = await setup();
    const { cookie } = await login(base, "admin");
    const created = await (await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectName: "待删除项目" }),
    })).json() as { projectId: number; versionId: number; lockVersion: number; input: Record<string, unknown> };
    await fetch(`${base}/api/projects/${created.versionId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        expectedLockVersion: created.lockVersion,
        input: { ...created.input, projectName: "待删除项目" },
      }),
    });

    const deleted = await fetch(`${base}/api/projects/${created.projectId}`, { method: "DELETE", headers: { cookie } });
    expect(deleted.status).toBe(204);
    expect(await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).toEqual([]);

    const restored = await fetch(`${base}/api/projects/${created.projectId}/restore`, { method: "POST", headers: { cookie } });
    expect(restored.status).toBe(204);
    expect(await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).toEqual([
      expect.objectContaining({ projectId: created.projectId, name: "待删除项目" }),
    ]);
  });
});
