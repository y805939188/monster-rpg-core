---
name: monster-rpg-baseline
description: Translate documented monster-game player behaviors into a generic framework acceptance baseline, using Pokemon basics as the first-release benchmark. Use for scope, feature cards and coverage decisions, not source-code migration or full combat simulation.
---
# 怪兽游戏玩法基线

第一版验收参照宝可梦基础玩法；这不是精确复刻宝可梦公式/内容，也不授权读取Pokemon Essentials源码。先读项目 docs/gameplay-baseline.md 中当前功能对应行。未确认的新基线只能作为提案，不能直接编码。

## 方法
1. 用一句可观察行为定义功能，如“捕捉失败扣一件耗材，同一遭遇继续”；不要用“有CaptureService”充当完成标准。
2. 将行为分给核心、可配置规则、战斗适配器、宿主。规则可以在战斗中执行，不等于规则只能战后执行。
3. 用官方游戏手册/指南支撑玩法事实，标记来源与具体版本。规则架构是我们的设计判断，不能声称商业游戏内部如此实现。
4. 以原创物种/招式/道具建立可手算的例子。宝可梦示例可设队伍6、招式4、PP，但核心不硬编码这些；第二套小配置修改容量、成长或采用无PP规则。
5. 每行矩阵写出成功、失败、容量/数值边界、重复执行及保存影响；依赖外部引擎的行为用明确测试适配器证明契约，不宣称生产引擎已实现。
6. 只研究影响当前决策的对比。Monster Sanctuary的蛋获取/技能树和Temtem的耐力足以提醒不能把获取=捕捉、成长=四技能替换、招式资源=PP写成通用真理；本期不因此扩展为蛋孵化或耐力战斗系统。

## 必查误区
- 战后赠送怪兽不能替代“战斗中捕捉，失败继续”
- seen与acquired不同，当前持有数量不是历史图鉴
- 队伍成员引用持有集合，不保存重复的怪兽副本
- 满招式后的学习是可拒绝/替换的选择，不能静默删除
- 进化保留个体身份，变更物种/派生属性；道具只在成功适用时消耗
- HP、PP、持久状态与战斗临时状态分别明确归属
- 第一版可不支持战中保存，但必须显式拒绝，并保存已承诺的待学习/进化选择

## 来源及适用边界
- 宝可梦BDSP战斗指南：https://diamondpearl.pokemon.com/en-us/trainersguide/fundamentals/battling/
- 培养与进化：https://diamondpearl.pokemon.com/en-au/trainersguide/fundamentals/raising/
- 图鉴：https://diamondpearl.pokemon.com/en-us/trainersguide/pokedex/
- Nintendo Pearl手册：https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/DS_Pokemon_Pearl?_a=DATAg1AAZAA0
- Monster Sanctuary开发者：https://monster-sanctuary.com/
- Team17页面：https://www.team17.com/games/monster-sanctuary
- Temtem开发者0.8说明：https://crema.gg/temtem/patch-0-8/
查阅日期2026-09-30。不是全类型游戏穷尽研究，不包含商业素材复制许可，不证明全部接口已经实现。
