---
name: reporting-results
description: 当所有 phase 和 review 都通过后使用。此时由 cc 基于 artifact 链写最终详细报告。
---

# 输出最终报告

只有当所有计划 phase 都 review 通过，且 final spec review 完成后，才用这个 phase。

## 角色

- `cc`: 给用户写最终报告，也写到磁盘
- `worker`: 可选。只有 `cc` 想单独审报告文案时才用

## 规则

- 报告必须基于 artifact，不基于记忆
- final report 要反链回 spec、plans、results、reviews
- 详细写清：做了什么、怎么验证、还剩什么风险
- **必须单独设 `外部依赖问题与建议` 段**, 汇总全流程识别到的第三方 API / 外部服务问题与缓解建议

## 流程

1. 读取完整 artifact 链：
   - approved spec
   - phase plan list
   - phase task lists
   - phase result documents
   - phase reviews
   - final spec review
2. 写 final report，至少包含：
   - original goal
   - phase-by-phase completion summary
   - verification evidence
   - review findings 及处理方式
   - remaining risks 或 follow-ups
   - **external_dependency_issues_and_recommendations**: 汇总去重全流程外部依赖问题, 按依赖名分组, 每条给出建议
   - 是否满足 spec 的明确结论
3. 报告落盘
4. 给用户展示报告，并附关键 artifact 链接
5. 在终端明确朗读 `外部依赖问题与建议` 段, 让用户知情; 若为 `none` 也要说明

## 退出条件

只有两条：

- final report 已落盘
- 用户已拿到清晰完成摘要

## 反模式

- 模糊 “done” 报告，没证据
- 漏写未解风险
- 不引用 final spec review 就宣称完成
- 把外部依赖问题混进 "剩余风险" 而不单列汇总
- 外部依赖段缺建议 (只列问题不给出缓解方式)
