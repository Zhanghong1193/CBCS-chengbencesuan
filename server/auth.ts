import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppDatabase } from "./db";

export type UserRole = "admin" | "user";

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expected] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export class AuthService {
  constructor(private readonly db: AppDatabase) {}

  createUser(input: {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
  }): SessionUser {
    if (input.password.length < 8) throw new Error("密码至少需要8位");
    if (!input.username.trim()) throw new Error("请输入用户名");
    try {
      const result = this.db.prepare(`INSERT INTO users
        (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`)
        .run(input.username.trim(), input.displayName.trim(), hashPassword(input.password), input.role);
      return {
        id: Number(result.lastInsertRowid),
        username: input.username.trim(),
        displayName: input.displayName.trim(),
        role: input.role,
      };
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("用户名已存在");
      throw error;
    }
  }

  login(username: string, password: string): { token: string; user: SessionUser } | null {
    const row = this.db.prepare(`SELECT id, username, display_name, password_hash, role
      FROM users WHERE username = ? AND active = 1`).get(username.trim()) as Record<string, unknown> | undefined;
    if (!row || !verifyPassword(password, String(row.password_hash))) return null;
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, Number(row.id), expiresAt);
    return {
      token,
      user: {
        id: Number(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        role: row.role as UserRole,
      },
    };
  }

  getSession(token: string): SessionUser | null {
    const row = this.db.prepare(`SELECT u.id, u.username, u.display_name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`)
      .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
    return row ? {
      id: Number(row.id),
      username: String(row.username),
      displayName: String(row.display_name),
      role: row.role as UserRole,
    } : null;
  }

  logout(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}
