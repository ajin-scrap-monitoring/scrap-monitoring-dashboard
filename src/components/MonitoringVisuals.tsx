import { useState } from "react";

import type { DashboardData, LidarProfile } from "../domain/dashboard";
import { SectionTitle } from "./DashboardPrimitives";

function clockAt(timestamp: number, reference: string) {
  const match = reference.match(/(Z|([+-])(\d{2}):(\d{2}))$/i);
  const offsetMinutes = match?.[1].toUpperCase() === "Z"
    ? 0
    : match ? (match[2] === "-" ? -1 : 1) * (Number(match[3]) * 60 + Number(match[4])) : 0;
  const date = new Date(timestamp + offsetMinutes * 60_000);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function contiguousSegments<T>(items: readonly T[], isValid: (item: T) => boolean) {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (isValid(item)) {
      current.push(item);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function MeasurementDiagram({ lidar1Color, lidar2Color }: { lidar1Color: string; lidar2Color: string }) {
  const lidar1Points = "74.75,153 126,151 158,164 187,171 205,186 226,193 243.24,207";
  const lidar2Points = "252,102.93 245,132 231,159 211,191 190,226.72";
  return (
    <svg className="measurement-svg" viewBox="0 0 440 275" role="img" aria-label="LiDAR 1과 LiDAR 2 측정선 배치">
      <defs>
        <clipPath id="scrapSurface">
          <path d="M52 181 218 236 332 105 281 84 186 146 104 117Z" />
        </clipPath>
        <pattern id="scrapFrontFill" width="18" height="14" patternUnits="userSpaceOnUse">
          <rect width="18" height="14" fill="#87949e" />
          <path d="M1 4l7 2m3-4 5 3M4 11l6-2m3 3 4-2" stroke="#b9c2c8" strokeWidth="2" />
          <path d="M0 8l4 1m6-2 5 2" stroke="#667783" strokeWidth="1.5" />
        </pattern>
        <pattern id="scrapSideFill" width="16" height="14" patternUnits="userSpaceOnUse">
          <rect width="16" height="14" fill="#73828d" />
          <path d="M1 3l6 3m3-4 5 2M3 11l5-3m3 4 4-3" stroke="#aeb9c0" strokeWidth="1.8" />
          <path d="M0 7l4 2m5-2 5 3" stroke="#596b78" strokeWidth="1.4" />
        </pattern>
      </defs>
      <path d="M45 158 221 214 221 258 45 202Z" fill="#d6e1e8" stroke="#40586b" strokeWidth="2" />
      <path d="M221 214 338 82 338 126 221 258Z" fill="#c7d6df" stroke="#40586b" strokeWidth="2" />
      <path d="M338 82 281 64 281 108 338 126Z" fill="#d5e1e7" stroke="#40586b" strokeWidth="2" />
      <path d="M281 64 184 123 184 167 281 108Z" fill="#e0e8ed" stroke="#40586b" strokeWidth="2" />
      <path d="M184 123 100 96 100 140 184 167Z" fill="#cfdae2" stroke="#40586b" strokeWidth="2" />
      <path d="M100 96 45 158 45 202 100 140Z" fill="#e4ebef" stroke="#40586b" strokeWidth="2" />
      <path d="M52 181 218 236 221 258 45 202Z" fill="url(#scrapFrontFill)" stroke="#667783" strokeWidth="1.2" />
      <path d="M218 236 332 105 338 126 221 258Z" fill="url(#scrapSideFill)" stroke="#596b78" strokeWidth="1.2" />

      <g clipPath="url(#scrapSurface)" stroke="#758390" strokeWidth="0.9">
        <path d="M52 181 218 236 332 105 281 84 186 146 104 117Z" fill="#8e9ba6" />
        <path d="M52 181 104 117 126 162Z" fill="#9ca7b0" />
        <path d="M104 117 186 146 126 162Z" fill="#84929e" />
        <path d="M186 146 181 190 126 162Z" fill="#a6afb7" />
        <path d="M52 181 126 162 181 190Z" fill="#778691" />
        <path d="M52 181 181 190 218 236Z" fill="#929ea8" />
        <path d="M218 236 181 190 238 195Z" fill="#6f7f8c" />
        <path d="M181 190 186 146 222 160Z" fill="#8996a1" />
        <path d="M181 190 222 160 238 195Z" fill="#aab2b9" />
        <path d="M238 195 222 160 286 137Z" fill="#7d8b97" />
        <path d="M238 195 286 137 332 105Z" fill="#9da8b1" />
        <path d="M222 160 247 116 286 137Z" fill="#adb5bc" />
        <path d="M186 146 247 116 222 160Z" fill="#74838f" />
        <path d="M186 146 281 84 247 116Z" fill="#97a3ad" />
        <path d="M281 84 332 105 247 116Z" fill="#7b8995" />
        <path d="M247 116 332 105 286 137Z" fill="#8c99a4" />
      </g>

      <path d="M45 158 221 214 338 82 281 64 184 123 100 96Z" fill="none" stroke="#30485b" strokeWidth="3" />
      <path d="M45 202 221 258 338 126 281 108 184 167 100 140Z" fill="none" stroke="#647789" strokeWidth="1.4" />
      <path d="M45 158v44M221 214v44M338 82v44M281 64v44M184 123v44M100 96v44" stroke="#40586b" strokeWidth="2" />
      <polygon points={`122,103 ${lidar1Points}`} fill="#1677e8" fillOpacity="0.4" stroke="none" />
      <polygon points={`238,90.15 ${lidar2Points}`} fill="#0ba58f" fillOpacity="0.44" stroke="none" />
      <g>
        <polyline points={lidar1Points} fill="none" stroke="#ffffff" strokeWidth="7" strokeLinejoin="round" />
        <polyline points={lidar1Points} fill="none" stroke="#1677e8" strokeWidth="4" strokeLinejoin="round" />
        <polyline points={lidar2Points} fill="none" stroke="#ffffff" strokeWidth="7" strokeLinejoin="round" />
        <polyline points={lidar2Points} fill="none" stroke="#0ba58f" strokeWidth="4" strokeLinejoin="round" />
      </g>

      <path d="M158 95 202 109 270 32 226 18Z" fill="#3f5261" stroke="#304555" strokeWidth="2.5" />
      <path d="m165 87 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14m-36-23 44 14" stroke="#9caab4" strokeWidth="4" />
      <path d="M158 95 202 109 187 126 143 112Z" fill="#f3e6d4" stroke="#c47a25" strokeWidth="2" />
      <path d="M143 112 187 126 175 145 131 131Z" fill="#edcfaa" stroke="#c47a25" strokeWidth="2" />
      <path d="M143 112 187 126" stroke="#a75f17" strokeWidth="2.4" />

      <g transform="translate(74.75 153)">
        <circle r="8" fill="#ffffff" stroke={lidar1Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar1Color} fontSize="10" fontWeight="700" textAnchor="middle">A</text>
      </g>
      <g transform="translate(243.24 207)">
        <circle r="8" fill="#ffffff" stroke={lidar1Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar1Color} fontSize="10" fontWeight="700" textAnchor="middle">B</text>
      </g>
      <g transform="translate(252 102.93)">
        <circle r="8" fill="#ffffff" stroke={lidar2Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar2Color} fontSize="10" fontWeight="700" textAnchor="middle">B</text>
      </g>
      <g transform="translate(190 226.72)">
        <circle r="8" fill="#ffffff" stroke={lidar2Color} strokeWidth="2.2" />
        <text x="0" y="4" fill={lidar2Color} fontSize="10" fontWeight="700" textAnchor="middle">A</text>
      </g>
      <circle cx="122" cy="103" r="7" fill="#ffffff" stroke="#40586b" strokeWidth="2" />
      <text x="58" y="82" fill="#1677e8" fontSize="15" fontWeight="700">LiDAR 1</text>
      <circle cx="238" cy="90.15" r="7" fill="#ffffff" stroke="#40586b" strokeWidth="2" />
      <text x="296" y="65" fill="#087c6c" fontSize="15" fontWeight="700">LiDAR 2</text>
      <path d="M288 229h24" stroke="#1677e8" strokeWidth="4" />
      <text x="319" y="233" fill="#52657a" fontSize="11">LiDAR 1 표면 측정선</text>
      <path d="M288 250h24" stroke="#0ba58f" strokeWidth="4" />
      <text x="319" y="254" fill="#52657a" fontSize="11">LiDAR 2 표면 측정선</text>
    </svg>
  );
}

export function LoadChart({ samples, threshold }: { samples: DashboardData["monitoring"]["loadHistory"]; threshold: number }) {
  const orderedSamples = [...samples].sort((leftSample, rightSample) => new Date(leftSample.measuredAt).getTime() - new Date(rightSample.measuredAt).getTime());
  const firstTimestamp = new Date(orderedSamples[0]?.measuredAt ?? "").getTime();
  const lastTimestamp = new Date(orderedSamples.at(-1)?.measuredAt ?? "").getTime();
  const hasTimestampRange = Number.isFinite(firstTimestamp) && Number.isFinite(lastTimestamp) && lastTimestamp > firstTimestamp;
  const xValues = orderedSamples.map((sample, index) => {
    const ratio = hasTimestampRange
      ? (new Date(sample.measuredAt).getTime() - firstTimestamp) / (lastTimestamp - firstTimestamp)
      : orderedSamples.length <= 1 ? 0.5 : index / (orderedSamples.length - 1);
    return 40 + ratio * 370;
  });
  const yMin = 0;
  const yMax = 100;
  const yTickValues = [100, 80, 60, 40, 20, 0];
  const chartTop = 20;
  const chartBottom = 148;
  const toY = (value: number) => chartBottom - (value - yMin) * ((chartBottom - chartTop) / (yMax - yMin));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const plottedSamples = orderedSamples.map((sample, index) => ({
    ...sample,
    x: xValues[index],
    y: sample.value === null ? null : toY(sample.value),
  }));
  const sampleSegments = contiguousSegments(plottedSamples, (sample) => sample.y !== null);
  const tickInterval = 3 * 3_600_000;
  const xTicks = hasTimestampRange
    ? Array.from({ length: Math.floor((lastTimestamp - firstTimestamp) / tickInterval) + 1 }, (_, index) => {
      const timestamp = firstTimestamp + index * tickInterval;
      return {
        label: clockAt(timestamp, orderedSamples[0].measuredAt),
        x: 40 + ((timestamp - firstTimestamp) / (lastTimestamp - firstTimestamp)) * 370,
      };
    })
    : orderedSamples.map((sample, index) => ({ label: sample.time, x: xValues[index] }));

  const activeX = activeIndex === null ? 0 : xValues[activeIndex];
  const activeY = activeIndex === null ? 0 : plottedSamples[activeIndex].y ?? 0;
  const tooltipX = Math.max(24, Math.min(activeX - 42, 364));
  const tooltipY = Math.max(4, activeY - 42);

  return (
    <svg className="chart-svg" viewBox="0 0 430 175" preserveAspectRatio="none" role="img" aria-label="최근 24시간 대표 적재율 그래프">
      <g stroke="#e2e8ef" strokeWidth="1">
        {yTickValues.map((value) => (
          <path key={`grid-h-${value}`} d={`M40 ${toY(value).toFixed(1)}H410`} />
        ))}
        {xTicks.map(({ x }) => (
          <path key={`grid-v-${x}`} d={`M${x} ${chartTop}V${chartBottom}`} />
        ))}
      </g>
      <g fill="#61708a" fontSize="10">
        {yTickValues.map((tick) => (
          <g key={`y-${tick}`}>
            <text x="30" y={toY(tick).toFixed(1)} textAnchor="end" dominantBaseline="middle">
              {tick}%
            </text>
          </g>
        ))}
      </g>
      <path d={`M40 ${toY(threshold)}H410`} stroke="#607086" strokeDasharray="5 5" strokeOpacity="0.58" strokeWidth="1.5" />
      <text x="408" y="39" transform="translate(408 0) scale(0.69 1) translate(-408 0)" fill="#526278" fontSize="10" fontWeight="600" textAnchor="end">수거 임계율 {threshold}%</text>
      {sampleSegments.length > 0 ? sampleSegments.map((segment, index) => {
        const linePath = segment.map((sample, sampleIndex) => `${sampleIndex === 0 ? "M" : "L"}${sample.x} ${sample.y}`).join(" ");
        return <g key={`load-segment-${index}`}>
          <path d={`${linePath}V${chartBottom}H${segment[0].x}Z`} fill="#f58a07" fillOpacity="0.1" />
          <path className="load-chart-line" d={linePath} fill="none" stroke="#f58a07" strokeWidth="4" />
        </g>;
      }) : <text x="225" y="92" fill="#61708a" fontSize="11" textAnchor="middle">최근 적재율 데이터가 없습니다.</text>}
      {plottedSamples.map((sample, index) => sample.value !== null && (
        <circle
          key={`target-${sample.x}`}
          className="chart-point-target"
          cx={sample.x}
          cy={sample.y ?? 0}
          r="11"
          tabIndex={0}
          aria-label={`${sample.time} 대표 적재율 ${sample.value}%`}
          onPointerEnter={() => setActiveIndex(index)}
          onPointerLeave={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex(index)}
          onBlur={() => setActiveIndex(null)}
        />
      ))}
      {activeIndex !== null && (
        <g className="chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none">
          <rect width="84" height="34" rx="4" />
          <text x="8" y="14">{orderedSamples[activeIndex].time}</text>
          <text x="8" y="27">대표 적재율 {orderedSamples[activeIndex].value}%</text>
        </g>
      )}
      <g fill="#61708a" fontSize="11">
        {xTicks.map(({ label, x }) => (
          <text key={`x-${x}`} x={x} y="166" textAnchor="middle">
            {label}
          </text>
        ))}
      </g>
    </svg>
  );
}

export function ProfileChart({ average, color, label, maximum, minimum, samples }: LidarProfile) {
  const stroke = color === "blue" ? "#1677e8" : "#0ba58f";
  const axisTextColor = color === "blue" ? "#0b3f8d" : "#066f5e";
  const yMin = 0;
  const yMax = 10;
  const yStep = 2;
  const chart = { left: 40, right: 410, top: 20, bottom: 148 };
  const gridYValues = Array.from({ length: yMax / yStep + 1 }, (_, index) => index * yStep);
  const gridXValues = [{ positionRatio: 0, value: "A" }, { positionRatio: 1, value: "B" }];
  const toY = (value: number) => chart.bottom - (value - yMin) * ((chart.bottom - chart.top) / (yMax - yMin));
  const toX = (positionRatio: number) => chart.left + (chart.right - chart.left) * Math.max(0, Math.min(1, positionRatio));
  const orderedSamples = [...samples].sort((leftSample, rightSample) => leftSample.positionRatio - rightSample.positionRatio);
  const plottedSamples = orderedSamples.map((sample) => ({
    ...sample,
    x: toX(sample.positionRatio),
    y: sample.height === null ? null : toY(sample.height),
  }));
  const profileSegments = contiguousSegments(plottedSamples, (sample) => sample.y !== null);

  return (
    <section className="card chart-card span-4">
      <div className="chart-title-row">
        <SectionTitle>{label}</SectionTitle>
        <div className={`profile-stat ${color}`}>
          <span className="average"><span className="average-label">평균</span>{average}</span>
          <span className="range">최소 {minimum} / 최대 {maximum}</span>
        </div>
      </div>
      <svg className="chart-svg" viewBox="0 0 430 175" preserveAspectRatio="none" role="img" aria-label={label}>
        <g stroke="#e2e8ef" strokeWidth="1">
          {gridYValues.map((value) => (
            <path key={`grid-h-${value}`} d={`M${chart.left} ${toY(value).toFixed(1)}H${chart.right}`} />
          ))}
          <path d={`M${chart.left} ${chart.top}V${chart.bottom}M${chart.left + (chart.right - chart.left) / 2} ${chart.top}V${chart.bottom}M${chart.right} ${chart.top}V${chart.bottom}`} />
        </g>
        <g fill="#61708a" fontSize="10">
          {gridYValues.map((value) => (
            <g key={`profile-y-${value}`}>
              <text x="30" y={toY(value).toFixed(1)} textAnchor="end" dominantBaseline="middle">
                {value}m
              </text>
            </g>
          ))}
          {gridXValues.map((tick) => (
            <text
              key={`profile-x-${tick.value}`}
              x={toX(tick.positionRatio).toFixed(1)}
              y="166"
              fill={axisTextColor}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
            >
              {tick.value}
            </text>
          ))}
        </g>
        {profileSegments.length > 0 ? profileSegments.map((segment, index) => {
          const linePath = segment.map((sample, sampleIndex) => `${sampleIndex === 0 ? "M" : "L"}${sample.x} ${sample.y}`).join(" ");
          return <g key={`profile-segment-${index}`}>
            <path d={`${linePath}V${chart.bottom}H${segment[0].x}Z`} fill={stroke} fillOpacity="0.08" />
            <path className="profile-chart-line" d={linePath} fill="none" stroke={stroke} strokeWidth="4" />
          </g>;
        }) : <text x="225" y="92" fill="#61708a" fontSize="11" textAnchor="middle">유효한 높이 데이터가 없습니다.</text>}
      </svg>
    </section>
  );
}
