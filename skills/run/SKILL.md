---
name: cc-leader-run
description: "Use when the user wants to execute a cc-leader workflow after spec approval, or says '/cc-leader-run'. Auto-advances through plan, task, execute, review, report."
---

# 启动 Run Workflow

这是 spec 批准后的自动执行入口。用户要继续 workflow，或直接说 `/cc-leader-run` 时，用这个 skill。

如果用户要的是“启动 detached codex 去做一个他自己指定的任务”，不要用这个 skill，改用 `/cc-leader-drive`。

## 核心规则

- 只用 `cc-leader` CLI 读取和推进 workflow state，不要直接编辑 session state 文件
- `cc-leader run` 的 stdout 是 JSON；必须解析后再用人话告诉用户，不要原样甩 JSON
- 这是长时间操作，用背景模式运行
- 如果发现已有 active job，不要重复 dispatch；直接再次执行 `cc-leader run`，让 harness 自动接管

## 前置检查

0. 自动切换模型: 执行 `/model sonnet medium`，run 阶段由 worker (codex) 干活，cc 只做调度，Sonnet 4.6 medium 足够
1. **worktree gate**: 执行 `pwd`
   - 若 CWD 不在 `<project-root>/worktrees/<name>` 内 → 拒绝继续, 提示用户: "run 必须在 worktree 内执行 (state 按 CWD 存); 请先用 /cc-leader-spec 进入或新建 worktree"
   - 若已在 worktree 内 → 继续
2. 执行 `cc-leader state:get`
3. 确认 `spec_approved == true`
4. 如果还没批准，提示用户先用 `/cc-leader-spec`
5. 同时确认 `spec_review_passed == true`。如果 review 还没通过，也先回 `/cc-leader-spec`
6. 问用户：`业务代码允许写入哪个目录?`

## 执行

1. 用背景模式执行 `cc-leader run --write-scope <path>`
2. 等命令结束后解析返回 JSON，至少读取：
   - `stopped`
   - `reason`
   - `phase`
   - `job`
   - `phase_id`
   - `state.final_report_path`
   - `result.verdict`
   - `result.summary`
   - `result.blockers`
3. 把 JSON 翻成人话，告诉用户当前状态、卡点、下一步

## 结果处理

- 如果 `stopped == false` 且 `reason == "已完成"`：
  - 读取 `state.final_report_path`
  - 打开最终报告，向用户展示重点结论
- 如果 `stopped == true` 且 `reason == "需要用户决策"`：
  - 展示 `result` 的结论、关键问题、建议动作
  - 问用户怎么处理
- 如果 `stopped == true` 且 `reason == "worker blocked"`：
  - 展示 blocker、相关 phase/job、需要用户提供什么
- 如果 `stopped == true` 且 `reason == "phaseExecution 需要 --write-scope, 需要用户操作"`：
  - 直接向用户追问 write-scope，然后重新运行
- 如果 `stopped == true` 且 `reason == "spec 未批准, 需要用户操作"`：
  - 让用户先回 `/cc-leader-spec`
- 其他停止原因：
  - 说明 `reason`
  - 给出最小下一步建议

## 续跑

- workflow 中途停止后，用户补完决策、解除 blocker、或给出 write-scope，即可再次用 `/cc-leader-run`
- 如果上次是 `cc` 自己断线、报错、额度耗尽，直接再次 `/cc-leader-run`；harness 会先检查 active job，worker 还活着就接管等待，worker 已结束就回收结果再继续
- 如果只是想先看后台 job 现在怎么样，执行 `cc-leader job:status`
- 再次执行前，先读一次 `cc-leader state:get`，确认当前 phase 和 artifact path
