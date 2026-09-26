#!/usr/bin/env node
/**
 * v1.0 D2 内置媒体服务拼装流水线（npm preapp:build 自动调用，亦可 node scripts/build-service.mjs 手动跑）：
 *   服务端 fat jar → 解出 BOOT-INF 喂 jdeps 算静态依赖模块集 → 并集反射型基线模块 →
 *   jlink 裁剪 JRE → 拼装 src-tauri/resources/service/{runtime/, service.jar}，随 Tauri resources 打包。
 * v1.0 D3：随包外部二进制——aria2c + ffmpeg/ffprobe 拷入 resources/service/bin/（壳检测到存在即注入
 *   包内路径），GPL 许可文本随包附于 licenses/。
 * 环境变量：
 *   AV_JDK            JDK 21 主目录（默认 G:/jdk/ms-21.0.11，jdeps/jlink 与运行时同源）
 *   AV_SERVICE_JAR    服务端 fat jar 路径（默认取 ../AnimeViewerService/target/animeviewer-service-*.jar 最新者）
 *   AV_SKIP_MEDIA_BIN 置 1 = 精简版（不随包 ffmpeg/aria2，服务端走 PATH 探测降级路径）
 *   AV_ARIA2C / AV_FFMPEG / AV_FFPROBE  二进制路径覆写（默认探测本机工具目录）
 * 说明：jdeps 是静态分析，反射/ServiceLoader 引用的模块（java.xml 的 DOM、jdk.crypto.ec 的 TLS SunEC、
 *   java.naming 等）不在其输出内——BASELINE_MODULES 手动并集兜底，并以「裁剪 JRE 启动服务端 +
 *   /api/health 实测」作为最终把关（迭代文档 §5 v1.0 D2 实现记录）。
 * NSIS 组件化定案落地区说明：Tauri 2 NSIS 模板不支持自定义组件选择页，评审定案「ffmpeg 默认勾选、
 *   可裁」以双发布物实现——完整版（默认）/ 精简版（AV_SKIP_MEDIA_BIN=1，产物重命名 -lite）。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const serviceDir = join(root, 'src-tauri', 'resources', 'service')
const jdk = process.env.AV_JDK || 'G:/jdk/ms-21.0.11'
const exe = (name) => join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))

/** 反射型基线：jdeps 静态分析必然漏掉的模块（WebDAV DOM 解析 / HTTPS SunEC / JNDI / JDBC 显式声明） */
const BASELINE_MODULES = ['java.base', 'java.sql', 'java.xml', 'java.naming', 'jdk.crypto.ec']
/** jdeps 失效时的保守全量兜底（= 基线 + v0.30 依赖树静态输出） */
const FALLBACK_MODULES = [
  ...BASELINE_MODULES,
  'java.compiler', 'java.desktop', 'java.instrument', 'java.management', 'java.net.http',
  'java.prefs', 'java.rmi', 'java.scripting', 'java.security.jgss', 'java.sql.rowset',
  'jdk.jfr', 'jdk.unsupported',
]

/** D3 随包二进制的默认探测路径（本机工具目录；AV_* 环境变量可覆写） */
function findMediaBin() {
  const candidates = {
    aria2c: [
      process.env.AV_ARIA2C,
      'G:/aria2/aria2-1.37.0-win-64bit-build1/aria2c.exe',
    ],
    ffmpeg: [process.env.AV_FFMPEG, 'G:/ffmpeg/bin/ffmpeg.exe'],
    ffprobe: [process.env.AV_FFPROBE, 'G:/ffmpeg/bin/ffprobe.exe'],
    /** 许可文本随包（GPL 合规：署名 + 许可文本 + 源码获取途径见设置页「关于与开源许可」） */
    'ffmpeg-LICENSE': [null, 'G:/ffmpeg/LICENSE'],
    'aria2-COPYING': [null, 'G:/aria2/aria2-1.37.0-win-64bit-build1/COPYING'],
  }
  const found = {}
  for (const [name, paths] of Object.entries(candidates)) {
    const hit = paths.find((p) => p && existsSync(p))
    if (hit) found[name] = hit
  }
  return found
}

function findServiceJar() {
  if (process.env.AV_SERVICE_JAR) {
    if (!existsSync(process.env.AV_SERVICE_JAR)) throw new Error(`AV_SERVICE_JAR 不存在: ${process.env.AV_SERVICE_JAR}`)
    return process.env.AV_SERVICE_JAR
  }
  const targetDir = resolve(root, '..', 'AnimeViewerService', 'target')
  if (!existsSync(targetDir)) throw new Error(`服务端 target 不存在（先在 AnimeViewerService 跑 mvn -DskipTests package）: ${targetDir}`)
  const jars = readdirSync(targetDir)
    .filter((f) => /^animeviewer-service-\d[\w.-]*\.jar$/.test(f) && !f.endsWith('.original'))
    .map((f) => ({ f, m: statSync(join(targetDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (!jars.length) throw new Error(`target 下没有 animeviewer-service jar: ${targetDir}`)
  return join(targetDir, jars[0].f)
}

function jdepsModules(jar) {
  const work = join(tmpdir(), `av-jdeps-${Date.now()}`)
  try {
    mkdirSync(join(work, 'classes'), { recursive: true })
    execFileSync(exe('jar'), ['-xf', jar, 'BOOT-INF'], { cwd: work, stdio: 'pipe' })
    cpSync(join(work, 'BOOT-INF', 'classes'), join(work, 'classes'), { recursive: true })
    const libDir = join(work, 'BOOT-INF', 'lib')
    const libs = readdirSync(libDir).filter((f) => f.endsWith('.jar')).map((f) => join(libDir, f))
    const out = execFileSync(
      exe('jdeps'),
      ['--multi-release', '21', '--print-module-deps', '--ignore-missing-deps', '-q',
        join(work, 'classes'), ...libs],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' },
    ).trim()
    const mods = out.split(',').map((m) => m.trim()).filter(Boolean)
    if (!mods.length) throw new Error('jdeps 输出为空')
    return mods
  } catch (e) {
    console.warn(`[build-service] jdeps 失败（${e.message?.split('\n')[0] ?? e}），使用保守全量兜底模块集`)
    return FALLBACK_MODULES
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const jar = findServiceJar()
console.log(`[build-service] 服务端 jar: ${jar} (${(statSync(jar).size / 1048576).toFixed(1)} MB)`)

const staticMods = jdepsModules(jar)
const modules = [...new Set([...BASELINE_MODULES, ...staticMods])].join(',')
console.log(`[build-service] jlink 模块集: ${modules}`)

rmSync(serviceDir, { recursive: true, force: true })
mkdirSync(serviceDir, { recursive: true })
execFileSync(exe('jlink'), [
  '--add-modules', modules,
  '--strip-debug', '--no-man-pages', '--no-header-files', '--compress=zip-6',
  '--output', join(serviceDir, 'runtime'),
], { stdio: 'inherit' })
cpSync(jar, join(serviceDir, 'service.jar'))

// ── D3 随包外部二进制（bin/ 存在时壳自动注入包内路径，AV_SKIP_MEDIA_BIN=1 跳过=精简版） ──
if (process.env.AV_SKIP_MEDIA_BIN === '1') {
  console.log('[build-service] 精简版：跳过 ffmpeg/aria2 随包（服务端走 PATH 探测降级路径）')
} else {
  const bins = findMediaBin()
  const binDir = join(serviceDir, 'bin')
  const licDir = join(serviceDir, 'licenses')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(licDir, { recursive: true })
  for (const name of ['aria2c', 'ffmpeg', 'ffprobe']) {
    if (!bins[name]) {
      console.warn(`[build-service] 警告: ${name} 未找到（AV_${name.toUpperCase()} 可指定），该能力将走降级路径`)
      continue
    }
    copyFileSync(bins[name], join(binDir, `${name}.exe`))
    console.log(`[build-service] bin/${name}.exe ← ${bins[name]} (${(statSync(bins[name]).size / 1048576).toFixed(1)} MB)`)
  }
  if (bins['ffmpeg-LICENSE']) copyFileSync(bins['ffmpeg-LICENSE'], join(licDir, 'ffmpeg-GPLv3.txt'))
  if (bins['aria2-COPYING']) copyFileSync(bins['aria2-COPYING'], join(licDir, 'aria2-GPLv2.txt'))
}

const sizeOf = (p) => {
  const st = statSync(p)
  if (!st.isDirectory()) return (st.size / 1048576).toFixed(1)
  let total = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else total += statSync(f).size
    }
  }
  walk(p)
  return (total / 1048576).toFixed(1)
}
console.log(`[build-service] 完成: runtime ${sizeOf(join(serviceDir, 'runtime'))} MB + service.jar ${sizeOf(join(serviceDir, 'service.jar'))} MB`
  + (existsSync(join(serviceDir, 'bin')) ? ` + bin ${sizeOf(join(serviceDir, 'bin'))} MB` : ' + bin (精简版无)'))
console.log('[build-service] 壳在 bin/{ffmpeg,ffprobe,aria2c}.exe 存在时自动注入包内路径（main.rs）')
