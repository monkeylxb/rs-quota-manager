# 周限与重置卡

独立 RS 网关插件，插件 ID 为 `personal.quota-manager`，当前源码版本 `0.1.13`，公开版本以 Releases 为准

基于上游 `v3.57.0` 的公开 SDK，固定提交 `6950c02ee460143dd63103a35a5dd679712488dc`。使用清单 v2、进程 RPC v7、管理能力 v2 和页面宿主桥 v2。

## 安装与兼容

- 下载：[安装包与校验文件](https://github.com/monkeylxb/rs-quota-manager/releases)
- 支持 RS 3.54.x 至 3.57.x，兼容范围为 `>=3.54.0, <3.58.0`。
- 提供 Linux x86_64、Linux ARM64（glibc 2.28+）和 macOS ARM64（Apple 芯片）安装包。
- 插件 ID：`personal.quota-manager`。为保留既有安装配置和私有状态，继续沿用该身份。
- 许可证：Apache-2.0，第三方来源见 [LICENSES/NOTICE.md](LICENSES/NOTICE.md)。

在 RS 的“插件管理 → 安装插件 → GitHub”中填写 `monkeylxb/rs-quota-manager`，选择指定版本下匹配架构的 `.tar.gz` 附件。
也可下载同一 Release 中的 `.tar.gz` 和 `.tar.gz.sha256`，核对 SHA-256 后，通过“上传”安装。
首次安装时确认来源和信任，宿主会创建并启用默认配置。已有安装可通过宿主版本切换更新，保留实例与私有状态。随后从侧栏打开“周限与重置卡”。

## 安全边界

插件直接显示和修改宿主的逐账号自动使用设置。开启后由宿主按原生规则调度额度点数或重置卡。
查看实时库存或发起新的手动用卡请使用 RS 原生账号管理。插件内仅可确认旧版遗留的未决操作，确认会通过宿主复用原请求标识和卡片。
公开验证覆盖规则、协议、页面及安装流程，未执行真实卡片消费；不同上游套餐与卡片格式仍可能存在兼容性差异。
CSV 包含账号 ID、完整名称和邮箱，若原名称含敏感内容，请勿将导出内容公开。

## 使用

选择与运行 RS 的服务器匹配的安装包，核对同名的 `.sha256` 文件，再在插件管理中上传并启用

| 宿主系统 | 安装包文件名后缀 |
| --- | --- |
| Linux x86_64 | `x86_64-unknown-linux-gnu.tar.gz` |
| Linux ARM64 | `aarch64-unknown-linux-gnu.tar.gz` |
| macOS ARM64（Apple 芯片） | `aarch64-apple-darwin.tar.gz` |

- 打开页面或点击“读取最新快照”时分页读取 RS 账号、开关、已有额度观测和自动用卡计划。账号列优先显示完整邮箱，额度点数区分零、不限量和未知余额
- RS 3.55 起可在 Antigravity 账号的「周限」列查看各模型组的已用比例和刷新时间。按周限排序或导出 CSV 时，使用该账号用量最高的组。
- RS 3.56 起，宿主可为 Antigravity OAuth 账号提供 Google One 点数余额和原生自动用点开关。批量用点会包含筛选结果中支持该开关的 Antigravity 账号。
- 按宿主 `planType` 排除 Free 账号，名称带 `team+` 的 Free 同样排除。降级为 Free 且仍有旧版未决操作的账号单独提供确认入口
- 使用行内重置卡图标查看已有额度、宿主自动用卡计划和最近重置记录
- “自动使用额度点数”和“自动使用重置卡”固定在列表右侧，分别对应 RS 账号管理中的同名设置。升级后直接读取宿主已有状态，旧插件的自动使用设置不会迁移到宿主
- 工具栏可对当前筛选结果中的适用账号批量开启或关闭用点、用卡，范围覆盖所有匹配页。重置卡列标题的帮助图标显示“系统设置 → 主动重置卡”的规则，弹窗显示该账号的计划用卡时间和执行状态
- 日期按浏览器本地时区显示，支持搜索、筛选、排序和 CSV 导出；隔离页面不支持下载导航，导出改为官方弹窗中的只读 CSV 和复制、全选操作，不扩展宿主权限。分页复用 RS 使用统计的 ZPagination，默认每页 10 条，可选 10、20、50、100 条及页码跳转
- 页面复用公开的指标卡、会员标签、开关、表格、分页和弹窗，随宿主主题同步，可按会员标识和状态筛选

## 宿主快照与旧版用卡确认

账号列表在打开页面或手动读取快照时更新，额度观测沿用宿主原有采集流程。
RS 的完整重置卡库存和订阅到期日通过按需查询取得，插件页面和 CSV 仅展示宿主提供的本地数据。
“确认原操作”复用已持久化的原卡和原请求标识，结果未确认时继续保留该操作。
确认成功后读取宿主已有的额度快照，后续读取到晚于确认时间且低于 100% 的新周限观测时清除等待状态。

每号保留最近 20 条已确认业务结果，宿主原生消费接口同时保留其自身的审计语义

## 构建

全部构建与验证在本机运行，生产服务器只接收完成的安装包
Rust 使用 1.99.1，前端使用 Node 24 和 pnpm，SDK 与前端依赖由锁文件固定

```powershell
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
cargo +1.99.1 fmt --manifest-path backend/Cargo.toml -- --check
cargo +1.99.1 clippy --manifest-path backend/Cargo.toml --all-targets --locked -- -D warnings
cargo +1.99.1 test --manifest-path backend/Cargo.toml --locked
cargo +1.99.1 build --manifest-path backend/Cargo.toml --locked
node verification/protocol-test.mjs
node verification/frontend-test.mjs
```

交叉构建 Linux 制品需要安装 Zig、cargo-zigbuild 和 Rust Linux target，把 Zig 与 cargo-zigbuild 加入 PATH

```powershell
rustup target add x86_64-unknown-linux-gnu --toolchain 1.99.1
cargo +1.99.1 zigbuild --manifest-path backend/Cargo.toml --release --locked --target x86_64-unknown-linux-gnu.2.28
cpr-plugin package --manifest plugin.json --binary backend/target/x86_64-unknown-linux-gnu/release/quota-manager --target x86_64-unknown-linux-gnu --resource-map web=frontend/dist --resource-map legal=LICENSES --output-dir dist
```

`cpr-plugin` 应从上面的宿主固定提交构建。Linux ARM64 交叉构建使用 `aarch64-unknown-linux-gnu.2.28`，打包目标为 `aarch64-unknown-linux-gnu`。

在 Apple 芯片 Mac 上使用 `cargo +1.99.1 build --manifest-path backend/Cargo.toml --release --locked --target aarch64-apple-darwin`，将打包目标和二进制路径中的目标改为 `aarch64-apple-darwin`。

## 上游复用

按 Issue #278、官方 UI 安装文档和 plugins/workbench 示例核对，详见 `verification/UPSTREAM-COMPLIANCE.md`。
UI 通过官方 v0.4.1 编译发行包安装，SHA-256 与官方校验文件一致，并写入 pnpm 锁文件 integrity；业务代码只导入公开组件、样式、主题与 Vite 入口。
插件示例仓库不是运行时依赖，复用其公开宿主桥、请求层与运行时解码组织方式，不导入其内部业务代码，也不降级当前宿主 SDK。
来源与许可见 `LICENSES/NOTICE.md`，随插件包一并提供。

## 验证边界

`verification/protocol-test.mjs` 启动真实插件进程，以模拟宿主验证握手、分页、只读快照、原生开关独立读写、旧状态兼容、重启恢复及幂等键复用
测试不访问真实网关或真实上游，不消费真实卡片

`pnpm --dir frontend dev --port 5176` 提供带明确标识的本地模拟预览，发行页面只使用 `window.codexProxyPlugin` 宿主桥，不请求管理员密码或读取管理 Cookie

## 页面加载排查

宿主会校验页面资源的 sandbox CSP 和 `X-Content-Type-Options: nosniff`
Nginx 同时透传上游同名头并追加 `nosniff` 会产生 `nosniff, nosniff`，从而触发“服务返回了不受支持的响应”
在已有 Nginx `add_header X-Content-Type-Options nosniff always;` 的站点中，使用 `proxy_hide_header X-Content-Type-Options;` 保留单个安全头
修改需要备份并通过配置检查，平滑重载须保留在途连接；浏览器缓存旧响应头时需强制刷新页面
