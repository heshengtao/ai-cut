/**
 * 工作流开始 / 结束 / 嵌入（子工作流调用）节点的语义。
 *
 * 三件事必须只有一份实现：
 * - 签名（`data.signature`）的读写与归一化；
 * - 端口（开始节点发布输入、结束节点收集输出、调用节点映射子工作流签名）；
 * - 「这张画布能不能当工作流用」的校验（恰好一对开始 / 结束、名字唯一、
 *   必填输出都接了线、没有数据环）。
 *
 * 类型一律走 `core/board/dataTypes.ts` 的注册表：插件注册的类型和内置类型
 * 在这里完全平等，UI 的类型下拉也由 `typeChoices()` 生成。
 *
 * 纯函数（不 import Vue / store）：运行器、检查器、序列化、domain 引擎共用。
 */
import type {
  BoardEdge,
  BoardNode,
  BoardPortSpec,
  BoardPortType,
  WorkflowPortDecl,
  WorkflowSignature,
} from "@/types/board";
import { listDataTypes, isDataTypeId } from "./dataTypes";
import { t } from "@/i18n/translate";

export const WORKFLOW_START_TYPE = "workflow.start";
export const WORKFLOW_END_TYPE = "workflow.end";
export const WORKFLOW_CALL_TYPE = "workflow.call";

/** 签名的端口前缀：开始节点 `in-*` 发布出去，结束节点 `out-*` 发布结果。 */
const OUTPUT_PREFIX = "out-";

/**
 * 组框节点：只画一个框，不执行、不发布输出。
 *
 * 注意「属于 group 分类」不等于「框」：工作流开始 / 结束 / 嵌入都是 group 分类，
 * 它们会发布输出，检查器里必须能选到。
 */
export function isFrameNode(node: { type: string }): boolean {
  return node.type === "group";
}

export function isWorkflowNode(type: string): boolean {
  return (
    type === WORKFLOW_START_TYPE || type === WORKFLOW_END_TYPE || type === WORKFLOW_CALL_TYPE
  );
}

export function emptySignature(): WorkflowSignature {
  return { inputs: [], outputs: [] };
}

/** 新签名行的稳定 id（改名不移动连线）。 */
export function newDeclId(prefix: "in" | "out"): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 结果对象里的键：优先用户起的名字，其次标签，最后才是内部 id。 */
export function declKey(decl: { id: string; name?: string; label?: string }): string {
  return (decl.name || decl.label || decl.id).trim() || decl.id;
}

export function declPortId(decl: WorkflowPortDecl): string {
  return decl.id;
}

export function endOutputPortId(decl: WorkflowPortDecl): string {
  return `${OUTPUT_PREFIX}${decl.id}`;
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** 单个签名行的归一化：坏行返回 null（丢掉，不猜）。 */
export function normalizePortDecl(raw: unknown, index: number): WorkflowPortDecl | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = cleanText(item.id).trim() || newDeclId(index % 2 === 0 ? "in" : "out");
  const type = isDataTypeId(item.type) ? item.type : "any";
  const label = cleanText(item.label).trim();
  const name = cleanText(item.name).trim() || label || `field_${index + 1}`;
  const decl: WorkflowPortDecl = { id, name, label: label || name, type };
  if (item.required === true) decl.required = true;
  if (item.default !== undefined && isJsonish(item.default, 0)) decl.default = item.default;
  return decl;
}

function isJsonish(value: unknown, depth: number): boolean {
  if (depth > 3) return false;
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every((item) => isJsonish(item, depth + 1));
  if (kind === "object") {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonish(item, depth + 1),
    );
  }
  return false;
}

const MAX_DECLS = 32;

/** 签名归一化：最多 32 行，重复 id / 名字在读取时不做去重（校验负责报错）。 */
export function normalizeSignature(raw: unknown): WorkflowSignature | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { inputs?: unknown; outputs?: unknown };
  const list = (input: unknown): WorkflowPortDecl[] =>
    Array.isArray(input)
      ? input
          .slice(0, MAX_DECLS)
          .map((item, index) => normalizePortDecl(item, index))
          .filter((item): item is WorkflowPortDecl => item !== null)
      : [];
  const signature: WorkflowSignature = { inputs: list(value.inputs), outputs: list(value.outputs) };
  if (signature.inputs.length === 0 && signature.outputs.length === 0) return undefined;
  return signature;
}

/** 节点上的签名（开始节点用 inputs，结束节点用 outputs）。 */
export function signatureOf(node: BoardNode | null | undefined): WorkflowSignature {
  if (!node) return emptySignature();
  const signature = node.data.signature;
  if (!signature) return emptySignature();
  return node.type === WORKFLOW_START_TYPE
    ? { inputs: signature.inputs ?? [], outputs: [] }
    : { inputs: [], outputs: signature.outputs ?? [] };
}

/** 写回签名（只写属于这个节点的那一半，另一半保留）。 */
export function withSignature(
  node: BoardNode,
  patch: Partial<WorkflowSignature>,
): WorkflowSignature {
  const current = node.data.signature ?? emptySignature();
  return {
    inputs: patch.inputs ?? current.inputs,
    outputs: patch.outputs ?? current.outputs,
  };
}

function labelFor(decl: WorkflowPortDecl): string {
  return (decl.label || decl.name || decl.id).trim() || decl.id;
}

/** 开始节点的输出端口：每个声明的输入一个端口（一个 UI 锚点，检查器里选）。 */
export function startPorts(node: BoardNode): BoardPortSpec[] {
  return signatureOf(node).inputs.map((decl) => ({
    id: declPortId(decl),
    type: decl.type,
    labelKey: "board.port.workflowInput",
    label: labelFor(decl),
  }));
}

/** 结束节点的输入端口。 */
export function endInputs(node: BoardNode): BoardPortSpec[] {
  return signatureOf(node).outputs.map((decl) => ({
    id: declPortId(decl),
    type: decl.type,
    labelKey: "board.port.workflowOutput",
    label: labelFor(decl),
  }));
}

/** 结束节点的输出端口：把收集到的结果发布成有类型的值。 */
export function endOutputs(node: BoardNode): BoardPortSpec[] {
  return signatureOf(node).outputs.map((decl) => ({
    id: endOutputPortId(decl),
    type: decl.type,
    labelKey: "board.port.workflowOutput",
    label: labelFor(decl),
  }));
}

/** 调用节点的端口：从目标签名快照生成（`data.ports` 里存着）。 */
export function callPorts(signature: WorkflowSignature): {
  inputs: BoardPortSpec[];
  outputs: BoardPortSpec[];
} {
  return {
    inputs: signature.inputs.map((decl) => ({
      id: declPortId(decl),
      type: decl.type,
      labelKey: "board.port.workflowInput",
      label: labelFor(decl),
    })),
    outputs: signature.outputs.map((decl) => ({
      id: endOutputPortId(decl),
      type: decl.type,
      labelKey: "board.port.workflowOutput",
      label: labelFor(decl),
    })),
  };
}

/** 类型下拉的选项：内置 + 插件注册的类型，插件类型自动出现。 */
export function typeChoices(): { value: BoardPortType; label: string }[] {
  return listDataTypes().map((spec) => ({ value: spec.id, label: spec.label }));
}

/** 没接上游 / 外部没传值时的默认值。 */
export function defaultValueFor(type: BoardPortType, raw?: unknown): unknown {
  if (raw !== undefined) return raw;
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") return 0;
  if (type === "json") return null;
  if (type === "image" || type === "video" || type === "audio") return null;
  return "";
}

/** 一张画布的工作流签名（开始节点的输入 + 结束节点的输出）。 */
export interface CanvasWorkflow {
  start: BoardNode | null;
  end: BoardNode | null;
  signature: WorkflowSignature;
}

export function canvasWorkflow(nodes: readonly BoardNode[]): CanvasWorkflow {
  const starts = nodes.filter((node) => node.type === WORKFLOW_START_TYPE);
  const ends = nodes.filter((node) => node.type === WORKFLOW_END_TYPE);
  const start = starts[0] ?? null;
  const end = ends[0] ?? null;
  return {
    start,
    end,
    signature: {
      inputs: start ? signatureOf(start).inputs : [],
      outputs: end ? signatureOf(end).outputs : [],
    },
  };
}

/** 校验问题：`code` 给测试/工具用，`messageKey` + `params` 给 UI 翻译。 */
export interface WorkflowProblem {
  code: string;
  messageKey: string;
  /** i18n 插值参数（只允许字符串 / 数字，`t()` 的约定）。 */
  params?: Record<string, string | number>;
}

function hasCycle(nodes: readonly BoardNode[], edges: readonly BoardEdge[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    for (const edge of edges) {
      if (edge.source !== id || edge.kind === "pair") continue;
      if (!byId.has(edge.target)) continue;
      if (walk(edge.target)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  return nodes.some((node) => walk(node.id));
}

/**
 * 这张画布能不能发布成 API / 子工作流。
 *
 * 条件（对齐 ai-board）：恰好一个开始节点、恰好一个结束节点、成对相连、
 * 输入输出名字非空且唯一、必填输出都接了上游、没有数据环。
 */
export function workflowProblems(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const starts = nodes.filter((node) => node.type === WORKFLOW_START_TYPE);
  const ends = nodes.filter((node) => node.type === WORKFLOW_END_TYPE);
  if (starts.length === 0 && ends.length === 0) {
    // 一对都没搭：只报一条，别让「缺开始 + 缺结束」占两行。
    problems.push({
      code: "missingWorkflowNodes",
      messageKey: "board.canvas.problem.missingWorkflowNodes",
    });
  } else {
    if (starts.length === 0) {
      problems.push({ code: "missingStart", messageKey: "board.canvas.problem.missingStart" });
    }
    if (ends.length === 0) {
      problems.push({ code: "missingEnd", messageKey: "board.canvas.problem.missingEnd" });
    }
  }
  if (starts.length > 1) problems.push({ code: "multipleStart", messageKey: "board.canvas.problem.multipleStart" });
  if (ends.length > 1) problems.push({ code: "multipleEnd", messageKey: "board.canvas.problem.multipleEnd" });
  if (starts.length === 1 && ends.length === 1) {
    const pairId = starts[0]!.data.pairId;
    if (!pairId || ends[0]!.data.pairId !== pairId) {
      problems.push({ code: "pairBroken", messageKey: "board.canvas.problem.pairBroken" });
    }
  }

  const { signature } = canvasWorkflow(nodes);
  const seenInput = new Set<string>();
  for (const decl of signature.inputs) {
    const key = declKey(decl);
    if (!key) problems.push({ code: "inputNameEmpty", messageKey: "board.canvas.problem.inputNameEmpty" });
    if (seenInput.has(key)) {
      problems.push({
        code: "inputNameDuplicate",
        messageKey: "board.canvas.problem.duplicateInput",
        params: { name: key },
      });
    }
    seenInput.add(key);
    if (!isDataTypeId(decl.type)) {
      problems.push({
        code: "inputTypeUnknown",
        messageKey: "board.canvas.problem.unknownType",
        params: { name: key, type: String(decl.type) },
      });
    }
  }
  const seenOutput = new Set<string>();
  for (const decl of signature.outputs) {
    const key = declKey(decl);
    if (!key) problems.push({ code: "outputNameEmpty", messageKey: "board.canvas.problem.outputNameEmpty" });
    if (seenOutput.has(key)) {
      problems.push({
        code: "outputNameDuplicate",
        messageKey: "board.canvas.problem.duplicateOutput",
        params: { name: key },
      });
    }
    seenOutput.add(key);
    if (!isDataTypeId(decl.type)) {
      problems.push({
        code: "outputTypeUnknown",
        messageKey: "board.canvas.problem.unknownType",
        params: { name: key, type: String(decl.type) },
      });
    }
    if (decl.required && endNodeOf(ends) && !isBound(ends[0]!, decl.id, edges)) {
      problems.push({
        code: "outputUnbound",
        messageKey: "board.canvas.problem.unboundOutput",
        params: { name: labelFor(decl) },
      });
    }
  }
  if (hasCycle(nodes, edges)) {
    problems.push({ code: "cycle", messageKey: "board.canvas.problem.cycle" });
  }
  return problems;
}

function endNodeOf(ends: BoardNode[]): BoardNode | null {
  return ends[0] ?? null;
}

/** 结束节点的某个签名输入有没有接上游。 */
export function isBound(end: BoardNode, declId: string, edges: readonly BoardEdge[]): boolean {
  return edges.some((edge) => edge.target === end.id && edge.targetPort === declId);
}

/** 可发布 = 没有任何问题。 */
export function isPublishable(nodes: readonly BoardNode[], edges: readonly BoardEdge[]): boolean {
  return workflowProblems(nodes, edges).length === 0;
}

/** 问题列表翻成人类可读（UI / 工具返回都用它）。 */
export function problemTexts(problems: readonly WorkflowProblem[]): string[] {
  return problems.map((problem) => t(problem.messageKey, problem.params));
}
