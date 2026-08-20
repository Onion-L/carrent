import type { ChangedFile, ChangedFilesMessage, Message, MessagePart } from "./threadContent";
import type { AttachmentKind, AttachmentMetadata } from "./chat";
import {
  isSupportedImageMimeType,
  isValidAttachmentSha256,
  MAX_ATTACHMENT_COUNT,
} from "./attachment";
import { normalizeLocalPathContexts, type LocalPathContextItem } from "./localPathContext";
import { ACTION_IDS, isKeyBinding, type ActionId, type KeyBinding } from "./keybindings";
import {
  DEFAULT_CODE_HIGHLIGHT_THEME,
  isCodeHighlightThemeId,
  type CodeHighlightThemeId,
} from "./codeHighlightThemes";
import { isAgentMode, type AgentMode } from "./agentMode";
import { normalizePersistedProviderProfileId, type ProviderProfileId } from "./providerProfiles";
import { MAX_TERMINAL_PANEL_HEIGHT, MIN_TERMINAL_PANEL_HEIGHT } from "./terminal";
import {
  normalizeRunChecklistEntries,
  type RunChecklistOutcome,
  type ThreadRunChecklist,
} from "./runChecklist";

const LEGACY_WORKSPACE_SNAPSHOT_VERSION = 1;
export const APP_STATE_SNAPSHOT_VERSION = 1;

export type AppStateRecoveryStage =
  | "read"
  | "parse"
  | "schema-version"
  | "validate"
  | "legacy-detection"
  | "reset-stage"
  | "reset-write"
  | "reset-cleanup";

export type AppStateDiagnostic = {
  appVersion: string;
  subsystem: "app-state";
  stage: AppStateRecoveryStage;
  summary: string;
  dataPath: string;
  occurredAt: string;
};

export type AppStateLoadResult =
  | {
      status: "ready";
      snapshot: AppStateSnapshot;
      notice?: "legacy-reset" | "full-reset";
    }
  | {
      status: "recovery-required";
      diagnostics: AppStateDiagnostic[];
    };

export type WorkspaceRecord = {
  id: string;
  name: string;
  order: number;
};

export type AppProjectRecord = {
  id: string;
  name: string;
  workingDirectory: string;
};

export type WorkspaceProjectAssociationRecord = {
  workspaceId: string;
  projectId: string;
  alias?: string;
  order: number;
  defaultProviderProfileId: ProviderProfileId;
  defaultAgentMode: AgentMode;
};

export type AppThreadRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  // Set when the user renames the thread manually, so the Composer never
  // overwrites it with an auto-derived title (even when renamed back to the
  // default "New thread").
  customTitle?: boolean;
  createdAt: string;
  lastActivityAt: string;
  archived?: boolean;
  pinned?: boolean;
  providerProfileId: ProviderProfileId;
  agentMode: AgentMode;
  runChecklist?: ThreadRunChecklist;
};

export type AssociationThreadDraftRecord = {
  id: string;
  threadId: string;
  workspaceId: string;
  projectId: string;
  content: string;
  composerState?: string;
  attachedSkillNames: string[];
  attachments: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  providerProfileId: ProviderProfileId;
  agentMode: AgentMode;
};

type PersistedMessage = Message<{ timestamp?: string }>;

export type AppThreadMessageRecord = PersistedMessage & {
  content: string;
  createdAt: string;
  attachments: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
};

export type AppThreadRunRecord = {
  id: string;
  threadId: string;
  messageId: string;
  assistantMessageId?: string;
  startedAt: string;
  providerProfileId: ProviderProfileId;
  agentMode: AgentMode;
};

export type AppThreadRunStartInput = {
  runId: string;
  messageId: string;
  assistantMessageId?: string;
  message: string;
  attachments: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  startedAt: string;
  // Original createdAt of the optimistic user message, when one exists. Run
  // recording and draft promotion persist it so the user message cannot sort
  // after the assistant placeholder created alongside it.
  messageCreatedAt?: string;
  providerProfileId: ProviderProfileId;
  agentMode: AgentMode;
};

export type AppThreadPromotionIntentRecord = AppThreadRunStartInput & {
  draftId: string;
  threadId: string;
  workspaceId: string;
  projectId: string;
  title: string;
};

export type AppStateSettingsTheme = "dark" | "light" | "system";
export type TypographyMode = "simple" | "advanced";

/**
 * User settings shared across windows through the App State snapshot.
 *
 * Validation is deliberately lenient and mirrors the renderer's
 * SettingsContext (`carrent:settings` in localStorage): every field is
 * validated on its own and a missing or invalid field falls back to the
 * default below instead of rejecting the whole value; unknown fields are
 * dropped. `normalizeAppStateSettings` only returns null when the value is
 * not an object at all.
 */
export type AppStateSettings = {
  theme: AppStateSettingsTheme;
  codeHighlightTheme: CodeHighlightThemeId;
  typographyMode: TypographyMode;
  fontFamilySans: string;
  fontFamilyComposer: string;
  fontFamilyCode: string;
  fontFamilyTerminal: string;
  fontSizeInterface: number;
  fontSizePrompt: number;
  fontSizeCode: number;
  fontSizeTerminal: number;
  fontSmoothing: boolean;
  terminalFontForce: boolean;
  /** @deprecated Legacy input-only field. Normalized settings omit it. */
  fontSize?: number;
  // Empty means the first installed editor returned by detection.
  defaultEditorId: string;
  enhancedTerminalCompletion: boolean;
  terminalPanelHeight: number;
  // Optional UI font-family override. When empty, the renderer uses the base
  // Geist/Inter stack; when set, it is prepended to that stack so the user's
  // font wins and Geist/Inter/system remain as fallbacks. CSS escaping happens
  // at the write site (src/renderer/lib/fontFamily); the normalizer only
  // validates shape — type check, trim outer whitespace, strip control chars,
  // truncate.
  /** @deprecated Legacy input-only field. Normalized settings omit it. */
  customFontFamily?: string;
  // User-customized keyboard shortcuts, keyed by action. An absent action
  // falls back to the renderer's platform-specific default; an own property with value undefined is
  // explicitly unbound and is serialized as null for JSON persistence.
  keybindingOverrides?: Partial<Record<ActionId, KeyBinding>>;
  // Custom base directory for newly created empty Projects. Omitted means the
  // dynamic default (<OS user home>/CarrentProjects), so the per-user absolute
  // default path is never persisted. Applies to future empty Projects only;
  // existing Project paths are never moved.
  newProjectLocation?: string;
};

// Font-size bounds mirror src/renderer/lib/fontSize (kept renderer-local).
const MIN_SETTINGS_FONT_SIZE = 8;
const MAX_SETTINGS_FONT_SIZE = 32;
const MAX_CUSTOM_FONT_FAMILY_LENGTH = 64;
const TYPOGRAPHY_DEFAULTS = {
  typographyMode: "simple" as TypographyMode,
  fontFamilySans: "",
  fontFamilyComposer: "",
  fontFamilyCode: "",
  fontFamilyTerminal: "",
  fontSizeInterface: 14,
  fontSizePrompt: 14,
  fontSizeCode: 14,
  fontSizeTerminal: 12,
  fontSmoothing: true,
  terminalFontForce: false,
};

export const DEFAULT_APP_STATE_SETTINGS: AppStateSettings = {
  theme: "dark",
  codeHighlightTheme: DEFAULT_CODE_HIGHLIGHT_THEME,
  ...TYPOGRAPHY_DEFAULTS,
  defaultEditorId: "",
  enhancedTerminalCompletion: true,
  terminalPanelHeight: 320,
};

/** Preserves explicitly unbound shortcuts as null across the JSON boundary. */
export function serializeAppStateSettings(settings: AppStateSettings): string {
  if (!settings.keybindingOverrides) return JSON.stringify(settings);

  const keybindingOverrides = Object.fromEntries(
    ACTION_IDS.filter((actionId) => actionId in settings.keybindingOverrides!).map((actionId) => [
      actionId,
      settings.keybindingOverrides![actionId] ?? null,
    ]),
  );
  return JSON.stringify({ ...settings, keybindingOverrides });
}

export function normalizeAppStateSettings(value: unknown): AppStateSettings | null {
  if (!isRecord(value)) return null;

  const theme: AppStateSettingsTheme =
    value.theme === "dark" || value.theme === "light" || value.theme === "system"
      ? value.theme
      : DEFAULT_APP_STATE_SETTINGS.theme;
  const codeHighlightTheme = isCodeHighlightThemeId(value.codeHighlightTheme)
    ? value.codeHighlightTheme
    : DEFAULT_APP_STATE_SETTINGS.codeHighlightTheme;
  const legacyFontSize =
    typeof value.fontSize === "number" &&
    Number.isInteger(value.fontSize) &&
    value.fontSize >= MIN_SETTINGS_FONT_SIZE &&
    value.fontSize <= MAX_SETTINGS_FONT_SIZE
      ? value.fontSize
      : null;
  const normalizeTypographySize = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= MIN_SETTINGS_FONT_SIZE &&
    candidate <= MAX_SETTINGS_FONT_SIZE
      ? candidate
      : fallback;
  const fontSizeInterface = normalizeTypographySize(
    value.fontSizeInterface,
    legacyFontSize ?? TYPOGRAPHY_DEFAULTS.fontSizeInterface,
  );
  const fontSizePrompt = normalizeTypographySize(
    value.fontSizePrompt,
    TYPOGRAPHY_DEFAULTS.fontSizePrompt,
  );
  const fontSizeCode = normalizeTypographySize(
    value.fontSizeCode,
    TYPOGRAPHY_DEFAULTS.fontSizeCode,
  );
  const fontSizeTerminal = normalizeTypographySize(
    value.fontSizeTerminal,
    TYPOGRAPHY_DEFAULTS.fontSizeTerminal,
  );
  const defaultEditorIdCandidate =
    typeof value.defaultEditorId === "string" ? value.defaultEditorId.trim() : "";
  const defaultEditorId = /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(defaultEditorIdCandidate)
    ? defaultEditorIdCandidate
    : DEFAULT_APP_STATE_SETTINGS.defaultEditorId;
  const enhancedTerminalCompletion =
    typeof value.enhancedTerminalCompletion === "boolean"
      ? value.enhancedTerminalCompletion
      : DEFAULT_APP_STATE_SETTINGS.enhancedTerminalCompletion;
  const terminalPanelHeight =
    typeof value.terminalPanelHeight === "number" && Number.isFinite(value.terminalPanelHeight)
      ? Math.max(
          MIN_TERMINAL_PANEL_HEIGHT,
          Math.min(MAX_TERMINAL_PANEL_HEIGHT, value.terminalPanelHeight),
        )
      : DEFAULT_APP_STATE_SETTINGS.terminalPanelHeight;

  const normalizeFontFamily = (candidate: unknown, fallback: string) => {
    if (typeof candidate !== "string") return fallback;
    return candidate
      .trim()
      .replace(/\p{Cc}/gu, "")
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_CUSTOM_FONT_FAMILY_LENGTH);
  };
  const legacyFontFamily = normalizeFontFamily(value.customFontFamily, "");
  const fontFamilySans = normalizeFontFamily(value.fontFamilySans, legacyFontFamily);
  const fontFamilyComposer = normalizeFontFamily(
    value.fontFamilyComposer,
    TYPOGRAPHY_DEFAULTS.fontFamilyComposer,
  );
  const fontFamilyCode = normalizeFontFamily(
    value.fontFamilyCode,
    TYPOGRAPHY_DEFAULTS.fontFamilyCode,
  );
  const fontFamilyTerminal = normalizeFontFamily(
    value.fontFamilyTerminal,
    TYPOGRAPHY_DEFAULTS.fontFamilyTerminal,
  );
  const typographyMode: TypographyMode =
    value.typographyMode === "advanced" || value.typographyMode === "simple"
      ? value.typographyMode
      : TYPOGRAPHY_DEFAULTS.typographyMode;
  const fontSmoothing =
    typeof value.fontSmoothing === "boolean"
      ? value.fontSmoothing
      : TYPOGRAPHY_DEFAULTS.fontSmoothing;
  const terminalFontForce =
    typeof value.terminalFontForce === "boolean"
      ? value.terminalFontForce
      : TYPOGRAPHY_DEFAULTS.terminalFontForce;
  const newProjectLocation =
    typeof value.newProjectLocation === "string" && value.newProjectLocation.trim()
      ? value.newProjectLocation.trim()
      : undefined;

  // keybindingOverrides: valid bindings survive, while null/undefined on a
  // known action preserves an explicit unbind. Everything else is dropped.
  const keybindingOverrides: Partial<Record<ActionId, KeyBinding>> = {};
  if (isRecord(value.keybindingOverrides)) {
    for (const actionId of ACTION_IDS) {
      const binding = value.keybindingOverrides[actionId];
      if (isKeyBinding(binding)) keybindingOverrides[actionId] = binding;
      else if (
        actionId in value.keybindingOverrides &&
        (binding === undefined || binding === null)
      ) {
        keybindingOverrides[actionId] = undefined;
      }
    }
  }

  return {
    theme,
    codeHighlightTheme,
    typographyMode,
    fontFamilySans,
    fontFamilyComposer,
    fontFamilyCode,
    fontFamilyTerminal,
    fontSizeInterface,
    fontSizePrompt,
    fontSizeCode,
    fontSizeTerminal,
    fontSmoothing,
    terminalFontForce: terminalFontForce && Boolean(fontFamilyTerminal),
    defaultEditorId,
    enhancedTerminalCompletion,
    terminalPanelHeight,
    ...(newProjectLocation ? { newProjectLocation } : {}),
    ...(Object.keys(keybindingOverrides).length > 0 ? { keybindingOverrides } : {}),
  };
}

export type AppStateSnapshot = {
  version: typeof APP_STATE_SNAPSHOT_VERSION;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  threads?: AppThreadRecord[];
  threadDrafts?: AssociationThreadDraftRecord[];
  threadMessages?: AppThreadMessageRecord[];
  threadRuns?: AppThreadRunRecord[];
  threadPromotionIntents?: AppThreadPromotionIntentRecord[];
  threadWork?: Record<string, ThreadWorkSnapshot>;
  settings?: AppStateSettings;
  lastThreadIdByWorkspace?: Record<string, string>;
  activeWorkspaceId: string | null;
};

export function createEmptyAppStateSnapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [],
    projects: [],
    associations: [],
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: null,
  };
}

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_QUESTION_ITEMS = 10;
const MAX_QUESTION_TEXT_BYTES = 8 * 1024;
export const MAX_SUBAGENT_TASK_TEXT_LENGTH = 12_000;
const MAX_THREAD_WORK_TEXT_BYTES = 256 * 1024;
const MAX_THREAD_WORK_QUEUE_ITEMS = 50;

export type ThreadWorkDraftSnapshot = {
  content: string;
  composerState?: string;
  attachedSkillNames: string[];
  attachments: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
};

export type ThreadWorkQueuedMessage = {
  id: string;
  content: string;
  attachments?: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  skillReadPaths?: string[];
  requiresConfirmation?: boolean;
};

export type ThreadWorkSnapshot = {
  draft?: ThreadWorkDraftSnapshot;
  queuedMessages: ThreadWorkQueuedMessage[];
};

export type ProjectRelocationResult = {
  appState: AppStateSnapshot;
};

export type ProjectRelocationRequest = {
  projectId: string;
  targetDirectory: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeProjectWorkingDirectory(value: string): string {
  const withForwardSlashes = value.replace(/\\/g, "/");
  const drive = withForwardSlashes.match(/^([A-Za-z]:)(?:\/|$)/)?.[1] ?? "";
  const isUnc = withForwardSlashes.startsWith("//");
  const isAbsolute = isUnc || withForwardSlashes.startsWith("/") || Boolean(drive);
  const segments: string[] = [];

  for (const segment of withForwardSlashes.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  const prefix = drive ? `${drive}/` : isUnc ? "//" : isAbsolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (isAbsolute ? prefix : "");
}

export function getProjectWorkingDirectoryIdentity(workingDirectory: string): string {
  const normalized = normalizeProjectWorkingDirectory(workingDirectory);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase()
    : normalized;
}

export function normalizeAppStateSnapshot(value: unknown): AppStateSnapshot | null {
  return normalizeAppStateSnapshotWithAttachmentPolicy(value, true, true);
}

// Used when persisting to disk: every queued message is force-stamped
// requiresConfirmation: true so a restarted application never auto-sends
// recovered queue items.
export function normalizeAppStateSnapshotForWrite(value: unknown): AppStateSnapshot | null {
  return normalizeAppStateSnapshotWithAttachmentPolicy(value, false, true);
}

// Used by the in-memory App State authority: preserves the live
// requiresConfirmation flag on queued messages so the Main Process can tell
// auto-continuing work (flag false) from work needing an explicit Send/Steer
// (flag true). Disk persistence still re-stamps via normalizeAppStateSnapshotForWrite.
export function normalizeAppStateSnapshotForMemory(value: unknown): AppStateSnapshot | null {
  return normalizeAppStateSnapshotWithAttachmentPolicy(value, false, false);
}

function normalizeAppStateSnapshotWithAttachmentPolicy(
  value: unknown,
  allowLegacyAttachmentKindInference: boolean,
  forceConfirmQueuedMessages: boolean,
): AppStateSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== APP_STATE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.workspaces)) return null;
  if (value.projects !== undefined && !Array.isArray(value.projects)) return null;
  if (value.associations !== undefined && !Array.isArray(value.associations)) return null;
  if (value.threads !== undefined && !Array.isArray(value.threads)) return null;
  if (value.threadDrafts !== undefined && !Array.isArray(value.threadDrafts)) return null;
  if (value.threadMessages !== undefined && !Array.isArray(value.threadMessages)) return null;
  if (value.threadRuns !== undefined && !Array.isArray(value.threadRuns)) return null;
  if (value.threadWork !== undefined && !isRecord(value.threadWork)) return null;
  if (value.threadPromotionIntents !== undefined && !Array.isArray(value.threadPromotionIntents)) {
    return null;
  }
  if (typeof value.activeWorkspaceId !== "string" && value.activeWorkspaceId !== null) {
    return null;
  }

  const workspaces: WorkspaceRecord[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const orders = new Set<number>();

  for (const workspace of value.workspaces) {
    if (!isRecord(workspace)) return null;
    if (typeof workspace.id !== "string" || workspace.id.trim() !== workspace.id || !workspace.id) {
      return null;
    }
    if (
      typeof workspace.name !== "string" ||
      workspace.name.trim() !== workspace.name ||
      !workspace.name
    ) {
      return null;
    }
    const order = workspace.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) return null;

    const normalizedName = workspace.name.toLocaleLowerCase();
    if (ids.has(workspace.id) || names.has(normalizedName) || orders.has(order)) {
      return null;
    }

    ids.add(workspace.id);
    names.add(normalizedName);
    orders.add(order);
    workspaces.push({
      id: workspace.id,
      name: workspace.name,
      order,
    });
  }

  if (orders.size > 0 && Math.max(...orders) !== orders.size - 1) return null;
  if (value.activeWorkspaceId !== null && !ids.has(value.activeWorkspaceId)) return null;

  const projects: AppProjectRecord[] = [];
  const projectIds = new Set<string>();
  const workingDirectories = new Set<string>();
  for (const project of value.projects ?? []) {
    if (!isRecord(project)) return null;
    if (typeof project.id !== "string" || project.id.trim() !== project.id || !project.id) {
      return null;
    }
    if (typeof project.name !== "string" || project.name.trim() !== project.name || !project.name) {
      return null;
    }
    if (typeof project.workingDirectory !== "string" || !project.workingDirectory) return null;

    const workingDirectory = normalizeProjectWorkingDirectory(project.workingDirectory);
    const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
    const isAbsoluteWorkingDirectory =
      workingDirectory.startsWith("/") || /^[A-Za-z]:\//.test(workingDirectory);
    if (
      !workingDirectory ||
      !isAbsoluteWorkingDirectory ||
      projectIds.has(project.id) ||
      workingDirectories.has(workingDirectoryIdentity)
    ) {
      return null;
    }

    projectIds.add(project.id);
    workingDirectories.add(workingDirectoryIdentity);
    projects.push({ id: project.id, name: project.name, workingDirectory });
  }

  const associations: WorkspaceProjectAssociationRecord[] = [];
  const associationKeys = new Set<string>();
  const associationOrders = new Map<string, Set<number>>();
  const associatedProjectIds = new Set<string>();
  for (const association of value.associations ?? []) {
    if (!isRecord(association)) return null;
    if (
      typeof association.workspaceId !== "string" ||
      !ids.has(association.workspaceId) ||
      typeof association.projectId !== "string" ||
      !projectIds.has(association.projectId)
    ) {
      return null;
    }
    if (
      association.alias !== undefined &&
      (typeof association.alias !== "string" ||
        association.alias.trim() !== association.alias ||
        !association.alias)
    ) {
      return null;
    }
    if (
      typeof association.order !== "number" ||
      !Number.isInteger(association.order) ||
      association.order < 0 ||
      !normalizePersistedProviderProfileId(association.defaultProviderProfileId) ||
      !isAgentMode(association.defaultAgentMode)
    ) {
      return null;
    }
    const key = `${association.workspaceId}\u0000${association.projectId}`;
    const orders = associationOrders.get(association.workspaceId) ?? new Set<number>();
    if (associationKeys.has(key) || orders.has(association.order)) return null;

    associationKeys.add(key);
    orders.add(association.order);
    associationOrders.set(association.workspaceId, orders);
    associatedProjectIds.add(association.projectId);
    associations.push({
      workspaceId: association.workspaceId,
      projectId: association.projectId,
      ...(association.alias ? { alias: association.alias } : {}),
      order: association.order,
      defaultProviderProfileId: normalizePersistedProviderProfileId(
        association.defaultProviderProfileId,
      )!,
      defaultAgentMode: association.defaultAgentMode,
    });
  }

  for (const orders of associationOrders.values()) {
    if (orders.size > 0 && Math.max(...orders) !== orders.size - 1) return null;
  }
  if (projects.some((project) => !associatedProjectIds.has(project.id))) return null;

  const threads: AppThreadRecord[] = [];
  const threadIds = new Set<string>();
  for (const thread of value.threads ?? []) {
    if (!isRecord(thread)) return null;
    const associationKey = `${thread.workspaceId}\u0000${thread.projectId}`;
    if (
      typeof thread.id !== "string" ||
      !thread.id ||
      thread.id.trim() !== thread.id ||
      threadIds.has(thread.id) ||
      typeof thread.workspaceId !== "string" ||
      typeof thread.projectId !== "string" ||
      !associationKeys.has(associationKey) ||
      typeof thread.title !== "string" ||
      !thread.title ||
      thread.title.trim() !== thread.title ||
      !isIsoTimestamp(thread.createdAt) ||
      !isIsoTimestamp(thread.lastActivityAt) ||
      (thread.customTitle !== undefined && typeof thread.customTitle !== "boolean") ||
      (thread.archived !== undefined && typeof thread.archived !== "boolean") ||
      (thread.pinned !== undefined && typeof thread.pinned !== "boolean") ||
      !normalizePersistedProviderProfileId(thread.providerProfileId) ||
      !isAgentMode(thread.agentMode)
    ) {
      return null;
    }
    const runChecklist = normalizeThreadRunChecklist(thread.runChecklist);
    if (thread.runChecklist !== undefined && !runChecklist) return null;

    threadIds.add(thread.id);
    threads.push({
      id: thread.id,
      workspaceId: thread.workspaceId,
      projectId: thread.projectId,
      title: thread.title,
      createdAt: thread.createdAt,
      lastActivityAt: thread.lastActivityAt,
      ...(thread.customTitle === true ? { customTitle: true } : {}),
      ...(thread.archived === true ? { archived: true } : {}),
      ...(thread.pinned === true ? { pinned: true } : {}),
      providerProfileId: normalizePersistedProviderProfileId(thread.providerProfileId)!,
      agentMode: thread.agentMode,
      ...(runChecklist ? { runChecklist } : {}),
    });
  }

  const lastThreadIdByWorkspace: Record<string, string> = {};
  const persistedLastThreadIds = isRecord(value.lastThreadIdByWorkspace)
    ? value.lastThreadIdByWorkspace
    : {};
  for (const [workspaceId, threadId] of Object.entries(persistedLastThreadIds)) {
    const thread = threads.find((item) => item.id === threadId);
    if (
      !ids.has(workspaceId) ||
      typeof threadId !== "string" ||
      !threadId ||
      !thread ||
      thread.workspaceId !== workspaceId ||
      thread.archived
    ) {
      continue;
    }
    lastThreadIdByWorkspace[workspaceId] = threadId;
  }

  const threadDrafts: AssociationThreadDraftRecord[] = [];
  const draftIds = new Set<string>();
  const draftAssociationKeys = new Set<string>();
  const reservedThreadIds = new Set(threadIds);
  for (const draft of value.threadDrafts ?? []) {
    if (!isRecord(draft)) return null;
    const associationKey = `${draft.workspaceId}\u0000${draft.projectId}`;
    if (
      typeof draft.id !== "string" ||
      !draft.id ||
      draft.id.trim() !== draft.id ||
      draftIds.has(draft.id) ||
      typeof draft.threadId !== "string" ||
      !draft.threadId ||
      draft.threadId.trim() !== draft.threadId ||
      reservedThreadIds.has(draft.threadId) ||
      typeof draft.workspaceId !== "string" ||
      typeof draft.projectId !== "string" ||
      !associationKeys.has(associationKey) ||
      draftAssociationKeys.has(associationKey) ||
      typeof draft.content !== "string" ||
      (draft.composerState !== undefined && typeof draft.composerState !== "string") ||
      !Array.isArray(draft.attachedSkillNames) ||
      draft.attachedSkillNames.some(
        (name) => typeof name !== "string" || !name || name.trim() !== name,
      ) ||
      new Set(draft.attachedSkillNames).size !== draft.attachedSkillNames.length ||
      !Array.isArray(draft.attachments) ||
      !normalizePersistedProviderProfileId(draft.providerProfileId) ||
      !isAgentMode(draft.agentMode)
    ) {
      return null;
    }
    const attachments = draft.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    draftIds.add(draft.id);
    draftAssociationKeys.add(associationKey);
    reservedThreadIds.add(draft.threadId);
    const draftLocalPathContexts = normalizeLocalPathContexts(draft.localPathContexts);
    threadDrafts.push({
      id: draft.id,
      threadId: draft.threadId,
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      content: draft.content,
      ...(draft.composerState ? { composerState: draft.composerState } : {}),
      attachedSkillNames: [...draft.attachedSkillNames],
      attachments: attachments as AttachmentMetadata[],
      ...(draftLocalPathContexts.length > 0 ? { localPathContexts: draftLocalPathContexts } : {}),
      providerProfileId: normalizePersistedProviderProfileId(draft.providerProfileId)!,
      agentMode: draft.agentMode,
    });
  }

  const threadMessages: AppThreadMessageRecord[] = [];
  const messageIds = new Set<string>();
  const messageThreadIds = new Map<string, string>();
  for (const message of value.threadMessages ?? []) {
    if (!isRecord(message)) return null;
    if (
      typeof message.id !== "string" ||
      !message.id ||
      message.id.trim() !== message.id ||
      messageIds.has(message.id) ||
      typeof message.threadId !== "string" ||
      !threadIds.has(message.threadId) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !isIsoTimestamp(message.createdAt) ||
      !Array.isArray(message.attachments) ||
      (message.runEventCount !== undefined &&
        (typeof message.runEventCount !== "number" ||
          !Number.isInteger(message.runEventCount) ||
          message.runEventCount < 0))
    ) {
      return null;
    }
    const attachments = message.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    const normalizedMessage = normalizeMessageRecord({
      ...message,
      createdAt: Date.parse(message.createdAt),
      ...(typeof message.timestamp === "string" ? { timestamp: message.timestamp } : {}),
      attachments: attachments as AttachmentMetadata[],
    } as PersistedMessage);
    if (!normalizedMessage) return null;

    messageIds.add(message.id);
    messageThreadIds.set(message.id, message.threadId);
    threadMessages.push({
      ...(normalizedMessage as unknown as AppThreadMessageRecord),
      createdAt: message.createdAt,
    });
  }

  const threadRuns: AppThreadRunRecord[] = [];
  const runIds = new Set<string>();
  for (const run of value.threadRuns ?? []) {
    if (!isRecord(run)) return null;
    if (
      typeof run.id !== "string" ||
      !run.id ||
      run.id.trim() !== run.id ||
      runIds.has(run.id) ||
      typeof run.threadId !== "string" ||
      !threadIds.has(run.threadId) ||
      typeof run.messageId !== "string" ||
      messageThreadIds.get(run.messageId) !== run.threadId ||
      (run.assistantMessageId !== undefined &&
        (typeof run.assistantMessageId !== "string" ||
          run.assistantMessageId === run.messageId ||
          messageThreadIds.get(run.assistantMessageId) !== run.threadId)) ||
      !isIsoTimestamp(run.startedAt) ||
      !normalizePersistedProviderProfileId(run.providerProfileId) ||
      !isAgentMode(run.agentMode)
    ) {
      return null;
    }
    runIds.add(run.id);
    threadRuns.push({
      id: run.id,
      threadId: run.threadId,
      messageId: run.messageId,
      ...(typeof run.assistantMessageId === "string"
        ? { assistantMessageId: run.assistantMessageId }
        : {}),
      startedAt: run.startedAt,
      providerProfileId: normalizePersistedProviderProfileId(run.providerProfileId)!,
      agentMode: run.agentMode,
    });
  }

  const threadPromotionIntents: AppThreadPromotionIntentRecord[] = [];
  const intentDraftIds = new Set<string>();
  const intentRunIds = new Set<string>();
  const intentMessageIds = new Set<string>();
  for (const intent of value.threadPromotionIntents ?? []) {
    if (!isRecord(intent)) return null;
    const draft = threadDrafts.find((item) => item.id === intent.draftId);
    if (
      typeof intent.draftId !== "string" ||
      !draft ||
      intentDraftIds.has(intent.draftId) ||
      typeof intent.threadId !== "string" ||
      intent.threadId !== draft.threadId ||
      typeof intent.workspaceId !== "string" ||
      intent.workspaceId !== draft.workspaceId ||
      typeof intent.projectId !== "string" ||
      intent.projectId !== draft.projectId ||
      typeof intent.title !== "string" ||
      !intent.title ||
      intent.title.trim() !== intent.title ||
      typeof intent.runId !== "string" ||
      !intent.runId ||
      intent.runId.trim() !== intent.runId ||
      runIds.has(intent.runId) ||
      intentRunIds.has(intent.runId) ||
      typeof intent.messageId !== "string" ||
      !intent.messageId ||
      intent.messageId.trim() !== intent.messageId ||
      messageIds.has(intent.messageId) ||
      intentMessageIds.has(intent.messageId) ||
      typeof intent.message !== "string" ||
      !Array.isArray(intent.attachments) ||
      !isIsoTimestamp(intent.startedAt) ||
      !normalizePersistedProviderProfileId(intent.providerProfileId) ||
      !isAgentMode(intent.agentMode)
    ) {
      return null;
    }
    const attachments = intent.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    intentDraftIds.add(intent.draftId);
    intentRunIds.add(intent.runId);
    intentMessageIds.add(intent.messageId);
    const intentLocalPathContexts = normalizeLocalPathContexts(intent.localPathContexts);
    threadPromotionIntents.push({
      draftId: intent.draftId,
      threadId: intent.threadId,
      workspaceId: intent.workspaceId,
      projectId: intent.projectId,
      title: intent.title,
      runId: intent.runId,
      messageId: intent.messageId,
      message: intent.message,
      attachments: attachments as AttachmentMetadata[],
      ...(intentLocalPathContexts.length > 0 ? { localPathContexts: intentLocalPathContexts } : {}),
      startedAt: intent.startedAt,
      providerProfileId: normalizePersistedProviderProfileId(intent.providerProfileId)!,
      agentMode: intent.agentMode,
    });
  }

  const threadWork = normalizeThreadWork(value.threadWork, forceConfirmQueuedMessages);
  if (value.threadWork !== undefined && !threadWork) return null;
  if (threadWork && Object.keys(threadWork).some((threadId) => !threadIds.has(threadId))) {
    return null;
  }

  // Invalid settings fall back to being omitted rather than rejecting the
  // snapshot; per-field defaults are applied by normalizeAppStateSettings.
  const settings =
    value.settings === undefined
      ? undefined
      : (normalizeAppStateSettings(value.settings) ?? undefined);

  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: workspaces.sort((left, right) => left.order - right.order),
    projects,
    associations,
    ...(value.threads !== undefined ? { threads } : {}),
    ...(value.threadDrafts !== undefined ? { threadDrafts } : {}),
    ...(value.threadMessages !== undefined ? { threadMessages } : {}),
    ...(value.threadRuns !== undefined ? { threadRuns } : {}),
    ...(value.threadPromotionIntents !== undefined ? { threadPromotionIntents } : {}),
    ...(value.threadWork !== undefined ? { threadWork: threadWork ?? {} } : {}),
    ...(settings ? { settings } : {}),
    ...(value.lastThreadIdByWorkspace !== undefined ? { lastThreadIdByWorkspace } : {}),
    activeWorkspaceId: value.activeWorkspaceId,
  };
}

export function normalizePersistedAppStateSnapshot(value: unknown): AppStateSnapshot | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.projects) || !Array.isArray(value.associations)) return null;
  if (!Array.isArray(value.threads) || !Array.isArray(value.threadDrafts)) return null;
  if (!Array.isArray(value.threadMessages) || !Array.isArray(value.threadRuns)) return null;
  if (!Array.isArray(value.threadPromotionIntents)) return null;
  return normalizeAppStateSnapshotForWrite({
    ...value,
    lastThreadIdByWorkspace: value.lastThreadIdByWorkspace ?? {},
  });
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  return new Date(value).toISOString() === value;
}

export function normalizeThreadRunChecklist(value: unknown): ThreadRunChecklist | null {
  if (!isRecord(value)) return null;
  if (typeof value.runId !== "string" || !value.runId.trim()) return null;
  const providerProfileId = normalizePersistedProviderProfileId(value.providerProfileId);
  if (!providerProfileId) return null;
  if (typeof value.expanded !== "boolean") return null;
  if (
    value.outcome !== "running" &&
    value.outcome !== "completed" &&
    value.outcome !== "failed" &&
    value.outcome !== "cancelled"
  ) {
    return null;
  }
  const entries = normalizeRunChecklistEntries(value.entries);
  if (!entries || entries.length === 0) return null;

  return {
    runId: value.runId,
    providerProfileId,
    outcome: value.outcome as RunChecklistOutcome,
    expanded: value.expanded,
    entries,
  };
}

function normalizeAttachmentMetadata(
  value: unknown,
  allowLegacyKindInference = true,
): AttachmentMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string") return null;
  if (typeof value.mimeType !== "string") return null;
  if (typeof value.size !== "number") return null;
  if (typeof value.storageKey !== "string") return null;
  if (value.sha256 !== undefined && !isValidAttachmentSha256(value.sha256)) {
    return null;
  }

  let kind: AttachmentKind;
  if (value.kind === "image" || value.kind === "file") {
    kind = value.kind;
  } else if (allowLegacyKindInference && isSupportedImageMimeType(value.mimeType)) {
    // Legacy snapshots predate `kind`; only the original image types backfill.
    kind = "image";
  } else {
    return null;
  }

  return {
    id: value.id,
    kind,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    storageKey: value.storageKey,
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
    ...(typeof value.width === "number" ? { width: value.width } : {}),
    ...(typeof value.height === "number" ? { height: value.height } : {}),
  };
}

function normalizeChangedFile(value: unknown): ChangedFile | null {
  if (!isRecord(value)) return null;
  if (typeof value.path !== "string") return null;
  if (typeof value.additions !== "number" || !Number.isFinite(value.additions)) return null;
  if (typeof value.deletions !== "number" || !Number.isFinite(value.deletions)) return null;
  if (value.binary !== undefined && typeof value.binary !== "boolean") return null;
  if (value.untracked !== undefined && typeof value.untracked !== "boolean") return null;

  const file: ChangedFile = {
    path: value.path,
    additions: value.additions,
    deletions: value.deletions,
    binary: value.binary === true,
    untracked: value.untracked === true,
  };

  if (value.omitted === true) {
    file.omitted = true;
  }

  if (typeof value.isFolder === "boolean") {
    file.isFolder = value.isFolder;
  }

  if (value.fileType === "swift" || value.fileType === "markdown" || value.fileType === "other") {
    file.fileType = value.fileType;
  }

  return file;
}

function normalizeChangedFilesSnapshot(value: unknown): ChangedFilesMessage["snapshot"] | null {
  if (!isRecord(value)) return null;
  if (typeof value.baseRevision !== "string") return null;
  if (typeof value.capturedAt !== "string") return null;
  if (typeof value.patch !== "string") return null;
  if (typeof value.truncated !== "boolean") return null;

  const patchBytes = new TextEncoder().encode(value.patch).length;
  if (patchBytes > MAX_PATCH_BYTES) return null;

  return {
    baseRevision: value.baseRevision,
    capturedAt: value.capturedAt,
    patch: value.patch,
    truncated: value.truncated,
  };
}

function normalizeQuestionPart(value: unknown): Extract<MessagePart, { type: "question" }> | null {
  if (!isRecord(value) || value.type !== "question") return null;
  if (typeof value.id !== "string" || typeof value.questionId !== "string") return null;
  if (!Array.isArray(value.questions) || value.questions.length > MAX_QUESTION_ITEMS) return null;

  const questions = value.questions.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.header !== "string" || typeof item.question !== "string") return [];
    if (
      new TextEncoder().encode(item.header).length > MAX_QUESTION_TEXT_BYTES ||
      new TextEncoder().encode(item.question).length > MAX_QUESTION_TEXT_BYTES
    ) {
      return [];
    }
    return [{ header: item.header, question: item.question }];
  });
  if (questions.length !== value.questions.length) return null;

  const validStatus =
    value.status === "pending" ||
    value.status === "answered" ||
    value.status === "skipped" ||
    value.status === "interrupted";
  if (!validStatus) return null;
  const status: Extract<MessagePart, { type: "question" }>["status"] =
    value.status === "pending"
      ? "interrupted"
      : (value.status as Extract<MessagePart, { type: "question" }>["status"]);

  let answers: Extract<MessagePart, { type: "question" }>["answers"];
  if (value.answers !== undefined) {
    if (!Array.isArray(value.answers)) return null;
    const normalized = value.answers.flatMap((item) => {
      if (!isRecord(item)) return [];
      if (
        typeof item.questionIndex !== "number" ||
        !Number.isInteger(item.questionIndex) ||
        item.questionIndex < 0 ||
        !Array.isArray(item.labels) ||
        item.labels.length > MAX_QUESTION_ITEMS ||
        item.labels.some((label) => typeof label !== "string")
      ) {
        return [];
      }
      if (
        item.customText !== undefined &&
        (typeof item.customText !== "string" ||
          new TextEncoder().encode(item.customText).length > MAX_QUESTION_TEXT_BYTES)
      ) {
        return [];
      }
      return [
        {
          questionIndex: item.questionIndex,
          labels: item.labels as string[],
          ...(typeof item.customText === "string" ? { customText: item.customText } : {}),
        },
      ];
    });
    if (normalized.length !== value.answers.length) return null;
    answers = normalized;
  }

  return {
    type: "question",
    id: value.id,
    questionId: value.questionId,
    status,
    questions,
    ...(answers ? { answers } : {}),
  };
}

function normalizeSubagentTaskPart(
  value: unknown,
): Extract<MessagePart, { type: "subagent_task" }> | null {
  if (!isRecord(value) || value.type !== "subagent_task") return null;
  if (typeof value.id !== "string" || !value.id) return null;
  const providerProfileId = normalizePersistedProviderProfileId(value.providerProfileId);
  if (!providerProfileId) return null;
  if (value.source !== "agent" && value.source !== "agent-swarm") return null;
  if (typeof value.description !== "string") return null;
  if (value.description.length > MAX_SUBAGENT_TASK_TEXT_LENGTH) return null;
  if (typeof value.background !== "boolean") return null;
  if (
    value.status !== "running" &&
    value.status !== "completed" &&
    value.status !== "failed" &&
    value.status !== "interrupted" &&
    value.status !== "detached"
  ) {
    return null;
  }
  if (
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt) ||
    value.startedAt < 0
  ) {
    return null;
  }
  if (
    value.finishedAt !== undefined &&
    (typeof value.finishedAt !== "number" ||
      !Number.isFinite(value.finishedAt) ||
      value.finishedAt < value.startedAt)
  ) {
    return null;
  }
  if (
    value.agentCount !== undefined &&
    (typeof value.agentCount !== "number" ||
      !Number.isInteger(value.agentCount) ||
      value.agentCount <= 0)
  ) {
    return null;
  }

  const optionalStrings = ["agentId", "agentType", "prompt", "summary"] as const;
  for (const key of optionalStrings) {
    if (value[key] !== undefined && typeof value[key] !== "string") return null;
  }
  if (
    (typeof value.prompt === "string" && value.prompt.length > MAX_SUBAGENT_TASK_TEXT_LENGTH) ||
    (typeof value.summary === "string" && value.summary.length > MAX_SUBAGENT_TASK_TEXT_LENGTH)
  ) {
    return null;
  }

  const status: Extract<MessagePart, { type: "subagent_task" }>["status"] =
    value.status === "running"
      ? "interrupted"
      : (value.status as Extract<MessagePart, { type: "subagent_task" }>["status"]);

  return {
    type: "subagent_task",
    id: value.id,
    providerProfileId,
    source: value.source,
    description: value.description,
    background: value.background,
    status,
    startedAt: value.startedAt,
    ...(typeof value.agentId === "string" ? { agentId: value.agentId } : {}),
    ...(typeof value.agentType === "string" ? { agentType: value.agentType } : {}),
    ...(typeof value.agentCount === "number" ? { agentCount: value.agentCount } : {}),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.finishedAt === "number" ? { finishedAt: value.finishedAt } : {}),
  };
}

function normalizeMessagePart(value: unknown): MessagePart | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "text") {
    return typeof value.content === "string" ? { type: "text", content: value.content } : null;
  }
  if (value.type === "agent_activity") {
    const item = value.item;
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.order !== "number" ||
      !Number.isInteger(item.order) ||
      item.order < 0
    ) {
      return null;
    }
    if (
      item.type === "thinking" &&
      typeof item.content === "string" &&
      (item.status === "running" || item.status === "completed" || item.status === "cancelled")
    ) {
      return {
        type: "agent_activity",
        item: {
          type: "thinking",
          id: item.id,
          order: item.order,
          content: item.content,
          status: item.status,
        },
      };
    }
    if (
      item.type === "message" &&
      typeof item.content === "string" &&
      typeof item.isFinal === "boolean"
    ) {
      return {
        type: "agent_activity",
        item: {
          type: "message",
          id: item.id,
          order: item.order,
          content: item.content,
          isFinal: item.isFinal,
        },
      };
    }
    if (
      item.type === "tool" &&
      typeof item.toolCallId === "string" &&
      typeof item.title === "string" &&
      typeof item.kind === "string" &&
      typeof item.command === "string" &&
      typeof item.filePath === "string" &&
      typeof item.input === "string" &&
      typeof item.output === "string" &&
      typeof item.error === "string" &&
      (item.status === "pending" ||
        item.status === "running" ||
        item.status === "completed" ||
        item.status === "failed" ||
        item.status === "cancelled")
    ) {
      return {
        type: "agent_activity",
        item: {
          type: "tool",
          id: item.id,
          order: item.order,
          toolCallId: item.toolCallId,
          title: item.title,
          kind: item.kind,
          command: item.command,
          filePath: item.filePath,
          input: item.input,
          output: item.output,
          error: item.error,
          status: item.status,
        },
      };
    }
    return null;
  }
  if (value.type === "reasoning") {
    if (
      typeof value.id !== "string" ||
      typeof value.content !== "string" ||
      (value.status !== "running" && value.status !== "completed" && value.status !== "cancelled")
    ) {
      return null;
    }
    return {
      type: "reasoning",
      id: value.id,
      content: value.content,
      status: value.status,
    };
  }
  if (value.type === "shell") {
    if (
      typeof value.id !== "string" ||
      typeof value.command !== "string" ||
      typeof value.output !== "string" ||
      (value.status !== "running" &&
        value.status !== "completed" &&
        value.status !== "failed" &&
        value.status !== "cancelled") ||
      (value.exitCode !== undefined &&
        value.exitCode !== null &&
        (typeof value.exitCode !== "number" || !Number.isInteger(value.exitCode)))
    ) {
      return null;
    }
    return {
      type: "shell",
      id: value.id,
      command: value.command,
      output: value.output,
      status: value.status,
      ...(value.exitCode !== undefined ? { exitCode: value.exitCode as number | null } : {}),
    };
  }
  if (value.type === "question") return normalizeQuestionPart(value);
  if (value.type === "subagent_task") return normalizeSubagentTaskPart(value);
  if (value.type === "error") {
    if (typeof value.id !== "string" || typeof value.message !== "string") return null;
    return { type: "error", id: value.id, message: value.message };
  }
  return null;
}

function normalizeMessageParts(value: unknown): MessagePart[] | undefined | null {
  if (!Array.isArray(value)) return null;

  const parts = value.map(normalizeMessagePart);
  if (parts.some((part) => part === null)) return null;
  return parts.length > 0 ? (parts as MessagePart[]) : undefined;
}

function normalizeMessageRecord(message: PersistedMessage): PersistedMessage | null {
  const record = message as PersistedMessage & {
    attachments?: unknown;
    parts?: unknown;
    localPathContexts?: unknown;
  };

  if (record.type === "changed_files") {
    const changedFilesRecord = record as ChangedFilesMessage<{ timestamp?: string }> & {
      changedFiles?: unknown;
    };
    if (!Array.isArray(changedFilesRecord.changedFiles)) return null;
    const normalizedFiles = changedFilesRecord.changedFiles.map((file) =>
      normalizeChangedFile(file),
    );
    if (normalizedFiles.some((file) => file === null)) return null;

    const normalizedSnapshot = normalizeChangedFilesSnapshot(changedFilesRecord.snapshot);
    const { snapshot: _oldSnapshot, ...recordWithoutSnapshot } = changedFilesRecord;

    const normalized: ChangedFilesMessage<{ timestamp?: string }> = {
      ...recordWithoutSnapshot,
      changedFiles: normalizedFiles as ChangedFile[],
      ...(normalizedSnapshot ? { snapshot: normalizedSnapshot } : {}),
    };

    return normalized;
  }

  const normalizedParts =
    record.parts === undefined ? undefined : normalizeMessageParts(record.parts);
  if (normalizedParts === null) return null;
  const normalizedAttachments = Array.isArray(record.attachments)
    ? record.attachments
        .map((attachment) => normalizeAttachmentMetadata(attachment))
        .filter((attachment): attachment is AttachmentMetadata => attachment !== null)
    : undefined;

  const {
    parts: _parts,
    attachments: _attachments,
    localPathContexts: _localPathContexts,
    ...rest
  } = record;
  const normalizedLocalPathContexts = normalizeLocalPathContexts(record.localPathContexts);

  return {
    ...rest,
    ...(normalizedParts ? { parts: normalizedParts } : {}),
    ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
    ...(normalizedLocalPathContexts.length > 0
      ? { localPathContexts: normalizedLocalPathContexts }
      : {}),
  } as PersistedMessage;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeThreadWorkAttachments(value: unknown): AttachmentMetadata[] | null {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_COUNT) return null;
  const attachments = value.map((item) => normalizeAttachmentMetadata(item));
  if (attachments.some((attachment) => attachment === null)) return null;
  return attachments as AttachmentMetadata[];
}

function normalizeThreadWorkDraft(value: unknown): ThreadWorkDraftSnapshot | null {
  if (!isRecord(value)) return null;
  if (typeof value.content !== "string") return null;
  if (utf8ByteLength(value.content) > MAX_THREAD_WORK_TEXT_BYTES) return null;
  if (value.composerState !== undefined && typeof value.composerState !== "string") return null;
  if (
    typeof value.composerState === "string" &&
    utf8ByteLength(value.composerState) > MAX_THREAD_WORK_TEXT_BYTES
  ) {
    return null;
  }
  if (!Array.isArray(value.attachedSkillNames)) return null;
  if (!value.attachedSkillNames.every((name) => typeof name === "string")) return null;

  const attachments = normalizeThreadWorkAttachments(value.attachments ?? []);
  if (!attachments) return null;

  const localPathContexts = normalizeLocalPathContexts(value.localPathContexts);

  return {
    content: value.content,
    ...(typeof value.composerState === "string" && value.composerState
      ? { composerState: value.composerState }
      : {}),
    attachedSkillNames: [...value.attachedSkillNames],
    attachments,
    ...(localPathContexts.length > 0 ? { localPathContexts } : {}),
  };
}

function normalizeThreadWorkQueuedMessage(
  value: unknown,
  forceConfirm: boolean,
): ThreadWorkQueuedMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.content !== "string") return null;
  if (utf8ByteLength(value.content) > MAX_THREAD_WORK_TEXT_BYTES) return null;

  const attachments =
    value.attachments === undefined ? undefined : normalizeThreadWorkAttachments(value.attachments);
  if (attachments === null) return null;

  // When forceConfirm is true (load from disk, or persisting to disk) every
  // queue item is treated as requiring an explicit Send/Steer so a restarted
  // application never auto-sends recovered queue items. When false (the
  // in-memory authority) the live flag is preserved so the Main Process can
  // distinguish auto-continuing work.
  const requiresConfirmation =
    forceConfirm || value.requiresConfirmation === true ? true : undefined;
  const localPathContexts = normalizeLocalPathContexts(value.localPathContexts);
  const skillReadPaths = value.skillReadPaths ?? [];
  if (
    !Array.isArray(skillReadPaths) ||
    skillReadPaths.length > 32 ||
    skillReadPaths.some((item) => typeof item !== "string" || !item.trim())
  ) {
    return null;
  }
  return {
    id: value.id,
    content: value.content,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(localPathContexts.length > 0 ? { localPathContexts } : {}),
    ...(skillReadPaths.length > 0 ? { skillReadPaths: [...new Set(skillReadPaths)] } : {}),
    ...(requiresConfirmation === undefined ? {} : { requiresConfirmation }),
  };
}

function normalizeThreadWork(
  value: unknown,
  forceConfirmQueuedMessages: boolean,
): Record<string, ThreadWorkSnapshot> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const threadWork: Record<string, ThreadWorkSnapshot> = {};
  for (const [threadId, entry] of Object.entries(value)) {
    if (!threadId || !isRecord(entry) || !Array.isArray(entry.queuedMessages)) return null;

    const draft = entry.draft === undefined ? null : normalizeThreadWorkDraft(entry.draft);
    if (entry.draft !== undefined && !draft) return null;
    if (entry.queuedMessages.length > MAX_THREAD_WORK_QUEUE_ITEMS) return null;
    const queuedMessages = entry.queuedMessages.map((item) =>
      normalizeThreadWorkQueuedMessage(item, forceConfirmQueuedMessages),
    );
    if (queuedMessages.some((item) => item === null)) return null;

    threadWork[threadId] = {
      ...(draft ? { draft } : {}),
      queuedMessages: queuedMessages as ThreadWorkQueuedMessage[],
    };
  }
  return threadWork;
}

export function isRecognizedLegacyWorkspaceSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version !== LEGACY_WORKSPACE_SNAPSHOT_VERSION) return false;
  if (!Array.isArray(value.projects)) return false;
  if (!Array.isArray(value.messages)) return false;
  if (typeof value.activeThreadId !== "string" && value.activeThreadId !== null) return false;

  const chats = value.chats === undefined ? [] : value.chats;
  if (!Array.isArray(chats)) return false;
  return value.projects.every((project) => isRecord(project) && Array.isArray(project.threads));
}
