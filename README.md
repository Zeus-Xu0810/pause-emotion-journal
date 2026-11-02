# 片刻

面向学业、职场与社交压力的情绪日记和日常关怀工具。

界面采用本地圆体、放大的居中主舞台和可互动的 Three.js 软糯团子。伙伴默认微笑，日记评分仍为空；轻触会随机回应，一轮 100 条用完前不重复。首页只保留情绪选择与保存，文字、标签和补记按需展开。

中文圆体来自 [ChillRoundF](https://github.com/Warren2060/ChillRound)，按 OFL 1.1 使用；修改后内部命名为 Pause Round，授权原文保留在 `public/fonts/OFL.txt`。界面子集优先加载，完整字库为个人日记提供后备。支持减少动态偏好，WebGL 不可用时显示静态表情。

网站：[pause-emotion-journal.vercel.app](https://pause-emotion-journal.vercel.app/)

## 产品结构

- **此刻**：五档情绪、细分感受、情境标签、短记与补记，100 条独立伙伴回应。
- **日记**：时间线、月历、日期/情绪/情境筛选、编辑、单条删除与 JSON 备份。
- **看见自己**：近7/30天走势、真实情境计数和关怀反馈。空缺日不计低分，示例数据明确标识。
- **放松**：自由涂鸦、八组星光连线、接住光点；也可选择呼吸、正念、声音与伸展。支持暂停、结束与反馈，没有分数或失败惩罚。
- **我的空间**：邮箱注册、验证、登录、找回密码、个人云同步及数据导出。

## 本地开发

需要 Node.js 22.12+。执行 `npm install`、`npm run dev`；生产检查为 `npm run build`，领域与交互逻辑测试为 `npm test`。

将 `.env.example` 中的 Firebase Web SDK 配置填入仅本机使用的 `.env.local`。未配置时，网站提供明确标识的访客体验，不伪装云同步成功。

品牌、分类、输入限制及呼吸参数位于 `src/config.ts`；练习文案和音频参数位于 `src/care-content.ts`；伙伴的 100 条短句与动作配置位于 `src/mascot-content.ts`；游戏配置位于 `src/play-content.ts`；视觉变量集中在各样式文件顶部。

## 数据与隐私

使用 Firebase Authentication 与 Standard Cloud Firestore。数据按 `users/{uid}/entries` 与 `users/{uid}/careSessions` 隔离，只有已验证邮箱的本人可访问。修改使用版本事务处理冲突。网站默认会话登录与内存缓存，退出清空画面，私人正文不写入浏览器持久存储。

访客内容只保留在当前页面；登录后由用户主动选择保存到云端。情绪统计与建议使用透明规则，不将私人日记发送给大模型。

涂鸦在当前页面内存中保留，切换站内页面后可继续，刷新后清除；换账号会清除前一人的作品。画作、星图连线与操作轨迹不上传。自由活动只保存名称、实际时长和本人反馈，使用 `play` 类型，沿用旧的关怀记录结构。

规则测试使用 Java 21+ 和 Firebase Emulator：`npx -y firebase-tools@latest emulators:exec --only firestore --project demo-pause-emotion-journal "node --test tests/firestore.rules.test.mjs"`。只使用专用 demo 项目，不能指向正式数据运行。

## 发布

GitHub `main` 连接当前 Vercel 项目。Vercel 执行 `npm run build`，产物为 `dist`，包含客户端路由刷新回退。生产环境需配置 `.env.example` 列出的变量，并将 `pause-emotion-journal.vercel.app` 加入 Firebase Auth 授权域。

Firebase Auth 与 Firestore 规则通过 `npx -y firebase-tools@latest deploy --only auth,firestore --project pause-emotion-zeus` 发布。使用 Spark 免费套餐，未启用付费账单；免费配额和平台状态会影响可用性。

新增关怀类型时先发布兼容旧类型的 Firestore 规则，再发布前端。本次 `play` 兼容规则已通过含跨账号攻击样本的模拟器验证。

## 设计依据

- [JMIR 情绪记录应用用户研究](https://mhealth.jmir.org/2020/10/e18140/)：低负担输入、个性化表达、可编辑与可视回顾。
- [NIMH 自我关怀建议](https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health)：放松、运动、音乐与个人适配。

片刻用于自我记录与日常关怀，不提供诊断或疗效承诺。
