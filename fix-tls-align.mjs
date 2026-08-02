#!/usr/bin/env node
/**
 * fix-tls-align.mjs — patch a Chromium ELF binary so ARM64 bionic accepts it.
 *
 * Android's linker requires PT_TLS p_align >= 64 on arm64. Playwright's
 * official Chromium ships p_align = 32, so launch fails with:
 *   "executable's TLS segment is underaligned: alignment is 32 ... needs 64"
 *
 * This rewrites the p_align field (0x30 within each program header) of the
 * PT_TLS header to 64. TLS symbol offsets are relative to the segment base,
 * so rounding the base alignment up is safe.
 *
 * Usage: node fix-tls-align.mjs [--no-backup] <elf-path> [<elf-path> ...]
 * Creates a .tlsbak copy next to each file before patching (idempotent),
 * unless --no-backup is given (use when the filesystem is too full to hold
 * the backup, e.g. when a patched copy already exists elsewhere).
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';

function patch(path, noBackup) {
  const buf = readFileSync(path);
  if (!(buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46)) {
    console.log(`skip (not ELF): ${path}`);
    return;
  }
  if (buf[4] !== 2) { console.log(`skip (not ELF64): ${path}`); return; }
  if (buf[5] !== 1) { console.log(`skip (not little-endian): ${path}`); return; }

  const e_phoff = buf.readBigUInt64LE(0x20);
  const e_phentsize = buf.readUInt16LE(0x36);
  const e_phnum = buf.readUInt16LE(0x38);

  let changed = 0;
  for (let i = 0; i < e_phnum; i++) {
    const off = Number(e_phoff) + i * e_phentsize;
    if (off + 0x38 > buf.length) break;
    const p_type = buf.readUInt32LE(off);
    if (p_type === 7) { // PT_TLS
      const p_align = buf.readBigUInt64LE(off + 0x30);
      console.log(`  PT_TLS p_align=${p_align} (phdr ${i}) in ${path}`);
      if (p_align === 32n) {
        if (!noBackup && !existsSync(`${path}.tlsbak`)) copyFileSync(path, `${path}.tlsbak`);
        buf.writeBigUInt64LE(64n, off + 0x30);
        changed++;
        console.log(`  -> patched to 64`);
      } else if (p_align === 64n) {
        console.log('  already 64');
      } else {
        console.log(`  unexpected alignment ${p_align}; leaving as-is`);
      }
    }
  }
  if (changed > 0) writeFileSync(path, buf);
  console.log(changed > 0 ? `PATCHED ${path}` : `no change ${path}`);
}

const args = process.argv.slice(2);
const noBackup = args.includes('--no-backup');
for (const p of args.filter((a) => a !== '--no-backup')) {
  if (!existsSync(p)) { console.log(`missing: ${p}`); continue; }
  try { patch(p, noBackup); } catch (e) { console.log(`error on ${p}: ${e.message}`); }
}
