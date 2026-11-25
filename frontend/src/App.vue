<script setup lang="ts">
import { Users, Gauge, Download, RefreshCw, Search, TicketCheck, X, AlertTriangle, FilterX, CircleHelp } from '@lucide/vue'
import { ZButton } from '@codex-proxy/ui/button'
import { ZCard } from '@codex-proxy/ui/card'
import { ZDialog } from '@codex-proxy/ui/dialog'
import { ZIconButton } from '@codex-proxy/ui/icon-button'
import { ZInput } from '@codex-proxy/ui/input'
import { ZPagination } from '@codex-proxy/ui/pagination'
import { ZPopover } from '@codex-proxy/ui/popover'
import { ZSelect } from '@codex-proxy/ui/select'
import { ZSwitch } from '@codex-proxy/ui/switch'
import { ZTable, type TableColumn } from '@codex-proxy/ui/table'
import PlanBadge from './PlanBadge.vue'
import ExportDialog from './ExportDialog.vue'
import ResetCardsDialog from './ResetCardsDialog.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { avatarTone, canReset, csv, creditBalance, hasGroupedQuota, isLimited, resetCardTiming, status, time, week, weeks } from './format'
import { useQuotaManager, type Policy } from './useQuotaManager'
import type { Row } from './types'

const {
  rows, loading, refreshing, error, notice, excludedPending, search, filter, membership, order, page, pageSize, pageStatus, snapshotAt, policyTargets,
  showCards, confirmation, consuming, bulk, stopBulk, bulkDone, bulkTotal, failures, selected, blocked, limited, pending, automaticCount,
  planOptions, filtered, visible, filteredActive, clearFilters, load, policy, setFilteredPolicy, openCards, requestConfirmation, confirmPending,
} = useQuotaManager()
const preview = import.meta.env.DEV
const showExport = ref(false), exportText = ref('')
const bulkChoice = ref<Policy | null>(null)
const bulkDialog = computed({ get: () => bulkChoice.value !== null, set: open => { if (!open) bulkChoice.value = null } })
const bulkTargets = computed(() => bulkChoice.value ? policyTargets.value[bulkChoice.value] : [])
const bulkEnabled = computed(() => bulkTargets.value.filter(row =>
  bulkChoice.value === 'quotaCredits' ? row.autoUseQuotaCredits : row.resetCardAutomation?.enabled,
).length)
const rules = computed(() => pageStatus.value.resetCardSettings)
function confirmBulkPolicy(enabled: boolean) {
  const key = bulkChoice.value
  bulkChoice.value = null
  if (key) void setFilteredPolicy(key, enabled)
}
const narrowScreen = window.matchMedia('(max-width: 720px)')
const narrow = ref(narrowScreen.matches)
const updateColumns = (event: MediaQueryListEvent) => { narrow.value = event.matches }
onMounted(() => narrowScreen.addEventListener('change', updateColumns))
onUnmounted(() => narrowScreen.removeEventListener('change', updateColumns))
function exportAccounts() { exportText.value = csv(filtered.value); showExport.value = true }
const statusOptions = [{ value: 'all', label: '全部状态' }, { value: 'limited', label: '周限已满' }, { value: 'automatic', label: '自动用卡已开启' }, { value: 'pending', label: '结果待确认' }, { value: 'error', label: '重置异常' }, { value: 'disabled', label: '已停用' }]
const orderOptions = [{ value: 'name', label: '按账号名称' }, { value: 'used', label: '按周限用量' }]
const columns = computed<TableColumn<Row>[]>(() => [
  { key: 'identity', label: '账号', kind: 'identity', minWidth: narrow.value ? 230 : 245, fixed: narrow.value ? false : 'left' },
  { key: 'plan', label: '订阅', kind: 'status', width: 128, align: 'center' },
  { key: 'status', label: '状态', kind: 'status', width: 120 },
  { key: 'weekly', label: '周限', kind: 'custom', width: 120 },
  { key: 'reset', label: '周限刷新时间', kind: 'datetime', width: 175 },
  { key: 'plannedReset', label: '计划用卡时间', kind: 'datetime', width: 175 },
  { key: 'quotaCredits', label: '额度点数', kind: 'custom', width: 110, align: 'right' },
  { key: 'autoUseQuotaCredits', label: '自动使用额度点数', kind: 'custom', width: narrow.value ? 76 : 144, align: 'center', fixed: 'right' },
  { key: 'autoUseResetCards', label: '自动使用重置卡', kind: 'custom', width: narrow.value ? 86 : 154, align: 'center', fixed: 'right' },
  { key: 'actions', label: '操作', kind: 'actions', width: 64, fixed: 'right' },
])
const rowKey = (row: Row) => row.account.account_id
const accountEmail = (row: Row) => row.account.email?.trim() || row.account.name
const rowTitle = (row: Row) => accountEmail(row)
const statusTone = (row: Row) => row.state.pending || isLimited(row) ? 'warning' : row.state.error ? 'error' : status(row) === '正常' ? 'success' : 'muted'
</script>

<template>
  <main class="quota-manager">
    <div v-if="preview" class="preview">本地预览数据</div>
    <div class="metrics">
      <ZCard padding="none" class="metric"><div><span>账号总数</span><strong>{{ rows.length }}</strong><small>非 Free 账号</small></div><span class="metric-icon tone-blue"><Users :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>周限已满</span><strong>{{ limited }}</strong><small>等待额度恢复</small></div><span class="metric-icon tone-orange"><Gauge :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>自动用卡已开启</span><strong>{{ automaticCount }}</strong><small>由 RS 按账号调度</small></div><span class="metric-icon tone-green"><TicketCheck :size="20" /></span></ZCard>
      <ZCard padding="none" class="metric"><div><span>结果待确认</span><strong>{{ pending }}</strong><small>旧版手动用卡操作</small></div><span class="metric-icon tone-orange"><AlertTriangle :size="20" /></span></ZCard>
    </div>

    <div class="work-area">
      <div class="toolbar">
        <ZInput v-model="search" class="account-search" placeholder="搜索账号" clearable aria-label="搜索账号"><template #prefix><Search :size="16" /></template></ZInput>
        <ZSelect v-model="filter" class="status-filter" :options="statusOptions" aria-label="账号状态筛选" />
        <ZSelect v-model="membership" class="plan-filter" :options="planOptions" aria-label="会员标识筛选" />
        <ZSelect v-model="order" class="order-filter" :options="orderOptions" aria-label="账号排序" />
        <ZIconButton v-if="filteredActive" title="清除筛选" aria-label="清除筛选" @click="clearFilters"><FilterX :size="17" /></ZIconButton>
        <div class="toolbar-actions">
          <ZIconButton title="导出筛选账号" aria-label="导出筛选账号" :disabled="!filtered.length || loading" @click="exportAccounts"><Download :size="18" /></ZIconButton>
          <ZIconButton title="读取最新快照" aria-label="读取最新快照" :disabled="blocked || loading || refreshing" @click="load()"><RefreshCw :size="18" :class="{ spin: loading || refreshing }" /></ZIconButton>
          <ZButton :disabled="blocked || loading || !policyTargets.quotaCredits.length" @click="bulkChoice = 'quotaCredits'">批量设置用点</ZButton>
          <ZButton :disabled="blocked || loading || !policyTargets.resetCards.length" @click="bulkChoice = 'resetCards'">批量设置用卡</ZButton>
          <ZButton v-if="bulk" :disabled="stopBulk" @click="stopBulk = true"><template #icon><X :size="16" /></template>停止 {{ bulkDone }}/{{ bulkTotal }}</ZButton>
        </div>
      </div>

      <div v-if="error" class="message error" role="alert"><AlertTriangle :size="16" /><span>{{ error }}</span></div>
      <div v-if="notice" class="message" role="status">{{ notice }}</div>
      <details v-if="failures.length" class="failure-list"><summary>{{ failures.length }} 个账号更新失败</summary><p v-for="failure in failures" :key="failure">{{ failure }}</p></details>
      <div v-for="row in excludedPending" :key="row.account.account_id" class="message" role="status"><AlertTriangle :size="16" /><div><b>已排除账号仍有操作待确认</b><span class="sub">{{ row.account.name }}</span></div><ZButton size="small" :disabled="blocked" @click="openCards(row)">确认原操作</ZButton></div>

      <ZTable class="quota-table" :columns="columns" :data="visible" :row-key="rowKey" :loading="loading && !rows.length" :empty-text="loading ? '正在读取账号' : filteredActive ? '没有匹配账号' : '暂无账号'">
        <template #identity="{ row }"><div class="account-cell"><span class="account-avatar" :class="`tone-${avatarTone(row.account.account_id)}`">{{ accountEmail(row).slice(0, 1).toUpperCase() }}</span><span class="account-name" :title="rowTitle(row)">{{ accountEmail(row) }}</span></div></template>
        <template #plan="{ row }"><PlanBadge :plan="row.account.plan_type" :display-name="row.account.plan_type_display" /></template>
        <template #status="{ row }"><span class="account-status" :class="`status-${statusTone(row)}`" :title="row.state.error || status(row)"><i></i>{{ status(row) }}</span></template>
        <template #weekly="{ row }">
          <ZPopover v-if="hasGroupedQuota(row) && weeks(row).length" placement="bottom-start">
            <template #reference><ZButton size="small" variant="link">{{ weeks(row).length }} 个模型组</ZButton></template>
            <div class="settings-help model-group-quota">
              <p v-for="window in weeks(row)" :key="window.key">
                <strong>{{ window.limit_name || window.limit_id || window.key }}</strong>
                <span>已用 {{ window.used_percent == null ? '未知' : `${window.used_percent.toFixed(1)}%` }}</span>
                <span>刷新 {{ time(window.reset_at_ms) }}</span>
              </p>
              <p class="sub">额度观测 {{ time(row.quota?.observed_at_ms) }}</p>
            </div>
          </ZPopover>
          <div v-else-if="week(row)" class="weekly-cell" :title="`额度观测 ${time(row.quota?.observed_at_ms)}`"><div class="quota-value" :class="{ warning: isLimited(row) }">{{ week(row)?.used_percent == null ? '未知' : `${week(row)!.used_percent!.toFixed(1)}%` }}<span>已用</span></div><div class="quota-track"><i :class="{ exhausted: isLimited(row) }" :style="{ width: `${Math.min(100, Math.max(0, week(row)?.used_percent || 0))}%` }"></i></div><details v-if="weeks(row).length > 1" class="extra"><summary>其他周限</summary><span v-for="window in weeks(row)" :key="window.key">{{ window.key }} · {{ window.used_percent ?? '未知' }}%</span></details></div>
          <span v-else class="muted">无周限数据</span>
        </template>
        <template #reset="{ row }">
          <span v-if="hasGroupedQuota(row)" class="muted">{{ weeks(row).length ? '见模型组' : '—' }}</span>
          <span v-else class="date" :title="`额度观测 ${time(row.quota?.observed_at_ms)}`">{{ time(week(row)?.reset_at_ms) }}</span>
        </template>
        <template #plannedReset="{ row }"><span class="date">{{ row.resetCardAutomation?.next_consume_at ? time(row.resetCardAutomation.next_consume_at) : '—' }}</span></template>
        <template #quotaCredits="{ row }"><span class="date">{{ creditBalance(row) }}</span></template>
        <template #header-autoUseQuotaCredits><span class="policy-label">自动使用<wbr>额度点数</span></template>
        <template #header-autoUseResetCards>
          <span class="policy-heading">
            <span class="policy-label">自动使用<wbr>重置卡</span>
            <ZPopover trigger="hover-click" placement="bottom-end">
              <template #reference>
                <ZIconButton size="small" variant="link" class="policy-help-button" title="查看主动重置卡规则" aria-label="查看主动重置卡规则"><CircleHelp :size="14" /></ZIconButton>
              </template>
              <div class="settings-help">
                <p class="font-heavy">系统设置 → 主动重置卡</p>
                <p>{{ resetCardTiming(rules) }}</p>
                <p v-if="rules && !rules.resetCreditOnLowWeeklyQuota">剩余周额度上限 {{ rules.resetCreditMaxWeeklyRemainingPercent === null ? '不限' : rules.resetCreditMaxWeeklyRemainingPercent + '%' }}</p>
              </div>
            </ZPopover>
          </span>
        </template>
        <template #autoUseQuotaCredits="{ row }">
          <ZSwitch v-if="row.autoUseQuotaCredits !== null" :model-value="row.autoUseQuotaCredits" :disabled="blocked || loading" :aria-label="`自动使用额度点数 ${accountEmail(row)}`" @update:model-value="policy(row, 'quotaCredits', $event)" />
          <span v-else class="muted">—</span>
        </template>
        <template #autoUseResetCards="{ row }">
          <ZSwitch v-if="row.resetCardAutomation" :model-value="row.resetCardAutomation.enabled" :disabled="blocked || loading" :aria-label="`自动使用重置卡 ${accountEmail(row)}`" @update:model-value="policy(row, 'resetCards', $event)" />
          <span v-else class="muted">—</span>
        </template>
        <template #actions="{ row }"><div class="row-actions"><ZIconButton size="small" :title="row.state.pending ? '继续确认原重置' : '查看自动用卡计划'" :aria-label="`重置卡 ${row.account.name}`" :disabled="blocked || (!canReset(row) && !row.state.pending)" @click="openCards(row)"><TicketCheck :size="17" /></ZIconButton></div></template>
      </ZTable>
      <ZPagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[10, 20, 50, 100]" :disabled="loading && !rows.length" />
      <div v-if="snapshotAt" class="snapshot-time">最近读取宿主快照 {{ time(snapshotAt) }}</div>
    </div>

    <ResetCardsDialog v-if="selected" v-model="showCards" :row="selected"
      :confirmation="confirmation" :rules="rules" :blocked="blocked" :consuming="consuming"
      :error="error" @request="requestConfirmation" @cancel="confirmation = null" @confirm="confirmPending"
      @quota-policy="policy(selected, 'quotaCredits', $event)" @reset-policy="policy(selected, 'resetCards', $event)" />

    <ZDialog v-model="bulkDialog" :title="bulkChoice === 'quotaCredits' ? '批量设置自动使用额度点数' : '批量设置自动使用重置卡'" width="28rem">
      <p>当前筛选结果中有 {{ bulkTargets.length }} 个适用账号，已开启 {{ bulkEnabled }} 个</p>
      <p v-if="bulkChoice === 'resetCards'" class="text-cp-text-secondary">{{ resetCardTiming(rules) }}</p>
      <template #footer>
        <ZButton @click="bulkDialog = false">取消</ZButton>
        <ZButton :disabled="blocked || !bulkEnabled" @click="confirmBulkPolicy(false)">全部关闭</ZButton>
        <ZButton type="primary" :disabled="blocked || bulkEnabled === bulkTargets.length" @click="confirmBulkPolicy(true)">全部开启</ZButton>
      </template>
    </ZDialog>
    <ExportDialog v-model="showExport" :text="exportText" />
  </main>
</template>
