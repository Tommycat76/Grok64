import type { SdPartition, SdFile } from "./sd2iec";
import { isSd2iecWriteEnabled } from "./sd2iec-card-source";

export type HostDirectoryMount = {
  handle: FileSystemDirectoryHandle;
  label: string;
};

async function listFilesRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: { path: string; handle: FileSystemFileHandle }[],
): Promise<void> {
  for await (const [name, entry] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "file") {
      out.push({ path, handle: entry as FileSystemFileHandle });
    } else if (entry.kind === "directory") {
      await listFilesRecursive(entry as FileSystemDirectoryHandle, path, out);
    }
  }
}

export async function buildVirtualPartitionsFromDirectory(mount: HostDirectoryMount): Promise<SdPartition[]> {
  const listed: { path: string; handle: FileSystemFileHandle }[] = [];
  await listFilesRecursive(mount.handle, "", listed);
  const dirs = new Set<string>();
  const files: SdFile[] = [];
  for (const { path, handle } of listed) {
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash) : "";
    if (dir) {
      const parts = dir.split("/");
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        dirs.add(acc.toUpperCase());
      }
    }
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    const base = slash >= 0 ? path.slice(slash + 1) : path;
    files.push({
      id: `host-${path}`,
      name: base,
      size: buf.byteLength,
      data: buf,
      path: dir.toUpperCase(),
    });
  }
  return [
    {
      id: 0,
      label: mount.label.slice(0, 11).toUpperCase(),
      files,
      dirs: [...dirs],
    },
    { id: 1, label: "PART1", files: [], dirs: [] },
    { id: 2, label: "PART2", files: [], dirs: [] },
    { id: 3, label: "PART3", files: [], dirs: [] },
  ];
}

/** Write bytes to a path on the mounted host folder (write-enable required). */
export async function writeHostDirectoryFile(
  mount: HostDirectoryMount,
  relPath: string,
  data: Uint8Array,
): Promise<boolean> {
  if (!isSd2iecWriteEnabled()) return false;
  const parts = relPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return false;
  let dir = mount.handle;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  await w.close();
  return true;
}

