export class OnePageSelectionError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'OnePageSelectionError';
  }
}

export class OnePageDoesNotFitError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;
  readonly pageCount: number;
  constructor(pageCount: number) {
    super('This content still exceeds one page at the minimum readable type size and margins. Remove more items and update the preview.');
    this.name = 'OnePageDoesNotFitError';
    this.pageCount = pageCount;
  }
}
