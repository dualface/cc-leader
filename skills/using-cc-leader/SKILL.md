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

### Worktree 规则 (强制)

cc-leader workflow 的所有写动作 (spec / plan / task / execute / review / report) 必须在 git worktree 中进行，禁止直接污染主工作树。

- 路径约定：worktree 放在**项目根目录**的 `worktrees/` 子目录下，路径形如 `worktrees/<worktree-name>`
- worktree 命名按"任务簇"取名 (例如 `worktrees/auth-overhaul`、`worktrees/billing-q2`)，**不**绑死单个 workflow slug
- **一个 worktree 可承载多个 spec / workflow**：复杂任务常拆成多个 spec 串/并行推进，它们应共用同一 worktree，避免分支爆炸和反复 rebase
  - 多个 workflow 在同一 worktree 内时，每个 workflow 仍用独立 `workflow_id` 与独立 `.cc-leader/` 子目录，互不污染 state
  - 默认串行推进；若用户明确要并行，需为并行的 workflow 各自划分写入路径，避免 phaseExecution 互相覆盖
- 同一 workflow 的所有阶段始终共用同一个 worktree，从 spec 起一直用到 report；不要中途切到别的 worktree
- 进入任何 phase skill 前先检查 `pwd`：
  - 若已在某 `<project-root>/worktrees/<name>` 内 → 继续在该 worktree 工作
  - 若仍在主工作树 → 先与用户确认 worktree 名 (新建或复用现有)：
    - 新建：`git worktree add worktrees/<name> -b cc-leader/<name>`
    - 复用：直接 `EnterWorktree path=worktrees/<name>`
- 用户主动 `ExitWorktree` 后再继续 workflow，必须重新切回原 worktree，不要在主工作树续跑
- worktree 目录要纳入 `.gitignore` (`worktrees/`)，避免误提交

### 后台任务看护规则

可主动通知 cc 的后台任务 (本 session 内 `Bash run_in_background` / `Agent run_in_background` / `cc-leader dispatch` 派的 worker) 默认依赖完成时的 `<task-notification>` 推送，但仍需防卡死兜底：

- 派出后立即用 `ScheduleWakeup` 排看护回调，`prompt` 写明回头检查哪个 job (例如 `<<autonomous-loop-dynamic>>` 或具体 `cc-leader job:status --job-id <id>` 的提示)
- 间隔按任务长度选，**避开 600s** (付 cache miss 又拿不到长间隔好处)：
  - 长任务 (>30min)：1500–1800s，摊薄 cache miss
  - 活跃监控 (即将完成 / 卡边缘)：≤270s，留在 5min cache 内
- 回调触发时只做轻量检查：
  - 跑 `cc-leader job:status --job-id <id>` 或读 `last_result_file_path`
  - 若 worker 仍 running 且有进展 → 再排一次 wakeup
  - 若 worker 仍 running 但日志/输出无变化 (疑似卡死) → 提示用户并问是否 stop / restart
  - 若已完成 → 进入正常结果处理
- 收到自然 `<task-notification>` 后，撤掉对应 wakeup (`CronDelete`) 避免重复
- 不可主动通知的任务 (`cc-leader drive` 等跨 session detached) 不适用本节，按 `drive` skill 规则单独处理

### 看护期 token 节流规则

cc 自身上下文窗口宝贵，codex worker 用量无限。看护期所有重活儿 push 给 codex worker，cc 只做调度与摘要消费。

#### 重活儿派给 codex (优先)

下列动作**禁止**在 cc session 里直接做，全部 `cc-leader dispatch` 一个轻量 codex worker 处理，cc 只读最终摘要文件：

- 解析 / 总结超过 200 行的 worker 日志或 phase 输出
- 跨多个 phase artifact 做对比 / 一致性检查
- 读大型 state 文件后再做语义判断 (例如卡死原因诊断)
- 任何"读一堆文件再写报告"模式

派 codex 时 prompt 明确要求："只输出 JSON 摘要 / ≤200 字结论到 `<out>`，不要把原文回放进 stdout。"

#### cc 直接做的事 (轻量)

- `cc-leader job:status --job-id <id>` 读结构化 JSON
- 读单个小 state 字段 (`last_result_file_path` / `active_job_id` / `current_phase`)
- 比对 mtime / 行数 / 简单 grep (`tail -50 | grep -E 'ERROR|FAIL|done'`)
- 把 codex 写好的摘要文件 `Read` 进来转述

#### 增量原则

- 记上次 `last_progress_at` / 结果文件 mtime / 行数到对话文本中；下次回调先比对，没变化就跳过深度检查
- 多 job 共一次 wakeup 批量查，别 1 job 1 wakeup
- 给用户的状态汇报压成一行：`<job-id>: running, N task done, last_progress Xmin ago`

#### 模型档位

看护期不需要 Opus。`run` skill 已默认 `/model sonnet medium`；只做 status 轮询时可降到 haiku 进一步省 token。

### 全工作流 token 节流规则

总原则：**重活儿 → codex worker；cc → 只读摘要 / 结构化字段 / diff**。下列每一条都是硬规矩，违反就是浪费用户配额。

#### 最终报告生成 (`reporting-results`)

- ❌ 不在 cc 里读 spec + 全部 phase result + 全部 review 后写报告
- ✅ 派 codex worker (例如 `cc-leader dispatch --job phaseReview`-类似入口或专用 finalReport job) 读全链 artifact 并写到 `state.final_report_path`
- cc 只 `Read` 最终报告文件给用户，原始 artifact 一律不读

#### plan / task 文档回读

- worker 出完 plan list / task list 后，cc 不读全文
- 默认动作：`head -50 <file>` + 统计 phase 数 / task 数 (用 `grep -c` 之类) → 一句话告诉用户
- 用户问到具体 phase 才派 codex 摘要那一段，或精读单 phase 子文件

#### phase review 回读

- 只解析三段：`verdict`、`blockers`、`top_issues` (前 3 条)
- 完整 review markdown 不读；用户要细节时派 codex 摘要

#### spec 对抗审 revise 循环

- 每轮 revise 不把 spec 全文 + review 全文带进 cc context
- spec 改动用 `git diff` 给 cc，原文留在文件系统
- review 结果只看 verdict + critical issues 列表，全文派 codex 摘要

#### Bash 输出强制限幅

| 命令              | 默认形式                                       |
| ----------------- | ---------------------------------------------- |
| `git log`         | `git log -n 10 --oneline`                      |
| `git diff`        | `git diff --stat`，要全文派 codex              |
| `git status`      | 默认即可，**禁** `-uall`                       |
| `find`            | 必须 `\| head -50`                             |
| `grep`            | 必须 `\| head -50` 或 `-c` 计数                |
| `ls`              | 子目录深时用 `-1 \| head`                      |
| `cat` / `tail -f` | **禁**直接对大文件用；改 `tail -50` 或派 codex |

要全文分析的：写 codex worker，让 codex 读完出摘要文件，cc 只读摘要。

#### artifact recovery

- 断线 / 续跑时，禁止 cc 自己重读所有 artifact
- 派 codex 出 `recovery_summary.md`：当前 phase / 已完成 artifact / 缺失 artifact / 建议下一步
- cc 只读 summary 决定路由

#### state 查询去重

- 每个 skill 入口处一次性 `cc-leader state:get` 拉全字段，把关键字段 (`workflow_id` / `current_phase` / `active_job_id` / `last_result_file_path`) 记到对话文本
- 同一 skill 内后续动作复用这些字段，不再重复 `state:get`
- 只在状态明确可能变化后 (派完 job / 收到 notification / 用户改了 state) 才再查

#### session 长度控制

- 单 workflow 完成 (final report 出 / STATUS=done) 后，主动建议用户：`workflow 已完成。建议 /clear 或开新 session，历史已存 memsearch。`
- 单 phase 完成且下一个 phase 与上文耦合度低时，也可建议接力
- 用户全局规则要求"任务链结束时主动 memsearch 存档"，本节兜底

#### plan mode 文件

- `EnterPlanMode` 后写到 plan 文件；后续动作只摘要回读，不全文回放进 cc

#### 状态汇报一行制

- 给用户的中间汇报压成一行，例：
  - `phase-2: pass, 0 blocker, next=phase-3`
  - `<job-id>: running, 12/20 task done, last_progress 3min ago`
- JSON / 摘要文件不要展开重述；让用户问具体再展开

按状态路由：

- 用户明确要“开 detached codex 做用户指定任务” -> `drive`
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

如果 `cc` 自己中途断线、报错、额度耗尽：

- 直接再次执行 `cc-leader run --write-scope <allowed-write-path>`
- harness 会先检查 `active_job_id`
- 如果后台 worker 还活着，就接管等待
- 如果后台 worker 已结束，就读取结果或做 artifact recovery

### 启动 detached codex drive

如果用户要的不是 workflow gate，而是“把这个任务交给 codex 一直做”：

```bash
cc-leader drive "<user task>"
```

如果是接管当前仍在进行的 drive：

```bash
cc-leader drive
```

这个模式下：

- 任务文本直接来自用户
- codex 只是停下来问“是否继续”时，会自动 `resume`
- 监控只看 4 类里程碑：PR merge、CI 失败、需要用户介入、drive 结束
- 非里程碑进展静默
- 真 blocker / 真决策需求时才交还用户

### 查看状态

```bash
cc-leader state:get
cc-leader resolve-phase
cc-leader job:status
cc-leader job:status --job-id <job-id>
```

用途：

- `state:get`：看 workflow state 真源
- `resolve-phase`：看当前 phase 推断结果
- `job:status`：看 active job 或指定 job 的 detached runner / worker / result 状态

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
- "Using `cc-leader run`，因为 spec 已批准，自动推进 workflow 到完成。"
- "Using `cc-leader drive`，因为用户要启动 detached codex 执行他指定的任务，而不是走 workflow gate。"

## 反模式

- 粗糙请求直接进 execution
- 没书面 spec 就 planning
- 上个依赖 phase 还没 review 就跑后续 phase
- final spec review 没过就宣称完成
