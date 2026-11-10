// Structural validation of vercel.json + project hygiene. Runs offline: `npm run validate:vercel`.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const errors = []
const warn = []
const fail = (m) => errors.push(m)

let cfg
try {
  cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
} catch (e) {
  console.error('vercel.json is not valid JSON:', e.message)
  process.exit(1)
}

const ALLOWED = new Set(['$schema', 'framework', 'installCommand', 'buildCommand', 'devCommand', 'outputDirectory', 'regions', 'functions', 'headers', 'redirects', 'rewrites', 'cleanUrls', 'trailingSlash', 'crons', 'public', 'github', 'images', 'bunVersion'])
for (const k of Object.keys(cfg)) if (!ALLOWED.has(k)) fail(`unknown top-level key "${k}"`)

// Next.js apps must NOT set routes/builds/outputDirectory/rewrites that fight the framework preset.
for (const k of ['builds', 'routes', 'version']) if (k in cfg) fail(`"${k}" is legacy and conflicts with the Next.js preset`)
if ('outputDirectory' in cfg) fail('outputDirectory must not be set for Next.js')
if (cfg.framework !== 'nextjs') fail('framework must be "nextjs"')

// package.json must define the commands vercel.json calls.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const [field, cmd] of [['buildCommand', cfg.buildCommand], ['installCommand', cfg.installCommand]]) {
  if (!cmd) continue
  const m = cmd.match(/^npm run ([\w:-]+)$/)
  if (m && !pkg.scripts?.[m[1]]) fail(`${field} runs "npm run ${m[1]}" but package.json has no such script`)
  if (cmd === 'npm ci' && !existsSync(join(root, 'package-lock.json'))) fail('installCommand is "npm ci" but package-lock.json is missing')
}

// regions: Hobby accepts a single region.
if (cfg.regions !== undefined) {
  if (!Array.isArray(cfg.regions) || cfg.regions.length === 0 || cfg.regions.some((r) => typeof r !== 'string' || !/^[a-z]{3}\d$/.test(r))) fail('regions must be an array of region ids like "bom1"')
  else if (cfg.regions.length > 1) warn.push('more than one region requires a paid plan')
}

// functions: every glob must match at least one real file; maxDuration within Hobby ceiling (60 s here).
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n === '.git') continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(relative(root, p).split('\\').join('/'))
  }
  return out
}
const files = walk(root)
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$')
for (const [pattern, opts] of Object.entries(cfg.functions ?? {})) {
  if (!files.some((f) => globToRe(pattern).test(f))) fail(`functions pattern "${pattern}" matches no file`)
  if (opts.maxDuration !== undefined && (!Number.isInteger(opts.maxDuration) || opts.maxDuration < 1 || opts.maxDuration > 60)) fail(`maxDuration for "${pattern}" must be an integer 1-60 (Hobby-safe)`)
  for (const k of Object.keys(opts)) if (!['maxDuration', 'memory', 'runtime', 'includeFiles', 'excludeFiles', 'regions', 'supportsCancellation'].includes(k)) fail(`unknown function option "${k}"`)
}

// headers shape
for (const h of cfg.headers ?? []) {
  if (typeof h.source !== 'string' || !Array.isArray(h.headers)) fail('each header rule needs { source, headers[] }')
  for (const kv of h.headers ?? []) if (typeof kv.key !== 'string' || typeof kv.value !== 'string') fail(`bad header entry in "${h.source}"`)
}

// Project hygiene: no Cloudflare/Hono leftovers.
for (const f of ['wrangler.jsonc', 'wrangler.toml', 'vite.config.ts', 'ecosystem.config.cjs']) if (existsSync(join(root, f))) fail(`${f} must not exist (Vercel/Next.js only)`)
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const bad of ['hono', 'wrangler', '@hono/vite-build', '@hono/vite-dev-server', 'vite', '@cloudflare/workers-types']) if (deps[bad]) fail(`dependency "${bad}" must not be present`)
if (!deps.next) fail('"next" dependency missing')
const nodeRange = pkg.engines?.node
if (!nodeRange) warn.push('package.json engines.node is not set')

// Secrets must never be NEXT_PUBLIC_
for (const f of files.filter((x) => /\.(ts|tsx|mjs|json|md)$/.test(x) && !x.startsWith('node_modules'))) {
  const t = readFileSync(join(root, f), 'utf8')
  if (/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN|EMBED)/.test(t) && !f.startsWith('scripts/')) fail(`${f}: a secret-looking NEXT_PUBLIC_ variable is referenced`)
}

for (const w of warn) console.warn('warning:', w)
if (errors.length) {
  console.error('vercel.json validation FAILED:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log(`vercel.json OK (${Object.keys(cfg.functions ?? {}).length} function rule(s), ${(cfg.headers ?? []).length} header rule(s), region ${cfg.regions?.join(',') ?? 'default'})`)
