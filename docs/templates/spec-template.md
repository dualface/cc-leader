# 规格说明: <workflow-title>

## 状态

- workflow_id: <workflow-id>
- status: draft | in_review | approved | overridden
- owner: cc
- latest_review: <path-or-none>

## 目标

<这个 workflow 要完成什么>

## 非目标

- <明确不做什么>

## 约束

- <技术或流程约束>

## 成功标准

- <可观察的完成标准>

## 选定方案

<高层方案>

## 架构与边界

- <主要组件>
- <接口或交接点>

## Phase 假设

- <后续 phase planning 依赖的假设>

## 测试与验证预期

- <worker 怎么证明完成>

## 外部依赖风险

> 列出第三方 API / 外部服务 / 网络依赖相关的已知风险。
> 此类问题不阻塞 spec 批准，但需在批准前让用户知情，并在最终报告中汇总。
> 每条格式：`<依赖名>: <风险点> — 缓解建议: <方式>`

- none | <risk list>

## 开放问题

- none | <剩余问题>

## 审查历史

- <date>: <review 摘要>

## 批准

- spec_review_verdict: pass | revise | overridden
- user_approved: yes | no

## Override 记录

- none | <override note>
