import type { Event, Page, PageStatus, Pending, Quota, QuotaCredits, ResetCardAutomation, ResetCardSettings, Row, State } from '../../types'
import { array, boolean, nonNegativeInteger as integer, nullable, number, record, string } from '../validation'

export function parseStatus(input: unknown): PageStatus {
  const v = record(input, '页面设置')
  return {
    resetCardSettings: nullable(v.resetCardSettings, parseResetCardSettings, '主动重置卡设置'),
  }
}
function parseResetCardSettings(input: unknown): ResetCardSettings {
  const v = record(input, '主动重置卡设置')
  return {
    resetCreditOnLowWeeklyQuota: boolean(v.resetCreditOnLowWeeklyQuota, '使用时机'),
    resetCreditLeadMinutes: integer(v.resetCreditLeadMinutes, '提前使用时间'),
    resetCreditMaxWeeklyRemainingPercent: nullable(v.resetCreditMaxWeeklyRemainingPercent, integer, '剩余周额度上限'),
  }
}
function parsePending(input: unknown): Pending {
  const v = record(input, '未决操作')
  return { requestId: string(v.requestId, '请求标识'), creditId: nullable(v.creditId, string, '卡片标识'), startedAtMs: integer(v.startedAtMs, '发起时间'), automatic: boolean(v.automatic, '自动操作') }
}
function parseEvent(input: unknown): Event {
  const v = record(input, '消费记录')
  return { atMs: integer(v.atMs, '消费时间'), requestId: string(v.requestId, '请求标识'), creditId: nullable(v.creditId, string, '卡片标识'), automatic: boolean(v.automatic, '自动操作'), code: string(v.code, '业务结果') }
}
function parseQuotaCredits(input: unknown): QuotaCredits {
  const v = record(input, '额度点数')
  return { has_credits: boolean(v.has_credits, '点数可用状态'), unlimited: boolean(v.unlimited, '点数不限量'), balance: nullable(v.balance, string, '点数余额') }
}
function parseState(input: unknown): State {
  const v = record(input, '账号状态')
  return {
    error: nullable(v.error, string, '重置错误'), pending: nullable(v.pending, parsePending, '未决操作'),
    awaitingRecovery: boolean(v.awaitingRecovery, '等待回读'), lastAttemptAtMs: nullable(v.lastAttemptAtMs, integer, '上次发起时间'), history: array(v.history, parseEvent, '消费记录'),
  }
}
function parseQuota(input: unknown): Quota {
  const v = record(input, '额度')
  return { account_id: string(v.account_id, '额度账号'), credits: nullable(v.credits, parseQuotaCredits, '额度点数'), observed_at_ms: nullable(v.observed_at_ms, integer, '额度观测时间'), windows: array(v.windows, input => {
    const w = record(input, '额度窗口')
    return { key: string(w.key, '窗口标识'), label: string(w.label, '窗口名称'), limit_id: nullable(w.limit_id, string, '额度桶'), window_seconds: nullable(w.window_seconds, integer, '窗口时长'), used_percent: nullable(w.used_percent, number, '用量比例'), reset_at_ms: nullable(w.reset_at_ms, integer, '额度刷新时间') }
  }, '额度窗口') }
}
function parseRow(input: unknown): Row {
  const v = record(input, '账号'), a = record(v.account, '账号信息')
  return {
    account: { account_id: string(a.account_id, '账号标识'), provider_id: string(a.provider_id, '提供方'), name: string(a.name, '账号名称'), email: nullable(a.email, string, '账号邮箱'), enabled: boolean(a.enabled, '启用状态'), authentication_kind: string(a.authentication_kind, '认证类型'), plan_type: nullable(a.plan_type, string, '会员标识'), plan_type_display: string(a.plan_type_display, '会员名称') },
    quota: nullable(v.quota, parseQuota, '额度'), state: parseState(v.state),
    autoUseQuotaCredits: nullable(v.autoUseQuotaCredits, boolean, '自动使用额度点数'),
    resetCardAutomation: nullable(v.resetCardAutomation, parseResetCardAutomation, '自动使用重置卡'),
  }
}
export function parsePage(input: unknown): Page {
  const v = record(input, '账号分页')
  return { accounts: array(v.accounts, parseRow, '账号列表'), excludedPending: array(v.excludedPending, parseRow, '已排除未决账号'), nextPage: nullable(v.nextPage, integer, '下一页'), generatedAtMs: integer(v.generatedAtMs, '快照时间') }
}
export function parseUpdate(input: unknown): { state: State; quota: Quota | null } {
  const v = record(input, '更新结果')
  return { state: parseState(v.state), quota: nullable(v.quota, parseQuota, '额度') }
}
export function parsePolicy(input: unknown): boolean {
  return boolean(record(input, '账号策略').enabled, '宿主开关状态')
}
export function parseResetCardAutomation(input: unknown): ResetCardAutomation {
  const v = record(input, '自动使用重置卡')
  return {
    enabled: boolean(v.enabled, '自动使用重置卡'),
    next_discovery_at: nullable(v.next_discovery_at, string, '计划查卡时间'),
    next_consume_at: nullable(v.next_consume_at, string, '计划用卡时间'),
    last_result: nullable(v.last_result, string, '上次用卡状态'),
  }
}
