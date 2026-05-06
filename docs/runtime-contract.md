# CC Leader Runtime 合同

这个文档定义 `codex-cli` 运行细节。

## 运行目录

所有临时运行文件都放在：

- `.cc-leader/runs/<workflow-id>/<job-id>/`

固定文件：

- prompt: `.cc-leader/runs/<workflow-id>/<job-id>/prompt.md`
- stdout log: `.cc-leader/runs/<workflow-id>/<job-id>/stdout.jsonl`
- stderr log: `.cc-leader/runs/<workflow-id>/<job-id>/stderr.log`
- result: `.cc-leader/runs/<workflow-id>/<job-id>/result.json`
- meta: `.cc-leader/runs/<workflow-id>/<job-id>/job.json`

这些路径写前都由 `cc` 创建。

## Codex CLI 命令形态

实际运行形态：

```bash
PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
node scripts/cc-leader-harness.mjs __run-detached-job \
  --meta-file "$META_FILE"

# detached runner 内部再调用：
codex exec --json --dangerously-bypass-approvals-and-sandbox "$PROMPT_CONTENT"
```

要求：

- 真正 worker 仍然用 `codex exec`
- 用 `--json`
- 关闭 stdin
- prompt 由 `cc` 渲染
- result file 由 prompt 变量传入
- detached runner 要能在 `cc` 退出后继续存活

## 时间限制

每个 worker job 在 `manifest.workerJobs.<job>.timeoutSeconds` 单独配置：

| Job                     | 超时 (秒) |
| ----------------------- | --------- |
| `specAdversarialReview` | 600       |
| `phasePlanSynthesis`    | 600       |
| `phaseTaskSynthesis`    | 600       |
| `phaseExecution`        | 3600      |
| `phaseReview`           | 900       |
| `finalSpecReview`       | 900       |

`drive` 模式默认走 `manifest.transport.timeoutSeconds.default`（3600 秒），可用
`cc-leader drive --timeout-seconds <n>` 覆盖。

`manifest.transport.timeoutSeconds.{phaseExecution,review}` 字段不被代码读取，
仅作参考；真值以 `workerJobs.<job>.timeoutSeconds` 为准。

超时后：

1. detached runner 杀 worker 进程
2. 看结果文件是否存在
3. 不存在则记 transport 失败
4. 存在则按结果文件和 retry 规则处理

## Exit 处理

`cc` 判断 job 时，同时看：

- 进程 exit code
- result file
- artifact 是否真实存在

只看 exit code 不够。

## Prompt 传递

- prompt 内容可以来自模板 + 变量渲染
- harness 应保留渲染后的 `prompt.md`
- 重试时必须生成新 `job_id`
- 新 `job_id` 对应新 run 目录，不覆盖旧日志
- 业务 artifact 路径保持稳定时，重跑允许覆盖旧 artifact；run 目录和 result file 仍按新 `job_id` 新建
- rerun 时如果 `active_job_id` 仍指向旧 job，先检查该 job 的 `job.json`，不要直接生成新 job

## 工作区隔离

当前默认策略：

- 读多写少 job：直接在主 repo 根目录运行
- `phaseExecution`：也在主 repo 根目录运行，因为 execution 已串行
- 每次 code-changing job 前，由 `cc` 创建 rollback anchor

注意：

- `write_scope` 只限制业务文件写入
- run 目录里的 `prompt.md`、`stdout.jsonl`、`stderr.log`、`result.json` 不受 `write_scope` 限制

建议 rollback anchor 之一：

- `git tag pre-<job-id>`
- 或 `git switch -c cc-leader/<job-id>`

未来如果启用同 workflow 内并行 code-changing phase：

- 必须切到 `git worktree`
- 路径建议：`.cc-leader/worktrees/<phase-id>/` (workflow 内 phase 隔离)

注意区分两层 worktree 用法:

- **跨 workflow / 多 spec 并行** (已支持, 用户操作层): 项目根 `worktrees/<task-cluster>/`, 每 worktree 独立 `.cc-leader/session.json`, 详见 README "Worktree 与多 spec" 段
- **同 workflow 内 phase 并行** (本节, 未来扩展): `.cc-leader/worktrees/<phase-id>/`, 由 harness 自动管理

## 日志保存

- stdout 保留 JSONL 全量日志
- stderr 保留原始文本
- `job.json` 保留 detached runner / worker 生命周期
- 结果状态只认 result file
- 日志用于调试、审计、失败排查

## 非目标

这里不定义：

- 具体调度服务
- 具体队列系统
- 如何把 worktree 自动 merge 回主分支
