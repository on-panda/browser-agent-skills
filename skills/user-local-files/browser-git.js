/*!
 * browser-git.js
 * A tiny browser-only Git read/diff/status reader for FileSystemDirectoryHandle or FileSystemDirectoryEntry.
 *
 * Usage:
 *   // Load this file as a classic script or import it for side effects.
 *   // It exposes globalThis.BrowserGit.
 *   const git = BrowserGit({ gitDir: repoDirectoryHandle });
 *   await git.ready;                         // rejects if .git is not found
 *   console.log(await git.diff());           // index vs working tree
 *   console.log(await git.diff('--cached'));  // HEAD vs index
 *   console.log(await git.diff('--stat'));
 *   console.log(await git.status());
 *   console.log(await git.status('--short'));
 *   console.log(await git.remote('-v'));
 *   console.log(await git.log('--oneline -n 5'));
 *   console.log(await git.show('HEAD'));
 *   console.log(await git.branch('-a'));
 *
 * Notes:
 *   - Command methods return strings only and never print by themselves; use console.log(await ...).
 *   - Works in browsers with File System Access API or legacy FileSystemDirectoryEntry.
 *   - Reads .git directly; no shell, no network.
 *   - Supports loose objects and pack idx v2, including ofs_delta/ref_delta.
 *   - Git index v2/v3 supported; .gitignore support is intentionally lightweight.
 *   - Safari does not expose hidden .git directories through the browser picker; use desktop Chrome.
 */
(function (global) {
  'use strict';

  function BrowserGit(options = {}) {
  const root = options && (options.gitDir || options.root || options);
  const td = new TextDecoder();
  const te = new TextEncoder();

  const isHandleLike = x => !!x && (typeof x.getDirectoryHandle === 'function' || typeof x.createReader === 'function');
  if (!isHandleLike(root)) throw new Error('BrowserGit: gitDir must be a FileSystemDirectoryHandle or FileSystemDirectoryEntry');

  function commandResult(value) { return value == null ? '' : String(value); }
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

  const cache = { idx: new Map(), packBytes: new Map(), objAtOffset: new Map(), objByHash: new Map(), packList: null, packedRefs: null };

  function isProbablySafari() {
    const nav = globalThis.navigator || {};
    const ua = nav.userAgent || '';
    const vendor = nav.vendor || '';
    const brands = nav.userAgentData && Array.isArray(nav.userAgentData.brands) ? nav.userAgentData.brands.map(b => b.brand).join(' ') : '';
    return /Apple/i.test(vendor) && /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Opera|Android/i.test(ua) && !/Chromium|Google Chrome|Microsoft Edge|Opera/i.test(brands);
  }
  function missingGitDirErrorMessage() {
    if (isProbablySafari()) return 'BrowserGit: .git not found. Safari does not expose hidden `.git` directories to browser JavaScript/File System Access, so this repository cannot be read in Safari. Please switch to desktop Chrome and select the repository directory again.';
    return 'BrowserGit: .git not found in gitDir. Select the repository root directory that contains a .git folder.';
  }
  const ready = (async () => {
    if (!(await existsDir(root, '.git'))) throw new Error(missingGitDirErrorMessage());
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

  function isFullHash(s) { return /^[0-9a-f]{40}$/i.test(String(s || '')); }
  function isAbbrevHash(s) { return /^[0-9a-f]{4,40}$/i.test(String(s || '')); }
  function firstLine(text) { return String(text || '').split(/\r?\n/)[0].trim(); }
  function notFoundName(e) { return e && ['NotFoundError', 'TypeMismatchError', 'NotFound'].includes(e.name); }
  function unescapeConfigString(s) {
    return String(s || '').replace(/\\([\\"])/g, '$1');
  }
  function parseGitConfigText(text) {
    const sections = [];
    let current = null;
    for (let raw of String(text || '').split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const hash = line.indexOf('#'), semi = line.indexOf(';');
      const cut = [hash, semi].filter(i => i >= 0).sort((a, b) => a - b)[0];
      if (cut != null && cut > 0 && /\s/.test(line[cut - 1])) line = line.slice(0, cut).trim();
      const sec = line.match(/^\[([^\s\]"']+)(?:\s+"((?:\\.|[^"])*)")?\]$/);
      if (sec) {
        current = { name: sec[1].toLowerCase(), subsection: sec[2] != null ? unescapeConfigString(sec[2]) : null, values: new Map() };
        sections.push(current);
        continue;
      }
      if (!current) continue;
      const eq = line.indexOf('=');
      const key = (eq >= 0 ? line.slice(0, eq) : line).trim().toLowerCase();
      let value = eq >= 0 ? line.slice(eq + 1).trim() : 'true';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      value = unescapeConfigString(value);
      if (!current.values.has(key)) current.values.set(key, []);
      current.values.get(key).push(value);
    }
    return sections;
  }
  async function readGitConfig() {
    return parseGitConfigText(await readPathTextOrNull('.git/config') || '');
  }
  function configValues(sections, name, subsection, key) {
    const out = [];
    for (const s of sections) if (s.name === name && (subsection == null || s.subsection === subsection)) out.push(...(s.values.get(key.toLowerCase()) || []));
    return out;
  }
  async function getRemoteMap() {
    const remotes = new Map();
    for (const s of await readGitConfig()) {
      if (s.name !== 'remote' || !s.subsection) continue;
      const name = s.subsection;
      remotes.set(name, {
        name,
        url: [...(s.values.get('url') || [])],
        pushurl: [...(s.values.get('pushurl') || [])],
      });
    }
    return remotes;
  }
  async function upstreamForBranch(branchName) {
    const sections = await readGitConfig();
    const remote = configValues(sections, 'branch', branchName, 'remote')[0];
    const merge = configValues(sections, 'branch', branchName, 'merge')[0];
    if (!remote || !merge) return '';
    const shortMerge = merge.replace(/^refs\/heads\//, '');
    return remote === '.' ? shortMerge : `${remote}/${shortMerge}`;
  }
  async function readPackedRefs() {
    if (cache.packedRefs) return cache.packedRefs;
    const packed = new Map();
    const text = await readPathTextOrNull('.git/packed-refs');
    let lastRef = null;
    if (text) {
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('^')) {
          if (lastRef && packed.has(lastRef)) packed.get(lastRef).peeled = line.slice(1).trim();
          continue;
        }
        const m = line.match(/^([0-9a-f]{40})\s+(.+)$/i);
        if (!m) continue;
        lastRef = m[2].trim();
        packed.set(lastRef, { ref: lastRef, hash: m[1].toLowerCase(), peeled: null, packed: true });
      }
    }
    cache.packedRefs = packed;
    return packed;
  }
  async function resolveRef(ref = 'HEAD', seen = new Set()) {
    ref = String(ref || 'HEAD').trim();
    if (!ref) ref = 'HEAD';
    if (isFullHash(ref)) return ref.toLowerCase();
    if (seen.has(ref)) throw new Error(`BrowserGit: cyclic git ref: ${ref}`);
    seen.add(ref);
    if (ref === 'HEAD') {
      const head = await readPathTextOrNull('.git/HEAD');
      if (!head) return null;
      const line = firstLine(head);
      if (line.startsWith('ref: ')) return await resolveRef(line.slice(5).trim(), seen);
      return isFullHash(line) ? line.toLowerCase() : null;
    }
    const candidates = ref.startsWith('refs/') ? [ref] : [ref, `refs/heads/${ref}`, `refs/remotes/${ref}`, `refs/tags/${ref}`];
    for (const candidate of candidates) {
      const text = await readPathTextOrNull(`.git/${candidate}`);
      if (!text) continue;
      const line = firstLine(text);
      if (line.startsWith('ref: ')) return await resolveRef(line.slice(5).trim(), seen);
      if (isFullHash(line)) return line.toLowerCase();
    }
    const packed = await readPackedRefs();
    for (const candidate of candidates) if (packed.has(candidate)) return packed.get(candidate).hash;
    return null;
  }
  async function listLooseRefs(prefix) {
    const out = [];
    async function walk(dir, refPrefix) {
      for (const [name, handle] of await readDirEntries(dir)) {
        const ref = `${refPrefix}/${name}`;
        if (isDir(handle)) await walk(handle, ref);
        else if (isFile(handle)) {
          const text = await readTextFromFileHandle(handle);
          const line = firstLine(text);
          let hash = null, symbolic = null;
          if (line.startsWith('ref: ')) { symbolic = line.slice(5).trim(); hash = await resolveRef(symbolic); }
          else if (isFullHash(line)) hash = line.toLowerCase();
          if (hash) out.push({ ref, hash, symbolic, packed: false });
        }
      }
    }
    try { await walk(await getHandleByPath(root, `.git/${prefix}`, 'directory'), prefix); }
    catch (e) { if (!notFoundName(e)) throw e; }
    return out;
  }
  async function listRefs(prefixes = ['refs/heads', 'refs/remotes', 'refs/tags']) {
    const map = new Map();
    for (const prefix of prefixes) for (const r of await listLooseRefs(prefix)) map.set(r.ref, r);
    const packed = await readPackedRefs();
    for (const [ref, r] of packed) if (prefixes.some(p => ref === p || ref.startsWith(p + '/')) && !map.has(ref)) map.set(ref, { ...r });
    return Array.from(map.values()).sort((a, b) => a.ref.localeCompare(b.ref));
  }
  async function resolveAbbrevHash(prefix) {
    prefix = String(prefix || '').toLowerCase();
    if (!isAbbrevHash(prefix)) return null;
    if (prefix.length === 40) return prefix;
    const matches = new Set();
    for (const r of await listRefs()) if (r.hash && r.hash.startsWith(prefix)) matches.add(r.hash);
    try {
      const dir = await getHandleByPath(root, `.git/objects/${prefix.slice(0, 2)}`, 'directory');
      for (const [name, handle] of await readDirEntries(dir)) if (isFile(handle)) {
        const h = prefix.slice(0, 2) + name;
        if (h.startsWith(prefix) && isFullHash(h)) matches.add(h);
      }
    } catch (e) { if (!notFoundName(e)) throw e; }
    for (const baseName of await listPackBaseNames()) {
      const idx = await getPackIndex(baseName);
      for (let i = 0; i < idx.count; i++) {
        const h = hex(idx.names.slice(i * 20, i * 20 + 20));
        if (h.startsWith(prefix)) matches.add(h);
      }
    }
    if (matches.size > 1) throw new Error(`BrowserGit: ambiguous object name: ${prefix}`);
    return matches.values().next().value || null;
  }
  function parseTag(body) {
    const text = td.decode(body);
    const cut = text.indexOf('\n\n');
    const headers = cut >= 0 ? text.slice(0, cut) : text;
    const message = cut >= 0 ? text.slice(cut + 2) : '';
    const out = { message };
    for (const line of headers.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      out[line.slice(0, sp)] = line.slice(sp + 1);
    }
    return out;
  }
  async function peelToType(hash, targetType = 'commit') {
    hash = String(hash || '').trim().toLowerCase();
    for (let i = 0; i < 20; i++) {
      const obj = await readObject(hash);
      if (!obj) return null;
      if (obj.type === targetType) return hash;
      if (obj.type === 'tag') { hash = parseTag(obj.body).object; continue; }
      throw new Error(`BrowserGit: object ${hash} is ${obj.type}, not ${targetType}`);
    }
    throw new Error('BrowserGit: too many nested tags');
  }
  function splitAncestry(rev) {
    let base = String(rev || 'HEAD').trim();
    const ops = [];
    while (true) {
      const m = base.match(/([~^])(\d*)$/);
      if (!m) break;
      ops.unshift({ op: m[1], n: m[2] === '' ? 1 : Number(m[2]) });
      base = base.slice(0, m.index);
    }
    return { base: base || 'HEAD', ops };
  }
  async function readCommitByHash(hash) {
    const commitHash = await peelToType(hash, 'commit');
    const obj = await readObject(commitHash);
    const commit = parseCommit(obj.body);
    commit.hash = commitHash;
    return commit;
  }
  async function resolveCommitish(rev = 'HEAD') {
    const { base, ops } = splitAncestry(rev);
    let hash = await resolveRef(base);
    if (!hash && isAbbrevHash(base)) hash = await resolveAbbrevHash(base);
    if (!hash) throw new Error(`BrowserGit: unknown revision: ${rev}`);
    for (const op of ops) {
      if (op.op === '^' && op.n === 0) { hash = await peelToType(hash, 'commit'); continue; }
      const repeat = op.op === '~' ? op.n : 1;
      const parentIndex = op.op === '^' ? Math.max(1, op.n) - 1 : 0;
      for (let i = 0; i < repeat; i++) {
        const commit = await readCommitByHash(hash);
        if (!commit.parents[parentIndex]) throw new Error(`BrowserGit: revision ${rev} has no requested parent`);
        hash = commit.parents[parentIndex];
      }
    }
    return await peelToType(hash, 'commit');
  }
  async function resolveObjectHash(spec = 'HEAD') {
    spec = String(spec || 'HEAD').trim() || 'HEAD';
    let hash = await resolveRef(spec);
    if (!hash && isAbbrevHash(spec)) hash = await resolveAbbrevHash(spec);
    if (!hash && /[~^]\d*$/.test(spec)) hash = await resolveCommitish(spec);
    if (!hash) throw new Error(`BrowserGit: unknown object: ${spec}`);
    return hash;
  }
  async function treeMapForCommitHash(hash) {
    const commit = await readCommitByHash(hash);
    if (!commit.tree) return new Map();
    return await buildTreeMap(commit.tree);
  }
  async function diffEntriesBetweenMaps(oldMap, newMap, opts = {}) {
    const out = [];
    const paths = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).filter(p => pathMatches(p, opts.paths)).sort();
    for (const path of paths) {
      const oldE = oldMap.get(path) || null;
      const newE = newMap.get(path) || null;
      if (!oldE && !newE) continue;
      if (oldE && newE && oldE.sha === newE.sha && oldE.mode === newE.mode) continue;
      out.push({ path, oldEntry: oldE, newEntry: newE, oldSha: oldE?.sha || null, newSha: newE?.sha || null, oldMode: oldE?.mode || null, newMode: newE?.mode || null });
    }
    return out;
  }
  async function commitDiffEntries(hash, commit = null, opts = {}) {
    commit = commit || await readCommitByHash(hash);
    const oldMap = commit.parents && commit.parents[0] ? await treeMapForCommitHash(commit.parents[0]) : new Map();
    const newMap = commit.tree ? await buildTreeMap(commit.tree) : new Map();
    return await diffEntriesBetweenMaps(oldMap, newMap, opts);
  }
  async function renderDiffEntriesText(entries, opts = {}) {
    const out = [];
    for (const e of entries) {
      const oldBytes = await entryBytes(e.oldEntry, e.path);
      const newBytes = await entryBytes(e.newEntry, e.path);
      const d = renderUnifiedDiff(e.path, oldBytes, newBytes, e, opts.context ?? 3);
      if (d) out.push(d);
    }
    return out.join('\n');
  }
  function parsePerson(raw) {
    const m = String(raw || '').match(/^(.*?)(?:\s+<([^>]*)>)?\s+(\d+)\s+([+-]\d{4})$/);
    if (!m) return { raw: String(raw || '') };
    return { raw: String(raw || ''), name: m[1].trim(), email: m[2] || '', timestamp: Number(m[3]), tz: m[4] };
  }
  function formatPersonName(raw) {
    const p = parsePerson(raw);
    if (p.name || p.email) return p.email ? `${p.name} <${p.email}>` : p.name;
    return p.raw.replace(/\s+\d+\s+[+-]\d{4}$/, '');
  }
  function formatGitDate(raw) {
    const p = parsePerson(raw);
    if (!Number.isFinite(p.timestamp)) return p.raw || '';
    const tz = p.tz || '+0000';
    const sign = tz[0] === '-' ? -1 : 1;
    const offset = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    const d = new Date((p.timestamp + offset * 60) * 1000);
    const w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const pad = n => String(n).padStart(2, '0');
    return `${w} ${mo} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCFullYear()} ${tz}`;
  }
  function commitSubject(commit) { return splitLines(String(commit.message || '').trim())[0] || ''; }
  function renderIndentedMessage(message) {
    const body = String(message || '').replace(/\s+$/, '');
    if (!body) return [];
    return body.split(/\r?\n/).map(line => line ? `    ${line}` : '');
  }
  function renderCommitHeader(hash, commit, opts = {}) {
    const subject = commitSubject(commit);
    if (opts.oneline) return `${shortHash(hash)} ${subject}`.trimEnd();
    const lines = [`commit ${hash}`];
    if (commit.parents && commit.parents.length > 1) lines.push(`Merge: ${commit.parents.map(shortHash).join(' ')}`);
    if (commit.author) lines.push(`Author: ${formatPersonName(commit.author)}`);
    if (commit.author) lines.push(`Date:   ${formatGitDate(commit.author)}`);
    lines.push('', ...renderIndentedMessage(commit.message));
    return lines.join('\n');
  }
  function commitTime(commit) {
    const c = parsePerson(commit.committer || commit.author || '');
    return Number.isFinite(c.timestamp) ? c.timestamp : 0;
  }

  async function getHeadInfo() {
    const headText = (await readPathText('.git/HEAD')).trim();
    if (!headText.startsWith('ref: ')) return { detached: true, branch: null, ref: null, hash: headText };
    const ref = headText.slice(5).trim();
    const hash = await resolveRef(ref);
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
    const bytes = await readPathBytesOrNull('.git/index');
    if (!bytes) return { sig: 'DIRC', version: 2, count: 0, entries: [], checksum: '' };
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

  function flattenCommandArgs(rawArgs) {
    const tokens = [];
    const objects = [];
    for (const arg of rawArgs) {
      if (Array.isArray(arg)) tokens.push(...arg.map(String));
      else if (typeof arg === 'string') tokens.push(...arg.trim().split(/\s+/).filter(Boolean));
      else if (arg && typeof arg === 'object' && !isHandleLike(arg)) objects.push(arg);
    }
    return { tokens, objects };
  }
  function applyObjectOptions(opts, objects) {
    for (const obj of objects) {
      Object.assign(opts, obj);
      if (obj.paths != null) opts.paths = Array.isArray(obj.paths) ? [...obj.paths] : [obj.paths];
      if (obj.path != null && opts.paths && !opts.paths.length) opts.paths = [obj.path];
      if (obj.maxCount != null) opts.maxCount = Number(obj.maxCount);
    }
    return opts;
  }
  function parseContextOption(t, next) {
    if (t === '-U' || t === '--unified') return { usedNext: true, value: Math.max(0, Number(next || 3)) };
    let m = t.match(/^-U(\d+)$/); if (m) return { usedNext: false, value: Number(m[1]) };
    m = t.match(/^--unified=(\d+)$/); if (m) return { usedNext: false, value: Number(m[1]) };
    return null;
  }
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
    return commandResult(opts.stat ? await diffStatText(opts) : await diffText(opts));
  }
  async function diffStat(...args) {
    await ready;
    const opts = parseArgs(args, { stat: true });
    return commandResult(await diffStatText(opts));
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
      return commandResult(Array.from(paths).sort().map(p => stat.untracked.includes(p) ? `?? ${p}` : `${stagedMap.get(p) || ' '}${unstagedMap.get(p) || ' '} ${p}`).join('\n'));
    }
    return commandResult(renderStatus(stat, head));
  }


  function parseRemoteCommandArgs(rawArgs) {
    const { tokens, objects } = flattenCommandArgs(rawArgs);
    const opts = applyObjectOptions({ verbose: false }, objects);
    for (const t of tokens) {
      if (t === '-v' || t === '--verbose') opts.verbose = true;
      else if (t === '--') continue;
      else throw new Error(`BrowserGit: only read-only git remote listing is supported (use git.remote('-v')); unsupported argument: ${t}`);
    }
    return opts;
  }
  async function gitRemote(...args) {
    await ready;
    const opts = parseRemoteCommandArgs(args);
    const remotes = Array.from((await getRemoteMap()).values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!opts.verbose) return commandResult(remotes.map(r => r.name).join('\n'));
    const lines = [];
    for (const r of remotes) {
      const fetchUrls = r.url.length ? r.url : [];
      const pushUrls = r.pushurl.length ? r.pushurl : fetchUrls;
      for (const url of fetchUrls) lines.push(`${r.name}\t${url} (fetch)`);
      for (const url of pushUrls) lines.push(`${r.name}\t${url} (push)`);
    }
    return commandResult(lines.join('\n'));
  }
  function parseBranchCommandArgs(rawArgs) {
    const { tokens, objects } = flattenCommandArgs(rawArgs);
    const opts = applyObjectOptions({ all: false, remotes: false, verbose: 0, showCurrent: false }, objects);
    for (const t of tokens) {
      if (t === '--show-current') opts.showCurrent = true;
      else if (t === '-a' || t === '--all') opts.all = true;
      else if (t === '-r' || t === '--remotes') opts.remotes = true;
      else if (t === '-v' || t === '--verbose') opts.verbose = Math.max(opts.verbose, 1);
      else if (t === '-vv') opts.verbose = Math.max(opts.verbose, 2);
      else if (/^-[arv]+$/.test(t)) {
        if (t.includes('a')) opts.all = true;
        if (t.includes('r')) opts.remotes = true;
        const vCount = (t.match(/v/g) || []).length;
        if (vCount) opts.verbose = Math.max(opts.verbose, vCount);
      }
      else if (t === '--no-color' || t.startsWith('--color')) continue;
      else throw new Error(`BrowserGit: git branch is read-only here; creating/deleting/renaming branches is not supported: ${t}`);
    }
    return opts;
  }
  async function gitBranch(...args) {
    await ready;
    const opts = parseBranchCommandArgs(args);
    const head = await getHeadInfo();
    if (opts.showCurrent) return commandResult(head.detached ? '' : (head.branch || ''));
    const items = [];
    if (!opts.remotes || opts.all) {
      for (const r of await listRefs(['refs/heads'])) items.push({ kind: 'local', ref: r.ref, name: r.ref.replace(/^refs\/heads\//, ''), display: r.ref.replace(/^refs\/heads\//, ''), hash: r.hash, current: !head.detached && r.ref === head.ref });
    }
    if (opts.remotes || opts.all) {
      for (const r of await listRefs(['refs/remotes'])) {
        const short = r.ref.replace(/^refs\/remotes\//, '');
        if (/\/HEAD$/.test(short)) continue;
        items.push({ kind: 'remote', ref: r.ref, name: short, display: opts.all ? `remotes/${short}` : short, hash: r.hash, current: false });
      }
    }
    items.sort((a, b) => a.display.localeCompare(b.display));
    if (head.detached && !opts.remotes) items.unshift({ kind: 'detached', display: `(HEAD detached at ${shortHash(head.hash)})`, hash: head.hash, current: true });
    const width = items.length ? Math.max(...items.map(x => x.display.length)) : 0;
    const lines = [];
    for (const item of items) {
      const mark = item.current ? '*' : ' ';
      if (!opts.verbose) { lines.push(`${mark} ${item.display}`); continue; }
      let subject = '';
      try { subject = item.hash ? commitSubject(await readCommitByHash(item.hash)) : ''; } catch (_) {}
      let upstream = '';
      if (opts.verbose >= 2 && item.kind === 'local') upstream = await upstreamForBranch(item.name);
      lines.push(`${mark} ${item.display.padEnd(width)} ${shortHash(item.hash)}${upstream ? ` [${upstream}]` : ''}${subject ? ` ${subject}` : ''}`.trimEnd());
    }
    return commandResult(lines.join('\n'));
  }
  function parseLogCommandArgs(rawArgs) {
    const { tokens, objects } = flattenCommandArgs(rawArgs);
    const opts = applyObjectOptions({ maxCount: Infinity, oneline: false, stat: false, patch: false, nameOnly: false, all: false, revs: [], paths: [], context: 3 }, objects);
    let afterDashDash = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (afterDashDash) { opts.paths.push(t); continue; }
      if (t === '--') { afterDashDash = true; continue; }
      if (t === '--oneline') { opts.oneline = true; continue; }
      if (t === '--stat') { opts.stat = true; continue; }
      if (t === '-p' || t === '--patch') { opts.patch = true; continue; }
      if (t === '--name-only') { opts.nameOnly = true; continue; }
      if (t === '--all') { opts.all = true; continue; }
      if (t === '--no-color' || t.startsWith('--color')) continue;
      let c = parseContextOption(t, tokens[i + 1]);
      if (c) { opts.context = c.value; if (c.usedNext) i++; continue; }
      let m = t.match(/^--max-count=(\d+)$/); if (m) { opts.maxCount = Number(m[1]); continue; }
      if (t === '--max-count' || t === '-n') { opts.maxCount = Number(tokens[++i] || 0); continue; }
      m = t.match(/^-n(\d+)$/); if (m) { opts.maxCount = Number(m[1]); continue; }
      m = t.match(/^-(\d+)$/); if (m) { opts.maxCount = Number(m[1]); continue; }
      m = t.match(/^--(?:pretty|format)=(.+)$/); if (m) { if (/oneline/.test(m[1])) opts.oneline = true; continue; }
      if (t.startsWith('-')) throw new Error(`BrowserGit: unsupported git log option: ${t}`);
      opts.revs.push(t);
    }
    return opts;
  }
  async function logStartHashes(opts) {
    if (opts.all) {
      const refs = await listRefs(['refs/heads', 'refs/remotes', 'refs/tags']);
      return Array.from(new Set(refs.map(r => r.hash).filter(Boolean)));
    }
    const revs = opts.revs.length ? opts.revs : ['HEAD'];
    const out = [];
    for (const spec of revs) {
      try { out.push(await resolveCommitish(spec)); }
      catch (e) {
        if (opts.revs.length) opts.paths.push(spec);
        else throw e;
      }
    }
    if (!out.length && opts.revs.length) out.push(await resolveCommitish('HEAD'));
    return Array.from(new Set(out));
  }
  async function commitTouchesPaths(hash, commit, paths) {
    if (!paths || !paths.length) return true;
    return (await commitDiffEntries(hash, commit, { paths })).length > 0;
  }
  async function walkCommits(startHashes, opts) {
    const pending = [];
    const queued = new Set();
    async function enqueue(hash) {
      hash = await peelToType(hash, 'commit');
      if (!hash || queued.has(hash)) return;
      queued.add(hash);
      const commit = await readCommitByHash(hash);
      pending.push({ hash, commit, time: commitTime(commit) });
    }
    for (const h of startHashes) await enqueue(h);
    const seen = new Set();
    const out = [];
    while (pending.length && out.length < opts.maxCount) {
      pending.sort((a, b) => b.time - a.time || a.hash.localeCompare(b.hash));
      const item = pending.shift();
      if (seen.has(item.hash)) continue;
      seen.add(item.hash);
      if (await commitTouchesPaths(item.hash, item.commit, opts.paths)) out.push(item);
      for (const p of item.commit.parents || []) await enqueue(p);
    }
    return out;
  }
  async function renderLogCommit(hash, commit, opts) {
    const parts = [renderCommitHeader(hash, commit, opts)];
    let entries = null;
    if (opts.nameOnly || opts.stat || opts.patch) entries = await commitDiffEntries(hash, commit, opts);
    if (opts.nameOnly && entries.length) parts.push(entries.map(e => e.path).join('\n'));
    if (opts.stat && entries.length) parts.push(renderStat(await statForEntries(entries)));
    if (opts.patch && entries.length) parts.push(await renderDiffEntriesText(entries, opts));
    return parts.filter(x => x != null && x !== '').join(opts.oneline ? '\n' : '\n\n');
  }
  async function gitLog(...args) {
    await ready;
    const opts = parseLogCommandArgs(args);
    if (!Number.isFinite(opts.maxCount)) opts.maxCount = Infinity;
    const startHashes = await logStartHashes(opts);
    const commits = await walkCommits(startHashes, opts);
    const chunks = [];
    for (const { hash, commit } of commits) chunks.push(await renderLogCommit(hash, commit, opts));
    return commandResult(chunks.join(opts.oneline ? '\n' : '\n\n'));
  }
  function parseShowCommandArgs(rawArgs) {
    const { tokens, objects } = flattenCommandArgs(rawArgs);
    const opts = applyObjectOptions({ object: null, paths: [], stat: false, patch: null, noPatch: false, nameOnly: false, oneline: false, context: 3 }, objects);
    let afterDashDash = false;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (afterDashDash) { opts.paths.push(t); continue; }
      if (t === '--') { afterDashDash = true; continue; }
      if (t === '--stat') { opts.stat = true; if (opts.patch == null) opts.patch = false; continue; }
      if (t === '-p' || t === '--patch') { opts.patch = true; continue; }
      if (t === '--no-patch' || t === '-s') { opts.noPatch = true; opts.patch = false; continue; }
      if (t === '--name-only') { opts.nameOnly = true; opts.patch = false; continue; }
      if (t === '--oneline') { opts.oneline = true; continue; }
      if (t === '--no-color' || t.startsWith('--color')) continue;
      let c = parseContextOption(t, tokens[i + 1]);
      if (c) { opts.context = c.value; if (c.usedNext) i++; continue; }
      let m = t.match(/^--(?:pretty|format)=(.+)$/); if (m) { if (/oneline/.test(m[1])) opts.oneline = true; continue; }
      if (t.startsWith('-')) throw new Error(`BrowserGit: unsupported git show option: ${t}`);
      if (!opts.object) opts.object = t; else opts.paths.push(t);
    }
    if (!opts.object) opts.object = 'HEAD';
    if (opts.patch == null) opts.patch = !opts.noPatch && !opts.stat && !opts.nameOnly;
    return opts;
  }
  function splitRevPathSpec(spec) {
    const s = String(spec || '');
    const i = s.indexOf(':');
    if (i <= 0) return null;
    return { rev: s.slice(0, i) || 'HEAD', path: s.slice(i + 1) };
  }
  async function showBlobAtRev(rev, path) {
    const commitHash = await resolveCommitish(rev || 'HEAD');
    const map = await treeMapForCommitHash(commitHash);
    const entry = map.get(path);
    if (!entry) throw new Error(`BrowserGit: path not found in ${rev}: ${path}`);
    const bytes = await readBlob(entry.sha);
    if (looksBinary(bytes)) return `Binary file ${path} (${entry.sha})`;
    return td.decode(bytes);
  }
  async function renderShowCommit(hash, commit, opts) {
    const parts = [renderCommitHeader(hash, commit, opts)];
    let entries = null;
    if (opts.nameOnly || opts.stat || opts.patch) entries = await commitDiffEntries(hash, commit, opts);
    if (opts.nameOnly && entries.length) parts.push(entries.map(e => e.path).join('\n'));
    if (opts.stat && entries.length) parts.push(renderStat(await statForEntries(entries)));
    if (opts.patch && entries.length) parts.push(await renderDiffEntriesText(entries, opts));
    return parts.filter(x => x != null && x !== '').join(opts.oneline ? '\n' : '\n\n');
  }
  function renderTagObject(hash, tag) {
    const lines = [`tag ${tag.tag || shortHash(hash)}`];
    if (tag.tagger) lines.push(`Tagger: ${formatPersonName(tag.tagger)}`, `Date:   ${formatGitDate(tag.tagger)}`);
    lines.push('', ...renderIndentedMessage(tag.message));
    return lines.join('\n');
  }
  async function gitShow(...args) {
    await ready;
    const opts = parseShowCommandArgs(args);
    const revPath = splitRevPathSpec(opts.object);
    if (revPath) return commandResult(await showBlobAtRev(revPath.rev, revPath.path));
    const hash = await resolveObjectHash(opts.object);
    const obj = await readObject(hash);
    if (!obj) throw new Error(`BrowserGit: object not found: ${opts.object}`);
    if (obj.type === 'commit') return commandResult(await renderShowCommit(hash, parseCommit(obj.body), opts));
    if (obj.type === 'blob') return commandResult(looksBinary(obj.body) ? `Binary object ${hash}` : td.decode(obj.body));
    if (obj.type === 'tree') return commandResult(parseTree(obj.body).map(e => `${e.mode} ${e.sha}\t${e.name}`).join('\n'));
    if (obj.type === 'tag') {
      const tag = parseTag(obj.body);
      const parts = [renderTagObject(hash, tag)];
      if (tag.object) {
        try {
          const target = await readObject(tag.object);
          if (target && target.type === 'commit') parts.push(await renderShowCommit(tag.object, parseCommit(target.body), opts));
        } catch (_) {}
      }
      return commandResult(parts.filter(Boolean).join('\n\n'));
    }
    return commandResult(`${obj.type} ${hash}\n${td.decode(obj.body)}`);
  }

  return {
    ready,
    diff,
    diffStat,
    status,
    remote: gitRemote,
    log: gitLog,
    show: gitShow,
    branch: gitBranch,
  };
}

  global.BrowserGit = BrowserGit;
})(typeof globalThis !== 'undefined' ? globalThis : window);