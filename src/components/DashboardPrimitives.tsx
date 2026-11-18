import { useId } from "react";

export function BrandMark() {
  const clipId = useId();
  return (
    <svg className="brand-mark" viewBox="0 0 618 616" fill="none" aria-hidden="true">
      <g clipPath={`url(#${clipId})`}>
        <path d="M55.7917 308.836C55.7917 276.494 61.8429 245.611 72.9154 217.172L24.1621 189.034C8.62625 225.88 0 266.329 0 308.836C0 466.3 117.978 596.183 270.375 615.185V558.994C148.878 540.421 55.7917 435.502 55.7917 308.836ZM506.374 150.386L555.17 122.248C498.735 47.9554 409.468 0 309 0C208.532 0 119.222 47.9554 62.7871 122.205L111.669 150.429C158.062 92.7796 229.175 55.805 309 55.805C388.825 55.805 459.938 92.7367 506.374 150.429V150.386ZM593.881 189.034L545.042 217.215C556.114 245.654 562.208 276.494 562.208 308.836C562.208 435.459 469.122 540.378 347.625 558.994V615.185C500.022 596.183 618 466.3 618 308.836C618 266.329 609.417 225.88 593.881 189.034Z" fill="#FCB132" />
        <path d="M538.003 476.209C479.637 417.144 398.61 380.513 309 380.513C219.39 380.513 138.363 417.144 79.9967 476.209" stroke="#FCB132" strokeWidth="93.6956" strokeMiterlimit="10" />
        <path d="M339.514 26.9804C317.54 107.021 326.295 195.425 371.1 272.977C415.905 350.572 488.22 402.388 568.603 423.363" stroke="#FCB132" strokeWidth="93.6956" strokeMiterlimit="10" />
        <path d="M49.3972 423.406C129.78 402.431 202.095 350.615 246.9 273.02C291.705 195.468 300.46 107.021 278.486 27.0235" stroke="#FCB132" strokeWidth="93.6956" strokeMiterlimit="10" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="618" height="616" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function PageTitle({ children }: { children: string }) {
  return (
    <h1 tabIndex={-1}>
      <span className="page-title-mark" aria-hidden="true" />
      {children}
    </h1>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <h2 className="section-title">{children}</h2>;
}

export function BellIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg className="expand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
    </svg>
  );
}
