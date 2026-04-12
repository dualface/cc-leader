---
name: cc-leader-spec
description: "Use when the user wants to start or continue a cc-leader workflow, write a spec, or says '/cc-leader-spec'. Guides spec drafting, resume, and adversarial review."
---

# 启动 Spec Workflow

这是 `cc-leader` workflow 的用户入口。用户要新开 workflow、写 spec、或直接说 `/cc-leader-spec` 时，用这个 skill。

## 核心规则

- 这是 spec 阶段入口，不直接进入 planning 或 execution
- 只用 `cc-leader` CLI 操作 workflow state，不要直接编辑 `.cc-leader/session.json` 或其他 session state 文件
- spec 按 `docs/templates/spec-template.md` 的结构写
- 一次最多问一个阻塞问题；非阻塞假设写进 spec

## 流程

0. 建议用户切换模型: "建议切换到 Opus 4.6 (1M context) 模型以获得最佳 spec 质量。可用 /model 切换。"
1. 确认当前就是目标项目根目录，先执行 `pwd`
2. 检测已有 workflow: 执行 `cc-leader state:get`
   - 如果已有 workflow 且 `spec_approved == true`:
     - 提示用户: "已有已批准的 workflow <workflow_id>, spec 在 <spec_path>。用 /cc-leader-run 继续执行。"
     - 停止, 不重复 init
   - 如果已有 workflow 且 `spec_approved == false` 且 `spec_path` 非空:
     - 提示用户: "发现未完成的 workflow <workflow_id>, spec 在 <spec_path>。"
     - 问用户: "继续编辑这个 spec, 还是放弃重开?"
     - 用户选继续 → 跳到步骤 4, 读已有 spec 继续改
     - 用户选重开 → 执行 `cc-leader init --slug <slug> --force`, 走正常新建流程
   - 如果没有 workflow (state:get 报错或 workflow_id 为空):
     - 确认或和用户约定 workflow slug, 执行 `cc-leader init --slug <slug>`
3. 执行 `cc-leader state:get`, 读取 `workflow_id`
4. 和用户一起按 `docs/templates/spec-template.md` 起草 spec。spec 必须包含：
   - 目标
   - 非目标
   - 约束
   - 成功标准
   - 架构与边界
   - phase 假设
   - 测试与验证预期
   - 开放问题
5. 将 spec 落盘到 `docs/specs/<workflow-id>.md`
6. 执行 `cc-leader state:set --set spec_path=docs/specs/<workflow-id>.md`
7. 派 worker 做对抗式 review：`cc-leader dispatch --job specAdversarialReview`
8. 如果 review 结果是 `pass`：
   - 向用户总结 review 结论
   - 询问用户是否批准 spec
   - 用户批准后执行 `cc-leader state:set --set spec_approved=true --set spec_review_passed=true`
   - 明确提示用户：`spec 已批准。用 /cc-leader-run 启动执行。`
9. 如果 review 结果是 `revise`：
   - 总结关键问题、隐含假设、建议修改
   - 和用户一起改 spec
   - 重新执行 `cc-leader dispatch --job specAdversarialReview`
   - **强制上限: 连续 2 轮 revise 后, 必须停止自动循环, 向用户展示累积问题清单, 让用户决定:**
     - 继续修改 spec 再审一轮
     - override 剩余问题, 接受当前 spec
     - 放弃本次 workflow
10. 如果用户明确要求 override：
    - 记录 override 原因、范围、被跳过的 review 问题
    - 把 override 写进 spec 的 `Override 记录`
    - 继续 review / approval 流程

## 审查要求

- review 必须是对抗式，不是走过场
- 重点检查：行为歧义、隐藏依赖、不可测成功标准、缺失失败处理、scope 大到无法 phase 化
- `开放问题` 不能留空；没有就写 `none`

## 退出条件

- `docs/specs/<workflow-id>.md` 已写好
- `spec_path` 已通过 `cc-leader state:set` 写回 state
- spec review 已通过，或 override 已记录
- 用户已明确批准
