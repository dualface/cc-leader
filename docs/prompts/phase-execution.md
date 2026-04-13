# 调度 Prompt: `phaseExecution`

你是 `worker`。当前 job 是 `phaseExecution`。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- phase_id: `{{phase_id}}`
- 主要读取：
  - `{{phase_task_list_path}}`
- 可选读取：
  - 只有 task 本身要求时，才读 `{{repo_root}}` 下对应文件
- 写入：
  - `{{phase_result_path}}`
  - `{{result_file_path}}`
  - 业务文件只允许写 `{{write_scope}}` 内文件

## 核心规则

- 一次只执行一个 task
- 不要跳 task
- 不要改 write scope 外的业务文件
- `{{phase_result_path}}` 只追加，不重写旧日志
- 每个 task 都要留下边界校验证据，不能只写口头说明
- `{{result_file_path}}` 是 transport 文件，允许写在 run 目录

## 必做步骤

1. 读 `{{phase_task_list_path}}`
2. 在第一次业务写入前，先把 `{{write_scope}}` 内文件快照写到 `$(dirname "{{result_file_path}}")/before.sha`
3. 按顺序执行 task
4. 在 task 完成且写 phase result 前，再把 `{{write_scope}}` 内文件快照写到 `$(dirname "{{result_file_path}}")/after.sha`
5. 用 before/after 快照生成差异证据
6. 每个 task 后追加 phase result 记录
7. 全部完成后写 `{{result_file_path}}`

## Phase result 记录必须包含

- task id
- status
- summary
- changed files 或 artifacts
- verification run
- scope_verification
- external_dependency_notes（本 task 涉及的外部依赖调用失败/跳过/降级记录，无则 `none`）
- follow_up_notes

## 边界校验要求

如果 task 有实际写入，必须记录一条可核对的边界证据，证明 `changed_files_or_artifacts` 全都位于 `{{write_scope}}` 内。

可以是：

- shell 命令
- 明确的逐路径检查记录

但不能只是“已检查通过”这类空话。

优先使用这种形式：

```bash
find "{{write_scope}}" -type f -print0 | sort -z | xargs -0 shasum > "$(dirname "{{result_file_path}}")/before.sha"
# 业务写入
find "{{write_scope}}" -type f -print0 | sort -z | xargs -0 shasum > "$(dirname "{{result_file_path}}")/after.sha"
diff -u "$(dirname "{{result_file_path}}")/before.sha" "$(dirname "{{result_file_path}}")/after.sha" || true
```

`scope_verification` 里必须包含：

- before 快照命令
- after 快照命令
- diff 输出
- 你据此总结出的实际变更路径列表

如果只有 1 个改动文件，也要把该路径显式写进 `scope_verification`。

## Verdict

- `complete`: 全 task 完成
- `null`: 阻塞中断

## 阻塞规则

如果出现以下任一情况，返回 `status: blocked`：

- task list 缺失
- task list 自相矛盾
- 需要写 scope 外的业务文件
- 同一 verification 连续失败（**仅限内部逻辑验证**；见下方外部依赖规则）

## 外部依赖失败处理规则

外部依赖 = 第三方 API / 外部服务 / 网络可达性 / 外部 token 鉴权 / 第三方 SaaS。

当 verification 或 task 执行因**外部依赖不可达 / 超时 / 限流 / 鉴权失败**受阻时：

- **不**返回 `blocked`
- **不**视为该 task 失败
- 把这次失败记到当前 task 的 `external_dependency_notes`，格式：`<依赖名>: <失败原因> — 影响: <哪些路径未覆盖>`
- 如果同一 task 有内部逻辑部分可验证，把内部部分照常验证
- 若整个 task 只能靠外部依赖验证，则 task status 标 `complete`，但在 `external_dependency_notes` 里写明 "未经实际调用验证，原因: <...>"
- 在 phase 摘要的 `external_dependency_summary` 字段累积汇总（见下）

## 输出要求

- phase result 文档格式按 `docs/templates/phase-result-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`

## 结果 JSON 示例

```json
{
  "status": "done",
  "job": "phaseExecution",
  "workflow_id": "{{workflow_id}}",
  "phase_id": "{{phase_id}}",
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:20:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "complete",
  "outputs": [
    {
      "artifact": "phaseResult",
      "path": "{{phase_result_path}}"
    }
  ],
  "next_action": "dispatch_phase_review",
  "summary": "<one sentence>",
  "blockers": []
}
```
