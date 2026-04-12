#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(packRoot, "cc-leader.manifest.json"), "utf8"));
const stateFileDefault = path.join(root, ".cc-leader", "session.json");

function printHelp() {
  console.log(`CC Leader Harness

命令:
  init [--workflow-id <id>] [--slug <slug>] [--state-file <path>] [--force]
  state:get [--state-file <path>]
  state:set [--state-file <path>] --set key=value [--set key=value ...]
  resolve-phase [--state-file <path>]
  report [--state-file <path>] [--final-report-path <path>]
  run [--state-file <path>] [--write-scope <path>] [--timeout-seconds <n>]
  prepare-job --job <name> [--state-file <path>] [--phase-id <id>] [--write-scope <path>] [--phase-review-path <path> ...] [--override key=value ...]
  dispatch --job <name> [--state-file <path>] [--phase-id <id>] [--write-scope <path>] [--phase-review-path <path> ...] [--override key=value ...] [--timeout-seconds <n>] [--dry-run]
`);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      i += 1;
      continue;
    }
    const key = token.slice(2);
    if (["force", "dry-run"].includes(key)) {
      args[key] = true;
      i += 1;
      continue;
    }
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      fail(`缺少参数值: --${key}`);
    }
    if (key === "set" || key === "override" || key === "phase-review-path") {
      args[key] ??= [];
      args[key].push(next);
    } else {
      args[key] = next;
    }
    i += 2;
  }
  return args;
}

function repoRel(p) {
  return path.relative(root, p).split(path.sep).join("/");
}

function abs(p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function packAbs(p) {
  return path.isAbsolute(p) ? p : path.join(packRoot, p);
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function fileExists(p) {
  return existsSync(abs(p));
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(abs(filePath), "utf8"));
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(abs(filePath)));
  writeFileSync(abs(filePath), `${JSON.stringify(value, null, 2)}\n`);
}

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateState(state) {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    fail(`state 类型错误: 期望 object，实际 ${describeType(state)}`);
  }

  const checks = [
    ["workflow_id", (value) => value === null || typeof value === "string", "string|null"],
    ["current_phase", (value) => typeof value === "string", "string"],
    ["spec_approved", (value) => typeof value === "boolean", "boolean"],
    ["spec_review_passed", (value) => typeof value === "boolean", "boolean"],
    ["phase_plan_review_passed", (value) => typeof value === "boolean", "boolean"],
    ["ready_phase_ids", (value) => Array.isArray(value), "array"],
    ["completed_phase_ids", (value) => Array.isArray(value), "array"],
    ["reviewed_phase_ids", (value) => Array.isArray(value), "array"],
    [
      "job_attempts",
      (value) => typeof value === "object" && value !== null && !Array.isArray(value),
      "object",
    ],
  ];

  for (const [field, check, expected] of checks) {
    if (!check(state[field])) {
      fail(`state 字段类型错误: ${field}, 期望 ${expected}，实际 ${describeType(state[field])}`);
    }
  }

  return state;
}

function readState(stateFile) {
  const target = abs(stateFile);
  if (!existsSync(target)) {
    return validateState(structuredClone(manifest.sessionState.initialState));
  }
  return validateState(JSON.parse(readFileSync(target, "utf8")));
}

function saveState(stateFile, state) {
  writeJsonFile(stateFile, state);
}

function parseScalar(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function applySets(target, sets = []) {
  for (const entry of sets) {
    const eq = entry.indexOf("=");
    if (eq === -1) fail(`无效 key=value: ${entry}`);
    const key = entry.slice(0, eq);
    const raw = entry.slice(eq + 1);
    target[key] = parseScalar(raw);
  }
  return target;
}

function slugify(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "workflow";
}

function timestampParts(date = new Date()) {
  const iso = date.toISOString();
  const ymd = iso.slice(0, 10).replace(/-/g, "");
  const hms = iso.slice(11, 19).replace(/:/g, "");
  return { iso, ymd, hms };
}

function generateWorkflowId(slug = "workflow") {
  const { ymd } = timestampParts();
  return `wf-${slugify(slug)}-${ymd}-${randomBytes(2).toString("hex")}`;
}

function deriveArtifactPath(artifactName, id) {
  const artifact = manifest.artifacts[artifactName];
  if (!artifact) fail(`未知 artifact: ${artifactName}`);
  return path.join(root, artifact.defaultDirectory, `${id}.md`);
}

function ensureWorkflowId(state, slug, explicitId = null) {
  if (explicitId) {
    state.workflow_id = explicitId;
    state.override_log_path ??= repoRel(deriveArtifactPath("overrideLog", state.workflow_id));
    return state.workflow_id;
  }
  if (state.workflow_id) return state.workflow_id;
  state.workflow_id = generateWorkflowId(slug);
  state.override_log_path ??= repoRel(deriveArtifactPath("overrideLog", state.workflow_id));
  return state.workflow_id;
}

function createJobId(jobName, phaseId = null) {
  const { ymd, hms } = timestampParts();
  const scope = phaseId ?? "global";
  return `job-${slugify(jobName)}-${slugify(scope)}-${ymd}t${hms}z`;
}

function parsePhaseIdsFromPlan(planPath) {
  if (!planPath || !fileExists(planPath)) return [];
  const text = readFileSync(abs(planPath), "utf8");
  const matches = [...text.matchAll(/phase-[0-9]{2}-[a-z0-9-]+/g)];
  return [...new Set(matches.map((m) => m[0]))];
}

function extractSection(filePath, heading) {
  if (!filePath || !fileExists(filePath)) return null;
  const lines = readFileSync(abs(filePath), "utf8").split("\n");
  const targetHeading = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === targetHeading);
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim() || null;
}

function readStatusFromMarkdown(filePath) {
  if (!filePath || !fileExists(filePath)) return null;
  const text = readFileSync(abs(filePath), "utf8");
  const statusLine = text.match(/^- status: ([a-z_]+)$/m);
  return statusLine?.[1] ?? null;
}

function resolvePhase(state) {
  if (!state.spec_approved || !state.spec_review_passed) return "drafting-specs";
  if (!state.phase_plan_list_path || !state.phase_plan_review_passed) return "writing-phase-plans";

  const allPhaseIds = parsePhaseIdsFromPlan(state.phase_plan_list_path);
  const pendingReview = (state.completed_phase_ids ?? []).filter(
    (phaseId) => !(state.reviewed_phase_ids ?? []).includes(phaseId),
  );
  if (pendingReview.length > 0) return "reviewing-phase-results";

  const allReviewed =
    allPhaseIds.length > 0 && allPhaseIds.every((phaseId) => (state.reviewed_phase_ids ?? []).includes(phaseId));

  if (allReviewed) {
    const finalVerdict = readStatusFromMarkdown(state.final_spec_review_path);
    if (finalVerdict !== "pass") return "reviewing-phase-results";
    if (!state.final_report_path) return "reporting-results";
    return "reporting-results";
  }

  const remainingReady = (state.ready_phase_ids ?? []).filter(
    (phaseId) => !(state.completed_phase_ids ?? []).includes(phaseId),
  );
  if (remainingReady.length > 0) return "executing-phase-tasks";

  return "writing-phase-tasks";
}

function uniq(items) {
  return [...new Set(items)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withStateLock(stateFile, fn) {
  const lockDir = `${abs(stateFile)}.lock`;
  const timeoutAt = Date.now() + 30000;
  let clearedStaleLock = false;

  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!clearedStaleLock) {
        try {
          const ageMs = Date.now() - statSync(lockDir).mtimeMs;
          if (ageMs > 5 * 60 * 1000) {
            console.warn("warn: State lock 已超 5 分钟, 疑似残留, 自动清理");
            rmSync(lockDir, { recursive: true, force: true });
            clearedStaleLock = true;
            continue;
          }
        } catch {
          // ignore stat/rm race and fall back to normal wait loop
        }
      }
      if (Date.now() > timeoutAt) {
        fail(`获取 state lock 超时: ${stateFile}`);
      }
      await sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function readMarkdownField(filePath, field) {
  if (!existsSync(abs(filePath))) return null;
  const text = readFileSync(abs(filePath), "utf8");
  const pattern = new RegExp(`^- ${field}: (.+)$`, "m");
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function captureFileSnapshot(filePath) {
  const target = abs(filePath);
  if (!existsSync(target)) {
    return { exists: false, size: -1, mtimeMs: -1 };
  }
  const stat = statSync(target);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function didFileChangeSince(snapshot, filePath) {
  const next = captureFileSnapshot(filePath);
  if (!snapshot.exists && next.exists) return true;
  if (snapshot.exists !== next.exists) return true;
  return snapshot.size !== next.size || snapshot.mtimeMs !== next.mtimeMs;
}

function toRepoRelativeIfInsideRoot(target) {
  const absolute = abs(target);
  if (!absolute.startsWith(root)) return absolute;
  return repoRel(absolute);
}

function resolvePhaseArtifactPath(dirPath, phaseId, suffix) {
  const candidates = [];

  if (dirPath) {
    const baseDir = abs(dirPath);
    candidates.push(path.join(baseDir, `${phaseId}.md`));
    candidates.push(path.join(baseDir, `${phaseId}-${suffix}.md`));
  }

  const artifactName = suffix === "result" ? "phaseResult" : "phaseReview";
  candidates.push(abs(deriveArtifactPath(artifactName, phaseId)));

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? null;
}

function selectNextJob(phase, state) {
  const allPhaseIds = parsePhaseIdsFromPlan(state.phase_plan_list_path);
  const readyPhaseIds = new Set(state.ready_phase_ids ?? []);
  const completedPhaseIds = new Set(state.completed_phase_ids ?? []);
  const reviewedPhaseIds = new Set(state.reviewed_phase_ids ?? []);

  if (phase === "drafting-specs" && state.spec_approved && !state.spec_review_passed) {
    return { jobName: "specAdversarialReview" };
  }

  if (phase === "writing-phase-plans") {
    return { jobName: "phasePlanSynthesis" };
  }

  if (phase === "writing-phase-tasks") {
    const phaseId = allPhaseIds.find((id) => !readyPhaseIds.has(id));
    return phaseId ? { jobName: "phaseTaskSynthesis", phaseId } : null;
  }

  if (phase === "executing-phase-tasks") {
    const phaseId = allPhaseIds.find((id) => readyPhaseIds.has(id) && !completedPhaseIds.has(id));
    return phaseId ? { jobName: "phaseExecution", phaseId } : null;
  }

  if (phase === "reviewing-phase-results") {
    const phaseId = allPhaseIds.find((id) => completedPhaseIds.has(id) && !reviewedPhaseIds.has(id));
    if (phaseId) {
      return { jobName: "phaseReview", phaseId };
    }

    const allReviewed =
      allPhaseIds.length > 0 && allPhaseIds.every((id) => reviewedPhaseIds.has(id));
    if (!allReviewed || readStatusFromMarkdown(state.final_spec_review_path) === "pass") {
      return null;
    }

    return {
      jobName: "finalSpecReview",
      phaseReviewPaths: allPhaseIds
        .filter((id) => reviewedPhaseIds.has(id))
        .map((id) => resolvePhaseArtifactPath(state.phase_review_dir, id, "review")),
    };
  }

  return null;
}

function buildRunDispatchArgs(runArgs, selection) {
  const dispatchArgs = {};

  if (runArgs["timeout-seconds"] != null) {
    dispatchArgs["timeout-seconds"] = runArgs["timeout-seconds"];
  }

  if (selection.phaseId) {
    dispatchArgs["phase-id"] = selection.phaseId;
  }

  if (selection.jobName === "phaseExecution" && runArgs["write-scope"]) {
    dispatchArgs["write-scope"] = runArgs["write-scope"];
  }

  if (selection.jobName === "finalSpecReview") {
    dispatchArgs["phase-review-path"] = selection.phaseReviewPaths;
  }

  return dispatchArgs;
}

function buildJobContext(jobName, state, args) {
  const workflowId = ensureWorkflowId(state, args.slug ?? path.basename(root), args["workflow-id"] ?? null);
  const phaseId = args["phase-id"] ?? null;
  const job = manifest.workerJobs[jobName];
  if (!job) fail(`未知 job: ${jobName}`);

  const jobId = createJobId(jobName, phaseId);
  const runDir = path.join(root, manifest.runtime.runRootDirectory, workflowId, jobId);
  const promptFile = path.join(runDir, "prompt.md");
  const stdoutLog = path.join(runDir, "stdout.jsonl");
  const stderrLog = path.join(runDir, "stderr.log");
  const resultFile = path.join(runDir, "result.json");

  const derived = {
    repo_root: root,
    workflow_id: workflowId,
    job_id: jobId,
    result_file_path: resultFile,
  };

  const specPath = args["spec-path"] ?? state.spec_path ?? deriveArtifactPath("spec", workflowId);
  const specReviewPath =
    args["spec-review-path"] ?? state.spec_review_path ?? deriveArtifactPath("specReview", workflowId);
  const phasePlanListPath =
    args["phase-plan-list-path"] ?? state.phase_plan_list_path ?? deriveArtifactPath("phasePlanList", workflowId);
  const finalSpecReviewPath =
    args["final-spec-review-path"] ??
    state.final_spec_review_path ??
    deriveArtifactPath("finalSpecReview", workflowId);

  if (jobName === "specAdversarialReview") {
    Object.assign(derived, {
      spec_path: abs(specPath),
      spec_review_path: abs(specReviewPath),
      previous_review_path: existsSync(abs(specReviewPath)) ? abs(specReviewPath) : "(无上轮 review)",
    });
  }

  if (jobName === "phasePlanSynthesis") {
    Object.assign(derived, {
      spec_path: abs(specPath),
      phase_plan_list_path: abs(phasePlanListPath),
    });
  }

  if (jobName === "phaseTaskSynthesis") {
    if (!phaseId) fail("phaseTaskSynthesis 需要 --phase-id");
    Object.assign(derived, {
      phase_id: phaseId,
      phase_plan_list_path: abs(phasePlanListPath),
      phase_task_list_path: abs(
        args["phase-task-list-path"] ?? deriveArtifactPath("phaseTaskList", phaseId),
      ),
    });
  }

  if (jobName === "phaseExecution") {
    if (!phaseId) fail("phaseExecution 需要 --phase-id");
    if (!args["write-scope"]) fail("phaseExecution 需要 --write-scope");
    Object.assign(derived, {
      phase_id: phaseId,
      phase_task_list_path: abs(
        args["phase-task-list-path"] ?? deriveArtifactPath("phaseTaskList", phaseId),
      ),
      phase_result_path: abs(args["phase-result-path"] ?? deriveArtifactPath("phaseResult", phaseId)),
      write_scope: args["write-scope"],
    });
  }

  if (jobName === "phaseReview") {
    if (!phaseId) fail("phaseReview 需要 --phase-id");
    Object.assign(derived, {
      phase_id: phaseId,
      phase_plan_list_path: abs(phasePlanListPath),
      phase_task_list_path: abs(
        args["phase-task-list-path"] ?? deriveArtifactPath("phaseTaskList", phaseId),
      ),
      phase_result_path: abs(args["phase-result-path"] ?? deriveArtifactPath("phaseResult", phaseId)),
      phase_review_path: abs(args["phase-review-path-output"] ?? deriveArtifactPath("phaseReview", phaseId)),
    });
  }

  if (jobName === "finalSpecReview") {
    const reviewPaths =
      args["phase-review-path"]?.map((p) => `  - \`${abs(p)}\``).join("\n") ??
      uniq((state.reviewed_phase_ids ?? []).map((phase) => `  - \`${abs(deriveArtifactPath("phaseReview", phase))}\``)).join("\n");
    Object.assign(derived, {
      spec_path: abs(specPath),
      phase_plan_list_path: abs(phasePlanListPath),
      phase_review_paths: reviewPaths || "  - <none>",
      final_spec_review_path: abs(finalSpecReviewPath),
    });
  }

  applySets(derived, args.override);

  const required = job.dispatch.requiredVariables;
  for (const key of required) {
    if (derived[key] == null || derived[key] === "") {
      fail(`${jobName}: 缺少必需变量 ${key}`);
    }
  }

  return {
    jobName,
    jobId,
    phaseId,
    workflowId,
    runDir,
    promptFile,
    stdoutLog,
    stderrLog,
    resultFile,
    variables: derived,
  };
}

function renderPrompt(promptPath, variables) {
  let text = readFileSync(packAbs(promptPath), "utf8");
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${key}}}`, String(value));
  }
  const unresolved = text.match(/{{[^}]+}}/g);
  if (unresolved) {
    fail(`prompt 仍有未替换变量: ${unresolved.join(", ")}`);
  }
  return text;
}

function ensureOutputDirectories(jobContext) {
  ensureDir(jobContext.runDir);
  for (const key of [
    "result_file_path",
    "spec_review_path",
    "phase_plan_list_path",
    "phase_task_list_path",
    "phase_result_path",
    "phase_review_path",
    "final_spec_review_path",
  ]) {
    if (jobContext.variables[key]) {
      ensureDir(path.dirname(abs(jobContext.variables[key])));
    }
  }
}

function updateStateFromResult(state, jobContext, result) {
  state.last_result_file_path = repoRel(jobContext.resultFile);
  state.active_job_id = null;

  if (result.job === "specAdversarialReview") {
    state.spec_review_path = toRepoRelativeIfInsideRoot(jobContext.variables.spec_review_path);
    state.spec_review_passed = result.verdict === "pass";
  }

  if (result.job === "phasePlanSynthesis") {
    state.phase_plan_list_path = toRepoRelativeIfInsideRoot(jobContext.variables.phase_plan_list_path);
    state.phase_plan_review_passed = result.verdict === "pass";
  }

  if (result.job === "phaseTaskSynthesis" && result.verdict === "pass") {
    state.phase_task_dir = repoRel(path.dirname(abs(jobContext.variables.phase_task_list_path)));
    state.ready_phase_ids = uniq([...(state.ready_phase_ids ?? []), jobContext.phaseId]);
  }

  if (result.job === "phaseExecution") {
    state.phase_result_dir = repoRel(path.dirname(abs(jobContext.variables.phase_result_path)));
    state.active_phase_id = null;
    state.current_execution_root = null;
    if (result.verdict === "complete") {
      state.completed_phase_ids = uniq([...(state.completed_phase_ids ?? []), jobContext.phaseId]);
    }
  }

  if (result.job === "phaseReview") {
    state.phase_review_dir = repoRel(path.dirname(abs(jobContext.variables.phase_review_path)));
    if (result.verdict === "pass") {
      state.reviewed_phase_ids = uniq([...(state.reviewed_phase_ids ?? []), jobContext.phaseId]);
    } else {
      state.reviewed_phase_ids = (state.reviewed_phase_ids ?? []).filter((phaseId) => phaseId !== jobContext.phaseId);
      state.completed_phase_ids = (state.completed_phase_ids ?? []).filter((phaseId) => phaseId !== jobContext.phaseId);
      state.ready_phase_ids = uniq([...(state.ready_phase_ids ?? []), jobContext.phaseId]);
      if (result.next_action === "reopen_execution") {
        state.active_phase_id = jobContext.phaseId;
        state.current_phase = "executing-phase-tasks";
        return state;
      }
      if (result.next_action === "rewrite_task_list") {
        state.active_phase_id = null;
        state.current_phase = "writing-phase-tasks";
        return state;
      }
    }
  }

  if (result.job === "finalSpecReview") {
    if (result.verdict === "pass") {
      state.final_spec_review_path = toRepoRelativeIfInsideRoot(jobContext.variables.final_spec_review_path);
    } else if (result.next_action === "reopen_smallest_failing_phase") {
      state.current_phase = "reviewing-phase-results";
      return state;
    }
  }

  state.current_phase = resolvePhase(state);
  return state;
}

function getRecoveryConfig(jobName, jobContext) {
  return {
    specAdversarialReview: {
      artifact: "specReview",
      path: jobContext.variables.spec_review_path,
      verdictField: "status",
      nextAction: (verdict) => (verdict === "pass" ? "wait_for_user_spec_approval" : "revise_spec_with_user"),
    },
    phasePlanSynthesis: {
      artifact: "phasePlanList",
      path: jobContext.variables.phase_plan_list_path,
      verdictField: "self_review_verdict",
      nextAction: (verdict) => (verdict === "pass" ? "dispatch_phase_task_synthesis" : "revise_spec_with_user"),
    },
    phaseTaskSynthesis: {
      artifact: "phaseTaskList",
      path: jobContext.variables.phase_task_list_path,
      verdictField: "self_review_verdict",
      nextAction: (verdict) => (verdict === "pass" ? "mark_phase_ready" : "revise_phase_plan"),
    },
    phaseExecution: {
      artifact: "phaseResult",
      path: jobContext.variables.phase_result_path,
      verdictField: "execution_status",
      nextAction: (verdict) => (verdict === "complete" ? "dispatch_phase_review" : "wait_for_cc_intervention"),
      normalizeVerdict: (value) => (value === "complete" ? "complete" : null),
    },
    phaseReview: {
      artifact: "phaseReview",
      path: jobContext.variables.phase_review_path,
      verdictField: "status",
      nextAction: (verdict) => (verdict === "pass" ? "proceed_to_next_phase" : "reopen_execution"),
    },
    finalSpecReview: {
      artifact: "finalSpecReview",
      path: jobContext.variables.final_spec_review_path,
      verdictField: "status",
      nextAction: (verdict) => (verdict === "pass" ? "proceed_to_final_report" : "reopen_smallest_failing_phase"),
    },
  }[jobName];
}

function parseChangedArtifactsFromPhaseResult(filePath) {
  const target = abs(filePath);
  if (!existsSync(target)) return [];
  const lines = readFileSync(target, "utf8").split("\n");
  const out = [];
  let collecting = false;

  for (const line of lines) {
    if (line.startsWith("- changed_files_or_artifacts:")) {
      collecting = true;
      continue;
    }
    if (collecting && line.startsWith("- ")) {
      collecting = false;
    }
    if (collecting) {
      const match = line.match(/^\s+-\s+(.+)$/);
      if (match) out.push(abs(match[1].trim()));
    }
  }

  return uniq(out);
}

function synthesizeResultFromArtifact(jobName, jobContext, run, beforeSnapshot) {
  const config = getRecoveryConfig(jobName, jobContext);
  if (!config?.path || !existsSync(config.path)) return null;
  if (beforeSnapshot && !didFileChangeSince(beforeSnapshot, config.path)) return null;

  const rawVerdict = readMarkdownField(config.path, config.verdictField);
  const verdict = config.normalizeVerdict ? config.normalizeVerdict(rawVerdict) : rawVerdict;
  if (!verdict || verdict.includes("|")) return null;

  const outputs = [
    {
      artifact: config.artifact,
      path: abs(config.path),
    },
  ];

  if (jobName === "phaseExecution") {
    for (const changedPath of parseChangedArtifactsFromPhaseResult(config.path)) {
      outputs.push({
        artifact: "changedArtifact",
        path: changedPath,
      });
    }
  }

  const { iso } = timestampParts();
  const result = {
    status: "done",
    job: jobName,
    workflow_id: jobContext.workflowId,
    phase_id: jobContext.phaseId ?? null,
    started_at: iso,
    finished_at: iso,
    exit_code: run?.exitCode ?? 0,
    artifact_write_ok: true,
    recovered_from_artifact: true,
    retryable: false,
    verdict,
    outputs,
    next_action: config.nextAction(verdict),
    summary: `Recovered result from ${config.artifact} artifact after worker exited without result.json.`,
    blockers: [],
  };

  writeJsonFile(jobContext.resultFile, result);
  return result;
}

async function runCodex(jobContext, promptContent, timeoutSeconds) {
  ensureOutputDirectories(jobContext);
  writeFileSync(jobContext.promptFile, `${promptContent}\n`);

  return new Promise((resolve) => {
    const stdoutStream = createWriteStream(jobContext.stdoutLog);
    const stderrStream = createWriteStream(jobContext.stderrLog);
    let settled = false;
    const child = spawn(
      manifest.transport.command.binary,
      [
        manifest.transport.command.subcommand,
        "--json",
        manifest.transport.command.approvalBypassFlag,
        promptContent,
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutSeconds * 1000);

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      stdoutStream.end();
      stderrStream.end();
      resolve({ exitCode: 127, error: error.message });
    });

    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      stdoutStream.end();
      stderrStream.end();
      resolve({ exitCode: code ?? 1, error: null });
    });
  });
}

function createRollbackAnchor(jobContext) {
  const tagName = `pre-${jobContext.jobId}`;
  const result = spawnSync("git", ["tag", tagName], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status === 0) return;

  const detail =
    result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    `git tag 退出码 ${result.status ?? "unknown"}`;
  console.warn(`warn: 创建 rollback tag 失败 (${tagName}): ${detail}`);
}

async function executeReportCommand(stateFile, args) {
  const state = await withStateLock(stateFile, async () => {
    const next = readState(stateFile);
    if (!next.workflow_id) fail("report 需要 workflow_id");
    if (!next.spec_path || !next.phase_plan_list_path || !next.final_spec_review_path) {
      fail("report 需要 spec_path、phase_plan_list_path、final_spec_review_path");
    }
    if (readStatusFromMarkdown(next.final_spec_review_path) !== "pass") {
      fail("report 需要 final spec review 为 pass");
    }
    const allPhaseIds = parsePhaseIdsFromPlan(next.phase_plan_list_path);
    const missingReviewed = allPhaseIds.filter(
      (phaseId) => !(next.reviewed_phase_ids ?? []).includes(phaseId),
    );
    if (missingReviewed.length > 0) {
      fail(`report 前仍有未通过 review 的 phase: ${missingReviewed.join(", ")}`);
    }
    if (resolvePhase(next) !== "reporting-results") {
      fail(`report 只允许在 reporting-results 阶段执行，当前是 ${resolvePhase(next)}`);
    }

    const finalReportPath =
      args["final-report-path"] ?? next.final_report_path ?? deriveArtifactPath("finalReport", next.workflow_id);
    const originalGoal = extractSection(next.spec_path, "目标") ?? `见 ${next.spec_path}`;
    const phaseLines = allPhaseIds.length
      ? allPhaseIds.map((phaseId) => {
        const phaseResultPath = resolvePhaseArtifactPath(next.phase_result_dir, phaseId, "result");
        const phaseSummary = extractSection(phaseResultPath, "阶段摘要");
        if (!phaseSummary) {
          return `### ${phaseId}\n\n- 阶段摘要缺失`;
        }
        return `### ${phaseId}\n\n${phaseSummary}`;
      }).join("\n\n")
      : "- none";
    const finalReviewConclusion =
      extractSection(next.final_spec_review_path, "结论") ?? "- final spec review pass";
    const report = `# 最终报告: ${next.workflow_id}

## 工作流摘要

- spec_path: ${next.spec_path}
- phase_plan_list_path: ${next.phase_plan_list_path}
- final_spec_review_path: ${next.final_spec_review_path}
- completion_status: complete

## 原始目标

${originalGoal}

## 分 Phase 摘要

${phaseLines}

## 验证证据

- 见 phase result 与 phase review artifact

## 审查结果

${finalReviewConclusion}

## 剩余风险

- none

## 最终结论

- spec_satisfied: yes
- next_recommended_action: none

## Override 摘要

- none
`;
    ensureDir(path.dirname(abs(finalReportPath)));
    writeFileSync(abs(finalReportPath), report);
    next.final_report_path = toRepoRelativeIfInsideRoot(finalReportPath);
    next.current_phase = resolvePhase(next);
    saveState(stateFile, next);
    return next;
  });

  return {
    final_report_path: state.final_report_path,
    current_phase: state.current_phase,
    state,
  };
}

async function executeDispatchJob(stateFile, jobName, args) {
  const state = readState(stateFile);
  let jobContext = buildJobContext(jobName, state, args);
  const promptPath = manifest.workerJobs[jobName].dispatch.promptContractPath;
  const timeoutSeconds =
    args["timeout-seconds"] != null
      ? Number(args["timeout-seconds"])
      : manifest.workerJobs[jobName].timeoutSeconds;

  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    fail("timeout-seconds 必须是正数");
  }

  let run = null;
  let result = null;
  let transportFailure = null;
  const maxTransportRetries = manifest.retryPolicy?.maxTransportRetriesPerJob ?? 0;

  for (let attempt = 1; attempt <= maxTransportRetries + 1; attempt += 1) {
    if (attempt > 1) {
      await sleep(1100);
      jobContext = buildJobContext(jobName, readState(stateFile), args);
    }

    await withStateLock(stateFile, async () => {
      const attemptState = readState(stateFile);
      attemptState.active_job_id = jobContext.jobId;
      attemptState.last_result_file_path = repoRel(jobContext.resultFile);
      if (jobContext.phaseId && jobName === "phaseExecution") {
        attemptState.active_phase_id = jobContext.phaseId;
        attemptState.current_execution_root = ".";
      }
      attemptState.job_attempts ??= {};
      attemptState.job_attempts[jobContext.jobId] = attempt;
      saveState(stateFile, attemptState);
    });

    const currentPrompt = renderPrompt(promptPath, jobContext.variables);
    const recoveryConfig = getRecoveryConfig(jobName, jobContext);
    const beforeSnapshot = recoveryConfig?.path ? captureFileSnapshot(recoveryConfig.path) : null;
    if (manifest.workerJobs[jobName].writesCode) {
      createRollbackAnchor(jobContext);
    }
    run = await runCodex(jobContext, currentPrompt, timeoutSeconds);

    if (existsSync(jobContext.resultFile)) {
      result = readJsonFile(jobContext.resultFile);
      transportFailure = null;
      break;
    }

    result = synthesizeResultFromArtifact(jobName, jobContext, run, beforeSnapshot);
    if (result) {
      transportFailure = null;
      break;
    }

    transportFailure = {
      status: "transport_failed",
      job: jobName,
      job_id: jobContext.jobId,
      exit_code: run.exitCode,
      stderr_log: repoRel(jobContext.stderrLog),
      stdout_log: repoRel(jobContext.stdoutLog),
      result_file: repoRel(jobContext.resultFile),
      error: run.error,
      attempt,
      attempts_allowed: maxTransportRetries + 1,
    };
  }

  if (!result) {
    return {
      ok: false,
      transportFailure,
    };
  }

  const expectedOutputs = Array.isArray(result.outputs) ? result.outputs : [];
  for (const output of expectedOutputs) {
    if (!existsSync(output.path)) {
      fail(`结果文件声明输出不存在: ${output.path}`);
    }
  }

  const nextState = await withStateLock(stateFile, async () => {
    const next = updateStateFromResult(readState(stateFile), jobContext, result);
    saveState(stateFile, next);
    return next;
  });

  return {
    ok: true,
    exit_code: run?.exitCode ?? 1,
    result,
    state: nextState,
    run_dir: repoRel(jobContext.runDir),
    stdout_log: repoRel(jobContext.stdoutLog),
    stderr_log: repoRel(jobContext.stderrLog),
  };
}

async function executeRunCommand(stateFile, args) {
  const reviseCounts = {};
  let step = 0;

  while (true) {
    const state = readState(stateFile);
    const phase = resolvePhase(state);

    if (phase === "drafting-specs" && !state.spec_approved) {
      return {
        stopped: true,
        reason: "spec 未批准, 需要用户操作",
        phase,
        state,
      };
    }

    if (phase === "reporting-results") {
      const report = await executeReportCommand(stateFile, args);
      return {
        stopped: false,
        reason: "已完成",
        phase: "reporting-results",
        state: report.state,
      };
    }

    const selection = selectNextJob(phase, state);
    if (!selection) {
      return {
        stopped: true,
        reason: "无法确定下一个 job",
        phase,
        state,
      };
    }

    if (manifest.workerJobs[selection.jobName].writesCode && !args["write-scope"]) {
      return {
        stopped: true,
        reason: "phaseExecution 需要 --write-scope, 需要用户操作",
        phase,
        job: selection.jobName,
        phase_id: selection.phaseId ?? null,
        state,
      };
    }

    const dispatchResult = await executeDispatchJob(stateFile, selection.jobName, buildRunDispatchArgs(args, selection));
    if (!dispatchResult.ok) {
      return {
        stopped: true,
        reason: "dispatch transport failed",
        phase,
        job: selection.jobName,
        phase_id: selection.phaseId ?? null,
        transport_failure: dispatchResult.transportFailure,
        state: readState(stateFile),
      };
    }

    step += 1;
    console.log(JSON.stringify({
      step,
      job: selection.jobName,
      verdict: dispatchResult.result.verdict ?? null,
      phase,
    }));

    const result = dispatchResult.result;
    const nextState = dispatchResult.state;

    if (result.verdict === "revise") {
      reviseCounts[selection.jobName] = (reviseCounts[selection.jobName] ?? 0) + 1;
    } else {
      reviseCounts[selection.jobName] = 0;
    }

    if (result.status === "blocked") {
      return {
        stopped: true,
        reason: "worker blocked",
        phase,
        result,
        state: nextState,
      };
    }

    const needUserDecision =
      (selection.jobName === "specAdversarialReview" && result.verdict === "revise") ||
      (selection.jobName === "phaseReview" && result.verdict === "fail") ||
      (selection.jobName === "finalSpecReview" && result.verdict === "fail") ||
      (result.verdict === "revise" && (reviseCounts[selection.jobName] ?? 0) >= 2);

    if (needUserDecision) {
      return {
        stopped: true,
        reason: "需要用户决策",
        phase,
        result,
        state: nextState,
      };
    }

    const autoRetryRevise =
      (selection.jobName === "phasePlanSynthesis" || selection.jobName === "phaseTaskSynthesis") &&
      result.verdict === "revise" &&
      (reviseCounts[selection.jobName] ?? 0) < 2;

    if (autoRetryRevise) {
      continue;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const stateFile = args["state-file"] ?? stateFileDefault;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "init") {
    const state = await withStateLock(stateFile, async () => {
      const next = structuredClone(manifest.sessionState.initialState);
      ensureWorkflowId(next, args.slug ?? path.basename(root), args["workflow-id"] ?? null);
      if (!args.force && existsSync(abs(stateFile))) {
        fail(`state 已存在: ${stateFile}。如要覆盖，加 --force`);
      }
      next.current_phase = resolvePhase(next);
      saveState(stateFile, next);
      return next;
    });
    console.log(JSON.stringify({ stateFile: repoRel(abs(stateFile)), state }, null, 2));
    return;
  }

  if (command === "state:get") {
    console.log(JSON.stringify(readState(stateFile), null, 2));
    return;
  }

  if (command === "state:set") {
    const state = await withStateLock(stateFile, async () => {
      const next = readState(stateFile);
      applySets(next, args.set ?? []);
      next.current_phase = resolvePhase(next);
      saveState(stateFile, next);
      return next;
    });
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (command === "resolve-phase") {
    const state = readState(stateFile);
    console.log(resolvePhase(state));
    return;
  }

  if (command === "report") {
    const report = await executeReportCommand(stateFile, args);
    console.log(JSON.stringify({
      final_report_path: report.final_report_path,
      current_phase: report.current_phase,
    }, null, 2));
    return;
  }

  if (command === "run") {
    const summary = await executeRunCommand(stateFile, args);
    console.log(JSON.stringify(summary));
    return;
  }

  if (command !== "prepare-job" && command !== "dispatch") {
    fail(`未知命令: ${command}`);
  }

  const jobName = args.job;
  if (!jobName) fail("缺少 --job");

  const state = readState(stateFile);
  let jobContext = buildJobContext(jobName, state, args);
  const promptPath = manifest.workerJobs[jobName].dispatch.promptContractPath;
  const promptContent = renderPrompt(promptPath, jobContext.variables);

  if (command === "prepare-job" || args["dry-run"]) {
    ensureOutputDirectories(jobContext);
    writeFileSync(jobContext.promptFile, `${promptContent}\n`);
    console.log(JSON.stringify({
      mode: command === "prepare-job" ? "prepare-job" : "dry-run",
      job: jobName,
      workflow_id: jobContext.workflowId,
      job_id: jobContext.jobId,
      run_dir: repoRel(jobContext.runDir),
      prompt_file: repoRel(jobContext.promptFile),
      result_file: repoRel(jobContext.resultFile),
      variables: Object.fromEntries(
        Object.entries(jobContext.variables).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
      ),
    }, null, 2));
    return;
  }

  const dispatchResult = await executeDispatchJob(stateFile, jobName, args);
  if (!dispatchResult.ok) {
    fail(JSON.stringify(dispatchResult.transportFailure, null, 2));
  }
  console.log(JSON.stringify({
    exit_code: dispatchResult.exit_code,
    result: dispatchResult.result,
    state: dispatchResult.state,
    run_dir: dispatchResult.run_dir,
    stdout_log: dispatchResult.stdout_log,
    stderr_log: dispatchResult.stderr_log,
  }, null, 2));
}

main().catch((error) => {
  fail(error.stack || error.message);
});
