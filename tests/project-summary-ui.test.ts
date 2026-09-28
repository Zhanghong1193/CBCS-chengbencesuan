import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("项目汇总筛选栏", () => {
  it("不显示创建人筛选，但保留创建人表格列", () => {
    const appSource = readFileSync(resolve("src/App.tsx"), "utf8");

    expect(appSource).not.toContain('aria-label="创建人筛选"');
    expect(appSource).not.toContain("全部创建人");
    expect(appSource).toMatch(/<th[^>]*>创建人<\/th>/);
  });
});
