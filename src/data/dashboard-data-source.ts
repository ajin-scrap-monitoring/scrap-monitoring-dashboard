import type { DashboardData } from "../domain/dashboard";

export interface DashboardDataSource {
  getDashboardData(): Promise<DashboardData>;
}
