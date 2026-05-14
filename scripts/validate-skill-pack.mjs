import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function rel(p) {
  return p.split(path.sep).join("/");
}

function abs(p) {
  return path.join(root, p);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(abs(file), "utf8"));
  } catch (error) {
    errors.push(`${file}: JSON 解析失败: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertFile(file) {
  assert(existsSync(abs(file)), `${file}: 文件不存在`);
}

function assertDir(dir) {
  assert(existsSync(abs(dir)) && statSync(abs(dir)).isDirectory(), `${dir}: 目录不存在`);
}

function readText(file) {
  try {
    return readFileSync(abs(file), "utf8");
  } catch {
    errors.push(`${file}: 读取失败`);
    return "";
  }
}

const pkg = readJson("package.json");
const manifest = readJson("cc-leader.manifest.json");

if (pkg && manifest) {
  assert(pkg.ccLeader?.manifest === "./cc-leader.manifest.json", "package.json: ccLeader.manifest 不正确");
  assert(pkg.scripts?.validate === "node scripts/validate-skill-pack.mjs", "package.json: validate script 缺失或不正确");
  assert(pkg.scripts?.harness === "node scripts/cc-leader-harness.mjs", "package.json: harness script 缺失或不正确");
  assert(pkg.scripts?.smoke === "node scripts/smoke-run.mjs", "package.json: smoke script 缺失或不正确");

  assertFile(manifest.bootstrapSkill.path);

  for (const phase of manifest.workflow.phaseOrder) {
    assertFile(`skills/${phase}/SKILL.md`);
  }

  for (const contractPath of [
    manifest.workflow.stateMachineContractPath,
    manifest.artifactPolicy.contractPath,
    manifest.verification.contractPath,
    manifest.retryPolicy.contractPath,
    manifest.runtime.contractPath,
    manifest.transport.resultFileContractPath,
    manifest.validation.scriptPath,
    "scripts/cc-leader-harness.mjs",
    "scripts/smoke-run.mjs",
  ]) {
    assertFile(contractPath);
  }

  assertDir(manifest.examples.directory);
  assert(manifest.transport.kind === "codex_cli", "manifest: transport.kind 必须是 codex_cli");
  assert(manifest.transport.command?.binary === "codex", "manifest: transport.command.binary 必须是 codex");
  assert(manifest.transport.command?.subcommand === "exec", "manifest: transport.command.subcommand 必须是 exec");

  for (const key of ["workflowIdPattern", "phaseIdPattern", "taskIdPattern", "jobIdPattern"]) {
    try {
      new RegExp(manifest.naming[key]);
    } catch (error) {
      errors.push(`manifest.naming.${key}: 非法正则: ${error.message}`);
    }
  }

  for (const [artifactName, artifact] of Object.entries(manifest.artifacts)) {
    assertFile(artifact.template);
    assert(typeof artifact.defaultDirectory === "string", `artifacts.${artifactName}.defaultDirectory 缺失`);
  }

  for (const [jobName, job] of Object.entries(manifest.workerJobs)) {
    assertFile(job.dispatch.promptContractPath);
    assert(job.dispatch.requiredVariables.includes("result_file_path"), `${jobName}: requiredVariables 必须包含 result_file_path`);
    assert(typeof job.timeoutSeconds === "number" && job.timeoutSeconds > 0, `${jobName}: timeoutSeconds 不合法`);
    assert(typeof job.writesCode === "boolean", `${jobName}: writesCode 必须是布尔值`);

    if (existsSync(abs(job.dispatch.promptContractPath))) {
      const promptText = readText(job.dispatch.promptContractPath);
      const placeholders = new Set(
        [...promptText.matchAll(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g)].map((m) => m[1]),
      );
      for (const requiredVar of job.dispatch.requiredVariables) {
        assert(
          placeholders.has(requiredVar),
          `${jobName}: requiredVariables 列 ${requiredVar} 但 prompt 未引用 {{${requiredVar}}}`,
        );
      }
    }
  }
}

const resultTemplate = readJson("docs/templates/worker-result-template.json");
if (resultTemplate) {
  for (const key of [
    "status",
    "job",
    "workflow_id",
    "phase_id",
    "started_at",
    "finished_at",
    "exit_code",
    "artifact_write_ok",
    "recovered_from_artifact",
    "retryable",
    "verdict",
    "outputs",
    "next_action",
    "summary",
    "blockers",
  ]) {
    assert(Object.hasOwn(resultTemplate, key), `worker-result-template.json: 缺少 ${key}`);
  }
}

for (const promptFile of [
  "docs/prompts/spec-adversarial-review.md",
  "docs/prompts/phase-plan-synthesis.md",
  "docs/prompts/phase-task-synthesis.md",
  "docs/prompts/phase-execution.md",
  "docs/prompts/phase-review.md",
  "docs/prompts/final-spec-review.md",
]) {
  const text = readText(promptFile);
  assert(text.includes("{{result_file_path}}"), `${promptFile}: 必须引用 result_file_path`);
  assert(text.includes("worker-result-template.json"), `${promptFile}: 必须引用 worker-result-template.json`);
}

const gitignore = readText(".gitignore");
assert(gitignore.includes(".cc-leader/"), ".gitignore: 缺少 .cc-leader/");

for (const exampleFile of [
  "docs/examples/minimal-todo/README.md",
  "docs/examples/minimal-todo/spec.md",
  "docs/examples/minimal-todo/spec-review.md",
  "docs/examples/minimal-todo/phase-plan-list.md",
  "docs/examples/minimal-todo/phase-task-list.md",
  "docs/examples/minimal-todo/phase-result.md",
  "docs/examples/minimal-todo/phase-review.md",
  "docs/examples/minimal-todo/final-spec-review.md",
  "docs/examples/minimal-todo/final-report.md",
  "docs/examples/minimal-todo/override-log.md",
  "docs/examples/minimal-todo/worker-result.json",
]) {
  assertFile(exampleFile);
}

const skillsDir = abs("skills");
for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  assertFile(rel(path.join("skills", entry.name, "SKILL.md")));
}

if (errors.length) {
  console.error("CC Leader 校验失败:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("CC Leader 校验通过");
