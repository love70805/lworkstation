let openReviews = 0;

export function beginCostReview() {
  openReviews++;
  return () => { openReviews--; };
}

export const hasOpenCostReview = () => openReviews > 0;
