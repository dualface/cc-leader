# 调度 Prompt: `phasePlanSynthesis`

你是 `worker`。当前 job 是 `phasePlanSynthesis`。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- 主要读取：spec 内容已内联在「输入内容」节，**不要**再用 shell 读 `{{spec_path}}`，除非要核实 repo 实际状态
- 仅当 spec 提到具体 repo 路径且会影响 phase 边界时，才读 `{{repo_root}}` 下对应文件
- 写入：
  - `{{phase_plan_list_path}}`
  - `{{result_file_path}}`

## 输入内容

### spec (`{{spec_path}}`)

{{spec_content}}

## 核心规则

- 默认基于上面已内联的 spec 内容判断，**不要**再 sed/awk/cat 读 `{{spec_path}}`
- 不要读无关文件
- 目标是快速产出可执行 phase plan list
- 如果 `{{phase_plan_list_path}}` 已存在，直接整文件覆盖
- 如果输入足够且未遇到真实 blocker，就一次完成整个 job；不要在中途停下来询问用户是否继续

## 必做步骤

1. 直接基于「输入内容」节里已内联的 spec 拆 phase（不再 shell 读）
2. 拆出最小且有意义的 phase 顺序
3. 明确每个 phase 的 deliverable、verification、depends_on
4. 写 `{{phase_plan_list_path}}`
5. 做 self review
6. 写 `{{result_file_path}}`

## Phase plan 必须包含

- 稳定 phase_id — 格式**必须**是 `phase-<NN>-<slug>`
  - `<NN>`: 两位数字序号，从 01 开始（01, 02, 03 …）
  - `<slug>`: 纯小写字母+数字，用 `-` 分隔，不能以 `-` 结尾
  - 正则: `^phase-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$`
  - 正确示例: `phase-01-core-todo`, `phase-02-auth-integration`
  - 错误示例: `phase-1-todo`, `phase-01-Core-Todo`, `phase-01-`
- title
- goal
- depends_on
- deliverables
- likely files 或 artifacts
- verification
- risks_and_rollback
- self_review_verdict

## Verdict

- `pass`: phase 覆盖 spec，顺序成立，可直接 tasking
- `revise`: phase 边界、覆盖、验证或依赖不够清楚

## 阻塞规则

只有这几种情况才返回 `status: blocked`：

- 内联 spec 段标注"文件缺失"
- spec 明显自相矛盾到无法拆 phase

能给出 `revise` 时，不要返回 `blocked`。

## 输出要求

- phase plan 文档格式按 `docs/templates/phase-plan-list-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`
- 结果 JSON 直接写到 `{{result_file_path}}`
- **JSON 写入规则**：必须按 `docs/transport-contract.md` 的「结果文件写入方式」和「JSON 编辑工具规则」执行：单次 heredoc 写入 + jq 校验，禁止 sed/awk 改 JSON

## 结果 JSON 示例

必须用 `cat > "{{result_file_path}}" <<'EOF' ... EOF` 单次写入，写完用 `jq -e . "{{result_file_path}}" > /dev/null` 校验。

```json
{
  "status": "done",
  "job": "phasePlanSynthesis",
  "workflow_id": "{{workflow_id}}",
  "phase_id": null,
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:05:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "pass",
  "outputs": [
    {
      "artifact": "phasePlanList",
      "path": "{{phase_plan_list_path}}"
    }
  ],
  "next_action": "dispatch_phase_task_synthesis",
  "summary": "<one sentence>",
  "blockers": []
}
```
