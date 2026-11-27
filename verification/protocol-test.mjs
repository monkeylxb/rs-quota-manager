import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const executable = process.platform === 'win32' ? 'quota-manager.exe' : 'quota-manager'
const binary = process.argv[2] || fileURLToPath(new URL(`../backend/target/debug/${executable}`, import.meta.url))
const protocolVersion = 7
const contributes = {
  management: { id: 'personal.quota-manager.management', version: 2, stages: ['management'], inputFormats: [], outputFormats: [] },
}
const stamp = Date.now()
const account = (id, enabled = true, plan = 'team') => ({ account_id: id, provider_id: 'openai', name: `team+${id}+2026/10/28+workspace3`, email: `${id}@example.com`, group_ids: [], enabled, updated_at_ms: stamp, plan })
const accounts = [account('acct_001'), account('acct_002', false), account('acct_003'), account('acct_004'), account('acct_005'), account('acct_006', true, 'free'), account('acct_007', true, ' Free '), account('acct_008', true, 'plus')]
accounts[7].name = 'free-prefix-but-paid-plus@example.com'
const antigravity = { ...account('acct_google', true, 'g1-pro-tier'), provider_id: 'antigravity', name: 'Google OAuth', planDisplay: 'Google AI Pro' }
const quota = (id, used = 25, key = 'codex:604800s', seconds = 604800) => ({ schema_version: 1, account_id: id, observed_at_ms: Date.now(), windows: [{ key, window_seconds: seconds, used_percent: used, reset_at_ms: stamp + 86400000 }] })
const quotas = new Map(accounts.map(a => [a.account_id, quota(a.account_id)]))
const balances = new Map([['acct_001', '0'], ['acct_002', '12.50']])
const useQuotaCredits = new Map([['acct_002', true]]), useResetCards = new Map()
const policyWrites = [], quotaFactReads = []
let resetCardSettings = { resetCreditOnLowWeeklyQuota: false, resetCreditLeadMinutes: 15, resetCreditMaxWeeklyRemainingPercent: 25 }
const legacyState = {
  subscription: { startsAt: null, expiresAt: '2026-11-20T00:00:00Z', observedAt: new Date(stamp).toISOString() },
  subscriptionCheckedAtMs: stamp,
  cards: { availableCount: 1, credits: [{ id: 'old-card', status: 'available', expiresAt: '2026-12-20T00:00:00Z' }] },
  cardsObservedAtMs: stamp, cardsCheckedAtMs: stamp,
  error: '重置卡查询失败，保留上次快照', pending: null, awaitingRecovery: false, lastAttemptAtMs: null, history: [],
}
const records = new Map(), posts = [], reads = [], handles = new Map()
const seedState = (id, value) => records.set(`account/${id}`, { value, version: 1, schema_version: 1 })
const runtimeAccount = a => ({ account_id: a.account_id, provider_id: a.provider_id, name: a.name, email: a.email, enabled: a.enabled,
  credential_revision: 1, upstream_user_id: null, upstream_account_id: null, plan_type: a.plan, authentication_kind: 'oauth', credential_state: 'ready', has_refresh_token: true, access_token_expires_at_ms: null, next_refresh_at_ms: null })
let consumeMode = 'reset', child, buffered, pending, ready, sequence = 99, errors = '', settingsUnavailable = false, incarnation, handleSequence = 0

function send(meta, data, payload = Buffer.alloc(0)) {
  if (!(payload instanceof Buffer)) payload = Buffer.from(JSON.stringify(payload))
  if (data !== undefined) {
    const dataBytes = Buffer.from(JSON.stringify(data))
    meta = { ...meta, data_bytes: dataBytes.length }
    payload = Buffer.concat([dataBytes, payload])
  }
  const json = Buffer.from(JSON.stringify(meta)), header = Buffer.alloc(12)
  header.writeUInt32BE(json.length); header.writeBigUInt64BE(BigInt(payload.length), 4)
  child.stdin.write(Buffer.concat([header, json, payload]))
}
function result(id, value = {}, payload = Buffer.alloc(0)) { send({ type: 'result', id }, value, payload) }
function error(id, code = 'rejected') { send({ type: 'error', id, error: { code, message: 'mock rejection', send_state: 'not_sent' } }) }
async function callback(meta, params, payload) {
  reads.push(meta.method)
  const data = payload.length ? JSON.parse(payload.toString()) : params
  if (meta.method === 'host.data.quota.details') {
    quotaFactReads.push(data.account_id)
    const q = structuredClone(quotas.get(data.account_id))
    q.limit_reached = false
    q.windows = q.windows.map(window => ({ ...window, group: window.key.split(':')[0], label: '周限', limit_reached: false }))
    q.credits = { has_credits: true, unlimited: false, balance: balances.get(data.account_id) ?? null }
    return result(meta.id, {}, q)
  }
  if (meta.method === 'host.auth.get_runtime') {
    const a = accounts.find(a => a.account_id === data.account_id)
    return result(meta.id, {}, runtimeAccount(a))
  }
  if (meta.method === 'host.state.get') return result(meta.id, { record: records.get(data.key) ?? null })
  if (meta.method === 'host.state.put') {
    const existing = records.get(data.key)
    if ((existing?.version ?? null) !== data.expected_version) return error(meta.id, 'conflict')
    const version = (existing?.version ?? 0) + 1
    records.set(data.key, { value: structuredClone(data.value), version, schema_version: 1 })
    return result(meta.id, { version })
  }
  if (meta.method === 'host.services.call') {
    const { operation, input } = data
    let id = input
    if (operation === 'accounts.set_reset_credit_automation') {
      const [accountId, enabled] = input
      id = accountId
      assert.equal(typeof enabled, 'boolean')
      useResetCards.set(id, enabled)
      policyWrites.push({ id, key: 'resetCards', enabled })
    } else assert.equal(operation, 'accounts.reset_credit_automation_status')
    const enabled = useResetCards.get(id) ?? false
    return result(meta.id, { Ok: { enabled, lead_minutes: 15, weekly_trigger_remaining_percent: null, next_discovery_at: null, next_consume_at: enabled ? '2026-12-01T18:00:00Z' : null, last_result: null } })
  }
  if (meta.method === 'host.http.dispatch') {
    const url = new URL(params.uri, 'http://mock.invalid'), id = url.searchParams.get('accountId') || data.accountId
    let envelope
    if (url.pathname === '/api/admin/settings') {
      assert.equal(params.method, 'GET')
      if (settingsUnavailable) return error(meta.id)
      envelope = { code: 200, data: { ...resetCardSettings, unrelated: 'settings-private-marker' } }
    } else if (url.pathname === '/api/admin/accounts') {
      assert.equal(params.method, 'GET')
      assert.equal(url.searchParams.get('pageSize'), '20')
      const offset = (Number(url.searchParams.get('page')) - 1) * 2
      const items = accounts.slice(offset, offset + 2).map(a => ({
        id: a.account_id, name: a.name, email: a.email, enabled: a.enabled, provider: a.provider_id,
        authenticationKind: 'oauth', planType: a.plan, planTypeDisplay: a.planDisplay ?? (a.plan === 'team' ? 'Team' : a.plan),
        autoUseQuotaCredits: useQuotaCredits.get(a.account_id) ?? false,
        capabilities: {
          quotaCredits: a.account_id !== 'acct_008',
          resetCredits: a !== antigravity && a.account_id !== 'acct_008',
          consumeResetCredit: a !== antigravity && a.account_id !== 'acct_008',
        },
      }))
      envelope = { code: 200, data: { items, page: { totalPages: Math.ceil(accounts.length / 2) } } }
    } else if (url.pathname === '/api/admin/accounts/batch-update') {
      assert.equal(params.method, 'POST')
      const [accountId] = data.accountIds
      assert.deepEqual(data, { accountIds: [accountId], autoUseQuotaCredits: data.autoUseQuotaCredits })
      assert.equal(typeof data.autoUseQuotaCredits, 'boolean')
      useQuotaCredits.set(accountId, data.autoUseQuotaCredits)
      policyWrites.push({ id: accountId, key: 'quotaCredits', enabled: data.autoUseQuotaCredits })
      envelope = { code: 200, data: { accountIds: [accountId] } }
    } else {
      assert.equal(url.pathname, '/api/admin/accounts/reset-credits')
      assert.equal(params.method, 'POST')
      const state = records.get(`account/${id}`).value
      assert.equal(state.pending.requestId, data.redeemRequestId, 'Pending UUID must be durable before POST')
      assert.equal(state.pending.creditId, data.creditId)
      assert.match(data.redeemRequestId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
      posts.push(structuredClone(data))
      if (consumeMode === 'uncertain') return error(meta.id, 'uncertain')
      if (consumeMode === 'invalid') envelope = { code: 200, message: 'ok', data: {} }
      else envelope = { code: 200, message: 'ok', data: { code: consumeMode, credit: null } }
    }
    const handle = `body_${++handleSequence}`; handles.set(handle, Buffer.from(JSON.stringify(envelope)))
    return result(meta.id, { status: 200, version: 'HTTP/1.1', headers: [], body: { kind: 'handle', handle }, response: null, session: false })
  }
  if (meta.method === 'host.http.body_read') {
    const value = handles.get(params.handle)
    if (value) { handles.delete(params.handle); return result(meta.id, { eof: false, trailers: null }, value) }
    return result(meta.id, { eof: true, trailers: null })
  }
  if (meta.method === 'host.http.body_close') return result(meta.id, {})
  throw new Error(`Unhandled callback: ${meta.method}`)
}
function parse() {
  while (buffered.length >= 12) {
    const m = buffered.readUInt32BE(), p = Number(buffered.readBigUInt64BE(4)), total = 12 + m + p
    if (buffered.length < total) return
    const meta = JSON.parse(buffered.subarray(12, 12 + m).toString())
    const dataStart = 12 + m + (meta.request_context_bytes ?? 0)
    const dataEnd = dataStart + (meta.data_bytes ?? 0)
    assert.ok(dataEnd <= total)
    const data = meta.data_bytes ? JSON.parse(buffered.subarray(dataStart, dataEnd).toString()) : undefined
    const payload = buffered.subarray(dataEnd, total)
    buffered = buffered.subarray(total)
    if (meta.type === 'ready') {
      assert.equal(meta.protocol_version, protocolVersion)
      assert.equal(meta.incarnation, incarnation)
      ready.resolve()
    }
    else if (meta.type === 'callback') {
      assert.ok(pending.has(meta.parent_id))
      callback(meta, data, payload).catch(e => { ready.reject(e); for (const x of pending.values()) x.reject(e) })
    }
    else if (meta.type === 'suspend') {
      const waiter = pending.get(meta.id)
      assert.ok(waiter && !waiter.suspended)
      assert.equal(meta.epoch, ++waiter.epoch)
      waiter.suspended = true
    }
    else if (meta.type === 'resume') {
      const waiter = pending.get(meta.id)
      assert.ok(waiter?.suspended)
      assert.equal(meta.epoch, waiter.epoch)
      waiter.suspended = false
      send({ type: 'resumed', id: meta.id, epoch: meta.epoch })
    }
    else if (meta.type === 'result' || meta.type === 'error') {
      const waiter = pending.get(meta.id)
      if (waiter) { pending.delete(meta.id); meta.type === 'error' ? waiter.reject(new Error(JSON.stringify(meta.error))) : waiter.resolve({ result: data, payload }) }
    }
  }
}
async function start() {
  buffered = Buffer.alloc(0); pending = new Map(); ready = Promise.withResolvers(); errors = ''; incarnation = `test_${Date.now()}`
  child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { buffered = Buffer.concat([buffered, data]); parse() })
  child.stderr.on('data', data => { errors += data }); child.on('error', e => ready.reject(e))
  child.on('exit', code => { if (code) { const e = new Error(`Plugin exited ${code}: ${errors}`); ready.reject(e); for (const w of pending.values()) w.reject(e) } })
  send({ type: 'hello', handshake: { protocol_version: protocolVersion, artifact_sha256: 'a'.repeat(64), plugin_id: 'personal.quota-manager', instance_id: 'test_instance', generation: 1, incarnation, contributes } }, {})
  await Promise.race([ready.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Handshake timeout: ${errors}`)), 10000).unref())])
}
async function stop() { const exited = new Promise(resolve => child.once('exit', resolve)); send({ type: 'shutdown' }); child.stdin.end(); await exited }
async function call(method, params = {}, payload = Buffer.alloc(0), stage = 'management') {
  const id = sequence += 2, waiter = Promise.withResolvers(); pending.set(id, waiter)
  waiter.epoch = 0
  waiter.suspended = false
  const timeoutMs = stage === 'registration' ? 5000 : 60000
  send({ type: 'call', id, method, context: { call_id: id, instance_id: 'test_instance', generation: 1, incarnation, stage, timeout_ms: timeoutMs, resource_stream: false, resource_scope_id: `scope_${id}` } }, params, payload)
  return Promise.race([waiter.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Call timeout ${method}: ${errors}`)), 10000).unref())])
}
async function request(path, body, query = '') {
  const reply = await call('management.handle', { method: body === undefined ? 'GET' : 'POST', path, query, content_type: body === undefined ? null : 'application/json', headers: [] }, body === undefined ? Buffer.alloc(0) : body)
  return { status: reply.result.status, value: JSON.parse(reply.payload.toString()) }
}
const passed = [], check = label => { passed.push(label); console.log(`PASS ${label}`) }
try {
  seedState('acct_001', legacyState)
  await start()
  const pluginRegistration = await call('plugin.register', {}, Buffer.alloc(0), 'registration')
  assert.deepEqual(pluginRegistration.result.contributes, contributes)
  const registrationReply = await call('management.register', {}, Buffer.alloc(0), 'registration')
  const registration = JSON.parse(registrationReply.payload.toString())
  assert.equal(registration.pages[0].entry, 'web/index.html')
  assert.deepEqual(registration.routes.map(({ method, path }) => [method, path]), [
    ['GET', 'api/accounts'],
    ['GET', 'api/status'],
    ['POST', 'api/auto-use-quota-credits'],
    ['POST', 'api/auto-use-reset-cards'],
    ['POST', 'api/retry'],
  ])
  check('RPC v7 registers management only, with read-only snapshot routes')

  const page = await request('api/accounts')
  assert.equal(page.status, 200)
  assert.equal(page.value.nextPage, 2)
  assert.deepEqual(page.value.accounts.map(r => r.account.account_id), ['acct_001', 'acct_002'])
  const [first, second] = page.value.accounts
  assert.equal(first.account.name, accounts[0].name)
  assert.equal(first.account.plan_type_display, 'Team')
  assert.equal(first.quota.credits.balance, '0')
  assert.equal(second.quota.credits.balance, '12.50')
  assert.equal(second.account.enabled, false)
  assert.equal(second.autoUseQuotaCredits, true)
  assert.equal(second.resetCardAutomation.enabled, false)
  assert.equal(first.state.error, null)
  assert.ok(!('subscription' in first.state) && !('cards' in first.state))
  assert.equal(records.get('account/acct_001').version, 1)
  check('Snapshot reads host facts and hides legacy caches without rewriting settled state')

  const mixed = await request('api/accounts', undefined, 'page=3')
  assert.deepEqual(mixed.value.accounts.map(r => r.account.account_id), ['acct_005'])
  assert.equal(mixed.value.nextPage, 4)
  const last = await request('api/accounts', undefined, 'page=4')
  assert.equal(last.value.nextPage, null)
  assert.deepEqual(last.value.accounts.map(r => r.account.account_id), ['acct_008'])
  assert.equal(last.value.accounts[0].autoUseQuotaCredits, null)
  assert.equal(last.value.accounts[0].resetCardAutomation, null)
  assert.ok(!quotaFactReads.some(id => id === 'acct_006' || id === 'acct_007'))
  check('Free accounts are excluded and unsupported switches stay unavailable')

  for (const path of ['api/refresh', 'api/refresh-cards', 'api/consume']) {
    const callbacksBefore = reads.length
    assert.equal((await request(path, { accountId: 'acct_001' })).status, 400)
    assert.equal(reads.length, callbacksBefore)
  }
  for (const path of ['api/auto-use-quota-credits', 'api/auto-use-reset-cards']) {
    assert.equal((await request(path, { accountId: 'acct_006', enabled: true })).status, 400)
  }
  assert.deepEqual(policyWrites, [])
  assert.equal(posts.length, 0)
  check('Removed refresh and consumption routes make no host calls; Free flags are rejected')

  const setQuotaCredits = enabled => request('api/auto-use-quota-credits', { accountId: 'acct_001', enabled })
  const setResetCards = enabled => request('api/auto-use-reset-cards', { accountId: 'acct_001', enabled })
  const readFirst = async () => (await request('api/accounts')).value.accounts[0]
  assert.deepEqual((await setQuotaCredits(true)).value, { enabled: true })
  assert.equal((await readFirst()).autoUseQuotaCredits, true)
  assert.equal((await readFirst()).resetCardAutomation.enabled, false)
  assert.equal((await setResetCards(true)).value.next_consume_at, '2026-12-01T18:00:00Z')
  assert.deepEqual((await setQuotaCredits(false)).value, { enabled: false })
  assert.equal((await readFirst()).autoUseQuotaCredits, false)
  assert.equal((await readFirst()).resetCardAutomation.enabled, true)
  assert.equal(useQuotaCredits.get('acct_002'), true)
  assert.equal(useResetCards.has('acct_002'), false)
  check('Both account switches still use the native host settings')

  accounts.push(antigravity)
  quotas.set(antigravity.account_id, quota(antigravity.account_id, 25, 'gemini:604800s'))
  balances.set(antigravity.account_id, '125')
  const readAntigravity = async () => (await request('api/accounts', undefined, 'page=5')).value.accounts[0]
  const google = await readAntigravity()
  assert.equal(google.account.provider_id, 'antigravity')
  assert.equal(google.account.plan_type_display, 'Google AI Pro')
  assert.equal(google.quota.credits.balance, '125')
  assert.equal(google.autoUseQuotaCredits, false)
  assert.equal(google.resetCardAutomation, null)
  const writesBefore = policyWrites.length
  const change = await request('api/auto-use-quota-credits', { accountId: antigravity.account_id, enabled: true })
  assert.equal(change.status, 200)
  assert.deepEqual(change.value, { enabled: true })
  assert.deepEqual(policyWrites.slice(writesBefore), [{ id: antigravity.account_id, key: 'quotaCredits', enabled: true }])
  assert.equal((await readAntigravity()).autoUseQuotaCredits, true)
  assert.equal((await readAntigravity()).resetCardAutomation, null)
  assert.equal(posts.length, 0)
  check('Antigravity credits follow the host capability without exposing reset-card automation')

  const loaded = await request('api/status')
  assert.deepEqual(loaded.value, { resetCardSettings })
  resetCardSettings = { ...resetCardSettings, resetCreditOnLowWeeklyQuota: true }
  assert.deepEqual((await request('api/status')).value.resetCardSettings, resetCardSettings)
  settingsUnavailable = true
  assert.equal((await request('api/status')).value.resetCardSettings, null)
  settingsUnavailable = false
  check('Status only returns the current native reset rules')

  const original = {
    requestId: 'c85eac15-2fde-4d55-92bd-f328f272f40b', creditId: 'original-card',
    startedAtMs: stamp, automatic: false,
  }
  seedState('acct_004', { ...legacyState, pending: original, error: '消费结果待确认，请确认原操作' })
  const retry = (accountId, requestId) => request('api/retry', { accountId, requestId })
  assert.equal((await retry('acct_001', original.requestId)).status, 400)
  assert.equal((await retry('acct_004', 'other-request')).status, 400)
  assert.equal(posts.length, 0)
  consumeMode = 'uncertain'
  const unknown = await retry('acct_004', original.requestId)
  assert.deepEqual(unknown.value.state.pending, original)
  assert.equal(posts.length, 1)
  accounts[3].plan = 'free'
  const downgraded = await request('api/accounts', undefined, 'page=2')
  assert.ok(!downgraded.value.accounts.some(r => r.account.account_id === 'acct_004'))
  assert.deepEqual(downgraded.value.excludedPending[0].state.pending, original)
  check('Only a durable original request can be confirmed, including after downgrade')

  await stop()
  await start()
  consumeMode = 'already_redeemed'
  const confirmed = await retry('acct_004', original.requestId)
  assert.equal(confirmed.status, 200)
  assert.deepEqual(posts[0], posts[1])
  assert.equal(confirmed.value.state.pending, null)
  assert.equal(confirmed.value.state.history[0].code, 'already_redeemed')
  assert.equal(confirmed.value.state.awaitingRecovery, true)
  assert.equal(confirmed.value.quota.windows[0].used_percent, 25)
  assert.equal((await retry('acct_004', original.requestId)).status, 400)
  assert.equal(posts.length, 2)
  check('Process restart preserves the original operation; confirmation uses the existing quota observation')

  const lastAttemptAtMs = confirmed.value.state.lastAttemptAtMs
  seedState('acct_001', { ...legacyState, awaitingRecovery: true, lastAttemptAtMs })
  quotas.set('acct_001', { ...quota('acct_001', 25), observed_at_ms: lastAttemptAtMs })
  assert.equal((await readFirst()).state.awaitingRecovery, true)
  assert.equal(records.get('account/acct_001').version, 1)
  quotas.set('acct_001', { ...quota('acct_001', 25), observed_at_ms: lastAttemptAtMs + 1 })
  assert.equal((await readFirst()).state.awaitingRecovery, false)
  assert.equal(records.get('account/acct_001').version, 2)
  assert.equal((await readFirst()).state.awaitingRecovery, false)
  assert.equal(records.get('account/acct_001').version, 2)
  check('Recovery can settle on page read using a newer host observation with a single state write')

  const other = { ...original, requestId: 'ba2dec15-2fde-4d55-92bd-f328f272f40c' }
  seedState('acct_005', { ...legacyState, pending: other })
  for (const mode of ['invalid', 'unexpected_code']) {
    consumeMode = mode
    assert.deepEqual((await retry('acct_005', other.requestId)).value.state.pending, other)
  }
  assert.ok(!reads.includes('host.auth.get') && !reads.includes('host.auth.save'))
  check('Invalid outcomes preserve the pending operation without reading raw credentials')

  await stop()
  console.log(JSON.stringify({ passed: passed.length, tests: passed, mockRedemptions: posts.length, productionRequests: 0 }, null, 2))
} catch (e) { child?.kill(); console.error(e); process.exitCode = 1 }
