export type BlockType = "heading" | "paragraph" | "image" | "link";
export type ReviewStatus = "pending" | "approved" | "needs-work";
export type Severity = "error" | "warning" | "info";

export interface CommentReply {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
}

export interface ContentBlock {
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
  /** 多标签页合并时标记冲突，保留两版等人挑选 */
  conflict?: { group: string; side: "mine" | "theirs"; field: string };
}

export interface GlossaryTerm {
  id: string;
  source: string;
  preferred: string;
  note: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  /** 完整快照数据按需从独立键读取，列表里只放元数据 */
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
}

export interface ChapterProject {
  id: string;
  title: string;
  subject: string;
  grade: string;
  blocks: ContentBlock[];
  glossary: GlossaryTerm[];
  versions: VersionSnapshot[];
  updatedAt: string;
}

export interface AccessibilityIssue {
  id: string;
  blockId: string;
  type: "heading" | "link" | "image" | "glossary" | "sentence";
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
}
