# 调度 Prompt: `phaseTaskSynthesis`

你是 `worker`。当前 job 是 `phaseTaskSynthesis`。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- phase_id: `{{phase_id}}`
- 主要读取：spec 摘要 + 本 phase 的 plan 块已内联在「输入内容」节，**不要**再用 shell 读 `{{phase_plan_list_path}}` 或 `{{spec_path}}`，除非要核实 repo 实际状态
- 仅当 phase plan 提到具体 repo 路径且会改变 task 顺序时，才读 `{{repo_root}}` 下对应文件
- 写入：
  - `{{phase_task_list_path}}`
  - `{{result_file_path}}`

## 输入内容

### spec 摘要（目标 / 约束 / 成功标准）

{{spec_summary_content}}

### 当前 phase plan 块（`{{phase_id}}` from `{{phase_plan_list_path}}`）

{{phase_plan_block_content}}

## 核心规则

- 默认基于上面已内联的 spec 摘要 + phase plan 块判断，**不要**再 sed/awk/cat 读 plan 全文
- 不要读无关文件
- 一个 phase 产一个最小 task list
- 如果 `{{phase_task_list_path}}` 已存在，直接整文件覆盖
- 如果输入足够且未遇到真实 blocker，就一次完成整个 job；不要在中途停下来询问用户是否继续

## 必做步骤

1. 直接基于「输入内容」节里已内联的 phase plan 块产 task list（不再 shell 读）
2. 产出覆盖该 phase 的最小有序 task list
3. 写 `{{phase_task_list_path}}`
4. 做 self review
5. 写 `{{result_file_path}}`

## Task list 必须包含

- workflow_id
- phase_id
- phase goal
- 稳定 task_id — 格式**必须**是 `task-<NN>-<slug>`
  - `<NN>`: 两位数字序号，从 01 开始（01, 02, 03 …）
  - `<slug>`: 纯小写字母+数字，用 `-` 分隔，不能以 `-` 结尾
  - 正则: `^task-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$`
  - 正确示例: `task-01-init-store`, `task-02-add-cli-handler`
  - 错误示例: `task-1-store`, `task-01-Init-Store`, `task-01-`
- files_or_artifacts
- ordered_steps
- verification
- done_definition
- rollback_or_retry_note
- self_review_verdict

## Verdict

- `pass`: deliverable 全覆盖，顺序成立，可直接执行
- `revise`: task 粒度、顺序、验证或依赖假设不够清楚

## 阻塞规则

只有这几种情况才返回 `status: blocked`：

- 内联 phase plan 块标注"未找到 / 缺失 / 为空"
- 内联内容不足以形成任何有效 task list

能给出 `revise` 时，不要返回 `blocked`。

## 输出要求

- task list 文档格式按 `docs/templates/phase-task-list-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`
- **JSON 写入规则**：必须按 `docs/transport-contract.md` 的「结果文件写入方式」和「JSON 编辑工具规则」执行：单次 heredoc 写入 + jq 校验，禁止 sed/awk 改 JSON

## 结果 JSON 示例

必须用 `cat > "{{result_file_path}}" <<'EOF' ... EOF` 单次写入，写完用 `jq -e . "{{result_file_path}}" > /dev/null` 校验。

```json
{
  "status": "done",
  "job": "phaseTaskSynthesis",
  "workflow_id": "{{workflow_id}}",
  "phase_id": "{{phase_id}}",
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:04:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "pass",
  "outputs": [
    {
      "artifact": "phaseTaskList",
      "path": "{{phase_task_list_path}}"
    }
  ],
  "next_action": "mark_phase_ready",
  "summary": "<one sentence>",
  "blockers": []
}
```
