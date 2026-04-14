# CC Leader Worker 编排合同

这个文档定义 `cc` 和 `worker` 在整个 workflow 里怎么配合。

## 角色

- `cc`: 面向用户，管状态跳转，管最终报告
- `worker`: 做单一范围的生成、执行、审查

## 核心规则

- 每个关键步骤都写 artifact
- 每个 worker job 都要窄职责
- planning/tasking 可按 phase 并发
- 执行按依赖串行
- review gate 决定前进还是回退
- transport 固定为：detached runner + 非交互 `codex-cli` + 结果文件回传
- 目录按写入时创建，不要求仓库预置空目录
- `cc` 自身中断不应直接杀掉 worker；恢复时先接管 active job

## 参考合同

- transport：`docs/transport-contract.md`
- runtime：`docs/runtime-contract.md`
- state machine：`docs/state-machine.md`
- artifact 规则：`docs/artifact-rules.md`
- verification：`docs/verification-contract.md`

## 阶段合同

### 1. 规格起草

输入：

- 用户请求
- 仓库上下文

Owner：

- `cc` 和用户一起写 spec

Worker job：

- `specAdversarialReview`

输出：

- spec 文档
- spec review 文档

前进条件：

- spec review 通过，或用户明确 override
- 用户明确批准 spec

### 2. 阶段计划

输入：

- 已批准 spec

Owner：

- `worker` 生成 phase plan list

Worker job：

- `phasePlanSynthesis`

输出：

- 带 self review 的 phase plan list

前进条件：

- phase plan list 已写出
- self review 认定对齐 spec

### 3. 阶段任务生成

输入：

- phase plan list

Owner：

- `cc` 按 phase 派 worker

Worker job：

- `phaseTaskSynthesis`

输出：

- 每个 phase 一个 phase task list

前进条件：

- 至少第一个可执行 phase task list ready

### 4. 阶段执行

输入：

- 已审过的 phase task list

Owner：

- `worker` 执行任务
- `cc` 管进度和 blocker

Worker job：

- `phaseExecution`

输出：

- append-only 的 phase result 文档

前进条件：

- 当前 phase task list 全部完成

### 5. 阶段审查

输入：

- phase plan
- phase task list
- phase result

Owner：

- `worker` 审
- `cc` 决定回开还是继续

Worker job：

- `phaseReview`

输出：

- phase review 文档

前进条件：

- verdict 是 `pass`

### 6. 最终规格审查

输入：

- 已批准 spec
- phase plan list
- 所有已通过的 phase review

Owner：

- `worker` 对原始 spec 做最终审查

Worker job：

- `finalSpecReview`

输出：

- final spec review 文档

前进条件：

- verdict 是 `pass`

### 7. 最终报告

输入：

- 全部 artifact 链

Owner：

- `cc` 写最终报告

输出：

- final report 文档

## 失败处理

worker 走不下去时，应写：

- 当前 artifact id
- blocker 摘要
- 已做假设
- 推荐下一步

这些信息应同时写进：

- 业务 artifact
- `result_file_path`

然后 `cc` 按 `docs/state-machine.md` 处理：

- 改上游 artifact
- 给更清楚约束，重派同类 job
- 回退到最小受影响 phase
- 问用户
- 记录 override

如果只是想观察后台 job，而不是推进 workflow：

- 读 `job.json`
- 看 runner / worker pid 是否存活
- 看 `result.json` 是否已就绪
- 可通过 `cc-leader job:status` 暴露这类观察能力
