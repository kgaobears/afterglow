// Never erase a previous review decision, including rejections. Test mode only
// relaxes *duplicate suppression*, allowing a fresh candidate into review.
export function protectCapturedItem(status: string): boolean {
  return status === "confirmed" || status === "approved_pending_person" || status === "rejected";
}

export function suppressReprocessedFact(status: string, reconsiderRejected: boolean): boolean {
  return status === "confirmed" || status === "approved_pending_person" || status === "rejected" && !reconsiderRejected;
}
