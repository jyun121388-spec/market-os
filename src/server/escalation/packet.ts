/**
 * Decision packets, and the rule that a gate is asked about rather than waited on.
 *
 * The failure this exists to prevent is specific and has happened: reaching a Human Gate, writing a
 * clear explanation of it, and stopping — leaving a question nobody was asked and a repository with
 * safe work still in it. A gate is a request for a decision. A request that is never sent is not a
 * request, and a session that ends beside one has converted an asynchronous question into a
 * synchronous wait.
 *
 * So the packet is the unit, not the prose. It carries exactly one decision, the options, a
 * recommended default and — the field that does the real work — what continues while the answer is
 * outstanding. A packet that cannot name independent work is usually a packet that should not have
 * been sent.
 *
 * Pure. Nothing here opens a socket, and `planTransmission` decides between posting and queueing
 * without knowing how to do either, so every branch is testable without touching a real issue.
 */

import { screenPublicComment } from "./screen";
import type { WriteCapability } from "./transport";

export type PacketType =
  | "HUMAN_GATE"
  | "SECURITY_DECISION"
  | "PRODUCT_DECISION"
  | "RELEASE_DECISION"
  | "TRUE_IDLE_DECISION";

export type Severity = "P0" | "P1" | "P2" | "POLICY";

export interface DecisionPacket {
  /** Stable across sessions. A new id for an unresolved question is a duplicate, not a reminder. */
  id: string;
  type: PacketType;
  severity: Severity;
  currentState: string;
  /** Exactly one. Two questions in one packet get one answer and the wrong one is applied. */
  decisionRequired: string;
  whyHumanDecisionRequired: string;
  options: { label: string; detail: string }[];
  recommendedDefault: string;
  impactIfDeferred: string;
  /** The independent phases that proceed regardless. Empty is a smell, and `render` says so. */
  workThatWillContinue: string[];
  /** Finding ids, tests, files, commits. */
  evidence: string[];
}

/** Renders a packet into the exact body that goes on the issue. */
export function renderPacket(packet: DecisionPacket): string {
  const options = packet.options
    .map((o, i) => `${String.fromCharCode(65 + i)}. ${o.label} — ${o.detail}`)
    .join("\n");

  return [
    `[ESCALATION][${packet.id}]`,
    "",
    "PROJECT:",
    "Market OS",
    "",
    "TYPE:",
    packet.type,
    "",
    "SEVERITY:",
    packet.severity,
    "",
    "CURRENT STATE:",
    packet.currentState,
    "",
    "DECISION REQUIRED:",
    packet.decisionRequired,
    "",
    "WHY HUMAN DECISION IS REQUIRED:",
    packet.whyHumanDecisionRequired,
    "",
    "OPTIONS:",
    options,
    "",
    "RECOMMENDED DEFAULT:",
    packet.recommendedDefault,
    "",
    "IMPACT IF DEFERRED:",
    packet.impactIfDeferred,
    "",
    "WORK THAT WILL CONTINUE:",
    packet.workThatWillContinue.length > 0
      ? packet.workThatWillContinue.map((w) => `- ${w}`).join("\n")
      : "- Nothing independent remains; this packet is the reason the loop is idle.",
    "",
    "EVIDENCE:",
    packet.evidence.map((e) => `- ${e}`).join("\n"),
  ].join("\n");
}

/**
 * Whether a packet is well-formed enough to send.
 *
 * Structure, not judgement — it cannot tell whether a decision is worth a human's time. What it can
 * tell is whether the packet asks ONE question and answers "what happens meanwhile", which are the
 * two properties that decide whether the channel stays usable.
 */
export function packetDefects(packet: DecisionPacket): string[] {
  const defects: string[] = [];
  if (packet.options.length < 2) defects.push("fewer than two options is not a decision");
  if (packet.recommendedDefault.trim().length === 0) {
    defects.push("no recommended default, so an unanswered packet has no safe fallback");
  }
  if (packet.decisionRequired.includes("?") && packet.decisionRequired.split("?").length > 2) {
    defects.push("more than one question; one answer will be applied to both");
  }
  if (packet.evidence.length === 0) {
    defects.push("no evidence, so the decision needs a manual repository investigation");
  }
  return defects;
}

export type TransmissionAction = "POST" | "QUEUE";

export type TransmissionState =
  /** Written to the durable queue and demonstrably NOT on the issue. */
  | "ESCALATION_QUEUED_NOT_TRANSMITTED"
  /** Posted AND read back. Nothing else may claim this. */
  | "ESCALATION_POSTED"
  /** Refused by the content screen. Not a transport state — a content one. */
  | "ESCALATION_BLOCKED_CONTENT";

export interface TransmissionPlan {
  action: TransmissionAction | "NONE";
  state: TransmissionState | "ALREADY_POSTED";
  /**
   * Always true except when content screening failed.
   *
   * The single most important field in this module. Whatever happens to the message, the loop
   * carries on — a transport failure is a fact about this machine's credentials, not about whether
   * there is engineering left to do.
   */
  continueWork: boolean;
  /** A state change, never an interval. Nothing improves by waiting. */
  retryCondition?: "CREDENTIAL_STATE_CHANGED";
  reason: string;
}

/**
 * Decides what to do with a composed packet, given what the transport can currently do.
 *
 * `alreadyPosted` is checked first and deliberately: the same unresolved question must keep its id
 * across sessions, so the reconciler will see it again on every run, and a planner that did not
 * check would repost it each time.
 */
export function planTransmission(
  packet: DecisionPacket,
  capability: WriteCapability,
  alreadyPosted: boolean,
): TransmissionPlan {
  if (alreadyPosted) {
    return {
      action: "NONE",
      state: "ALREADY_POSTED",
      continueWork: true,
      reason: `${packet.id} is already on the issue. An unresolved question is not re-asked.`,
    };
  }

  const findings = screenPublicComment(renderPacket(packet));
  if (findings.length > 0) {
    return {
      action: "NONE",
      state: "ESCALATION_BLOCKED_CONTENT",
      // The one case that stops this message, and it still does not stop the loop — the caller
      // minimises the packet and screens again. It is false here because the MESSAGE cannot
      // proceed, and conflating that with the project would be the error this module exists on.
      continueWork: true,
      reason:
        `Content screen refused ${packet.id}: ` +
        findings.map((f) => `line ${f.line} — ${f.reason}`).join("; "),
    };
  }

  if (capability === "WRITE_AVAILABLE") {
    return {
      action: "POST",
      // Not ESCALATION_POSTED. This plan says what to attempt; only a read-back may record that
      // it happened, because "we sent it" and "it is there" are different claims and only the
      // second means ChatGPT can see it.
      state: "ESCALATION_QUEUED_NOT_TRANSMITTED",
      continueWork: true,
      reason: `Write is available; post ${packet.id} and read it back before recording it posted.`,
    };
  }

  return {
    action: "QUEUE",
    state: "ESCALATION_QUEUED_NOT_TRANSMITTED",
    continueWork: true,
    retryCondition: "CREDENTIAL_STATE_CHANGED",
    reason:
      `No write credential (${capability}), so ${packet.id} is queued durably. ` +
      "Retry on credential state change only — retrying against an unchanged state is not a retry.",
  };
}

/**
 * The packet the stop sentinel needs before the loop may idle.
 *
 * Built from the sentinel's own numbers rather than from a summary, so it cannot claim a quieter
 * state than the one that was measured.
 */
export function trueIdlePacket(input: {
  id: string;
  completed: string[];
  remainingGates: string[];
  discoveryNote: string;
  unlockOptions: { label: string; detail: string }[];
  evidence: string[];
}): DecisionPacket {
  return {
    id: input.id,
    type: "TRUE_IDLE_DECISION",
    severity: "POLICY",
    currentState:
      `Every discovery pass returned nothing startable. Completed since the last escalation: ` +
      `${input.completed.join("; ")}. Remaining gates: ${input.remainingGates.join(", ")}.`,
    decisionRequired:
      "Which gate should be opened first to unblock further autonomous development, or should " +
      "the loop remain idle until one changes on its own?",
    whyHumanDecisionRequired:
      "Every remaining item needs a credential, a paid service, or a product decision. None can " +
      "be advanced by code, tests, docs or analysis, so no amount of further engineering changes " +
      "the answer.",
    options: input.unlockOptions,
    recommendedDefault:
      "Remain idle. No gate should be opened merely to create work, and every open gate here has " +
      "a cost or a credential behind it.",
    impactIfDeferred:
      "Nothing regresses. The repository stays green and every gated item keeps its recorded " +
      "state; the loop simply has nothing safe left to start.",
    workThatWillContinue: [],
    evidence: [input.discoveryNote, ...input.evidence],
  };
}
