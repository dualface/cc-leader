import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const harness = path.join(root, "scripts", "cc-leader-harness.mjs");
const exampleDir = path.join(root, "docs", "examples", "minimal-todo");
const exampleWorkflowId = "wf-minimal-todo-20260412-ab12";
const examplePhaseId = "phase-01-core-todo";

function fail(message, extra = null) {
  console.error(message);
  if (extra) {
    console.error(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
  }
  process.exit(1);
}

function slugify(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "smoke";
}

function nowParts(date = new Date()) {
  const iso = date.toISOString();
  return {
    iso,
    ymd: iso.slice(0, 10).replace(/-/g, ""),
  };
}

function workflowId() {
  const { ymd } = nowParts();
  return `wf-smoke-run-${ymd}-${randomBytes(2).toString("hex")}`;
}

function abs(p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(readFileSync(abs(file), "utf8"));
}

function writeText(file, text) {
  ensureDir(path.dirname(abs(file)));
  writeFileSync(abs(file), text);
}

function uniq(items) {
  return [...new Set(items)];
}

function runNode(args, opts = {}) {
  const result = spawnSync("node", [harness, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
    ...opts,
  });

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";

  if (result.status !== 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(stderr || stdout);
    } catch {
      parsed = stderr || stdout;
    }
    fail(`命令失败: node scripts/cc-leader-harness.mjs ${args.join(" ")}`, parsed);
  }

  if (!stdout) return null;
  return JSON.parse(stdout);
}

function buildPaths(workflow) {
  const base = path.join(root, ".cc-leader", "smoke", workflow);
  return {
    base,
    stateFile: path.join(base, "session.json"),
    artifactDir: path.join(base, "artifacts"),
    outputDir: path.join(base, "outputs"),
    spec: path.join(base, "artifacts", "spec.md"),
    specReview: path.join(base, "artifacts", "spec-review.md"),
    phasePlan: path.join(base, "artifacts", "phase-plan-list.md"),
    phaseResult: (phaseId) => path.join(base, "artifacts", `${phaseId}-result.md`),
    phaseReview: (phaseId) => path.join(base, "artifacts", `${phaseId}-review.md`),
    phaseTask: (phaseId) => path.join(base, "artifacts", `${phaseId}-tasks.md`),
    finalSpecReview: path.join(base, "artifacts", "final-spec-review.md"),
    finalReport: path.join(base, "artifacts", "final-report.md"),
    outputNote: path.join(base, "outputs", "harness-smoke-note.md"),
  };
}

function specText(workflow, paths) {
  return `# 规格说明: smoke-run-doc-flow

## 状态

- workflow_id: ${workflow}
- status: in_review
- owner: cc
- latest_review: none

## 目标

在 \`.cc-leader/smoke/\` 下完成一条真实 smoke 链路，产出 \`${relative(paths.outputNote)}\`，并把 workflow 推到 \`reporting-results\`。

## 非目标

- 不改 \`scripts/\` 代码
- 不改 \`skills/\` 或合同文档
- 不改仓库业务文件
- 不做生产级调度能力

## 约束

- 业务 artifact 只允许写入 \`${relative(paths.base)}\`
- transport 运行文件允许写入 \`.cc-leader/runs/<workflow-id>/<job-id>/\`
- 目标文档必须位于 \`${relative(paths.outputDir)}\`
- 必须复用现有 \`cc-leader\` harness 命令和合同
- worker 当前只支持 \`codex-cli\`

## 成功标准

- \`${relative(paths.outputNote)}\` 存在
- \`${relative(paths.finalReport)}\` 存在
- workflow 必须按这个 job 顺序推进：
  - \`specAdversarialReview\`
  - \`phasePlanSynthesis\`
  - \`phaseTaskSynthesis\`
  - \`phaseExecution\`
  - \`phaseReview\`
  - \`finalSpecReview\`
  - \`report\`
- job 责任固定，不允许自由解释：
  - \`specAdversarialReview\` 只负责 \`${relative(paths.specReview)}\`
  - \`phasePlanSynthesis\` 只负责 \`${relative(paths.phasePlan)}\`
  - \`phaseTaskSynthesis\` 只负责 \`${relative(paths.phaseTask("phase-01-write-smoke-note"))}\`
  - \`phaseExecution\` 只负责业务交付物 \`${relative(paths.outputNote)}\` 和 \`${relative(paths.phaseResult("phase-01-write-smoke-note"))}\`
  - \`phaseReview\` 只负责 \`${relative(paths.phaseReview("phase-01-write-smoke-note"))}\`
  - \`finalSpecReview\` 只负责 \`${relative(paths.finalSpecReview)}\`，并写回 \`final_spec_review_path\`
  - \`report\` 只负责 \`${relative(paths.finalReport)}\`，并写回 \`final_report_path\`
- phase id 固定为 \`phase-01-write-smoke-note\`
- \`harness-smoke-note.md\` 必须写清这 6 步：
  - \`init\`
  - \`state:set\` 写入 \`spec_path\`
  - \`prepare-job\`
  - \`dispatch\`
  - 查看 \`result.json\`
  - 查看更新后的 session state
- \`harness-smoke-note.md\` 必须把 \`resolve-phase\` 作为可选诊断步骤单独说明
- \`harness-smoke-note.md\` 必须明确 run 路径模式：
  - \`.cc-leader/runs/<workflow-id>/<job-id>/\`
  - \`prompt.md\`
  - \`stdout.jsonl\`
  - \`stderr.log\`
  - \`result.json\`
- \`harness-smoke-note.md\` 必须写清 smoke 通过判定：
  - 对需要成功推进 workflow 的 job，\`result.json\` 必须存在
  - 对需要成功推进 workflow 的 job，\`status = done\`
  - 对需要成功推进 workflow 的 job，\`verdict\` 必须分别为：
    - \`specAdversarialReview\`: \`pass\`
    - \`phasePlanSynthesis\`: \`pass\`
    - \`phaseTaskSynthesis\`: \`pass\`
    - \`phaseExecution\`: \`complete\`
    - \`phaseReview\`: \`pass\`
    - \`finalSpecReview\`: \`pass\`
  - \`outputs\` 中声明的 artifact 真实存在
- 若任一步不满足通过矩阵，smoke 立即停止，不允许“继续收集更多 artifact 后再判断”
- \`harness-smoke-note.md\` 必须说明 smoke 结束后，\`${relative(paths.stateFile)}\` 必须满足：
  - \`current_phase = reporting-results\`
  - \`final_spec_review_path\` 已写入
  - \`final_report_path\` 已写入
- \`harness-smoke-note.md\` 必须说明 session state 文件位置是 \`${relative(paths.stateFile)}\`
- \`harness-smoke-note.md\` 必须说明 smoke 结束后，至少要检查这些 state key：
  - \`workflow_id\`
  - \`current_phase\`
  - \`spec_path\`
  - \`last_result_file_path\`
  - \`final_spec_review_path\`
  - \`final_report_path\`
- \`harness-smoke-note.md\` 必须写清 smoke 失败判定：
  - worker 退出但 \`result.json\` 不存在
  - 关键 job 的 \`status != done\`
  - 关键 job 的 \`verdict\` 不符合上面的通过矩阵
  - \`outputs\` 指向的文件不存在
  - 任一步未达通过矩阵就停止 workflow
- \`harness-smoke-note.md\` 必须引用：
  - \`docs/harness-example.md\`
  - \`docs/transport-contract.md\`
  - \`docs/runtime-contract.md\`
  - \`docs/state-machine.md\`
- \`harness-smoke-note.md\` 必须说明 canonical source 是：
  - 优先级 1: \`cc-leader.manifest.json\`
  - 优先级 2: \`scripts/cc-leader-harness.mjs\`
  - 优先级 3: \`docs/runtime-contract.md\`
  - 优先级 4: \`docs/harness-example.md\`
  - 如果低优先级文档和高优先级来源冲突，以高优先级来源为准
- 本次 smoke 需要的最小命令面以 \`scripts/cc-leader-harness.mjs\` 为准，不再自行发明新命令
- \`final-report.md\` 只需要汇总：
  - 原始目标
  - phase 完成情况
  - 最终结论
  - 剩余风险
  - override 摘要
- \`report\` 之前 workflow 必须已经满足：
  - \`reviewed_phase_ids\` 覆盖全部 phase
  - \`final_spec_review_path\` 已存在且 verdict 为 \`pass\`

## 选定方案

用单 phase 的文档型 workflow。唯一 phase 是 \`phase-01-write-smoke-note\`。

该 phase 的入口条件：

- spec review pass
- spec approved

该 phase 的退出条件：

- \`phaseExecution\` verdict = \`complete\`
- \`phaseReview\` verdict = \`pass\`

final 阶段退出条件：

- \`finalSpecReview\` verdict = \`pass\`
- \`report\` 已写出 \`${relative(paths.finalReport)}\`

## 架构与边界

- 只新增一个输出文档
- workflow artifact 全部写到 \`${relative(paths.artifactDir)}\`
- transport 文件全部写到 \`.cc-leader/runs/<workflow-id>/<job-id>/\`
- state 文件固定在 \`${relative(paths.stateFile)}\`
- 文档里的命令和路径必须与当前 \`scripts/cc-leader-harness.mjs\` 行为一致

## Phase 假设

- 这项工作足够小，只需要 1 个 phase
- execution 的业务 write scope 可以收紧到 \`${relative(paths.base)}\`

## 测试与验证预期

- 用 \`test -f ${relative(paths.outputNote)}\`
- 用 \`test -f ${relative(paths.finalReport)}\`
- 用 \`rg\` 检查关键命令、关键路径模式、关键合同链接
- 用 \`rg\` 检查文档包含 \`result.json\`、\`stdout.jsonl\`、\`stderr.log\`
- 用 \`rg\` 检查文档包含通过/失败判定
- 用 \`rg\` 检查 state 文件包含 \`final_report_path\`
- 用 \`rg\` 检查文档包含上述关键 state key 名称

## 开放问题

- none

## 审查历史

- none

## 批准

- spec_review_verdict: revise
- user_approved: no

## Override 记录

- none
`;
}

function relative(target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function stateSetArgs(stateFile, entries) {
  const args = ["state:set", "--state-file", relative(stateFile)];
  for (const [key, value] of Object.entries(entries)) {
    args.push("--set", `${key}=${JSON.stringify(value)}`);
  }
  return args;
}

function dispatchArgs(stateFile, job, extra = []) {
  return ["dispatch", "--state-file", relative(stateFile), "--job", job, ...extra];
}

function prepareArgs(stateFile, job, extra = []) {
  return ["prepare-job", "--state-file", relative(stateFile), "--job", job, ...extra];
}

function firstPhaseId(planPath) {
  const text = readFileSync(planPath, "utf8");
  const match = text.match(/phase-[0-9]{2}-[a-z0-9-]+/);
  if (!match) fail(`phase plan 里没找到 phase id: ${planPath}`);
  return match[0];
}

function markSpecApproved(paths) {
  const original = readFileSync(paths.spec, "utf8");
  const next = original
    .replace("- status: in_review", "- status: approved")
    .replace("- latest_review: none", `- latest_review: ${relative(paths.specReview)}`)
    .replace("- spec_review_verdict: revise", "- spec_review_verdict: pass")
    .replace("- user_approved: no", "- user_approved: yes")
    .replace("## 审查历史\n\n- none", `## 审查历史\n\n- ${new Date().toISOString().slice(0, 10)}: smoke spec review pass`);
  writeText(paths.spec, next);
}

function replaceAllText(text, replacements) {
  let next = text;
  for (const [from, to] of replacements) {
    next = next.replaceAll(from, to);
  }
  return next;
}

function writeExampleArtifact(exampleName, targetPath, replacements = []) {
  const sourcePath = path.join(exampleDir, exampleName);
  const text = readFileSync(sourcePath, "utf8");
  writeText(targetPath, replaceAllText(text, replacements));
}

function smokeNoteText(workflow, paths, phaseId, dryRun) {
  return `# Harness Smoke Note

## 目标

- workflow_id: ${workflow}
- phase_id: ${phaseId}
- output_note: ${relative(paths.outputNote)}

## 主流程

1. ` + "`init`" + ` 初始化 session state，文件位置是 ` + `\`${relative(paths.stateFile)}\`` + `。
2. ` + "`state:set`" + ` 写入 ` + "`spec_path`" + ` 和 override 路径。
3. 用 ` + "`prepare-job`" + ` 为每个 job 生成 prompt，运行目录模式固定为 ` + "`" + `.cc-leader/runs/<workflow-id>/<job-id>/` + "`" + `。
4. 执行 ` + "`dispatch`" + `；本次 smoke ${dryRun ? "用 dry-run 绕过 codex，直接写固定 artifact 和 result.json。" : "走真实 codex 调用。"}
5. 查看 run 目录里的 ` + "`result.json`" + `，同时确认 ` + "`prompt.md`" + `、` + "`stdout.jsonl`" + `、` + "`stderr.log`" + ` 存在。
6. 查看更新后的 session state，重点检查 ` + "`workflow_id`" + `、` + "`current_phase`" + `、` + "`spec_path`" + `、` + "`last_result_file_path`" + `、` + "`final_spec_review_path`" + `、` + "`final_report_path`" + `。

## 可选诊断

- ` + "`resolve-phase`" + ` 可单独用于判断当前 phase。

## 通过判定

- 关键 job 的 ` + "`result.json`" + ` 必须存在。
- 关键 job 的 ` + "`status`" + ` 必须是 ` + "`done`" + `。
- verdict 矩阵必须满足：
  - ` + "`specAdversarialReview`" + ` = ` + "`pass`" + `
  - ` + "`phasePlanSynthesis`" + ` = ` + "`pass`" + `
  - ` + "`phaseTaskSynthesis`" + ` = ` + "`pass`" + `
  - ` + "`phaseExecution`" + ` = ` + "`complete`" + `
  - ` + "`phaseReview`" + ` = ` + "`pass`" + `
  - ` + "`finalSpecReview`" + ` = ` + "`pass`" + `
- ` + "`outputs`" + ` 里声明的 artifact 必须真实存在。
- 任一步不满足通过矩阵，smoke 立即停止。

## 失败判定

- worker 退出但 ` + "`result.json`" + ` 不存在。
- 关键 job 的 ` + "`status != done`" + `。
- 关键 job 的 ` + "`verdict`" + ` 不符合通过矩阵。
- ` + "`outputs`" + ` 指向的文件不存在。

## 结束要求

- ` + `\`${relative(paths.stateFile)}\`` + ` 中 ` + "`current_phase`" + ` 必须是 ` + "`reporting-results`" + `。
- ` + "`final_spec_review_path`" + ` 和 ` + "`final_report_path`" + ` 必须已写入。
- canonical source 优先级：
  - ` + "`cc-leader.manifest.json`" + `
  - ` + "`scripts/cc-leader-harness.mjs`" + `
  - ` + "`docs/runtime-contract.md`" + `
  - ` + "`docs/harness-example.md`" + `
`;
}

function ensureOutputsExist(outputs) {
  for (const output of outputs) {
    if (!existsSync(output.path)) {
      fail(`dry-run 输出不存在: ${output.path}`);
    }
  }
}

function buildDryRunResult(job, workflow, phaseId, verdict, outputs, nextAction, summary) {
  const now = new Date().toISOString();
  return {
    status: "done",
    job,
    workflow_id: workflow,
    phase_id: phaseId,
    started_at: now,
    finished_at: now,
    exit_code: 0,
    artifact_write_ok: true,
    retryable: false,
    verdict,
    outputs,
    next_action: nextAction,
    summary,
    blockers: [],
  };
}

function runDryDispatch(stateFile, job, extra, context) {
  const prepared = runNode(prepareArgs(stateFile, job, extra));
  const state = readJson(stateFile);
  const workflow = state.workflow_id;
  const phaseId = context.phaseId ?? null;
  const runDir = abs(prepared.run_dir);
  const promptFile = abs(prepared.prompt_file);
  const resultFile = abs(prepared.result_file);
  const stdoutLog = path.join(runDir, "stdout.jsonl");
  const stderrLog = path.join(runDir, "stderr.log");

  ensureDir(runDir);
  if (!existsSync(promptFile)) {
    fail(`prepare-job 未生成 prompt: ${prepared.prompt_file}`);
  }
  writeText(stdoutLog, "");
  writeText(stderrLog, "");

  let outputs = [];
  let patch = {
    active_job_id: null,
    last_result_file_path: relative(resultFile),
  };
  let result = null;

  if (job === "specAdversarialReview") {
    writeExampleArtifact("spec-review.md", prepared.variables.spec_review_path, [
      [exampleWorkflowId, workflow],
      ["docs/examples/minimal-todo/spec.md", relative(context.paths.spec)],
    ]);
    outputs = [
      { artifact: "specReview", path: abs(prepared.variables.spec_review_path) },
    ];
    patch = {
      ...patch,
      spec_review_path: relative(prepared.variables.spec_review_path),
      spec_review_passed: true,
    };
    result = buildDryRunResult(job, workflow, null, "pass", outputs, "wait_for_user_spec_approval", "dry-run spec review 通过");
  } else if (job === "phasePlanSynthesis") {
    writeExampleArtifact("phase-plan-list.md", prepared.variables.phase_plan_list_path, [
      [exampleWorkflowId, workflow],
      [examplePhaseId, context.phaseId],
      ["docs/examples/minimal-todo/spec.md", relative(context.paths.spec)],
    ]);
    outputs = [
      { artifact: "phasePlanList", path: abs(prepared.variables.phase_plan_list_path) },
    ];
    patch = {
      ...patch,
      phase_plan_list_path: relative(prepared.variables.phase_plan_list_path),
      phase_plan_review_passed: true,
    };
    result = buildDryRunResult(job, workflow, null, "pass", outputs, "dispatch_phase_task_synthesis", "dry-run phase plan 通过");
  } else if (job === "phaseTaskSynthesis") {
    writeExampleArtifact("phase-task-list.md", prepared.variables.phase_task_list_path, [
      [exampleWorkflowId, workflow],
      [examplePhaseId, context.phaseId],
      ["docs/examples/minimal-todo/phase-plan-list.md", relative(context.paths.phasePlan)],
    ]);
    outputs = [
      { artifact: "phaseTaskList", path: abs(prepared.variables.phase_task_list_path) },
    ];
    patch = {
      ...patch,
      phase_task_dir: relative(path.dirname(prepared.variables.phase_task_list_path)),
      ready_phase_ids: uniq([...(state.ready_phase_ids ?? []), context.phaseId]),
    };
    result = buildDryRunResult(job, workflow, phaseId, "pass", outputs, "mark_phase_ready", "dry-run phase task 通过");
  } else if (job === "phaseExecution") {
    writeExampleArtifact("phase-result.md", prepared.variables.phase_result_path, [
      [exampleWorkflowId, workflow],
      [examplePhaseId, context.phaseId],
      ["docs/examples/minimal-todo/phase-task-list.md", relative(context.phaseTaskPath)],
    ]);
    writeText(context.paths.outputNote, smokeNoteText(workflow, context.paths, context.phaseId, true));
    outputs = [
      { artifact: "phaseResult", path: abs(prepared.variables.phase_result_path) },
      { artifact: "changedArtifact", path: abs(context.paths.outputNote) },
    ];
    patch = {
      ...patch,
      phase_result_dir: relative(path.dirname(prepared.variables.phase_result_path)),
      active_phase_id: null,
      current_execution_root: null,
      completed_phase_ids: uniq([...(state.completed_phase_ids ?? []), context.phaseId]),
    };
    result = buildDryRunResult(job, workflow, phaseId, "complete", outputs, "dispatch_phase_review", "dry-run phase execution 完成");
  } else if (job === "phaseReview") {
    writeExampleArtifact("phase-review.md", prepared.variables.phase_review_path, [
      [exampleWorkflowId, workflow],
      [examplePhaseId, context.phaseId],
      ["docs/examples/minimal-todo/phase-plan-list.md", relative(context.paths.phasePlan)],
      ["docs/examples/minimal-todo/phase-task-list.md", relative(context.phaseTaskPath)],
      ["docs/examples/minimal-todo/phase-result.md", relative(context.phaseResultPath)],
    ]);
    outputs = [
      { artifact: "phaseReview", path: abs(prepared.variables.phase_review_path) },
    ];
    patch = {
      ...patch,
      phase_review_dir: relative(path.dirname(prepared.variables.phase_review_path)),
      reviewed_phase_ids: uniq([...(state.reviewed_phase_ids ?? []), context.phaseId]),
    };
    result = buildDryRunResult(job, workflow, phaseId, "pass", outputs, "proceed_to_next_phase", "dry-run phase review 通过");
  } else if (job === "finalSpecReview") {
    writeExampleArtifact("final-spec-review.md", prepared.variables.final_spec_review_path, [
      [exampleWorkflowId, workflow],
      ["docs/examples/minimal-todo/spec.md", relative(context.paths.spec)],
      ["docs/examples/minimal-todo/phase-plan-list.md", relative(context.paths.phasePlan)],
      ["docs/examples/minimal-todo/phase-review.md", relative(context.phaseReviewPath)],
    ]);
    outputs = [
      { artifact: "finalSpecReview", path: abs(prepared.variables.final_spec_review_path) },
    ];
    patch = {
      ...patch,
      final_spec_review_path: relative(prepared.variables.final_spec_review_path),
    };
    result = buildDryRunResult(job, workflow, null, "pass", outputs, "proceed_to_final_report", "dry-run final spec review 通过");
  } else {
    fail(`dry-run 不支持的 job: ${job}`);
  }

  ensureOutputsExist(outputs);
  writeText(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  const nextState = runNode(stateSetArgs(stateFile, patch));

  return {
    exit_code: 0,
    result,
    state: nextState,
    run_dir: relative(runDir),
    stdout_log: relative(stdoutLog),
    stderr_log: relative(stderrLog),
  };
}

function main() {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const workflow = workflowId();
  const paths = buildPaths(workflow);
  const targetPhaseId = "phase-01-write-smoke-note";

  ensureDir(paths.base);
  ensureDir(paths.artifactDir);
  ensureDir(paths.outputDir);

  writeText(paths.spec, specText(workflow, paths));

  runNode(["init", "--state-file", relative(paths.stateFile), "--workflow-id", workflow, "--force"]);
  runNode(stateSetArgs(paths.stateFile, {
    spec_path: relative(paths.spec),
    override_log_path: relative(path.join(paths.artifactDir, "override-log.md")),
  }));

  const specReviewRun = dryRun
    ? runDryDispatch(paths.stateFile, "specAdversarialReview", [
      "--spec-review-path", relative(paths.specReview),
    ], { paths })
    : runNode(dispatchArgs(paths.stateFile, "specAdversarialReview", [
      "--spec-review-path", relative(paths.specReview),
      "--timeout-seconds", "120",
    ]));
  if (specReviewRun.result.verdict !== "pass") {
    fail("spec review 未通过", specReviewRun);
  }

  markSpecApproved(paths);
  runNode(stateSetArgs(paths.stateFile, {
    spec_review_passed: true,
    spec_approved: true,
    spec_review_path: relative(paths.specReview),
  }));

  const phasePlanRun = dryRun
    ? runDryDispatch(paths.stateFile, "phasePlanSynthesis", [
      "--phase-plan-list-path", relative(paths.phasePlan),
    ], { paths, phaseId: targetPhaseId })
    : runNode(dispatchArgs(paths.stateFile, "phasePlanSynthesis", [
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--timeout-seconds", "120",
    ]));
  if (phasePlanRun.result.verdict !== "pass") {
    fail("phase plan 未通过", phasePlanRun);
  }

  runNode(stateSetArgs(paths.stateFile, {
    phase_plan_list_path: relative(paths.phasePlan),
    phase_plan_review_passed: true,
  }));

  const phaseId = firstPhaseId(paths.phasePlan);
  const phaseTaskPath = paths.phaseTask(phaseId);
  const phaseResultPath = paths.phaseResult(phaseId);
  const phaseReviewPath = paths.phaseReview(phaseId);

  const phaseTaskRun = dryRun
    ? runDryDispatch(paths.stateFile, "phaseTaskSynthesis", [
      "--phase-id", phaseId,
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-task-list-path", relative(phaseTaskPath),
    ], { paths, phaseId, phaseTaskPath, phaseResultPath, phaseReviewPath })
    : runNode(dispatchArgs(paths.stateFile, "phaseTaskSynthesis", [
      "--phase-id", phaseId,
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-task-list-path", relative(phaseTaskPath),
      "--timeout-seconds", "120",
    ]));
  if (phaseTaskRun.result.verdict !== "pass") {
    fail("phase task 未通过", phaseTaskRun);
  }

  const phaseExecRun = dryRun
    ? runDryDispatch(paths.stateFile, "phaseExecution", [
      "--phase-id", phaseId,
      "--phase-task-list-path", relative(phaseTaskPath),
      "--phase-result-path", relative(phaseResultPath),
      "--write-scope", relative(paths.base),
    ], { paths, phaseId, phaseTaskPath, phaseResultPath, phaseReviewPath })
    : runNode(dispatchArgs(paths.stateFile, "phaseExecution", [
      "--phase-id", phaseId,
      "--phase-task-list-path", relative(phaseTaskPath),
      "--phase-result-path", relative(phaseResultPath),
      "--write-scope", relative(paths.base),
      "--timeout-seconds", "240",
    ]));
  if (phaseExecRun.result.verdict !== "complete") {
    fail("phase execution 未完成", phaseExecRun);
  }

  const phaseReviewRun = dryRun
    ? runDryDispatch(paths.stateFile, "phaseReview", [
      "--phase-id", phaseId,
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-task-list-path", relative(phaseTaskPath),
      "--phase-result-path", relative(phaseResultPath),
      "--phase-review-path-output", relative(phaseReviewPath),
    ], { paths, phaseId, phaseTaskPath, phaseResultPath, phaseReviewPath })
    : runNode(dispatchArgs(paths.stateFile, "phaseReview", [
      "--phase-id", phaseId,
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-task-list-path", relative(phaseTaskPath),
      "--phase-result-path", relative(phaseResultPath),
      "--phase-review-path-output", relative(phaseReviewPath),
      "--timeout-seconds", "120",
    ]));
  if (phaseReviewRun.result.verdict !== "pass") {
    fail("phase review 未通过", phaseReviewRun);
  }

  const finalSpecReviewRun = dryRun
    ? runDryDispatch(paths.stateFile, "finalSpecReview", [
      "--spec-path", relative(paths.spec),
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-review-path", relative(phaseReviewPath),
      "--final-spec-review-path", relative(paths.finalSpecReview),
    ], { paths, phaseId, phaseTaskPath, phaseResultPath, phaseReviewPath })
    : runNode(dispatchArgs(paths.stateFile, "finalSpecReview", [
      "--spec-path", relative(paths.spec),
      "--phase-plan-list-path", relative(paths.phasePlan),
      "--phase-review-path", relative(phaseReviewPath),
      "--final-spec-review-path", relative(paths.finalSpecReview),
      "--timeout-seconds", "120",
    ]));
  if (finalSpecReviewRun.result.verdict !== "pass") {
    fail("final spec review 未通过", finalSpecReviewRun);
  }

  runNode(stateSetArgs(paths.stateFile, {
    final_spec_review_path: relative(paths.finalSpecReview),
  }));
  runNode(["report", "--state-file", relative(paths.stateFile), "--final-report-path", relative(paths.finalReport)]);

  if (!existsSync(paths.outputNote)) {
    fail(`缺少输出文档: ${relative(paths.outputNote)}`);
  }
  if (!existsSync(paths.finalReport)) {
    fail(`缺少最终报告: ${relative(paths.finalReport)}`);
  }

  const finalState = readJson(paths.stateFile);
  console.log(JSON.stringify({
    workflow_id: workflow,
    state_file: relative(paths.stateFile),
    spec_review: relative(paths.specReview),
    phase_plan: relative(paths.phasePlan),
    phase_task: relative(phaseTaskPath),
    phase_result: relative(phaseResultPath),
    phase_review: relative(phaseReviewPath),
    final_spec_review: relative(paths.finalSpecReview),
    final_report: relative(paths.finalReport),
    output_note: relative(paths.outputNote),
    final_phase: finalState.current_phase,
    dry_run: dryRun,
    note: dryRun ? "(dry-run: 未调用 codex, 使用固定 artifact)" : undefined,
  }, null, 2));
}

main();
