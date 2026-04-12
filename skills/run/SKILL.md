---
name: cc-leader-run
description: "Use when the user wants to execute a cc-leader workflow after spec approval, or says '/cc-leader-run'. Auto-advances through plan, task, execute, review, report."
---

# 启动 Run Workflow

这是 spec 批准后的自动执行入口。用户要继续 workflow，或直接说 `/cc-leader-run` 时，用这个 skill。

## 核心规则

- 只用 `cc-leader` CLI 读取和推进 workflow state，不要直接编辑 session state 文件
- `cc-leader run` 的 stdout 是 JSON；必须解析后再用人话告诉用户，不要原样甩 JSON
- 这是长时间操作，用背景模式运行

## 前置检查

1. 执行 `cc-leader state:get`
2. 确认 `spec_approved == true`
3. 如果还没批准，提示用户先用 `/cc-leader-spec`
4. 同时确认 `spec_review_passed == true`。如果 review 还没通过，也先回 `/cc-leader-spec`
5. 问用户：`业务代码允许写入哪个目录?`

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
- 再次执行前，先读一次 `cc-leader state:get`，确认当前 phase 和 artifact path
