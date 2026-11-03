// 적재율 그래프의 시뮬레이션 표기. 값이 있는 표본의 서버 simulated 값만 근거로 쓰고 결측 표본은 판단에서 뺀다.
export function simulationLabel(samples: ReadonlyArray<{ value: number | null; simulated?: boolean }>): "시뮬레이션" | "시뮬레이션 포함" | null {
  const plotted = samples.filter((sample) => sample.value !== null);
  const simulated = plotted.filter((sample) => sample.simulated === true).length;
  if (simulated === 0) return null;
  return simulated === plotted.length ? "시뮬레이션" : "시뮬레이션 포함";
}
