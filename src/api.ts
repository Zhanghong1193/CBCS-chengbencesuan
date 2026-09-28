export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "user";
}

export interface ProjectListItem {
  projectId: number;
  code: string;
  name: string;
  latestStatus: "draft" | "completed";
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
  priceResults: import("./domain/types").PriceResult[];
}

export interface VersionRecord<T> {
  projectId: number;
  versionId: number;
  versionNumber: number;
  status: "draft" | "completed";
  lockVersion: number;
  input: T;
  calculation: import("./domain/types").ProjectCalculationResult | null;
  updatedAt: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "请求失败" }));
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<SessionUser>("/api/auth/me"),
  login: (username: string, password: string) => request<SessionUser>("/api/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  projects: (query = "") => request<ProjectListItem[]>(`/api/projects?q=${encodeURIComponent(query)}`),
  createProject: (projectName: string, projectCode = "") => request<VersionRecord<import("./domain/types").ProjectVersionInput>>("/api/projects", {
    method: "POST", body: JSON.stringify({ projectName, projectCode }),
  }),
  version: (id: number) => request<VersionRecord<import("./domain/types").ProjectVersionInput>>(`/api/projects/${id}`),
  saveVersion: (id: number, expectedLockVersion: number, input: import("./domain/types").ProjectVersionInput) =>
    request<VersionRecord<import("./domain/types").ProjectVersionInput>>(`/api/projects/${id}`, {
      method: "PATCH", body: JSON.stringify({ expectedLockVersion, input }),
    }),
  completeVersion: (id: number, expectedLockVersion: number) =>
    request<VersionRecord<import("./domain/types").ProjectVersionInput>>(`/api/projects/${id}/complete`, {
      method: "POST", body: JSON.stringify({ expectedLockVersion }),
    }),
  reviseVersion: (id: number) => request<VersionRecord<import("./domain/types").ProjectVersionInput>>(`/api/projects/${id}/revise`, { method: "POST" }),
  deleteProject: (id: number) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  restoreProject: (id: number) => request<void>(`/api/projects/${id}/restore`, { method: "POST" }),
  priceTypes: () => request<Array<{ id: string; name: string; sortOrder: number; active: number; isMarket: number }>>("/api/admin/price-types"),
  laborRates: () => request<Array<{ groupName: string; hourlyRate: string; sortOrder: number }>>("/api/admin/labor-rates"),
  users: () => request<Array<{ id: number; username: string; displayName: string; role: string; active: number }>>("/api/admin/users"),
  createUser: (body: unknown) => request("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  createPriceType: (body: unknown) => request("/api/admin/price-types", { method: "POST", body: JSON.stringify(body) }),
  updatePriceType: (id: string, body: unknown) => request(`/api/admin/price-types/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateLaborRates: (rates: unknown[]) => request("/api/admin/labor-rates", { method: "PATCH", body: JSON.stringify({ rates }) }),
};
