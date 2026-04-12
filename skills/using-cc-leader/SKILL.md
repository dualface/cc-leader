---
name: using-cc-leader
description: "Use when the user explicitly asks to start a cc-leader workflow, run a multi-phase development plan, or says 'cc-leader'. Do not auto-activate on every session."
---

# 使用 CC Leader

这是 `cc-leader` 的 bootstrap skill。

职责：

1. 看用户请求、session state、artifact
2. 判断当前 phase
3. 在做实质动作前，路由到正确 phase skill

## 指令优先级

顺序：

1. 用户直接指令
2. 已批准 workflow artifact
3. `cc-leader` phase skill
4. 默认助手行为

用户明确 override gate，就记录并继续。

## 核心规则

在没判断 phase 前，不要写代码、计划、报告。

按状态路由：

- 没有已批准 spec -> `drafting-specs`
- spec 已批准，但没有 phase plan list -> `writing-phase-plans`
- phase plan list 已有，但缺 phase task list -> `writing-phase-tasks`
- 已有 ready 的 phase task list，且还有 phase 没执行完 -> `executing-phase-tasks`
- 某个已完成 phase 还没 review，或 final spec review 还没做 -> `reviewing-phase-results`
- 所有 phase 都 review 完，且 final spec review 通过 -> `reporting-results`

## CC 调用指南

cc-leader 通过 `cc-leader` CLI 命令操作 workflow。以下是 cc 在各阶段应调用的命令:

### 启动 workflow

```bash
cd <target-project-root>
cc-leader init --slug <project-slug>
cc-leader state:set --set spec_path=<spec-file-path>
```

### 写 spec 阶段 (drafting-specs)

cc 和用户一起写 spec, 落盘到 spec_path。spec 写好后:

```bash
cc-leader state:set --set spec_approved=true
```

### 自动推进 (spec 批准后)

```bash
cc-leader run --write-scope <allowed-write-path>
```

这会自动推进: plan -> task -> execute -> review -> report, 直到完成或需要用户介入。

### 查看状态

```bash
cc-leader state:get
cc-leader resolve-phase
```

### 手动 dispatch (高级)

```bash
cc-leader dispatch --job <job-name> [--phase-id <id>] [--write-scope <path>]
```

## Gate 规则

默认 gate：

- spec 批准前，不写 phase plan
- phase review 过前，不开下一个依赖 phase 执行
- final spec review 过前，不出最终报告

除非用户明确要求，否则不要跳 gate。

## 会话合同

追踪或推断这些字段：

- `workflow_id`
- `current_phase`
- `spec_path`
- `spec_review_path`
- `spec_review_passed`
- `spec_approved`
- `phase_plan_list_path`
- `phase_plan_review_passed`
- `phase_task_dir`
- `phase_result_dir`
- `phase_review_dir`
- `ready_phase_ids`
- `active_phase_id`
- `completed_phase_ids`
- `reviewed_phase_ids`
- `final_spec_review_path`
- `final_report_path`
- `active_job_id`
- `last_result_file_path`
- `override_log_path`
- `job_attempts`
- `current_execution_root`

如果没有结构化 state，就根据明确 approval、artifact 是否存在、最近 review 结果来推断。

## 响应模式

开工时：

1. 说当前用哪个 `cc-leader` skill
2. 说为什么
3. 按该 skill 执行

示例：

- "Using `drafting-specs`，因为现在还没有已批准 spec。"
- "Using `writing-phase-tasks`，因为已有 phase plan list，现在要按 phase 产 task list。"
- "Using `reviewing-phase-results`，因为某个 phase 刚执行完，必须对照 plan 审。"
- "Using `cc-leader run`，因为 spec 已批准，自动推进到完成。"

## 反模式

- 粗糙请求直接进 execution
- 没书面 spec 就 planning
- 上个依赖 phase 还没 review 就跑后续 phase
- final spec review 没过就宣称完成
