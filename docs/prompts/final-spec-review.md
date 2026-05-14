# 调度 Prompt: `finalSpecReview`

你是 `worker`。当前 job 是 `finalSpecReview`，属于 `cc-leader` workflow。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- repo_root: `{{repo_root}}`
- 读取：spec / phase plan list / 全部 phase review 内容已内联在「输入内容」节，**不要**再用 shell 读，除非要核实 repo 实际状态
- 写入：
  - `{{final_spec_review_path}}`
  - `{{result_file_path}}`

## 输入内容

### spec (`{{spec_path}}`)

{{spec_content}}

### phase plan list (`{{phase_plan_list_path}}`)

{{phase_plan_list_content}}

### phase reviews（按以下顺序内联，用 `---` 分隔）

涉及路径：

{{phase_review_paths}}

内容：

{{phase_reviews_concat_content}}

## 目标

站在原始已批准 spec 的视角，审整个交付结果是否真的满足目标。

## 核心规则

- 默认基于上面已内联的 spec / plan / phase reviews 判断，**不要**再 sed/awk/cat 读原文件
- 只有验证最终结论时才读少量 repo 上下文
- 如果 `{{final_spec_review_path}}` 已存在，直接整文件覆盖
- 如果输入足够且未遇到真实 blocker，就一次完成整个 job；不要在中途停下来询问用户是否继续

## 必做步骤

1. 直接基于「输入内容」节里已内联的 spec / plan / reviews 判断（不再 shell 读）
2. 判断：这些已完成且已通过 review 的 phase，是否满足原始 spec
3. 用 `docs/templates/final-spec-review-template.md` 结构，把 final review 写到 `{{final_spec_review_path}}`
4. 如有必要，先 `mkdir -p "$(dirname "{{final_spec_review_path}}")"`
5. 把 final review verdict 设为：
   - `pass`
   - `fail`
6. 按 `docs/transport-contract.md` 和 `docs/templates/worker-result-template.json`，把结果 JSON 写到 `{{result_file_path}}`

## 必查焦点

- requirement coverage
- unresolved gap
- evidence sufficiency
- remaining risk
- 如果不满足 spec，最小该重开哪个 phase

## 阻塞规则

如果内联 spec / phase plan list / phase reviews 段全部显式标注"文件缺失"且无法 fallback 读取，就返回 `status: blocked`。

## 输出要求

- final review 文档格式按 `docs/templates/final-spec-review-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`
- **JSON 写入规则**：必须按 `docs/transport-contract.md` 的「结果文件写入方式」和「JSON 编辑工具规则」执行：单次 heredoc 写入 + jq 校验，禁止 sed/awk 改 JSON

## 结果文件

退出前，把单个 JSON 对象写到 `{{result_file_path}}`。

必须用 `cat > "{{result_file_path}}" <<'EOF' ... EOF` 单次写入，写完用 `jq -e . "{{result_file_path}}" > /dev/null` 校验。

done 示例：

```json
{
  "status": "done",
  "job": "finalSpecReview",
  "workflow_id": "{{workflow_id}}",
  "phase_id": null,
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:02:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "pass",
  "outputs": [
    {
      "artifact": "finalSpecReview",
      "path": "{{final_spec_review_path}}"
    }
  ],
  "next_action": "proceed_to_final_report",
  "summary": "<one sentence>",
  "blockers": []
}
```
