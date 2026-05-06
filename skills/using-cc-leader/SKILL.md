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
- 命名按"任务簇"取名 (例如 `worktrees/auth-overhaul`、`worktrees/billing-q2`)，**不**绑死单个 workflow slug
- **同一 worktree 串行承载多个 spec / workflow**：复杂任务拆成多个 spec 时，在同一 worktree 内串行推进 — 上一个 workflow 完成 (final report 出 / STATUS=done) 后再起下一个
  - CLI 限制：单 repo 同时只活跃**一个** workflow (`.cc-leader/session.json` 单状态)
  - 切换到下一 spec：先 `cc-leader state:get` 确认当前 workflow 已 done，再 `cc-leader init --slug <new-slug> --force` 起新 workflow
  - 真要并行多 workflow：各自一个 worktree (一 worktree 一活跃 workflow)
- 同一 workflow 的所有阶段始终共用同一个 worktree，从 spec 起一直用到 report；不要中途切到别的 worktree
- 进入任何 phase skill 前先检查 `pwd`：
  - 若已在某 `<project-root>/worktrees/<name>` 内 → 继续在该 worktree 工作
  - 若仍在主工作树 → 先与用户确认 worktree 名 (新建或复用现有)：
    - 新建：`git worktree add worktrees/<name> -b cc-leader/<name>`
    - 复用：直接 `EnterWorktree path=worktrees/<name>`
- 用户主动 `ExitWorktree` 后再继续 workflow，必须重新切回原 worktree，不要在主工作树续跑
- worktree 目录要纳入 `.gitignore` (`worktrees/`)，避免误提交

### 后台任务看护规则

可主动通知 cc 的后台任务 (本 session 内 `Bash run_in_background` / `Agent run_in_background` / `cc-leader dispatch` 派的 worker) 默认依赖完成时的 `<task-notification>` 推送；正常路径无需主动轮询。

防卡死兜底 (可选, 长跑 phaseExecution 等场景建议开)：

- 派完 worker 后用 `CronCreate(recurring=false, durable=false)` 排一次性看护回调
  - cron 表达式按当前 local time 推 +N 分钟 (5 字段格式 `M H DoM Mon *`)
  - prompt 写明检查指令，例如 `检查 cc-leader job:status --job-id <id>，若 running 且有进展则再排一次 wakeup`
  - `CronCreate` 返回 job ID；收到自然 `<task-notification>` 后用 `CronDelete <id>` 撤回
- 间隔按任务长度选，**避开 ~600s** (付 cache miss 又拿不到长间隔好处)：
  - 长任务 (>30min)：1500–1800s，摊薄 cache miss
  - 活跃监控 (即将完成 / 卡边缘)：≤270s，留在 5min cache 内
- 回调触发时只做轻量检查：
  - 跑 `cc-leader job:status --job-id <id>` 或读 `last_result_file_path`
  - 仍 running 且有进展 → 再排一次 cron 看护
  - 仍 running 但日志 / 输出无变化 (疑似卡死) → 提示用户并问是否 stop / restart
  - 已完成 → 进入正常结果处理
- 不可主动通知的任务 (`cc-leader drive` 等跨 session detached) 不适用本节，按 `drive` skill 规则单独处理

### Token 节流规则

总原则：cc 只读结构化字段 / 摘要 / diff，**不**读原始大文件。

> **CLI 现状**：当前 `cc-leader.manifest.json` 只有 6 个固定 worker job (`specAdversarialReview` / `phasePlanSynthesis` / `phaseTaskSynthesis` / `phaseExecution` / `phaseReview` / `finalSpecReview`)，**没有**通用 codex 摘要 / finalReport / recovery job。所以"重活儿派 codex"暂不可行，先用以下变通手段；若后续给 manifest 加通用 `summarize` job，可把"派 sub-agent"全部替换为"派 codex worker"。

可用减负手段优先级：

1. **结构化字段提取** (最省)：`cc-leader state:get`、`jq` 抽 result.json 字段、`grep -A N <heading>` 抽段
2. **Bash 限幅**：`head` / `tail` / `wc -l` / `grep -c`，禁全文 `Read` / `cat`
3. **Agent sub-agent** (兜底)：必要时用 `Agent (Explore / general-purpose)`，子 agent context 烧在子 session，主 cc 只收 ≤200 字摘要 — 注意 sub-agent **仍烧用户配额**，比假想中的 codex worker 贵，仅在前两条不够时用

#### 看护期 (后台 worker 仍在跑)

- ❌ 不直接 `Read` >200 行的 worker 日志 / phase 输出
- ✅ `cc-leader job:status --job-id <id>` 看 JSON
- ✅ `tail -50 <log> | grep -E 'ERROR|FAIL|done'` 抽关键行
- ✅ 比对 mtime / 行数；无变化跳过深查
- 多 job 共一次 cron 看护批量查，别 1 job 1 wakeup
- 模型档位：`run` skill 已默认 `/model sonnet medium`；纯 status 轮询用 haiku

#### 最终报告生成 (`reporting-results`)

- cc 仍是写报告主体 (CLI 没 finalReport job)，但读 artifact 时**分段读，不全读**：
  - `head -100 <spec>` 读目标 / 非目标段
  - `grep -A 10 '## verdict\|## blockers' <phaseReview>` 抽 verdict / blockers
  - 完整 `Read` 只对 final report template 用一次
- 跨 phase 合成时优先派 `Agent (general-purpose)` sub-agent：prompt 给 artifact 路径列表 + 要求 ≤500 字 phase 摘要 + 风险列表，主 cc 收摘要写最终报告

#### plan / task 文档回读

- worker 出完 plan list / task list 后，cc 不读全文
- 默认：`head -50 <file>` + `grep -c '^### phase' <file>` 算 phase 数 → 一句话告诉用户
- 用户问到具体 phase 才精读那一段

#### phase review 回读

- 只用 `grep -A` 抽三段：`verdict` / `blockers` / `top_issues` (前 3 条)
- 完整 review markdown 不读

#### spec 对抗审 revise 循环

- 每轮 revise 不把 spec 全文 + review 全文带进 cc context
- spec 改动用 `git diff <spec_path>` 给 cc，原文留在文件系统
- review 结果只看 verdict + critical issues，用 `grep -A` 抽

#### Bash 输出强制限幅

| 命令              | 默认形式                                     |
| ----------------- | -------------------------------------------- |
| `git log`         | `git log -n 10 --oneline`                    |
| `git diff`        | `git diff --stat`，要全文派 sub-agent 摘要   |
| `find`            | 必须 `\| head -50`                           |
| `grep`            | 必须 `\| head -50` 或 `-c` 计数              |
| `ls`              | 子目录深时用 `-1 \| head`                    |
| `cat` / `tail -f` | **禁**直接对大文件用；改 `tail -50` 或抽段读 |

要全文分析的：派 sub-agent，主 cc 只读摘要。

#### artifact recovery

- 断线 / 续跑时禁止 cc 重读所有 artifact
- 实操：`cc-leader state:get` 读 `current_phase` / `active_job_id` / `last_result_file_path` / `phase_result_dir` 等关键字段，只 `head` 当前 phase artifact
- 全链分析时派 `Agent (general-purpose)` sub-agent 出 recovery summary

#### state 查询去重

- 每个 skill 入口处一次性 `cc-leader state:get` 拉全字段，关键字段记到对话文本
- 同一 skill 内后续动作复用，不再重复 `state:get`
- 只在状态明确变化后 (派完 job / 收到 notification / 用户改了 state) 再查

#### session 接力

单 workflow 完成 (final report 出) 后按用户全局规则：memsearch 存档 + 提示 `/clear` 或开新 session。本节不再赘述。

#### 状态汇报一行制

中间汇报压成一行；JSON / 摘要文件不要展开重述。例：

- `phase-2: pass, 0 blocker, next=phase-3`
- `<job-id>: running, 12/20 task done, last_progress 3min ago`

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
