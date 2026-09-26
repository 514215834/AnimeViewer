#!/usr/bin/env node
/**
 * v1.0 D2 内置媒体服务拼装流水线（npm preapp:build 自动调用，亦可 node scripts/build-service.mjs 手动跑）：
 *   服务端 fat jar → 解出 BOOT-INF 喂 jdeps 算静态依赖模块集 → 并集反射型基线模块 →
 *   jlink 裁剪 JRE → 拼装 src-tauri/resources/service/{runtime/, service.jar}，随 Tauri resources 打包。
 * 环境变量：
 *   AV_JDK         JDK 21 主目录（默认 G:/jdk/ms-21.0.11，jdeps/jlink 与运行时同源）
 *   AV_SERVICE_JAR 服务端 fat jar 路径（默认取 ../AnimeViewerService/target/animeviewer-service-*.jar 最新者）
 * 说明：jdeps 是静态分析，反射/ServiceLoader 引用的模块（java.xml 的 DOM、jdk.crypto.ec 的 TLS SunEC、
 *   java.naming 等）不在其输出内——BASELINE_MODULES 手动并集兜底，并以「裁剪 JRE 启动服务端 +
 *   /api/health 实测」作为最终把关（迭代文档 §5 v1.0 D2 实现记录）。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
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
console.log(`[build-service] 完成: runtime ${sizeOf(join(serviceDir, 'runtime'))} MB + service.jar ${sizeOf(join(serviceDir, 'service.jar'))} MB`)
console.log('[build-service] 提示: D3 时将 aria2c.exe / ffmpeg.exe / ffprobe.exe 放入 bin/ 即随包注入路径')
