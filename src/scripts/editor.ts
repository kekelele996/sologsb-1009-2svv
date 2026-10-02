import "@shoelace-style/shoelace/dist/shoelace.js";

type BlockType = "heading" | "paragraph" | "image" | "link";
type ReviewStatus = "pending" | "approved" | "needs-work";
type Severity = "error" | "warning" | "info";

interface CommentReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

interface CommentItem {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
}

interface BlockConflictAlt {
  /** edit：另一标签页改了同一块；deleted：另一标签页删除了这块 */
  kind: "edit" | "deleted";
  source: string;
  at: string;
  block?: ContentBlock;
}

interface TermConflictAlt {
  kind: "edit" | "deleted";
  source: string;
  at: string;
  term?: GlossaryTerm;
}

interface ContentBlock {
  id: string;
  type: BlockType;
  text: string;
  accessibleText: string;
  headingLevel?: number;
  imageSrc?: string;
  imageAlt?: string;
  linkHref?: string;
  changeReason: string;
  reviewStatus: ReviewStatus;
  comments: CommentItem[];
  updatedAt?: string;
  conflict?: { alt: BlockConflictAlt };
}

interface GlossaryTerm {
  id: string;
  source: string;
  preferred: string;
  note: string;
  updatedAt?: string;
  conflict?: { alt: TermConflictAlt };
}

interface VersionSnapshot {
  seq: number;
  label: string;
  createdAt: string;
  pinned: boolean;
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
}

/** meta 中只保留快照索引，快照正文单独存 key，写爆一份不拖垮整章 */
interface VersionIndexEntry {
  seq: number;
  label: string;
  createdAt: string;
  pinned: boolean;
}

interface StoredMeta {
  schema: 2;
  rev: number;
  seq: number;
  title: string;
  subject: string;
  grade: string;
  updatedAt: string;
  blockIds: string[];
  termIds: string[];
  versions: VersionIndexEntry[];
}

interface StoredVersion {
  schema: 2;
  seq: number;
  label: string;
  createdAt: string;
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
}

interface ChapterProject {
  id: string;
  title: string;
  subject: string;
  grade: string;
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
  versions: VersionSnapshot[];
  updatedAt: string;
}

/** 标签页草稿：崩溃/关闭后重开时，靠它把没并进去的改动找回来 */
interface TabDraft {
  schema: 2;
  tabId: string;
  tabName: string;
  heartbeat: string;
  baseRev: number;
  title: string;
  titleDirty: boolean;
  selectedVersionId: string;
  project: ChapterProject;
  touchedBlocks: Record<string, string | null>;
  touchedTerms: Record<string, string | null>;
}

interface RemoteProject {
  meta: StoredMeta;
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
  versions: VersionSnapshot[];
}

interface AccessibilityIssue {
  id: string;
  blockId: string;
  type: "heading" | "link" | "image" | "glossary" | "sentence";
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
}

interface FailedItem {
  scope: "block" | "term" | "version" | "meta";
  id: string;
  label: string;
}

type SaveKind = "idle" | "saving" | "error" | "warning";

interface SaveState {
  kind: SaveKind;
  label: string;
  detail: string;
  failed: FailedItem[];
  evictedCount: number;
  mergedText: string;
  usageText: string;
}

const LEGACY_STORAGE_KEY = "sologsb-1009-accessible-textbook-v1";
const PREFIX = "sologsb-1009:v2";
const META_KEY = `${PREFIX}:meta`;
const blockKey = (id: string) => `${PREFIX}:block:${id}`;
const termKey = (id: string) => `${PREFIX}:term:${id}`;
const versionKey = (seq: number) => `${PREFIX}:version:${seq}`;
const draftKey = (tabId: string) => `${PREFIX}:draft:${tabId}`;
const DRAFT_PREFIX = `${PREFIX}:draft:`;
const MAX_UNPINNED_VERSIONS = 10;
const DRAFT_STALE_MS = 30_000;

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

/* ------------------------------------------------------------------ */
/* 示例章节                                                            */
/* ------------------------------------------------------------------ */

function createSeedProject(): ChapterProject {
  const blocks: ContentBlock[] = [
    {
      id: "block-h1",
      type: "heading",
      headingLevel: 1,
      text: "第三章 水循环与城市",
      accessibleText: "第三章 水循环与城市",
      changeReason: "",
      reviewStatus: "approved",
      comments: [],
    },
    {
      id: "block-p1",
      type: "paragraph",
      text: "城市中的水并非取之不尽，由于其会通过蒸发、降水以及地表径流等若干复杂过程在自然界中持续循环，因此理解这些过程对于建设具有韧性的城市具有十分重要的意义。",
      accessibleText: "城市里的水会不断循环。它经过蒸发、降水并沿地面流动。了解这些过程，可以帮助我们建设更能适应变化的城市。",
      changeReason: "拆分长句，把抽象表述改为更直接的说明。",
      reviewStatus: "pending",
      comments: [],
    },
    {
      id: "block-h2",
      type: "heading",
      headingLevel: 2,
      text: "一、水从哪里来",
      accessibleText: "一、水从哪里来",
      changeReason: "保留原章节结构。",
      reviewStatus: "approved",
      comments: [],
    },
    {
      id: "block-img",
      type: "image",
      text: "图 3-1 城市水循环示意",
      imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='420'%3E%3Crect width='800' height='420' fill='%23dcecf3'/%3E%3Ccircle cx='650' cy='85' r='45' fill='%23f4c95d'/%3E%3Cpath d='M0 300 Q180 240 340 300 T800 280 V420 H0Z' fill='%2389b7d0'/%3E%3Cpath d='M130 285 Q220 170 330 285' fill='none' stroke='%233a7c9e' stroke-width='12'/%3E%3C/svg%3E",
      imageAlt: "",
      accessibleText: "",
      changeReason: "",
      reviewStatus: "needs-work",
      comments: [],
    },
    {
      id: "block-p2",
      type: "paragraph",
      text: "当太阳照射到水面时，水会受热变成水蒸气升到空中。水蒸气冷却后形成云，再以雨或雪的形式落回地面。",
      accessibleText: "太阳照在水面上，水会变成水蒸气升到空中。水蒸气冷却后变成云，最后以雨或雪落回地面。",
      changeReason: "使用较短句子，并明确每个步骤的先后顺序。",
      reviewStatus: "approved",
      comments: [],
    },
    {
      id: "block-link",
      type: "link",
      text: "点击这里",
      linkHref: "/resources/water-cycle",
      accessibleText: "打开水循环互动实验",
      changeReason: "改为说明链接目标的独立文案。",
      reviewStatus: "pending",
      comments: [],
    },
    {
      id: "block-h3",
      type: "heading",
      headingLevel: 3,
      text: "雨水花园怎样工作",
      accessibleText: "雨水花园怎样工作",
      changeReason: "",
      reviewStatus: "approved",
      comments: [],
    },
    {
      id: "block-p3",
      type: "paragraph",
      text: "雨水花园利用土壤和植物的共同作用暂时储存雨水，同时通过下渗补给地下水，并在降雨较集中时减轻城市排水管道所承受的压力。",
      accessibleText: "雨水花园用土壤和植物暂时存住雨水。雨水还会慢慢渗入地下，补充地下水。雨很大时，它可以减轻排水管的压力。",
      changeReason: "把并列成分拆成短句，减少专业术语密度。",
      reviewStatus: "pending",
      comments: [],
    },
  ];

  return {
    id: "accessible-textbook-1009",
    title: "科学（五年级下册）·无障碍改写稿",
    subject: "科学",
    grade: "五年级",
    blocks,
    glossary: [
      { id: "term-1", source: "水循环", preferred: "水循环", note: "全书统一使用" },
      { id: "term-2", source: "地表径流", preferred: "沿地面流动的水", note: "首次出现时使用通俗解释" },
      { id: "term-3", source: "下渗", preferred: "渗入地下", note: "避免单独使用专业词" },
    ],
    versions: [],
    updatedAt: nowIso(),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseImportedChapter(input: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(blankBlock("heading", heading[2], { headingLevel: heading[1].length }));
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)(?:\s+(.+))?$/.exec(line);
    if (image) {
      blocks.push(blankBlock("image", image[3] || "未命名图片", { imageSrc: image[2], imageAlt: image[1] }));
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(line);
    if (link) {
      blocks.push(blankBlock("link", link[1], { linkHref: link[2] }));
      continue;
    }
    blocks.push(blankBlock("paragraph", line));
  }
  return blocks.length ? blocks : [blankBlock("paragraph", input.trim() || "请输入章节内容")];
}

function blankBlock(type: BlockType, text: string, extra: Partial<ContentBlock> = {}): ContentBlock {
  return {
    id: uid("block"),
    type,
    text,
    accessibleText: type === "image" ? extra.imageAlt ?? "" : text,
    changeReason: "",
    reviewStatus: "pending",
    comments: [],
    ...extra,
  };
}

function sentenceLength(text: string) {
  const normalized = text.replace(/\s+/g, "");
  return /[A-Za-z]/.test(text) ? text.trim().split(/\s+/).length : normalized.length;
}

function analyze(project: ChapterProject): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = [];
  let lastHeading = 0;
  for (const block of project.blocks) {
    if (block.type === "heading") {
      const level = block.headingLevel ?? 2;
      if (lastHeading && level > lastHeading + 1) {
        issues.push({
          id: `heading-${block.id}`,
          blockId: block.id,
          type: "heading",
          severity: "error",
          title: "标题层级跳跃",
          detail: `从 H${lastHeading} 直接到 H${level}，读屏用户会失去清晰的章节结构。`,
          suggestion: `改为 H${lastHeading + 1}，或补上中间的上级标题。`,
        });
      }
      lastHeading = level;
    }
    if (block.type === "image" && !(block.imageAlt ?? block.accessibleText).trim()) {
      issues.push({
        id: `image-${block.id}`,
        blockId: block.id,
        type: "image",
        severity: "error",
        title: "图片缺少替代文本",
        detail: "视觉用户能看到的图表信息，读屏用户目前无法获得。",
        suggestion: "说明图中主体、变化和结论；纯装饰图片应标记为空替代文本。",
      });
    }
    if (block.type === "link") {
      const label = block.accessibleText || block.text;
      if (/^(点击这里|这里|链接|更多|here|click here|read more)$/i.test(label.trim())) {
        issues.push({
          id: `link-${block.id}`,
          blockId: block.id,
          type: "link",
          severity: "error",
          title: "链接文案缺少目的",
          detail: `“${label}”单独朗读时无法说明会前往哪里。`,
          suggestion: "改成“打开水循环互动实验”等可独立理解的文案。",
        });
      }
    }
    const text = block.type === "image" ? block.text : block.text;
    const sentences = text.split(/(?<=[。！？!?])\s*/).filter(Boolean);
    for (const [index, sentence] of sentences.entries()) {
      if (sentenceLength(sentence) > (/[A-Za-z]/.test(sentence) ? 28 : 42)) {
        issues.push({
          id: `sentence-${block.id}-${index}`,
          blockId: block.id,
          type: "sentence",
          severity: "warning",
          title: "句子过长",
          detail: `该句约 ${sentenceLength(sentence)} ${/[A-Za-z]/.test(sentence) ? "个词" : "个字"}，一次理解的信息较多。`,
          suggestion: "按动作或因果关系拆成 2—3 个短句。",
        });
      }
    }
    const source = `${block.text} ${block.accessibleText}`;
    for (const term of project.glossary) {
      if (source.includes(term.source) && block.accessibleText && !block.accessibleText.includes(term.preferred)) {
        issues.push({
          id: `term-${block.id}-${term.id}`,
          blockId: block.id,
          type: "glossary",
          severity: "info",
          title: `术语“${term.source}”尚未统一`,
          detail: `全书建议表述为“${term.preferred}”。${term.note}`,
          suggestion: `将无障碍文本调整为“${term.preferred}”。`,
        });
      }
    }
  }
  return issues;
}

function simplifyText(input: string, glossary: GlossaryTerm[]) {
  let result = input
    .replaceAll("由于其", "因为")
    .replaceAll("因此", "所以")
    .replaceAll("具有十分重要的意义", "很重要")
    .replaceAll("利用", "使用")
    .replaceAll("共同作用", "一起作用")
    .replaceAll("暂时储存", "暂时存住")
    .replaceAll("所承受的压力", "受到的压力")
    .replace(/([^。！？]{38,}?)[，、]([^。！？]{12,}?[。！？])/g, "$1。$2");
  for (const term of glossary) {
    if (result.includes(term.source)) result = result.replaceAll(term.source, term.preferred);
  }
  result = result
    .split(/(?<=[。！？!?])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join("\n");
  return result;
}

function blockRole(block: ContentBlock) {
  if (block.type === "heading") return `H${block.headingLevel ?? 2} 标题`;
  if (block.type === "image") return "图片 / 替代文本";
  if (block.type === "link") return "链接";
  return "正文段落";
}

function statusLabel(status: ReviewStatus) {
  if (status === "approved") return "已通过";
  if (status === "needs-work") return "需修改";
  return "待审核";
}

function severityLabel(severity: Severity) {
  if (severity === "error") return "必须修复";
  if (severity === "warning") return "建议优化";
  return "一致性提醒";
}

function blockLabel(block: ContentBlock) {
  const preview = (block.accessibleText || block.text || "（空块）").replace(/\s+/g, "").slice(0, 14);
  return `${blockRole(block)}「${preview}」`;
}

function termLabel(term: GlossaryTerm) {
  return `术语「${term.source} → ${term.preferred}」`;
}

function exportHtml(project: ChapterProject) {
  const body = project.blocks.map((block) => {
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.headingLevel ?? 2));
      return `<h${level}>${escapeHtml(block.accessibleText || block.text)}</h${level}>`;
    }
    if (block.type === "image") {
      return `<figure><img src="${escapeHtml(block.imageSrc ?? "")}" alt="${escapeHtml(block.imageAlt || block.accessibleText)}"><figcaption>${escapeHtml(block.text)}</figcaption></figure>`;
    }
    if (block.type === "link") {
      return `<p><a href="${escapeHtml(block.linkHref ?? "#")}">${escapeHtml(block.accessibleText || block.text)}</a></p>`;
    }
    return `<p>${escapeHtml(block.accessibleText || block.text)}</p>`;
  }).join("\n      ");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(project.title)} · 无障碍版本</title>
  <style>
    :root { font-family: "Noto Sans SC", sans-serif; font-size: 20px; line-height: 1.85; color: #17231f; background: #fffdf7; }
    body { max-width: 760px; margin: 0 auto; padding: 32px 24px 80px; }
    a { color: #075c9d; text-decoration-thickness: 2px; text-underline-offset: 3px; }
    a:focus-visible, [tabindex]:focus-visible { outline: 4px solid #d08a00; outline-offset: 3px; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.4; margin-top: 1.8em; }
    figure { margin: 2em 0; } img { max-width: 100%; height: auto; } figcaption { font-size: .86em; color: #46554f; }
    .skip { position: absolute; left: -9999px; } .skip:focus { position: static; display: inline-block; padding: .5em; background: #fff; }
  </style>
</head>
<body>
  <a class="skip" href="#main">跳到正文</a>
  <main id="main" tabindex="-1">
      ${body}
  </main>
</body>
</html>`;
}

function download(filename: string, content: string, type = "text/html;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* 分块存储层：meta / block / term / version / draft 各写各的 key       */
/* ------------------------------------------------------------------ */

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  const e = error as DOMException | null;
  return !!e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
}

function listDraftIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(DRAFT_PREFIX)) ids.push(key.slice(DRAFT_PREFIX.length));
  }
  return ids;
}

function liveSelectedSeqs(protectSeq: number): Set<number> {
  // 正在使用的标签页当前正在比较的快照不能被淘汰
  const seqs = new Set<number>([protectSeq]);
  for (const id of listDraftIds()) {
    const draft = readJson<TabDraft>(draftKey(id));
    if (!draft) continue;
    const fresh = Date.now() - Date.parse(draft.heartbeat) < DRAFT_STALE_MS;
    const seq = Number(draft.selectedVersionId);
    if (fresh && Number.isFinite(seq)) seqs.add(seq);
  }
  return seqs;
}

/** 淘汰上下文：容量不足时按批次删掉最旧、未固定、没人引用的快照 */
interface EvictContext {
  versions: VersionIndexEntry[];
  protected: Set<number>;
  evicted: VersionIndexEntry[];
}

function writeWithEviction(key: string, value: string, ctx: EvictContext): void {
  const batches = [1, 2, 4, 8];
  let attempt = 0;
  for (;;) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      const count = batches[Math.min(attempt, batches.length - 1)];
      const victims = ctx.versions
        .filter((entry) => !entry.pinned && !ctx.protected.has(entry.seq))
        .sort((a, b) => a.seq - b.seq)
        .slice(0, count);
      if (!victims.length) throw error;
      for (const victim of victims) {
        localStorage.removeItem(versionKey(victim.seq));
        ctx.versions = ctx.versions.filter((entry) => entry.seq !== victim.seq);
        ctx.evicted.push(victim);
      }
      attempt += 1;
    }
  }
}

function writeJson(key: string, value: unknown, ctx: EvictContext): void {
  writeWithEviction(key, JSON.stringify(value), ctx);
}

function readRemoteProject(): RemoteProject | null {
  const meta = readJson<StoredMeta>(META_KEY);
  if (!meta || meta.schema !== 2) return null;
  const blocks = meta.blockIds
    .map((id) => readJson<ContentBlock>(blockKey(id)))
    .filter((block): block is ContentBlock => !!block);
  const glossary = meta.termIds
    .map((id) => readJson<GlossaryTerm>(termKey(id)))
    .filter((term): term is GlossaryTerm => !!term);
  const versions = meta.versions
    .map((entry) => {
      const body = readJson<StoredVersion>(versionKey(entry.seq));
      if (!body) return null;
      return { ...entry, blocks: body.blocks, glossary: body.glossary } satisfies VersionSnapshot;
    })
    .filter((version): version is VersionSnapshot => !!version);
  return { meta, blocks, glossary, versions };
}

function bootstrapStorage(project: ChapterProject): RemoteProject {
  // 首次使用（或存储被清空）：把内存中的章节作为 r1 整块写入
  const ts = nowIso();
  const meta: StoredMeta = {
    schema: 2,
    rev: 1,
    seq: project.versions.length,
    title: project.title,
    subject: project.subject,
    grade: project.grade,
    updatedAt: ts,
    blockIds: project.blocks.map((block) => block.id),
    termIds: project.glossary.map((term) => term.id),
    versions: project.versions.map((version) => ({ seq: version.seq, label: version.label, createdAt: version.createdAt, pinned: version.pinned })),
  };
  const ctx: EvictContext = { versions: meta.versions, protected: liveSelectedSeqs(-1), evicted: [] };
  for (const block of project.blocks) writeJson(blockKey(block.id), block, ctx);
  for (const term of project.glossary) writeJson(termKey(term.id), term, ctx);
  for (const version of project.versions) {
    writeJson(versionKey(version.seq), { schema: 2, seq: version.seq, label: version.label, createdAt: version.createdAt, blocks: version.blocks, glossary: version.glossary }, ctx);
  }
  writeJson(META_KEY, meta, ctx);
  return { meta, blocks: clone(project.blocks), glossary: clone(project.glossary), versions: clone(project.versions) };
}

function migrateLegacyStorage(): ChapterProject | null {
  const stored = readJson<{ schema: number; project: ChapterProject }>(LEGACY_STORAGE_KEY);
  if (!stored || stored.schema !== 1 || !stored.project?.blocks?.length) return null;
  const legacy = stored.project;
  const ts = nowIso();
  legacy.blocks.forEach((block) => { block.updatedAt ??= ts; delete block.conflict; });
  legacy.glossary.forEach((term) => { term.updatedAt ??= ts; delete term.conflict; });
  legacy.versions = (legacy.versions ?? []).map((version, index) => ({
    seq: index + 1,
    label: version.label || `版本 ${index + 1}`,
    createdAt: version.createdAt || ts,
    pinned: false,
    blocks: version.blocks,
    glossary: version.glossary,
  }));
  return legacy;
}

/* ------------------------------------------------------------------ */
/* 修订号 + 按内容块/术语三路合并                                       */
/* ------------------------------------------------------------------ */

function blockFingerprint(block: ContentBlock): string {
  return JSON.stringify([
    block.type,
    block.text,
    block.accessibleText,
    block.headingLevel ?? null,
    block.imageSrc ?? null,
    block.imageAlt ?? null,
    block.linkHref ?? null,
    block.changeReason,
    block.reviewStatus,
    block.comments,
  ]);
}

function termFingerprint(term: GlossaryTerm): string {
  return JSON.stringify([term.source, term.preferred, term.note]);
}

interface MergeOutcome {
  project: ChapterProject;
  conflicts: number;
  mergedFrom: string[];
  /** 合并后重新登记的“本标签页动过”基线，供下一轮保存继续追踪 */
  rebasedBlocks: Record<string, string | null>;
  rebasedTerms: Record<string, string | null>;
}

function mergeInto(remote: RemoteProject, drafts: TabDraft[]): MergeOutcome {
  let blocks = clone(remote.blocks);
  let glossary = clone(remote.glossary);
  let title = remote.meta.title;
  let titleUpdatedAt = Date.parse(remote.meta.updatedAt) || 0;
  let versions = clone(remote.versions);
  const mergedFrom: string[] = [];
  const rebasedBlocks: Record<string, string | null> = {};
  const rebasedTerms: Record<string, string | null> = {};

  for (const draft of drafts) {
    const hasChanges = Object.keys(draft.touchedBlocks).length > 0
      || Object.keys(draft.touchedTerms).length > 0
      || draft.titleDirty;
    if (hasChanges) mergedFrom.push(draft.tabName);
    const source = draft.tabName;
    const localBlocks = new Map(draft.project.blocks.map((block) => [block.id, block]));
    const localTerms = new Map(draft.project.glossary.map((term) => [term.id, term]));
    const nextBlocks: ContentBlock[] = [];

    for (const remoteBlock of blocks) {
      const local = localBlocks.get(remoteBlock.id);
      const base = draft.touchedBlocks[remoteBlock.id];
      const remoteFp = blockFingerprint(remoteBlock);
      if (local) {
        const localFp = blockFingerprint(local);
        if (base === undefined) {
          nextBlocks.push(remoteBlock); // 本标签页没动过
        } else if (base === null) {
          nextBlocks.push(clone(local)); // 同号新建（极少），保留本地
          rebasedBlocks[local.id] = null;
        } else if (remoteFp === base) {
          nextBlocks.push(clone(local)); // 远端没动，本地改动直接并入
          rebasedBlocks[local.id] = base;
        } else if (remoteFp === localFp) {
          nextBlocks.push(remoteBlock); // 两边改完一致
        } else {
          // 两边都动过：本地版为主，远端版作为备选，等人挑
          const merged = clone(local);
          if (!merged.conflict) {
            merged.conflict = { alt: { kind: "edit", source, at: nowIso(), block: clone(remoteBlock) } };
          }
          nextBlocks.push(merged);
          rebasedBlocks[local.id] = base;
        }
      } else if (typeof base === "string") {
        // 本标签页删了这块
        if (remoteFp === base) {
          // 远端没动，删除生效，不进 nextBlocks
        } else {
          // 远端还改过：保留远端版，挂“本标签页要求删除”的备选
          const kept = clone(remoteBlock);
          if (!kept.conflict) kept.conflict = { alt: { kind: "deleted", source, at: nowIso() } };
          nextBlocks.push(kept);
        }
      } else {
        nextBlocks.push(remoteBlock);
      }
      localBlocks.delete(remoteBlock.id);
    }
    // 本标签页新建的块（远端还没有）追加在末尾
    for (const local of localBlocks.values()) {
      const base = draft.touchedBlocks[local.id];
      nextBlocks.push(clone(local));
      rebasedBlocks[local.id] = base ?? null;
    }
    blocks = nextBlocks;

    const nextTerms: GlossaryTerm[] = [];
    for (const remoteTerm of glossary) {
      const local = localTerms.get(remoteTerm.id);
      const base = draft.touchedTerms[remoteTerm.id];
      const remoteFp = termFingerprint(remoteTerm);
      if (local) {
        const localFp = termFingerprint(local);
        if (base === undefined) {
          nextTerms.push(remoteTerm);
        } else if (base === null) {
          nextTerms.push(clone(local));
          rebasedTerms[local.id] = null;
        } else if (remoteFp === base) {
          nextTerms.push(clone(local));
          rebasedTerms[local.id] = base;
        } else if (remoteFp === localFp) {
          nextTerms.push(remoteTerm);
        } else {
          const merged = clone(local);
          if (!merged.conflict) {
            merged.conflict = { alt: { kind: "edit", source, at: nowIso(), term: clone(remoteTerm) } };
          }
          nextTerms.push(merged);
          rebasedTerms[local.id] = base;
        }
      } else if (typeof base === "string") {
        if (remoteFp !== base) {
          const kept = clone(remoteTerm);
          if (!kept.conflict) kept.conflict = { alt: { kind: "deleted", source, at: nowIso() } };
          nextTerms.push(kept);
        }
      } else {
        nextTerms.push(remoteTerm);
      }
      localTerms.delete(remoteTerm.id);
    }
    for (const local of localTerms.values()) {
      const base = draft.touchedTerms[local.id];
      nextTerms.push(clone(local));
      rebasedTerms[local.id] = base ?? null;
    }
    glossary = nextTerms;

    if (draft.titleDirty && draft.title !== title) {
      const draftTs = Date.parse(draft.project.updatedAt) || 0;
      if (draftTs >= titleUpdatedAt) {
        title = draft.title;
        titleUpdatedAt = draftTs;
      }
    }

    // 固定状态是本地偏好，覆盖到远端索引
    for (const localVersion of draft.project.versions) {
      const target = versions.find((entry) => entry.seq === localVersion.seq);
      if (target) target.pinned = localVersion.pinned || target.pinned;
    }
  }

  const project: ChapterProject = {
    id: "accessible-textbook-1009",
    title,
    subject: remote.meta.subject,
    grade: remote.meta.grade,
    blocks,
    glossary,
    versions,
    updatedAt: nowIso(),
  };
  return {
    project,
    conflicts: countConflicts(project),
    mergedFrom: drafts.length ? mergedFrom : [],
    rebasedBlocks,
    rebasedTerms,
  };
}

function countConflicts(project: ChapterProject): number {
  return project.blocks.filter((block) => block.conflict).length + project.glossary.filter((term) => term.conflict).length;
}

/* ------------------------------------------------------------------ */
/* 应用状态                                                            */
/* ------------------------------------------------------------------ */

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("Application root was not found");
const app: HTMLDivElement = rootElement;

function getTabId(): { id: string; name: string } {
  const stored = sessionStorage.getItem(`${PREFIX}:tab`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { id: string; name: string };
      if (parsed.id && parsed.name) return parsed;
    } catch {
      // fall through and reissue
    }
  }
  const identity = { id: uid("tab"), name: `标签页 ${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
  sessionStorage.setItem(`${PREFIX}:tab`, JSON.stringify(identity));
  return identity;
}

const tab = getTabId();

let project: ChapterProject;
let baseRev = 1;
let activeBlockId = "";
let activeIssueId = "";
let previewMode: "normal" | "assisted" = "normal";
let selectedVersionId = "";
let showGlossary = false;
let undoStack: ChapterProject[] = [];
let redoStack: ChapterProject[] = [];
let touchedBlocks: Record<string, string | null> = {};
let touchedTerms: Record<string, string | null> = {};
let titleDirty = false;
let snapshotRequested = false;
let saveTimer = 0;
let draftTimer = 0;
let retryTimer = 0;
let autoRetryArmed = false;
let flushInFlight = false;
let flushAgain = false;

const saveState: SaveState = {
  kind: "idle",
  label: "本地自动保存",
  detail: "",
  failed: [],
  evictedCount: 0,
  mergedText: "",
  usageText: "",
};

const activeBlock = () => project.blocks.find((block) => block.id === activeBlockId) ?? project.blocks[0];
const issues = () => analyze(project);
const isDirty = () => Object.keys(touchedBlocks).length > 0 || Object.keys(touchedTerms).length > 0 || titleDirty;

/* ------------------------------------------------------------------ */
/* 启动：迁移 v1 → 回收本标签页草稿 → 并入已关闭标签页的遗留草稿         */
/* ------------------------------------------------------------------ */

function startup(): void {
  let remote = readRemoteProject();
  if (!remote) {
    const migrated = migrateLegacyStorage();
    const initial = migrated ?? createSeedProject();
    try {
      remote = bootstrapStorage(initial);
      if (migrated) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      // 首写就失败也要让界面能用，稍后可重试
      remote = {
        meta: { schema: 2, rev: 1, seq: initial.versions.length, title: initial.title, subject: initial.subject, grade: initial.grade, updatedAt: initial.updatedAt, blockIds: initial.blocks.map((b) => b.id), termIds: initial.glossary.map((t) => t.id), versions: [] },
        blocks: clone(initial.blocks),
        glossary: clone(initial.glossary),
        versions: clone(initial.versions),
      };
      reportStorageFailure([{ scope: "meta", id: "bootstrap", label: "文档主索引" }], error);
    }
  } else {
    sweepOrphanVersionKeys(remote.meta);
  }

  baseRev = remote.meta.rev;
  const ownId = tab.id;
  const staleDrafts: TabDraft[] = [];
  let ownDraft: TabDraft | null = null;
  for (const id of listDraftIds()) {
    const draft = readJson<TabDraft>(draftKey(id));
    if (!draft || draft.schema !== 2) continue;
    if (id === ownId) {
      ownDraft = draft;
      continue;
    }
    const age = Date.now() - Date.parse(draft.heartbeat);
    if (age > DRAFT_STALE_MS) staleDrafts.push(draft);
  }
  staleDrafts.sort((a, b) => a.heartbeat.localeCompare(b.heartbeat));

  const drafts: TabDraft[] = [];
  if (ownDraft) drafts.push(ownDraft);
  drafts.push(...staleDrafts);

  if (drafts.length) {
    // 自己的草稿永远最后并入（代表本标签页最新状态）
    drafts.sort((a, b) => (a.tabId === ownId ? 1 : b.tabId === ownId ? -1 : a.heartbeat.localeCompare(b.heartbeat)));
    const outcome = mergeInto(remote, drafts);
    project = outcome.project;
    touchedBlocks = outcome.rebasedBlocks;
    touchedTerms = outcome.rebasedTerms;
    titleDirty = drafts.some((draft) => draft.tabId === ownId && draft.titleDirty);
    const own = drafts.find((draft) => draft.tabId === ownId);
    if (own) selectedVersionId = own.selectedVersionId;
    if (outcome.mergedFrom.length) {
      saveState.mergedText = `已按修订号并入 ${outcome.mergedFrom.length} 份离线修改${outcome.conflicts ? `，${outcome.conflicts} 处冲突待人工选择` : ""}`;
    }
  } else {
    project = {
      id: "accessible-textbook-1009",
      title: remote.meta.title,
      subject: remote.meta.subject,
      grade: remote.meta.grade,
      blocks: remote.blocks,
      glossary: remote.glossary,
      versions: remote.versions,
      updatedAt: remote.meta.updatedAt,
    };
  }

  activeBlockId = project.blocks[0]?.id ?? "";
  for (const dead of staleDrafts) localStorage.removeItem(draftKey(dead.tabId));
  saveState.label = `已保存 · r${baseRev}`;
  void refreshUsage();
  render();
  if (isDirty()) {
    writeDraft();
    requestFlush("启动恢复未保存修改");
  }
}

function sweepOrphanVersionKeys(meta: StoredMeta): void {
  const live = new Set(meta.versions.map((entry) => entry.seq));
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(`${PREFIX}:version:`)) continue;
    const seq = Number(key.split(":").pop());
    if (!live.has(seq)) localStorage.removeItem(key);
  }
}

/* ------------------------------------------------------------------ */
/* 保存协调：串行队列 + CAS 重读 + 分块写 + 容量淘汰 + 失败报告          */
/* ------------------------------------------------------------------ */

function setSaveState(patch: Partial<SaveState>): void {
  Object.assign(saveState, patch);
  paintSavePill();
}

function paintSavePill(): void {
  const pill = document.querySelector<HTMLElement>("#save-pill");
  if (!pill) return;
  pill.className = `save-dot status-${saveState.kind}`;
  pill.textContent = saveState.label;
  pill.title = saveState.detail;
}

function requestFlush(reason: string): void {
  window.clearTimeout(saveTimer);
  autoRetryArmed = false;
  setSaveState({ kind: "saving", label: "保存中…", detail: reason });
  saveTimer = window.setTimeout(() => { void flush(); }, 320);
}

async function flush(): Promise<void> {
  if (flushInFlight) {
    flushAgain = true;
    return;
  }
  flushInFlight = true;
  window.clearTimeout(retryTimer);
  try {
    do {
      flushAgain = false;
      await doFlush();
    } while (flushAgain);
  } finally {
    flushInFlight = false;
  }
}

function currentDraft(): TabDraft {
  return {
    schema: 2,
    tabId: tab.id,
    tabName: tab.name,
    heartbeat: nowIso(),
    baseRev,
    title: project.title,
    titleDirty,
    selectedVersionId,
    project: clone(project),
    touchedBlocks: clone(touchedBlocks),
    touchedTerms: clone(touchedTerms),
  };
}

function doFlush(): Promise<void> {
  return new Promise((resolve) => {
    try {
      let remote = readRemoteProject();
      if (!remote) remote = bootstrapStorage(project);

      // 始终拿最新远端再合并，防止 storage 事件漏掉的竞态；
      // 同时收养已关闭标签页（心跳超过 30 秒）还没并入的草稿
      const adopted: TabDraft[] = [];
      for (const id of listDraftIds()) {
        if (id === tab.id) continue;
        const other = readJson<TabDraft>(draftKey(id));
        if (!other || other.schema !== 2) continue;
        if (Date.now() - Date.parse(other.heartbeat) <= DRAFT_STALE_MS) continue;
        adopted.push(other);
      }
      adopted.sort((a, b) => a.heartbeat.localeCompare(b.heartbeat));
      const incomingDrafts = [...adopted, currentDraft()];
      const outcome = mergeInto(remote, incomingDrafts);
      let working = outcome.project;
      touchedBlocks = outcome.rebasedBlocks;
      touchedTerms = outcome.rebasedTerms;
      const mergedOthers = outcome.mergedFrom.filter((name) => name !== tab.name).length > 0;

      const failed: FailedItem[] = [];
      const protectSeq = remote.meta.seq + 1;
      const ctx: EvictContext = {
        versions: working.versions.map((version) => ({ seq: version.seq, label: version.label, createdAt: version.createdAt, pinned: version.pinned })),
        protected: liveSelectedSeqs(protectSeq),
        evicted: [],
      };

      // 1) 先写快照正文（独立 key，失败不拖垮正文）
      let newVersion: VersionSnapshot | null = null;
      if (snapshotRequested) {
        snapshotRequested = false;
        const seq = Math.max(remote.meta.seq, ...working.versions.map((version) => version.seq), 0) + 1;
        newVersion = { seq, label: `版本 ${seq}`, createdAt: nowIso(), pinned: false, blocks: clone(working.blocks), glossary: clone(working.glossary) };
        // 常规上限：未固定快照最多保留 10 份，最旧的先让位
        // （这是策略裁剪而非容量淘汰，不计入对用户的告警）
        const unPinned = ctx.versions.filter((entry) => !entry.pinned).sort((a, b) => b.seq - a.seq);
        for (const stale of unPinned.slice(MAX_UNPINNED_VERSIONS - 1)) {
          localStorage.removeItem(versionKey(stale.seq));
          ctx.versions = ctx.versions.filter((entry) => entry.seq !== stale.seq);
        }
        try {
          writeJson(versionKey(seq), { schema: 2, ...newVersion }, ctx);
          ctx.versions.unshift({ seq, label: newVersion.label, createdAt: newVersion.createdAt, pinned: false });
          working.versions = syncVersionBodies(working.versions, newVersion, ctx.versions);
        } catch (error) {
          newVersion = null;
          failed.push({
            scope: "version",
            id: String(seq),
            label: `新版本快照（${isQuotaError(error) ? "存储空间不足，已无可淘汰快照" : "浏览器拒绝写入"}）`,
          });
        }
      }

      // 2) 分块写内容块；任何一块失败都不提交 meta，避免索引指向空块
      const remoteBlockById = new Map(remote.blocks.map((block) => [block.id, block]));
      for (const block of working.blocks) {
        const old = remoteBlockById.get(block.id);
        if (old && blockFingerprint(old) === blockFingerprint(block) && !block.conflict) continue;
        try {
          writeJson(blockKey(block.id), block, ctx);
        } catch {
          failed.push({ scope: "block", id: block.id, label: blockLabel(block) });
        }
      }
      const remoteBlockIds = new Set(remote.blocks.map((block) => block.id));
      const removedBlockIds = [...remoteBlockIds].filter((id) => !working.blocks.some((block) => block.id === id));
      for (const id of removedBlockIds) localStorage.removeItem(blockKey(id));

      // 3) 分块写术语
      const remoteTermById = new Map(remote.glossary.map((term) => [term.id, term]));
      for (const term of working.glossary) {
        const old = remoteTermById.get(term.id);
        if (old && termFingerprint(old) === termFingerprint(term) && !term.conflict) continue;
        try {
          writeJson(termKey(term.id), term, ctx);
        } catch {
          failed.push({ scope: "term", id: term.id, label: termLabel(term) });
        }
      }
      const remoteTermIds = new Set(remote.glossary.map((term) => term.id));
      for (const id of [...remoteTermIds].filter((termId) => !working.glossary.some((term) => term.id === termId))) {
        localStorage.removeItem(termKey(id));
      }

      const chunkFailures = failed.filter((item) => item.scope !== "version");
      if (chunkFailures.length) {
        finishWithFailure(failed, ctx);
        resolve();
        return;
      }

      // 4) 最后写 meta（修订号 +1），它是整个提交的落盘点
      const nextRev = remote.meta.rev + 1;
      const meta: StoredMeta = {
        schema: 2,
        rev: nextRev,
        seq: Math.max(remote.meta.seq, ...ctx.versions.map((entry) => entry.seq), 0),
        title: working.title,
        subject: working.subject,
        grade: working.grade,
        updatedAt: nowIso(),
        blockIds: working.blocks.map((block) => block.id),
        termIds: working.glossary.map((term) => term.id),
        versions: ctx.versions.map((entry) => ({ seq: entry.seq, label: entry.label, createdAt: entry.createdAt, pinned: entry.pinned })),
      };
      try {
        writeJson(META_KEY, meta, ctx);
      } catch {
        failed.push({ scope: "meta", id: META_KEY, label: "文档主索引（含修订号与章节目录）" });
        finishWithFailure(failed, ctx);
        resolve();
        return;
      }

      // 提交成功：基线前移、冲突外的已并入改动清空追踪、草稿删除
      baseRev = nextRev;
      project = working;
      if (newVersion) selectedVersionId = String(newVersion.seq);
      const liveVersionSeqs = new Set(ctx.versions.map((entry) => entry.seq));
      project.versions = project.versions.filter((version) => liveVersionSeqs.has(version.seq));
      for (const entry of ctx.versions) {
        const existing = project.versions.find((version) => version.seq === entry.seq);
        if (existing) existing.pinned = entry.pinned;
      }
      touchedBlocks = {};
      touchedTerms = {};
      titleDirty = false;
      localStorage.removeItem(draftKey(tab.id));
      for (const dead of adopted) localStorage.removeItem(draftKey(dead.tabId));

      const evicted = ctx.evicted.length;
      if (evicted > 0) {
        setSaveState({
          kind: "warning",
          label: `已保存 · r${nextRev}`,
          detail: `浏览器容量不足，已分批淘汰 ${evicted} 个最旧且未固定、未被比较引用的快照后保存成功。`,
          failed: [],
          evictedCount: evicted,
        });
      } else if (failed.length) {
        setSaveState({
          kind: "warning",
          label: `正文已保存 · r${nextRev}`,
          detail: "版本快照写入失败，正文与审核结论已保存。",
          failed,
          evictedCount: 0,
        });
      } else {
        setSaveState({
          kind: "idle",
          label: `已保存 · r${nextRev}`,
          detail: mergedOthers ? "已并入其他标签页的修改" : "所有内容块均已写入浏览器",
          failed: [],
          evictedCount: 0,
        });
      }
      if (mergedOthers) saveState.mergedText = `检测到其他标签页的新修订（r${remote.meta.rev}），已按内容块并入${countConflicts(project) ? "，冲突块已保留两版" : ""}`;
      void refreshUsage();
      render();
      resolve();
    } catch (error) {
      finishWithFailure([{ scope: "meta", id: META_KEY, label: "保存流程异常中断" }], null, error);
      resolve();
    }
  });
}

function syncVersionBodies(existing: VersionSnapshot[], added: VersionSnapshot, index: VersionIndexEntry[]): VersionSnapshot[] {
  const seqs = new Set(index.map((entry) => entry.seq));
  return [added, ...existing.filter((version) => seqs.has(version.seq) && version.seq !== added.seq)];
}

function finishWithFailure(failed: FailedItem[], ctx: EvictContext | null, error?: unknown): void {
  const names = failed.map((item) => item.label).join("、");
  setSaveState({
    kind: "error",
    label: "部分内容没保住",
    detail: `写入失败：${names}。主修订号未前进，改动仍保留在本标签页，可按块重试。${error && !isQuotaError(error) ? `（${String(error)}）` : ""}`,
    failed,
    evictedCount: ctx?.evicted.length ?? saveState.evictedCount,
  });
  render();
  window.clearTimeout(retryTimer);
  // 自动只重试一轮（可能是别的标签页刚腾出空间），之后等人工点“重试”
  if (!autoRetryArmed) {
    autoRetryArmed = true;
    retryTimer = window.setTimeout(() => { void flush(); }, 2000);
  }
}

function reportStorageFailure(failed: FailedItem[], error?: unknown): void {
  finishWithFailure(failed, null, error);
}

async function refreshUsage(): Promise<void> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) {
      const kb = Math.round((estimate.usage ?? 0) / 1024);
      const mb = (estimate.quota / (1024 * 1024)).toFixed(0);
      saveState.usageText = `本地存储约 ${kb} KB / ${mb} MB`;
    }
  } catch {
    // estimate is best-effort only
  }
}

/* ------------------------------------------------------------------ */
/* 标签页草稿：防抖写 + 心跳 + 关闭前同步落盘                            */
/* ------------------------------------------------------------------ */

function scheduleDraft(): void {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => writeDraft(), 250);
}

function writeDraft(): void {
  if (!isDirty()) return;
  try {
    localStorage.setItem(draftKey(tab.id), JSON.stringify(currentDraft()));
  } catch {
    // 草稿写不进去时正文保存仍会重试；只做轻提示
    if (saveState.kind !== "error") {
      setSaveState({ kind: "warning", label: "离线缓冲写入失败", detail: "本标签页的临时缓冲写入失败，正文保存会继续重试；请避免直接关闭页面。", failed: [], evictedCount: 0 });
    }
  }
}

window.addEventListener("beforeunload", writeDraft);
window.addEventListener("pagehide", writeDraft);
window.setInterval(() => {
  if (isDirty()) writeDraft();
}, 4000);

/* 其他标签页写入后，按修订号拉取并块级合并 */
let pullTimer = 0;
window.addEventListener("storage", (event) => {
  if (!event.key || !event.key.startsWith(PREFIX)) return;
  if (event.key === draftKey(tab.id) || event.key.startsWith(DRAFT_PREFIX)) return;
  window.clearTimeout(pullTimer);
  pullTimer = window.setTimeout(() => {
    const remote = readRemoteProject();
    if (!remote || remote.meta.rev <= baseRev) return;
    const incomingRev = remote.meta.rev;
    const outcome = mergeInto(remote, [currentDraft()]);
    project = outcome.project;
    touchedBlocks = outcome.rebasedBlocks;
    touchedTerms = outcome.rebasedTerms;
    const hadLocalChanges = isDirty();
    if (hadLocalChanges) {
      // 本地有未提交改动：基线保持不变，由接下来的回写在冲突/自动并入后推进
      saveState.mergedText = `其他标签页已保存到 r${incomingRev}，正与本标签页的修改按块合并${outcome.conflicts ? `，${outcome.conflicts} 处冲突保留两版` : ""}`;
      void refreshUsage();
      render();
      writeDraft();
      requestFlush("合并其他标签页修订后回写");
    } else {
      // 干净快进：基线直接前移到远端修订号
      baseRev = incomingRev;
      saveState.mergedText = `其他标签页已保存到 r${incomingRev}，未动过的块已自动更新`;
      void refreshUsage();
      render();
      setSaveState({ kind: "idle", label: `已保存 · r${incomingRev}`, detail: "已同步其他标签页的修订", failed: [], evictedCount: 0 });
    }
  }, 250);
});

/* ------------------------------------------------------------------ */
/* 编辑动作与撤销重做                                                  */
/* ------------------------------------------------------------------ */

function recordTouch(before: ChapterProject, after: ChapterProject): void {
  const beforeBlocks = new Map(before.blocks.map((block) => [block.id, block]));
  const afterBlocks = new Map(after.blocks.map((block) => [block.id, block]));
  for (const [id, afterBlock] of afterBlocks) {
    const beforeBlock = beforeBlocks.get(id);
    if (!beforeBlock) {
      touchedBlocks[id] ??= null; // 新建
      afterBlock.updatedAt = nowIso();
    } else if (blockFingerprint(beforeBlock) !== blockFingerprint(afterBlock)) {
      touchedBlocks[id] ??= blockFingerprint(beforeBlock);
      afterBlock.updatedAt = nowIso();
    }
  }
  for (const id of beforeBlocks.keys()) {
    if (!afterBlocks.has(id)) touchedBlocks[id] ??= blockFingerprint(beforeBlocks.get(id)!);
  }

  const beforeTerms = new Map(before.glossary.map((term) => [term.id, term]));
  const afterTerms = new Map(after.glossary.map((term) => [term.id, term]));
  for (const [id, afterTerm] of afterTerms) {
    const beforeTerm = beforeTerms.get(id);
    if (!beforeTerm) {
      touchedTerms[id] ??= null;
      afterTerm.updatedAt = nowIso();
    } else if (termFingerprint(beforeTerm) !== termFingerprint(afterTerm)) {
      touchedTerms[id] ??= termFingerprint(beforeTerm);
      afterTerm.updatedAt = nowIso();
    }
  }
  for (const id of beforeTerms.keys()) {
    if (!afterTerms.has(id)) touchedTerms[id] ??= termFingerprint(beforeTerms.get(id)!);
  }
}

function commit(label: string, update: (draft: ChapterProject) => void, renderAfter = true) {
  undoStack = [...undoStack.slice(-49), clone(project)];
  redoStack = [];
  const before = project;
  const draft = clone(project);
  update(draft);
  draft.updatedAt = nowIso();
  recordTouch(before, draft);
  project = draft;
  document.documentElement.dataset.lastAction = label;
  saveState.mergedText = "";
  saveState.evictedCount = 0;
  scheduleDraft();
  requestFlush(label);
  if (renderAfter) render();
}

function undo() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack = [clone(project), ...redoStack].slice(0, 50);
  const before = project;
  project = previous;
  recordTouch(before, project);
  if (!project.blocks.some((block) => block.id === activeBlockId)) activeBlockId = project.blocks[0]?.id ?? "";
  scheduleDraft();
  requestFlush("撤销");
  render();
}

function redo() {
  const next = redoStack.shift();
  if (!next) return;
  undoStack = [...undoStack.slice(-49), clone(project)];
  const before = project;
  project = next;
  recordTouch(before, project);
  scheduleDraft();
  requestFlush("重做");
  render();
}

function updateActiveBlock(update: (block: ContentBlock, draft: ChapterProject) => void, label = "修改无障碍文本", renderAfter = true) {
  commit(label, (draft) => {
    const block = draft.blocks.find((item) => item.id === activeBlockId);
    if (block) update(block, draft);
  }, renderAfter);
}

function requestSnapshot(label: string) {
  document.documentElement.dataset.lastAction = label;
  snapshotRequested = true;
  void flush();
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function renderNotices(): string {
  const blockConflicts = project.blocks.filter((block) => block.conflict);
  const termConflicts = project.glossary.filter((term) => term.conflict);
  const notices: string[] = [];

  if (saveState.failed.some((item) => item.scope !== "version")) {
    notices.push(`<div class="notice-banner danger">
      <div class="notice-head"><b>以下内容没保住，修订号未前进</b><span>改动仍保留在本标签页，可按块重试；快照失败不影响正文</span></div>
      <ul class="notice-list">${saveState.failed.map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>
      <sl-button size="small" variant="danger" data-action="retry-save">重试保存这些块</sl-button>
    </div>`);
  } else if (saveState.failed.some((item) => item.scope === "version")) {
    notices.push(`<div class="notice-banner warning">
      <div class="notice-head"><b>新版本快照没保住</b><span>正文与审核结论已保存；空间不足且已无可淘汰的旧快照</span></div>
      <sl-button size="small" variant="warning" data-action="dismiss-notice">知道了</sl-button>
    </div>`);
  }

  if (saveState.evictedCount > 0 && saveState.kind !== "error") {
    notices.push(`<div class="notice-banner warning">
      <div class="notice-head"><b>容量不足，已淘汰 ${saveState.evictedCount} 个最旧快照</b><span>被淘汰的均为未固定、且没有标签页正在比较引用的快照</span></div>
      <sl-button size="small" variant="default" data-action="dismiss-notice">知道了</sl-button>
    </div>`);
  }

  if (blockConflicts.length || termConflicts.length) {
    const rows = [
      ...blockConflicts.map((block) => {
        const alt = block.conflict!.alt;
        const otherText = alt.kind === "deleted"
          ? "（对方删除了这块）"
          : escapeHtml(alt.block!.accessibleText || alt.block!.text || "（空）");
        return `<li class="conflict-row">
          <button class="conflict-jump" data-action="select-block" data-block-id="${block.id}">${escapeHtml(blockLabel(block))}</button>
          <div class="conflict-versions"><div><span>本标签页</span><p>${escapeHtml(block.accessibleText || block.text || "（空）")}</p></div><div><span>${escapeHtml(alt.source)} · r前</span><p>${otherText}</p></div></div>
          <div class="conflict-actions"><sl-button size="small" variant="primary" data-action="resolve-block" data-block-id="${block.id}" data-choice="mine">保留本页版</sl-button><sl-button size="small" data-action="resolve-block" data-block-id="${block.id}" data-choice="other">${alt.kind === "deleted" ? "同意删除" : "采用对方版"}</sl-button></div>
        </li>`;
      }),
      ...termConflicts.map((term) => {
        const alt = term.conflict!.alt;
        const otherText = alt.kind === "deleted" ? "（对方删除了这条术语）" : escapeHtml(`${alt.term!.source} → ${alt.term!.preferred}`);
        return `<li class="conflict-row term">
          <b>${escapeHtml(termLabel(term))}</b>
          <div class="conflict-versions"><div><span>本标签页</span><p>${escapeHtml(`${term.source} → ${term.preferred}`)}</p></div><div><span>${escapeHtml(alt.source)}</span><p>${otherText}</p></div></div>
          <div class="conflict-actions"><sl-button size="small" variant="primary" data-action="resolve-term" data-term-id="${term.id}" data-choice="mine">保留本页版</sl-button><sl-button size="small" data-action="resolve-term" data-term-id="${term.id}" data-choice="other">${alt.kind === "deleted" ? "同意删除" : "采用对方版"}</sl-button></div>
        </li>`;
      }),
    ].join("");
    notices.push(`<div class="notice-banner conflict">
      <div class="notice-head"><b>${blockConflicts.length + termConflicts.length} 处冲突已保留两版，等待人工选择</b><span>同一内容块被两个标签页改动；选定前两版都不会丢</span></div>
      <ul class="conflict-list">${rows}</ul>
    </div>`);
  }

  if (saveState.mergedText) {
    notices.push(`<div class="notice-banner info"><b>${escapeHtml(saveState.mergedText)}</b><sl-button size="small" variant="text" data-action="dismiss-notice">关闭</sl-button></div>`);
  }

  return notices.length ? `<div class="notice-stack">${notices.join("")}</div>` : "";
}

function render() {
  const list = issues();
  const active = activeBlock();
  const activeIssues = list.filter((issue) => issue.blockId === active.id);
  const approved = project.blocks.filter((block) => block.reviewStatus === "approved").length;
  const version = project.versions.find((item) => String(item.seq) === selectedVersionId) ?? project.versions[0];
  const conflictCount = countConflicts(project);

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><span>无障碍</span><b>1009</b></div>
        <div class="title-block">
          <input id="project-title" aria-label="教材名称" value="${escapeHtml(project.title)}" />
          <div class="meta"><span>${escapeHtml(project.subject)}</span><span>${escapeHtml(project.grade)}</span><span id="save-pill" class="save-dot status-${saveState.kind}" title="${escapeHtml(saveState.detail)}">${escapeHtml(saveState.label)}</span><span class="rev-tag">修订号 r${baseRev}${conflictCount ? ` · ${conflictCount} 处冲突` : ""}</span></div>
        </div>
        <div class="top-actions">
          <span class="online-pill">${navigator.onLine ? "在线" : "离线可编辑"}</span>
          <sl-button size="small" variant="default" ${undoStack.length ? "" : "disabled"} data-action="undo">撤销</sl-button>
          <sl-button size="small" variant="default" ${redoStack.length ? "" : "disabled"} data-action="redo">重做</sl-button>
          <sl-button size="small" variant="default" data-action="glossary">术语表</sl-button>
          <sl-button size="small" variant="primary" data-action="save-version">保存版本</sl-button>
          <sl-button size="small" variant="success" data-action="export">导出无障碍 HTML</sl-button>
        </div>
      </header>

      <div class="progress-strip">
        <div class="progress-copy"><b>${approved}/${project.blocks.length}</b><span>内容块已审核通过</span></div>
        <div class="progress-bar"><i style="width:${Math.round((approved / Math.max(1, project.blocks.length)) * 100)}%"></i></div>
        <div class="issue-counts">
          <span class="error">${list.filter((issue) => issue.severity === "error").length} 必须修复</span>
          <span class="warning">${list.filter((issue) => issue.severity === "warning").length} 建议优化</span>
          <span class="info">${list.filter((issue) => issue.severity === "info").length} 术语提醒</span>
        </div>
      </div>

      ${renderNotices()}

      <div class="workspace">
        <aside class="outline-panel">
          <div class="panel-title"><span>章节结构</span><sl-badge>${project.blocks.length} 块</sl-badge></div>
          <div class="block-list">
            ${project.blocks.map((block, index) => {
              const blockIssues = list.filter((issue) => issue.blockId === block.id);
              return `<button class="block-item ${block.id === active.id ? "active" : ""}" data-action="select-block" data-block-id="${block.id}">
                <span class="block-order">${index + 1}</span>
                <span class="block-copy"><b>${block.type === "heading" ? `H${block.headingLevel}` : blockRole(block)}</b><span>${escapeHtml(block.accessibleText || block.text || "（空）")}</span></span>
                <i class="status-${block.reviewStatus}" title="${statusLabel(block.reviewStatus)}"></i>
                ${block.conflict ? `<b class="conflict-dot" title="冲突待选择">!</b>` : ""}
                ${blockIssues.length ? `<em>${blockIssues.length}</em>` : ""}
              </button>`;
            }).join("")}
          </div>
          <input id="chapter-file" type="file" accept=".txt,.md,.markdown" hidden />
          <sl-button class="import-button" variant="default" data-action="import">导入章节文本</sl-button>
          <div class="keyboard-note"><b>键盘</b><span><kbd>J</kbd><kbd>K</kbd> 跳转问题</span><span><kbd>E</kbd> 自动改写</span><span><kbd>⌘ Z</kbd> 撤销</span><span><kbd>1</kbd><kbd>2</kbd> 预览模式</span></div>
        </aside>

        <main class="editor-panel">
          <div class="editor-head">
            <div><span class="eyebrow">当前内容块</span><h1>${blockRole(active)}</h1></div>
            <div class="review-actions">
              <sl-button size="small" variant="${active.reviewStatus === "approved" ? "success" : "default"}" data-action="approve">${active.reviewStatus === "approved" ? "✓ 已通过" : "审核通过"}</sl-button>
              <sl-button size="small" variant="${active.reviewStatus === "needs-work" ? "danger" : "default"}" data-action="needs-work">需修改</sl-button>
            </div>
          </div>

          ${active.conflict ? renderBlockConflict(active) : ""}

          ${activeIssues.length ? `<div class="active-issues">${activeIssues.map((issue) => `
            <div class="issue-card ${issue.severity}">
              <div><sl-badge variant="${issue.severity === "error" ? "danger" : issue.severity === "warning" ? "warning" : "primary"}">${severityLabel(issue.severity)}</sl-badge><strong>${escapeHtml(issue.title)}</strong></div>
              <p>${escapeHtml(issue.detail)}</p><small>${escapeHtml(issue.suggestion)}</small>
            </div>`).join("")}</div>` : `<div class="issue-clear">✓ 当前内容块没有新的无障碍问题</div>`}

          <section class="edit-card source-card">
            <div class="section-heading"><div><span class="eyebrow">原教材</span><h2>${active.type === "image" ? "图片信息" : active.type === "link" ? "链接信息" : "原文"}</h2></div><sl-badge variant="neutral">${active.type}</sl-badge></div>
            ${renderSourceEditor(active)}
          </section>

          <section class="edit-card rewrite-card">
            <div class="section-heading">
              <div><span class="eyebrow">Accessible rewrite</span><h2>无障碍表达</h2></div>
              <sl-button size="small" variant="primary" outline data-action="generate">生成易读版本</sl-button>
            </div>
            ${renderAccessibleEditor(active)}
            <label class="field-label" for="reason-${active.id}">改写原因（每处改写必须记录）</label>
            <sl-textarea id="reason-${active.id}" data-field="reason" rows="2" value="${escapeHtml(active.changeReason)}" placeholder="例如：拆分长句、替换专业表达、补充链接目的"></sl-textarea>
          </section>

          <section class="edit-card">
            <div class="section-heading"><div><span class="eyebrow">Review discussion</span><h2>批注与回复</h2></div><sl-badge variant="warning">${active.comments.length} 条</sl-badge></div>
            <div class="comment-compose"><sl-textarea id="new-comment" rows="2" placeholder="记录改写依据、审核意见或术语讨论…"></sl-textarea><sl-button size="small" variant="primary" data-action="add-comment">添加批注</sl-button></div>
            <div class="comment-list">
              ${active.comments.length ? active.comments.map((comment) => `
                <article class="comment ${comment.resolved ? "resolved" : ""}">
                  <header><b>${escapeHtml(comment.author)}</b><time>${new Date(comment.createdAt).toLocaleString()}</time></header>
                  <p>${escapeHtml(comment.body)}</p>
                  ${comment.replies.map((reply) => `<div class="reply"><b>${escapeHtml(reply.author)}</b><span>${escapeHtml(reply.body)}</span></div>`).join("")}
                  <div class="reply-row"><sl-input size="small" id="reply-${comment.id}" placeholder="回复…"></sl-input><sl-button size="small" data-action="reply" data-comment-id="${comment.id}">回复</sl-button><sl-button size="small" variant="text" data-action="resolve-comment" data-comment-id="${comment.id}">${comment.resolved ? "重新打开" : "解决"}</sl-button></div>
                </article>`).join("") : `<div class="empty-note">当前内容块还没有批注。</div>`}
            </div>
          </section>
        </main>

        <aside class="review-panel">
          <section class="preview-card">
            <div class="section-heading"><div><span class="eyebrow">Reader preview</span><h2>阅读预览</h2></div><div class="mode-switch"><button class="${previewMode === "normal" ? "active" : ""}" data-action="preview-normal">普通</button><button class="${previewMode === "assisted" ? "active" : ""}" data-action="preview-assisted">辅助</button></div></div>
            <div class="reader-preview mode-${previewMode}">${renderPreview()}</div>
          </section>

          <section class="order-card">
            <div class="section-heading"><div><span class="eyebrow">Screen reader order</span><h2>读屏阅读顺序</h2></div><sl-badge>从上到下</sl-badge></div>
            <ol class="reading-order">
              ${project.blocks.map((block, index) => `<li class="${block.id === active.id ? "active" : ""}"><b>${index + 1}</b><div><strong>${blockRole(block)}</strong><span>${escapeHtml(block.accessibleText || block.text || "（无内容）")}</span></div></li>`).join("")}
            </ol>
          </section>

          <section class="issues-panel">
            <div class="section-heading"><div><span class="eyebrow">All checks</span><h2>全章问题</h2></div><sl-button size="small" variant="default" outline data-action="approve-all">全部通过</sl-button></div>
            <div class="issue-list">
              ${list.length ? list.map((issue) => `<button class="${issue.id === activeIssueId ? "active" : ""} ${issue.severity}" data-action="jump-issue" data-issue-id="${issue.id}" data-block-id="${issue.blockId}"><span>${severityLabel(issue.severity)}</span><b>${escapeHtml(issue.title)}</b><small>段 ${project.blocks.findIndex((block) => block.id === issue.blockId) + 1} · ${escapeHtml(issue.suggestion)}</small></button>`).join("") : `<div class="issue-clear">✓ 全章检查通过</div>`}
            </div>
          </section>

          <section class="version-card">
            <div class="section-heading"><div><span class="eyebrow">Version compare</span><h2>版本比较</h2></div><sl-badge>${project.versions.length} 版${project.versions.filter((item) => item.pinned).length ? ` · ${project.versions.filter((item) => item.pinned).length} 固定` : ""}</sl-badge></div>
            ${project.versions.length ? `
              <sl-select id="version-select" size="small" value="${String(version?.seq ?? "")}">${project.versions.map((item) => `<sl-option value="${item.seq}">${item.pinned ? "★ " : ""}${escapeHtml(item.label)} · ${new Date(item.createdAt).toLocaleTimeString()}</sl-option>`).join("")}</sl-select>
              <div class="version-actions">
                <sl-button size="small" variant="${version?.pinned ? "warning" : "default"}" outline data-action="toggle-pin" ${version ? "" : "disabled"}>${version?.pinned ? "★ 已固定（不参与淘汰）" : "☆ 固定此版本"}</sl-button>
              </div>
              <div class="version-diff">${version ? renderVersionDiff(version, active) : ""}</div>
              <small class="storage-usage">${escapeHtml(saveState.usageText || "正在估算本地存储用量…")}</small>
            ` : `<div class="empty-note">保存版本后，可比较改写前后的无障碍文本。未固定快照最多保留 10 份，容量不足时优先淘汰最旧且无人引用的。</div>`}
          </section>
        </aside>
      </div>

      <footer class="statusbar"><span>最近操作：${escapeHtml(document.documentElement.dataset.lastAction || "示例章节已载入")}</span><span>修订号 r${baseRev} · ${project.blocks.length} 个内容块 · ${list.length} 个待处理问题</span></footer>
    </div>

    <sl-dialog label="全书术语表" ${showGlossary ? "open" : ""} data-dialog="glossary">
      <div class="glossary-editor">
        ${project.glossary.map((term) => `<div class="term-row ${term.conflict ? "has-conflict" : ""}">
          <div><b>${escapeHtml(term.source)}</b><sl-input size="small" value="${escapeHtml(term.preferred)}" data-term-id="${term.id}"></sl-input><small>${escapeHtml(term.note)}</small>
          ${term.conflict ? `<div class="term-conflict">
            <span>与 ${escapeHtml(term.conflict.alt.source)} 的修改冲突：${term.conflict.alt.kind === "deleted" ? "对方删除了该术语" : escapeHtml(`对方为「${term.conflict.alt.term!.source} → ${term.conflict.alt.term!.preferred}」`)}</span>
            <sl-button size="small" variant="primary" data-action="resolve-term" data-term-id="${term.id}" data-choice="mine">保留本页</sl-button>
            <sl-button size="small" data-action="resolve-term" data-term-id="${term.id}" data-choice="other">${term.conflict.alt.kind === "deleted" ? "同意删除" : "采用对方"}</sl-button>
          </div>` : ""}
          </div><sl-button size="small" variant="danger" outline data-action="remove-term" data-term-id="${term.id}">删除</sl-button></div>`).join("")}
      </div>
      <div class="term-add"><sl-input id="new-term-source" placeholder="原文术语"></sl-input><sl-input id="new-term-preferred" placeholder="统一表达"></sl-input><sl-button variant="primary" data-action="add-term">添加术语</sl-button></div>
      <sl-button slot="footer" variant="primary" data-action="close-glossary">完成</sl-button>
    </sl-dialog>`;

  wireLiveFields();
  paintSavePill();
}

function renderBlockConflict(block: ContentBlock) {
  const alt = block.conflict!.alt;
  return `<div class="conflict-card">
    <div class="conflict-card-head"><b>⚠ 这块和 ${escapeHtml(alt.source)} 的保存撞车了</b><span>两版都保留着，选完才会继续</span></div>
    <div class="conflict-versions">
      <div class="mine"><span>本标签页</span><p>${escapeHtml(block.accessibleText || block.text || "（空）")}</p><small>审核：${statusLabel(block.reviewStatus)} · 批注 ${block.comments.length} 条</small></div>
      <div class="other"><span>${escapeHtml(alt.source)}</span><p>${alt.kind === "deleted" ? "对方删除了这块" : escapeHtml(alt.block!.accessibleText || alt.block!.text || "（空）")}</p>${alt.kind === "edit" && alt.block ? `<small>审核：${statusLabel(alt.block.reviewStatus)} · 批注 ${alt.block.comments.length} 条</small>` : ""}</div>
    </div>
    <div class="conflict-actions">
      <sl-button size="small" variant="primary" data-action="resolve-block" data-block-id="${block.id}" data-choice="mine">保留本页版</sl-button>
      <sl-button size="small" data-action="resolve-block" data-block-id="${block.id}" data-choice="other">${alt.kind === "deleted" ? "同意删除" : "采用对方版"}</sl-button>
    </div>
  </div>`;
}

function renderSourceEditor(block: ContentBlock) {
  if (block.type === "image") {
    return `<div class="image-source"><img src="${escapeHtml(block.imageSrc ?? "")}" alt="" /><div><b>图注</b><p>${escapeHtml(block.text)}</p><b>现有替代文本</b><p>${escapeHtml(block.imageAlt || "（空）")}</p></div></div>
      <sl-input id="source-${block.id}" data-field="source" label="图注" value="${escapeHtml(block.text)}"></sl-input>
      <sl-input id="image-alt-${block.id}" data-field="image-alt" label="替代文本" value="${escapeHtml(block.imageAlt ?? "")}" help-text="描述图片传达的信息，不写“图片”二字。"></sl-input>`;
  }
  if (block.type === "link") {
    return `<sl-input id="source-${block.id}" data-field="source" label="原链接文案" value="${escapeHtml(block.text)}"></sl-input><sl-input id="link-href-${block.id}" data-field="link-href" label="链接地址" value="${escapeHtml(block.linkHref ?? "")}"></sl-input>`;
  }
  if (block.type === "heading") {
    return `<div class="heading-edit"><sl-select id="heading-level-${block.id}" data-field="heading-level" label="标题层级" value="${String(block.headingLevel ?? 2)}"><sl-option value="1">H1</sl-option><sl-option value="2">H2</sl-option><sl-option value="3">H3</sl-option><sl-option value="4">H4</sl-option></sl-select><sl-input id="source-${block.id}" data-field="source" label="标题文本" value="${escapeHtml(block.text)}"></sl-input></div>`;
  }
  return `<sl-textarea id="source-${block.id}" data-field="source" rows="4" value="${escapeHtml(block.text)}"></sl-textarea>`;
}

function renderAccessibleEditor(block: ContentBlock) {
  if (block.type === "image") {
    return `<sl-textarea id="accessible-${block.id}" data-field="accessible" rows="3" label="图片替代文本" value="${escapeHtml(block.imageAlt || block.accessibleText)}" help-text="读屏软件会朗读这里的内容。"></sl-textarea>`;
  }
  return `<sl-textarea id="accessible-${block.id}" data-field="accessible" rows="6" value="${escapeHtml(block.accessibleText)}"></sl-textarea>`;
}

function renderPreview() {
  return project.blocks.map((block, index) => {
    const content = escapeHtml(block.accessibleText || block.text);
    if (block.type === "heading") {
      const tag = `h${Math.min(6, Math.max(1, block.headingLevel ?? 2))}`;
      return `<${tag} class="${block.id === activeBlockId ? "active-block" : ""}"><span class="order-marker">${index + 1}</span>${content}</${tag}>`;
    }
    if (block.type === "image") {
      return `<figure class="${block.id === activeBlockId ? "active-block" : ""}"><img src="${escapeHtml(block.imageSrc ?? "")}" alt="${escapeHtml(block.imageAlt || block.accessibleText)}"><figcaption><span class="order-marker">${index + 1}</span>${escapeHtml(block.text)}</figcaption></figure>`;
    }
    if (block.type === "link") {
      return `<p class="${block.id === activeBlockId ? "active-block" : ""}"><span class="order-marker">${index + 1}</span><a href="${escapeHtml(block.linkHref ?? "#")}" onclick="return false">${content}</a><span class="link-role">链接</span></p>`;
    }
    return `<p class="${block.id === activeBlockId ? "active-block" : ""}"><span class="order-marker">${index + 1}</span>${content}</p>`;
  }).join("");
}

function renderVersionDiff(version: VersionSnapshot, current: ContentBlock) {
  const oldBlock = version.blocks.find((block) => block.id === current.id);
  if (!oldBlock) return `<div class="empty-note">当前内容块不在该版本中。</div>`;
  return `<div class="diff-column"><span>旧版 r${version.seq}</span><p>${escapeHtml(oldBlock.accessibleText || oldBlock.text)}</p></div><div class="diff-column current"><span>当前</span><p>${escapeHtml(current.accessibleText || current.text)}</p></div>`;
}

function wireLiveFields() {
  app.querySelectorAll<HTMLElement>("sl-input[data-field], sl-textarea[data-field], sl-select[data-field]").forEach((element) => {
    element.addEventListener("sl-input", () => {
      const value = (element as HTMLElement & { value: string }).value;
      updateActiveBlock((block) => {
        const field = element.dataset.field;
        if (field === "source") block.text = value;
        if (field === "accessible") {
          block.accessibleText = value;
          if (block.type === "image") block.imageAlt = value;
        }
        if (field === "image-alt") {
          block.imageAlt = value;
          block.accessibleText = value;
        }
        if (field === "link-href") block.linkHref = value;
        if (field === "reason") block.changeReason = value;
        block.reviewStatus = "pending";
      }, "编辑无障碍文本", false);
    });
    element.addEventListener("sl-change", () => render());
  });
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

app.addEventListener("click", (event) => {
  const eventTarget = event.target as HTMLElement | null;
  const target = eventTarget && typeof eventTarget.closest === "function"
    ? eventTarget.closest<HTMLElement>("[data-action]")
    : null;
  if (!target) return;
  const action = target.dataset.action;
  if (action === "undo") undo();
  if (action === "redo") redo();
  if (action === "select-block") {
    activeBlockId = target.dataset.blockId ?? activeBlockId;
    activeIssueId = "";
    render();
  }
  if (action === "jump-issue") {
    activeIssueId = target.dataset.issueId ?? "";
    activeBlockId = target.dataset.blockId ?? activeBlockId;
    render();
    requestAnimationFrame(() => app.querySelector<HTMLElement>(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  if (action === "generate") {
    const block = activeBlock();
    const suggestion = block.type === "link"
      ? "打开水循环互动实验"
      : simplifyText(block.type === "image" ? block.imageAlt || block.text : block.text, project.glossary);
    updateActiveBlock((current) => {
      if (current.type === "image") current.imageAlt = suggestion;
      current.accessibleText = suggestion;
      current.changeReason ||= "拆分长句并替换复杂表达，保留原有知识信息。";
      current.reviewStatus = "pending";
    }, "生成易读版本");
  }
  if (action === "approve") updateActiveBlock((block) => { block.reviewStatus = "approved"; }, "审核通过");
  if (action === "needs-work") updateActiveBlock((block) => { block.reviewStatus = "needs-work"; }, "标记需修改");
  if (action === "add-comment") {
    const input = app.querySelector<HTMLElement & { value: string }>("#new-comment");
    const body = input?.value.trim();
    if (body) updateActiveBlock((block) => {
      block.comments.unshift({ id: uid("comment"), author: "当前编辑", body, createdAt: nowIso(), resolved: false, replies: [] });
    }, "添加批注");
  }
  if (action === "reply") {
    const commentId = target.dataset.commentId ?? "";
    const input = app.querySelector<HTMLElement & { value: string }>(`#reply-${CSS.escape(commentId)}`);
    const body = input?.value.trim();
    if (body) updateActiveBlock((block) => {
      block.comments.find((comment) => comment.id === commentId)?.replies.push({ id: uid("reply"), author: "当前编辑", body, createdAt: nowIso() });
    }, "回复批注");
  }
  if (action === "resolve-comment") {
    const commentId = target.dataset.commentId ?? "";
    updateActiveBlock((block) => {
      const comment = block.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    }, "更新批注状态");
  }
  if (action === "preview-normal") { previewMode = "normal"; render(); }
  if (action === "preview-assisted") { previewMode = "assisted"; render(); }
  if (action === "glossary") { showGlossary = true; render(); }
  if (action === "close-glossary") { showGlossary = false; render(); }
  if (action === "add-term") {
    const source = app.querySelector<HTMLElement & { value: string }>("#new-term-source");
    const preferred = app.querySelector<HTMLElement & { value: string }>("#new-term-preferred");
    if (source?.value.trim() && preferred?.value.trim()) {
      commit("添加术语", (draft) => { draft.glossary.push({ id: uid("term"), source: source.value.trim(), preferred: preferred.value.trim(), note: "编辑新增术语" }); });
    }
  }
  if (action === "remove-term") {
    const termId = target.dataset.termId;
    commit("删除术语", (draft) => { draft.glossary = draft.glossary.filter((term) => term.id !== termId); });
  }
  if (action === "save-version") requestSnapshot("保存版本快照");
  if (action === "toggle-pin") {
    const seq = Number(selectedVersionId);
    commit("固定/取消固定版本", (draft) => {
      const item = draft.versions.find((version) => version.seq === seq);
      if (item) item.pinned = !item.pinned;
    });
  }
  if (action === "retry-save") { void flush(); }
  if (action === "dismiss-notice") {
    // 仅关闭提示类横幅；写失败的红条必须保留，直到重试成功
    saveState.evictedCount = 0;
    saveState.mergedText = "";
    saveState.failed = saveState.failed.filter((item) => item.scope === "version");
    if (!saveState.failed.length) {
      setSaveState({ kind: "idle", label: `已保存 · r${baseRev}`, detail: "", failed: [], evictedCount: 0 });
    }
    render();
  }
  if (action === "resolve-block") {
    const blockId = target.dataset.blockId ?? "";
    const choice = target.dataset.choice;
    commit("解决内容块冲突", (draft) => {
      const index = draft.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return;
      const block = draft.blocks[index];
      const alt = block.conflict?.alt;
      if (!alt) return;
      if (choice === "other") {
        if (alt.kind === "deleted") {
          draft.blocks.splice(index, 1);
        } else if (alt.block) {
          const replacement = clone(alt.block);
          delete replacement.conflict;
          draft.blocks[index] = replacement;
        }
      } else {
        delete block.conflict;
      }
    });
  }
  if (action === "resolve-term") {
    const termId = target.dataset.termId ?? "";
    const choice = target.dataset.choice;
    commit("解决术语冲突", (draft) => {
      const index = draft.glossary.findIndex((term) => term.id === termId);
      if (index < 0) return;
      const term = draft.glossary[index];
      const alt = term.conflict?.alt;
      if (!alt) return;
      if (choice === "other") {
        if (alt.kind === "deleted") {
          draft.glossary.splice(index, 1);
        } else if (alt.term) {
          const replacement = clone(alt.term);
          delete replacement.conflict;
          draft.glossary[index] = replacement;
        }
      } else {
        delete term.conflict;
      }
    });
  }
  if (action === "approve-all") {
    commit("全部审核通过", (draft) => { draft.blocks.forEach((block) => { block.reviewStatus = "approved"; }); });
  }
  if (action === "export") {
    download(`${project.title}-无障碍版.html`, exportHtml(project));
    document.documentElement.dataset.lastAction = "已导出无障碍 HTML";
    render();
  }
  if (action === "import") app.querySelector<HTMLInputElement>("#chapter-file")?.click();
});

app.addEventListener("sl-change", (event) => {
  const element = event.target as HTMLElement;
  if (element.id === "chapter-file") return;
  if (element.id.startsWith("heading-level-")) {
    const level = Number((element as HTMLElement & { value: string }).value);
    updateActiveBlock((block) => { block.headingLevel = level; block.reviewStatus = "pending"; }, "修改标题层级");
  }
  if (element.id === "version-select") {
    selectedVersionId = (element as HTMLElement & { value: string }).value;
    scheduleDraft();
    render();
  }
  if (typeof element.matches === "function" && element.matches("[data-term-id]") && element.closest(".term-row")) {
    const termId = element.dataset.termId!;
    const value = (element as HTMLElement & { value: string }).value;
    commit("修改术语表", (draft) => { const term = draft.glossary.find((item) => item.id === termId); if (term) term.preferred = value; });
  }
});

app.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id !== "chapter-file" || !input.files?.[0]) return;
  void input.files[0].text().then((text) => {
    commit("导入章节文本", (draft) => {
      draft.blocks = parseImportedChapter(text);
      activeBlockId = draft.blocks[0]?.id ?? "";
      activeIssueId = "";
    });
  });
});

app.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "project-title") {
    project.title = input.value;
    titleDirty = true;
    saveState.mergedText = "";
    scheduleDraft();
    requestFlush("修改教材名称");
  }
});

window.addEventListener("online", render);
window.addEventListener("offline", render);
window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && typeof target.matches === "function" && target.matches("input, textarea, sl-input, sl-textarea, [contenteditable='true']")) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    requestSnapshot("键盘保存版本");
    return;
  }
  if (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") {
    const list = issues();
    if (!list.length) return;
    const current = Math.max(0, list.findIndex((issue) => issue.id === activeIssueId));
    const next = (current + (event.key.toLowerCase() === "j" ? 1 : -1) + list.length) % list.length;
    activeIssueId = list[next].id;
    activeBlockId = list[next].blockId;
    render();
  }
  if (event.key.toLowerCase() === "e") {
    const button = app.querySelector<HTMLElement>('[data-action="generate"]');
    button?.click();
  }
  if (event.key === "1") { previewMode = "normal"; render(); }
  if (event.key === "2") { previewMode = "assisted"; render(); }
});

startup();
