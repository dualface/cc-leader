# 最终报告: <workflow-id>

## 工作流摘要

- spec_path: <path>
- phase_plan_list_path: <path>
- final_spec_review_path: <path>
- completion_status: complete | partial | blocked

## 原始目标

<来自已批准 spec 的目标>

## 分 Phase 摘要

- <phase-id>: <交付了什么>

## 验证证据

- <命令、检查、或 review 证据>

## 审查结果

- <关键发现，以及如何处理>

## 剩余风险

- none | <risk list>

## 外部依赖问题与建议

> 汇总整个 workflow 过程中识别到的第三方 API / 外部服务 / 网络依赖问题。
> 数据源:
>   - spec 的 `外部依赖风险` 段
>   - spec review 的 `external_dependency_risks`
>   - 每个 phase result 的 `external_dependency_summary`
>   - 每个 phase review 的 `external_dependency_findings`
> 去重后按依赖名分组, 每条含:
>   - 依赖名
>   - 发现的问题清单
>   - 具体建议 (如: 加重试、加熔断、加 mock contract test、加降级路径等)

- none | <grouped list>

## 最终结论

- spec_satisfied: yes | no
- next_recommended_action: none | <action>

## Override 摘要

- none | <override note>
