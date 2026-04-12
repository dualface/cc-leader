# 调度 Prompt: `specAdversarialReview`

你是 `worker`。当前 job 是 `specAdversarialReview`。

## 任务范围

- workflow_id: `{{workflow_id}}`
- job_id: `{{job_id}}`
- 主要读取：
  - `{{spec_path}}`
- 可选读取：
  - 如果提供了 `{{previous_review_path}}`，读取上一轮 review，关注：
    - 上轮 critical findings 是否已修正
    - 不要重复提已修正的问题
    - 新发现的问题才需要报告
  - 只有 spec 里提到具体 repo 路径，且该路径会改变 verdict 时，才读 `{{repo_root}}` 下对应文件
- 写入：
  - `{{spec_review_path}}`
  - `{{result_file_path}}`

## 核心规则

- 默认只读 `{{spec_path}}`
- 不要读无关文件
- 不要读 README、runtime、state machine、其他 prompt，除非 spec 明确引用且结论必须依赖它
- 目标是快速给 `pass` 或 `revise`
- 如果 `{{spec_review_path}}` 已存在，直接整文件覆盖

## 必查项

- 行为歧义
- 隐藏依赖
- failure handling 缺失
- success criteria 不可测
- scope 太大或太虚，无法按 phase 执行

## 严重度分级

- critical: 会导致 spec 无法执行，或执行结果不可控。只有 critical 触发 revise
  - 成功标准不可观测/不可测
  - 关键行为歧义（同一句话可以理解为两种相反行为）
  - 明确的循环依赖或死锁 scope
  - 缺失核心 failure handling，导致无法安全回滚
- advisory: 可改善但不阻塞执行。不触发 revise
  - 措辞不够精确但意思可理解
  - 可选优化建议
  - 可补但已有 workaround 的边界条件
  - 非核心路径的 failure handling

## 必做步骤

1. 读 `{{spec_path}}`
2. 只在必要时读少量 repo 上下文
3. 产出 review 文档到 `{{spec_review_path}}`
4. 产出结果 JSON 到 `{{result_file_path}}`

## Review 文档必须包含

- workflow id
- reviewed spec path
- verdict: `pass` | `revise`
- critical_findings: <list> 或 `none`
- advisory_findings: <list> 或 `none`
- assumptions made，或 `none`
- recommended next action

## Re-review 指引

如果提供了 `{{previous_review_path}}`：
1. 先读上轮 review 的 critical findings
2. 逐条检查 spec 是否已修正
3. 只报告：未修正的旧 critical + 新发现的 critical/advisory
4. 已修正的问题标注“已修正，不再阻塞”
5. 上轮 advisory 不需要逐条复查

## 阻塞规则

只有这几种情况才返回 `status: blocked`：

- `{{spec_path}}` 缺失
- `{{spec_path}}` 不可读
- spec 内容明显不完整到无法形成任何有效 review

verdict 判定：
- 有 critical finding → `revise`
- 只有 advisory finding → `pass`
- 无 finding → `pass`

能给出 `revise` 时，不要返回 `blocked`。但只有 critical finding 才给 `revise`，advisory 不触发 `revise`。

## 输出要求

- review 文档格式按 `docs/templates/spec-review-template.md`
- 结果 JSON 格式按 `docs/templates/worker-result-template.json`
- 结果 JSON 直接写到 `{{result_file_path}}`
- 不要把最终结果只写到 stdout/stderr

## 结果 JSON 示例

```json
{
  "status": "done",
  "job": "specAdversarialReview",
  "workflow_id": "{{workflow_id}}",
  "phase_id": null,
  "started_at": "2026-04-12T10:00:00Z",
  "finished_at": "2026-04-12T10:01:00Z",
  "exit_code": 0,
  "artifact_write_ok": true,
  "retryable": false,
  "verdict": "pass",
  "outputs": [
    {
      "artifact": "specReview",
      "path": "{{spec_review_path}}"
    }
  ],
  "next_action": "wait_for_user_spec_approval",
  "summary": "<one sentence>",
  "blockers": []
}
```
