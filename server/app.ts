import express, { type Express, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AppDatabase } from "./db";
import { AuthService, type SessionUser } from "./auth";
import { ProjectRepository, VersionConflictError } from "./project-repository";
import { importProjectWorkbook } from "./import-projects";
import { buildImportTemplate, buildSummaryWorkbook } from "./export-projects";
import type { ProjectVersionInput } from "../src/domain/types";

type AuthedRequest = Request & { user?: SessionUser; sessionToken?: string };

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function createApp(db: AppDatabase): Express {
  const app = express();
  const auth = new AuthService(db);
  const projects = new ProjectRepository(db);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  app.use(express.json({ limit: "2mb" }));

  app.use((request: AuthedRequest, _response, next) => {
    const token = parseCookies(request.headers.cookie).lab_session;
    if (token) {
      request.user = auth.getSession(token) ?? undefined;
      request.sessionToken = token;
    }
    next();
  });

  const requireUser = (request: AuthedRequest, response: Response, next: NextFunction) => {
    if (!request.user) return response.status(401).json({ error: "请先登录" });
    next();
  };
  const requireAdmin = (request: AuthedRequest, response: Response, next: NextFunction) => {
    if (request.user?.role !== "admin") return response.status(403).json({ error: "需要管理员权限" });
    next();
  };

  app.post("/api/auth/login", (request, response) => {
    const session = auth.login(String(request.body?.username ?? ""), String(request.body?.password ?? ""));
    if (!session) return response.status(401).json({ error: "用户名或密码错误" });
    response.setHeader("Set-Cookie", `lab_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
    return response.json(session.user);
  });
  app.post("/api/auth/logout", requireUser, (request: AuthedRequest, response) => {
    if (request.sessionToken) auth.logout(request.sessionToken);
    response.setHeader("Set-Cookie", "lab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    response.status(204).end();
  });
  app.get("/api/auth/me", requireUser, (request: AuthedRequest, response) => response.json(request.user));

  app.get("/api/projects", requireUser, (request, response) => {
    response.json(projects.listProjects({ query: String(request.query.q ?? "") }));
  });
  app.post("/api/projects", requireUser, (request: AuthedRequest, response) => {
    const version = projects.createDraft({
      projectCode: String(request.body?.projectCode ?? ""),
      projectName: String(request.body?.projectName ?? ""),
      createdBy: request.user!.id,
    });
    response.status(201).json(version);
  });
  app.get("/api/projects/import-template", requireUser, async (_request, response) => {
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=project-import-template.xlsx");
    response.send(await buildImportTemplate());
  });
  app.get("/api/projects/:versionId", requireUser, (request, response) => {
    response.json(projects.getVersion(Number(request.params.versionId)));
  });
  app.patch("/api/projects/:versionId", requireUser, (request: AuthedRequest, response) => {
    const version = projects.saveDraft({
      versionId: Number(request.params.versionId),
      expectedLockVersion: Number(request.body?.expectedLockVersion),
      input: request.body?.input as ProjectVersionInput,
      updatedBy: request.user!.id,
    });
    response.json(version);
  });
  app.post("/api/projects/:versionId/complete", requireUser, (request: AuthedRequest, response) => {
    response.json(projects.completeDraft({
      versionId: Number(request.params.versionId),
      expectedLockVersion: Number(request.body?.expectedLockVersion),
      updatedBy: request.user!.id,
    }));
  });
  app.post("/api/projects/:versionId/revise", requireUser, (request: AuthedRequest, response) => {
    response.status(201).json(projects.cloneCompletedVersion(Number(request.params.versionId), request.user!.id));
  });
  app.delete("/api/projects/:projectId", requireUser, (request, response) => {
    projects.deleteProject(Number(request.params.projectId));
    response.status(204).end();
  });
  app.post("/api/projects/:projectId/restore", requireUser, (request, response) => {
    projects.restoreProject(Number(request.params.projectId));
    response.status(204).end();
  });

  app.post("/api/projects/import", requireUser, upload.single("file"), async (request: AuthedRequest, response) => {
    if (!request.file) return response.status(400).json({ error: "请选择Excel文件" });
    response.json(await importProjectWorkbook(request.file.buffer, projects, request.user!.id));
  });
  app.post("/api/projects/export", requireUser, async (request, response) => {
    const projectIds = Array.isArray(request.body?.projectIds)
      ? new Set(request.body.projectIds.map(Number))
      : null;
    const versions = projects.listLatestCompleted({ query: String(request.body?.query ?? "") })
      .filter((version) => !projectIds || projectIds.has(version.projectId));
    const buffer = await buildSummaryWorkbook(versions, {
      fields: Array.isArray(request.body?.fields) ? request.body.fields.map(String) : [],
    });
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=project-summary.xlsx");
    response.send(buffer);
  });

  app.get("/api/admin/price-types", requireUser, (_request, response) => {
    response.json(db.prepare(`SELECT id, name, sort_order AS sortOrder, active, is_market AS isMarket
      FROM price_types ORDER BY sort_order`).all());
  });
  app.post("/api/admin/price-types", requireUser, requireAdmin, (request, response) => {
    const id = String(request.body?.id ?? "").trim();
    const name = String(request.body?.name ?? "").trim();
    if (!id || !name) return response.status(400).json({ error: "价格类型编码和名称不能为空" });
    db.prepare(`INSERT INTO price_types (id, name, sort_order, active, is_market)
      VALUES (?, ?, ?, 1, 0)`).run(id, name, Number(request.body?.sortOrder ?? 100));
    response.status(201).json({ id, name });
  });
  app.patch("/api/admin/price-types/:id", requireUser, requireAdmin, (request, response) => {
    if (request.params.id === "market") return response.status(400).json({ error: "市场指导价不可停用" });
    const name = typeof request.body?.name === "string" ? request.body.name : null;
    const active = typeof request.body?.active === "number" ? request.body.active : null;
    const sortOrder = typeof request.body?.sortOrder === "number" ? request.body.sortOrder : null;
    db.prepare(`UPDATE price_types SET name = COALESCE(?, name), active = COALESCE(?, active),
      sort_order = COALESCE(?, sort_order), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, active, sortOrder, String(request.params.id));
    response.json({ ok: true });
  });
  app.get("/api/admin/labor-rates", requireUser, (_request, response) => {
    response.json(db.prepare(`SELECT group_name AS groupName, hourly_rate AS hourlyRate, sort_order AS sortOrder
      FROM labor_rates ORDER BY sort_order`).all());
  });
  app.patch("/api/admin/labor-rates", requireUser, requireAdmin, (request, response) => {
    const rates = Array.isArray(request.body?.rates) ? request.body.rates : [];
    db.exec("BEGIN IMMEDIATE");
    try {
      const statement = db.prepare(`UPDATE labor_rates SET hourly_rate = ?, updated_at = CURRENT_TIMESTAMP
        WHERE group_name = ?`);
      rates.forEach((rate: { groupName: string; hourlyRate: string }) => statement.run(rate.hourlyRate, rate.groupName));
      db.exec("COMMIT");
      response.json({ ok: true });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  app.get("/api/admin/users", requireUser, requireAdmin, (_request, response) => {
    response.json(db.prepare(`SELECT id, username, display_name AS displayName, role, active
      FROM users ORDER BY created_at`).all());
  });
  app.post("/api/admin/users", requireUser, requireAdmin, (request, response) => {
    response.status(201).json(auth.createUser({
      username: String(request.body?.username ?? ""),
      displayName: String(request.body?.displayName ?? ""),
      password: String(request.body?.password ?? ""),
      role: request.body?.role === "admin" ? "admin" : "user",
    }));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "服务器错误";
    if (error instanceof VersionConflictError) return response.status(409).json({ error: message });
    if (message.includes("未找到")) return response.status(404).json({ error: message });
    if (["不能为空", "必须", "请", "至少", "已存在", "不可"].some((term) => message.includes(term))) {
      return response.status(400).json({ error: message });
    }
    console.error(error);
    return response.status(500).json({ error: message });
  });

  return app;
}
