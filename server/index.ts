import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app";
import { AuthService } from "./auth";
import { createDatabase } from "./db";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = join(root, "data");
mkdirSync(dataDirectory, { recursive: true });

const databasePath = process.env.DATABASE_PATH || join(dataDirectory, "cost-margin.db");
const db = createDatabase(databasePath);
const auth = new AuthService(db);
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
if (userCount.count === 0) {
  const password = process.env.INITIAL_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  auth.createUser({ username: "admin", displayName: "系统管理员", password, role: "admin" });
  console.log(`[首次启动] 管理员：admin  初始密码：${password}`);
}

const app = createApp(db);
const port = Number(process.env.PORT || 8787);

const isBundledProduction = import.meta.url.replace(/\\/g, "/").endsWith("/dist/server.js");
if (process.env.NODE_ENV === "production" || isBundledProduction) {
  const dist = join(root, "dist", "client");
  app.use(express.static(dist));
  app.use((_request, response) => response.sendFile(join(dist, "index.html")));
} else {
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`成本测算系统已启动：http://localhost:${port}`);
  if (existsSync(databasePath)) console.log(`数据库：${databasePath}`);
});
