# CC Leader

给 Claude Code 用的多 agent workflow skill pack，覆盖从 spec 起草到最终报告的完整流程。

## 核心约束

- `cc` (Claude Code) 面向用户，负责状态推进与用户交互
- `worker` 负责生成、执行、审查；目前只支持 `codex-cli`
- 关键阶段都要落盘为 artifact
- 前进要过 review gate（spec review / phase review / final spec review）
- 状态由 `cc-leader` CLI 管理，不手改 `.cc-leader/session.json`

## 快速开始

### 安装

```bash
git clone https://github.com/dualface/cc-leader.git
cd cc-leader
./scripts/install.sh
```

脚本会：

- 把 `skills/*` 复制到 `~/.claude/skills/cc-leader--<name>`
- 在 `~/.local/bin/cc-leader` 写 wrapper（需要 `~/.local/bin` 在 `PATH`）
- 跑 `npm run validate` 自检

卸载：`./scripts/uninstall.sh`

### 升级

```bash
cd cc-leader
./scripts/install.sh --update
```

`--update` 会先执行 `git pull`，再重跑安装逻辑（幂等，新增 skill 自动注册，wrapper 有变更时自动更新）。

### 在目标项目中使用

进入任意项目根目录，Claude Code 内执行：

- `/cc-leader-spec` — 起草或续接 spec（自动检测已有 workflow 状态）
- `/cc-leader-run` — spec 批准后一键推进 plan → task → execute → review → report

也可以直接用 CLI：

```bash
cd <target-project>
cc-leader init --slug <project-slug>
cc-leader state:set --set spec_path=docs/specs/<workflow-id>.md
cc-leader dispatch --job specAdversarialReview
cc-leader job:status
cc-leader run   # spec 批准后一键推进到终态或用户介入点
```

## 阶段总览

| # | Phase                     | 职责                                       | Review gate           |
|---|---------------------------|--------------------------------------------|-----------------------|
| 1 | `drafting-specs`          | 和用户写 spec，worker 对抗式 review         | spec 批准             |
| 2 | `writing-phase-plans`     | 基于已批准 spec 写 phase plan list，self review | plan self review  |
| 3 | `writing-phase-tasks`     | 按 phase 并发生成 phase task list，self review | task self review  |
| 4 | `executing-phase-tasks`   | 按依赖顺序执行 task，逐 task 追加 phase result | 每 phase 结束触发 review |
| 5 | `reviewing-phase-results` | 做 phase review；全部通过后做 final spec review | 全部 pass 才到报告 |
| 6 | `reporting-results`       | `cc` 汇总最终报告                           | 向用户朗读摘要        |

## 关键特性

### Slash command 入口

- `/cc-leader-spec` — spec 阶段
  - 自动检测已有 workflow：已批准 → 提示用 `/cc-leader-run`；未完成 → 问用户续接还是重开
  - spec 启动时建议切到 Opus 4.6 (1M context) 获得最佳 spec 质量
  - spec review 连续 2 轮 `revise` 后强制停下，让用户决定继续/override/放弃
- `/cc-leader-run` — 执行阶段
  - 启动时建议切到 Sonnet 4.6 medium 降低 token 成本
  - 调用 `cc-leader run` 自动推进到终态或用户介入点
  - 如果 `cc` 中途因网络/额度/崩溃退出，再次执行 `/cc-leader-run` 会先接管已有 active job，再决定继续等待、回收结果或重试

### Harness 能力

- `cc-leader run` — 自动循环 dispatch，直到工作流完成或遇到阻塞/用户介入
- `cc-leader job:status` — 查看 active job 或指定 job 的 detached runner / worker / result 状态
- detached runner：真正执行 `codex exec` 的后台 runner 脱离 `cc` 生命周期，`cc` 掉线时 worker 不会被一起杀掉
- rollback anchor：每次写业务文件前打 git tag，失败可安全回滚
- state schema 校验：state 文件变更时强制校验 key 合规
- state lock 清理：中断后自动清理残留锁
- codex runtime：stdout/stderr 写入 run 日志；当前 `cc-leader run` 存活时继续实时转发到终端
- `phase_id` / `task_id` 强格式约束，防止自动运行时生成非法 ID

### 外部依赖处理策略

第三方 API / 外部服务 / 网络依赖的错误处理和测试覆盖问题，独立归入 `external_dependency_risks` 分类：

- **永不触发** spec revise、phase fail 或 blocked
- spec → spec review → phase result → phase review 全程记录
- spec 批准前 `cc` 单独向用户朗读外部依赖风险清单
- 最终报告单列 `外部依赖问题与建议` 段，按依赖分组并附缓解建议

详见 [docs/prompts/spec-adversarial-review.md](docs/prompts/spec-adversarial-review.md) 的"严重度分级"。

## 关键入口

| 类别           | 文件                                                      |
|----------------|-----------------------------------------------------------|
| manifest       | [cc-leader.manifest.json](cc-leader.manifest.json)        |
| bootstrap skill| [skills/using-cc-leader/SKILL.md](skills/using-cc-leader/SKILL.md) |
| 用户入口 skill | [skills/spec/SKILL.md](skills/spec/SKILL.md) · [skills/run/SKILL.md](skills/run/SKILL.md) |
| loader 合同    | [docs/loader-contract.md](docs/loader-contract.md)        |
| transport 合同 | [docs/transport-contract.md](docs/transport-contract.md)  |
| runtime 合同   | [docs/runtime-contract.md](docs/runtime-contract.md)      |
| 状态机         | [docs/state-machine.md](docs/state-machine.md)            |
| 产物规则       | [docs/artifact-rules.md](docs/artifact-rules.md)          |
| verification   | [docs/verification-contract.md](docs/verification-contract.md) |
| 编排合同       | [docs/worker-orchestration-contract.md](docs/worker-orchestration-contract.md) |
| prompt 合同    | [docs/worker-prompt-contracts.md](docs/worker-prompt-contracts.md) |
| harness 样例   | [docs/harness-example.md](docs/harness-example.md)        |
| harness 脚本   | [scripts/cc-leader-harness.mjs](scripts/cc-leader-harness.mjs) |
| smoke 脚本     | [scripts/smoke-run.mjs](scripts/smoke-run.mjs)            |
| 自检脚本       | [scripts/validate-skill-pack.mjs](scripts/validate-skill-pack.mjs) |
| 安装脚本       | [scripts/install.sh](scripts/install.sh) · [scripts/uninstall.sh](scripts/uninstall.sh) |
| artifact 样例  | [docs/examples/minimal-todo/](docs/examples/minimal-todo/) |
| dispatch prompt| [docs/prompts/](docs/prompts/)                            |
| artifact 模板  | [docs/templates/](docs/templates/)                        |

## 状态

这是 workflow skill pack + 最小 harness，不是完整调度服务。

已定义 / 可用：

- phase skills、session state key、artifact 目录与命名规则
- worker runtime: `codex-cli`（non-interactive，result file 合同）
- transport / runtime 合同
- worker prompt 合同
- 状态机、重试策略、override、verification 规则
- slash command 入口（`/cc-leader-spec`、`/cc-leader-run`）
- 最小 harness：`init` / `state:get` / `state:set` / `dispatch` / `job:status` / `run` / `resolve-phase` / `report`
- 全局安装脚本（wrapper + skill copy）
- 外部依赖风险独立分类（不阻塞、全程记录、最终汇总）
- spec 续接、模型切换、revise 强制介入、rollback anchor、state schema 校验
- 样例 artifact（`docs/examples/minimal-todo/`）
- 自检脚本（`npm run validate`）

未定义 / 未实现：

- 生产级调度服务（多 worker 并行编排）
- 除 `codex-cli` 之外的 worker runtime
