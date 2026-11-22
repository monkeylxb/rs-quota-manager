import { request } from '../request'
import { parsePage, parsePolicy, parseResetCardAutomation, parseStatus, parseUpdate } from '../schemas/quota'

export const api = {
  status: () => request('GET', 'api/status').then(parseStatus),
  accounts: (page = 1) => request('GET', 'api/accounts', undefined, new URLSearchParams({ page: String(page) }).toString()).then(parsePage),
  setQuotaCredits: (accountId: string, enabled: boolean) => request('POST', 'api/auto-use-quota-credits', { accountId, enabled }).then(parsePolicy),
  setResetCards: (accountId: string, enabled: boolean) => request('POST', 'api/auto-use-reset-cards', { accountId, enabled }).then(parseResetCardAutomation),
  retry: (accountId: string, requestId: string) => request('POST', 'api/retry', { accountId, requestId }).then(parseUpdate),
}
