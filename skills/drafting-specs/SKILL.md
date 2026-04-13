---
name: drafting-specs
description: 当 cc 需要和用户一起产出已批准 spec，并在进入 planning 前做 worker 对抗式 review 时使用。
---

# 起草规格

当请求还新、还模糊、还没变成书面已批准 spec 时，用这个 phase。

## 角色

- `cc`: 和用户交互，定 scope，写 spec，决定是否继续 review loop
- `worker`: 对 spec 做对抗式 review，专门挑错

## 规则

- 用户没批准 spec 前，不进 planning
- 一次最多问一个阻塞性问题
- 提方案前先看 repo
- worker review 必须是对抗式，不是走过场
- 用户如果要停 review loop，记录 override

## 流程

1. 看项目上下文、约束、现有文档、文件布局
2. 和用户澄清到足够写出具体 spec
3. 把 spec 落盘
4. 派 worker 做对抗式 review
5. 要求 worker 重点找：
   - 行为歧义
   - 隐藏依赖
   - 不可测 acceptance criteria（仅内部行为）
   - 缺 failure handling（仅内部路径）
   - scope 大到无法 phase 化
   - 单独列出 `external_dependency_risks`：第三方 API / 外部服务的错误处理与测试缺口。此类**不**作为 critical，不触发 revise
6. 如果 worker 找到关键问题（critical）：
   - 向用户总结问题
   - 和用户一起改 spec
   - 再跑一次对抗式 review
7. 如果 worker 通过，或用户 override 剩余问题：
   - **在请求用户批准前，必须单独朗读 `external_dependency_risks` 清单**（如有），让用户知情
   - 把当前 spec 交给用户审批
8. 明确批准前，停在这里。批准后才进 `writing-phase-plans`

## 规格必含部分

- goal
- non-goals
- constraints
- success criteria
- architecture 和边界
- phase assumptions
- testing 和 verification 预期
- external_dependency_risks（第三方依赖相关风险），或明确写 `none`
- open questions，或明确写 `none`
- review history
- approval status

## Worker 审查输出

至少要有：

- verdict: `pass` 或 `revise`
- critical findings
- advisory findings
- external_dependency_risks
- suggested changes
- assumptions the worker had to make

## 退出条件

只有全部满足才离开：

- 已有书面 spec
- 对抗式 review 已通过，或已明确 override
- 用户已明确批准 spec

## 反模式

- 没书面 spec 就谈实现
- 把 worker review 当 rubber stamp
- 带着未解歧义进 planning
