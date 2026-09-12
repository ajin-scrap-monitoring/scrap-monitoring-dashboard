type PaginationProps = {
  ariaLabel: string;
  currentPage: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  totalPages: number;
};

export function Pagination({ ariaLabel, currentPage, itemLabel, onPageChange, totalPages }: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(Math.max(0, currentPage), safeTotalPages - 1);

  return (
    <div className="pagination" aria-label={ariaLabel}>
      <button
        type="button"
        aria-label={`이전 ${itemLabel} 페이지`}
        disabled={safeCurrentPage === 0}
        onClick={() => onPageChange(safeCurrentPage - 1)}
      >
        &lt;
      </button>
      <span>{safeCurrentPage + 1} / {safeTotalPages}</span>
      <button
        type="button"
        aria-label={`다음 ${itemLabel} 페이지`}
        disabled={safeCurrentPage === safeTotalPages - 1}
        onClick={() => onPageChange(safeCurrentPage + 1)}
      >
        &gt;
      </button>
    </div>
  );
}
