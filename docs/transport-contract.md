# CC Leader Transport 合同

这个文档只定义 transport。

## 结论

- 当前只支持 `codex-cli`
- `cc-leader` 用 detached runner 非交互调用 `codex exec`
- `codex-cli` 的可用结果全部写文件
- `cc` 掉线不应直接终止 worker；下次 rerun 要能接管已有 active job
- stdout/stderr 只当调试日志，不当状态真源

## 最小流程

1. `cc` 读取 manifest 和 prompt 合同
2. `cc` 渲染 worker prompt
3. `cc` 生成 `job_id`
4. `cc` 生成 `result_file_path`
5. `cc` 启动 detached runner
6. detached runner 启动 `codex exec`
7. worker 写业务 artifact
8. worker 写结果文件
9. worker 进程退出
10. detached runner 落盘退出状态
11. `cc-leader run` 或下次 rerun 读取结果文件
12. `cc-leader run` 校验输出 artifact 是否真的存在

## 调用约束

- 当前只支持 `codex-cli`
- 必须是非交互模式
- 不能依赖人工 stdin
- `result_file_path` 必须由 `cc` 预先生成并传入
- `result_file_path` 必须是绝对路径
- stdin 必须关闭

## 结果文件

结果文件是 transport 真源。

- 格式：JSON
- 模板：`docs/templates/worker-result-template.json`
- 路径变量名：`result_file_path`

worker 退出前，必须写一个完整 JSON 对象到结果文件。

`result_file_path` 属于 transport 产物，不受 phase business `write_scope` 限制。

## 运行状态文件

每个 job 还应有 run meta 文件：

- 路径：`.cc-leader/runs/<workflow-id>/<job-id>/job.json`
- 用途：记录 detached runner pid、worker pid、超时、退出码
- 真源级别：仅用于恢复/续跑，不替代 `result.json`

## 结果文件字段

- `status`
- `job`
- `workflow_id`
- `phase_id`
- `started_at`
- `finished_at`
- `exit_code`
- `artifact_write_ok`
- `recovered_from_artifact`
- `retryable`
- `verdict`
- `outputs`
- `next_action`
- `summary`
- `blockers`

`outputs` 只列真实写出的文件。没写出就不要报。

## 结果文件写入方式

worker 写 `result_file_path` 必须用单次 heredoc 一次写完。

强制约束：

- 必须用 `cat > "<path>" <<'EOF' ... EOF` 单次写出
- 禁止 `>>` append
- 禁止 `echo` / `printf` 分多次拼接
- 禁止用 `sed` / `awk` 在已存在的结果文件上原地修改
- 写完用 `jq -e . "<path>" > /dev/null` 校验 JSON 合法

标准模式：

```bash
cat > "${result_file_path}" <<'EOF'
{
  "status": "done",
  "job": "...",
  "...": "..."
}
EOF
jq -e . "${result_file_path}" > /dev/null
```

如果 JSON 内容需要嵌入变量，用 `jq -n --arg` 一次生成再 heredoc 写：

```bash
jq -n \
  --arg workflow_id "${workflow_id}" \
  --arg phase_id    "${phase_id}" \
  '{status:"done", workflow_id:$workflow_id, phase_id:$phase_id, ...}' \
  > "${result_file_path}"
```

## JSON 编辑工具规则

worker 改任何 JSON 文件（结果文件、state 文件、artifact 内 JSON 块）必须用 `jq`。

强制约束：

- 修改字段：`jq '<filter>' in.json > out.json && mv out.json in.json`
- 单次生成：`jq -n '<expression>' > out.json`
- 禁止用 `sed` / `awk` / `tr` 修改任何 `.json` 文件
- 禁止手写 `echo`/`printf` 拼接 JSON 字符串
- 修改后必须 `jq -e . file > /dev/null` 校验

理由：

- `sed` 改 JSON 极易破坏转义和嵌套结构
- 损坏的 JSON 会直接触发 transport 失败 + retry
- `jq` 是结构化操作，比文本替换稳得多

## CC 读取规则

worker 进程退出后，`cc` 必须：

1. 确认 `result_file_path` 存在
2. 解析 JSON
3. 校验 `outputs` 里的文件都存在
4. 再读这些业务 artifact

如果 worker 退出但结果文件不存在，视为 transport 失败，不视为 job 成功。

## Exit 规则

- `exit_code = 0` 且结果文件有效：正常
- `exit_code != 0` 且结果文件不存在：transport 失败
- `exit_code != 0` 但结果文件存在：异常完成，按 `retryable` 和 state machine 处理
- `exit_code = 0` 但结果文件不存在：transport 失败

## 恢复规则

如果 worker 没写结果文件，但满足下面全部条件：

- 进程已退出
- 预期业务 artifact 已存在
- artifact 内 verdict/status 可被 harness 解析

则 harness 可以自动补写一份结果文件，并设置：

- `recovered_from_artifact: true`
- `artifact_write_ok: true`

这个恢复只用于避免纯 transport 丢文件，不表示可以跳过 artifact 校验。

如果 `cc` 自身中断，但 active job 对应的 detached runner / worker 还活着：

- 不要重复 dispatch
- 下次 rerun 时先读取 `job.json`
- 如果 worker 仍在跑，就接管等待
- 如果 worker 已退出，就继续读 `result.json` 或走 artifact recovery

## 参考

- 运行细节：`docs/runtime-contract.md`
- harness 样例：`docs/harness-example.md`
- 状态机：`docs/state-machine.md`
