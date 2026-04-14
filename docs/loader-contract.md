# CC Leader Loader 合同

这个文档定义：harness 想自动加载 `cc-leader`，最少要做什么。

## 目标

自动加载 `using-cc-leader`，再由它把会话路由到正确 phase。

## 文件

- manifest: `cc-leader.manifest.json`
- skills 根目录: `skills/`
- bootstrap skill: `skills/using-cc-leader/SKILL.md`

## 必做行为

### 1. 读取 manifest

注册包或启动会话时，读 `cc-leader.manifest.json`。

它是这些信息的真源：

- bootstrap skill 路径
- workflow phase 顺序
- session state key
- artifact 目录和命名规则
- worker job 类型
- worker prompt 路径和变量
- transport/runtime 合同
- state machine、retry、verification 合同

### 2. 自动加载 bootstrap skill

会话开始时，加载：

- `bootstrapSkill.name`
- `bootstrapSkill.path`

当前值：

- name: `using-cc-leader`
- path: `skills/using-cc-leader/SKILL.md`

### 3. 维护 session state

harness 应持久化这些 key：

- `workflow_id`
- `current_phase`
- `spec_path`
- `spec_review_path`
- `spec_review_passed`
- `spec_approved`
- `phase_plan_list_path`
- `phase_plan_review_passed`
- `phase_task_dir`
- `phase_result_dir`
- `phase_review_dir`
- `ready_phase_ids`
- `active_phase_id`
- `completed_phase_ids`
- `reviewed_phase_ids`
- `final_spec_review_path`
- `final_report_path`
- `active_job_id`
- `last_result_file_path`
- `override_log_path`
- `job_attempts`
- `current_execution_root`

如果没结构化 state，就从这些地方推断：

- 对话里的明确 approval
- 已知 artifact 路径
- 已完成 review artifact
- 最近一次成功 phase 执行
- 最近一次结果文件

### 4. 支持 worker dispatch

harness 必须让 `cc` 能发 worker job，并拿回产物。

最少要求：

- `cc` 能带 artifact 路径派 worker
- `worker` 能把产物写到磁盘
- harness 能读 `result_file_path`
- 下个 turn 里 `cc` 能读这些产物

manifest 里的 `workerJobs` 定义 job 类别：

- `specAdversarialReview`
- `phasePlanSynthesis`
- `phaseTaskSynthesis`
- `phaseExecution`
- `phaseReview`
- `finalSpecReview`

每个 job 还会给：

- `dispatch.promptContractPath`
- `dispatch.resultFileVariable`
- `dispatch.requiredVariables`
- `timeoutSeconds`
- `writesCode`

harness 应读取 prompt 模板，替换全部必需变量，再 dispatch。

### 4.1 支持 job 状态观察

harness 还应让 `cc` 能观察 active job 或指定 job 的后台状态。

最少要求：

- 能根据 `active_job_id` 找到对应 run 目录
- 能读取 `.cc-leader/runs/<workflow-id>/<job-id>/job.json`
- 能判断 detached runner / worker 是否仍存活
- 能报告 `result.json` 是否已就绪
- 能在需要时回退到 `last_result_file_path` 推断最近 job

建议暴露命令：

- `cc-leader job:status`
- `cc-leader job:status --job-id <job-id>`

### 5. 遵守 transport/runtime

当前固定为：

- 当前只支持 `codex-cli`
- `cc-leader` 用 detached runner 非交互调用 `codex exec`
- worker 把结果写到 `result_file_path`
- `cc` 自身中断后，再次 run 要能接管 active job
- harness 应支持单独查询 active job 状态，不强制 rerun 才能观察
- 运行时文件放在 `.cc-leader/runs/`

细节看：

- `docs/transport-contract.md`
- `docs/runtime-contract.md`
- `docs/harness-example.md`

### 6. 遵守 gate 和 state machine

默认 gate：

- spec 批准后才能写 phase plan
- phase review 过后，下一个依赖 phase 才能执行
- final spec review 过后，才能出最终报告

除非用户明确 override，否则不要自动跳 gate。

状态跳转、重试、reopen、override 规则看 `docs/state-machine.md`。

### 7. 解析当前 skill

每个 turn 开始时：

1. 加载 `using-cc-leader`
2. 看 session state 和 artifact
3. 路由到下列之一：
   - `drafting-specs`
   - `writing-phase-plans`
   - `writing-phase-tasks`
   - `executing-phase-tasks`
   - `reviewing-phase-results`
   - `reporting-results`

## 最小伪代码

```ts
const manifest = readJson("cc-leader.manifest.json");
const sessionState = loadSessionState(manifest.sessionState.initialState);

loadSkill(manifest.bootstrapSkill.path);

const activeSkill = resolvePhase({
  userMessage,
  sessionState,
  manifest,
  artifactStore,
});

loadSkill(`skills/${activeSkill}/SKILL.md`);
```

## 产物目录约定

建议目录：

- specs: `docs/specs/`
- spec reviews: `docs/reviews/specs/`
- override logs: `docs/reviews/overrides/`
- phase plans: `docs/plans/`
- phase tasks: `docs/tasks/`
- phase results: `docs/results/`
- phase reviews: `docs/reviews/phases/`
- final reports: `docs/reports/`

这些目录不要求预先存在。写入前由 harness `mkdir -p`。

## 非目标

这里不定义：

- 调度/计费方式
- marketplace 格式
- 模型专属 API

这里已经定义：

- 当前 worker 只支持 `codex-cli`
- transport 命令族是 `codex exec`
- artifact 写前自动建目录
