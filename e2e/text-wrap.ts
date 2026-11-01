import type { Page } from "@playwright/test";

// 표시 중인 버튼 문구에서 한 단어가 두 줄 이상에 걸쳐 그려지는 버튼의 문구를 모은다.
export function brokenWordButtons(page: Page): Promise<string[]> {
  return page.locator("button, a.primary-button").evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return [];
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (const word of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const lines = new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top)));
        if (lines.size > 1) broken.push(`${element.textContent?.trim()} (${word[0]})`);
      }
    }
    return broken;
  }));
}
