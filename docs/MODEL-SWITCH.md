# Qwen 35B ↔ Harrier 27B 单卡分时复用

## 1. 一键切换

```powershell
# 切到 Harrier 27B（离线向量）
node scripts/switch-model.mjs --model=harrier

# 切回 Qwen 35B（对话/修数据）
node scripts/switch-model.mjs --model=qwen
```

切换期间写 `.data/engine-status.json`：

```json
{ "state": "switching", "message": "系统正在升级本地引擎，请稍候" }
```

服务端 `/api/health` 会带 `engine` 字段；`/api/engine-status` 可单独查询；切换中 `/api/chat` 返回 **503** + 同一条提示。

### 远程主机（当前实际拓扑）

本机 `lms.exe` 在 `C:\Users\haten\.lmstudio\bin\lms.exe`，但本机 LM Studio daemon 启动超时；实际模型服务在 **192.168.3.227:3679**。两种情况：

1. SSH 到模型主机执行：
   ```bash
   ssh user@192.168.3.227
   lms unload --all
   lms load "harrier-oss-v1-27b" --gpu max --context-length 8192 -y
   ```
2. 或在本机设置命令模板（需要免密 SSH）：
   ```powershell
   $env:MODEL_SWITCH_CMD='ssh user@192.168.3.227 "lms {action} {model}"'
   node scripts/switch-model.mjs --model=harrier
   ```

> 切换脚本会轮询 `http://192.168.3.227:3679/v1/models`，直到目标模型出现。

## 2. Harrier 27B 环境要求

**Harrier-OSS-v1-27B 是 Microsoft 的 embedding 模型，不是聊天模型。** 用 LM Studio 跑 GGUF 时 **不需要 Python**。

| 量化 | 权重体积（约） | 最低显存建议 | 说明 |
|---|---|---|---|
| FP16 | ~54 GB | 64 GB+ | 不推荐，单卡基本放不下 |
| Q8_0 | ~28 GB | 32 GB | 32GB 卡很紧，可能 OOM |
| Q6_K | ~22 GB | 24–32 GB | **推荐**，质量/显存平衡 |
| Q4_K_M | ~16 GB | 16–24 GB | 显存不足时用，质量略降 |

当前本机：AMD Radeon 880M（报告 4GB 共享显存）+ 29.8GB 内存，**不适合**跑 27B；应放在 192.168.3.227 的 GPU 主机上。

### 安装步骤（无需 Python）

1. LM Studio 更新到支持 embeddings 的版本；
2. 下载 GGUF：`Abiray/harrier-oss-v1-27b-GGUF`（Q6_K 或 Q4_K_M）；
3. 启动 LM Studio Server，端口 3679，开启 OpenAI-compatible API；
4. 验证：
   ```powershell
   curl http://192.168.3.227:3679/v1/models
   ```
5. 加载：
   ```powershell
   lms load "harrier-oss-v1-27b" --gpu max --context-length 8192 -y
   ```

### 什么时候需要 Python

只有走 HuggingFace Transformers 原始权重才需要：
- Python 3.10+
- PyTorch + CUDA 12.x
- `transformers`、`sentence-transformers`
- FP16 权重约 54GB，显存建议 64GB+；CPU offload 会非常慢

**用 LM Studio GGUF 就不需要 Python。**

## 3. 离线索引

```powershell
# 默认：仅 zh/en 源卡（约 2,181 张）
node scripts/build-harrier-index.mjs

# 全量：包含 5 语种译文（约 1.3 万张可检索卡）
node scripts/build-harrier-index.mjs --all

# 先小样本验证
node scripts/build-harrier-index.mjs --limit 20
```

产物：`.data/harrier-index.json`；断点：`.data/harrier-index.progress.jsonl`。
单并发、批大小 4（`HARRIER_BATCH` 可调，不建议调大）。

## 4. 评测

```powershell
node scripts/eval-harrier-recall.mjs --questions db/seed/qa_eval_set.jsonl
```

产物：`reports/eval/harrier-recall.json`（Top-1/3/5、分类目、miss 明细）。

## 5. 问题卡片回炉

```powershell
# 只导出，不改库
node scripts/requeue-problem-cards.mjs

# 导出并标记 needs_manual_audit（切回 Qwen 后再执行）
node scripts/requeue-problem-cards.mjs --mark
```

产物：`reports/requeue/problem-cards.jsonl`。

## 6. 注意事项

- 切换会中断正在跑的本地 Qwen 任务；先确认 QA 生成/修数据任务已停止。
- Harrier 27B 只用于离线批量向量，**绝不能接实时聊天**。
- 索引完成后切回 Qwen，再跑 RAG 检索；两套模型不要同时驻留显存。
