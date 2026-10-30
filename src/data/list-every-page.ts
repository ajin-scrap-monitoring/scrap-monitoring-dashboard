type Page = { readonly items: readonly unknown[]; readonly page: { readonly totalPages: number } };
type PagedRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

// 관리자와 녹화 화면의 전체 페이지 조회이다. 두 화면의 모듈이 함께 쓴다.
export async function listEveryPage<TItem>(request: PagedRequest, path: string, signal?: AbortSignal) {
  const items: TItem[] = [];
  let page = 1;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await request<Page>(`${path}${separator}page=${page}&pageSize=100`, { signal });
    items.push(...result.items as readonly TItem[]);
    if (page >= result.page.totalPages) break;
    page += 1;
  }
  return items;
}
