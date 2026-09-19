<script setup lang="ts">
/** v0.13 PL1/PL3 沉浸播放页（独立路由，无侧边栏）：解析绑定 → 拿到可播放源 →
 *  VideoPlayer 播放；进度持久化（续播记忆）+ ≥95% 自然看完自动复用 E1 链路标记看过。
 *  文件型绑定跨会话需恢复授权（浏览器安全模型）：授权失效时给出重授权/重绑引导。
 *  v0.14：新增媒体服务源（?file=服务文件ID）——mp4 直连 Range 流；mkv 等容器走服务端
 *  ffmpeg 转封装「直播式」流，seek 以 ?t= 重拉（seekBase 记录流起点，进度换算回绝对时间）。
 *  v0.15：URL 型绑定扩展为 直链/HLS（hls.js）/WebDAV 三类在线源；直连失败自动经服务代理
 *  重试一次（CORS 容灾）；弹幕按「条目+话数」维度加载与导入（dm: 存储，与源解耦）。
 *  v0.23 SB0：mkv 播放源三层策略——直发优先（探测通过，native seek/duration）、
 *  video error 自动降级转封装管道流重试一次（O1 同款模式，lastPosition 续播）；
 *  SB1 内封字幕轨枚举 + VTT 提取（ArtPlayer subtitle，默认自动选第一中文轨）；
 *  SB2 本地外挂 srt/vtt（绑定时的同目录探测成果从 IDB 读出加载）；SB3 WebDAV 同名字幕
 *  经 O2 代理拉取转 VTT；SB4 自动连播（设置开关）+ 上/下一集；SB5 跳过片头（按条目记忆）。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { NButton, NIcon, NInputNumber, NPopover, NSpin } from 'naive-ui'
import { ArrowBackOutline, LinkOutline, PlayOutline, PlayForwardOutline, PlayBackOutline } from '@vicons/ionicons5'
import { dataSource } from '../api/dataSource'
import { mediaService, isDirectExt, servicePositionId, type SvcFile, type SvcHanimeSource } from '../api/mediaService'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { useSyncStore } from '../stores/sync'
import { DEFAULT_INTRO_SEC, isWatchedComplete, positionIdOf } from '../utils/mediaCore'
import { pickDefaultTrack, srtToVtt, trackLabel, type SubtitleEntry, type SubtitleTrack } from '../utils/subtitle'
import { appendDanmaku, parseDanmakuXml, type DanmakuItem } from '../utils/danmaku'
import {
  getBinding,
  getDanmaku,
  getFileRecord,
  getIntro,
  getPosition,
  getSubtitle,
  saveDanmaku,
  savePosition,
  setIntro,
} from '../utils/mediaStore'
import VideoPlayer from '../components/VideoPlayer.vue'
import EmptyHint from '../components/EmptyHint.vue'

const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const library = useLibraryStore()
const sync = useSyncStore()

const loading = ref(true)
/** 页面级错误（无绑定 / 句柄丢失 / 授权失败 / 服务不可达）：展示引导而非播放器 */
const fatal = ref('')
/** 授权可恢复（句柄还在，仅本会话未授权）——展示「重新授权」按钮而非重绑 */
const needPermission = ref(false)

const subjectId = computed(() => Number(route.query.subject) || 0)
const sort = computed(() => Number(route.query.sort) || 0)
/** v0.14 服务媒体库文件 ID（存在即走服务源） */
const fileId = computed(() => Number(route.query.file) || 0)
/** v0.26 HN5 在线解析视频码（显式参数触发在线源分支；不携带时既有源链行为零变化） */
const onlineCode = computed(() => String(route.query.online ?? ''))

const bindingName = ref('')
const videoTitle = ref('')
const videoSrc = ref('')
const startAt = ref(0)
/** v0.14 是否为服务端转封装流（seek 重拉模式）。v0.23 SB0b：mkv 直发失败时由 false 翻转为 true 重试 */
const remux = ref(false)
/** v0.15 O1 在线源（直链/HLS）：原始地址 + 是否已切换为服务代理 */
const urlSource = ref('')
const onlineProxied = ref(false)
/** v0.15 O4 弹幕（按条目+话数加载，全部源类型可用） */
const danmakuItems = ref<DanmakuItem[]>([])
const dmInput = ref<HTMLInputElement | null>(null)
/** v0.23 字幕轨列表（服务源内封轨 / 本地外挂 / 演示内置） */
const subtitleEntries = ref<SubtitleEntry[]>([])
/** v0.23 SB5 片头时长（秒，0=关） */
const introSec = ref(DEFAULT_INTRO_SEC)
const introDraft = ref(DEFAULT_INTRO_SEC)
/** v0.23 SB4 剧集导航：当前条目正篇话数（按 sort 升序） */
const epSorts = ref<number[]>([])
/** 进度持久化的位置标识 */
let positionId = ''
let objectUrl = ''
/** v0.23 字幕 VTT blob 地址（退出时统一回收） */
let subObjectUrl = ''
/** 每次播放会话只自动标记一次 */
let autoMarked = false
/** v0.14 转封装流的起点（绝对时间）：进度 = seekBase + 流内时间 */
let seekBase = 0
/** 最近一次上报的播放位置（代理重试重建播放器时作为续播起点） */
let lastPosition = 0
/** v0.23 SB0b 服务源直发→转封装降级只重试一次 */
let svcFallbackUsed = false
/** v0.23 SB0b 服务源文件详情（降级时需要 durationSec 判定续播点） */
let svcFile: SvcFile | null = null
/** v0.26 HN5 在线解析源：当前视频码 + 清晰度档列表（VideoPlayer 设置面板切换） */
const hanimeCode = ref('')
const hanimeSources = ref<SvcHanimeSource[]>([])
const hanimeRes = ref(0)
/** 清晰度菜单（>1 档才注入设置面板） */
const qualityOptions = computed(() =>
  hanimeSources.value.length > 1 ? hanimeSources.value.map((s) => ({ label: s.label, res: s.res })) : undefined,
)

/** PL5 演示视频资源（用户提供的内置样例，播放时才请求） */
const demoClipUrl = new URL('../assets/demo-clip.mp4', import.meta.url).href
/** v0.23 SB2 演示内置字幕（走查字幕链路：选择/开关/切换） */
const demoSubUrl = new URL('../assets/demo-subtitle.vtt', import.meta.url).href

/** 取源序号：参数快速变化时丢弃过期结果，防止旧响应覆盖新状态 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  fatal.value = ''
  needPermission.value = false
  autoMarked = false
  videoSrc.value = ''
  startAt.value = 0
  remux.value = false
  urlSource.value = ''
  onlineProxied.value = false
  lastPosition = 0
  seekBase = 0
  svcFallbackUsed = false
  svcFile = null
  hanimeCode.value = ''
  hanimeSources.value = []
  hanimeRes.value = 0
  releaseSubtitleUrl()
  subtitleEntries.value = []
  try {
    if (!subjectId.value || !sort.value) {
      fatal.value = '缺少条目或集数参数'
      return
    }
    // v0.15 O4 弹幕与源无关，全部源类型可用（导入入口在 meta 行）
    danmakuItems.value = await getDanmaku(subjectId.value, sort.value)
    if (seq !== loadSeq) return
    // v0.23 SB4/SB5 副资料并行预取（剧集列表 / 片头记忆），失败静默不影响播放
    void loadEpSorts()
    void loadIntro()
    if (onlineCode.value) {
      // v0.26 HN5 显式在线参数优先（用户从剧集行「在线」主动选择）
      await loadOnlineSource(seq, onlineCode.value)
    } else if (fileId.value) {
      await loadServiceSource(seq)
    } else {
      await loadLocalSource(seq)
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** v0.23 SB4 正篇话数序（连播/上下一集导航）：取不到时（离线/无网）仅隐藏按钮 */
async function loadEpSorts() {
  epSorts.value = []
  try {
    const episodes = await dataSource.episodes(subjectId.value)
    epSorts.value = episodes
      .filter((e) => e.type === 0)
      .map((e) => e.sort)
      .sort((a, b) => a - b)
  } catch {
    /* 静默：连播与上/下一集按钮不可用，不影响播放 */
  }
}

/** v0.23 SB5 片头时长按条目记忆（默认 90s） */
async function loadIntro() {
  const remembered = await getIntro(subjectId.value)
  introSec.value = remembered ?? DEFAULT_INTRO_SEC
  introDraft.value = introSec.value
}

const prevSort = computed(() => {
  const i = epSorts.value.indexOf(sort.value)
  return i > 0 ? epSorts.value[i - 1] : null
})
const nextSort = computed(() => {
  const i = epSorts.value.indexOf(sort.value)
  return i >= 0 && i < epSorts.value.length - 1 ? epSorts.value[i + 1] : null
})

/** v0.23 SB4 切集：优先服务源绑定文件（保持 file 参数直连），其次本地绑定；都不存在则提示 */
async function goEpisode(target: number) {
  if (mediaService.configured()) {
    try {
      const list = await mediaService.subjectFiles(subjectId.value)
      const f = list.find((x) => x.sort === target)
      if (f) {
        await router.push({ name: 'watch', query: { subject: String(subjectId.value), sort: String(target), file: String(f.fileId) } })
        return
      }
    } catch {
      /* 服务不可达退回本地绑定判定 */
    }
  }
  const b = await getBinding(subjectId.value, target)
  if (!b) {
    message.info(`第 ${target} 话还没有绑定播放源`)
    return
  }
  await router.push({ name: 'watch', query: { subject: String(subjectId.value), sort: String(target) } })
}

/** v0.23 SB4 连播：自然播完（ended）时按设置开关自动进入下一集 */
function onEnded() {
  if (settings.autoNext && nextSort.value) void goEpisode(nextSort.value)
}

/** v0.23 SB4 连播开关（镜像设置页「自动连播」，配置持久化到本机 settings） */
function toggleAutoNext() {
  settings.applyPatch({ autoNext: !settings.autoNext })
  message.info(settings.autoNext ? '已开启自动连播：看完自动播下一集' : '已关闭自动连播')
}

/** v0.23 SB5 片头时长修改/清除（0=关闭按钮；null 记忆=回到默认 90s） */
async function applyIntro(v: number | null) {
  const sec = Math.max(0, Math.min(600, Math.round(v ?? DEFAULT_INTRO_SEC)))
  introSec.value = sec
  introDraft.value = sec
  await setIntro(subjectId.value, sec)
  message.success(sec > 0 ? `片头时长已记忆为 ${sec}s` : '已关闭跳过片头（本条目）')
}
async function resetIntro() {
  introSec.value = DEFAULT_INTRO_SEC
  introDraft.value = DEFAULT_INTRO_SEC
  await setIntro(subjectId.value, DEFAULT_INTRO_SEC)
  message.success(`已恢复默认片头时长 ${DEFAULT_INTRO_SEC}s`)
}

function releaseSubtitleUrl() {
  if (subObjectUrl) URL.revokeObjectURL(subObjectUrl)
  subObjectUrl = ''
}

/** v0.23 装载一条字幕轨（vtt 文本 → blob URL → 唯一选中轨；SB2/SB3 本地与 WebDAV 用） */
function loadVttEntry(name: string, vtt: string) {
  releaseSubtitleUrl()
  subObjectUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
  subtitleEntries.value = [{ index: 0, label: name, url: subObjectUrl, selected: true }]
}

/** v0.14 服务媒体库源：mp4/m4v/webm/mkv 直连 Range（SB0）；其余容器转封装 fMP4（?t= 起点） */
async function loadServiceSource(seq: number) {
  if (!mediaService.configured()) {
    fatal.value = '媒体服务未配置——请到设置页填写服务地址与 Token'
    return
  }
  let file: SvcFile
  try {
    file = await mediaService.fileDetail(fileId.value)
  } catch (e) {
    fatal.value = e instanceof Error ? e.message : String(e)
    return
  }
  if (seq !== loadSeq) return
  svcFile = file
  bindingName.value = file.name
  videoTitle.value = `第 ${sort.value} 话 · ${file.name}`
  positionId = servicePositionId(subjectId.value, sort.value)
  remux.value = !isDirectExt(file.ext)

  const pos = await getPosition(positionId)
  let resume = pos && pos.position > 5 ? pos.position : 0
  if (remux.value) {
    // 转封装：续播点直接作为流起点（-ss），进度按 seekBase 换算；
    // 已接近结尾（≥95%）则从头重播（与 direct 的 ready 判定同语义）
    if (resume && file.durationSec && resume >= file.durationSec * 0.95) resume = 0
    seekBase = resume
    videoSrc.value = mediaService.streamUrl(fileId.value, resume || undefined)
  } else {
    // 直连 Range：浏览器原生 seek
    startAt.value = resume
    videoSrc.value = mediaService.streamUrl(fileId.value)
  }

  // v0.23 SB1 内封字幕轨：枚举 + 默认轨（无轨/失败静默——字幕是增强项，不阻塞播放）
  try {
    const tracks: SubtitleTrack[] = await mediaService.subtitleTracks(fileId.value)
    if (seq !== loadSeq) return
    if (tracks.length) {
      const def = pickDefaultTrack(tracks)
      subtitleEntries.value = tracks.map((t) => ({
        index: t.index,
        label: trackLabel(t),
        url: mediaService.subtitleUrl(fileId.value, t.index),
        selected: def?.index === t.index,
      }))
    }
  } catch {
    /* 字幕轨枚举失败不阻塞播放 */
  }
}

/** v0.26 HN5 在线解析源：视频码 → 服务端解析 watch 页 → 流转发地址（页面解析、Range 透传、
 *  直连/代理容灾全在服务端；带签名直链不落前端）。清晰度经 VideoPlayer 设置面板切换
 *  （换 res 重建流，lastPosition 承接进度）。 */
async function loadOnlineSource(seq: number, code: string) {
  if (!mediaService.configured()) {
    fatal.value = '在线解析播放需要媒体服务（页面解析与视频转发都在服务端）——请到设置页配置服务地址与 Token'
    return
  }
  let detail
  try {
    detail = await mediaService.hanimeWatch(code)
  } catch (e) {
    fatal.value = e instanceof Error ? e.message : String(e)
    return
  }
  if (seq !== loadSeq) return
  if (!detail.sources.length) {
    fatal.value = '未解析到可播放的视频源（视频可能已下架或站点结构变化）'
    return
  }
  hanimeCode.value = code
  hanimeSources.value = detail.sources
  hanimeRes.value = detail.sources[0].res
  bindingName.value = 'hanime1.me · 在线解析'
  videoTitle.value = `第 ${sort.value} 话 · ${detail.title}`
  // v0.26 HN7 续播：o:{videoCode} 位置记忆（≥95% 视为看完从头播，与服务源同语义）
  positionId = `o:${code}`
  const pos = await getPosition(positionId)
  if (seq !== loadSeq) return
  let resume = pos && pos.position > 5 ? pos.position : 0
  if (resume && pos?.duration && resume >= pos.duration * 0.95) resume = 0
  if (resume) startAt.value = resume
  videoSrc.value = mediaService.hanimeStreamUrl(code, detail.sources[0].res)
}

/** v0.26 清晰度切换：同码换 res 重建流（:key 变更重挂载），lastPosition 承接进度 */
function switchHanimeRes(res: number) {
  if (!hanimeCode.value || res === hanimeRes.value) return
  hanimeRes.value = res
  startAt.value = lastPosition > 5 ? lastPosition : 0
  videoSrc.value = mediaService.hanimeStreamUrl(hanimeCode.value, res)
}

/** v0.13 本机文件 / 演示 / URL 三路取源 */
async function loadLocalSource(seq: number) {
  const binding = await getBinding(subjectId.value, sort.value)
  if (seq !== loadSeq) return
  if (!binding) {
    fatal.value = '该集还未绑定播放源——回剧集 Tab 的「本地播放」里绑定'
    return
  }
  bindingName.value = binding.name
  videoTitle.value = `第 ${sort.value} 话 · ${binding.name}`
  positionId = positionIdOf(binding)

  if (binding.type === 'demo') {
    videoSrc.value = demoClipUrl
    // v0.23 SB2 演示内置字幕（走查字幕选择/开关/切换全链路）
    loadVttEntry('演示字幕', await fetchText(demoSubUrl))
  } else if (binding.type === 'url') {
    if (binding.webdav) {
      // v0.15 O3 WebDAV 源：凭据在服务端会话（open→streamId），播放地址不含凭据；Range 直连原生 seek
      if (!mediaService.configured()) {
        fatal.value = 'WebDAV 播放需要媒体服务（凭据由服务端会话托管）——请到设置页配置服务与 WebDAV 账号'
        return
      }
      try {
        const open = await mediaService.webdavOpen()
        if (seq !== loadSeq) return
        videoSrc.value = mediaService.webdavStreamUrl(open.streamId)
      } catch (e) {
        fatal.value = e instanceof Error ? e.message : String(e)
        return
      }
      // v0.23 SB3 WebDAV 同名字幕：经 O2 代理拉取字幕文本（无目录上下文的直链在线源不做）
      if (binding.webdavSubPath) void loadWebdavSubtitle(binding.webdavSubPath)
    } else {
      // v0.15 O1 直链 / HLS：先直连，失败经服务代理重试一次
      urlSource.value = binding.url ?? ''
      applyOnlineSource()
      if (!videoSrc.value) return
    }
  } else if (binding.type === 'online') {
    // v0.26 HN8 在线源绑定：绑定即直达（videoCode → 服务端解析/转发）
    await loadOnlineSource(seq, binding.videoCode ?? '')
    if (!videoSrc.value) return
  } else {
    // 文件型：优先 File 对象（拖拽/input 兜底），其次 FSA 句柄（跨会话需恢复授权）
    const rec = binding.fileKey ? await getFileRecord(binding.fileKey) : null
    const storedFile = rec?.file
    if (storedFile instanceof File) {
      objectUrl = URL.createObjectURL(storedFile)
      videoSrc.value = objectUrl
    } else if (!rec?.handle) {
      fatal.value = '文件句柄不存在（可能来自导入备份或已清除）——请回详情页重新绑定本地文件'
      return
    } else {
      const handle = rec.handle as {
        queryPermission?: (d: { mode: string }) => Promise<PermissionState>
        requestPermission?: (d: { mode: string }) => Promise<PermissionState>
        getFile: () => Promise<File>
      }
      let perm: PermissionState = 'denied'
      try {
        perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
      } catch {
        perm = 'granted'
      }
      if (perm !== 'granted') {
        // 导航进入时用户手势可能已过期——提供显式授权按钮（点击即手势）
        needPermission.value = true
        fatal.value = '浏览器要求每次会话重新授权本地文件访问'
        return
      }
      const file = await handle.getFile()
      objectUrl = URL.createObjectURL(file)
      videoSrc.value = objectUrl
    }
    // v0.23 SB2 本地外挂字幕：绑定时的同目录探测成果（VTT 文本）直接读出加载
    if (binding.fileKey) {
      const sub = await getSubtitle(binding.fileKey)
      if (seq !== loadSeq) return
      if (sub?.vtt) loadVttEntry(sub.name, sub.vtt)
    }
  }

  // PL3 续播记忆
  const pos = await getPosition(positionId)
  if (pos && pos.position > 5) startAt.value = pos.position
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** v0.23 SB3 WebDAV 同名字幕：绑定目录时已探测 subPath，经服务代理取文本转 VTT（复用 O2 通道） */
async function loadWebdavSubtitle(subPath: string) {
  try {
    const abs = `${settings.webdavRoot}${subPath}`
    const proxied = mediaService.proxyUrl(abs)
    if (!proxied) return
    const text = await fetchText(proxied)
    const vtt = /\.vtt$/i.test(subPath) ? text : srtToVtt(text)
    if (vtt.trim() === 'WEBVTT') return // 空字幕（转换失败/空文件）不装载
    const name = subPath.split('/').filter(Boolean).pop() ?? '字幕'
    loadVttEntry(name, vtt)
  } catch {
    /* 字幕拉取失败静默（播放不受影响） */
  }
}


/** 显式重新授权（按钮点击 = 用户手势） */
async function reauthorize() {
  const binding = await getBinding(subjectId.value, sort.value)
  const rec = binding?.fileKey ? await getFileRecord(binding.fileKey) : null
  const handle = rec?.handle as
    | { requestPermission?: (d: { mode: string }) => Promise<PermissionState> }
    | undefined
  if (!handle) {
    fatal.value = '文件句柄不存在——请回详情页重新绑定本地文件'
    needPermission.value = false
    return
  }
  try {
    const perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
    if (perm === 'granted') {
      await load()
      return
    }
  } catch {
    // 用户取消授权，维持现状
  }
  message.warning('未获得文件访问授权')
}

/** v0.15 O1 在线源地址解析：直连优先，代理态经服务转发（videoSrc 变化 → :key 重建播放器） */
function applyOnlineSource() {
  const url = urlSource.value
  if (!url) {
    fatal.value = '播放源地址为空'
    return
  }
  if (onlineProxied.value) {
    const proxied = mediaService.proxyUrl(url)
    if (!proxied) {
      fatal.value = '媒体服务未配置，无法经代理播放在线源'
      return
    }
    videoSrc.value = proxied
  } else {
    videoSrc.value = url
  }
}

/** v0.15 O1 / v0.23 SB0b 源加载失败容灾：
 *  - URL 在线源：未代理过且服务可用 → 自动经代理重试一次（结果不粘性记忆）
 *  - 服务源直发（SB0）：video error 自动降级转封装管道流重试一次（lastPosition 续播；
 *    降级后仍失败才提示不可播——启发式全保留、可播性只增不减） */
function onSourceError() {
  if (hanimeCode.value) {
    // v0.26 HN5 在线源：转发流播放失败（签名直链过期/出口失效）——重进即重新解析换新链接
    fatal.value = '在线视频播放失败——直链可能已过期或网络出口不可达，请回剧集列表重新播放（自动换新链接）'
    return
  }
  if (fileId.value) {
    if (svcFallbackUsed || remux.value) {
      fatal.value = '视频播放失败——转封装管道流亦不可播（编码或文件损坏）。'
      return
    }
    svcFallbackUsed = true
    remux.value = true
    const dur = svcFile?.durationSec ?? 0
    let resume = lastPosition > 5 ? lastPosition : 0
    if (resume && dur && resume >= dur * 0.95) resume = 0
    seekBase = resume
    startAt.value = 0
    videoSrc.value = mediaService.streamUrl(fileId.value, resume || undefined)
    return
  }
  if (!urlSource.value) return
  if (onlineProxied.value) {
    fatal.value = '在线源播放失败（直连与代理均不可用）——请检查地址是否有效，或更换播放源'
    return
  }
  if (!mediaService.configured()) {
    fatal.value = '在线源直连失败（通常是跨域限制）——配置媒体服务后可自动经代理重试'
    return
  }
  onlineProxied.value = true
  if (lastPosition > 5) startAt.value = lastPosition
  applyOnlineSource()
}

/** v0.15 发送弹幕持久化：beforeEmit 抛出的弹幕追加进 dm: 存储（下次进入自动加载）。
 *  故意不更新 danmakuItems——那会触发 danmuku.load() 全量重载，使刚发送的弹幕在当前进度重飘一次。 */
/** v0.15 发送弹幕持久化：beforeEmit 回调交来的弹幕追加进 dm: 存储（下次进入自动加载）。
 *  故意不更新 danmakuItems——那会触发 danmuku.load() 全量重载，使刚发送的弹幕在当前进度重飘一次。 */
async function onDanmukuEmit(item: DanmakuItem) {
  try {
    await saveDanmaku(subjectId.value, sort.value, appendDanmaku(danmakuItems.value, item))
  } catch {
    // 持久化失败静默：不影响本次发送显示
  }
}

/** v0.15 O4 弹幕导入：B 站 XML → 解析 → dm: 存储热更新（整文件失败拒绝导入） */
async function onDanmakuFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const items = parseDanmakuXml(await file.text())
    await saveDanmaku(subjectId.value, sort.value, items)
    danmakuItems.value = items
    message.success(`已导入 ${items.length} 条弹幕`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '弹幕导入失败')
  }
}

/** PL3 进度持久化 + ≥95% 自动标记（复用 E1 单集增量链路，照常进入上云队列）。
 *  v0.14：position/duration 为流内相对值——转封装流按 seekBase 换算回文件绝对时间再存储/判定。 */
async function onProgress(position: number, duration: number) {
  lastPosition = position
  const absPos = seekBase + position
  const absDur = seekBase + duration
  if (positionId) void savePosition(positionId, absPos, absDur)
  if (autoMarked || !isWatchedComplete(absPos, absDur)) return
  autoMarked = true
  try {
    if (!library.has(subjectId.value)) {
      message.info('看完啦！加入追番后可自动标记进度')
      return
    }
    const entry = library.entry(subjectId.value)
    if (entry?.watchedEps?.includes(sort.value)) return
    const episodes = await dataSource.episodes(subjectId.value)
    const ep = episodes.find((e) => e.type === 0 && e.sort === sort.value)
    if (!ep) return
    await sync.markEpisodeWatched(subjectId.value, ep.id, ep.type, ep.sort, true)
    message.success(`自然看完，已自动标记第 ${sort.value} 话看过`)
  } catch {
    // 标记失败静默：不影响观看（下次看完再触发或手动勾选）
  }
}

onMounted(load)
// 同路由不同参数（换集播放）时组件复用——必须重新走取源流程
watch(
  () => `${route.query.subject ?? ''}|${route.query.sort ?? ''}|${route.query.file ?? ''}|${route.query.online ?? ''}`,
  () => {
    if (route.name === 'watch') void load()
  },
)
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  releaseSubtitleUrl()
})

/** v0.14 remux seek 重拉：外层以 ?t= 重建流（VideoPlayer 经 key 变更重挂载） */
function onSeekReload(target: number) {
  if (!remux.value || !fileId.value) return
  const abs = seekBase + target
  seekBase = abs
  startAt.value = 0
  videoSrc.value = mediaService.streamUrl(fileId.value, abs || undefined)
}
</script>

<template>
  <div class="watch-page">
    <div class="watch-topbar">
      <NButton quaternary size="small" @click="router.back()">
        <template #icon><NIcon :component="ArrowBackOutline" /></template>
        返回
      </NButton>
      <span class="watch-title">{{ videoTitle || '播放' }}</span>
      <NButton
        v-if="subjectId"
        quaternary
        size="small"
        class="watch-eps-link"
        @click="router.push({ path: `/subject/${subjectId}`, query: { tab: 'eps' } })"
      >
        <template #icon><NIcon :component="LinkOutline" /></template>
        回剧集列表
      </NButton>
    </div>

    <div v-if="loading" class="watch-state"><NSpin size="medium" /></div>

    <div v-else-if="fatal" class="watch-state">
      <EmptyHint text="无法开始播放" :sub="fatal">
        <div class="fatal-actions">
          <NButton v-if="needPermission" type="primary" secondary size="small" @click="reauthorize">
            <template #icon><NIcon :component="PlayOutline" /></template>
            重新授权并播放
          </NButton>
          <NButton v-if="fileId" size="small" @click="load">重试</NButton>
          <NButton v-if="subjectId" quaternary size="small" @click="router.push({ path: `/subject/${subjectId}`, query: { tab: 'eps' } })">
            去剧集 Tab 管理绑定
          </NButton>
        </div>
      </EmptyHint>
    </div>

    <div v-else class="watch-shell">
      <VideoPlayer
        :key="videoSrc"
        :src="videoSrc"
        :title="videoTitle"
        :start-at="startAt"
        :remux="remux"
        :danmaku="danmakuItems"
        :persist-danmuku="onDanmukuEmit"
        :subtitles="subtitleEntries"
        :intro-sec="introSec"
        :qualities="qualityOptions"
        :active-res="hanimeRes"
        @progress="onProgress"
        @seekreload="onSeekReload"
        @sourceerror="onSourceError"
        @qualitychange="switchHanimeRes"
        @ended="onEnded"
      />
      <div class="watch-meta">
        <span class="watch-name">{{ videoTitle }}</span>
        <span class="watch-source" :title="bindingName">来源：{{ bindingName }}</span>
        <span v-if="hanimeRes" class="watch-source" title="清晰度在播放器「设置 ⚙」内切换">当前 {{ hanimeRes }}p</span>
        <span v-if="onlineProxied" class="watch-source">· 经服务代理</span>
        <span v-if="subtitleEntries.length" class="watch-source" title="字幕轨在播放器「设置 ⚙」内切换">
          字幕 {{ subtitleEntries.length }} 轨
        </span>
        <span v-if="danmakuItems.length" class="watch-source">弹幕 {{ danmakuItems.length }} 条</span>
        <input ref="dmInput" type="file" accept=".xml,text/xml,application/xml" hidden @change="onDanmakuFile" />
        <NButton size="tiny" quaternary @click="dmInput?.click()">导入弹幕</NButton>
        <!-- v0.23 SB4 连播开关（镜像设置页「自动连播」）+ 上/下一集 -->
        <NButton
          size="tiny"
          quaternary
          :type="settings.autoNext ? 'primary' : 'default'"
          title="自然看完后自动播放下一集（设置页 · 播放体验）"
          @click="toggleAutoNext"
        >
          连播 {{ settings.autoNext ? '开' : '关' }}
        </NButton>
        <NButton v-if="prevSort !== null" size="tiny" quaternary title="上一集" @click="goEpisode(prevSort)">
          <template #icon><NIcon :component="PlayBackOutline" /></template>
          第 {{ prevSort }} 话
        </NButton>
        <NButton v-if="nextSort !== null" size="tiny" quaternary title="下一集" @click="goEpisode(nextSort)">
          第 {{ nextSort }} 话
          <template #icon><NIcon :component="PlayForwardOutline" /></template>
        </NButton>
        <!-- v0.23 SB5 片头时长记忆（默认 90s，可改/清） -->
        <NPopover trigger="click" placement="top">
          <template #trigger>
            <NButton size="tiny" quaternary>片头 {{ introSec || '关' }}s</NButton>
          </template>
          <div class="intro-edit">
            <span>片头时长（秒，0=关）</span>
            <NInputNumber v-model:value="introDraft" size="tiny" :min="0" :max="600" style="width: 130px" />
            <div class="intro-actions">
              <NButton size="tiny" type="primary" @click="applyIntro(introDraft)">保存</NButton>
              <NButton size="tiny" @click="resetIntro()">恢复默认</NButton>
            </div>
          </div>
        </NPopover>
        <span class="watch-hint">
          {{ remux ? '转封装流 · 拖动进度将重新加载' : '空格播放/暂停 · ←→ 快进快退 · F 全屏' }} · 看完 95% 自动标记
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 沉浸页不铺背景面板：透出全局氛围层（body 氛围层在本路由同样生效） */
.watch-page {
  min-height: 100vh;
  padding: 14px clamp(14px, 4vw, 40px) 40px;
}

.watch-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  max-width: 1100px;
  margin-left: auto;
  margin-right: auto;
}

.watch-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--av-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-eps-link {
  margin-left: auto;
}

.watch-shell {
  max-width: 1100px;
  margin: 0 auto;
}

.watch-state {
  max-width: 1100px;
  margin: 60px auto;
  display: flex;
  justify-content: center;
}

.fatal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 14px;
}

.watch-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.watch-name {
  font-size: 15px;
  font-weight: 700;
}

.watch-source {
  font-size: 12px;
  color: var(--av-text-tertiary);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-hint {
  font-size: 12px;
  color: var(--av-text-tertiary);
  margin-left: auto;
}

/* v0.23 SB5 片头时长编辑弹层 */
.intro-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--av-text-secondary);
}

.intro-actions {
  display: flex;
  gap: 8px;
}
</style>
