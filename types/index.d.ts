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
  // The signed-in gh accounts that see it. Empty when gh listed none and its active account was used.
  readonly accounts: readonly string[]
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
      // Every signed-in gh account, '' for "all" in accountFilter, and what the last poll could not read.
      accounts: string[]
      accountFilter: string
      accountNotice: string
    }
  }
}
