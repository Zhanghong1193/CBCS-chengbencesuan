import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BadgeDollarSign, Beaker, Boxes, ChevronRight, ClipboardList, Download, FileUp,
  FlaskConical, LogOut, Menu, Plus, Save, Search, Settings, ShieldCheck, Trash2,
  Undo2, UserRound, Users, X,
} from "lucide-react";
import { api, type ProjectListItem, type SessionUser, type VersionRecord } from "./api";
import { calculateProject } from "./domain/calculation";
import { validateForCompletion } from "./domain/validation";
import type {
  ApplicabilityStatus, ConsumableItem, OtherCostItem, OutsourceItem, PriceTierInput,
  ProjectCalculationResult, ProjectVersionInput, ReagentItem,
} from "./domain/types";
import { PROJECT_CATALOGS, PROJECT_LAUNCH_STATUSES, SECONDARY_PRODUCT_LINES } from "./domain/types";

type Notice = { kind: "success" | "error"; text: string } | null;
type PriceType = { id: string; name: string; sortOrder: number; active: number; isMarket: number };

const money = (value: string | number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: string) => `${(Number(value || 0) * 100).toFixed(2)}%`;
const discount = (value: string) => `${Number(value || 0).toFixed(1)}折`;
const id = () => crypto.randomUUID();

function normalizeProjectInput(input: ProjectVersionInput): ProjectVersionInput {
  const legacyCatalog = input.catalog ?? "";
  if (!input.secondaryProductLine && SECONDARY_PRODUCT_LINES.includes(legacyCatalog as typeof SECONDARY_PRODUCT_LINES[number])) {
    return { ...input, secondaryProductLine: legacyCatalog, catalog: "", launchStatus: input.launchStatus ?? "" };
  }
  return { ...input, secondaryProductLine: input.secondaryProductLine ?? "", launchStatus: input.launchStatus ?? "" };
}

function NoticeBar({ notice, clear }: { notice: Notice; clear: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clear, 3600);
    return () => window.clearTimeout(timer);
  }, [notice, clear]);
  if (!notice) return null;
  return <button className={`notice ${notice.kind}`} onClick={clear}>{notice.text}<X size={16} /></button>;
}

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { onLogin(await api.login(username, password)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败"); }
    finally { setLoading(false); }
  }
  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark"><FlaskConical /></div>
      <p>第三方检测实验室内部工具</p>
      <h1>检测项目成本与毛利测算</h1>
      <div className="login-metric"><span>统一口径</span><strong>成本、价格、毛利与版本</strong></div>
    </section>
    <form className="login-form" onSubmit={submit}>
      <div><span className="eyebrow">内部系统</span><h2>账号登录</h2><p>使用管理员分配的账号进入工作台。</p></div>
      <label>用户名<input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
      <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {error && <p className="field-error">{error}</p>}
      <button className="primary wide" disabled={loading}>{loading ? "正在登录…" : "登录"}<ChevronRight size={18} /></button>
    </form>
  </main>;
}

function Shell({ user, onLogout, children }: { user: SessionUser; onLogout: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-brand"><button className="icon-btn mobile-only" onClick={() => setOpen(!open)} aria-label="打开菜单"><Menu /></button><div className="brand-mark small"><FlaskConical /></div><strong>成本测算</strong></div>
      <div className="user-chip"><UserRound size={16} /><span>{user.displayName}</span><small>{user.role === "admin" ? "管理员" : "普通用户"}</small></div>
    </header>
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <nav onClick={() => setOpen(false)}>
        <NavLink to="/projects" end><ClipboardList />项目汇总</NavLink>
        <NavLink to="/projects/new" className={location.pathname.startsWith("/projects/") ? "active" : undefined}><Plus />新建测算</NavLink>
        {user.role === "admin" && <NavLink to="/admin"><Settings />管理设置</NavLink>}
      </nav>
      <button className="logout" onClick={onLogout}><LogOut />退出登录</button>
    </aside>
    <div className="content">{children}</div>
    {open && <button className="nav-backdrop" onClick={() => setOpen(false)} aria-label="关闭菜单" />}
  </div>;
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="header-actions">{actions}</div></div>;
}

function Projects({ notify }: { notify: (n: Notice) => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [query, setQuery] = useState("");
  const [launchStatusFilter, setLaunchStatusFilter] = useState("all");
  const [costFilter, setCostFilter] = useState("all");
  const [marginFilter, setMarginFilter] = useState("all");
  const [productLineFilter, setProductLineFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [importResult, setImportResult] = useState<{ created: number; errors: Array<{ row: number; code: string; reason: string }> } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [deletedProject, setDeletedProject] = useState<{ id: number; name: string } | null>(() => {
    try { return JSON.parse(sessionStorage.getItem("lastDeletedProject") ?? "null"); }
    catch { return null; }
  });
  const load = useCallback(async () => setItems(await api.projects(query)), [query]);
  useEffect(() => { void load(); }, [load]);
  const visibleItems = useMemo(() => items.filter((item) => {
    if (launchStatusFilter !== "all" && item.launchStatus !== launchStatusFilter) return false;
    if (costFilter !== "all" && item.costType !== costFilter) return false;
    if (productLineFilter !== "all" && item.secondaryProductLine !== productLineFilter) return false;
    if (dateFrom && new Date(`${item.updatedAt}Z`) < new Date(`${dateFrom}T00:00:00`)) return false;
    const margin = item.marketMarginRate === null ? null : Number(item.marketMarginRate);
    if (marginFilter === "gte80" && (margin === null || margin < .8)) return false;
    if (marginFilter === "60to80" && (margin === null || margin < .6 || margin >= .8)) return false;
    if (marginFilter === "lt60" && (margin === null || margin >= .6)) return false;
    return true;
  }), [items, launchStatusFilter, costFilter, marginFilter, productLineFilter, dateFrom]);
  async function importFile(file?: File) {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    const response = await fetch("/api/projects/import", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) return notify({ kind: "error", text: result.error || "导入失败" });
    setImportResult(result); await load(); notify({ kind: "success", text: `成功导入 ${result.created} 个项目草稿` });
  }
  function downloadImportErrors() {
    if (!importResult?.errors.length) return;
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = ["行号,项目编码,失败原因", ...importResult.errors.map((e) => [e.row, e.code, e.reason].map(escape).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "项目导入错误清单.csv"; link.click(); URL.revokeObjectURL(url);
  }
  async function deleteProject(item: ProjectListItem) {
    if (!window.confirm(`确认删除项目“${item.name}”吗？删除后可通过“撤回删除”恢复。`)) return;
    try {
      await api.deleteProject(item.projectId);
      const deleted = { id: item.projectId, name: item.name };
      setDeletedProject(deleted); sessionStorage.setItem("lastDeletedProject", JSON.stringify(deleted));
      setItems((current) => current.filter((project) => project.projectId !== item.projectId));
      notify({ kind: "success", text: `已删除“${item.name}”，可点击撤回删除恢复` });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : "删除失败" });
    }
  }
  async function restoreDeletedProject() {
    if (!deletedProject) return;
    try {
      await api.restoreProject(deletedProject.id); await load();
      sessionStorage.removeItem("lastDeletedProject"); setDeletedProject(null);
      notify({ kind: "success", text: `已恢复“${deletedProject.name}”` });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : "恢复失败" });
    }
  }
  return <>
    <PageHeader title="项目汇总" subtitle="查看项目最新版本，快速进入测算或导出统一口径数据。" actions={<>
      <a className="secondary" href="/api/projects/import-template"><Download size={17} />下载模板</a>
      <label className="secondary file-button"><FileUp size={17} />批量导入<input type="file" accept=".xlsx" onChange={(e) => void importFile(e.target.files?.[0])} /></label>
      <button className="secondary" onClick={() => setExportOpen(true)}><Download size={17} />导出</button>
      <button className="secondary" disabled={!deletedProject} onClick={() => void restoreDeletedProject()} title={deletedProject ? `恢复：${deletedProject.name}` : "暂无可恢复项目"}><Undo2 size={17} />撤回删除</button>
      <button className="primary" onClick={() => navigate("/projects/new")}><Plus size={17} />新建项目</button>
    </>} />
    <section className="toolbar-band">
      <label className="search-box"><Search size={18} /><input placeholder="搜索项目编码或名称" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="summary-filters"><select aria-label="开展状态筛选" value={launchStatusFilter} onChange={(e) => setLaunchStatusFilter(e.target.value)}><option value="all">全部开展状态</option>{PROJECT_LAUNCH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="成本类型筛选" value={costFilter} onChange={(e) => setCostFilter(e.target.value)}><option value="all">全部成本类型</option><option value="自检">自检</option><option value="外包">外包</option><option value="自检+外包">自检+外包</option></select><select aria-label="毛利率筛选" value={marginFilter} onChange={(e) => setMarginFilter(e.target.value)}><option value="all">全部毛利率</option><option value="gte80">80%以上</option><option value="60to80">60%-80%</option><option value="lt60">60%以下</option></select><select aria-label="二级产品线筛选" value={productLineFilter} onChange={(e) => setProductLineFilter(e.target.value)}><option value="all">全部二级产品线</option>{SECONDARY_PRODUCT_LINES.map((line) => <option key={line} value={line}>{line}</option>)}</select><label className="date-filter"><span>更新自</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label></div>
      <div className="stat-line"><strong>{visibleItems.length}</strong><span>个项目</span></div>
    </section>
    {importResult && <section className="import-result"><div><strong>导入结果</strong><span>成功 {importResult.created} 条，失败 {importResult.errors.length} 条</span></div>{importResult.errors.length > 0 && <><div className="error-list">{importResult.errors.map((e) => <span key={e.row}>第 {e.row} 行 · {e.code || "无编码"} · {e.reason}</span>)}</div><button className="text-button" onClick={downloadImportErrors}><Download />下载错误清单</button></>}<button className="icon-btn" onClick={() => setImportResult(null)} aria-label="关闭"><X /></button></section>}
    <section className="table-wrap">
      <table className="summary-table"><thead><tr className="group-head"><th colSpan={2}>检测项目</th><th colSpan={3}>成本</th><th rowSpan={2}>市场指导价</th><th colSpan={4}>结算价</th><th colSpan={3}>毛利</th><th rowSpan={2}>所属目录</th><th rowSpan={2}>创建人</th><th rowSpan={2}>创建时间</th><th rowSpan={2}>操作</th></tr><tr><th>项目编码</th><th>检测项目</th><th>自检</th><th>外包</th><th>累计成本</th><th>KD价</th><th>KD折扣</th><th>D价</th><th>D折扣</th><th>市场指导价</th><th>KD价</th><th>D价</th></tr></thead>
        <tbody>{visibleItems.map((item) => {
          const market = item.priceResults.find((price) => price.id === "market");
          const kd = item.priceResults.find((price) => price.id === "kd");
          const d = item.priceResults.find((price) => price.id === "d");
          const price = (row: typeof market) => row ? `¥ ${money(row.unitPrice)}` : "";
          const rate = (row: typeof market) => row ? percent(row.marginRate) : "";
          return <tr key={item.projectId} onClick={() => navigate(`/projects/${item.latestVersionId}`)}>
            <td className="mono">{item.code || <span className="muted">待填写</span>}</td><td><strong>{item.name}</strong></td>
            <td>{item.unitSelfTestCost === null ? "" : `¥ ${money(item.unitSelfTestCost)}`}</td><td>{item.unitOutsourcingCost === null ? "" : `¥ ${money(item.unitOutsourcingCost)}`}</td><td>{item.unitTotalCost === null ? "" : `¥ ${money(item.unitTotalCost)}`}</td>
            <td>{price(market)}</td><td>{price(kd)}</td><td>{kd ? discount(kd.discount) : ""}</td><td>{price(d)}</td><td>{d ? discount(d.discount) : ""}</td>
            <td className={market && Number(market.marginRate) < 0 ? "negative-text" : ""}>{rate(market)}</td><td className={kd && Number(kd.marginRate) < 0 ? "negative-text" : ""}>{rate(kd)}</td><td className={d && Number(d.marginRate) < 0 ? "negative-text" : ""}>{rate(d)}</td>
            <td>{item.catalog || "—"}</td><td>{item.createdBy || "—"}</td><td>{new Date(`${item.createdAt}Z`).toLocaleString("zh-CN", { hour12: false })}</td><td className="table-action"><button className="icon-btn danger" title="删除项目" aria-label={`删除 ${item.name}`} onClick={(event) => { event.stopPropagation(); void deleteProject(item); }}><Trash2 size={17} /></button><ChevronRight size={18} /></td>
          </tr>;
        })}</tbody></table>
      {visibleItems.length === 0 && <div className="empty"><ClipboardList /><strong>暂无匹配项目</strong><span>新建项目或调整筛选条件。</span></div>}
    </section>
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} query={query} projectIds={visibleItems.map((item) => item.projectId)} notify={notify} />}
  </>;
}

const exportFields = [
  ["unitTotalCost", "单例总成本"], ["unitSelfTestCost", "单例自检成本"],
  ["unitOutsourcingCost", "单例外包成本"], ["costNote", "成本组成备注"],
] as const;

function ExportDialog({ onClose, query, projectIds, notify }: { onClose: () => void; query: string; projectIds: number[]; notify: (n: Notice) => void }) {
  const [priceTypes, setPriceTypes] = useState<PriceType[]>([]);
  const [fields, setFields] = useState<string[]>(exportFields.map(([key]) => key));
  useEffect(() => { void api.priceTypes().then(setPriceTypes); }, []);
  function toggle(key: string) { setFields((old) => old.includes(key) ? old.filter((x) => x !== key) : [...old, key]); }
  async function download() {
    const response = await fetch("/api/projects/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, projectIds, fields }) });
    if (!response.ok) return notify({ kind: "error", text: (await response.json()).error || "导出失败" });
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
    link.href = url; link.download = `项目毛利汇总-${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url);
    notify({ kind: "success", text: "汇总表已导出" }); onClose();
  }
  return <div className="modal-backdrop"><section className="modal"><header><div><h2>自选字段导出</h2><p>项目编码和项目名称固定导出。</p></div><button className="icon-btn" onClick={onClose}><X /></button></header>
    <h3>成本字段</h3><div className="check-grid">{exportFields.map(([key, label]) => <label key={key}><input type="checkbox" checked={fields.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</div>
    <h3>价格档位</h3><div className="check-grid">{priceTypes.filter((p) => p.active).map((p) => ["unitPrice", "discount", "grossProfit", "marginRate"].map((suffix) => {
      const key = `price:${p.id}:${suffix}`; const names: Record<string, string> = { unitPrice: "单价", discount: "折扣", grossProfit: "单例毛利", marginRate: "毛利率" };
      return <label key={key}><input type="checkbox" checked={fields.includes(key)} onChange={() => toggle(key)} />{p.name} · {names[suffix]}</label>;
    }))}</div>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => void download()}><Download size={17} />导出 Excel</button></footer>
  </section></div>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b>*</b>}{hint && <small>{hint}</small>}</span>{children}</label>;
}
function Section({ icon, title, note, children }: { icon: ReactNode; title: string; note?: string; children: ReactNode }) {
  return <section className="form-section"><header><div className="section-icon">{icon}</div><div><h2>{title}</h2>{note && <p>{note}</p>}</div></header>{children}</section>;
}
function NumberInput({ value, onChange, placeholder = "0", disabled }: { value: string | number; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return <input type="number" min="0" step="any" inputMode="decimal" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}
function Applicability({ value, onChange }: { value: ApplicabilityStatus; onChange: (v: ApplicabilityStatus) => void }) {
  return <div className="segmented"><button className={value === "applicable" ? "active" : ""} onClick={() => onChange("applicable")}>涉及</button><button className={value === "not_applicable" ? "active" : ""} onClick={() => onChange("not_applicable")}>不涉及</button></div>;
}

const newReagent = (): ReagentItem => ({ id: id(), name: "", model: "", packageQuantity: "", currentPurchasePrice: "", inquiryPurchasePrice: "", baseUsagePerSample: "", batchSampleCount: "", standardCurveUsage: "0", qualityControlUsage: "0", controlUsage: "0", otherFixedUsage: "0", usageOverride: "", overrideReason: "" });
const newConsumable = (): ConsumableItem => ({ id: id(), name: "", model: "", packageQuantity: "", currentPurchasePrice: "", inquiryPurchasePrice: "", usagePerSample: "" });
const newOutsource = (): OutsourceItem => ({ id: id(), name: "", unitPrice: "", quantity: "1", note: "" });
const newOther = (): OtherCostItem => ({ id: id(), name: "", amount: "" });

function ResultsPanel({ result, mobile, close }: { result: ProjectCalculationResult; mobile?: boolean; close?: () => void }) {
  return <aside className={`results-panel ${mobile ? "mobile-results" : ""}`}>
    <header><div><span>实时测算</span><h2>单例成本 <strong>¥ {money(result.unitTotalCost)}</strong></h2></div>{close && <button className="icon-btn" onClick={close}><X /></button>}</header>
    <div className="cost-strip"><div><span>自检</span><strong>¥ {money(result.unitSelfTestCost)}</strong></div><div><span>外包</span><strong>¥ {money(result.unitOutsourcingCost)}</strong></div></div>
    <div className="result-list">{result.priceResults.map((row) => <article key={row.id} className={Number(row.grossProfit) < 0 ? "negative" : ""}>
      <div><strong>{row.name}</strong><span>¥ {money(row.unitPrice)} · {discount(row.discount)}</span></div><div><span>单例毛利</span><strong>¥ {money(row.grossProfit)}</strong></div><div><span>毛利率</span><strong>{percent(row.marginRate)}</strong></div>
    </article>)}</div>
    <dl><div><dt>试剂合计</dt><dd>¥ {money(result.reagentTotal)}</dd></div><div><dt>耗材合计</dt><dd>¥ {money(result.consumableTotal)}</dd></div><div><dt>人工合计</dt><dd>¥ {money(result.laborTotal)}</dd></div><div><dt>其他内部成本</dt><dd>¥ {money(result.otherInternalCost)}</dd></div><div><dt>外包成本</dt><dd>¥ {money(result.outsourcingCost)}</dd></div></dl>
  </aside>;
}

function ProjectEditor({ notify }: { notify: (n: Notice) => void }) {
  const { versionId } = useParams(); const navigate = useNavigate();
  const isNew = versionId === "new";
  const [record, setRecord] = useState<VersionRecord<ProjectVersionInput> | null>(null);
  const [input, setInput] = useState<ProjectVersionInput | null>(null);
  const [priceTypes, setPriceTypes] = useState<PriceType[]>([]);
  const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [mobileResult, setMobileResult] = useState(false);
  const initialized = useRef(false);
  const update = useCallback((recipe: (draft: ProjectVersionInput) => ProjectVersionInput) => { setInput((old) => old ? recipe(old) : old); setDirty(true); }, []);
  useEffect(() => {
    void Promise.all([api.priceTypes(), isNew ? api.createProject("未命名项目") : api.version(Number(versionId))]).then(([prices, version]) => {
      setPriceTypes(prices); setRecord(version); setInput(normalizeProjectInput(version.input)); initialized.current = true;
      if (isNew) navigate(`/projects/${version.versionId}`, { replace: true });
    }).catch((e) => notify({ kind: "error", text: e.message }));
  }, [isNew, navigate, notify, versionId]);
  const result = useMemo(() => input ? calculateProject(input) : null, [input]);
  const save = useCallback(async (silent = false) => {
    if (!record || !input || record.status !== "draft") return record;
    setSaving(true);
    try { const next = await api.saveVersion(record.versionId, record.lockVersion, input); setRecord(next); setDirty(false); if (!silent) notify({ kind: "success", text: "草稿已保存" }); return next; }
    catch (e) { notify({ kind: "error", text: e instanceof Error ? e.message : "保存失败" }); return null; }
    finally { setSaving(false); }
  }, [input, notify, record]);
  useEffect(() => {
    if (!initialized.current || !dirty || record?.status !== "draft") return;
    const timer = window.setTimeout(() => void save(true), 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, input, record?.status, save]);
  async function complete() {
    if (!record || !input) return;
    const issues = validateForCompletion(input);
    if (issues.length) return notify({ kind: "error", text: `${issues[0].message}（另有 ${issues.length - 1} 项待完善）` });
    const saved = dirty ? await save(true) : record; if (!saved) return;
    try { const done = await api.completeVersion(saved.versionId, saved.lockVersion); setRecord(done); setInput(done.input); notify({ kind: "success", text: `V${done.versionNumber} 已完成并锁定` }); }
    catch (e) { notify({ kind: "error", text: e instanceof Error ? e.message : "完成失败" }); }
  }
  async function revise() { if (!record) return; const next = await api.reviseVersion(record.versionId); navigate(`/projects/${next.versionId}`); }
  if (!input || !record || !result) return <div className="loading">正在读取项目…</div>;
  const readonly = record.status === "completed";
  const set = <K extends keyof ProjectVersionInput>(key: K, value: ProjectVersionInput[K]) => update((old) => ({ ...old, [key]: value }));
  const updateRow = <T,>(rows: T[], index: number, key: keyof T, value: unknown): T[] => rows.map((row, i) => i === index ? { ...row, [key]: value } : row);
  return <>
    <PageHeader title={input.projectName || "未命名项目"} subtitle={`V${record.versionNumber} · ${readonly ? "已完成版本（只读）" : saving ? "正在自动保存…" : dirty ? "有未保存更改" : "草稿已保存"}`} actions={<>
      {!readonly && <button className="secondary" onClick={() => void save()}><Save size={17} />保存草稿</button>}
      {!readonly && <button className="primary" onClick={() => void complete()}><ShieldCheck size={17} />完成测算</button>}
      {readonly && <button className="primary" onClick={() => void revise()}><Plus size={17} />创建修订</button>}
    </>} />
    <div className={`editor-layout ${readonly ? "readonly" : ""}`}><div className="editor-form"><fieldset disabled={readonly}>
      <Section icon={<ClipboardList />} title="基本信息" note="项目编码选填；填写后不可与现有项目重复。"><div className="field-grid three"><Field label="项目编码"><input value={input.projectCode} onChange={(e) => set("projectCode", e.target.value)} placeholder="选填，例如：JY-2026-001" /></Field><Field label="项目名称" required><input value={input.projectName} onChange={(e) => set("projectName", e.target.value)} /></Field><Field label="二级产品线" required><select value={input.secondaryProductLine ?? ""} onChange={(e) => set("secondaryProductLine", e.target.value)}><option value="">请选择二级产品线</option>{input.secondaryProductLine && !SECONDARY_PRODUCT_LINES.includes(input.secondaryProductLine as typeof SECONDARY_PRODUCT_LINES[number]) && <option value={input.secondaryProductLine}>{input.secondaryProductLine}（历史值）</option>}{SECONDARY_PRODUCT_LINES.map((line) => <option key={line} value={line}>{line}</option>)}</select></Field><Field label="送检例数" required><NumberInput value={input.sampleCount} onChange={(v) => set("sampleCount", Number(v))} /></Field><Field label="所属目录" required><select value={input.catalog ?? ""} onChange={(e) => set("catalog", e.target.value)}><option value="">请选择所属目录</option>{input.catalog && !PROJECT_CATALOGS.includes(input.catalog as typeof PROJECT_CATALOGS[number]) && <option value={input.catalog}>{input.catalog}（历史值）</option>}{PROJECT_CATALOGS.map((catalog) => <option key={catalog} value={catalog}>{catalog}</option>)}</select></Field><Field label="开展状态" required><select value={input.launchStatus ?? ""} onChange={(e) => set("launchStatus", e.target.value)}><option value="">请选择开展状态</option>{input.launchStatus && !PROJECT_LAUNCH_STATUSES.includes(input.launchStatus as typeof PROJECT_LAUNCH_STATUSES[number]) && <option value={input.launchStatus}>{input.launchStatus}（历史值）</option>}{PROJECT_LAUNCH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></Field></div></Section>
      <Section icon={<BadgeDollarSign />} title="价格设置" note="市场指导价为折扣基准，所有销售价格均按不含税单价填写。"><div className="price-grid"><Field label="市场指导价" required><NumberInput value={input.marketPrice} onChange={(v) => set("marketPrice", v)} /></Field>{priceTypes.filter((p) => !p.isMarket && p.active).map((tier) => {
        const selected = input.priceTiers.find((p) => p.id === tier.id);
        return <div className="tier-field" key={tier.id}><label className="switch-row"><input type="checkbox" checked={Boolean(selected)} onChange={(e) => set("priceTiers", e.target.checked ? [...input.priceTiers, { id: tier.id, name: tier.name, unitPrice: "" }] : input.priceTiers.filter((p) => p.id !== tier.id))} /><span>{tier.name}</span></label>{selected ? <NumberInput value={selected.unitPrice} onChange={(v) => set("priceTiers", input.priceTiers.map((p) => p.id === tier.id ? { ...p, unitPrice: v } : p))} /> : <div className="price-empty">未选择</div>}</div>;
      })}</div></Section>
      <Section icon={<Beaker />} title="试剂成本" note="采购价优先取现有价；批次固定消耗会自动分摊到每例。"><LineHeader action={() => set("reagents", [...input.reagents, newReagent()])} label="添加试剂" />{input.reagents.length === 0 && <InlineEmpty text="尚未添加试剂" />}{input.reagents.map((row, index) => <div className="line-item" key={row.id ?? index}><div className="line-title"><strong>试剂 {index + 1}</strong><button className="icon-btn danger" onClick={() => set("reagents", input.reagents.filter((_, i) => i !== index))}><Trash2 /></button></div><div className="field-grid four"><Field label="试剂名称" required><input value={row.name} onChange={(e) => set("reagents", updateRow(input.reagents, index, "name", e.target.value))} /></Field><Field label="试剂编码"><input value={row.model} onChange={(e) => set("reagents", updateRow(input.reagents, index, "model", e.target.value))} /></Field><Field label="包装可检测数量" required><NumberInput value={row.packageQuantity} onChange={(v) => set("reagents", updateRow(input.reagents, index, "packageQuantity", v))} /></Field><Field label="现有采购价（含税）"><NumberInput value={row.currentPurchasePrice} onChange={(v) => set("reagents", updateRow(input.reagents, index, "currentPurchasePrice", v))} /></Field><Field label="新询采购价（含税）"><NumberInput value={row.inquiryPurchasePrice} onChange={(v) => set("reagents", updateRow(input.reagents, index, "inquiryPurchasePrice", v))} /></Field><Field label="每例基础用量"><NumberInput value={row.baseUsagePerSample} onChange={(v) => set("reagents", updateRow(input.reagents, index, "baseUsagePerSample", v))} /></Field><Field label="批量样本数" required><NumberInput value={row.batchSampleCount} onChange={(v) => set("reagents", updateRow(input.reagents, index, "batchSampleCount", v))} /></Field><Field label="标准曲线用量"><NumberInput value={row.standardCurveUsage} onChange={(v) => set("reagents", updateRow(input.reagents, index, "standardCurveUsage", v))} /></Field><Field label="质控用量"><NumberInput value={row.qualityControlUsage} onChange={(v) => set("reagents", updateRow(input.reagents, index, "qualityControlUsage", v))} /></Field><Field label="对照用量"><NumberInput value={row.controlUsage} onChange={(v) => set("reagents", updateRow(input.reagents, index, "controlUsage", v))} /></Field><Field label="其他固定消耗"><NumberInput value={row.otherFixedUsage} onChange={(v) => set("reagents", updateRow(input.reagents, index, "otherFixedUsage", v))} /></Field><Field label="实际用量调整" hint="留空则自动计算"><NumberInput value={row.usageOverride} onChange={(v) => set("reagents", updateRow(input.reagents, index, "usageOverride", v))} /></Field>{row.usageOverride && <Field label="调整原因" required><input value={row.overrideReason} onChange={(e) => set("reagents", updateRow(input.reagents, index, "overrideReason", e.target.value))} /></Field>}</div></div>)}</Section>
      <Section icon={<Boxes />} title="耗材成本" note="需明确选择是否涉及耗材，避免漏填被当成零成本。"><div className="section-control"><Applicability value={input.consumablesStatus} onChange={(v) => { set("consumablesStatus", v); if (v === "not_applicable") set("consumables", []); }} />{input.consumablesStatus === "applicable" && <button className="text-button" onClick={() => set("consumables", [...input.consumables, newConsumable()])}><Plus />添加耗材</button>}</div>{input.consumablesStatus === "not_applicable" && <InlineEmpty text="已确认：不涉及耗材成本" />}{input.consumables.map((row, index) => <div className="line-item compact" key={row.id ?? index}><div className="field-grid six"><Field label="耗材名称" required><input value={row.name} onChange={(e) => set("consumables", updateRow(input.consumables, index, "name", e.target.value))} /></Field><Field label="耗材编码"><input value={row.model} onChange={(e) => set("consumables", updateRow(input.consumables, index, "model", e.target.value))} /></Field><Field label="包装数量" required><NumberInput value={row.packageQuantity} onChange={(v) => set("consumables", updateRow(input.consumables, index, "packageQuantity", v))} /></Field><Field label="现有采购价"><NumberInput value={row.currentPurchasePrice} onChange={(v) => set("consumables", updateRow(input.consumables, index, "currentPurchasePrice", v))} /></Field><Field label="新询采购价"><NumberInput value={row.inquiryPurchasePrice} onChange={(v) => set("consumables", updateRow(input.consumables, index, "inquiryPurchasePrice", v))} /></Field><Field label="每例实际用量" required><NumberInput value={row.usagePerSample} onChange={(v) => set("consumables", updateRow(input.consumables, index, "usagePerSample", v))} /></Field></div><button className="icon-btn danger line-delete" onClick={() => set("consumables", input.consumables.filter((_, i) => i !== index))}><Trash2 /></button></div>)}</Section>
      <Section icon={<Users />} title="实验室人工" note="工序用时为每例工时，单位工时价来自管理员配置并固化在当前版本。"><div className="labor-grid">{input.labor.map((row, index) => <div key={row.group}><span>{row.group}</span><Field label="每例工序用时（小时）"><NumberInput value={row.hoursPerSample} onChange={(v) => set("labor", updateRow(input.labor, index, "hoursPerSample", v))} /></Field><Field label="单位工时价"><NumberInput disabled value={row.hourlyRate} onChange={() => {}} /></Field><strong>¥ {money(result.laborItems[index]?.amount ?? "0")}</strong></div>)}</div></Section>
      <Section icon={<Boxes />} title="外包成本" note="外包成本与自检成本分开展示，并共同计入总成本。"><div className="section-control"><Applicability value={input.outsourcingStatus} onChange={(v) => { set("outsourcingStatus", v); if (v === "not_applicable") set("outsourcing", []); }} />{input.outsourcingStatus === "applicable" && <button className="text-button" onClick={() => set("outsourcing", [...input.outsourcing, newOutsource()])}><Plus />添加外包服务</button>}</div>{input.outsourcingStatus === "not_applicable" && <InlineEmpty text="已确认：不涉及外包成本" />}{input.outsourcing.map((row, index) => <div className="line-item compact" key={row.id ?? index}><div className="field-grid four"><Field label="服务名称" required><input value={row.name} onChange={(e) => set("outsourcing", updateRow(input.outsourcing, index, "name", e.target.value))} /></Field><Field label="单价" required><NumberInput value={row.unitPrice} onChange={(v) => set("outsourcing", updateRow(input.outsourcing, index, "unitPrice", v))} /></Field><Field label="数量" required><NumberInput value={row.quantity} onChange={(v) => set("outsourcing", updateRow(input.outsourcing, index, "quantity", v))} /></Field><Field label="备注"><input value={row.note} onChange={(e) => set("outsourcing", updateRow(input.outsourcing, index, "note", e.target.value))} /></Field></div><button className="icon-btn danger line-delete" onClick={() => set("outsourcing", input.outsourcing.filter((_, i) => i !== index))}><Trash2 /></button></div>)}</Section>
      <Section icon={<Plus />} title="其他内部成本" note="选填，例如设备折旧、运输或特殊处理费用。"><LineHeader action={() => set("otherCosts", [...input.otherCosts, newOther()])} label="添加成本" />{input.otherCosts.map((row, index) => <div className="line-item compact" key={row.id ?? index}><div className="field-grid two"><Field label="成本名称" required><input value={row.name} onChange={(e) => set("otherCosts", updateRow(input.otherCosts, index, "name", e.target.value))} /></Field><Field label="金额" required><NumberInput value={row.amount} onChange={(v) => set("otherCosts", updateRow(input.otherCosts, index, "amount", v))} /></Field></div><button className="icon-btn danger line-delete" onClick={() => set("otherCosts", input.otherCosts.filter((_, i) => i !== index))}><Trash2 /></button></div>)}<Field label="成本备注" hint="系统导出时会自动生成成本组成，此处用于补充特殊说明。"><textarea rows={3} value={input.costNote} onChange={(e) => set("costNote", e.target.value)} /></Field></Section>
    </fieldset></div><ResultsPanel result={result} /></div>
    <button className="mobile-result-button" onClick={() => setMobileResult(true)}><BadgeDollarSign />查看实时结果 <strong>¥ {money(result.unitTotalCost)}/例</strong></button>
    {mobileResult && <div className="mobile-panel-backdrop"><ResultsPanel result={result} mobile close={() => setMobileResult(false)} /></div>}
  </>;
}

function LineHeader({ action, label }: { action: () => void; label: string }) { return <div className="line-header"><button className="text-button" onClick={action}><Plus />{label}</button></div>; }
function InlineEmpty({ text }: { text: string }) { return <div className="inline-empty"><span>{text}</span></div>; }

function Admin({ notify }: { notify: (n: Notice) => void }) {
  const [prices, setPrices] = useState<PriceType[]>([]); const [rates, setRates] = useState<Array<{ groupName: string; hourlyRate: string; sortOrder: number }>>([]); const [users, setUsers] = useState<Array<{ id: number; username: string; displayName: string; role: string; active: number }>>([]);
  const [newPrice, setNewPrice] = useState({ id: "", name: "" }); const [newUser, setNewUser] = useState({ username: "", displayName: "", password: "", role: "user" });
  const load = useCallback(async () => { const [p, r, u] = await Promise.all([api.priceTypes(), api.laborRates(), api.users()]); setPrices(p); setRates(r); setUsers(u); }, []);
  useEffect(() => { void load(); }, [load]);
  async function addPrice() { try { await api.createPriceType({ ...newPrice, sortOrder: prices.length * 10 + 10 }); setNewPrice({ id: "", name: "" }); await load(); notify({ kind: "success", text: "价格类型已新增" }); } catch (e) { notify({ kind: "error", text: e instanceof Error ? e.message : "新增失败" }); } }
  async function addUser() { try { await api.createUser(newUser); setNewUser({ username: "", displayName: "", password: "", role: "user" }); await load(); notify({ kind: "success", text: "账号已创建" }); } catch (e) { notify({ kind: "error", text: e instanceof Error ? e.message : "创建失败" }); } }
  return <><PageHeader title="管理设置" subtitle="配置价格类型、人工工时价和系统账号。历史完成版本不会随配置变化。" />
    <div className="admin-grid"><section className="admin-section"><header><BadgeDollarSign /><div><h2>价格类型</h2><p>市场指导价固定作为折扣基准。</p></div></header><div className="settings-list">{prices.map((p, i) => <div key={p.id}><div><strong>{p.name}</strong><small>{p.id}{p.isMarket ? " · 折扣基准" : ""}</small></div><label className="toggle"><input type="checkbox" checked={Boolean(p.active)} disabled={Boolean(p.isMarket)} onChange={async (e) => { await api.updatePriceType(p.id, { active: e.target.checked ? 1 : 0 }); await load(); }} /><span /></label></div>)}</div><div className="add-row"><input placeholder="编码，如 hospital" value={newPrice.id} onChange={(e) => setNewPrice({ ...newPrice, id: e.target.value })} /><input placeholder="显示名称" value={newPrice.name} onChange={(e) => setNewPrice({ ...newPrice, name: e.target.value })} /><button className="secondary" onClick={() => void addPrice()}><Plus />新增</button></div></section>
      <section className="admin-section"><header><Users /><div><h2>人工工时价</h2><p>新建项目时自动带入，完成后固化。</p></div></header><div className="rate-list">{rates.map((r, i) => <Field key={r.groupName} label={`${r.groupName}（元/小时）`}><NumberInput value={r.hourlyRate} onChange={(v) => setRates(rates.map((x, n) => n === i ? { ...x, hourlyRate: v } : x))} /></Field>)}</div><button className="secondary" onClick={async () => { await api.updateLaborRates(rates); notify({ kind: "success", text: "人工工时价已保存" }); }}><Save />保存工时价</button></section>
      <section className="admin-section full"><header><UserRound /><div><h2>账号管理</h2><p>普通用户可维护共享项目，管理员可同时维护系统配置。</p></div></header><div className="user-list">{users.map((u) => <div key={u.id}><span className="avatar">{u.displayName.slice(0, 1)}</span><div><strong>{u.displayName}</strong><small>{u.username}</small></div><span className={`status ${u.role === "admin" ? "completed" : "draft"}`}>{u.role === "admin" ? "管理员" : "普通用户"}</span></div>)}</div><div className="add-user"><input placeholder="用户名" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} /><input placeholder="姓名" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} /><input type="password" placeholder="初始密码（至少8位）" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}><option value="user">普通用户</option><option value="admin">管理员</option></select><button className="primary" onClick={() => void addUser()}><Plus />创建账号</button></div></section>
    </div></>;
}

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null); const [checking, setChecking] = useState(true); const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => { api.me().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false)); }, []);
  const notify = useCallback((next: Notice) => setNotice(next), []);
  if (checking) return <div className="loading">正在连接成本测算系统…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Shell user={user} onLogout={async () => { await api.logout(); setUser(null); }}><NoticeBar notice={notice} clear={() => setNotice(null)} /><Routes><Route path="/" element={<Navigate to="/projects" replace />} /><Route path="/projects" element={<Projects notify={notify} />} /><Route path="/projects/:versionId" element={<ProjectEditor notify={notify} />} /><Route path="/admin" element={user.role === "admin" ? <Admin notify={notify} /> : <Navigate to="/projects" replace />} /><Route path="*" element={<Navigate to="/projects" replace />} /></Routes></Shell>;
}
