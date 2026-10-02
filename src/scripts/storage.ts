// 带修订号的持久化层：按内容块分键写入，失败时按块重试；
// 多标签页保存时做三向合并，冲突块保留两版；容量不足时淘汰最旧且无引用的快照。

import type { ChapterProject, ContentBlock, GlossaryTerm } from "./types.ts";

export interface ConflictInfo {
  kind: "block" | "term";
  /** 冲突组 id（块 id 或术语 id） */
  group: string;
  /** 可读的冲突字段说明 */
  field: string;
  /** 另一标签页的整块版本（块冲突时存在） */
  theirsBlock?: ContentBlock;
  termSource?: string;
}

export interface SnapshotMeta {
  id: string;
  label: string;
  createdAt: string;
  revision: number;
  kind: "version" | "recovery";
  referenced: boolean;
}

interface DiskMeta {
  schema: 2;
  revision: number;
  clientId: string;
  updatedAt: string;
  project: {
    id: string;
    title: string;
    subject: string;
    grade: string;
    blockIds: string[];
    glossary: GlossaryTerm[];
  };
  snapshots: SnapshotMeta[];
}

export interface SaveReport {
  ok: boolean;
  revision: number;
  /** 本次没能保住最新修改的内容块 id */
  failedBlocks: string[];
  /** 被淘汰的快照 id */
  evicted: string[];
  /** 被淘汰的“版本快照”（有引用），需要提示用户 */
  evictedReferenced: string[];
  error?: string;
}

const PREFIX = "sologsb-1009-tb::";
const META_KEY = `${PREFIX}meta`;
const blockKey = (id: string) => `${PREFIX}block::${id}`;
const snapshotKey = (id: string) => `${PREFIX}snapshot::${id}`;

export const MAX_VERSIONS = 10;
export const MAX_RECOVERY_SNAPSHOTS = 8;
const EVICT_BATCH = 3;

export function newClientId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeItem(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (isQuotaError(err)) return false;
    throw err;
  }
}

function projectFromMeta(meta: DiskMeta): ChapterProject {
  const blocks: ContentBlock[] = [];
  for (const id of meta.project.blockIds ?? []) {
    const block = safeParse<ContentBlock>(localStorage.getItem(blockKey(id)));
    if (block) blocks.push(block);
  }
  return {
    id: meta.project.id,
    title: meta.project.title,
    subject: meta.project.subject,
    grade: meta.project.grade,
    blocks,
    glossary: meta.project.glossary ?? [],
    versions: [],
    updatedAt: meta.updatedAt,
  };
}

export interface LoadedState {
  project: ChapterProject;
  revision: number;
  clientId: string;
}

export function loadState(): LoadedState | null {
  const meta = safeParse<DiskMeta>(localStorage.getItem(META_KEY));
  if (!meta || meta.schema !== 2 || !meta.project) return null;
  const project = projectFromMeta(meta);
  if (!project.blocks.length) return null;
  return { project, revision: meta.revision ?? 0, clientId: meta.clientId ?? "" };
}

export function readMeta(): DiskMeta | null {
  return safeParse<DiskMeta>(localStorage.getItem(META_KEY));
}

export function readRevision(): number {
  return readMeta()?.revision ?? 0;
}

export function readBlock(id: string): ContentBlock | null {
  return safeParse<ContentBlock>(localStorage.getItem(blockKey(id)));
}

export function reconstructProject(meta: DiskMeta): ChapterProject {
  return projectFromMeta(meta);
}

export function loadSnapshotData(id: string): { blocks: ContentBlock[]; glossary: GlossaryTerm[] } | null {
  return safeParse<{ blocks: ContentBlock[]; glossary: GlossaryTerm[] }>(localStorage.getItem(snapshotKey(id)));
}

export function removeSnapshot(id: string): void {
  localStorage.removeItem(snapshotKey(id));
}

/** 淘汰最旧的快照：先淘汰无引用的恢复快照，再淘汰有引用的版本快照。 */
function evictOldestSnapshots(snapshots: SnapshotMeta[], batchSize: number): SnapshotMeta[] {
  const sorted = [...snapshots].sort((a, b) => {
    if (a.referenced !== b.referenced) return a.referenced ? 1 : -1; // 无引用优先
    return a.createdAt.localeCompare(b.createdAt); // 最旧优先
  });
  const victims = sorted.slice(0, batchSize);
  for (const victim of victims) {
    localStorage.removeItem(snapshotKey(victim.id));
    const index = snapshots.findIndex((item) => item.id === victim.id);
    if (index >= 0) snapshots.splice(index, 1);
  }
  return victims;
}

/** 写入快照完整数据，失败时反复淘汰快照后重试。 */
export function writeSnapshotData(
  id: string,
  data: { blocks: ContentBlock[]; glossary: GlossaryTerm[] },
  snapshots: SnapshotMeta[],
): { ok: boolean; evicted: SnapshotMeta[] } {
  const evicted: SnapshotMeta[] = [];
  while (!writeItem(snapshotKey(id), data)) {
    const batch = evictOldestSnapshots(snapshots, EVICT_BATCH);
    if (!batch.length) return { ok: false, evicted };
    evicted.push(...batch);
  }
  return { ok: true, evicted };
}

/**
 * 持久化整个项目：按内容块逐个写入，单块失败时淘汰快照后重试；
 * 最后写元数据（含修订号）。返回本次保存的结果报告。
 */
export function persistProject(
  project: ChapterProject,
  revision: number,
  clientId: string,
  snapshots: SnapshotMeta[],
): SaveReport {
  const report: SaveReport = {
    ok: true,
    revision,
    failedBlocks: [],
    evicted: [],
    evictedReferenced: [],
  };

  // 1. 按内容块写入，失败的块反复淘汰快照后重试，直到写入成功或无快照可淘汰
  for (const block of project.blocks) {
    while (!writeItem(blockKey(block.id), block)) {
      const evicted = evictOldestSnapshots(snapshots, EVICT_BATCH);
      if (!evicted.length) {
        report.failedBlocks.push(block.id);
        break;
      }
      report.evicted.push(...evicted.map((item) => item.id));
      report.evictedReferenced.push(...evicted.filter((item) => item.referenced).map((item) => item.id));
    }
  }

  // 2. 组装元数据
  const meta: DiskMeta = {
    schema: 2,
    revision,
    clientId,
    updatedAt: project.updatedAt,
    project: {
      id: project.id,
      title: project.title,
      subject: project.subject,
      grade: project.grade,
      blockIds: project.blocks.map((block) => block.id),
      glossary: project.glossary,
    },
    snapshots: snapshots.map((item) => ({ ...item })),
  };

  // 3. 写元数据，失败时反复淘汰快照后重试
  while (!writeItem(META_KEY, meta)) {
    const evicted = evictOldestSnapshots(snapshots, EVICT_BATCH);
    if (!evicted.length) {
      report.ok = false;
      report.error = "浏览器存储空间不足，修订元数据写入失败";
      break;
    }
    report.evicted.push(...evicted.map((item) => item.id));
    report.evictedReferenced.push(...evicted.filter((item) => item.referenced).map((item) => item.id));
    meta.snapshots = snapshots.map((item) => ({ ...item }));
  }

  return report;
}

// ---- 三向合并 ----

const BLOCK_SCALAR_FIELDS = [
  "type",
  "text",
  "accessibleText",
  "headingLevel",
  "imageSrc",
  "imageAlt",
  "linkHref",
  "changeReason",
  "reviewStatus",
] as const;

type BlockField = (typeof BLOCK_SCALAR_FIELDS)[number];

const FIELD_LABELS: Record<string, string> = {
  type: "内容块类型",
  text: "原文",
  accessibleText: "无障碍表达",
  headingLevel: "标题层级",
  imageSrc: "图片地址",
  imageAlt: "替代文本",
  linkHref: "链接地址",
  changeReason: "改写原因",
  reviewStatus: "审核状态",
  comments: "批注",
  source: "原文术语",
  preferred: "统一表达",
  note: "术语备注",
};

function isEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

function mergeComments(
  base: ContentBlock["comments"],
  ours: ContentBlock["comments"],
  theirs: ContentBlock["comments"],
): { comments: ContentBlock["comments"]; conflict: boolean } {
  const result: ContentBlock["comments"] = [];
  const baseMap = new Map(base.map((comment) => [comment.id, comment]));
  const theirsMap = new Map(theirs.map((comment) => [comment.id, comment]));
  let conflict = false;
  for (const ourComment of ours) {
    const theirComment = theirsMap.get(ourComment.id);
    const baseComment = baseMap.get(ourComment.id);
    if (!theirComment || !baseComment) {
      result.push(ourComment);
      continue;
    }
    const merged = { ...ourComment, replies: [...ourComment.replies] };
    if (ourComment.body !== baseComment.body && theirComment.body !== baseComment.body && ourComment.body !== theirComment.body) {
      conflict = true; // 同一条批注两边都改了正文，整块按冲突处理
    } else if (theirComment.body !== baseComment.body && ourComment.body === baseComment.body) {
      merged.body = theirComment.body;
    }
    if (theirComment.resolved !== baseComment.resolved && ourComment.resolved === baseComment.resolved) {
      merged.resolved = theirComment.resolved;
    }
    // 回复按 id 合并
    const replyMap = new Map(theirComment.replies.map((reply) => [reply.id, reply]));
    const baseReplyMap = new Map(baseComment.replies.map((reply) => [reply.id, reply]));
    for (const reply of ourComment.replies) {
      const theirReply = replyMap.get(reply.id);
      const baseReply = baseReplyMap.get(reply.id);
      if (theirReply && baseReply && reply.body !== baseReply.body && theirReply.body !== baseReply.body && reply.body !== theirReply.body) {
        conflict = true;
      }
    }
    for (const reply of theirComment.replies) {
      if (!ourComment.replies.some((item) => item.id === reply.id)) merged.replies.push(reply);
    }
    result.push(merged);
  }
  for (const theirComment of theirs) {
    if (!ours.some((comment) => comment.id === theirComment.id)) result.push(theirComment);
  }
  return { comments: result, conflict };
}

function mergeBlock(
  baseBlock: ContentBlock,
  oursBlock: ContentBlock,
  theirsBlock: ContentBlock,
): { block?: ContentBlock; conflictField?: string; theirsCopy?: ContentBlock } {
  const merged: ContentBlock = { ...oursBlock, comments: [...oursBlock.comments] };
  let conflictField: string | null = null;

  for (const field of BLOCK_SCALAR_FIELDS) {
    const oursChanged = !isEqual(oursBlock[field], baseBlock[field]);
    const theirsChanged = !isEqual(theirsBlock[field], baseBlock[field]);
    if (oursChanged && theirsChanged && !isEqual(oursBlock[field], theirsBlock[field])) {
      conflictField = field;
      break;
    }
    if (theirsChanged && !oursChanged) {
      (merged as Record<BlockField, unknown>)[field] = theirsBlock[field];
    }
  }

  const commentsResult = mergeComments(baseBlock.comments, oursBlock.comments, theirsBlock.comments);
  if (commentsResult.conflict) conflictField = "comments";

  if (conflictField) {
    const theirsCopy: ContentBlock = {
      ...theirsBlock,
      id: uid("block"),
      conflict: { group: oursBlock.id, side: "theirs", field: conflictField },
    };
    return { conflictField, theirsCopy, block: undefined };
  }

  merged.comments = commentsResult.comments;
  return { block: merged };
}

function mergeGlossary(
  base: GlossaryTerm[],
  ours: GlossaryTerm[],
  theirs: GlossaryTerm[],
  conflicts: ConflictInfo[],
): GlossaryTerm[] {
  const result: GlossaryTerm[] = [];
  const baseMap = new Map(base.map((term) => [term.id, term]));
  const theirsMap = new Map(theirs.map((term) => [term.id, term]));
  for (const ourTerm of ours) {
    const theirTerm = theirsMap.get(ourTerm.id);
    const baseTerm = baseMap.get(ourTerm.id);
    if (!theirTerm || !baseTerm) {
      result.push(ourTerm);
      continue;
    }
    const merged: GlossaryTerm = { ...ourTerm };
    for (const field of ["source", "preferred", "note"] as const) {
      const oursChanged = ourTerm[field] !== baseTerm[field];
      const theirsChanged = theirTerm[field] !== baseTerm[field];
      if (oursChanged && theirsChanged && ourTerm[field] !== theirTerm[field]) {
        conflicts.push({
          kind: "term",
          group: ourTerm.id,
          field: FIELD_LABELS[field] ?? field,
          termSource: ourTerm.source,
        });
      } else if (theirsChanged && !oursChanged) {
        merged[field] = theirTerm[field];
      }
    }
    result.push(merged);
  }
  for (const theirTerm of theirs) {
    if (!ours.some((term) => term.id === theirTerm.id)) result.push(theirTerm);
  }
  return result;
}

/**
 * 三向合并：base 是本标签页上次同步的状态，ours 是本标签页当前状态，
 * theirs 是其他标签页已保存的状态。按内容块和术语逐条并入，冲突块保留两版。
 */
export function mergeThreeWay(
  base: ChapterProject,
  ours: ChapterProject,
  theirs: ChapterProject,
): { project: ChapterProject; conflicts: ConflictInfo[] } {
  const conflicts: ConflictInfo[] = [];
  const mergedBlocks: ContentBlock[] = [];
  const baseBlockMap = new Map(base.blocks.map((block) => [block.id, block] as const));
  const theirsBlockMap = new Map(theirs.blocks.map((block) => [block.id, block] as const));

  for (const ourBlock of ours.blocks) {
    const theirBlock = theirsBlockMap.get(ourBlock.id);
    const baseBlock = baseBlockMap.get(ourBlock.id);
    if (!theirBlock || !baseBlock) {
      mergedBlocks.push(ourBlock);
      continue;
    }
    const result = mergeBlock(baseBlock, ourBlock, theirBlock);
    if (result.conflictField && result.theirsCopy) {
      conflicts.push({
        kind: "block",
        group: ourBlock.id,
        field: FIELD_LABELS[result.conflictField] ?? result.conflictField,
        theirsBlock: result.theirsCopy,
      });
      mergedBlocks.push({ ...ourBlock, conflict: { group: ourBlock.id, side: "mine", field: result.conflictField } }, result.theirsCopy);
    } else if (result.block) {
      mergedBlocks.push(result.block);
    }
  }

  // 其他标签页新增的块
  for (const theirBlock of theirs.blocks) {
    if (!ours.blocks.some((block) => block.id === theirBlock.id)) {
      mergedBlocks.push(theirBlock);
    }
  }

  const mergedGlossary = mergeGlossary(base.glossary, ours.glossary, theirs.glossary, conflicts);

  // 标量字段：本标签页改过则以本标签页为准，否则取对方的
  const merged: ChapterProject = {
    ...ours,
    title: ours.title !== base.title ? ours.title : theirs.title,
    subject: ours.subject !== base.subject ? ours.subject : theirs.subject,
    grade: ours.grade !== base.grade ? ours.grade : theirs.grade,
    blocks: mergedBlocks,
    glossary: mergedGlossary,
    versions: ours.versions,
    updatedAt: new Date().toISOString(),
  };

  return { project: merged, conflicts };
}

export function estimateUsage(): { usedChars: number; quotaChars: number } {
  let usedChars = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(PREFIX)) {
      usedChars += (localStorage.getItem(key) ?? "").length + key.length;
    }
  }
  return { usedChars, quotaChars: 5 * 1024 * 1024 };
}
