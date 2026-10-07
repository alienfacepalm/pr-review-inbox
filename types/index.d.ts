export type TRequestReason = 'review' | 'assigned'

export interface IPullRequest {
  readonly url: string
  readonly number: number
  readonly title: string
  readonly repository: string
  readonly author: string
  readonly isDraft: boolean
  readonly createdAt: string
  readonly commentsCount: number
  readonly labels: readonly string[]
  // Why it is in the inbox: your review was requested, you are an assignee, or both.
  readonly reasons: readonly TRequestReason[]
}

export type TReviewAction = 'approve' | 'request-changes' | 'comment'

export type TSortMode = 'newest' | 'oldest' | 'repo'

export interface IPendingAction {
  readonly action: TReviewAction
  readonly url: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-inbox': {
      pullRequests: IPullRequest[]
      selectedUrl: string | null
      draftComment: string
      pending: IPendingAction | null
      unseenUrls: string[]
      message: string
      pollError: string | null
      lastPolledAt: number | null
      isBusy: boolean
      isTruncated: boolean
      filterText: string
      sortMode: TSortMode
      isHidingDrafts: boolean
      listOffset: number
    }
  }
}
