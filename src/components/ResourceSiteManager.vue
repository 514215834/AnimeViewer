<script setup lang="ts">
/** v0.24 SM1/SM2/SM4/SM5 自定义 RSS 站点管理弹窗（服务未配置时入口隐藏——父组件把关）：
 *  站点列表（内置/自定义标识 + 启停开关 SM5 + 行内编辑/删除）→ 添加/编辑表单（预设模板一键填入 +
 *  校验对齐后端规则）→ SM3 测试连通（不入库试搜：条目数 + 样例预览，失败给原因）→ 保存/删除经
 *  mediaService 即时生效（端点返回最新列表，emit changed 让资源搜索弹窗 chips 同步刷新——SM4）。
 *  增删改启用均需服务可用（站点存服务端 SQLite settings 表，v0.17 注册制）。 */
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import { AddOutline, FlashOutline } from '@vicons/ionicons5'
import {
  mediaService,
  type SvcResourceSite,
  type SvcResourceSiteTest,
} from '../api/mediaService'
import { clipboard } from '../utils/clipboard'
import { SITE_PRESETS, siteFormValid, validateSiteForm, type SiteForm } from '../utils/siteForm'

const props = defineProps<{
  show: boolean
  /** 站点列表（父组件持有，changed 事件同步刷新） */
  sites: SvcResourceSite[]
  /** 测试连通默认词（取资源搜索当前关键词/关联条目名） */
  defaultKeyword?: string
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'changed', sites: SvcResourceSite[]): void
}>()

const message = useMessage()

/* ── 列表与启停（SM5）── */

const busy = ref(false)

async function toggleEnabled(site: SvcResourceSite, v: boolean) {
  busy.value = true
  try {
    const sites = await mediaService.saveResourceSite({ ...site, enabled: v })
    emit('changed', sites)
    message.success(v ? `站点 ${site.key} 已启用` : `站点 ${site.key} 已停用（不参与搜索与订阅检索）`)
  } finally {
    busy.value = false
  }
}

/* ── 表单（SM2）── */

interface FormState {
  editing: boolean
  originKey: string | null
  form: SiteForm
  preset: string | null
}

const emptyForm = (): SiteForm => ({ key: '', name: '', baseUrl: '', searchTemplate: '' })
const formState = ref<FormState | null>(null)
const errors = ref<ReturnType<typeof validateSiteForm>>({})

function openAdd() {
  formState.value = { editing: false, originKey: null, form: emptyForm(), preset: null }
  errors.value = {}
}

function startEdit(site: SvcResourceSite) {
  formState.value = {
    editing: true,
    originKey: site.key,
    form: { key: site.key, name: site.name, baseUrl: site.baseUrl, searchTemplate: site.searchTemplate },
    preset: null,
  }
  errors.value = {}
}

function closeForm() {
  formState.value = null
  errors.value = {}
}

/** 预设选择：一键填入（key/name 未填时自动预填，均可手改覆盖） */
function onPresetChange(v: string | null) {
  const st = formState.value
  if (!st) return
  st.preset = v
  if (!v) return
  const p = SITE_PRESETS.find((x) => x.key === v)
  if (!p) return
  // 已编辑字段保留，空位自动预填（均可手改覆盖）
  st.form.key = st.form.key.trim() || p.key
  st.form.name = st.form.name.trim() || p.name
  st.form.baseUrl = p.baseUrl
  st.form.searchTemplate = p.searchTemplate
}

/* ── SM3 测试连通 ── */

const testing = ref(false)
const testResult = ref<SvcResourceSiteTest | null>(null)

async function runTest() {
  const st = formState.value
  if (!st || testing.value) return
  if (!siteFormValid(st.form)) {
    errors.value = validateSiteForm(st.form)
    message.warning('请先修正表单校验项')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await mediaService.testResourceSite({
      baseUrl: st.form.baseUrl.trim(),
      searchTemplate: st.form.searchTemplate.trim(),
    })
  } catch {
    testResult.value = { ok: false, error: '测试请求失败（服务不可达或超时）', itemCount: 0, samples: [] }
  } finally {
    testing.value = false
  }
}

/* ── 保存（SM4 即时生效）── */

async function submitSave() {
  const st = formState.value
  if (!st || busy.value) return
  const errs = validateSiteForm(st.form)
  errors.value = errs
  if (!siteFormValid(st.form)) {
    message.warning('请先修正表单校验项')
    return
  }
  busy.value = true
  try {
    const sites = await mediaService.saveResourceSite({
      key: st.form.key.trim().toLowerCase(),
      name: st.form.name.trim() || st.form.key.trim().toLowerCase(),
      baseUrl: st.form.baseUrl.trim(),
      searchTemplate: st.form.searchTemplate.trim(),
      builtin: false,
      enabled: true,
    })
    emit('changed', sites)
    message.success(st.editing ? `站点 ${st.form.key} 已更新` : '站点已添加，搜索与订阅检索即时生效')
    closeForm()
  } finally {
    busy.value = false
  }
}

/* ── v0.30 补记一 AI 解析站点配置（结果仅预填表单，测试连通与保存仍人工把关） ── */

const aiFilling = ref(false)

async function runAiFill() {
  const st = formState.value
  const text = st?.form.baseUrl.trim()
  if (!st || !text || aiFilling.value) return
  aiFilling.value = true
  try {
    const r = await mediaService.aiFillSite(text)
    if (r.baseUrl && r.searchTemplate) {
      st.form.baseUrl = r.baseUrl
      st.form.searchTemplate = r.searchTemplate
      st.form.key = st.form.key.trim() || (r.key ?? '')
      st.form.name = st.form.name.trim() || (r.name ?? '')
      message.success(r.message || 'AI 已推导站点配置（测试连通后保存）')
    } else {
      message.warning(r.message || '无法解析出站点配置')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : 'AI 解析失败（需先在设置页启用 AI）')
  } finally {
    aiFilling.value = false
  }
}

/* ── 删除（内置不可删）── */

async function removeSite(site: SvcResourceSite) {
  if (site.builtin || busy.value) return
  busy.value = true
  try {
    const sites = await mediaService.removeResourceSite(site.key)
    emit('changed', sites)
    message.success(`站点 ${site.key} 已删除`)
  } finally {
    busy.value = false
  }
}

/** 链接类型标签：磁力 / 种子 */
function linkKind(it: SvcResourceSiteTest['samples'][number]): 'magnet' | 'torrent' {
  return it.magnet ? 'magnet' : 'torrent'
}

async function copySample(it: SvcResourceSiteTest['samples'][number]) {
  await clipboard.write(it.magnet ?? it.torrentUrl ?? '')
  message.success('链接已复制')
}

/** 测试词：默认取资源搜索当前关键词（父组件传入），可编辑 */
const testKeyword = ref('')
watch(
  () => props.show,
  (show) => {
    if (!show) return
    testResult.value = null
    closeForm()
    testKeyword.value = props.defaultKeyword?.trim() ?? ''
  },
)

const formTitle = computed(() => (formState.value?.editing ? '编辑站点' : '添加站点'))
</script>

<template>
  <NModal
    :show="show"
    transform-origin="center"
    preset="card"
    title="RSS 站点管理"
    class="rsm-modal"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="rsm-toolbar">
      <span class="dim">内置站点不可删除、可停用；自定义站点可编辑/删除。停用站点不参与混合搜索与订阅检索。</span>
      <NButton size="small" type="primary" secondary @click="openAdd">
        <template #icon><NIcon :component="AddOutline" /></template>
        添加站点
      </NButton>
    </div>

    <!-- 站点列表 -->
    <div v-if="sites.length" class="rsm-list">
      <div v-for="s in sites" :key="s.key" class="rsm-row">
        <NSwitch
          size="small"
          :value="s.enabled !== false"
          :disabled="busy"
          @update:value="(v: boolean) => toggleEnabled(s, v)"
        />
        <div class="rsm-main">
          <div class="rsm-name">
            {{ s.name }}
            <NTag size="tiny" round :bordered="false" :type="s.builtin ? 'default' : 'info'">
              {{ s.builtin ? '内置' : '自定义' }}
            </NTag>
            <NTag v-if="s.enabled === false" size="tiny" round :bordered="false" type="warning">已停用</NTag>
          </div>
          <div class="rsm-dim" :title="`${s.baseUrl} + ${s.searchTemplate}`">{{ s.baseUrl }} · {{ s.searchTemplate }}</div>
        </div>
        <div class="rsm-ops">
          <NButton size="tiny" quaternary :disabled="busy" @click="startEdit(s)">编辑</NButton>
          <NPopconfirm v-if="!s.builtin" @positive-click="removeSite(s)">
            <template #trigger>
              <NButton size="tiny" quaternary type="error" :disabled="busy">删除</NButton>
            </template>
            删除站点 {{ s.key }}？（仅删除站点配置，不影响已下载资源）
          </NPopconfirm>
        </div>
      </div>
    </div>
    <NEmpty v-else description="暂无站点（内置站点拉取失败或全部已删除）" size="small" class="rsm-empty" />

    <!-- 添加/编辑表单（嵌套卡片弹层） -->
    <NModal
      :show="!!formState"
      transform-origin="center"
      preset="card"
      :title="formTitle"
      class="rsm-form"
      @update:show="(v: boolean) => !v && closeForm()"
    >
      <div v-if="formState">
        <div class="rsm-field">
          <span class="rsm-label">预设模板（可一键填入后手改）</span>
          <NSelect
            :value="formState.preset"
            clearable
            placeholder="选择预设站点模板"
            size="small"
            :options="SITE_PRESETS.map((p) => ({ label: `${p.name}${p.hint ? ` · ${p.hint}` : ''}`, value: p.key }))"
            @update:value="onPresetChange"
          />
        </div>

        <div class="rsm-field">
          <span class="rsm-label">站点标识 key（1~24 位小写字母/数字/连字符/下划线，相同 key 覆盖）</span>
          <NInput
            v-model:value="formState.form.key"
            size="small"
            :disabled="busy"
            placeholder="如 nyaa / dmhy-backup"
            :status="errors.key ? 'error' : undefined"
          />
          <span v-if="errors.key" class="rsm-error">{{ errors.key }}</span>
        </div>

        <div class="rsm-field">
          <span class="rsm-label">显示名称（可空，缺省用 key）</span>
          <NInput v-model:value="formState.form.name" size="small" :disabled="busy" placeholder="如 動漫花園镜像" />
        </div>

        <div class="rsm-field">
          <span class="rsm-label">站点地址（http(s)://）</span>
          <div class="rsm-test-row">
            <NInput
              v-model:value="formState.form.baseUrl"
              size="small"
              :disabled="busy"
              placeholder="https://example.org"
              :status="errors.baseUrl ? 'error' : undefined"
              @keyup.enter="runAiFill"
            />
            <!-- v0.30 补记一：贴站点地址后 AI 推导其余参数（名称/搜索模板/key），仅预填人工把关 -->
            <NButton
              size="small"
              secondary
              :disabled="!formState.form.baseUrl.trim() || busy"
              :loading="aiFilling"
              title="从站点地址推导名称与搜索模板（已知站点规则映射优先，未知站点 AI 兜底；结果仅预填，测试连通后保存）"
              @click="runAiFill"
            >AI 解析</NButton>
          </div>
          <span v-if="errors.baseUrl" class="rsm-error">{{ errors.baseUrl }}</span>
        </div>

        <div class="rsm-field">
          <span class="rsm-label">搜索模板（必须含 {kw} 占位符，关键词将百分号编码替换）</span>
          <NInput
            v-model:value="formState.form.searchTemplate"
            size="small"
            :disabled="busy"
            placeholder="如 rss.xml?keyword={kw} 或 ?page=rss&q={kw}"
            :status="errors.searchTemplate ? 'error' : undefined"
          />
          <span v-if="errors.searchTemplate" class="rsm-error">{{ errors.searchTemplate }}</span>
        </div>

        <div class="rsm-field">
          <span class="rsm-label">测试词（缺省「新番」；保存前建议先测试连通与解析）</span>
          <div class="rsm-test-row">
            <NInput v-model:value="testKeyword" size="small" :disabled="testing" placeholder="新番" />
            <NButton size="small" secondary :loading="testing" @click="runTest">
              <template #icon><NIcon :component="FlashOutline" /></template>
              测试连通
            </NButton>
          </div>
        </div>

        <!-- 测试结果预览 -->
        <div v-if="testResult" class="rsm-test-result" :class="testResult.ok ? 'ok' : 'fail'">
          <template v-if="testResult.ok">
            <div class="rsm-test-head">✅ 可用：解析出 {{ testResult.itemCount }} 条资源</div>
            <div v-for="it in testResult.samples" :key="it.infoHash || it.magnet || it.torrentUrl" class="rsm-sample">
              <span class="rsm-sample-title" :title="it.title">{{ it.title }}</span>
              <NTag size="tiny" round :bordered="false" :type="linkKind(it) === 'magnet' ? 'success' : 'info'">
                {{ linkKind(it) === 'magnet' ? '磁力' : '种子' }}
              </NTag>
              <span v-if="it.size" class="rsm-dim">{{ it.size }}</span>
              <NButton size="tiny" quaternary @click="copySample(it)">复制</NButton>
            </div>
            <div v-if="!testResult.samples.length" class="rsm-dim">站点可达但本次测试词无结果（可换个测试词）</div>
          </template>
          <template v-else>
            <div class="rsm-test-head">❌ 不可用：{{ testResult.error }}</div>
            <div class="rsm-dim">可尝试：检查地址/模板是否正确 · 该站可能开启反爬（403） · 需服务端代理可达</div>
          </template>
        </div>
      </div>

      <template #footer>
        <div class="rsm-footer">
          <NButton quaternary :disabled="busy" @click="closeForm">取消</NButton>
          <NButton type="primary" round :loading="busy" @click="submitSave">
            {{ formState?.editing ? '保存修改' : '添加站点' }}
          </NButton>
        </div>
      </template>
    </NModal>
  </NModal>
</template>

<style scoped>
.rsm-modal {
  width: 640px;
  max-width: calc(100vw - 32px);
}

.rsm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.rsm-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 380px;
  overflow: auto;
}

.rsm-list > div {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
}

.rsm-list > div:hover {
  background: var(--av-primary-soft);
}

.rsm-main {
  flex: 1;
  min-width: 0;
}

.rsm-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.rsm-dim {
  color: var(--av-text-tertiary);
  font-size: 11.5px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rsm-ops {
  display: flex;
  gap: 4px;
  flex: none;
}

.rsm-empty {
  padding: 20px 0;
}

.rsm-form {
  width: 560px;
  max-width: calc(100vw - 32px);
}

.rsm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.rsm-label {
  font-size: 12px;
  color: var(--av-text-secondary);
}

.rsm-test-row {
  display: flex;
  gap: 8px;
}

.rsm-test-result {
  border: 1px solid var(--av-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
}

.rsm-test-result.ok {
  border-color: color-mix(in srgb, #2e9e5b 40%, var(--av-border));
}

.rsm-test-result.fail {
  border-color: rgba(230, 90, 90, 0.4);
}

.rsm-test-head {
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 6px;
}

.rsm-sample {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
}

.rsm-sample-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rsm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
