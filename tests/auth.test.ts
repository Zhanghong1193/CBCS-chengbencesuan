import { describe, expect, it } from "vitest";
import { createDatabase } from "../server/db";
import { AuthService } from "../server/auth";

describe("AuthService", () => {
  it("使用加盐密码摘要登录并创建可撤销会话", () => {
    const auth = new AuthService(createDatabase(":memory:"));
    const user = auth.createUser({ username: "admin", displayName: "管理员", password: "Admin123!", role: "admin" });

    expect(auth.login("admin", "wrong")).toBeNull();
    const session = auth.login("admin", "Admin123!");
    expect(session?.user.id).toBe(user.id);
    expect(auth.getSession(session!.token)?.role).toBe("admin");

    auth.logout(session!.token);
    expect(auth.getSession(session!.token)).toBeNull();
  });

  it("拒绝重复用户名和弱密码", () => {
    const auth = new AuthService(createDatabase(":memory:"));
    expect(() => auth.createUser({ username: "a", displayName: "A", password: "123", role: "user" })).toThrow("密码至少需要8位");
    auth.createUser({ username: "user", displayName: "用户", password: "User123!", role: "user" });
    expect(() => auth.createUser({ username: "user", displayName: "用户2", password: "User456!", role: "user" })).toThrow("用户名已存在");
  });
});
