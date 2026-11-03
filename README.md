# 片刻

面向学业、职场与社交压力的情绪日记和日常关怀工具。

界面采用本地圆体、放大的居中主舞台和可互动的 Three.js 软糯团子。伙伴默认微笑，日记评分仍为空；轻触会随机回应，一轮 100 条用完前不重复。首页只保留情绪选择与保存，文字、标签和补记按需展开。

团子的眼球与高光会独立追随鼠标，靠近时眯眼、远处更好奇。支持戳戳、局部捏脸、拖拽回弹、摸头、挠肚子、碰手、双击弹跳与左右轻晃；表情和身体部位会按接触位置作出不同反应。手机可预选“捏脸 / 拽拽 / 摸摸”，互动区紧贴角色，舞台空白继续用于页面滚动。键盘用 Enter / Space 互动，选择模式后按方向键操纵、松键回弹，Escape 放开。

中文圆体来自 [ChillRoundF](https://github.com/Warren2060/ChillRound)，按 OFL 1.1 使用；修改后内部命名为 Pause Round，授权原文保留在 `public/fonts/OFL.txt`。界面子集优先加载，完整字库为个人日记提供后备。

WebGL 不可用时切换为同样可互动的 CSS 团子；减少动态模式保留文字、表情和直接操纵反馈。所有互动均在设备端进行，不产生情绪评分或日记，也不上传指针与触摸轨迹。

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

手势阈值、情境回应与模式提示集中在 `src/mascot-interaction-content.ts`。Three 场景、局部形变、纯手势识别与 DOM 输入分别独立维护。启动 Vite 后打开 `/tests/mascot-interactions.html`，点击“运行交互回归”可检查多指取消、键盘焦点和无 WebGL 状态；该测试页不作为生产构建入口。

## 数据与隐私

使用 Firebase Authentication 与 Standard Cloud Firestore。数据按 `users/{uid}/entries` 与 `users/{uid}/careSessions` 隔离，只有已验证邮箱的本人可访问。修改使用版本事务处理冲突。网站默认会话登录与内存缓存，退出清空画面，私人正文不写入浏览器持久存储。

访客可选择心情、写草稿和体验活动，但不能创建日记或活动记录。点击保存会明确提示注册/登录并说明“尚未记录”；草稿只保留在当前页面，登录并验证邮箱后需主动再次保存到个人云端。情绪统计与建议使用透明规则，不将私人日记发送给大模型。

涂鸦在当前页面内存中保留，切换站内页面后可继续，刷新后清除；换账号会清除前一人的作品。画作、星图连线与操作轨迹不上传。自由活动只保存名称、实际时长和本人反馈，使用 `play` 类型，沿用旧的关怀记录结构。

规则测试使用 Java 21+ 和 Firebase Emulator：`npx -y firebase-tools@latest emulators:exec --only firestore --project demo-pause-emotion-journal "node --test tests/firestore.rules.test.mjs"`。只使用专用 demo 项目，不能指向正式数据运行。

## 发布

GitHub `main` 连接当前 Vercel 项目。Vercel 执行 `npm run build`，产物为 `dist`，包含客户端路由刷新回退。生产环境需配置 `.env.example` 列出的变量，并将 `pause-emotion-journal.vercel.app` 加入 Firebase Auth 授权域。

Firebase Auth 与 Firestore 规则通过 `npx -y firebase-tools@latest deploy --only auth,firestore --project pause-emotion-zeus` 发布。使用 Spark 免费套餐，未启用付费账单；免费配额和平台状态会影响可用性。

新增关怀类型时先发布兼容旧类型的 Firestore 规则，再发布前端。本次 `play` 兼容规则已通过含跨账号攻击样本的模拟器验证。

## 设计依据

- [JMIR 情绪记录应用用户研究](https://mhealth.jmir.org/2020/10/e18140/)：低负担输入、个性化表达、可编辑与可视回顾。
- [NIMH 自我关怀建议](https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health)：放松、运动、音乐与个人适配。
- [Codrops 交互角色原作者教程](https://tympanus.net/codrops/2019/10/14/how-to-create-an-interactive-3d-character-with-three-js/)：参考鼠标注视和点击反馈的交互思路，团子几何与变形代码独立实现。
- [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)、[Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html)：触屏滚动边界与真实部位命中的实现依据。

片刻用于自我记录与日常关怀，不提供诊断或疗效承诺。


## 账号与界面审查（2026-11-03）

- 登录、注册、找回密码使用独立表单，提供可见标签、密码显示切换、确认密码、字段错误、明确的成功状态和发送冷却。登录默认仅本次浏览器会话；勾选“记住登录”才持久保持。
- 首页与日记、回顾、活动、账号共用圆体、导航、字号和按钮尺度；保留首页居中角色及按需展开的文字区。
- 日记/活动保存统一要求本人已验证邮箱；返回登录不自动提交。活动反馈在内存保留，返回后本人可再次保存，画作和操作轨迹不上传。
- 切换账号立即隔离旧记录和草稿，迟到的保存/订阅响应不能覆盖新账号状态；活动保存重试沿用相同编号与反馈。
- 回顾与活动统计共用自然日窗口，情境回看保留所选范围，旧日期链接定位对应月历，无效URL筛选不会隐形生效。
- 表单设计参考：[GOV.UK密码输入](https://design-system.service.gov.uk/components/password-input/)、[USWDS登录表单](https://designsystem.digital.gov/templates/form-templates/sign-in-form/)、[W3C表单指南](https://www.w3.org/WAI/tutorials/forms/)。


本次验证：55项单元测试、账号夹具8项浏览器回归、认证异步竞态10项内存模拟检查，以及真实云端22项临时账号烟雾检查通过。云端检查使用管理员生成的验证/重置链接，不代表真实收件箱送达测试；临时账号与文档均已清理。页面在602×689、390×844、1920×1080、2560×1440布局下检查：首页保存可见，日记展开筛选无横向溢出，手机数据态趋势和情境回看正常。


## 软糯伙伴互动升级（2026-11-03）

- 随心模式可直接抓身体/肚皮、拉脸和摸头，肚皮来回挠会转为笑痒反应；按住过程即反馈，短文字冷却不拦截动作。
- 身体重心和局部软肉分用弹簧：提起时倾斜摆脚，松手有惯性和余振，连续换部位不会把旧脸颊形变搬过去。脸、眉、嘴、小手跟随同一曲面。
- 自主眨眼使用不等间隔，闲置有小幅呼吸、重心与目光变化，久置打盹、重新逗弄会醒来；这些状态只在当前页面，不形成账号数据。
- 低动态仍可直接抓取、捏脸并自动调整取景，停用自主动作与余振；WebGL失败则使用可玩的CSS后备，默认不发声音。
- 本次检查覆盖64项单元测试、6项无WebGL浏览器回归、真实3D指针抓取/捏脸及不同屏幕下的保存位置。物理测试另核对30/60/120帧回弹差异与极值曲面朝向，实体手机多指体验尚未实机测试。
- 动画设计参考：[Pixar挤压与拉伸](https://www.khanacademy.org/computing/pixar/animate/ball/v/animate-4)、[Animation Mentor跟随与重叠](https://www.animationmentor.com/blog/follow-through-and-overlapping-action-the-12-basic-principles-of-animation/)、[Three.js缓动接口](https://threejs.org/docs/pages/MathUtils.html#damp)。
