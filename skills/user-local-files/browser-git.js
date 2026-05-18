/*!
 * browser-git.js
 * A tiny browser-only Git diff/status reader for FileSystemDirectoryHandle or FileSystemDirectoryEntry.
 *
 * Usage:
 *   // Load this file as a classic script or import it for side effects.
 *   // It exposes globalThis.BrowserGit.
 *   const git = BrowserGit({ gitDir: repoDirectoryHandle, console });
 *   await git.ready;                 // rejects if .git is not found
 *   await git.diff();                // index vs working tree
 *   await git.diff('--cached');      // HEAD vs index
 *   await git.diff('--stat');
 *   await git.diffStat('--cached');
 *   await git.status();
 *   await git.status('--short');
 *
 * Notes:
 *   - Works in browsers with File System Access API or legacy FileSystemDirectoryEntry.
 *   - Reads .git directly; no shell, no network.
 *   - Supports loose objects and pack idx v2, including ofs_delta/ref_delta.
 *   - Git index v2/v3 supported; .gitignore support is intentionally lightweight.
 */
(function (global) {
  'use strict';

  function BrowserGit(options = {}) {
  const root = options && (options.gitDir || options.root || options);
  const logger = options && options.console && typeof options.console.log === 'function' ? options.console : null;
  const td = new TextDecoder();
  const te = new TextEncoder();

  const isHandleLike = x => !!x && (typeof x.getDirectoryHandle === 'function' || typeof x.createReader === 'function');
  if (!isHandleLike(root)) throw new Error('BrowserGit: gitDir must be a FileSystemDirectoryHandle or FileSystemDirectoryEntry');

  function log(value) { if (logger) logger.log(value); return value; }
  function isModernDir(x) { return !!x && typeof x.getDirectoryHandle === 'function'; }
  function isModernFile(x) { return !!x && typeof x.getFile === 'function' && !isModernDir(x); }
  function isLegacyDir(x) { return !!x && typeof x.createReader === 'function'; }
  function isLegacyFile(x) { return !!x && typeof x.file === 'function' && !isLegacyDir(x); }
  function isDir(x) { return !!x && (x.kind === 'directory' || x.isDirectory === true || isModernDir(x) || isLegacyDir(x)); }
  function isFile(x) { return !!x && (x.kind === 'file' || x.isFile === true || isModernFile(x) || isLegacyFile(x)); }
  function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
  function hexToBytes(s) { const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return out; }
  function u32be(b, o) { return ((((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0); }
  function concatUint8(arrs) { const len = arrs.reduce((s, a) => s + a.length, 0); const out = new Uint8Array(len); let off = 0; for (const a of arrs) { out.set(a, off); off += a.length; } return out; }
  async function sha1Hex(data) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', data))); }
  async function blobHash(bytes) { return sha1Hex(concatUint8([te.encode(`blob ${bytes.length}\0`), bytes])); }

  async function getDir(parent, name) {
    if (isModernDir(parent)) return await parent.getDirectoryHandle(name);
    return await new Promise((resolve, reject) => parent.getDirectory(name, { create: false }, resolve, reject));
  }
  async function getFile(parent, name) {
    if (isModernDir(parent)) return await parent.getFileHandle(name);
    return await new Promise((resolve, reject) => parent.getFile(name, { create: false }, resolve, reject));
  }
  async function readBytesFromFileHandle(handle) {
    if (isModernFile(handle)) return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (isLegacyFile(handle)) return new Uint8Array(await new Promise((resolve, reject) => handle.file(file => file.arrayBuffer().then(resolve).catch(reject), reject)));
    if (typeof handle.getFile === 'function') return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    throw new Error('BrowserGit: unsupported file handle');
  }
  async function readTextFromFileHandle(handle) {
    if (isModernFile(handle)) return await (await handle.getFile()).text();
    if (isLegacyFile(handle)) return await new Promise((resolve, reject) => handle.file(file => file.text().then(resolve).catch(reject), reject));
    if (typeof handle.getFile === 'function') return await (await handle.getFile()).text();
    throw new Error('BrowserGit: unsupported file handle');
  }
  async function readDirEntries(dir) {
    if (isModernDir(dir)) {
      const arr = [];
      for await (const pair of dir.entries()) arr.push(pair);
      return arr;
    }
    const reader = dir.createReader();
    const all = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      all.push(...batch);
    }
    return all.map(entry => [entry.name, entry]);
  }
  async function existsDir(parent, name) {
    try { await getDir(parent, name); return true; }
    catch (e) { if (['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name)) return false; throw e; }
  }
  async function getHandleByPath(dir, path, kind = 'file') {
    const parts = String(path).split('/').filter(Boolean);
    let cur = dir;
    for (let i = 0; i < parts.length - 1; i++) cur = await getDir(cur, parts[i]);
    if (!parts.length) return cur;
    return kind === 'directory' ? await getDir(cur, parts[parts.length - 1]) : await getFile(cur, parts[parts.length - 1]);
  }
  async function readPathBytes(path) { return await readBytesFromFileHandle(await getHandleByPath(root, path, 'file')); }
  async function readPathText(path) { return await readTextFromFileHandle(await getHandleByPath(root, path, 'file')); }
  async function readPathBytesOrNull(path) { try { return await readPathBytes(path); } catch (e) { if (['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name)) return null; throw e; } }
  async function readPathTextOrNull(path) { try { return await readPathText(path); } catch (e) { if (['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name)) return null; throw e; } }

  const cache = { idx: new Map(), packBytes: new Map(), objAtOffset: new Map(), objByHash: new Map(), packList: null };
  const ready = (async () => {
    if (!(await existsDir(root, '.git'))) throw new Error('BrowserGit: .git not found in gitDir');
    if (typeof DecompressionStream !== 'function') throw new Error('BrowserGit: DecompressionStream is required to read git objects in this browser');
    if (!globalThis.crypto || !crypto.subtle) throw new Error('BrowserGit: crypto.subtle is required to hash working-tree files');
    return true;
  })();

  function parseGitObject(raw) {
    let i = 0;
    while (i < raw.length && raw[i] !== 0) i++;
    const header = td.decode(raw.slice(0, i));
    const sp = header.indexOf(' ');
    return { type: header.slice(0, sp), size: Number(header.slice(sp + 1)), body: raw.slice(i + 1), raw };
  }
  async function inflateBytes(bytes) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readLooseObject(hash) {
    try {
      const dir = await getHandleByPath(root, `.git/objects/${hash.slice(0, 2)}`, 'directory');
      const fh = await getFile(dir, hash.slice(2));
      const compressed = await readBytesFromFileHandle(fh);
      return parseGitObject(await inflateBytes(compressed));
    } catch (e) {
      if (['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name)) return null;
      throw e;
    }
  }
  async function listPackBaseNames() {
    if (cache.packList) return cache.packList;
    const out = [];
    try {
      const packDir = await getHandleByPath(root, '.git/objects/pack', 'directory');
      for (const [name, handle] of await readDirEntries(packDir)) {
        if (isFile(handle) && name.endsWith('.idx')) out.push(name.slice(0, -4));
      }
    } catch (e) {
      if (!['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name)) throw e;
    }
    cache.packList = Array.from(new Set(out)).sort();
    return cache.packList;
  }
  async function readPackFile(baseName, ext) {
    const packDir = await getHandleByPath(root, '.git/objects/pack', 'directory');
    const fh = await getFile(packDir, `${baseName}.${ext}`);
    return await readBytesFromFileHandle(fh);
  }
  async function getPackBytes(baseName) {
    if (!cache.packBytes.has(baseName)) cache.packBytes.set(baseName, await readPackFile(baseName, 'pack'));
    return cache.packBytes.get(baseName);
  }
  function parseIdxV2(idxBytes) {
    if (u32be(idxBytes, 0) !== 0xff744f63) throw new Error('BrowserGit: unsupported git pack index format; only idx v2 is supported');
    const version = u32be(idxBytes, 4);
    if (version !== 2) throw new Error(`BrowserGit: unsupported git pack index version: ${version}`);
    let off = 8;
    const fanout = new Uint32Array(256);
    for (let i = 0; i < 256; i++) fanout[i] = u32be(idxBytes, off + i * 4);
    off += 1024;
    const count = fanout[255];
    const names = idxBytes.slice(off, off + count * 20); off += count * 20;
    off += count * 4; // CRC table
    const offset32Start = off;
    const offset32 = new Uint32Array(count);
    for (let i = 0; i < count; i++) offset32[i] = u32be(idxBytes, offset32Start + i * 4);
    off += count * 4;
    const largeTableOff = off;
    const offsets = new Array(count);
    for (let i = 0; i < count; i++) {
      const v = offset32[i];
      if (v & 0x80000000) {
        const largeIndex = v & 0x7fffffff;
        const p = largeTableOff + largeIndex * 8;
        offsets[i] = Number((BigInt(u32be(idxBytes, p)) << 32n) | BigInt(u32be(idxBytes, p + 4)));
      } else offsets[i] = v;
    }
    const sortedOffsets = offsets.slice().sort((a, b) => a - b);
    const nextOffset = new Map();
    for (let i = 0; i < sortedOffsets.length; i++) nextOffset.set(sortedOffsets[i], sortedOffsets[i + 1] ?? null);
    return { version, count, fanout, names, offsets, sortedOffsets, nextOffset };
  }
  async function getPackIndex(baseName) {
    if (!cache.idx.has(baseName)) cache.idx.set(baseName, parseIdxV2(await readPackFile(baseName, 'idx')));
    return cache.idx.get(baseName);
  }
  function cmpHashAt(names, idx, targetBytes) {
    const off = idx * 20;
    for (let i = 0; i < 20; i++) {
      const d = names[off + i] - targetBytes[i];
      if (d) return d;
    }
    return 0;
  }
  function binarySearchHash(names, targetBytes) {
    let lo = 0, hi = names.length / 20 - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cmp = cmpHashAt(names, mid, targetBytes);
      if (cmp === 0) return mid;
      if (cmp < 0) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
  async function findPackedObject(hash) {
    const target = hexToBytes(hash);
    for (const baseName of await listPackBaseNames()) {
      const idx = await getPackIndex(baseName);
      const i = binarySearchHash(idx.names, target);
      if (i >= 0) return { baseName, offset: idx.offsets[i] };
    }
    return null;
  }
  function parsePackObjectHeader(pack, off) {
    const start = off;
    let c = pack[off++];
    const typeNum = (c >> 4) & 7;
    let size = c & 0x0f;
    let shift = 4;
    while (c & 0x80) {
      c = pack[off++];
      size |= (c & 0x7f) << shift;
      shift += 7;
    }
    return { start, typeNum, size, off };
  }
  function parseOfsDeltaBase(pack, off, objectStart) {
    let c = pack[off++];
    let n = c & 0x7f;
    while (c & 0x80) {
      c = pack[off++];
      n = ((n + 1) << 7) | (c & 0x7f);
    }
    return { baseOffset: objectStart - n, off };
  }
  function typeName(typeNum) { return ({ 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag', 6: 'ofs_delta', 7: 'ref_delta' })[typeNum] || String(typeNum); }
  function readDeltaVarint(delta, state) {
    let result = 0, shift = 0, c;
    do { c = delta[state.p++]; result |= (c & 0x7f) << shift; shift += 7; } while (c & 0x80);
    return result;
  }
  function applyDelta(base, delta) {
    const state = { p: 0 };
    const baseSize = readDeltaVarint(delta, state);
    const resultSize = readDeltaVarint(delta, state);
    const chunks = [];
    let total = 0;
    while (state.p < delta.length) {
      const op = delta[state.p++];
      if (op & 0x80) {
        let cpOff = 0, cpSize = 0;
        if (op & 0x01) cpOff |= delta[state.p++];
        if (op & 0x02) cpOff |= delta[state.p++] << 8;
        if (op & 0x04) cpOff |= delta[state.p++] << 16;
        if (op & 0x08) cpOff |= delta[state.p++] << 24;
        if (op & 0x10) cpSize |= delta[state.p++];
        if (op & 0x20) cpSize |= delta[state.p++] << 8;
        if (op & 0x40) cpSize |= delta[state.p++] << 16;
        if (cpSize === 0) cpSize = 0x10000;
        const part = base.slice(cpOff, cpOff + cpSize);
        chunks.push(part); total += part.length;
      } else if (op) {
        const part = delta.slice(state.p, state.p + op);
        state.p += op;
        chunks.push(part); total += part.length;
      } else {
        throw new Error('BrowserGit: invalid git delta opcode 0');
      }
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of chunks) { out.set(part, o); o += part.length; }
    if (baseSize !== base.length || resultSize !== out.length) console.warn('BrowserGit: git delta size mismatch', { baseSize, actualBaseSize: base.length, resultSize, actualResultSize: out.length });
    return out;
  }
  async function readPackedObjectAt(baseName, offset) {
    const key = `${baseName}@${offset}`;
    if (cache.objAtOffset.has(key)) return cache.objAtOffset.get(key);
    const pack = await getPackBytes(baseName);
    const idx = await getPackIndex(baseName);
    const hdr = parsePackObjectHeader(pack, offset);
    let pos = hdr.off;
    let baseObject = null;
    if (hdr.typeNum === 6) {
      const r = parseOfsDeltaBase(pack, pos, offset);
      pos = r.off;
      baseObject = await readPackedObjectAt(baseName, r.baseOffset);
    } else if (hdr.typeNum === 7) {
      const baseHash = hex(pack.slice(pos, pos + 20));
      pos += 20;
      baseObject = await readObject(baseHash);
    }
    const end = idx.nextOffset.get(offset) ?? (pack.length - 20);
    const inflated = await inflateBytes(pack.slice(pos, end));
    let obj;
    if (hdr.typeNum === 6 || hdr.typeNum === 7) {
      const body = applyDelta(baseObject.body, inflated);
      obj = { type: baseObject.type, size: body.length, body, pack: baseName, offset };
    } else {
      obj = { type: typeName(hdr.typeNum), size: hdr.size, body: inflated, pack: baseName, offset };
    }
    cache.objAtOffset.set(key, obj);
    return obj;
  }
  async function readObject(hash) {
    if (!hash || /^0+$/.test(hash)) return null;
    if (cache.objByHash.has(hash)) return cache.objByHash.get(hash);
    let obj = await readLooseObject(hash);
    if (!obj) {
      const loc = await findPackedObject(hash);
      if (!loc) throw new Error(`BrowserGit: git object not found: ${hash}`);
      obj = await readPackedObjectAt(loc.baseName, loc.offset);
    }
    cache.objByHash.set(hash, obj);
    return obj;
  }
  async function readBlob(hash) { const obj = await readObject(hash); if (!obj) return null; if (obj.type !== 'blob') throw new Error(`BrowserGit: object ${hash} is ${obj.type}, not blob`); return obj.body; }
  function parseTree(body) {
    const entries = [];
    let off = 0;
    while (off < body.length) {
      let sp = off; while (body[sp] !== 0x20) sp++;
      const mode = td.decode(body.slice(off, sp));
      let nul = sp + 1; while (body[nul] !== 0) nul++;
      const name = td.decode(body.slice(sp + 1, nul));
      const sha = hex(body.slice(nul + 1, nul + 21));
      entries.push({ mode, name, sha });
      off = nul + 21;
    }
    return entries;
  }
  function parseCommit(body) {
    const text = td.decode(body);
    const cut = text.indexOf('\n\n');
    const headers = cut >= 0 ? text.slice(0, cut) : text;
    const message = cut >= 0 ? text.slice(cut + 2) : '';
    const out = { parents: [], message };
    for (const line of headers.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const key = line.slice(0, sp), value = line.slice(sp + 1);
      if (key === 'parent') out.parents.push(value); else out[key] = value;
    }
    return out;
  }
  async function getHeadInfo() {
    const headText = (await readPathText('.git/HEAD')).trim();
    if (!headText.startsWith('ref: ')) return { detached: true, branch: null, ref: null, hash: headText };
    const ref = headText.slice(5).trim();
    let hash = await readPathTextOrNull(`.git/${ref}`);
    if (hash) hash = hash.trim();
    if (!hash) {
      const packed = await readPathTextOrNull('.git/packed-refs');
      if (packed) {
        for (const line of packed.split(/\r?\n/)) {
          if (!line || line[0] === '#' || line[0] === '^') continue;
          const [h, r] = line.split(' ');
          if (r === ref) { hash = h; break; }
        }
      }
    }
    return { detached: false, branch: ref.replace(/^refs\/heads\//, ''), ref, hash: hash || null };
  }
  async function getHeadHash() { const h = await getHeadInfo(); return h.hash; }
  async function buildTreeMap(treeHash, prefix = '', map = new Map()) {
    const obj = await readObject(treeHash);
    if (!obj || obj.type !== 'tree') throw new Error(`BrowserGit: object ${treeHash} is not a tree`);
    for (const e of parseTree(obj.body)) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.mode === '40000') await buildTreeMap(e.sha, path, map); else map.set(path, { path, sha: e.sha, mode: e.mode, source: 'head' });
    }
    return map;
  }
  async function headTreeMap() {
    const headHash = await getHeadHash();
    if (!headHash) return new Map();
    const commitObj = await readObject(headHash);
    if (!commitObj || commitObj.type !== 'commit') return new Map();
    const commit = parseCommit(commitObj.body);
    if (!commit.tree) return new Map();
    return await buildTreeMap(commit.tree);
  }
  async function parseIndex() {
    const bytes = await readPathBytes('.git/index');
    const sig = td.decode(bytes.slice(0, 4));
    if (sig !== 'DIRC') throw new Error('BrowserGit: unsupported git index: bad signature');
    const version = u32be(bytes, 4);
    if (version !== 2 && version !== 3) throw new Error(`BrowserGit: unsupported git index version: ${version}`);
    const count = u32be(bytes, 8);
    let off = 12;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const modeNum = u32be(bytes, off + 24);
      const sha = hex(bytes.slice(off + 40, off + 60));
      const flags = (bytes[off + 60] << 8) | bytes[off + 61];
      const stage = (flags >> 12) & 3;
      let pathStart = off + 62;
      if (version === 3 && (flags & 0x4000)) pathStart += 2;
      let end = pathStart; while (bytes[end] !== 0) end++;
      const path = td.decode(bytes.slice(pathStart, end));
      const entryLen = Math.ceil((end + 1 - off) / 8) * 8;
      if (stage === 0) entries.push({ path, sha, mode: modeNum.toString(8), modeNum, size: u32be(bytes, off + 36), flags, stage, source: 'index' });
      off += entryLen;
    }
    return { sig, version, count, entries, checksum: hex(bytes.slice(bytes.length - 20)) };
  }
  async function indexMap() { const idx = await parseIndex(); return new Map(idx.entries.map(e => [e.path, e])); }
  function parseArgs(rawArgs, defaults = {}) {
    const out = { cached: false, stat: false, short: false, porcelain: false, paths: [], context: 3, ...defaults };
    const tokens = [];
    for (const arg of rawArgs) {
      if (Array.isArray(arg)) tokens.push(...arg);
      else if (typeof arg === 'string') tokens.push(...arg.trim().split(/\s+/).filter(Boolean));
      else if (arg && typeof arg === 'object' && !isHandleLike(arg)) {
        Object.assign(out, arg);
        if (arg.paths != null) out.paths = Array.isArray(arg.paths) ? [...arg.paths] : [arg.paths];
      }
    }
    for (const t of tokens) {
      if (t === '--cached' || t === '--staged') out.cached = true;
      else if (t === '--stat') out.stat = true;
      else if (t === '--short' || t === '-s') out.short = true;
      else if (t === '--porcelain') out.porcelain = true;
      else if (t === '--') continue;
      else if (!t.startsWith('-')) out.paths.push(t);
    }
    return out;
  }
  function pathMatches(path, paths) { if (!paths || !paths.length) return true; return paths.some(p => path === p || path.startsWith(p.replace(/\/$/, '') + '/')); }
  function splitLines(text) { if (!text) return []; const arr = text.split(/\r?\n/); if (arr.length && arr[arr.length - 1] === '') arr.pop(); return arr; }
  function diffLineOps(oldLines, newLines) {
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
    let oldEnd = oldLines.length - 1, newEnd = newLines.length - 1;
    while (oldEnd >= prefix && newEnd >= prefix && oldLines[oldEnd] === newLines[newEnd]) { oldEnd--; newEnd--; }
    const ops = [];
    for (let i = 0; i < prefix; i++) ops.push({ type: ' ', line: oldLines[i] });
    const a = oldLines.slice(prefix, oldEnd + 1), b = newLines.slice(prefix, newEnd + 1);
    const n = a.length, m = b.length;
    if (n && m && n * m <= 5000000) {
      const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) {
        const row = dp[i], next = dp[i + 1];
        for (let j = m - 1; j >= 0; j--) row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ type: ' ', line: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: '-', line: a[i++] }); }
        else { ops.push({ type: '+', line: b[j++] }); }
      }
      while (i < n) ops.push({ type: '-', line: a[i++] });
      while (j < m) ops.push({ type: '+', line: b[j++] });
    } else {
      for (const line of a) ops.push({ type: '-', line });
      for (const line of b) ops.push({ type: '+', line });
    }
    for (let i = oldEnd + 1; i < oldLines.length; i++) ops.push({ type: ' ', line: oldLines[i] });
    return ops;
  }
  function lineStatsFromOps(ops) { let additions = 0, deletions = 0; for (const op of ops) { if (op.type === '+') additions++; else if (op.type === '-') deletions++; } return { additions, deletions }; }
  function looksBinary(bytes) { const len = Math.min(bytes?.length || 0, 8192); for (let i = 0; i < len; i++) if (bytes[i] === 0) return true; return false; }
  function shortHash(h) { return h ? h.slice(0, 7) : '0000000'; }
  function renderUnifiedDiff(path, oldBytes, newBytes, meta = {}, context = 3) {
    const oldExists = oldBytes != null;
    const newExists = newBytes != null;
    if (oldExists && newExists && meta.oldSha && meta.newSha && meta.oldSha === meta.newSha && meta.oldMode === meta.newMode) return '';
    const oldLabel = oldExists ? `a/${path}` : '/dev/null';
    const newLabel = newExists ? `b/${path}` : '/dev/null';
    const lines = [`diff --git a/${path} b/${path}`];
    if (!oldExists && newExists) lines.push(`new file mode ${meta.newMode || '100644'}`);
    else if (oldExists && !newExists) lines.push(`deleted file mode ${meta.oldMode || '100644'}`);
    else if (oldExists && newExists && meta.oldMode && meta.newMode && meta.oldMode !== meta.newMode) {
      lines.push(`old mode ${meta.oldMode}`);
      lines.push(`new mode ${meta.newMode}`);
    }
    if (meta.oldSha || meta.newSha) lines.push(`index ${shortHash(meta.oldSha)}..${shortHash(meta.newSha)}${meta.oldMode && meta.newMode && meta.oldMode === meta.newMode ? ` ${meta.oldMode}` : ''}`);
    if ((oldExists && looksBinary(oldBytes)) || (newExists && looksBinary(newBytes))) { lines.push(`Binary files ${oldLabel} and ${newLabel} differ`); return lines.join('\n'); }
    const oldText = oldExists ? td.decode(oldBytes) : '';
    const newText = newExists ? td.decode(newBytes) : '';
    const ops = diffLineOps(splitLines(oldText), splitLines(newText));
    if (!ops.some(op => op.type !== ' ')) return lines.join('\n');
    lines.push(`--- ${oldLabel}`);
    lines.push(`+++ ${newLabel}`);
    const changed = [];
    for (let i = 0; i < ops.length; i++) if (ops[i].type !== ' ') changed.push(i);
    const groups = [];
    let s = Math.max(0, changed[0] - context), e = Math.min(ops.length - 1, changed[0] + context);
    for (let i = 1; i < changed.length; i++) {
      const ns = Math.max(0, changed[i] - context), ne = Math.min(ops.length - 1, changed[i] + context);
      if (ns <= e + 1) e = Math.max(e, ne);
      else { groups.push([s, e]); s = ns; e = ne; }
    }
    groups.push([s, e]);
    for (const [gs, ge] of groups) {
      let oldBefore = 0, newBefore = 0;
      for (let i = 0; i < gs; i++) { if (ops[i].type !== '+') oldBefore++; if (ops[i].type !== '-') newBefore++; }
      let oldCount = 0, newCount = 0;
      for (let i = gs; i <= ge; i++) { if (ops[i].type !== '+') oldCount++; if (ops[i].type !== '-') newCount++; }
      let oldStart = oldBefore + 1, newStart = newBefore + 1;
      if (!oldExists) oldStart = 0;
      if (!newExists) newStart = 0;
      lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
      for (let i = gs; i <= ge; i++) lines.push(ops[i].type + ops[i].line);
    }
    return lines.join('\n');
  }
  async function entryBytes(entry, path) {
    if (!entry) return null;
    if (entry.bytes) return entry.bytes;
    if (entry.source === 'work') return await readPathBytes(path);
    return await readBlob(entry.sha);
  }
  async function diffEntries(opts) {
    const out = [];
    if (opts.cached) {
      const head = await headTreeMap();
      const idx = await indexMap();
      const paths = Array.from(new Set([...head.keys(), ...idx.keys()])).filter(p => pathMatches(p, opts.paths)).sort();
      for (const path of paths) {
        const oldE = head.get(path) || null;
        const newE = idx.get(path) || null;
        if (!oldE && !newE) continue;
        if (oldE && newE && oldE.sha === newE.sha && oldE.mode === newE.mode) continue;
        out.push({ path, oldEntry: oldE, newEntry: newE, oldSha: oldE?.sha || null, newSha: newE?.sha || null, oldMode: oldE?.mode || null, newMode: newE?.mode || null });
      }
    } else {
      const idx = await indexMap();
      const paths = Array.from(idx.keys()).filter(p => pathMatches(p, opts.paths)).sort();
      for (const path of paths) {
        const oldE = idx.get(path);
        const bytes = await readPathBytesOrNull(path);
        if (bytes == null) out.push({ path, oldEntry: oldE, newEntry: null, oldSha: oldE.sha, newSha: null, oldMode: oldE.mode, newMode: null });
        else {
          const newSha = await blobHash(bytes);
          if (newSha !== oldE.sha) out.push({ path, oldEntry: oldE, newEntry: { path, bytes, sha: newSha, mode: oldE.mode, source: 'work' }, oldSha: oldE.sha, newSha, oldMode: oldE.mode, newMode: oldE.mode });
        }
      }
    }
    return out;
  }
  async function statForEntries(entries) {
    const rows = [];
    let totalAdd = 0, totalDel = 0;
    for (const e of entries) {
      const oldBytes = await entryBytes(e.oldEntry, e.path);
      const newBytes = await entryBytes(e.newEntry, e.path);
      let additions = 0, deletions = 0, binary = false;
      if ((oldBytes && looksBinary(oldBytes)) || (newBytes && looksBinary(newBytes))) binary = true;
      else ({ additions, deletions } = lineStatsFromOps(diffLineOps(splitLines(oldBytes ? td.decode(oldBytes) : ''), splitLines(newBytes ? td.decode(newBytes) : ''))));
      totalAdd += additions; totalDel += deletions;
      rows.push({ path: e.path, additions, deletions, changes: additions + deletions, binary });
    }
    return { rows, totalAdd, totalDel };
  }
  function renderStat(stat) {
    if (!stat.rows.length) return '';
    const pathWidth = Math.min(60, Math.max(...stat.rows.map(r => r.path.length)));
    const lines = [];
    for (const r of stat.rows) {
      const p = r.path.length > pathWidth ? '...' + r.path.slice(-(pathWidth - 3)) : r.path.padEnd(pathWidth);
      if (r.binary) lines.push(` ${p} | Bin`);
      else lines.push(` ${p} | ${String(r.changes).padStart(4)} ${'+'.repeat(r.additions)}${'-'.repeat(r.deletions)}`);
    }
    const parts = [`${stat.rows.length} file${stat.rows.length === 1 ? '' : 's'} changed`];
    if (stat.totalAdd) parts.push(`${stat.totalAdd} insertion${stat.totalAdd === 1 ? '' : 's'}(+)`);
    if (stat.totalDel) parts.push(`${stat.totalDel} deletion${stat.totalDel === 1 ? '' : 's'}(-)`);
    lines.push(` ${parts.join(', ')}`);
    return lines.join('\n');
  }
  function globToRegex(pattern) {
    let p = pattern.replace(/^\//, '');
    let s = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === '*') { if (p[i + 1] === '*') { s += '.*'; i++; } else s += '[^/]*'; }
      else if (ch === '?') s += '[^/]';
      else s += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
    return new RegExp(`(^|/)${s}(?:/.*)?$`);
  }
  async function loadIgnoreMatchers() {
    const text = await readPathTextOrNull('.gitignore');
    if (!text) return [];
    const matchers = [];
    for (let raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let neg = false;
      if (line.startsWith('!')) { neg = true; line = line.slice(1); }
      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.slice(0, -1);
      matchers.push({ neg, dirOnly, re: globToRegex(line) });
    }
    return matchers;
  }
  function isIgnored(path, isDirectory, matchers) {
    let ignored = false;
    for (const m of matchers) {
      if (m.dirOnly && !isDirectory) continue;
      if (m.re.test(path)) ignored = !m.neg;
    }
    return ignored;
  }
  async function buildStatus(opts = {}) {
    const head = await headTreeMap();
    const idx = await indexMap();
    const staged = [];
    const unstaged = [];
    for (const path of Array.from(new Set([...head.keys(), ...idx.keys()])).sort()) {
      if (!pathMatches(path, opts.paths)) continue;
      const h = head.get(path), i = idx.get(path);
      if (!h && i) staged.push({ path, status: 'A' });
      else if (h && !i) staged.push({ path, status: 'D' });
      else if (h && i && (h.sha !== i.sha || h.mode !== i.mode)) staged.push({ path, status: 'M' });
    }
    for (const [path, i] of Array.from(idx.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (!pathMatches(path, opts.paths)) continue;
      const bytes = await readPathBytesOrNull(path);
      if (bytes == null) unstaged.push({ path, status: 'D' });
      else if (await blobHash(bytes) !== i.sha) unstaged.push({ path, status: 'M' });
    }
    const tracked = new Set(idx.keys());
    const matchers = await loadIgnoreMatchers();
    const untracked = [];
    async function walk(dir, prefix = '') {
      for (const [name, handle] of await readDirEntries(dir)) {
        if (name === '.git') continue;
        const path = prefix ? `${prefix}/${name}` : name;
        if (!pathMatches(path, opts.paths) && opts.paths?.length && !opts.paths.some(p => p.startsWith(path + '/'))) continue;
        if (tracked.has(path)) continue;
        if (isDir(handle)) {
          if (isIgnored(path, true, matchers)) continue;
          await walk(handle, path);
        } else if (isFile(handle)) {
          if (isIgnored(path, false, matchers)) continue;
          untracked.push(path);
        }
      }
    }
    await walk(root);
    return { staged, unstaged, untracked: untracked.sort() };
  }
  function statusWord(ch) { return ({ A: 'new file', M: 'modified', D: 'deleted' })[ch] || ch; }
  function renderStatus(status, head) {
    const lines = [];
    lines.push(head.detached ? `HEAD detached at ${shortHash(head.hash)}` : `On branch ${head.branch}`);
    if (status.staged.length) {
      lines.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
      for (const x of status.staged) lines.push(`\t${statusWord(x.status)}:   ${x.path}`);
    }
    if (status.unstaged.length) {
      lines.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)');
      for (const x of status.unstaged) lines.push(`\t${statusWord(x.status)}:   ${x.path}`);
    }
    if (status.untracked.length) {
      lines.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
      for (const p of status.untracked) lines.push(`\t${p}`);
    }
    if (!status.staged.length && !status.unstaged.length && !status.untracked.length) lines.push('', 'nothing to commit, working tree clean');
    else if (!status.staged.length) lines.push('', 'no changes added to commit (use "git add" and/or "git commit -a")');
    return lines.join('\n');
  }
  async function diffText(opts) {
    const entries = await diffEntries(opts);
    const out = [];
    for (const e of entries) {
      const oldBytes = await entryBytes(e.oldEntry, e.path);
      const newBytes = await entryBytes(e.newEntry, e.path);
      const d = renderUnifiedDiff(e.path, oldBytes, newBytes, e, opts.context ?? 3);
      if (d) out.push(d);
    }
    return out.join('\n');
  }
  async function diffStatText(opts) {
    return renderStat(await statForEntries(await diffEntries(opts)));
  }

  async function diff(...args) {
    await ready;
    const opts = parseArgs(args);
    return log(opts.stat ? await diffStatText(opts) : await diffText(opts));
  }
  async function diffStat(...args) {
    await ready;
    const opts = parseArgs(args, { stat: true });
    return log(await diffStatText(opts));
  }
  async function status(...args) {
    await ready;
    const opts = parseArgs(args);
    const head = await getHeadInfo();
    const stat = await buildStatus(opts);
    if (opts.short || opts.porcelain) {
      const paths = new Set([...stat.staged.map(x => x.path), ...stat.unstaged.map(x => x.path), ...stat.untracked]);
      const stagedMap = new Map(stat.staged.map(x => [x.path, x.status]));
      const unstagedMap = new Map(stat.unstaged.map(x => [x.path, x.status]));
      return log(Array.from(paths).sort().map(p => stat.untracked.includes(p) ? `?? ${p}` : `${stagedMap.get(p) || ' '}${unstagedMap.get(p) || ' '} ${p}`).join('\n'));
    }
    return log(renderStatus(stat, head));
  }

  return {
    ready,
    diff,
    diffStat,
    status,
    getHeadInfo: async () => { await ready; return getHeadInfo(); },
    getHeadHash: async () => { await ready; return getHeadHash(); },
    readObject: async hash => { await ready; return readObject(hash); },
    readBlob: async hash => { await ready; return readBlob(hash); },
    parseIndex: async () => { await ready; return parseIndex(); },
    indexMap: async () => { await ready; return indexMap(); },
    headTreeMap: async () => { await ready; return headTreeMap(); },
    buildStatus: async (...args) => { await ready; return buildStatus(parseArgs(args)); },
  };
}

  global.BrowserGit = BrowserGit;
})(typeof globalThis !== 'undefined' ? globalThis : window);
