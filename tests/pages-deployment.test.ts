import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GitHub Pages 部署配置", () => {
  it("使用仓库子路径加载路由和静态资源", () => {
    const viteConfig = readFileSync(resolve("vite.config.ts"), "utf8");
    const mainSource = readFileSync(resolve("src/main.tsx"), "utf8");
    const html = readFileSync(resolve("index.html"), "utf8");
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.webmanifest"), "utf8"));

    expect(viteConfig).toContain('process.env.GITHUB_PAGES === "true"');
    expect(viteConfig).toContain('"/CBCS-chengbencesuan/"');
    expect(mainSource).toContain("basename={import.meta.env.BASE_URL}");
    expect(mainSource).toContain('navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)');
    expect(html).toContain("%BASE_URL%favicon.svg");
    expect(html).toContain("%BASE_URL%manifest.webmanifest");
    expect(manifest.start_url).toBe("./");
    expect(manifest.icons[0].src).toBe("favicon.svg");
  });

  it("提供 GitHub Actions 自动发布流程", () => {
    const workflow = readFileSync(resolve(".github/workflows/deploy-pages.yml"), "utf8");

    expect(workflow).toContain("GITHUB_PAGES: true");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("path: ./dist/client");
    expect(workflow).toContain("actions/deploy-pages@");
  });
});
