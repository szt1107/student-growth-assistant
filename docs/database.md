# 数据库迁移与恢复

## 初始化与升级

使用Python 3.11项目环境，从根目录运行，先停止其他写入同一库的服务并备份已有数据：

```powershell
conda run -n app_env python scripts/migrate.py
# 其他已激活的项目环境：python scripts/migrate.py
```

默认库为backend/data/app.db。指定其他本地库时在同一终端设置SGA_DATABASE_PATH为绝对路径，升级与服务启动均读取该路径。正常启动也执行同一版本检查，不应删除旧数据库来处理失败。

空库依次执行0001_baseline和0002_task_hierarchy；旧库先检查字段、类型、主键和外键，仅接受已知旧结构。成功后才记录Alembic版本；达到head后仍检查实际结构，重复执行不会清空或重复导入业务行。未知结构拒绝升级，不使用stamp head跳过检查。

backend/alembic/baseline_models.py、env.py、0001及0002为现有有效迁移资产，精简版完整保留。未来结构变化应新增revision并在完整开发分支测试，不改写历史revision。降级不提供破坏性删列，应恢复升级前备份并使用对应旧程序。

## 任务层级

0002_task_hierarchy增量添加tasks字段与索引，不重建被历史表引用的tasks表，不改变旧ID：

| 字段 | 默认及约束 |
|---|---|
| parent_task_id | 可空自引用外键，ON DELETE RESTRICT，带索引，禁止自身引用 |
| task_kind | executable/container，旧任务默认executable，非空 |
| sort_order | 非负，默认0，仅建议顺序 |

业务服务另保证仅两级、每个父任务最多20项、子DDL不晚于父DDL，父容器不得带日程/执行事实。分段及允许窗口仍保存在原任务排程资料JSON，不另建排程系统。

## 备份

实际迁移前通过SQLite在线备份API创建副本。新安装默认scripts/.runtime/backups；存在旧默认备份目录时继续兼容，SGA_BACKUP_DIR可显式指定位置。数据库、备份和日志均由Git忽略。

每日备份按日期幂等；强制备份使用时间戳加UUID，临时文件也唯一，同一时间戳不会覆盖前一份。在线副本完成并通过integrity_check后才替换自身目标；最多保留5份，轮换优先保留刚生成副本。重要升级或恢复前另存独立备份，不能仅依赖有限轮换。

## JSON导出与恢复

使用“我的档案”的导出/恢复入口。导出format_version=2，包含26张业务表，不含alembic_version、.env或密钥。不要直接覆盖运行中的SQLite文件。

- v2严格检查完整表集合、全部列、类型、主键、引用、时长、分段及任务树。
- v1先按冻结baseline_models检查原表和字段，再仅给tasks补parent_task_id=null、task_kind=executable、sort_order=0，最后执行完整新版校验。不能只改版本号伪装v1。
- 同一事务替换全部行，保留ID与自引用，延迟外键检查；任一步失败完整回滚。恢复前默认创建安全备份。
- 恢复提高全局revision，待确认候选及修改/拆解草案变stale，运行中请求变interrupted；重新读取最新数据后再规划。

## 匿名演示隔离

正常库使用真实时间。演示脚本使用scripts/.runtime/demo-UUID.db及固定时钟；-Reset创建新库，停止脚本只关身份匹配的进程，保留旧/新演示数据。精简不迁移、不清空或读取个人库。启动与迁移步骤见[README](../README.md)。
