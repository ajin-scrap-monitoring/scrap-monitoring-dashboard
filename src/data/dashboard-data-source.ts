import type { DashboardData } from "../domain/dashboard";

export type DashboardDataRequestOptions = {
  signal?: AbortSignal;
};

export type DashboardDataUpdateListener = (data: DashboardData) => void;

export interface DashboardDataSource {
  getDashboardData(options?: DashboardDataRequestOptions): Promise<DashboardData>;
  subscribe?(listener: DashboardDataUpdateListener): () => void;
}
