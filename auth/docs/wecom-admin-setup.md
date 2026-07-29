# 企业微信管理员配置手册

本文面向企业微信管理员和平台管理员，目标是让员工从 OpenProject 登录页使用企业微信
身份登录。正式链路为：

```text
员工 -> OpenProject -> Keycloak -> Bridge -> 企业微信 -> Bridge -> Keycloak -> OpenProject
```

## 1. 创建企业内部自建应用

1. 登录企业微信管理后台。
2. 进入“应用管理”，创建“企业内部自建应用”。
3. 应用名称建议使用“Amperun 统一登录”或组织内可识别的名称。
4. PoC 阶段只把应用可见范围设置为测试部门或测试员工。
5. 确认测试员工账号正常，并已填写唯一的企业邮箱。

管理员需要记录：

| 参数 | 企业微信后台常见位置 |
| --- | --- |
| `CorpID` | 我的企业 / 企业信息 |
| `AgentID` | 自建应用详情 |
| 应用 `Secret` | 自建应用 / 开发者接口 |
| 员工 `UserID` | 通讯录成员详情或通讯录 API |

`UserID` 不是姓名、手机号或邮箱。应用 `Secret` 只能通过 Secret Manager 或受控密钥
通道交给平台管理员。

## 2. 配置企业微信授权回调

Bridge 是企业微信直接回调的接收方。生产示例假设 Bridge 外部域名为
`sso.example.com`：

```text
https://sso.example.com/wecom/callback
```

普通电脑扫码登录：

1. 在自建应用中找到“企业微信授权登录”“Web 登录”或同义入口。
2. 授权回调域填写 `sso.example.com`；如果后台要求完整 URL，填写上面的回调 URL。
3. 保存后确认配置仍绑定正确的应用和 `AgentID`。

企业微信客户端内网页授权：

1. 找到“网页授权及 JS-SDK”“可信域名”或同义入口。
2. 把 `sso.example.com` 配成可信域名。
3. 按后台要求完成域名归属校验。
4. 确认应用可以读取当前登录成员身份。

本地 `bridge.localhost` 不能直接作为真实企业微信生产回调域。真实联调必须先配置可访问的
HTTPS 域名和证书，再同步修改 `BRIDGE_ISSUER`、Keycloak 上游 IdP 地址和反向代理。

## 3. 配置最小成员资料权限

Bridge 需要读取：

- `UserID`；
- 姓名；
- 企业邮箱 `biz_mail` 或 `email`；
- 成员启用状态；
- 部门 ID（当前只用于身份资料，不自动授予平台管理员权限）。

检查自建应用可见范围覆盖测试员工，并具备读取可见范围成员资料的权限。如果企业微信不
返回企业邮箱，Bridge 会拒绝登录，不会用手机号、姓名或虚构地址代替。

### 配置企业可信 IP

Bridge 会从服务端调用 `gettoken`、`auth/getuserinfo` 和 `user/get`。在企业微信自建应用的
“开发者接口”或“企业可信 IP”中，把 Bridge 所在网络的固定公网 NAT 出口 IP 加入白名单。
这里填写的是公网出口 IP，不是容器 IP、局域网 IP 或域名；多副本部署要覆盖所有可能出口。

配置后从 Bridge 主机发起一次真实登录验证。如果取 Token 成功但成员接口返回
`errcode: 60020`，先核对实际出口 IP、企业可信 IP 是否保存到当前自建应用，以及请求使用的
`CorpID`/应用 `Secret` 是否属于同一企业。可信 IP 未放行前不能用该错误判断通讯录权限。

当前代码没有企业微信事件接收端点，不要配置猜测的 `/wecom/events`。成员变更回调、
Token、EncodingAESKey 和定时全量对账应在生命周期服务实现后再启用。

## 4. 平台管理员配置

在 `auth/.env` 配置企业微信参数：

```dotenv
WECOM_MODE=wecom
WECOM_AUTH_STYLE=qr
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_APP_SECRET=<从 Secret Manager 注入>
WECOM_ALLOWED_USER_IDS=zhangsan,lisi
BRIDGE_ISSUER=https://sso.example.com
BRIDGE_PUBLIC_HOST=sso.example.com
KEYCLOAK_PUBLIC_URL=https://login.example.com
KEYCLOAK_PUBLIC_HOST=login.example.com
KEYCLOAK_BROKER_REDIRECT_URI=https://login.example.com/realms/amperun/broker/wecom/endpoint
OPENPROJECT_PUBLIC_URL=https://projects.example.com
OPENPROJECT_PUBLIC_HOST=projects.example.com
OPENPROJECT_GATEWAY_HOST=projects.example.com
OPENPROJECT_COLLABORATION_PUBLIC_URL=wss://projects.example.com/hocuspocus
```

应用可见范围和 `WECOM_ALLOWED_USER_IDS` 是两层控制，必须同时允许。PoC 先列出少量测试
员工，验收后再分批扩大。

生成并注入互不复用的随机 Secret：

| 配置项 | 用途 |
| --- | --- |
| `KEYCLOAK_BROKER_CLIENT_SECRET` | Bridge OIDC Client 与 Keycloak IdP |
| `OPENPROJECT_OIDC_CLIENT_SECRET` | OpenProject 原生 OIDC 与 Keycloak Client |
| `BRIDGE_COOKIE_KEYS` | Bridge 交互 Cookie |
| `KEYCLOAK_DB_PASSWORD` | Keycloak PostgreSQL |
| `OPENPROJECT_DB_PASSWORD` | OpenProject PostgreSQL |
| `OPENPROJECT_SECRET_KEY_BASE` | OpenProject 会话与加密基础密钥 |
| `COLLABORATIVE_SERVER_SECRET` | OpenProject 与 Hocuspocus |

本地 Realm 的 OpenProject Client 必须配置：

```text
Client ID: openproject
Redirect URI: http://openproject.localhost:8090/auth/keycloak/callback
```

生产时把 scheme 和 host 换成 OpenProject 的正式 HTTPS 地址，路径保持
`/auth/keycloak/callback`。这个回调属于 Keycloak Client，与第 2 节企业微信回调到
Bridge 是两个不同配置，不能互换。

## 5. 启动与 Secret 对账

```bash
cp auth/.env.example auth/.env
# 编辑 auth/.env
make -C auth up
make -C auth status
```

`keycloak-client-config` 应以退出码 `0` 完成，日志包含：

```text
Keycloak client secrets reconciled; WeCom-only browser flow enforced
```

该任务还会对账 Bridge IdP 端点、OpenProject Client 回调/Origin，把 Realm Browser Flow
设置为 `wecom-only-browser`，并禁用员工
`account-console`。修改两个 OIDC Client Secret 后要重新运行 `make up` 完成对账，不能只
改 `.env` 或只改 Keycloak 后台。

Realm JSON 只在 Keycloak 数据库首次初始化时导入。旧数据卷中如果仍是
`openproject-proxy` Client，对账任务会明确失败，不会静默使用旧 Client。生产环境应迁移
Realm；只有确认整套本地 OpenProject、Keycloak 和 Bridge 数据都可删除时，才能执行
`make -C auth reset`。不要只删除 Keycloak 数据卷，否则 Keycloak 用户 `sub` 会变化。

## 6. 员工首次登录

管理员不需要预先在 Keycloak 或 OpenProject 建号。员工按以下步骤操作：

1. 访问 OpenProject 登录页，而不是 Keycloak `/account` 页面。
2. 点击“企业微信”。
3. Keycloak 自动进入企业微信身份源。
4. 员工扫码或在企业微信客户端授权。
5. Bridge 验证应用可见范围、账号状态、企业邮箱和 `WECOM_ALLOWED_USER_IDS`。
6. Keycloak 首次创建 Broker 用户。
7. OpenProject 根据 OIDC `sub` 首次创建并激活用户，然后进入业务页面。

第二次登录必须回到同一 OpenProject 用户。姓名或邮箱修改不应生成新账号；企业微信
`UserID` 变更需要生命周期服务显式建立 alias，目前 PoC 不自动处理该事件。

## 7. 验收清单

- [ ] 测试员工位于应用可见范围
- [ ] Bridge 固定公网出口 IP 已加入当前自建应用“企业可信 IP”
- [ ] 测试员工 `UserID` 位于 `WECOM_ALLOWED_USER_IDS`
- [ ] 测试员工企业邮箱有效且唯一
- [ ] 企业微信授权域和 Bridge HTTPS 回调一致
- [ ] Keycloak Client 回调为 `/auth/keycloak/callback`
- [ ] `keycloak-client-config` 正常完成
- [ ] OpenProject 登录页显示“企业微信”
- [ ] Keycloak 不显示用户名密码表单，直接进入企业微信
- [ ] 首次登录自动建号，重复登录不产生重复用户
- [ ] 白名单外员工被拒绝
- [ ] `make -C auth smoke` 通过
- [ ] 紧急管理员入口和回滚负责人已确认

## 8. 停用与回滚

发现问题时按顺序处理：

1. 缩小或暂停企业微信自建应用可见范围。
2. 从 `WECOM_ALLOWED_USER_IDS` 移除相关员工并重启 Bridge。
3. 在 Keycloak 禁用企业微信 IdP 或停用用户会话。
4. 在 OpenProject 停用对应用户，但保留项目和审计数据。
5. 使用独立本地紧急管理员排查。

生产上线前必须补充成员离职自动停用、会话撤销、全量对账、监控告警、备份恢复和 Secret
轮换流程。

## 9. 企业微信官方文档

- [企业微信网页授权登录](https://developer.work.weixin.qq.com/document/path/91335)
- [企业微信 Web 登录](https://developer.work.weixin.qq.com/document/path/98151)
- [企业微信获取登录用户身份](https://developer.work.weixin.qq.com/document/path/98176)
- [企业微信读取成员](https://developer.work.weixin.qq.com/document/path/90196)
- [企业微信成员变更通知](https://developer.work.weixin.qq.com/document/path/90970)
