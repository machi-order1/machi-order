import { readdir, mkdir, copyFile, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, '.cloudflare-pages-dist')
const allowed = new Set(['.html', '.js', '.css', '.webmanifest', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.txt'])
const copied = []
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

async function add(src, dest) {
  const details = await stat(src)
  if (details.size > 25 * 1024 * 1024) throw Error(`${dest} exceeds the Cloudflare Pages asset limit`)
  await mkdir(resolve(out, dest, '..'), { recursive: true })
  await copyFile(src, resolve(out, dest))
  copied.push(dest)
}
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && allowed.has(extname(entry.name))) await add(join(root, entry.name), entry.name)
}
async function copyAssets(dir, prefix) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = join(prefix, entry.name), source = join(dir, entry.name)
    if (entry.isDirectory()) await copyAssets(source, relative)
    else if (entry.isFile() && allowed.has(extname(entry.name))) await add(source, relative)
  }
}
await copyAssets(join(root, 'assets'), 'assets')
await writeFile(join(out, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n  Cache-Control: no-cache, no-store, must-revalidate\n`)
copied.push('_headers')
if (!copied.includes('index.html') || !copied.includes('login.html')) throw Error('Entry pages missing')
if (copied.length > 1000) throw Error('Cloudflare Pages dashboard upload limit exceeded')
const files = new Set(copied)
const worker = await readFile(join(out, 'sw.js'), 'utf8')
const precache = worker.match(/const A=\[([\s\S]*?)\];/)?.[1] || ''
const references = [...precache.matchAll(/'\/([^']+)'/g)].map(match => match[1])
const missing = references.filter(path => !files.has(path))
if (missing.length) throw Error('Service worker precache references missing files: ' + missing.join(', '))
let bytes = 0
for (const path of copied) bytes += (await stat(join(out, path))).size
console.log(`Cloudflare Pages package: ${copied.length} files, ${(bytes / 1048576).toFixed(2)} MiB; all ${references.length} precache paths present`)
console.log(out)
